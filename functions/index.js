const admin = require('firebase-admin');
const functions = require('firebase-functions');
const Stripe = require('stripe');
const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');

admin.initializeApp();

const ALLOWED_ROLES = new Set(['admin', 'tester', 'premium', 'basic']);
const PREMIUM_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due']);
const DEFAULT_APP_BASE_URL = 'https://www.pokevaluator.com';
const SCRYDEX_PRICE_WEBHOOK_EVENTS = new Set([
    'pokemon.expansions.prices.raw_updated',
    'pokemon.expansions.prices.graded_updated',
]);

let stripeClient = null;

function normalizeRole(role) {
    return String(role || '').trim().toLowerCase();
}

function serverTimestamp() {
    return FieldValue.serverTimestamp();
}

function legacyConfigValue(nestedPath) {
    if (!Array.isArray(nestedPath) || nestedPath.length === 0) return '';

    try {
        if (typeof functions.config !== 'function') return '';
        let cursor = functions.config();

        for (const partRaw of nestedPath) {
            const part = String(partRaw || '').trim();
            if (!part || !cursor || typeof cursor !== 'object') return '';
            cursor = cursor[part];
        }

        return String(cursor || '').trim();
    } catch {
        return '';
    }
}

function configValue(envKey, nestedPath, fallback) {
    // Prefer explicit environment variables.
    const envValue = String(process.env?.[envKey] || '').trim();
    if (envValue) return envValue;

    // Backward compatibility for existing functions.config() deployments.
    const legacyValue = legacyConfigValue(nestedPath);
    if (legacyValue) return legacyValue;

    return String(fallback || '').trim();
}

function getStripeSecretKey() {
    return configValue('STRIPE_SECRET_KEY', ['stripe', 'secret_key'], '');
}

function getStripeWebhookSecret() {
    return configValue('STRIPE_WEBHOOK_SECRET', ['stripe', 'webhook_secret'], '');
}

function getScrydexWebhookSecret() {
    return configValue('SCRYDEX_WEBHOOK_SECRET', ['scrydex', 'webhook_secret'], '');
}

function getUpstashRestUrl() {
    return configValue('UPSTASH_REDIS_REST_URL', ['upstash', 'redis_rest_url'], '').replace(/\/$/, '');
}

function getUpstashRestToken() {
    return configValue('UPSTASH_REDIS_REST_TOKEN', ['upstash', 'redis_rest_token'], '');
}

function getScrydexDirtyTtlSeconds() {
    const raw = Number(configValue('SCRYDEX_DIRTY_TTL_SECONDS', ['scrydex', 'dirty_ttl_seconds'], '1209600'));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1209600;
}

function getStripeMonthlyPriceId() {
    return configValue('STRIPE_PRICE_ID_MONTHLY_PREMIUM', ['stripe', 'price_id_monthly_premium'], '');
}

function getStripePortalConfigurationId() {
    return configValue('STRIPE_BILLING_PORTAL_CONFIGURATION_ID', ['stripe', 'billing_portal_configuration_id'], '');
}

function getAppBaseUrl() {
    const raw = configValue('STRIPE_APP_BASE_URL', ['stripe', 'app_base_url'], DEFAULT_APP_BASE_URL);
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return DEFAULT_APP_BASE_URL;
        }
        return parsed.origin;
    } catch {
        return DEFAULT_APP_BASE_URL;
    }
}

function isLocalOrigin(origin) {
    try {
        const parsed = new URL(origin);
        const host = String(parsed.hostname || '').toLowerCase();
        return host === 'localhost' || host === '127.0.0.1';
    } catch {
        return false;
    }
}

function isAllowedReturnOrigin(origin) {
    const allowedOrigins = new Set();

    const appBase = getAppBaseUrl();
    if (appBase) allowedOrigins.add(appBase);

    const csv = configValue('STRIPE_ALLOWED_RETURN_ORIGINS', ['stripe', 'allowed_return_origins'], '');
    if (csv) {
        for (const part of csv.split(',')) {
            const candidate = String(part || '').trim();
            if (!candidate) continue;
            try {
                const parsed = new URL(candidate);
                allowedOrigins.add(parsed.origin);
            } catch {
                // Ignore invalid origins.
            }
        }
    }

    if (allowedOrigins.has(origin)) return true;
    return isLocalOrigin(origin);
}

function sanitizeReturnUrl(raw, fallbackUrl) {
    const fallback = String(fallbackUrl || '').trim();

    try {
        const candidate = new URL(String(raw || '').trim());
        if ((candidate.protocol === 'https:' || candidate.protocol === 'http:') && isAllowedReturnOrigin(candidate.origin)) {
            return candidate.href;
        }
    } catch {
        // Use fallback.
    }

    return fallback;
}

function withQuery(url, key, value) {
    const next = new URL(url);
    next.searchParams.set(String(key || ''), String(value || ''));
    return next.href;
}

function parseSignatureHeader(rawHeader) {
    const out = {};
    const header = String(rawHeader || '').trim();
    if (!header) return out;

    const parts = header.split(',').map((x) => String(x || '').trim()).filter(Boolean);
    for (const part of parts) {
        const eq = part.indexOf('=');
        if (eq <= 0) continue;
        const key = part.slice(0, eq).trim().toLowerCase();
        const value = part.slice(eq + 1).trim().replace(/^"|"$/g, '');
        if (!key || !value) continue;
        out[key] = value;
    }
    return out;
}

function timingSafeStringEquals(a, b) {
    const left = Buffer.from(String(a || ''), 'utf8');
    const right = Buffer.from(String(b || ''), 'utf8');
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function normalizeSignatureCandidate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.toLowerCase().replace(/^sha256=/, '');
}

function buildScrydexSignatureCandidates(secret, timestamp, rawBodyBuffer) {
    const ts = String(timestamp || '').trim();
    const payload = Buffer.isBuffer(rawBodyBuffer)
        ? rawBodyBuffer
        : Buffer.from(String(rawBodyBuffer || ''), 'utf8');

    /** @type {string[]} */
    const inputs = [];
    if (ts) {
        inputs.push(`${ts}.${payload.toString('utf8')}`);
    }
    inputs.push(payload.toString('utf8'));

    /** @type {string[]} */
    const out = [];
    for (const input of inputs) {
        const hex = crypto.createHmac('sha256', secret).update(input, 'utf8').digest('hex');
        const b64 = crypto.createHmac('sha256', secret).update(input, 'utf8').digest('base64');
        out.push(hex, `sha256=${hex}`, b64, `sha256=${b64}`);
    }
    return Array.from(new Set(out.map(normalizeSignatureCandidate).filter(Boolean)));
}

function verifyScrydexWebhookSignature(rawBodyBuffer, signatureHeader, secret) {
    const secretValue = String(secret || '').trim();
    if (!secretValue) {
        return { ok: false, error: 'Scrydex webhook secret is not configured.' };
    }

    const parsed = parseSignatureHeader(signatureHeader);
    const timestamp = String(parsed.t || '').trim();
    const provided = normalizeSignatureCandidate(parsed.v1 || signatureHeader);
    if (!provided) {
        return { ok: false, error: 'Missing X-Scrydex-Signature value.' };
    }

    const candidates = buildScrydexSignatureCandidates(secretValue, timestamp, rawBodyBuffer);
    for (const candidate of candidates) {
        if (timingSafeStringEquals(candidate, provided)) {
            return { ok: true };
        }
    }

    return { ok: false, error: 'Invalid Scrydex webhook signature.' };
}

async function upstashPost(pathname) {
    const base = getUpstashRestUrl();
    const token = getUpstashRestToken();
    if (!base || !token) return null;

    const res = await fetch(`${base}${pathname}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Upstash request failed (${res.status}): ${text || 'unknown error'}`);
    }

    return res;
}

async function markScrydexDirtyVersions(expansionIds) {
    const ids = Array.from(new Set((Array.isArray(expansionIds) ? expansionIds : [])
        .map((x) => String(x || '').trim().toLowerCase())
        .filter((x) => /^[a-z0-9_-]{2,64}$/.test(x))));

    const ttlSeconds = getScrydexDirtyTtlSeconds();
    const hasUpstash = Boolean(getUpstashRestUrl() && getUpstashRestToken());
    if (!hasUpstash || !ids.length) {
        return {
            updatedExpansionCount: 0,
            updatedGlobal: false,
            upstashEnabled: hasUpstash,
        };
    }

    const expansionTasks = ids.map(async (id) => {
        const key = `pv:scrydex:dirty:expansion:${encodeURIComponent(id)}:v1`;
        await upstashPost(`/incr/${key}`);
        await upstashPost(`/expire/${key}/${encodeURIComponent(String(ttlSeconds))}`);
    });
    await Promise.all(expansionTasks);

    const globalKey = 'pv:scrydex:dirty:global:v1';
    await upstashPost(`/incr/${encodeURIComponent(globalKey)}`);
    await upstashPost(`/expire/${encodeURIComponent(globalKey)}/${encodeURIComponent(String(ttlSeconds))}`);

    return {
        updatedExpansionCount: ids.length,
        updatedGlobal: true,
        upstashEnabled: true,
    };
}

async function claimScrydexEvent(eventId, eventName, expansionIds) {
    const db = admin.firestore();
    const ref = db.collection('scrydexWebhookEvents').doc(String(eventId || '').trim());
    let inserted = false;

    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) return;
        inserted = true;
        tx.set(ref, {
            id: String(eventId || '').trim(),
            name: String(eventName || '').trim(),
            expansionIds: Array.isArray(expansionIds) ? expansionIds : [],
            createdAt: serverTimestamp(),
        });
    });

    return inserted;
}

function toMillisFromUnixSeconds(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 1000);
}

function extractStripeId(value) {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && typeof value.id === 'string') return value.id;
    return '';
}

function isPremiumFromSubscriptionStatus(statusRaw) {
    const status = String(statusRaw || '').trim().toLowerCase();
    return PREMIUM_SUBSCRIPTION_STATUSES.has(status);
}

function statusPriority(statusRaw) {
    const status = String(statusRaw || '').trim().toLowerCase();
    if (status === 'active') return 50;
    if (status === 'trialing') return 40;
    if (status === 'past_due') return 30;
    if (status === 'unpaid') return 20;
    if (status === 'incomplete') return 10;
    if (status === 'canceled') return 0;
    return -1;
}

function chooseSubscription(subscriptions) {
    if (!Array.isArray(subscriptions) || subscriptions.length === 0) return null;
    const sorted = subscriptions.slice().sort((a, b) => {
        const byStatus = statusPriority(b?.status) - statusPriority(a?.status);
        if (byStatus !== 0) return byStatus;
        return Number(b?.created || 0) - Number(a?.created || 0);
    });
    return sorted[0] || null;
}

function getStripeClient() {
    const secretKey = getStripeSecretKey();
    if (!secretKey) {
        throw new Error('Stripe is not configured (missing STRIPE_SECRET_KEY).');
    }
    if (!stripeClient) {
        stripeClient = new Stripe(secretKey);
    }
    return stripeClient;
}

function assertStripeSecretConfigured() {
    const secretKey = getStripeSecretKey();
    if (secretKey) return;
    throw new functions.https.HttpsError(
        'failed-precondition',
        'Stripe is not configured. Missing STRIPE_SECRET_KEY.'
    );
}

function requireAuthUid(context) {
    const uid = String(context?.auth?.uid || '').trim();
    if (!uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in required.');
    }
    return uid;
}

function normalizeCollectionId(raw, fallback = 'default') {
    const normalized = String(raw || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);

    return normalized || String(fallback || 'default').trim().toLowerCase() || 'default';
}

function toSnapshotDate(timezone) {
    const zone = String(timezone || '').trim();

    if (zone) {
        try {
            const formatted = new Intl.DateTimeFormat('en-CA', {
                timeZone: zone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).format(new Date());

            if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) {
                return formatted;
            }
        } catch {
            // Fall back to UTC date.
        }
    }

    return new Date().toISOString().slice(0, 10);
}

function normalizeCondition(raw) {
    const upper = String(raw || '')
        .trim()
        .toUpperCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ');

    if (upper === 'NM' || upper.startsWith('NEAR MINT')) return 'NM';
    if (upper === 'LP' || upper.startsWith('LIGHT PLAY')) return 'LP';
    if (upper === 'MP' || upper.startsWith('MODERATE PLAY') || upper.startsWith('MID PLAY')) return 'MP';
    if (upper === 'HP' || upper.startsWith('HEAVY PLAY')) return 'HP';
    if (upper === 'DM' || upper.startsWith('DAMAGE')) return 'DM';
    return '';
}

function getConditionEntries(item) {
    const map = item?.conditionQuantities && typeof item.conditionQuantities === 'object'
        ? item.conditionQuantities
        : {};

    /** @type {Array<{ condition: string, qty: number }>} */
    const entries = [];
    for (const [rawCondition, rawQty] of Object.entries(map)) {
        const condition = normalizeCondition(rawCondition);
        const qty = Math.floor(Number(rawQty));
        if (!condition || !Number.isFinite(qty) || qty <= 0) continue;
        entries.push({ condition, qty });
    }

    if (!entries.length) {
        const fallback = normalizeCondition(item?.selectedCondition);
        if (fallback) {
            entries.push({ condition: fallback, qty: 1 });
        }
    }

    return entries;
}

function getWorkerBase() {
    const raw = configValue(
        'SCRYDEX_WORKER_BASE_URL',
        ['scrydex', 'worker_base_url'],
        'https://pokevalutor-v1.lreyperez18.workers.dev'
    );
    return String(raw || '').trim().replace(/\/$/, '');
}

function toCents(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100);
}

function toNonNegativeInt(raw) {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
}

function readMarketValue(raw) {
    const value = Number(raw?.market ?? raw?.marketPrice ?? raw?.market_price ?? raw?.price ?? raw?.value ?? null);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function centsFromMarket(raw) {
    return toCents(readMarketValue(raw));
}

function buildPriceKeyForCard(item, condition) {
    const id = String(item?.id || '').trim().toLowerCase();
    const variant = String(item?.selectedVariant || 'Standard').trim() || 'Standard';
    const safeVariant = variant.toLowerCase();
    const safeCondition = String(condition || '').trim().toUpperCase();
    return `card:${id}:${safeVariant}:${safeCondition}`;
}

function buildPriceKeyForSealed(item) {
    const id = String(item?.id || '').trim().toLowerCase();
    return `sealed:${id}`;
}

async function readPriceCacheMap(db, keys) {
    const uniqueKeys = Array.from(new Set((Array.isArray(keys) ? keys : []).filter(Boolean)));
    const out = new Map();
    if (!uniqueKeys.length) return out;

    const chunkSize = 300;
    for (let i = 0; i < uniqueKeys.length; i += chunkSize) {
        const chunk = uniqueKeys.slice(i, i + chunkSize);
        const refs = chunk.map((key) => db.collection('cardPriceCache').doc(String(key)));
        const snaps = refs.length ? await db.getAll(...refs) : [];

        for (const snap of snaps) {
            if (!snap.exists) continue;
            out.set(snap.id, snap.data());
        }
    }

    return out;
}

function marketCentsFromCacheDoc(doc) {
    const marketCentsRaw = Number(doc?.marketCents ?? null);
    if (Number.isFinite(marketCentsRaw) && marketCentsRaw > 0) {
        return Math.round(marketCentsRaw);
    }
    return centsFromMarket(doc);
}

function findVariantByName(variants, selectedVariant) {
    if (!Array.isArray(variants)) return null;
    const wanted = String(selectedVariant || '').trim().toLowerCase();
    if (!wanted) return null;
    return variants.find((variant) => String(variant?.name || '').trim().toLowerCase() === wanted) || null;
}

function marketForCondition(prices, condition) {
    if (!Array.isArray(prices)) return 0;
    const wanted = normalizeCondition(condition);
    if (!wanted) return 0;

    let best = 0;
    for (const price of prices) {
        const got = normalizeCondition(price?.condition);
        if (got !== wanted) continue;
        const market = readMarketValue(price);
        if (market > best) best = market;
    }
    return best;
}

function bestCardMarketForCondition(cardLike, condition) {
    const variants = Array.isArray(cardLike?.variants) ? cardLike.variants : [];
    if (!variants.length) return 0;

    const selectedVariant = String(cardLike?.selectedVariant || '').trim();
    if (selectedVariant) {
        const match = findVariantByName(variants, selectedVariant);
        const selectedMarket = marketForCondition(match?.prices, condition);
        if (selectedMarket > 0) return selectedMarket;
    }

    let best = 0;
    for (const variant of variants) {
        const market = marketForCondition(variant?.prices, condition);
        if (market > best) best = market;
    }
    return best;
}

function bestSealedMarket(sealedLike) {
    const variants = Array.isArray(sealedLike?.variants) ? sealedLike.variants : [];
    if (!variants.length) return 0;

    let best = 0;
    for (const variant of variants) {
        const prices = Array.isArray(variant?.prices) ? variant.prices : [];
        for (const price of prices) {
            const market = readMarketValue(price);
            if (market > 0 && (best <= 0 || market < best)) {
                best = market;
            }
        }
    }

    return best;
}

async function fetchJson(url) {
    try {
        const res = await fetch(url, {
            method: 'GET',
            cache: 'no-store',
        });

        if (!res.ok) return null;
        const text = await res.text();
        if (!text) return null;
        return JSON.parse(text);
    } catch {
        return null;
    }
}

async function fetchCardWithPrices(cardId) {
    const id = String(cardId || '').trim();
    if (!id) return null;

    const base = getWorkerBase();
    if (!base) return null;

    const parsed = await fetchJson(`${base}/cards/${encodeURIComponent(id)}?includePrices=1&lang=en`);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed?.data || parsed;
}

async function fetchSealedWithPrices(sealedId) {
    const id = String(sealedId || '').trim();
    if (!id) return null;

    const base = getWorkerBase();
    if (!base) return null;

    const bySearch = await fetchJson(`${base}/sealed/search?q=${encodeURIComponent(`id:${id}`)}&page=1&pageSize=10`);
    const searchRows = Array.isArray(bySearch?.data)
        ? bySearch.data
        : (Array.isArray(bySearch) ? bySearch : []);
    const searchHit = searchRows.find((row) => String(row?.id || '').trim() === id);
    if (searchHit && typeof searchHit === 'object') return searchHit;

    const parsed = await fetchJson(`${base}/sealed/${encodeURIComponent(id)}?includePrices=1`);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed?.data || parsed;
}

function buildCacheDocForCard(item, condition, marketCents) {
    const key = buildPriceKeyForCard(item, condition);
    return {
        key,
        itemType: 'card',
        cardId: String(item?.id || '').trim(),
        variant: String(item?.selectedVariant || 'Standard').trim() || 'Standard',
        condition: String(condition || '').trim().toUpperCase(),
        marketCents: toNonNegativeInt(marketCents),
        currency: 'USD',
        source: 'scrydex-worker',
        fetchedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    };
}

function buildCacheDocForSealed(item, marketCents) {
    const key = buildPriceKeyForSealed(item);
    return {
        key,
        itemType: 'sealed',
        sealedId: String(item?.id || '').trim(),
        marketCents: toNonNegativeInt(marketCents),
        currency: 'USD',
        source: 'scrydex-worker',
        fetchedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    };
}

async function writePriceCacheDocs(db, docsByKey) {
    if (!(docsByKey instanceof Map) || docsByKey.size === 0) return;

    const entries = Array.from(docsByKey.entries());
    const chunkSize = 450;

    for (let i = 0; i < entries.length; i += chunkSize) {
        const batch = db.batch();
        const chunk = entries.slice(i, i + chunkSize);

        for (const [key, value] of chunk) {
            if (!key || !value || typeof value !== 'object') continue;
            const ref = db.collection('cardPriceCache').doc(String(key));
            batch.set(ref, value, { merge: true });
        }

        await batch.commit();
    }
}

function formatUtcDateYYYYMMDD(date) {
    const d = date instanceof Date ? date : new Date();
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function previousDateKey(baseDateKey, daysBack) {
    const base = String(baseDateKey || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return '';

    const delta = Math.max(1, Math.floor(Number(daysBack) || 1));
    const dt = new Date(`${base}T00:00:00.000Z`);
    if (Number.isNaN(dt.getTime())) return '';
    dt.setUTCDate(dt.getUTCDate() - delta);
    return formatUtcDateYYYYMMDD(dt);
}

async function getPreviousSnapshot(db, uid, collectionId, snapshotDate) {
    const parent = db.collection('users').doc(uid).collection('dexValueSnapshots');
    const lookbackDays = 60;

    const refs = [];
    for (let i = 1; i <= lookbackDays; i += 1) {
        const dateKey = previousDateKey(snapshotDate, i);
        if (!dateKey) continue;
        refs.push(parent.doc(`${collectionId}_${dateKey}`));
    }

    if (!refs.length) return null;

    const chunkSize = 300;
    for (let i = 0; i < refs.length; i += chunkSize) {
        const chunk = refs.slice(i, i + chunkSize);
        const snaps = chunk.length ? await db.getAll(...chunk) : [];
        for (const snap of snaps) {
            if (!snap.exists) continue;
            return snap.data();
        }
    }

    return null;
}

function toSnapshotResponse(snapshotRaw, docId) {
    const createdAtMs = Number(snapshotRaw?.createdAt?.toMillis?.() || 0);
    const updatedAtMs = Number(snapshotRaw?.updatedAt?.toMillis?.() || 0);
    return {
        snapshotId: String(docId || ''),
        uid: String(snapshotRaw?.uid || ''),
        collectionId: String(snapshotRaw?.collectionId || 'default'),
        snapshotDate: String(snapshotRaw?.snapshotDate || ''),
        totalValueCents: toNonNegativeInt(snapshotRaw?.totalValueCents),
        previousValueCents: toNonNegativeInt(snapshotRaw?.previousValueCents),
        changeCents: Math.round(Number(snapshotRaw?.changeCents || 0)),
        changePercent: Number(snapshotRaw?.changePercent || 0),
        pricedItemCount: toNonNegativeInt(snapshotRaw?.pricedItemCount),
        totalItemCount: toNonNegativeInt(snapshotRaw?.totalItemCount),
        pricedUnitCount: toNonNegativeInt(snapshotRaw?.pricedUnitCount),
        totalUnitCount: toNonNegativeInt(snapshotRaw?.totalUnitCount),
        unpricedItemIds: Array.isArray(snapshotRaw?.unpricedItemIds) ? snapshotRaw.unpricedItemIds.slice(0, 100) : [],
        source: String(snapshotRaw?.source || ''),
        createdAtMs: createdAtMs > 0 ? createdAtMs : Date.now(),
        updatedAtMs: updatedAtMs > 0 ? updatedAtMs : createdAtMs || Date.now(),
    };
}

exports.getCollectionValueSnapshot = functions.https.onCall(async (data, context) => {
    const uid = requireAuthUid(context);
    const db = admin.firestore();

    const collectionId = normalizeCollectionId(data?.collectionId, 'default');
    const snapshotDate = toSnapshotDate(data?.timezone);
    const snapshotId = `${collectionId}_${snapshotDate}`;
    const useLiveWorkerPrices = data?.useLiveWorkerPrices !== false;

    const snapshotRef = db
        .collection('users')
        .doc(uid)
        .collection('dexValueSnapshots')
        .doc(snapshotId);

    const existing = await snapshotRef.get();
    if (existing.exists) {
        return {
            ok: true,
            snapshot: toSnapshotResponse(existing.data() || {}, existing.id),
            cached: true,
        };
    }

    const stateSnap = await db
        .collection('users')
        .doc(uid)
        .collection('dex')
        .doc('state')
        .get();

    const state = stateSnap.exists ? stateSnap.data() : {};
    const allItems = Array.isArray(state?.collection) ? state.collection : [];
    const activeItems = allItems.filter((item) => normalizeCollectionId(item?.collectionId, 'default') === collectionId);

    const requiredKeys = [];
    for (const item of activeItems) {
        const itemType = String(item?.itemType || '').trim().toLowerCase() === 'sealed' ? 'sealed' : 'card';
        if (itemType === 'sealed') {
            requiredKeys.push(buildPriceKeyForSealed(item));
            continue;
        }

        for (const entry of getConditionEntries(item)) {
            requiredKeys.push(buildPriceKeyForCard(item, entry.condition));
        }
    }

    const priceCache = await readPriceCacheMap(db, requiredKeys);
    const liveCardById = new Map();
    const liveSealedById = new Map();
    const cacheWrites = new Map();

    let totalValueCents = 0;
    let pricedItemCount = 0;
    let pricedUnitCount = 0;
    let totalUnitCount = 0;
    const unpricedItemIds = [];

    for (const item of activeItems) {
        const itemId = String(item?.id || '').trim();
        if (!itemId) continue;

        const itemType = String(item?.itemType || '').trim().toLowerCase() === 'sealed' ? 'sealed' : 'card';
        let itemHadPrice = false;

        if (itemType === 'sealed') {
            const qty = Math.max(1, Math.floor(Number(item?.quantity ?? item?.sealedQuantity ?? 1) || 1));
            totalUnitCount += qty;

            const key = buildPriceKeyForSealed(item);
            let unitCents = marketCentsFromCacheDoc(priceCache.get(key));

            if (unitCents <= 0 && useLiveWorkerPrices) {
                let live = liveSealedById.get(itemId);
                if (!live) {
                    live = await fetchSealedWithPrices(itemId);
                    liveSealedById.set(itemId, live || null);
                }
                unitCents = toCents(bestSealedMarket(live)) || centsFromMarket(live);
                if (unitCents > 0) {
                    cacheWrites.set(key, buildCacheDocForSealed(item, unitCents));
                }
            }

            if (unitCents <= 0) {
                unitCents = centsFromMarket(item);
            }

            if (unitCents > 0) {
                totalValueCents += unitCents * qty;
                pricedUnitCount += qty;
                pricedItemCount += 1;
                itemHadPrice = true;
            }
        } else {
            const conditionEntries = getConditionEntries(item);
            for (const entry of conditionEntries) {
                totalUnitCount += entry.qty;

                const key = buildPriceKeyForCard(item, entry.condition);
                let unitCents = marketCentsFromCacheDoc(priceCache.get(key));

                if (unitCents <= 0 && useLiveWorkerPrices) {
                    let liveCard = liveCardById.get(itemId);
                    if (!liveCard) {
                        liveCard = await fetchCardWithPrices(itemId);
                        liveCardById.set(itemId, liveCard || null);
                    }

                    unitCents = toCents(bestCardMarketForCondition(liveCard, entry.condition)) || centsFromMarket(liveCard);
                    if (unitCents > 0) {
                        cacheWrites.set(key, buildCacheDocForCard(item, entry.condition, unitCents));
                    }
                }

                if (unitCents <= 0) {
                    unitCents = centsFromMarket(item);
                }

                if (unitCents > 0) {
                    totalValueCents += unitCents * entry.qty;
                    pricedUnitCount += entry.qty;
                    itemHadPrice = true;
                }
            }

            if (itemHadPrice) {
                pricedItemCount += 1;
            }
        }

        if (!itemHadPrice) {
            unpricedItemIds.push(itemId);
        }
    }

    const previous = await getPreviousSnapshot(db, uid, collectionId, snapshotDate);
    const previousValueCents = toNonNegativeInt(previous?.totalValueCents);
    const changeCents = previous
        ? (totalValueCents - previousValueCents)
        : 0;
    const changePercent = previousValueCents > 0
        ? Math.round((changeCents / previousValueCents) * 10000) / 100
        : 0;

    const snapshotDoc = {
        uid,
        collectionId,
        snapshotDate,
        totalValueCents: toNonNegativeInt(totalValueCents),
        previousValueCents,
        changeCents,
        changePercent,
        pricedItemCount,
        totalItemCount: activeItems.length,
        pricedUnitCount,
        totalUnitCount,
        unpricedItemIds: unpricedItemIds.slice(0, 100),
        source: useLiveWorkerPrices ? 'worker-live-plus-cache' : 'cache-and-state-fallback',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    };

    await snapshotRef.set(snapshotDoc, { merge: true });

    if (cacheWrites.size) {
        await writePriceCacheDocs(db, cacheWrites);
    }

    const stored = await snapshotRef.get();
    return {
        ok: true,
        snapshot: toSnapshotResponse(stored.exists ? stored.data() : snapshotDoc, snapshotId),
        cached: false,
    };
});

async function ensureStripeCustomer(uid, opts) {
    const stripe = getStripeClient();
    const db = admin.firestore();
    const ref = db.collection('stripeCustomers').doc(uid);
    const snap = await ref.get();

    const existingCustomerId = String(snap.data()?.customerId || '').trim();
    if (existingCustomerId) {
        await ref.set({
            uid,
            customerId: existingCustomerId,
            email: String(opts?.email || ''),
            displayName: String(opts?.displayName || ''),
            updatedAt: serverTimestamp(),
        }, { merge: true });
        return existingCustomerId;
    }

    const customer = await stripe.customers.create({
        email: String(opts?.email || ''),
        name: String(opts?.displayName || ''),
        metadata: {
            firebaseUID: uid,
        },
    });

    await ref.set({
        uid,
        customerId: customer.id,
        email: String(opts?.email || ''),
        displayName: String(opts?.displayName || ''),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    }, { merge: true });

    return customer.id;
}

function roleFromClaims(claims) {
    const roleRaw = String(claims?.role || '').trim().toLowerCase();
    if (roleRaw === 'admin' || roleRaw === 'tester' || roleRaw === 'premium' || roleRaw === 'basic') return roleRaw;

    const adminFlag = claims?.admin;
    if (adminFlag === true || String(adminFlag || '').toLowerCase() === 'true') return 'admin';

    const testerFlag = claims?.tester;
    if (testerFlag === true || String(testerFlag || '').toLowerCase() === 'true') return 'tester';

    const premiumFlag = claims?.premium;
    if (premiumFlag === true || String(premiumFlag || '').toLowerCase() === 'true') return 'premium';

    const tierRaw = String(claims?.tier || '').trim().toLowerCase();
    if (tierRaw === 'premium' || tierRaw === 'pro') return 'premium';

    return 'basic';
}

async function syncUserRoleFromPremium(uid, premiumEntitled, source) {
    const user = await admin.auth().getUser(uid);
    const existingClaims = user.customClaims || {};
    const currentRole = roleFromClaims(existingClaims);

    if (currentRole === 'admin' || currentRole === 'tester') {
        return { role: currentRole, skipped: true, changed: false };
    }

    const nextRole = premiumEntitled ? 'premium' : 'basic';
    const nextClaims = {
        ...existingClaims,
        role: nextRole,
        tier: nextRole,
        premium: nextRole === 'premium',
        admin: false,
        tester: false,
    };

    const unchanged = roleFromClaims(existingClaims) === nextRole
        && String(existingClaims?.tier || '').toLowerCase() === nextRole
        && Boolean(existingClaims?.premium) === (nextRole === 'premium')
        && (existingClaims?.admin === false || String(existingClaims?.admin || '').toLowerCase() === 'false' || existingClaims?.admin == null)
        && (existingClaims?.tester === false || String(existingClaims?.tester || '').toLowerCase() === 'false' || existingClaims?.tester == null);

    if (!unchanged) {
        await admin.auth().setCustomUserClaims(uid, nextClaims);
    }

    await admin.firestore().collection('stripeBilling').doc(uid).set({
        uid,
        role: nextRole,
        premiumEntitled: Boolean(premiumEntitled),
        roleUpdatedFrom: String(source || 'stripe'),
        roleUpdatedAt: serverTimestamp(),
    }, { merge: true });

    return { role: nextRole, skipped: false, changed: !unchanged };
}

async function findUidForCustomer(customerId) {
    const normalized = String(customerId || '').trim();
    if (!normalized) return '';

    const stripe = getStripeClient();
    try {
        const customer = await stripe.customers.retrieve(normalized);
        if (customer && !customer.deleted) {
            const metadataUid = String(customer.metadata?.firebaseUID || '').trim();
            if (metadataUid) return metadataUid;
        }
    } catch {
        // Fallback to Firestore mapping.
    }

    const snap = await admin.firestore()
        .collection('stripeCustomers')
        .where('customerId', '==', normalized)
        .limit(1)
        .get();

    if (snap.empty) return '';
    return String(snap.docs[0]?.id || '').trim();
}

async function writeBillingSnapshot(uid, snapshot) {
    await admin.firestore().collection('stripeBilling').doc(uid).set({
        uid,
        ...snapshot,
        updatedAt: serverTimestamp(),
    }, { merge: true });
}

async function processSubscriptionSnapshot(uid, customerId, subscription, source) {
    const status = String(subscription?.status || '').toLowerCase();
    const premiumEntitled = isPremiumFromSubscriptionStatus(status);
    const subscriptionId = String(subscription?.id || '').trim();
    const currentPeriodEndMs = toMillisFromUnixSeconds(subscription?.current_period_end);
    const cancelAtPeriodEnd = Boolean(subscription?.cancel_at_period_end);

    if (customerId) {
        await admin.firestore().collection('stripeCustomers').doc(uid).set({
            uid,
            customerId,
            updatedAt: serverTimestamp(),
        }, { merge: true });
    }

    const roleSync = await syncUserRoleFromPremium(uid, premiumEntitled, source);

    await writeBillingSnapshot(uid, {
        customerId: customerId || '',
        subscriptionId,
        subscriptionStatus: status,
        cancelAtPeriodEnd,
        currentPeriodEndMs,
        premiumEntitled,
        lastEvent: source,
        roleAfterSync: roleSync.role,
    });

    return roleSync;
}

function asHttpsError(error, fallbackCode, fallbackMessage) {
    if (error instanceof functions.https.HttpsError) return error;
    const message = String(error?.message || fallbackMessage || 'Unexpected error');
    return new functions.https.HttpsError(fallbackCode, message);
}

function isCallerAdmin(context) {
    const token = context?.auth?.token;
    if (!token) return false;
    const role = String(token.role || '').toLowerCase();
    if (role === 'admin') return true;
    const adminFlag = token.admin;
    if (adminFlag === true) return true;
    if (typeof adminFlag === 'string' && adminFlag.toLowerCase() === 'true') return true;
    return false;
}

exports.setUserRole = functions.https.onCall(async (data, context) => {
    if (!context?.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in required.');
    }
    if (!isCallerAdmin(context)) {
        throw new functions.https.HttpsError('permission-denied', 'Admin role required.');
    }

    const uid = String(data?.uid || '').trim();
    const role = normalizeRole(data?.role);

    if (!uid) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing uid');
    }
    if (!ALLOWED_ROLES.has(role)) {
        throw new functions.https.HttpsError('invalid-argument', `Invalid role: ${role}`);
    }

    const claims = {
        role,
        tier: role, // backward-compatible with existing Worker logic
        premium: role === 'premium',
        admin: role === 'admin',
        tester: role === 'tester'
    };

    await admin.auth().setCustomUserClaims(uid, claims);

    return { ok: true, uid, role };
});

exports.createStripeCheckoutSession = functions.https.onCall(async (data, context) => {
    try {
        const uid = requireAuthUid(context);
        assertStripeSecretConfigured();
        const stripe = getStripeClient();

        const monthlyPriceId = getStripeMonthlyPriceId();
        if (!monthlyPriceId) {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Stripe price id is missing. Set STRIPE_PRICE_ID_MONTHLY_PREMIUM.'
            );
        }

        const user = await admin.auth().getUser(uid);
        const customerId = await ensureStripeCustomer(uid, {
            email: user.email || context?.auth?.token?.email || '',
            displayName: user.displayName || context?.auth?.token?.name || '',
        });

        const appBase = getAppBaseUrl();
        const defaultSuccess = withQuery(`${appBase}/account.html`, 'checkout', 'success');
        const defaultCancel = withQuery(`${appBase}/account.html`, 'checkout', 'cancelled');

        const successUrlInput = String(data?.successUrl || '').trim();
        const cancelUrlInput = String(data?.cancelUrl || '').trim();

        let successUrl = sanitizeReturnUrl(successUrlInput, defaultSuccess);
        successUrl = withQuery(successUrl, 'session_id', '{CHECKOUT_SESSION_ID}');

        const cancelUrl = sanitizeReturnUrl(cancelUrlInput, defaultCancel);

        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            customer: customerId,
            line_items: [{ price: monthlyPriceId, quantity: 1 }],
            success_url: successUrl,
            cancel_url: cancelUrl,
            allow_promotion_codes: true,
            client_reference_id: uid,
            metadata: {
                firebaseUID: uid,
            },
        });

        return {
            ok: true,
            sessionId: session.id,
            url: session.url,
        };
    } catch (error) {
        functions.logger.error('createStripeCheckoutSession failed', {
            uid: String(context?.auth?.uid || ''),
            message: String(error?.message || error),
        });
        throw asHttpsError(error, 'internal', 'Could not create Stripe checkout session.');
    }
});

exports.createStripePortalSession = functions.https.onCall(async (data, context) => {
    try {
        const uid = requireAuthUid(context);
        assertStripeSecretConfigured();
        const stripe = getStripeClient();

        const user = await admin.auth().getUser(uid);
        const customerId = await ensureStripeCustomer(uid, {
            email: user.email || context?.auth?.token?.email || '',
            displayName: user.displayName || context?.auth?.token?.name || '',
        });

        const appBase = getAppBaseUrl();
        const defaultReturnUrl = `${appBase}/account.html`;
        const returnUrlInput = String(data?.returnUrl || '').trim();
        const returnUrl = sanitizeReturnUrl(returnUrlInput, defaultReturnUrl);

        const portalConfigId = getStripePortalConfigurationId();
        const payload = {
            customer: customerId,
            return_url: returnUrl,
        };
        if (portalConfigId) payload.configuration = portalConfigId;

        const session = await stripe.billingPortal.sessions.create(payload);

        return {
            ok: true,
            url: session.url,
        };
    } catch (error) {
        functions.logger.error('createStripePortalSession failed', {
            uid: String(context?.auth?.uid || ''),
            message: String(error?.message || error),
        });
        throw asHttpsError(error, 'internal', 'Could not create Stripe billing portal session.');
    }
});

exports.getStripeSubscriptionStatus = functions.https.onCall(async (_data, context) => {
    try {
        const uid = requireAuthUid(context);
        assertStripeSecretConfigured();
        const stripe = getStripeClient();

        const user = await admin.auth().getUser(uid);
        const customerId = await ensureStripeCustomer(uid, {
            email: user.email || context?.auth?.token?.email || '',
            displayName: user.displayName || context?.auth?.token?.name || '',
        });

        const subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            status: 'all',
            limit: 10,
        });

        const subscription = chooseSubscription(subscriptions.data);
        let roleSync;
        if (subscription) {
            roleSync = await processSubscriptionSnapshot(uid, customerId, subscription, 'status-check');
        } else {
            roleSync = await syncUserRoleFromPremium(uid, false, 'status-check-none');
            await writeBillingSnapshot(uid, {
                customerId,
                subscriptionId: '',
                subscriptionStatus: 'none',
                cancelAtPeriodEnd: false,
                currentPeriodEndMs: null,
                premiumEntitled: false,
                lastEvent: 'status-check-none',
                roleAfterSync: roleSync.role,
            });
        }

        const status = String(subscription?.status || 'none').toLowerCase();
        const premiumEntitled = isPremiumFromSubscriptionStatus(status);
        const role = String(roleSync?.role || (premiumEntitled ? 'premium' : 'basic'));

        return {
            ok: true,
            customerId,
            hasSubscription: Boolean(subscription),
            subscriptionId: String(subscription?.id || ''),
            subscriptionStatus: status,
            cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
            currentPeriodEndMs: toMillisFromUnixSeconds(subscription?.current_period_end),
            premiumEntitled,
            role,
        };
    } catch (error) {
        functions.logger.error('getStripeSubscriptionStatus failed', {
            uid: String(context?.auth?.uid || ''),
            message: String(error?.message || error),
        });
        throw asHttpsError(error, 'internal', 'Could not read Stripe subscription status.');
    }
});

async function processStripeEvent(event) {
    const stripe = getStripeClient();
    const eventType = String(event?.type || '').trim();

    if (eventType === 'checkout.session.completed') {
        const session = event.data.object;
        if (String(session?.mode || '') !== 'subscription') return;

        let uid = String(session?.client_reference_id || session?.metadata?.firebaseUID || '').trim();
        const customerId = extractStripeId(session?.customer);
        if (!uid && customerId) {
            uid = await findUidForCustomer(customerId);
        }
        if (!uid) {
            functions.logger.warn('checkout.session.completed missing firebase UID', { customerId, eventId: event.id });
            return;
        }

        const subscriptionId = extractStripeId(session?.subscription);
        if (!subscriptionId) return;

        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await processSubscriptionSnapshot(uid, customerId, subscription, eventType);
        return;
    }

    if (
        eventType === 'customer.subscription.created'
        || eventType === 'customer.subscription.updated'
        || eventType === 'customer.subscription.deleted'
    ) {
        const subscription = event.data.object;
        const customerId = extractStripeId(subscription?.customer);

        let uid = String(subscription?.metadata?.firebaseUID || '').trim();
        if (!uid && customerId) {
            uid = await findUidForCustomer(customerId);
        }
        if (!uid) {
            functions.logger.warn('subscription event missing firebase UID', {
                eventType,
                customerId,
                eventId: event.id,
            });
            return;
        }

        await processSubscriptionSnapshot(uid, customerId, subscription, eventType);
    }
}

exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const webhookSecret = getStripeWebhookSecret();
    if (!webhookSecret) {
        res.status(500).json({ ok: false, error: 'Stripe webhook secret is not configured.' });
        return;
    }

    const signature = req.get('stripe-signature');
    if (!signature) {
        res.status(400).json({ ok: false, error: 'Missing stripe-signature header.' });
        return;
    }

    let event;
    try {
        event = getStripeClient().webhooks.constructEvent(req.rawBody, signature, webhookSecret);
    } catch (error) {
        functions.logger.error('Invalid Stripe webhook signature', {
            message: String(error?.message || error),
        });
        res.status(400).json({ ok: false, error: 'Invalid webhook signature.' });
        return;
    }

    try {
        await processStripeEvent(event);
        res.json({ received: true });
    } catch (error) {
        functions.logger.error('Stripe webhook processing failed', {
            eventId: String(event?.id || ''),
            eventType: String(event?.type || ''),
            message: String(error?.message || error),
        });
        res.status(500).json({ ok: false, error: 'Webhook processing failed.' });
    }
});

exports.scrydexWebhook = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    const secret = getScrydexWebhookSecret();
    if (!secret) {
        res.status(500).json({ ok: false, error: 'Scrydex webhook secret is not configured.' });
        return;
    }

    const signatureHeader = String(req.get('x-scrydex-signature') || '').trim();
    if (!signatureHeader) {
        res.status(400).json({ ok: false, error: 'Missing X-Scrydex-Signature header.' });
        return;
    }

    const rawBody = Buffer.isBuffer(req.rawBody)
        ? req.rawBody
        : Buffer.from(String(req.rawBody || ''), 'utf8');

    const verified = verifyScrydexWebhookSignature(rawBody, signatureHeader, secret);
    if (!verified.ok) {
        functions.logger.warn('Invalid Scrydex webhook signature', {
            message: String(verified.error || ''),
        });
        res.status(400).json({ ok: false, error: verified.error || 'Invalid webhook signature.' });
        return;
    }

    let eventPayload;
    try {
        eventPayload = req.body && typeof req.body === 'object'
            ? req.body
            : JSON.parse(rawBody.toString('utf8'));
    } catch {
        res.status(400).json({ ok: false, error: 'Invalid JSON payload.' });
        return;
    }

    const eventId = String(eventPayload?.id || '').trim();
    const eventName = String(eventPayload?.name || '').trim();
    const expansionIds = Array.isArray(eventPayload?.data?.expansion_ids)
        ? eventPayload.data.expansion_ids.map((x) => String(x || '').trim()).filter(Boolean)
        : [];

    if (!eventId || !eventName) {
        res.status(400).json({ ok: false, error: 'Missing event id or name.' });
        return;
    }

    try {
        const inserted = await claimScrydexEvent(eventId, eventName, expansionIds);
        if (!inserted) {
            res.status(200).json({ ok: true, duplicate: true, eventId, eventName });
            return;
        }

        let dirtyResult = {
            updatedExpansionCount: 0,
            updatedGlobal: false,
            upstashEnabled: Boolean(getUpstashRestUrl() && getUpstashRestToken()),
        };
        const isPriceEvent = SCRYDEX_PRICE_WEBHOOK_EVENTS.has(eventName);
        if (isPriceEvent) {
            dirtyResult = await markScrydexDirtyVersions(expansionIds);
        }

        res.status(200).json({
            ok: true,
            eventId,
            eventName,
            isPriceEvent,
            expansionCount: expansionIds.length,
            dirtyResult,
        });
    } catch (error) {
        functions.logger.error('Scrydex webhook processing failed', {
            eventId,
            eventName,
            message: String(error?.message || error),
        });
        res.status(500).json({ ok: false, error: 'Webhook processing failed.' });
    }
});

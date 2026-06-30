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

function getScannerVisionApiKey() {
    return configValue('SCANNER_VISION_API_KEY', ['scanner', 'vision_api_key'], '');
}

function getScannerVisionModel() {
    return configValue('SCANNER_VISION_MODEL', ['scanner', 'vision_model'], 'gpt-4o-mini');
}

function isScannerVisionEnabled() {
    const raw = configValue('ENABLE_SCANNER_VISION', ['scanner', 'enable_vision'], 'false');
    const normalized = String(raw || '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function getCardCatalogHydrationSecret() {
    return configValue('CARD_CATALOG_HYDRATION_SECRET', ['card_catalog', 'hydration_secret'], '');
}

function isCardCatalogHydrationEnabled() {
    const raw = configValue('CARD_CATALOG_HYDRATION_ENABLED', ['card_catalog', 'hydration_enabled'], 'false');
    const normalized = String(raw || '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function getCardCatalogHydrationMaxCards() {
    const raw = Number(configValue('CARD_CATALOG_HYDRATION_MAX_CARDS', ['card_catalog', 'hydration_max_cards'], '25'));
    return Number.isFinite(raw) && raw > 0 ? Math.min(50, Math.floor(raw)) : 25;
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

function isAllowedScannerOrigin(origin) {
    if (!origin) return false;
    if (isAllowedReturnOrigin(origin)) return true;
    return isLocalOrigin(origin);
}

function applyScannerCors(req, res) {
    const requestOrigin = String(req.get('origin') || '').trim();
    const fallbackOrigin = getAppBaseUrl();
    const allowOrigin = isAllowedScannerOrigin(requestOrigin)
        ? requestOrigin
        : fallbackOrigin;

    if (allowOrigin) {
        res.set('Access-Control-Allow-Origin', allowOrigin);
        res.set('Vary', 'Origin');
    }
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
}

function parseImageDataUrl(raw) {
    const value = String(raw || '').trim();
    const match = value.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i);
    if (!match) return null;

    const mime = String(match[1] || '').toLowerCase();
    const b64 = String(match[2] || '').replace(/\s+/g, '');
    if (!b64) return null;

    let buffer;
    try {
        buffer = Buffer.from(b64, 'base64');
    } catch {
        return null;
    }

    if (!buffer || !buffer.length) return null;

    return {
        mime,
        base64: b64,
        buffer,
        dataUrl: `data:${mime};base64,${b64}`,
    };
}

function stripCodeFences(raw) {
    const text = String(raw || '').trim();
    const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced && fenced[1]) return fenced[1].trim();
    return text;
}

function parseVisionResponseJson(raw) {
    const text = stripCodeFences(raw);
    if (!text) return null;

    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function normalizeVisionOutput(payload) {
    const name = String(payload?.name || payload?.cardName || '').trim();
    const collectorNumber = String(payload?.collectorNumber || payload?.cardNumber || '').trim().toUpperCase();
    const confidenceRaw = Number(payload?.confidence);
    const confidence = Number.isFinite(confidenceRaw)
        ? Math.max(0, Math.min(1, confidenceRaw))
        : null;

    return {
        name: name.slice(0, 80),
        collectorNumber: collectorNumber.slice(0, 24),
        confidence,
    };
}

async function callScannerVisionModel(imageDataUrl) {
    const apiKey = getScannerVisionApiKey();
    if (!apiKey) {
        throw new Error('SCANNER_VISION_API_KEY is not configured.');
    }

    const model = getScannerVisionModel();

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 180,
            messages: [
                {
                    role: 'system',
                    content: 'Extract Pokemon card details from the image. Return only valid JSON with keys: name (string), collectorNumber (string), confidence (number 0-1). If unknown, use empty string and low confidence.'
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: 'Read the card name and collector number exactly as printed. Return JSON only.'
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: imageDataUrl
                            }
                        }
                    ]
                }
            ]
        }),
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Vision model request failed (${response.status}): ${errText || 'unknown error'}`);
    }

    const json = await response.json();
    const content = String(json?.choices?.[0]?.message?.content || '').trim();
    const parsed = parseVisionResponseJson(content);

    if (!parsed) {
        throw new Error('Vision model response was not valid JSON.');
    }

    return normalizeVisionOutput(parsed);
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

function normalizeCatalogText(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[’']/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeCatalogNumberKey(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[OQD]/g, '0')
        .replace(/[IL|!]/g, '1')
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function normalizeCatalogCardDoc(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const id = String(raw.id || '').trim();
    if (!/^[a-z0-9][a-z0-9._:-]{1,120}$/i.test(id)) {
        return null;
    }

    const name = String(raw.name || '').trim().slice(0, 120);
    const number = String(raw.number || raw.printedNumber || raw.collectorNumber || '').trim().slice(0, 32);
    const setId = String(raw.setId || raw.expansionId || '').trim().slice(0, 80);
    const setName = String(raw.setName || raw.expansionName || '').trim().slice(0, 120);
    const series = String(raw.series || '').trim().slice(0, 80);
    const rarity = String(raw.rarity || '').trim().slice(0, 80);
    const imageSmall = String(raw.imageSmall || '').trim().slice(0, 500);
    const imageLarge = String(raw.imageLarge || raw.imageSmall || '').trim().slice(0, 500);

    if (!name && !number) {
        return null;
    }

    const normalizedName = normalizeCatalogText(name);

    return {
        id,
        name,
        normalizedName,
        nameTokens: normalizedName.split(/\s+/).filter(Boolean).slice(0, 10),
        number,
        numberKey: normalizeCatalogNumberKey(number),
        printedNumber: String(raw.printedNumber || number).trim().slice(0, 32),
        collectorNumber: String(raw.collectorNumber || number).trim().slice(0, 32),
        setId,
        setName,
        series,
        rarity,
        imageSmall,
        imageLarge,
        source: 'scrydex-worker',
        updatedAt: FieldValue.serverTimestamp(),
    };
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

exports.scanCard = functions.https.onRequest(async (req, res) => {
    applyScannerCors(req, res);

    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ ok: false, error: 'Method Not Allowed' });
        return;
    }

    if (!isScannerVisionEnabled()) {
        res.status(503).json({ ok: false, error: 'Scanner vision endpoint is disabled.' });
        return;
    }

    const parsed = parseImageDataUrl(req.body?.imageDataUrl);

    if (!parsed) {
        res.status(400).json({ ok: false, error: 'Invalid imageDataUrl payload.' });
        return;
    }

    if (parsed.buffer.length > 2_500_000) {
        res.status(413).json({ ok: false, error: 'Image payload too large.' });
        return;
    }

    try {
        const result = await callScannerVisionModel(parsed.dataUrl);
        res.status(200).json({
            ok: true,
            name: result.name,
            collectorNumber: result.collectorNumber,
            confidence: result.confidence,
        });
    } catch (error) {
        functions.logger.error('scanCard failed', {
            message: String(error?.message || error),
        });

        const message = String(error?.message || 'Vision extraction failed.');
        const status = message.includes('not configured') ? 503 : 502;
        res.status(status).json({ ok: false, error: message });
    }
});

exports.hydrateCardCatalog = functions.https.onRequest(async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, X-PV-Catalog-Secret');
        res.status(204).send('');
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ ok: false, error: 'Method Not Allowed' });
        return;
    }

    if (!isCardCatalogHydrationEnabled()) {
        res.status(503).json({ ok: false, error: 'Card catalog hydration is disabled.' });
        return;
    }

    const expectedSecret = getCardCatalogHydrationSecret();
    const providedSecret = String(req.get('x-pv-catalog-secret') || '').trim();

    if (!expectedSecret || !providedSecret || !timingSafeStringEquals(providedSecret, expectedSecret)) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
    }

    const rawCards = Array.isArray(req.body?.cards) ? req.body.cards : [];
    const maxCards = getCardCatalogHydrationMaxCards();

    const docs = rawCards
        .slice(0, maxCards)
        .map(normalizeCatalogCardDoc)
        .filter(Boolean);

    if (!docs.length) {
        res.status(200).json({ ok: true, attempted: 0, saved: 0, ids: [] });
        return;
    }

    try {
        const db = admin.firestore();
        const refs = docs.map((doc) => db.collection('cardCatalog').doc(doc.id));
        const snaps = await db.getAll(...refs);

        const batch = db.batch();
        const ids = [];

        docs.forEach((doc, index) => {
            const ref = refs[index];
            const snap = snaps[index];

            const payload = {
                ...doc,
                updatedAt: FieldValue.serverTimestamp(),
            };

            if (!snap.exists) {
                payload.firstSeenAt = FieldValue.serverTimestamp();
            }

            batch.set(ref, payload, { merge: true });
            ids.push(doc.id);
        });

        await batch.commit();

        functions.logger.info('hydrateCardCatalog saved', {
            attempted: docs.length,
            saved: docs.length,
            newDocs: docs.filter((_, i) => !snaps[i].exists).length,
            updatedDocs: docs.filter((_, i) => snaps[i].exists).length,
            ids,
        });

        res.status(200).json({
            ok: true,
            attempted: docs.length,
            saved: docs.length,
            ids,
        });
    } catch (error) {
        functions.logger.error('hydrateCardCatalog failed', {
            message: String(error?.message || error),
        });

        res.status(500).json({
            ok: false,
            error: 'Could not hydrate card catalog.',
        });
    }
});

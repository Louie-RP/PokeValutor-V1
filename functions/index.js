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

function getCardCatalogCandidatesSecret() {
    return configValue(
        'CARD_CATALOG_CANDIDATES_SECRET',
        ['card_catalog', 'candidates_secret'],
        getCardCatalogHydrationSecret()
    );
}

function isCardCatalogCandidatesEnabled() {
    const raw = configValue('CARD_CATALOG_CANDIDATES_ENABLED', ['card_catalog', 'candidates_enabled'], 'false');
    const normalized = String(raw || '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function getCardCatalogCandidatesMaxResults() {
    const raw = Number(configValue('CARD_CATALOG_CANDIDATES_MAX_RESULTS', ['card_catalog', 'candidates_max_results'], '12'));
    return Number.isFinite(raw) && raw > 0 ? Math.min(25, Math.floor(raw)) : 12;
}

function getScannerNameSuggestionsSecret() {
    return configValue(
        'SCANNER_NAME_SUGGESTIONS_SECRET',
        ['scanner', 'name_suggestions_secret'],
        getCardCatalogCandidatesSecret()
    );
}

function isScannerNameSuggestionsEnabled() {
    const raw = configValue('SCANNER_NAME_SUGGESTIONS_ENABLED', ['scanner', 'name_suggestions_enabled'], 'false');
    const normalized = String(raw || '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function getScannerNameSuggestionsMaxResults() {
    const raw = Number(configValue('SCANNER_NAME_SUGGESTIONS_MAX_RESULTS', ['scanner', 'name_suggestions_max_results'], '5'));
    return Number.isFinite(raw) && raw > 0 ? Math.min(10, Math.floor(raw)) : 5;
}

function getScannerNameSuggestionsMinScore() {
    const raw = Number(configValue('SCANNER_NAME_SUGGESTIONS_MIN_SCORE', ['scanner', 'name_suggestions_min_score'], '0.70'));
    return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.70;
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

function normalizeCatalogCollectorNumberWithPrintedTotal(rawNumber, printedTotal) {
    const number = String(rawNumber || '').trim().toUpperCase();
    const totalRaw = String(printedTotal || '').trim();

    if (!number) return '';
    if (number.indexOf('/') >= 0) return number;
    if (!/^\d{1,3}$/.test(number)) return number;
    if (!/^\d{2,3}$/.test(totalRaw)) return number;

    const left = String(Number(number));
    const right = String(Number(totalRaw));
    if (!left || !right) return number;

    const width = Math.max(2, totalRaw.length, right.length);
    return `${left.padStart(width, '0')}/${right.padStart(width, '0')}`;
}

function normalizeCatalogCardDoc(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const id = String(raw.id || '').trim();
    if (!/^[a-z0-9][a-z0-9._:-]{1,120}$/i.test(id)) {
        return null;
    }

    const name = String(raw.name || '').trim().slice(0, 120);
    const rawNumber = String(raw.printedNumber || raw.collectorNumber || raw.number || '').trim().slice(0, 32);
    const setId = String(raw.setId || raw.expansionId || '').trim().slice(0, 80);
    const setName = String(raw.setName || raw.expansionName || '').trim().slice(0, 120);
    const series = String(raw.series || '').trim().slice(0, 80);
    const rarity = String(raw.rarity || '').trim().slice(0, 80);
    const imageSmall = String(raw.imageSmall || '').trim().slice(0, 500);
    const imageLarge = String(raw.imageLarge || raw.imageSmall || '').trim().slice(0, 500);

    // Extract printed total from set metadata for full collector number reconstruction
    const expansion = raw.expansion && typeof raw.expansion === 'object' ? raw.expansion : {};
    const set = raw.set && typeof raw.set === 'object' ? raw.set : {};
    const printedTotal = String(
        expansion?.printed_total
        || expansion?.printedTotal
        || expansion?.total
        || set?.printed_total
        || set?.printedTotal
        || set?.total
        || ''
    ).trim();

    const number = normalizeCatalogCollectorNumberWithPrintedTotal(rawNumber, printedTotal).slice(0, 32);
    const printedNumber = normalizeCatalogCollectorNumberWithPrintedTotal(
        String(raw.printedNumber || raw.collectorNumber || rawNumber).trim(),
        printedTotal
    ).slice(0, 32);
    const collectorNumber = normalizeCatalogCollectorNumberWithPrintedTotal(
        String(raw.collectorNumber || raw.printedNumber || rawNumber).trim(),
        printedTotal
    ).slice(0, 32);

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
        printedNumber,
        collectorNumber,
        setId,
        setName,
        series,
        rarity,
        imageSmall,
        imageLarge,
        printedTotal,
        source: 'scrydex-worker',
        updatedAt: FieldValue.serverTimestamp(),
    };
}

function getScannerNameIndexDocId(normalizedName) {
    return String(normalizedName || '')
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);
}

function buildScannerNameTrigrams(value) {
    const compact = normalizeCatalogText(value).replace(/\s+/g, '');
    const grams = [];

    for (let i = 0; i <= compact.length - 3; i += 1) {
        const gram = compact.slice(i, i + 3);
        if (/^[a-z0-9]{3}$/.test(gram) && grams.indexOf(gram) < 0) grams.push(gram);
    }

    return grams.slice(0, 40);
}

function buildScannerNameIndexEntryFromCatalogDoc(doc) {
    if (!doc || typeof doc !== 'object') return null;

    const displayName = String(doc.name || '').trim().slice(0, 120);
    const normalizedName = normalizeCatalogText(displayName);

    if (!displayName || !normalizedName || normalizedName.length < 2) {
        return null;
    }

    const tokens = normalizedName.split(/\s+/).filter(Boolean).slice(0, 8);
    const compact = normalizedName.replace(/\s+/g, '');

    return {
        docId: getScannerNameIndexDocId(normalizedName),
        displayName,
        normalizedName,
        tokens,
        firstLetter: compact.slice(0, 1),
        prefix2: compact.slice(0, 2),
        prefix3: compact.slice(0, 3),
        grams3: buildScannerNameTrigrams(normalizedName),
        cardId: String(doc.id || '').trim(),
    };
}

function buildScannerNameIndexEntries(docs) {
    const byName = new Map();

    for (const doc of Array.isArray(docs) ? docs : []) {
        const entry = buildScannerNameIndexEntryFromCatalogDoc(doc);
        if (!entry || !entry.docId) continue;

        const existing = byName.get(entry.docId);
        if (!existing) {
            byName.set(entry.docId, {
                ...entry,
                cardIds: entry.cardId ? [entry.cardId] : [],
                cardCountDelta: 1,
            });
            continue;
        }

        if (entry.cardId && existing.cardIds.indexOf(entry.cardId) < 0 && existing.cardIds.length < 20) {
            existing.cardIds.push(entry.cardId);
        }
        existing.cardCountDelta += 1;
    }

    return Array.from(byName.values());
}

function addScannerNameIndexWritesToBatch(batch, db, docs) {
    const entries = buildScannerNameIndexEntries(docs);
    const collection = db.collection('scannerNameIndex');

    for (const entry of entries) {
        const ref = collection.doc(entry.docId);

        batch.set(ref, {
            displayName: entry.displayName,
            normalizedName: entry.normalizedName,
            tokens: entry.tokens,
            firstLetter: entry.firstLetter,
            prefix2: entry.prefix2,
            prefix3: entry.prefix3,
            grams3: entry.grams3,
            exampleCardIds: FieldValue.arrayUnion(...entry.cardIds.slice(0, 10)),
            cardCount: FieldValue.increment(entry.cardCountDelta),
            source: 'cardCatalog',
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
    }
}

function compactScannerName(value) {
    return normalizeCatalogText(value).replace(/\s+/g, '');
}

function levenshteinDistance(a, b) {
    const left = String(a || '');
    const right = String(b || '');

    if (left === right) return 0;
    if (!left) return right.length;
    if (!right) return left.length;

    const prev = new Array(right.length + 1);
    const cur = new Array(right.length + 1);

    for (let j = 0; j <= right.length; j += 1) prev[j] = j;

    for (let i = 1; i <= left.length; i += 1) {
        cur[0] = i;
        for (let j = 1; j <= right.length; j += 1) {
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        }

        for (let j = 0; j <= right.length; j += 1) prev[j] = cur[j];
    }

    return prev[right.length];
}

function bigrams(value) {
    const text = compactScannerName(value);
    const out = [];

    if (text.length < 2) {
        if (text) out.push(text);
        return out;
    }

    for (let i = 0; i < text.length - 1; i += 1) out.push(text.slice(i, i + 2));
    return out;
}

function diceSimilarity(a, b) {
    const left = bigrams(a);
    const right = bigrams(b);
    if (!left.length || !right.length) return 0;

    const counts = new Map();
    for (const item of left) counts.set(item, (counts.get(item) || 0) + 1);

    let overlap = 0;
    for (const item of right) {
        const count = counts.get(item) || 0;
        if (count > 0) {
            overlap += 1;
            counts.set(item, count - 1);
        }
    }

    return (2 * overlap) / (left.length + right.length);
}

function normalizedEditSimilarity(a, b) {
    const left = compactScannerName(a);
    const right = compactScannerName(b);
    if (!left || !right) return 0;
    if (left === right) return 1;

    const distance = levenshteinDistance(left, right);
    return Math.max(0, 1 - (distance / Math.max(left.length, right.length)));
}

function scoreScannerNameSuggestion(inputText, candidate) {
    const input = compactScannerName(inputText);
    const name = compactScannerName(candidate?.displayName || candidate?.normalizedName || '');
    if (!input || !name) return 0;
    if (input === name) return 1;

    const editDistance = levenshteinDistance(input, name);
    const edit = Math.max(0, 1 - (editDistance / Math.max(input.length, name.length)));
    const dice = diceSimilarity(input, name);
    let score = (edit * 0.65) + (dice * 0.35);

    // A single missing, extra, or incorrect OCR character in a substantial name
    // is safe to treat as a high-confidence correction.
    if (editDistance === 1 && Math.min(input.length, name.length) >= 5) {
        score = Math.max(score, 0.92);
    }

    // Long OCR names commonly contain two independent defects (for example,
    // one substituted letter plus a trailing artifact). At this length a
    // two-edit catalog match is still strong evidence and should clear the
    // scanner's auto-correction threshold without maintaining per-card aliases.
    if (editDistance === 2 && Math.min(input.length, name.length) >= 8) {
        score = Math.max(score, 0.89);
    }

    const isPrefixMatch = name.startsWith(input) || input.startsWith(name);
    const prefixLengthDelta = Math.abs(name.length - input.length);

    // Header OCR commonly clips the last one or two letters while preserving a
    // long, exact prefix (for example, Charmand -> Charmander). This is much
    // stronger evidence than a generic short prefix.
    if (isPrefixMatch && Math.min(input.length, name.length) >= 6 && prefixLengthDelta <= 2) {
        score = Math.max(score, 0.91);
    } else if (isPrefixMatch) {
        score = Math.max(score, 0.82);
    }
    return Math.max(0, Math.min(1, score));
}

function nameIndexDocToSuggestion(inputText, doc) {
    const data = doc && typeof doc.data === 'function' ? doc.data() : doc;
    if (!data || typeof data !== 'object') return null;

    const name = String(data.displayName || '').trim();
    const normalizedName = String(data.normalizedName || normalizeCatalogText(name)).trim();
    if (!name || !normalizedName) return null;

    const score = scoreScannerNameSuggestion(inputText, data);
    const matchedBy = [];
    const compactInput = compactScannerName(inputText);

    if (compactInput === compactScannerName(name)) matchedBy.push('exact');
    if (compactInput.slice(0, 3) && compactInput.slice(0, 3) === String(data.prefix3 || '')) matchedBy.push('prefix3');
    if (compactInput.slice(0, 2) && compactInput.slice(0, 2) === String(data.prefix2 || '')) matchedBy.push('prefix2');
    const inputGrams = buildScannerNameTrigrams(inputText);
    const candidateGrams = new Set(Array.isArray(data.grams3) ? data.grams3 : []);
    if (inputGrams.some((gram) => candidateGrams.has(gram))) matchedBy.push('trigram');
    matchedBy.push('fuzzy');

    return {
        name,
        normalizedName,
        score,
        source: 'scannerNameIndex',
        matchedBy: Array.from(new Set(matchedBy)),
        exampleCardIds: Array.isArray(data.exampleCardIds) ? data.exampleCardIds.slice(0, 5) : [],
    };
}

async function findScannerNameSuggestions(inputText, limit) {
    const text = String(inputText || '').trim().slice(0, 120);
    const normalized = normalizeCatalogText(text);
    const compact = compactScannerName(text);
    if (compact.length < 2) return [];

    const db = admin.firestore();
    const collection = db.collection('scannerNameIndex');
    const tasks = [];
    const exactDocId = getScannerNameIndexDocId(normalized);

    if (exactDocId) {
        tasks.push(collection.doc(exactDocId).get().then((doc) => ({ docs: doc.exists ? [doc] : [] })));
    }
    if (compact.length >= 3) tasks.push(collection.where('prefix3', '==', compact.slice(0, 3)).limit(80).get());
    if (compact.length >= 2) tasks.push(collection.where('prefix2', '==', compact.slice(0, 2)).limit(120).get());

    const firstLetter = compact.slice(0, 1);
    if (firstLetter) tasks.push(collection.where('firstLetter', '==', firstLetter).limit(200).get());

    const token = normalized.split(/\s+/).filter(Boolean)[0] || '';
    if (token && token.length >= 3) tasks.push(collection.where('tokens', 'array-contains', token).limit(80).get());

    // Prefix OCR is often the least reliable part of a foil card name. Query
    // several spaced internal fragments so a reading such as "Cowscarada" can
    // still retrieve "Meowscarada" through their shared middle/end sequence.
    const grams = buildScannerNameTrigrams(compact);
    const gramIndexes = grams.length <= 4
        ? grams.map((_, index) => index)
        : [1, Math.floor(grams.length / 3), Math.floor((grams.length * 2) / 3), grams.length - 2];
    for (const index of Array.from(new Set(gramIndexes))) {
        const gram = grams[index];
        if (gram) tasks.push(collection.where('grams3', 'array-contains', gram).limit(120).get());
    }

    const snapshots = await Promise.all(tasks);
    const byName = new Map();

    for (const snap of snapshots) {
        for (const doc of snap.docs || []) {
            const suggestion = nameIndexDocToSuggestion(text, doc);
            if (!suggestion) continue;

            const prev = byName.get(suggestion.normalizedName);
            if (!prev || suggestion.score > prev.score) byName.set(suggestion.normalizedName, suggestion);
        }
    }

    const minScore = getScannerNameSuggestionsMinScore();
    return Array.from(byName.values())
        .filter((item) => Number(item.score || 0) >= minScore)
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
        .slice(0, limit);
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

function normalizeScannerCandidateInput(raw) {
    const name = String(raw?.name || raw?.cardName || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    const number = String(raw?.number || raw?.collectorNumber || raw?.cardNumber || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 32);
    const numberKey = normalizeCatalogNumberKey(raw?.numberKey || number);
    const setId = String(raw?.setId || raw?.expansionId || '').trim().toLowerCase().slice(0, 80);
    const rawLimit = Number(raw?.limit || getCardCatalogCandidatesMaxResults());
    const limit = Math.max(1, Math.min(getCardCatalogCandidatesMaxResults(), Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 12));

    return {
        name,
        normalizedName: normalizeCatalogText(name),
        nameTokens: normalizeCatalogText(name).split(/\s+/).filter(Boolean).slice(0, 5),
        number,
        numberKey,
        setId,
        limit,
    };
}

function numberForCandidateCompare(value) {
    return normalizeCatalogNumberKey(value);
}

function catalogNumberNumerator(value) {
    const normalized = String(value || '').trim().toUpperCase();
    const match = normalized.match(/^(?:[A-Z]{0,4})?0*(\d{1,3})(?:\s*\/|$)/);
    return match && match[1] ? String(Number(match[1])) : '';
}

function scoreNameCandidate(inputName, cardName) {
    const input = normalizeCatalogText(inputName);
    const card = normalizeCatalogText(cardName);

    if (!input || !card) return 0;
    if (input === card) return 25;
    if (card.includes(input) || input.includes(card)) return 18;

    const inputTokens = input.split(/\s+/).filter(Boolean);
    const cardTokens = new Set(card.split(/\s+/).filter(Boolean));
    if (!inputTokens.length || !cardTokens.size) return 0;

    let overlap = 0;
    for (const token of inputTokens) {
        if (cardTokens.has(token)) overlap += 1;
    }

    return Math.round((overlap / Math.max(inputTokens.length, cardTokens.size)) * 12);
}

function scoreCatalogCandidate(input, doc) {
    let score = 0;
    const matchedBy = [];

    const resolvedNumber = normalizeCatalogCollectorNumberWithPrintedTotal(
        doc?.number || doc?.printedNumber || doc?.collectorNumber || '',
        doc?.printedTotal || doc?.total || ''
    );
    const cardNumberKey = numberForCandidateCompare(resolvedNumber || doc?.numberKey || doc?.number || doc?.printedNumber || doc?.collectorNumber || '');
    let numberMatched = false;
    if (input.numberKey && cardNumberKey && input.numberKey === cardNumberKey) {
        score += 55;
        matchedBy.push('numberKey');
        numberMatched = true;
    } else if (
        input.number
        && /^\d{1,3}$/.test(input.number)
        && catalogNumberNumerator(input.number) === catalogNumberNumerator(resolvedNumber)
    ) {
        // OCR often reads only the printed numerator (for example 256 rather
        // than 256/193). Treat that as useful but weaker number evidence.
        score += 35;
        matchedBy.push('numberNumerator');
        numberMatched = true;
    }

    const nameScore = scoreNameCandidate(input.name, doc?.name || '');
    if (nameScore > 0) {
        score += nameScore;
        matchedBy.push(nameScore >= 25 ? 'normalizedName' : 'namePartial');
    } else if (input.name && numberMatched) {
        // When both signals were supplied, an unrelated name must not outrank
        // a same-name card merely because many sets reuse collector number 256.
        score -= 25;
        matchedBy.push('nameMismatch');
    }

    const cardSetId = String(doc?.setId || '').trim().toLowerCase();
    if (input.setId && cardSetId && input.setId === cardSetId) {
        score += 15;
        matchedBy.push('setId');
    }

    if (doc?.imageLarge || doc?.imageSmall) {
        score += 5;
        matchedBy.push('imageUrl');
    }

    return {
        score: Math.max(0, Math.min(100, score)),
        matchedBy,
    };
}

function cardCatalogDocToScannerCandidate(doc, input) {
    const data = doc && typeof doc.data === 'function' ? doc.data() : doc;
    if (!data || typeof data !== 'object') return null;

    const id = String(data.id || doc?.id || '').trim();
    if (!id) return null;

    const scored = scoreCatalogCandidate(input, data);
    if (scored.score <= 0) return null;

    const setId = String(data.setId || '').trim();
    const setName = String(data.setName || '').trim();
    const series = String(data.series || '').trim();
    const printedTotal = String(data.printedTotal || '').trim();
    const number = normalizeCatalogCollectorNumberWithPrintedTotal(
        String(data.printedNumber || data.collectorNumber || data.number || '').trim(),
        printedTotal
    );
    const printedNumber = normalizeCatalogCollectorNumberWithPrintedTotal(
        String(data.printedNumber || data.collectorNumber || data.number || '').trim(),
        printedTotal
    );
    const collectorNumber = normalizeCatalogCollectorNumberWithPrintedTotal(
        String(data.collectorNumber || data.printedNumber || data.number || '').trim(),
        printedTotal
    );
    const imageSmall = String(data.imageSmall || '').trim();
    const imageLarge = String(data.imageLarge || imageSmall || '').trim();

    return {
        id,
        name: String(data.name || '').trim(),
        number: number || String(data.number || '').trim(),
        printedNumber: printedNumber || number || String(data.printedNumber || data.number || '').trim(),
        collectorNumber: collectorNumber || number || String(data.collectorNumber || data.number || '').trim(),
        rarity: String(data.rarity || '').trim(),
        setId,
        setName,
        series,
        imageSmall,
        imageLarge,
        expansion: {
            id: setId,
            name: setName,
            series,
            printedTotal: printedTotal || undefined,
        },
        set: {
            id: setId,
            name: setName,
            series,
            printedTotal: printedTotal || undefined,
        },
        images: {
            small: imageSmall,
            medium: imageLarge || imageSmall,
            large: imageLarge || imageSmall,
        },
        _candidate: {
            source: 'firestore-cardCatalog',
            score: scored.score,
            matchedBy: scored.matchedBy,
        },
    };
}

function mergeAndSortCatalogCandidates(input, snapshots) {
    const byId = new Map();

    for (const snap of snapshots) {
        for (const doc of snap.docs || []) {
            const candidate = cardCatalogDocToScannerCandidate(doc, input);
            if (!candidate?.id) continue;

            const prev = byId.get(candidate.id);
            if (!prev || Number(candidate._candidate?.score || 0) > Number(prev._candidate?.score || 0)) {
                byId.set(candidate.id, candidate);
            }
        }
    }

    const out = Array.from(byId.values())
        .sort((a, b) => {
            const scoreDiff = Number(b._candidate?.score || 0) - Number(a._candidate?.score || 0);
            if (scoreDiff) return scoreDiff;

            const setA = String(a.setId || '');
            const setB = String(b.setId || '');
            if (input.setId && setA === input.setId && setB !== input.setId) return -1;
            if (input.setId && setB === input.setId && setA !== input.setId) return 1;

            return String(a.name || '').localeCompare(String(b.name || ''));
        })
        .slice(0, input.limit);

    return out;
}

async function findScannerCatalogCandidates(input) {
    const db = admin.firestore();
    const collection = db.collection('cardCatalog');
    const tasks = [];

    if (input.numberKey) {
        tasks.push(collection.where('numberKey', '==', input.numberKey).limit(60).get());
    }

    if (input.normalizedName) {
        tasks.push(collection.where('normalizedName', '==', input.normalizedName).limit(40).get());
    }

    const firstToken = input.nameTokens[0] || '';
    if (firstToken) {
        tasks.push(collection.where('nameTokens', 'array-contains', firstToken).limit(60).get());
    }

    if (!tasks.length) {
        return [];
    }

    const snapshots = await Promise.all(tasks);
    return mergeAndSortCatalogCandidates(input, snapshots);
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

        addScannerNameIndexWritesToBatch(batch, db, docs);

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

exports.scannerNameSuggestions = functions.https.onRequest(async (req, res) => {
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

    if (!isScannerNameSuggestionsEnabled()) {
        res.status(200).json({
            ok: true,
            enabled: false,
            source: 'scannerNameIndex',
            data: [],
        });
        return;
    }

    const expectedSecret = getScannerNameSuggestionsSecret();
    const providedSecret = String(req.get('x-pv-catalog-secret') || '').trim();

    if (!expectedSecret || !providedSecret || !timingSafeStringEquals(providedSecret, expectedSecret)) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
    }

    const text = String(req.body?.text || req.body?.name || '').trim().slice(0, 120);
    const rawLimit = Number(req.body?.limit || getScannerNameSuggestionsMaxResults());
    const limit = Math.max(1, Math.min(
        getScannerNameSuggestionsMaxResults(),
        Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 5
    ));

    if (!text || compactScannerName(text).length < 2) {
        res.status(200).json({
            ok: true,
            enabled: true,
            source: 'scannerNameIndex',
            data: [],
        });
        return;
    }

    try {
        const data = await findScannerNameSuggestions(text, limit);

        res.status(200).json({
            ok: true,
            enabled: true,
            source: 'scannerNameIndex',
            count: data.length,
            data,
            input: { text, limit },
        });
    } catch (error) {
        functions.logger.error('scannerNameSuggestions failed', {
            message: String(error?.message || error),
        });

        res.status(500).json({
            ok: false,
            error: 'Could not load scanner name suggestions.',
        });
    }
});

exports.scannerCandidates = functions.https.onRequest(async (req, res) => {
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

    if (!isCardCatalogCandidatesEnabled()) {
        res.status(200).json({
            ok: true,
            enabled: false,
            source: 'firestore-cardCatalog',
            data: [],
        });
        return;
    }

    const expectedSecret = getCardCatalogCandidatesSecret();
    const providedSecret = String(req.get('x-pv-catalog-secret') || '').trim();

    if (!expectedSecret || !providedSecret || !timingSafeStringEquals(providedSecret, expectedSecret)) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
    }

    const input = normalizeScannerCandidateInput(req.body || {});

    if (!input.name && !input.numberKey) {
        res.status(400).json({
            ok: false,
            error: 'Missing scanner candidate input. Provide name or number.',
        });
        return;
    }

    try {
        const data = await findScannerCatalogCandidates(input);

        res.status(200).json({
            ok: true,
            enabled: true,
            source: 'firestore-cardCatalog',
            count: data.length,
            data,
            input: {
                name: input.name,
                number: input.number,
                numberKey: input.numberKey,
                setId: input.setId,
                limit: input.limit,
            },
        });
    } catch (error) {
        functions.logger.error('scannerCandidates failed', {
            message: String(error?.message || error),
        });

        res.status(500).json({
            ok: false,
            error: 'Could not load scanner candidates.',
        });
    }
});


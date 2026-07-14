# Worker Patch: /scanner/name-suggestions

Add this to your current Cloudflare Worker.

This endpoint should not call Scrydex and should not consume search quota.

## 1. Add optional vars to the Worker comment block

```js
// Optional scanner name correction:
// - SCANNER_NAME_SUGGESTIONS_ENABLED (default: 0)
// - SCANNER_NAME_SUGGESTIONS_URL
// - SCANNER_NAME_SUGGESTIONS_SECRET
// - SCANNER_NAME_SUGGESTIONS_TTL_SECONDS (default: 604800 = 7 days)
// - SCANNER_NAME_SUGGESTIONS_MAX_RESULTS (default: 5)
// - SCANNER_NAME_SUGGESTIONS_TIMEOUT_MS (default: 1200)
```

## 2. Add Worker helpers near your scanner candidate/catalog helpers

```js
function isScannerNameSuggestionsEnabled(env) {
    const raw = String(env?.SCANNER_NAME_SUGGESTIONS_ENABLED || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function getScannerNameSuggestionsMaxResults(env) {
    return getEnvInt(env, 'SCANNER_NAME_SUGGESTIONS_MAX_RESULTS', 5);
}

function getScannerNameSuggestionsTtlSeconds(env) {
    return getEnvInt(env, 'SCANNER_NAME_SUGGESTIONS_TTL_SECONDS', 7 * 24 * 60 * 60);
}

function getScannerNameSuggestionsTimeoutMs(env) {
    return getEnvInt(env, 'SCANNER_NAME_SUGGESTIONS_TIMEOUT_MS', 1200);
}

function getScannerNameSuggestionsSecret(env) {
    return String(
        env?.SCANNER_NAME_SUGGESTIONS_SECRET
        || env?.CARD_CATALOG_CANDIDATES_SECRET
        || env?.CARD_CATALOG_HYDRATION_SECRET
        || ''
    ).trim();
}

function normalizeScannerSuggestionText(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 120);
}

async function fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), Math.max(300, Number(timeoutMs || 1200)));

    try {
        return await fetch(url, {
            ...(init || {}),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }
}

async function handleScannerNameSuggestions(request, env, allowOrigin) {
    if (!isScannerNameSuggestionsEnabled(env)) {
        return jsonResponseCors({
            ok: true,
            enabled: false,
            source: 'scannerNameIndex',
            data: [],
        }, { status: 200 }, allowOrigin);
    }

    const endpoint = String(env?.SCANNER_NAME_SUGGESTIONS_URL || '').trim();
    const secret = getScannerNameSuggestionsSecret(env);

    if (!endpoint || !secret) {
        return jsonResponseCors({
            ok: true,
            enabled: false,
            source: 'scannerNameIndex',
            data: [],
            error: 'Scanner name suggestion provider is not configured.',
        }, { status: 200 }, allowOrigin);
    }

    const url = new URL(request.url);
    const text = normalizeScannerSuggestionText(url.searchParams.get('text') || url.searchParams.get('name') || '');
    const rawLimit = Number(url.searchParams.get('limit') || getScannerNameSuggestionsMaxResults(env));
    const limit = Math.max(1, Math.min(getScannerNameSuggestionsMaxResults(env), Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 5));

    if (!text || normalizeCatalogText(text).replace(/\s+/g, '').length < 2) {
        return jsonResponseCors({
            ok: true,
            enabled: true,
            source: 'scannerNameIndex',
            data: [],
        }, { status: 200 }, allowOrigin);
    }

    const ttl = getScannerNameSuggestionsTtlSeconds(env);
    const cacheSeed = JSON.stringify({
        text: normalizeCatalogText(text),
        limit,
    });

    const cacheKey = env?.UPSTASH_REDIS_REST_URL && env?.UPSTASH_REDIS_REST_TOKEN
        ? `pv:scanner:nameSuggestions:v1:${await sha256Base64Url(cacheSeed)}`
        : null;

    if (cacheKey) {
        const cached = await upstashGet(env, cacheKey);
        if (typeof cached === 'string' && cached.length) {
            const hit = new Response(cached, {
                status: 200,
                headers: {
                    'content-type': 'application/json; charset=utf-8',
                    'cache-control': `public, max-age=${ttl}`,
                },
            });
            return finalizeResponse(hit, allowOrigin, 'HIT', null);
        }
    }

    let providerResponse;
    let bodyText = '';

    try {
        providerResponse = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: {
                'content-type': 'application/json; charset=utf-8',
                'x-pv-catalog-secret': secret,
            },
            body: JSON.stringify({
                text,
                limit,
            }),
        }, getScannerNameSuggestionsTimeoutMs(env));

        bodyText = await providerResponse.text();
    } catch (error) {
        console.warn('[pv:nameSuggestions] provider request failed', error);

        return jsonResponseCors({
            ok: true,
            source: 'scannerNameIndex',
            data: [],
            fallbackRecommended: true,
            error: 'Scanner name suggestions are unavailable.',
        }, { status: 200 }, allowOrigin);
    }

    const payload = safeJsonParse(bodyText);

    if (!providerResponse.ok || !payload || payload.ok === false) {
        console.warn('[pv:nameSuggestions] provider returned error', providerResponse.status, bodyText.slice(0, 300));

        return jsonResponseCors({
            ok: true,
            source: 'scannerNameIndex',
            data: [],
            fallbackRecommended: true,
            error: payload?.error || 'Scanner name suggestions returned an error.',
        }, { status: 200 }, allowOrigin);
    }

    const outText = JSON.stringify({
        ok: true,
        source: payload.source || 'scannerNameIndex',
        count: Array.isArray(payload.data) ? payload.data.length : 0,
        data: Array.isArray(payload.data) ? payload.data : [],
        meta: {
            cacheTtlSeconds: ttl,
        },
    });

    if (cacheKey) {
        await upstashSetJson(env, cacheKey, outText, ttl).catch(() => {});
    }

    const out = new Response(outText, {
        status: 200,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': `public, max-age=${ttl}`,
        },
    });

    return finalizeResponse(out, allowOrigin, cacheKey ? 'MISS' : 'BYPASS', null);
}
```

## 3. Add route in `fetch`

Place this before your Scrydex secret check:

```js
// GET /scanner/name-suggestions?text=Charizrd&limit=5
// Uses Firestore scannerNameIndex through Firebase Function.
// Does not require Scrydex secrets and should not consume search quota.
if (parts.length === 2 && parts[0] === 'scanner' && parts[1] === 'name-suggestions') {
    return handleScannerNameSuggestions(request, env, allowOrigin);
}
```

Recommended placement:

```js
if (parts.length === 2 && parts[0] === 'scanner' && parts[1] === 'candidates') {
    return handleScannerCandidates(request, env, allowOrigin);
}

if (parts.length === 2 && parts[0] === 'scanner' && parts[1] === 'name-suggestions') {
    return handleScannerNameSuggestions(request, env, allowOrigin);
}

if (!env?.SCRYDEX_API_KEY) {
    ...
}
```

## 4. Required Worker env vars

```txt
SCANNER_NAME_SUGGESTIONS_ENABLED=1
SCANNER_NAME_SUGGESTIONS_URL=https://<region>-<project>.cloudfunctions.net/scannerNameSuggestions
SCANNER_NAME_SUGGESTIONS_SECRET=<secret>
SCANNER_NAME_SUGGESTIONS_TTL_SECONDS=604800
SCANNER_NAME_SUGGESTIONS_MAX_RESULTS=5
SCANNER_NAME_SUGGESTIONS_TIMEOUT_MS=1200
```

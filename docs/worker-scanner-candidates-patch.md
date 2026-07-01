# Worker Patch: /scanner/candidates

Add this to your current Cloudflare Worker.

## 1. Add optional vars to top comment

```js
// Optional scanner candidate lookup:
// - CARD_CATALOG_CANDIDATES_ENABLED (default: 0)
// - CARD_CATALOG_CANDIDATES_URL
// - CARD_CATALOG_CANDIDATES_SECRET (falls back to CARD_CATALOG_HYDRATION_SECRET)
// - CARD_CATALOG_CANDIDATES_TTL_SECONDS (default: 86400 = 24 hours)
// - CARD_CATALOG_CANDIDATES_MAX_RESULTS (default: 12)
```

## 2. Add these helpers near your catalog hydration helpers

```js
function isCardCatalogCandidatesEnabled(env) {
    const raw = String(env?.CARD_CATALOG_CANDIDATES_ENABLED || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function getCardCatalogCandidatesMaxResults(env) {
    return getEnvInt(env, 'CARD_CATALOG_CANDIDATES_MAX_RESULTS', 12);
}

function getCardCatalogCandidatesTtlSeconds(env) {
    return getEnvInt(env, 'CARD_CATALOG_CANDIDATES_TTL_SECONDS', 24 * 60 * 60);
}

function getCardCatalogCandidatesSecret(env) {
    return String(env?.CARD_CATALOG_CANDIDATES_SECRET || env?.CARD_CATALOG_HYDRATION_SECRET || '').trim();
}

function normalizeScannerCandidateName(value) {
    return String(value || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 120);
}

function normalizeScannerCandidateNumber(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '')
        .slice(0, 32);
}

function normalizeScannerCandidateSetId(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    if (!/^[a-z0-9._:-]{1,80}$/.test(raw)) return '';
    return raw;
}

async function handleScannerCandidates(request, env, allowOrigin) {
    if (!isCardCatalogCandidatesEnabled(env)) {
        return jsonResponseCors({
            ok: true,
            enabled: false,
            source: 'firestore-cardCatalog',
            data: [],
            message: 'Scanner catalog candidates are disabled.',
        }, { status: 200 }, allowOrigin);
    }

    const endpoint = String(env?.CARD_CATALOG_CANDIDATES_URL || '').trim();
    const secret = getCardCatalogCandidatesSecret(env);

    if (!endpoint || !secret) {
        return jsonResponseCors({
            ok: false,
            error: 'Scanner candidate provider is not configured.',
        }, { status: 503 }, allowOrigin);
    }

    const url = new URL(request.url);
    const name = normalizeScannerCandidateName(url.searchParams.get('name') || url.searchParams.get('cardName') || '');
    const number = normalizeScannerCandidateNumber(url.searchParams.get('number') || url.searchParams.get('collectorNumber') || '');
    const setId = normalizeScannerCandidateSetId(url.searchParams.get('setId') || url.searchParams.get('expansionId') || '');
    const rawLimit = Number(url.searchParams.get('limit') || getCardCatalogCandidatesMaxResults(env));
    const limit = Math.max(1, Math.min(getCardCatalogCandidatesMaxResults(env), Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 12));

    if (!name && !number) {
        return jsonResponseCors({
            ok: false,
            error: 'Missing candidate input. Provide name or number.',
        }, { status: 400 }, allowOrigin);
    }

    const ttl = getCardCatalogCandidatesTtlSeconds(env);
    const cacheSeed = JSON.stringify({
        name: normalizeCatalogText(name),
        numberKey: normalizeCatalogNumberKey(number),
        setId,
        limit,
    });
    const cacheKey = env?.UPSTASH_REDIS_REST_URL && env?.UPSTASH_REDIS_REST_TOKEN
        ? `pv:scanner:candidates:v1:${await sha256Base64Url(cacheSeed)}`
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

    let upstreamResponse;
    let bodyText = '';

    try {
        upstreamResponse = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'content-type': 'application/json; charset=utf-8',
                'x-pv-catalog-secret': secret,
            },
            body: JSON.stringify({
                name,
                number,
                numberKey: normalizeCatalogNumberKey(number),
                setId,
                limit,
            }),
        });

        bodyText = await upstreamResponse.text();
    } catch (error) {
        console.warn('[pv:scannerCandidates] provider request failed', error);
        return jsonResponseCors({
            ok: true,
            source: 'firestore-cardCatalog',
            data: [],
            fallbackRecommended: true,
            error: 'Scanner candidate provider is unavailable.',
        }, { status: 200 }, allowOrigin);
    }

    const payload = safeJsonParse(bodyText);

    if (!upstreamResponse.ok || !payload || payload.ok === false) {
        console.warn('[pv:scannerCandidates] provider returned error', upstreamResponse.status, bodyText.slice(0, 300));
        return jsonResponseCors({
            ok: true,
            source: 'firestore-cardCatalog',
            data: [],
            fallbackRecommended: true,
            error: payload?.error || 'Scanner candidate provider returned an error.',
        }, { status: 200 }, allowOrigin);
    }

    const outText = JSON.stringify({
        ok: true,
        source: payload.source || 'firestore-cardCatalog',
        count: Array.isArray(payload.data) ? payload.data.length : 0,
        data: Array.isArray(payload.data) ? payload.data : [],
        meta: {
            cacheTtlSeconds: ttl,
            fallbackRecommended: false,
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

## 3. Add route inside `fetch`

Place this route after your card enrichment routes and before this block:

```js
if (!env?.SCRYDEX_API_KEY) {
```

Add:

```js
// GET /scanner/candidates?name=Charizard&number=4/102&setId=base1&limit=12
// Uses Firestore cardCatalog through Firebase Function.
// Does not require Scrydex secrets and should not consume search quota.
if (parts.length === 2 && parts[0] === 'scanner' && parts[1] === 'candidates') {
    return handleScannerCandidates(request, env, allowOrigin);
}
```

## 4. Required Worker env vars

```txt
CARD_CATALOG_CANDIDATES_ENABLED=1
CARD_CATALOG_CANDIDATES_URL=https://<region>-<project>.cloudfunctions.net/scannerCandidates
CARD_CATALOG_CANDIDATES_SECRET=<secret>
CARD_CATALOG_CANDIDATES_TTL_SECONDS=86400
CARD_CATALOG_CANDIDATES_MAX_RESULTS=12
```

You can omit `CARD_CATALOG_CANDIDATES_SECRET` if you want to reuse `CARD_CATALOG_HYDRATION_SECRET`, because the helper falls back to it.

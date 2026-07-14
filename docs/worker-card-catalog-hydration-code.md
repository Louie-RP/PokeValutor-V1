# Worker code: lazy card catalog hydration

These snippets are meant for your Cloudflare Worker that owns `/cards/search`.

## 1. Add environment notes near the top of the Worker

```js
// Optional card catalog hydration:
// - CARD_CATALOG_HYDRATION_ENABLED (default: 0)
// - CARD_CATALOG_HYDRATION_URL
// - CARD_CATALOG_HYDRATION_SECRET
// - CARD_CATALOG_HYDRATION_MAX_CARDS (default: 25)
// - CARD_CATALOG_KNOWN_TTL_SECONDS (default: 2592000 = 30 days)
```

## 2. Update Worker fetch signature

Change:

```js
async fetch(request, env) {
```

to:

```js
async fetch(request, env, ctx) {
```

## 3. Add helpers somewhere above `export default`

```js
function isCardCatalogHydrationEnabled(env) {
    const raw = String(env?.CARD_CATALOG_HYDRATION_ENABLED || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function getCardCatalogHydrationMaxCards(env) {
    return getEnvInt(env, 'CARD_CATALOG_HYDRATION_MAX_CARDS', 25);
}

function getCardCatalogKnownTtlSeconds(env) {
    return getEnvInt(env, 'CARD_CATALOG_KNOWN_TTL_SECONDS', 30 * 24 * 60 * 60);
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
    const raw = String(value || '').trim().toUpperCase();
    if (!raw) return '';

    // Keep gallery/promo prefixes readable, but normalize separators.
    return raw
        .replace(/[OQD]/g, '0')
        .replace(/[IL|!]/g, '1')
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function getFirstStringFromPaths(obj, paths) {
    for (const path of paths) {
        const parts = String(path || '').split('.');
        let cur = obj;

        for (const part of parts) {
            if (!cur || typeof cur !== 'object') {
                cur = null;
                break;
            }
            cur = cur[part];
        }

        const value = String(cur ?? '').trim();
        if (value) return value;
    }

    return '';
}

function normalizeImageUrlsForCatalog(card) {
    const images = card?.images && typeof card.images === 'object' ? card.images : {};
    const firstImage = Array.isArray(card?.images) ? card.images[0] : null;

    const small = getFirstStringFromPaths({ card, images, firstImage }, [
        'images.small',
        'images.thumbnail',
        'images.thumb',
        'firstImage.small',
        'firstImage.thumbnail',
        'card.imageSmall',
        'card.image',
    ]);

    const large = getFirstStringFromPaths({ card, images, firstImage }, [
        'images.large',
        'images.high',
        'images.medium',
        'firstImage.large',
        'firstImage.medium',
        'card.imageLarge',
        'card.image',
    ]) || small;

    return { small, large };
}

function normalizeCardForCatalog(card) {
    if (!card || typeof card !== 'object') return null;

    const id = String(card?.id || '').trim();
    if (!id || hasTcgpInId(id)) return null;

    const expansion = card?.expansion && typeof card.expansion === 'object' ? card.expansion : {};
    const set = card?.set && typeof card.set === 'object' ? card.set : {};
    const images = normalizeImageUrlsForCatalog(card);

    const name = getFirstStringFromPaths({ card }, ['card.name']);
    const number = getFirstStringFromPaths({ card }, [
        'card.number',
        'card.printedNumber',
        'card.collectorNumber',
        'card.cardNumber',
        'card.card_no',
    ]);

    return {
        id,
        name,
        normalizedName: normalizeCatalogText(name),
        number,
        numberKey: normalizeCatalogNumberKey(number),
        printedNumber: getFirstStringFromPaths({ card }, ['card.printedNumber']) || number,
        collectorNumber: getFirstStringFromPaths({ card }, ['card.collectorNumber']) || number,
        setId: getFirstStringFromPaths({ expansion, set, card }, [
            'expansion.id',
            'set.id',
            'card.expansionId',
            'card.setId',
        ]),
        setName: getFirstStringFromPaths({ expansion, set, card }, [
            'expansion.name',
            'set.name',
            'card.expansionName',
            'card.setName',
        ]),
        series: getFirstStringFromPaths({ expansion, set, card }, [
            'expansion.series',
            'set.series',
            'card.series',
        ]),
        rarity: getFirstStringFromPaths({ card }, ['card.rarity']),
        imageSmall: images.small,
        imageLarge: images.large,
        source: 'scrydex-worker',
    };
}

function filterCardsPayloadForCatalog(text) {
    const payload = safeJsonParse(text);

    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.data)) {
        return {
            text,
            cards: [],
        };
    }

    const filtered = filterCardsArrayTcgp(payload.data);
    const nextPayload = filtered.length === payload.data.length
        ? payload
        : { ...payload, data: filtered };

    return {
        text: JSON.stringify(nextPayload),
        cards: filtered,
    };
}

function getKnownCardCatalogKey(cardId) {
    return `pv:cardCatalog:known:${String(cardId || '').trim()}:v1`;
}

async function isCardCatalogKnown(env, cardId) {
    const id = String(cardId || '').trim();
    if (!id) return true;
    const raw = await upstashGet(env, getKnownCardCatalogKey(id)).catch(() => null);
    return String(raw || '') === '1';
}

async function markCardCatalogKnown(env, cardId) {
    const id = String(cardId || '').trim();
    if (!id) return false;
    return upstashSetJson(env, getKnownCardCatalogKey(id), '1', getCardCatalogKnownTtlSeconds(env)).catch(() => false);
}

async function markCardCatalogKnownMany(env, ids) {
    const list = Array.from(new Set((Array.isArray(ids) ? ids : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)));

    await Promise.allSettled(list.map((id) => markCardCatalogKnown(env, id)));
}

async function hydrateCardCatalogFromCards(env, cards) {
    if (!isCardCatalogHydrationEnabled(env)) {
        return { ok: true, skipped: true, reason: 'disabled' };
    }

    const endpoint = String(env?.CARD_CATALOG_HYDRATION_URL || '').trim();
    const secret = String(env?.CARD_CATALOG_HYDRATION_SECRET || '').trim();

    if (!endpoint || !secret) {
        return { ok: false, skipped: true, reason: 'missing_config' };
    }

    const maxCards = getCardCatalogHydrationMaxCards(env);
    const normalized = (Array.isArray(cards) ? cards : [])
        .map(normalizeCardForCatalog)
        .filter(Boolean)
        .slice(0, maxCards);

    if (!normalized.length) {
        return { ok: true, skipped: true, reason: 'no_cards' };
    }

    const unknown = [];
    for (const card of normalized) {
        const known = await isCardCatalogKnown(env, card.id);
        if (!known) unknown.push(card);
    }

    if (!unknown.length) {
        return { ok: true, skipped: true, reason: 'all_known' };
    }

    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'x-pv-catalog-secret': secret,
        },
        body: JSON.stringify({
            source: 'scrydex-search',
            cards: unknown,
        }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) {
        return {
            ok: false,
            status: res.status,
            error: data?.error || 'catalog_hydration_failed',
        };
    }

    const ids = Array.isArray(data.ids)
        ? data.ids
        : unknown.map((card) => card.id);

    await markCardCatalogKnownMany(env, ids);

    return {
        ok: true,
        attempted: unknown.length,
        saved: data.saved ?? ids.length,
        ids,
    };
}

function scheduleCardCatalogHydration(ctx, env, cards) {
    const task = hydrateCardCatalogFromCards(env, cards).catch((error) => {
        console.warn('[PokeValuator] card catalog hydration failed', error);
    });

    if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(task);
        return;
    }

    // Fallback for local/test environments where ctx is not available.
    void task;
}

function scheduleCardCatalogHydrationFromText(ctx, env, jsonText) {
    const parsed = filterCardsPayloadForCatalog(jsonText);
    if (parsed.cards.length) {
        scheduleCardCatalogHydration(ctx, env, parsed.cards);
    }
}
```

## 4. Patch `/cards/search` cache-hit block

Find this pattern in your `/cards/search` route:

```js
if (typeof cached === 'string' && cached.length) {
    const hit = new Response(cached, {
        status: 200,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': `public, max-age=${ttl}`,
        },
    });
    return finalizeResponse(hit, allowOrigin, 'HIT', quotaInfo);
}
```

Update to:

```js
if (typeof cached === 'string' && cached.length) {
    scheduleCardCatalogHydrationFromText(ctx, env, cached);

    const hit = new Response(cached, {
        status: 200,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': `public, max-age=${ttl}`,
        },
    });
    return finalizeResponse(hit, allowOrigin, 'HIT', quotaInfo);
}
```

## 5. Patch `/cards/search` JSON response block

Find the current block:

```js
if (cacheKey && isJson) {
    const text = await res.text();
    const filteredText = filterCardsPayloadTextTcgp(text);
    await upstashSetJson(env, cacheKey, filteredText, ttl).catch(() => {});
    const out = new Response(filteredText, {
        status: 200,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': `public, max-age=${ttl}`,
        },
    });
    return finalizeResponse(out, allowOrigin, 'MISS', quotaInfo);
}

if (isJson) {
    const text = await res.text();
    const filteredText = filterCardsPayloadTextTcgp(text);
    const out = new Response(filteredText, {
        status: 200,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': `public, max-age=${ttl}`,
        },
    });
    return finalizeResponse(out, allowOrigin, 'BYPASS', quotaInfo);
}
```

Replace with:

```js
if (cacheKey && isJson) {
    const text = await res.text();
    const filtered = filterCardsPayloadForCatalog(text);
    const filteredText = filtered.text;

    scheduleCardCatalogHydration(ctx, env, filtered.cards);

    await upstashSetJson(env, cacheKey, filteredText, ttl).catch(() => {});

    const out = new Response(filteredText, {
        status: 200,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': `public, max-age=${ttl}`,
        },
    });
    return finalizeResponse(out, allowOrigin, 'MISS', quotaInfo);
}

if (isJson) {
    const text = await res.text();
    const filtered = filterCardsPayloadForCatalog(text);
    const filteredText = filtered.text;

    scheduleCardCatalogHydration(ctx, env, filtered.cards);

    const out = new Response(filteredText, {
        status: 200,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': `public, max-age=${ttl}`,
        },
    });
    return finalizeResponse(out, allowOrigin, 'BYPASS', quotaInfo);
}
```

## 6. Optional: add hydration to `/cards/:id`

After the individual card JSON response is read and before returning it, you can hydrate a single card too. This is optional because `/cards/search` is enough to start building the catalog.

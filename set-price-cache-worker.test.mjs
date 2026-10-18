import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, beforeEach, test } from 'node:test';
import worker from './scrydex-worker.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });

const env = {
    SCRYDEX_API_KEY: 'test-key',
    SCRYDEX_TEAM_ID: 'test-team',
    SET_PRICE_CACHE_ENABLED: '1',
    UPSTASH_REDIS_REST_URL: 'https://redis.test',
    UPSTASH_REDIS_REST_TOKEN: 'test-token',
};
let values;
let upstreamCalls;
let redisCommands;
let pageTransform;
let upstreamStatus;
let redisFailure;
let delayPages;

function cardsFor(setId, count = setId === 'me2pt5' ? 295 : 120) {
    return Array.from({ length: count }, (_, index) => ({
        id: `${setId}-${index + 1}`,
        name: index === 0 ? 'Pikachu' : index === 1 ? 'Mega Pikachu ex' : `Card ${index + 1}`,
        number: String(index + 1),
        images: [{ type: 'front', medium: `https://images.test/${setId}-${index + 1}` }],
        expansion: {
            id: setId, series: setId.startsWith('sv') ? 'Scarlet & Violet' : 'Mega Evolution',
            language: 'English', languageCode: 'EN',
        },
        variants: [{
            name: 'normal',
            prices: [{ type: 'raw', condition: 'NM', market: index + 1, currency: 'USD' }],
        }],
    }));
}

beforeEach(() => {
    values = new Map();
    upstreamCalls = [];
    redisCommands = [];
    pageTransform = (payload) => payload;
    upstreamStatus = 200;
    redisFailure = false;
    delayPages = false;
    globalThis.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url);
        if (url.hostname === 'redis.test') {
            if (redisFailure) return Response.json({ error: 'offline' }, { status: 503 });
            if (url.pathname === '/') {
                const command = JSON.parse(init.body);
                redisCommands.push(command);
                const [op, key, value] = command;
                if (op === 'GET') return Response.json({ result: values.get(key) ?? null });
                assert.equal(op, 'SET');
                if (command.includes('NX') && values.has(key)) return Response.json({ result: null });
                values.set(key, value);
                return Response.json({ result: 'OK' });
            }
            const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
            if (parts[0] === 'get') return Response.json({ result: values.get(parts[1]) ?? null });
            if (parts[0] === 'set') {
                values.set(parts[1], init.body);
                return Response.json({ result: 'OK' });
            }
            if (parts[0] === 'incr') {
                const next = Number(values.get(parts[1]) || 0) + 1;
                values.set(parts[1], next);
                return Response.json({ result: next });
            }
            if (parts[0] === 'expire') return Response.json({ result: 1 });
            throw new Error(`Unexpected Redis command: ${url}`);
        }
        assert.equal(url.hostname, 'api.scrydex.com');
        upstreamCalls.push(url);
        if (delayPages) await new Promise((resolve) => setTimeout(resolve, 20));
        if (upstreamStatus !== 200) return Response.json({ error: 'upstream failed' }, { status: upstreamStatus });
        if (/\/cards\/[^/]+$/.test(url.pathname)) {
            const id = decodeURIComponent(url.pathname.split('/').at(-1));
            return Response.json({ data: { ...cardsFor(id.split('-')[0], 1)[0], id } });
        }
        const setId = url.searchParams.get('q')?.match(/expansion\.id:([a-z0-9]+)/)?.[1];
        const cards = cardsFor(setId || 'base1');
        const page = Number(url.searchParams.get('page') || 1);
        const pageSize = Number(url.searchParams.get('page_size') || 100);
        return Response.json(pageTransform({
            data: cards.slice((page - 1) * pageSize, page * pageSize),
            page, pageSize, totalCount: cards.length,
        }, page));
    };
});

async function request(path, overrides = {}, headers = {}) {
    const pending = [];
    const response = await worker.fetch(new Request(`https://worker.test${path}`, { headers }), {
        ...env, ...overrides,
    }, { waitUntil(task) { pending.push(task); } });
    await Promise.all(pending);
    return { response, body: await response.json() };
}

const search = (query, page = 1, pageSize = 15) =>
    `/cards/search?q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}&lang=en`;
const snapshots = () => [...values.keys()].filter((key) => key.startsWith('pv:scrydex:setPrices:') && !key.endsWith(':lock'));
const dropLocks = () => {
    for (const key of values.keys()) if (key.endsWith(':lock')) values.delete(key);
};

test('295 cards cost exactly three requests, reused across users, queries, details, and top cards', async () => {
    const cold = await request(search('expansion.id:me2pt5 name:Pikachu'));
    assert.equal(cold.response.status, 200);
    assert.equal(cold.response.headers.get('x-pv-cache'), 'MISS');
    assert.deepEqual(cold.body.data.map((card) => card.id), ['me2pt5-1', 'me2pt5-2']);
    assert.equal(cold.body.totalCount, 2);
    assert.equal(upstreamCalls.length, 3);
    assert.deepEqual(upstreamCalls.map((url) => url.searchParams.get('page')), ['1', '2', '3']);
    for (const url of upstreamCalls) {
        assert.equal(url.searchParams.get('include'), 'prices');
        assert.equal(url.searchParams.get('page_size'), '100');
        assert.equal(url.searchParams.has('select'), false);
    }
    const page = await request(search('expansion_id:me2pt5', 3, 100), {}, { 'CF-Connecting-IP': '192.0.2.2' });
    assert.equal(page.response.headers.get('x-pv-cache'), 'HIT');
    assert.equal(page.body.data.length, 95);
    assert.equal(page.body.data[0].id, 'me2pt5-201');
    assert.equal(page.body.totalCount, 295);
    const card = await request('/cards/me2pt5-250?includePrices=1&lang=en');
    assert.equal(card.body.data.variants[0].prices[0].market, 250);
    assert.equal(card.response.headers.get('x-pv-cache'), 'HIT');
    const top = await request('/cards/top-by-expansion?expansionId=me2pt5&limit=10&lang=en');
    assert.equal(top.body.data.length, 10);
    assert.equal(top.body.data[0].id, 'me2pt5-295');
    assert.equal(top.body.meta.totalConsidered, 295);
    assert.equal(upstreamCalls.length, 3);
    assert.equal(snapshots().length, 1);
});

test('both series and separate sets have independently shared snapshots', async () => {
    await request('/cards/sv1-2?includePrices=1');
    assert.equal(upstreamCalls.length, 2);
    await request(search('expansion:sv1 name:Pika*'));
    assert.equal(upstreamCalls.length, 2);
    await request('/cards/me1-2?includePrices=1');
    assert.equal(upstreamCalls.length, 4);
    await request('/cards/me55c-2?includePrices=1');
    assert.equal(upstreamCalls.length, 6);
    assert.equal(snapshots().length, 3);
});

test('cold top cards and metadata-only card requests also warm the same snapshot', async () => {
    const top = await request('/cards/top-by-expansion?expansionId=sv1&limit=3');
    assert.equal(top.body.data[0].id, 'sv1-120');
    assert.equal(upstreamCalls.length, 2);
    const detail = await request('/cards/sv1-3');
    assert.equal(detail.body.data.id, 'sv1-3');
    assert.equal(upstreamCalls.length, 2);
});

test('phrases, multiple prefixes, accents, empty matches, and missing cards stay local', async () => {
    pageTransform = (payload) => {
        if (payload.data[0].id === 'sv1-1') payload.data[0].name = 'Pok\u00e9 Kid';
        return payload;
    };
    const accented = await request(search('expansion.id:sv1 name:"Pok\u00e9 Kid"'));
    assert.equal(accented.body.totalCount, 1);
    const prefixes = await request(search('expansion.id:sv1 name:mega* name:pika*'));
    assert.deepEqual(prefixes.body.data.map((card) => card.id), ['sv1-2']);
    const empty = await request(search('expansion.id:sv1 name:Missing'));
    assert.equal(empty.body.totalCount, 0);
    const missing = await request('/cards/sv1-999?includePrices=1');
    assert.equal(missing.response.status, 404);
    assert.equal(upstreamCalls.length, 2);
});

test('broad searches, other series, unsupported Lucene, and other languages keep legacy paths', async () => {
    for (const path of [
        search('name:Pikachu'),
        search('expansion.id:base1 name:Pikachu'),
        search('expansion.id:sv1 rarity:Rare'),
        search('expansion.id:sv1 OR name:Pikachu'),
        search('expansion.id:sv1 name:"pika*"'),
        search('expansion.id:sv1 name:pika~'),
        '/cards/base1-1?includePrices=1',
        '/cards/sv1-1?includePrices=1&lang=ja',
    ]) {
        assert.equal((await request(path)).response.status, 200);
    }
    assert.equal(upstreamCalls.length, 8);
    assert.equal(snapshots().length, 0);
});

test('disabled flag, missing Redis, and explicit no-store preserve individual fetches', async () => {
    await request('/cards/sv1-1?includePrices=1', { SET_PRICE_CACHE_ENABLED: '0' });
    await request('/cards/sv1-2?includePrices=1', { UPSTASH_REDIS_REST_TOKEN: '' });
    await request('/cards/sv1-3?includePrices=1&cache=no-store');
    await request(`${search('expansion.id:sv1')}&cache=no-store`);
    assert.equal(upstreamCalls.length, 4);
    assert.equal(snapshots().length, 0);
});

test('concurrent first visitors share one distributed refresh', async () => {
    delayPages = true;
    const results = await Promise.all([
        request('/cards/me2pt5-1?includePrices=1'),
        request('/cards/me2pt5-200?includePrices=1'),
        request(search('expansion.id:me2pt5 name:Pikachu')),
    ]);
    assert.ok(results.every(({ response }) => response.status === 200));
    assert.equal(upstreamCalls.length, 3);
    assert.equal(redisCommands.filter((command) => command.includes('NX')).length, 3);
});

test('incomplete, duplicate, wrong-set, malformed, changing-total, and upstream-error pages never publish', async () => {
    for (const transform of [
        (payload, page) => page === 2 ? { ...payload, data: payload.data.slice(0, 2) } : payload,
        (payload, page) => page === 2 ? { ...payload, data: [cardsFor('me2pt5')[0], ...payload.data.slice(1)] } : payload,
        (payload, page) => page === 2 ? { ...payload, data: cardsFor('sv1', 100) } : payload,
        (payload, page) => page === 2 ? { ...payload, totalCount: 296 } : payload,
        () => ({ data: [], totalCount: 295 }),
        (payload) => ({ ...payload, totalCount: 1001 }),
    ]) {
        values.clear();
        pageTransform = transform;
        const result = await request('/cards/me2pt5-1?includePrices=1');
        assert.equal(result.response.status, 502);
        assert.equal(result.response.headers.get('cache-control'), 'no-store');
        assert.equal(snapshots().length, 0);
    }
    values.clear();
    upstreamStatus = 429;
    const failed = await request('/cards/me2pt5-1?includePrices=1');
    assert.equal(failed.response.status, 503);
    assert.equal(snapshots().length, 0);
    upstreamStatus = 200;
    pageTransform = (payload) => payload;
    dropLocks(); // Simulate the failed refresh lease expiring.
    assert.equal((await request('/cards/me2pt5-1?includePrices=1')).response.status, 200);
    assert.equal(snapshots().length, 1);
});

test('actual series metadata, not a matching ID prefix, controls eligibility', async () => {
    pageTransform = (payload) => ({
        ...payload,
        data: payload.data.map((card) => ({ ...card, expansion: { ...card.expansion, series: 'Sword & Shield' } })),
    });
    const result = await request('/cards/sv1-1?includePrices=1');
    assert.equal(result.response.status, 502);
    assert.equal(snapshots().length, 0);
    assert.equal(upstreamCalls.length, 1);
});

test('Redis failure and malformed cached snapshots surface errors without paid fallback', async () => {
    redisFailure = true;
    assert.equal((await request('/cards/sv1-1?includePrices=1')).response.status, 503);
    assert.equal(upstreamCalls.length, 0);
    redisFailure = false;
    values.set('pv:scrydex:setPrices:v1:en:sv1:0', '{"schemaVersion":1}');
    assert.equal((await request('/cards/sv1-1?includePrices=1')).response.status, 502);
    assert.equal(upstreamCalls.length, 0);
});

test('expiry and webhook dirty versions trigger bounded refreshes and remaining freshness is respected', async () => {
    await request('/cards/sv1-1?includePrices=1');
    const key = snapshots()[0];
    const record = JSON.parse(values.get(key));
    record.fetchedAt -= 3600 * 1000;
    values.set(key, JSON.stringify(record));
    const warm = await request('/cards/sv1-2?includePrices=1');
    const remainingSeconds = Number(warm.response.headers.get('cache-control').split('=')[1]);
    assert.ok(remainingSeconds <= 19 * 3600 && remainingSeconds >= 19 * 3600 - 5);
    assert.equal(upstreamCalls.length, 2);
    record.fetchedAt = Date.now() - 20 * 3600 * 1000;
    values.set(key, JSON.stringify(record));
    dropLocks();
    await request('/cards/sv1-3?includePrices=1');
    assert.equal(upstreamCalls.length, 4);
    values.set('pv:scrydex:dirty:expansion:sv1:v1', 1);
    await request('/cards/sv1-4?includePrices=1');
    assert.equal(upstreamCalls.length, 6);
});

test('exact multiples use the declared total without an extra empty page', async () => {
    pageTransform = (payload, page) => ({
        ...payload, totalCount: 200, data: cardsFor('sv1', 200).slice((page - 1) * 100, page * 100),
    });
    const result = await request(search('expansion.id:sv1'));
    assert.equal(result.body.totalCount, 200);
    assert.equal(upstreamCalls.length, 2);
});

test('missing prices remain a valid no-price result and do not trigger individual upstream requests', async () => {
    pageTransform = (payload) => ({
        ...payload,
        data: payload.data.map((card) => ({ ...card, variants: [{ name: 'normal', prices: [] }] })),
    });
    await request(search('expansion.id:sv1'));
    const card = await request('/cards/sv1-1?includePrices=1');
    assert.deepEqual(card.body.data.variants[0].prices, []);
    const top = await request('/cards/top-by-expansion?expansionId=sv1');
    assert.deepEqual(top.body.data, []);
    assert.equal(upstreamCalls.length, 2);
});

test('cached set searches and top cards retain the existing TCG Pocket exclusions', async () => {
    pageTransform = (payload, page) => {
        if (page === 1) {
            payload.data[0].id = 'sv1-tcgp-online';
            payload.data[0].variants[0].prices[0].market = 99999;
        }
        return payload;
    };
    const results = await request(search('expansion.id:sv1'));
    assert.equal(results.body.totalCount, 119);
    assert.ok(results.body.data.every((card) => !card.id.includes('tcgp')));
    const top = await request('/cards/top-by-expansion?expansionId=sv1');
    assert.ok(top.body.data.every((card) => !card.id.includes('tcgp')));
    assert.equal(upstreamCalls.length, 2);
});

test('snake-case totals and the maximum ten-page snapshot are supported', async () => {
    pageTransform = (payload, page) => ({
        data: cardsFor('sv1', 1000).slice((page - 1) * 100, page * 100),
        total_count: 1000,
    });
    const result = await request('/cards/sv1-1000?includePrices=1');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.id, 'sv1-1000');
    assert.equal(upstreamCalls.length, 10);
});

test('malformed first-page card metadata and conflicting language never publish', async () => {
    for (const mutate of [
        (card) => ({ ...card, variants: null }),
        (card) => ({ ...card, expansion: { ...card.expansion, language: 'Japanese' } }),
        (card) => ({ ...card, expansion: null }),
    ]) {
        values.clear();
        pageTransform = (payload) => ({ ...payload, data: payload.data.map(mutate) });
        const result = await request('/cards/sv1-1?includePrices=1');
        assert.equal(result.response.status, 502);
        assert.equal(snapshots().length, 0);
    }
});

test('a busy distributed lease returns a retryable error rather than duplicating a refresh', async () => {
    values.set('pv:scrydex:setPrices:v1:en:sv1:0:lock', 'another-request');
    const result = await request('/cards/sv1-1?includePrices=1');
    assert.equal(result.response.status, 503);
    assert.equal(result.response.headers.get('retry-after'), '5');
    assert.equal(result.response.headers.get('cache-control'), 'no-store');
    assert.equal(upstreamCalls.length, 0);
});

test('snapshot age caps browser freshness even if configuration exceeds 20 hours', async () => {
    const result = await request('/cards/sv1-1?includePrices=1', { CACHE_TTL_SET_PRICES_SECONDS: '31536000' });
    assert.ok(Number(result.response.headers.get('cache-control').split('=')[1]) <= 72000);
    const write = redisCommands.find((command) => command[0] === 'SET' && !command.includes('NX'));
    assert.equal(write.at(-1), 72000);
});

test('auth, quota headers, CORS, and price-history gating remain ahead of set caching', async () => {
    const denied = await request('/cards/sv1-1?includePrices=1', { REQUIRE_AUTH: '1' });
    assert.equal(denied.response.status, 401);
    const origin = await request('/cards/sv1-1', { ALLOWED_ORIGINS: 'https://allowed.test' }, { Origin: 'https://blocked.test' });
    assert.equal(origin.response.status, 403);
    const history = await request('/cards/sv1-1/scrydex-price-history');
    assert.equal(history.response.status, 403);
    assert.equal(upstreamCalls.length, 0);
    const allowed = await request(`${search('expansion.id:sv1')}&consumeQuota=1`);
    assert.equal(allowed.response.headers.get('access-control-allow-origin'), '*');
    assert.equal(allowed.response.headers.get('x-pv-quota-used'), '1');
    assert.equal(allowed.body.data.length, 15);
    const quotaDenied = await request(`${search('expansion.id:sv1')}&consumeQuota=1`, { ANON_DAILY_LIMIT: '1' });
    assert.equal(quotaDenied.response.status, 429);
    assert.equal(upstreamCalls.length, 2);
});

test('untrusted snapshot values stay JSON and downstream renderers avoid HTML sinks', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    pageTransform = (payload) => {
        payload.data[0].name = hostile;
        return payload;
    };
    const result = await request('/cards/sv1-1?includePrices=1');
    assert.equal(result.body.data.name, hostile);
    assert.match(result.response.headers.get('content-type'), /application\/json/);
    for (const file of ['search.js', 'card.js']) {
        const renderer = await readFile(new URL(`./${file}`, import.meta.url), 'utf8');
        assert.doesNotMatch(renderer, /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write\s*\(/);
        assert.match(renderer, /textContent|createElement/);
    }
});

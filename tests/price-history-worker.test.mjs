import assert from 'node:assert/strict';
import {
    createSign,
    generateKeyPairSync,
    webcrypto,
} from 'node:crypto';
import { readFile } from 'node:fs/promises';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

let source;
try {
    source = await readFile('scrydex-worker.js', 'utf8');
} catch (error) {
    if (error?.code === 'ENOENT') {
        console.log('Price-history Worker behavior checks skipped: local ignored Worker source is absent.');
        process.exit(0);
    }
    throw error;
}

const workerModule = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const worker = workerModule.default;

const projectId = 'price-history-test';
const kid = 'price-history-test-key';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' });
Object.assign(publicJwk, { alg: 'RS256', kid, use: 'sig' });

function base64Url(value) {
    return Buffer.from(value).toString('base64url');
}

function tokenFor(role) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
    const payload = base64Url(JSON.stringify({
        aud: projectId,
        iss: `https://securetoken.google.com/${projectId}`,
        sub: `${role}-user`,
        user_id: `${role}-user`,
        iat: now,
        auth_time: now,
        exp: now + 3600,
        role,
    }));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    signer.end();
    return `${header}.${payload}.${signer.sign(privateKey).toString('base64url')}`;
}

const redisValues = new Map();
const redisLocks = new Set();
const redisCounters = new Map();
let scrydexCalls = 0;

const historyRows = [
    ['2026/04/01', 20, 10],
    ['2026/03/30', null, 9],
    ['2026/03/25', 10, 8],
    ['2026/03/02', 5, 6],
    ['2026/01/01', 4, 5],
].map(([date, holofoilMarket, reverseHolofoilMarket]) => ({
    date,
    prices: [
        {
            variant: 'holofoil',
            condition: 'NM',
            type: 'raw',
            market: holofoilMarket,
            low: null,
            currency: 'USD',
        },
        {
            variant: 'reverse_holofoil',
            condition: 'NM',
            type: 'raw',
            market: reverseHolofoilMarket,
            currency: 'USD',
        },
        {
            variant: 'holofoil',
            condition: 'LP',
            type: 'raw',
            market: 1,
            currency: 'USD',
        },
    ],
}));

globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname === 'www.googleapis.com') {
        return Response.json(
            { keys: [publicJwk] },
            { headers: { 'cache-control': 'public, max-age=3600' } },
        );
    }
    if (url.hostname === 'redis.test') {
        const pathParts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
        if (url.pathname === '/') {
            const command = JSON.parse(String(init.body || '[]'));
            assert.equal(command[0], 'SET');
            const key = command[1];
            if (redisLocks.has(key)) return Response.json({ result: null });
            redisLocks.add(key);
            return Response.json({ result: 'OK' });
        }
        if (pathParts[0] === 'get') {
            return Response.json({ result: redisValues.get(pathParts[1]) ?? null });
        }
        if (pathParts[0] === 'set') {
            redisValues.set(pathParts[1], String(init.body || ''));
            return Response.json({ result: 'OK' });
        }
        if (pathParts[0] === 'incr') {
            const next = (redisCounters.get(pathParts[1]) || 0) + 1;
            redisCounters.set(pathParts[1], next);
            return Response.json({ result: next });
        }
        if (pathParts[0] === 'expire') return Response.json({ result: 1 });
        throw new Error(`Unexpected Redis request: ${url}`);
    }
    if (url.hostname === 'api.scrydex.com' && url.pathname.endsWith('/price_history')) {
        scrydexCalls += 1;
        assert.equal(url.searchParams.get('days'), '90');
        assert.equal(url.searchParams.get('condition'), 'NM');
        assert.equal(url.searchParams.get('page_size'), '100');
        return Response.json({
            data: historyRows,
            total_count: historyRows.length,
        });
    }
    throw new Error(`Unexpected fetch: ${url}`);
};

const baseEnv = {
    FIREBASE_PROJECT_ID: projectId,
    SCRYDEX_API_KEY: 'test-api-key',
    SCRYDEX_TEAM_ID: 'test-team-id',
    SCRYDEX_PRICE_HISTORY_ENABLED: '1',
    SCRYDEX_PRICE_HISTORY_ALLOW_NO_REDIS: '0',
    SCRYDEX_PRICE_HISTORY_FAIL_OPEN: '0',
    SCRYDEX_PRICE_HISTORY_MAX_UPSTREAM_REQUESTS_PER_DAY: '25',
    UPSTASH_REDIS_REST_URL: 'https://redis.test',
    UPSTASH_REDIS_REST_TOKEN: 'test-redis-token',
};
const ctx = { waitUntil() {} };

async function requestHistory({
    token,
    variant = 'holofoil',
    condition = 'NM',
    cardId = 'test-card',
    env = baseEnv,
} = {}) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const request = new Request(
        `https://worker.test/cards/${encodeURIComponent(cardId)}/scrydex-price-history?variant=${variant}&condition=${condition}`,
        { headers },
    );
    const response = await worker.fetch(request, env, ctx);
    return { response, payload: await response.json() };
}

const disabledEnv = { ...baseEnv, SCRYDEX_PRICE_HISTORY_ENABLED: '0' };
const anonymous = await requestHistory({ env: disabledEnv });
assert.equal(anonymous.response.status, 403);
assert.equal(scrydexCalls, 0);

const basic = await requestHistory({ token: tokenFor('basic'), env: disabledEnv });
assert.equal(basic.response.status, 403);
assert.equal(scrydexCalls, 0);

const premiumToken = tokenFor('premium');
const nonNm = await requestHistory({ token: premiumToken, condition: 'LP' });
assert.equal(nonNm.response.status, 400);
assert.equal(scrydexCalls, 0);

const cold = await requestHistory({ token: premiumToken });
assert.equal(cold.response.status, 200);
assert.equal(cold.response.headers.get('x-pv-cache'), 'MISS');
assert.equal(scrydexCalls, 1);
assert.equal(cold.payload.meta.condition, 'NM');
assert.equal(cold.payload.meta.trends.days_7.percent_change, 100);
assert.equal(cold.payload.meta.trends.days_30.percent_change, 300);
assert.equal(cold.payload.meta.trends.days_90.percent_change, 400);
assert.equal(cold.payload.data.find((row) => row.date === '2026-03-30').prices[0].market, null);
assert.ok(cold.payload.data.every((row) => row.prices.every((price) => price.condition === 'NM')));

const repeat = await requestHistory({ token: premiumToken });
assert.equal(repeat.response.headers.get('x-pv-cache'), 'HIT');
assert.equal(scrydexCalls, 1);

const otherVariant = await requestHistory({ token: premiumToken, variant: 'reverse_holofoil' });
assert.equal(otherVariant.response.headers.get('x-pv-cache'), 'HIT');
assert.equal(otherVariant.payload.meta.variant, 'reverse_holofoil');
assert.equal(scrydexCalls, 1);

const overBudget = await requestHistory({
    token: premiumToken,
    cardId: 'uncached-card',
    env: { ...baseEnv, SCRYDEX_PRICE_HISTORY_MAX_UPSTREAM_REQUESTS_PER_DAY: '1' },
});
assert.equal(overBudget.response.status, 429);
assert.equal(scrydexCalls, 1);

console.log('Price-history Worker entitlement, NM-only, cache, variant, trend, and budget checks passed.');

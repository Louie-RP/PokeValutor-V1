import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync, randomUUID, webcrypto } from 'node:crypto';
import { after, beforeEach, test } from 'node:test';
import worker from './scrydex-worker.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
after(() => { globalThis.fetch = originalFetch; Date.now = originalNow; });
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), alg: 'RS256', kid: 'popularity-key', use: 'sig' };
const env = {
    POPULARITY_TRACKING_ENABLED: '1',
    UPSTASH_REDIS_REST_URL: 'https://redis.test',
    UPSTASH_REDIS_REST_TOKEN: 'test-token',
    FIREBASE_PROJECT_ID: 'popularity-test',
};
const daySeconds = 86400;
let now;
let values;
let expiry;
let sorted;
let commands;
let failStorage;
let failAggregation;

function tokenFor(role) {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const seconds = Math.floor(now / 1000);
    const content = `${encode({ alg: 'RS256', kid: 'popularity-key' })}.${encode({
        aud: env.FIREBASE_PROJECT_ID,
        iss: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
        sub: `${role}-private-uid`, role, iat: seconds, exp: seconds + 3600,
    })}`;
    const signer = createSign('RSA-SHA256');
    signer.update(content);
    signer.end();
    return `${content}.${signer.sign(privateKey).toString('base64url')}`;
}

function expire(key) {
    if ((expiry.get(key) ?? Infinity) <= Math.floor(now / 1000)) {
        values.delete(key);
        sorted.delete(key);
        expiry.delete(key);
    }
}

function execute(command) {
    const [op, key, value] = command;
    expire(key);
    if (op === 'GET') return values.get(key) ?? null;
    if (op === 'SET') {
        if (command.includes('NX') && values.has(key)) return null;
        values.set(key, value);
        if (command.includes('EX')) expiry.set(key, Math.floor(now / 1000) + Number(command[command.indexOf('EX') + 1]));
        return 'OK';
    }
    if (op === 'INCR') {
        const count = Number(values.get(key) || 0) + 1;
        values.set(key, count);
        return count;
    }
    if (op === 'EXPIREAT' || op === 'EXPIRE') {
        expiry.set(key, op === 'EXPIREAT' ? Number(value) : Math.floor(now / 1000) + Number(value));
        return 1;
    }
    if (op === 'ZINCRBY') {
        const members = sorted.get(key) || new Map();
        const member = command[3];
        const count = (members.get(member) || 0) + Number(value);
        members.set(member, count);
        sorted.set(key, members);
        return String(count);
    }
    if (op === 'ZUNIONSTORE') {
        const result = new Map();
        for (const source of command.slice(3, 3 + Number(value))) {
            expire(source);
            for (const [member, count] of sorted.get(source) || []) result.set(member, (result.get(member) || 0) + count);
        }
        sorted.set(key, result);
        return result.size;
    }
    if (op === 'ZREVRANGE') {
        return [...(sorted.get(key) || [])]
            .sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))
            .slice(Number(value), Number(command[3]) + 1)
            .flatMap(([id, count]) => [id, String(count)]);
    }
    throw new Error(`Unexpected command: ${op}`);
}

beforeEach(() => {
    now = Date.UTC(2026, 9, 18, 12);
    Date.now = () => now;
    values = new Map();
    expiry = new Map();
    sorted = new Map();
    commands = [];
    failStorage = false;
    failAggregation = false;
    globalThis.fetch = async (input, init) => {
        const url = new URL(input);
        if (url.hostname === 'www.googleapis.com') {
            return Response.json({ keys: [jwk] }, { headers: { 'cache-control': 'max-age=3600' } });
        }
        assert.equal(url.hostname, 'redis.test', 'Popularity must never call Scrydex or any other provider.');
        assert.equal(url.pathname, '/multi-exec');
        if (failStorage) return Response.json({ error: 'offline' }, { status: 503 });
        const batch = JSON.parse(init.body);
        if (failAggregation && batch.some((command) => command[0] === 'ZINCRBY')) {
            return Response.json({ error: 'unavailable' }, { status: 503 });
        }
        commands.push(...batch);
        return Response.json(batch.map((command) => ({ result: execute(command) })));
    };
});

const card = (id = 'sv1-1', setId = 'sv1') => ({ id, setId, name: 'Pikachu', setName: 'Scarlet & Violet' });
const event = (cards = [card()], type = 'search') => ({ eventId: randomUUID(), type, cards });

async function request(path, { body, role, method = body ? 'POST' : 'GET', headers = {}, overrides = {} } = {}) {
    const response = await worker.fetch(new Request(`https://worker.test${path}`, {
        method,
        headers: {
            ...(body ? { 'content-type': 'application/json' } : {}),
            ...(role ? { Authorization: `Bearer ${tokenFor(role)}` } : {}),
            ...headers,
        },
        ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    }), { ...env, ...overrides }, { waitUntil() {} });
    return { response, body: await response.json() };
}
const post = (body, options = {}) => request('/popularity/events', { body, ...options });
const report = (days = 30, options = {}) => request(`/popularity/report?days=${days}&limit=20`, { role: 'admin', ...options });

test('search cards deduplicate per event; sets count once; views remain separate', async () => {
    const search = event([card(), card(), card('sv1-2'), card('me1-1', 'me1')]);
    assert.equal((await post(search)).response.status, 200);
    const duplicate = await post(search);
    assert.equal(duplicate.body.duplicate, true);
    await post(event([card()], 'view'));
    const result = await report();
    assert.equal(result.response.status, 200);
    assert.equal(result.body.metrics.cardSearch.length, 3);
    assert.ok(result.body.metrics.cardSearch.every((row) => row.count === 1));
    assert.deepEqual(result.body.metrics.setSearch.map(({ id, count }) => ({ id, count })).sort((a, b) => a.id.localeCompare(b.id)),
        [{ id: 'me1', count: 1 }, { id: 'sv1', count: 1 }]);
    assert.equal(result.body.metrics.cardView[0].count, 1);
    assert.equal(result.body.metrics.setView[0].count, 1);
    assert.equal(result.response.headers.get('cache-control'), 'no-store');
});

test('admin reports reject anonymous, basic, premium, tester, and invalid tokens', async () => {
    for (const role of [null, 'basic', 'premium', 'tester']) {
        const result = await request('/popularity/report', { role });
        assert.equal(result.response.status, 403);
    }
    const invalid = await request('/popularity/report', { headers: { Authorization: 'Bearer invalid' } });
    assert.equal(invalid.response.status, 401);
    assert.equal(commands.length, 0);
    assert.equal((await report()).response.status, 200);
});

test('30, 60 and 90-day windows sum complete daily top lists, with UTC boundaries', async () => {
    const start = Math.floor(now / (daySeconds * 1000)) * daySeconds;
    for (const [age, count] of [[0, 1], [29, 2], [30, 4], [59, 8], [60, 16], [89, 32], [90, 64]]) {
        sorted.set(`pv:popularity:daily:v1:${start - age * daySeconds}:cardSearch`, new Map([['base1-1', count]]));
    }
    for (const [days, count] of [[30, 3], [60, 15], [90, 63]]) {
        const result = await report(days);
        assert.equal(result.body.metrics.cardSearch[0].count, count);
        assert.equal(result.body.days, days);
        assert.equal(result.body.through, '2026-10-18');
        assert.equal(result.body.timezone, 'UTC');
    }
    for (const [key, expiresAt] of expiry) {
        if (key.startsWith('pv:popularity:report:')) assert.equal(expiresAt, now / 1000 + 60);
    }
});

test('report ranking includes low daily ranks instead of summing truncated daily top-N', async () => {
    const start = Math.floor(now / (daySeconds * 1000)) * daySeconds;
    sorted.set(`pv:popularity:daily:v1:${start}:cardSearch`, new Map([['sv1-1', 10], ['sv1-2', 9]]));
    sorted.set(`pv:popularity:daily:v1:${start - daySeconds}:cardSearch`, new Map([['me1-1', 10], ['sv1-2', 9]]));
    const result = await request('/popularity/report?days=30&limit=1', { role: 'admin' });
    assert.deepEqual(result.body.metrics.cardSearch, [{ id: 'sv1-2', count: 18, name: 'sv1-2' }]);
});

test('daily data expires at the UTC retention boundary; event IDs expire after 24h', async () => {
    await post(event());
    const start = Math.floor(now / (daySeconds * 1000)) * daySeconds;
    const key = `pv:popularity:daily:v1:${start}:cardSearch`;
    assert.equal(expiry.get(key), start + 90 * daySeconds);
    const eventKey = [...values.keys()].find((value) => value.startsWith('pv:popularity:event:'));
    assert.equal(expiry.get(eventKey), now / 1000 + daySeconds);
    now = (start + 90 * daySeconds) * 1000;
    expire(key);
    expire(eventKey);
    assert.equal(sorted.has(key), false);
    assert.equal(values.has(eventKey), false);
});

test('empty selected-set searches count the selected set but no card appearances', async () => {
    const body = event([]);
    body.set = { id: 'base1', name: 'Base' };
    await post(body);
    const result = await report();
    assert.deepEqual(result.body.metrics.cardSearch, []);
    assert.deepEqual(result.body.metrics.setSearch, [{ id: 'base1', name: 'Base', count: 1 }]);
});

test('strict schema rejects raw queries, identities, invalid IDs, oversized batches and wrong media types', async () => {
    for (const body of [
        { ...event(), query: 'private text' }, { ...event(), uid: 'private' },
        { ...event(), type: 'warming' }, { ...event(), eventId: 'bad' },
        event([card('<script>', 'sv1')]), event([card('me1-1', 'sv1')]),
        event(Array.from({ length: 101 }, () => card())),
        event([], 'view'), { ...event([card()], 'view'), set: { id: 'sv1' } },
        { ...event(), cards: [{ ...card(), ip: 'private' }] },
    ]) {
        assert.equal((await post(body)).response.status, 400);
    }
    assert.equal((await post(event(), { headers: { 'content-type': 'text/plain' } })).response.status, 415);
    assert.equal((await post('{bad')).response.status, 400);
    assert.equal((await post(JSON.stringify({ ...event(), padding: 'a'.repeat(40000) }))).response.status, 413);
    assert.equal(commands.length, 0);
});

test('disabled, unconfigured, require-auth and disallowed-origin paths do not write', async () => {
    assert.equal((await post(event(), { overrides: { POPULARITY_TRACKING_ENABLED: '0' } })).body.code, 'POPULARITY_DISABLED');
    assert.equal((await post(event(), { overrides: { UPSTASH_REDIS_REST_TOKEN: '' } })).response.status, 503);
    assert.equal((await post(event(), { overrides: { REQUIRE_AUTH: '1' } })).response.status, 401);
    assert.equal((await post(event(), { overrides: { ALLOWED_ORIGINS: 'https://allowed.test' },
        headers: { Origin: 'https://blocked.test' } })).response.status, 403);
    assert.equal(commands.length, 0);
    assert.equal((await post(event(), { role: 'basic', overrides: { REQUIRE_AUTH: '1' } })).response.status, 200);
});

test('daily delivery cap bounds aggregation writes and storage failures are explicit', async () => {
    const start = Math.floor(now / (daySeconds * 1000)) * daySeconds;
    values.set(`pv:popularity:budget:v1:${start}`, 10000);
    const rejected = await post(event());
    assert.equal(rejected.response.status, 429);
    assert.equal([...values.keys()].some((key) => key.includes(':event:')), false);
    assert.equal(sorted.size, 0);
    failStorage = true;
    assert.equal((await post(event())).response.status, 503);
    assert.equal((await report()).response.status, 503);
});

test('a failed claimed event is not reported as a successfully counted duplicate', async () => {
    const body = event();
    failAggregation = true;
    assert.equal((await post(body)).response.status, 503);
    assert.equal(sorted.size, 0);
    failAggregation = false;
    const repeat = await post(body);
    assert.equal(repeat.response.status, 503);
    assert.match(repeat.body.error, /pending or failed/);
    assert.equal(sorted.size, 0);
});

test('health advertises only configuration and never calls storage or Scrydex', async () => {
    const result = await request('/health');
    assert.equal(result.body.popularityTrackingEnabled, true);
    assert.equal(commands.length, 0);
    assert.equal((await request('/health', { overrides: { POPULARITY_TRACKING_ENABLED: '0' } })).body.popularityTrackingEnabled, false);
});

test('wrong methods, invalid windows, and invalid limits are rejected without storage', async () => {
    assert.equal((await request('/popularity/events')).response.status, 405);
    assert.equal((await request('/popularity/report', { body: event(), role: 'admin' })).response.status, 405);
    for (const query of ['days=1', 'days=91', 'days=NaN', 'days=30&limit=51', 'days=60&limit=0']) {
        assert.equal((await request(`/popularity/report?${query}`, { role: 'admin' })).response.status, 400);
    }
    assert.equal(commands.length, 0);
});

test('aggregates retain no user identities, IPs, tokens or raw query data; labels remain JSON', async () => {
    const body = event([{ ...card(), name: '<img src=x onerror=alert(1)>' }]);
    await post(body, { role: 'admin', headers: { 'CF-Connecting-IP': '192.0.2.123' } });
    const stored = JSON.stringify([...values.entries()]);
    assert.doesNotMatch(stored, /private-uid|192\.0\.2\.123|Bearer|test-token/);
    const result = await report();
    assert.equal(result.body.metrics.cardSearch[0].name, '<img src=x onerror=alert(1)>');
    assert.match(result.response.headers.get('content-type'), /application\/json/);
});

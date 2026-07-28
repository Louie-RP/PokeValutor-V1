'use strict';

const assert = require('node:assert/strict');
const service = require('../../price-history-service.js');

async function run() {
    assert.equal(service.normalizeRoleFromClaims({ role: 'premium' }), 'premium');
    assert.equal(service.normalizeRoleFromClaims({ plan: 'premium' }), 'premium');
    assert.equal(service.normalizeRoleFromClaims({ tier: 'tester' }), 'tester');
    assert.equal(service.normalizeRoleFromClaims({ subscriptionTier: 'admin' }), 'admin');
    assert.equal(service.normalizeRoleFromClaims({ admin: 'true' }), 'admin');
    assert.equal(service.normalizeRoleFromClaims({ tester: true }), 'tester');
    assert.equal(service.normalizeRoleFromClaims({ premium: true }), 'premium');
    assert.equal(service.normalizeRoleFromClaims({ role: 'unknown' }), 'basic');
    assert.equal(service.isPremiumRole('tester'), true);
    assert.equal(service.isPremiumRole('basic'), false);

    assert.equal(await service.resolveRole(null), 'basic');
    assert.equal(await service.resolveRole({
        getUser: () => ({ uid: 'user' }),
        getIdTokenResult: async () => ({ claims: { premium: true } }),
    }), 'premium');
    assert.equal(await service.resolveRole({
        getUser: () => ({ uid: 'user' }),
        getIdTokenResult: async () => { throw new Error('auth failure'); },
    }), 'basic');

    let requestedUrl = '';
    const payload = await service.fetchHistory({
        auth: { getIdToken: async () => 'token' },
        fetchImpl: async (url, options) => {
            requestedUrl = url;
            assert.equal(options.headers.Authorization, 'Bearer token');
            assert.equal(options.cache, 'no-store');
            return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ ok: true, data: [] }),
            };
        },
        workerBase: 'https://worker.example/',
        cardId: 'card/id',
        variant: 'reverse holofoil',
    });
    assert.equal(payload.ok, true);
    assert.equal(
        requestedUrl,
        'https://worker.example/cards/card%2Fid/scrydex-price-history?variant=reverse%20holofoil&condition=NM'
    );

    const request = (overrides = {}) => service.fetchHistory({
        auth: { getIdToken: async () => 'token' },
        workerBase: 'https://worker.example',
        cardId: 'card',
        variant: 'holofoil',
        ...overrides,
    });

    let noTokenFetchCalled = false;
    await assert.rejects(
        request({
            auth: { getIdToken: async () => null },
            fetchImpl: async () => {
                noTokenFetchCalled = true;
            },
        }),
        /Please sign in again/
    );
    assert.equal(noTokenFetchCalled, false);

    await assert.rejects(
        request({
            fetchImpl: async () => ({
                ok: false,
                status: 401,
                text: async () => '{}',
            }),
        }),
        /Please sign in again/
    );

    await assert.rejects(
        request({
            fetchImpl: async () => ({
                ok: false,
                status: 403,
                text: async () => '{}',
            }),
        }),
        /Premium subscription is required/
    );

    await assert.rejects(
        request({
            fetchImpl: async () => ({
                ok: false,
                status: 429,
                text: async () => '{}',
            }),
        }),
        /reached its daily refresh limit/
    );

    await assert.rejects(
        request({
            fetchImpl: async () => ({
                ok: false,
                status: 500,
                text: async () => JSON.stringify({
                    error: 'Upstream failure',
                    message: 'Secondary message',
                }),
            }),
        }),
        /Upstream failure/
    );

    await assert.rejects(
        request({
            fetchImpl: async () => ({
                ok: true,
                status: 200,
                text: async () => JSON.stringify({
                    ok: false,
                    message: 'History payload rejected',
                }),
            }),
        }),
        /History payload rejected/
    );

    await assert.rejects(
        request({
            fetchImpl: async () => {
                throw new Error('Network down');
            },
        }),
        /Network down/
    );

    console.log('Price history service checks passed.');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

'use strict';

const assert = require('node:assert/strict');
const service = require('../../price-history-service.js');

async function run() {
    assert.equal(service.normalizeRoleFromClaims({ role: 'premium' }), 'premium');
    assert.equal(service.normalizeRoleFromClaims({ admin: true }), 'admin');
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

    await assert.rejects(
        service.fetchHistory({
            auth: { getIdToken: async () => 'token' },
            fetchImpl: async () => ({
                ok: false,
                status: 403,
                text: async () => '{}',
            }),
            workerBase: 'https://worker.example',
            cardId: 'card',
            variant: 'holofoil',
        }),
        /Premium subscription is required/
    );

    console.log('Price history service checks passed.');
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

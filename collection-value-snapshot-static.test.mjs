import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const source = await readFile('functions/index.js', 'utf8');
const start = source.indexOf('exports.getCollectionValueSnapshot = functions.https.onCall');
const end = source.indexOf('\nasync function ensureStripeCustomer', start);
assert.ok(start >= 0 && end > start, 'Collection value snapshot callable should be present.');

const handler = source.slice(start, end);
const previousSnapshotStart = source.indexOf('async function getPreviousSnapshot');
const previousSnapshotEnd = source.indexOf('\nfunction toSnapshotResponse', previousSnapshotStart);
assert.ok(previousSnapshotStart >= 0 && previousSnapshotEnd > previousSnapshotStart, 'Previous snapshot helper should be present.');
const previousSnapshotHelper = source.slice(previousSnapshotStart, previousSnapshotEnd);

assert.match(
    handler,
    /getPreviousSnapshot\(db, uid, collectionId, snapshotDate\)/,
    'Snapshot changes should compare against the previous dated snapshot.',
);
assert.match(
    previousSnapshotHelper,
    /where\('snapshotDate', '<', String\(snapshotDate \|\| ''\)\)/,
    'The comparison baseline must exclude the current day.',
);
assert.match(
    handler,
    /const itemType = String\(item\?\.itemType \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'sealed'/,
    'Sealed collection entries must be included in snapshot valuation.',
);
assert.match(
    handler,
    /hasPreviousSnapshot: Boolean\(previous\)/,
    'A missing baseline must remain distinguishable from a real zero-value baseline.',
);

const require = createRequire(import.meta.url);
const Module = require('node:module');
const originalLoad = Module._load;
const snapshotState = {
    current: {
        uid: 'user-1',
        collectionId: 'default',
        snapshotDate: '2026-09-16',
        totalValueCents: 100,
        previousValueCents: 0,
        hasPreviousSnapshot: false,
        changeCents: 0,
        changePercent: 0,
    },
};

function makeCollectionRef(name) {
    return {
        doc(id) {
            if (name === 'users') {
                return {
                    collection(subcollection) {
                        if (subcollection === 'dex') {
                            return {
                                doc() {
                                    return { get: async () => ({ exists: true, data: () => ({ collection: [{
                                        id: 'sealed-1',
                                        itemType: 'sealed',
                                        quantity: 1,
                                        market: 25,
                                    }] }) }) };
                                },
                            };
                        }

                        if (subcollection === 'dexValueSnapshots') {
                            return {
                                doc() {
                                    return {
                                        set: async (value) => {
                                            snapshotState.current = { ...snapshotState.current, ...value };
                                        },
                                        get: async () => ({
                                            exists: true,
                                            id: 'default_2026-09-16',
                                            data: () => snapshotState.current,
                                        }),
                                    };
                                },
                                where() {
                                    return {
                                        where() {
                                            return {
                                                orderBy() {
                                                    return {
                                                        limit() {
                                                            return {
                                                                get: async () => ({
                                                                    empty: false,
                                                                    docs: [{ data: () => ({
                                                                        totalValueCents: 1000,
                                                                    }) }],
                                                                }),
                                                            };
                                                        },
                                                    };
                                                },
                                            };
                                        },
                                    };
                                },
                            };
                        }
                    },
                };
            }

            return { id, get: async () => ({ exists: false, id, data: () => null }) };
        },
    };
}

const fakeDb = {
    collection: makeCollectionRef,
    getAll: async (...refs) => refs.map((ref) => ({ exists: false, id: ref.id, data: () => null })),
};
const fakeAdmin = {
    initializeApp() {},
    firestore: () => fakeDb,
    auth: () => ({ getUser: async () => ({ customClaims: {} }) }),
};
class FakeHttpsError extends Error {}
const fakeFunctions = {
    https: {
        HttpsError: FakeHttpsError,
        onCall: (handlerFunction) => handlerFunction,
        onRequest: (handlerFunction) => handlerFunction,
    },
};

try {
    Module._load = function mockedLoad(request, parent, isMain) {
        if (request === 'firebase-admin') return fakeAdmin;
        if (request === 'firebase-admin/firestore') return { FieldValue: { serverTimestamp: () => 'server-timestamp' } };
        if (request === 'firebase-functions') return fakeFunctions;
        return originalLoad.call(this, request, parent, isMain);
    };

    const functions = require('./functions/index.js');
    const result = await functions.getCollectionValueSnapshot(
        { collectionId: 'default', timezone: 'UTC', useLiveWorkerPrices: false },
        { auth: { uid: 'user-1' } },
    );

    assert.equal(result.snapshot.totalValueCents, 2500, 'The callable must recompute the current-day total.');
    assert.equal(result.snapshot.previousValueCents, 1000, 'The callable must preserve the prior dated baseline.');
    assert.equal(result.snapshot.changeCents, 1500, 'The callable must calculate change from the prior baseline.');
} finally {
    Module._load = originalLoad;
}

console.log('Collection value snapshot regression checks passed.');

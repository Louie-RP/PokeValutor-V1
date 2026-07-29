import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function extractFunction(source, name) {
    const start = source.indexOf(`async function ${name}(`);
    assert.ok(start >= 0, `${name} should exist`);
    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
        }
    }
    throw new Error(`Could not extract ${name}`);
}

const firebaseSource = await readFile('firebase.js', 'utf8');
const saveDexStateSource = extractFunction(firebaseSource, 'saveDexState');

let cloudData;
let transactionSetPayload;
const ref = {};
const context = {
    getUser: () => ({ uid: 'user-1' }),
    dexStateDocRef: () => ref,
    compactDexCollectionForCloud: (value) => value,
    compactDexMasterSetsForCloud: (value) => value,
    estimateJsonSizeBytes: () => 0,
    DEX_CLOUD_DOC_SOFT_LIMIT_BYTES: 900_000,
    DEX_DEFAULT_COLLECTION_ID: 'default',
    loadCurrentRoleFromClaims: async () => 'premium',
    isPremiumRole: () => true,
    isFirestorePayloadTooLarge: () => false,
    loadDexShareSettingsFromProfile: async () => ({ enabled: false }),
    loadDexCollectionsMetaFromProfile: async () => ({}),
    syncSharedDexSnapshotForUser: async () => {},
    window: {
        firebase: {
            firestore: {
                FieldValue: {
                    serverTimestamp: () => ({ serverTimestamp: true }),
                },
            },
        },
    },
    db: {
        runTransaction: async (callback) => callback({
            get: async () => ({
                exists: true,
                data: () => cloudData,
            }),
            set: (_ref, payload) => {
                transactionSetPayload = payload;
            },
        }),
    },
};

vm.runInNewContext(`${saveDexStateSource}; this.saveDexState = saveDexState;`, context);

cloudData = {
    collection: [{ id: 'new-card' }],
    masterSets: {},
    revision: 4,
    updatedAt: 4000,
};
transactionSetPayload = null;
const staleResult = await context.saveDexState({
    collection: [{ id: 'old-card' }],
    masterSets: {},
    revision: 3,
    updatedAt: 5000,
});

assert.equal(staleResult.saved, false);
assert.equal(staleResult.conflict, true);
assert.equal(staleResult.revision, 4);
assert.deepEqual(staleResult.collection, cloudData.collection);
assert.equal(transactionSetPayload, null, 'a stale client must not write its collection');

transactionSetPayload = null;
const currentResult = await context.saveDexState({
    collection: [{ id: 'current-card' }],
    masterSets: {},
    revision: 4,
    updatedAt: 5000,
});

assert.equal(currentResult.saved, true);
assert.equal(currentResult.revision, 5);
assert.equal(transactionSetPayload.revision, 5);
assert.deepEqual(transactionSetPayload.collection, [{ id: 'current-card' }]);

const rules = await readFile('firestore.rules', 'utf8');
assert.match(rules, /request\.resource\.data\.revision is int/);
assert.match(rules, /request\.resource\.data\.revision > 0/);
assert.match(rules, /request\.resource\.data\.revision == resource\.data\.revision \+ 1/);

// XSS regression check for the new cloud-conflict handlers that render refreshed external state.
const unsafeHtmlSink = /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/;
for (const file of ['dex-tracker-pages.js', 'search.js']) {
    const source = await readFile(file, 'utf8');
    const start = source.indexOf('function handleDexCloudSaveResult(');
    const end = source.indexOf('\n    function ', start + 1);
    assert.ok(start >= 0 && end > start);
    assert.doesNotMatch(source.slice(start, end), unsafeHtmlSink, `${file} conflict handler must avoid unsafe HTML sinks`);
}

console.log('Dex stale-write conflict and XSS checks passed.');

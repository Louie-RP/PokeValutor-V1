import assert from 'node:assert/strict';
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

assert.doesNotMatch(
    handler,
    /const existing = await snapshotRef\.get\(\);[\s\S]*?if \(existing\.exists\)/,
    'The current day must be recomputed after collection edits instead of returning a stale snapshot.',
);
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

console.log('Collection value snapshot regression checks passed.');

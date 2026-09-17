import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = (...parts) => resolve(dirname(fileURLToPath(import.meta.url)), ...parts);
const firebaseSource = await readFile(root('firebase.js'), 'utf8');
const sealedSource = await readFile(root('sealed.js'), 'utf8');
const dexSource = await readFile(root('dex-tracker-pages.js'), 'utf8');

assert.match(
    firebaseSource,
    /async function loadDexState\(\)[\s\S]*?catch \(error\) \{[\s\S]*?throw error;/,
    'Dex cloud read failures must not be converted into an empty state.',
);
assert.match(
    firebaseSource,
    /allowEmptyCollection = payload\?\.allowEmptyCollection === true[\s\S]*?intentionalEmptyCollection = payload\?\.intentionalEmptyCollection === true[\s\S]*?collectionForCloud\.length === 0[\s\S]*?currentCollection\.length > 0[\s\S]*?!allowEmptyCollection[\s\S]*?!\(intentionalEmptyCollection && currentCollection\.length === 1\)[\s\S]*?conflict: true/,
    'A stale empty device state must not overwrite a populated cloud collection.',
);
assert.match(
    sealedSource,
    /\.then\(\(\) => authApi\.loadDexState\(\)\)[\s\S]*?authApi\.saveDexState\(payload\)/,
    'Sealed cloud sync must read the cloud state before saving.',
);
assert.match(
    sealedSource,
    /Your sealed item was saved locally, but cloud sync failed\.[\s\S]*?Your existing cloud collection was not changed\./,
    'Sealed cloud sync must fail closed when its cloud read fails.',
);
assert.match(
    firebaseSource,
    /async function saveDexShareSettings\(payload\)[\s\S]*?snapshotSyncFailed: false[\s\S]*?snapshotSyncFailed: true/,
    'Sharing settings must report snapshot-sync failure separately after the profile write succeeds.',
);
assert.match(
    firebaseSource,
    /if \(settings\.enabled\) \{[\s\S]*?loadDexState\(\)[\s\S]*?\} else \{[\s\S]*?syncSharedDexSnapshotForUser\(uid, settings, \[\], \{\}\)/,
    'Disabling sharing must not depend on a Dex-state read.',
);
assert.match(
    firebaseSource,
    /collectionForCloud\.length === 0[\s\S]*?currentCollection\.length > 0[\s\S]*?!allowEmptyCollection[\s\S]*?!\(intentionalEmptyCollection && currentCollection\.length === 1\)\) \{/,
    'Background sync must never clear a non-empty cloud collection without an explicit deletion signal.',
);
assert.doesNotMatch(
    firebaseSource,
    /currentCollection\.length > 0[\s\S]{0,180}requestedUpdatedAt <= currentUpdatedAt/,
    'The empty-collection guard must not rely on timestamps to decide whether clearing is safe.',
);
assert.match(
    await readFile(root('search.js'), 'utf8'),
    /intentionalEmptyCollection: nextCollection\.length === 0/,
    'Final card deletion must explicitly opt into an intentional empty collection.',
);
assert.match(
    sealedSource,
    /intentionalEmptyCollection: !normalized && nextCollection\.length === 0/,
    'Final sealed-item deletion must explicitly opt into an intentional empty collection.',
);
assert.match(
    await readFile(root('account.js'), 'utf8'),
    /saved\?\.snapshotSyncFailed[\s\S]*?old shared links may remain available until the snapshot is refreshed\./,
    'Account UI must distinguish saved sharing settings from failed snapshot refresh.',
);
assert.match(
    await readFile(root('account.js'), 'utf8'),
    /syncDexStateToCloud\(\{ allowEmptyCollection: true \}\)/,
    'Intentional full collection clears must explicitly opt into an empty cloud collection.',
);
assert.match(
    await readFile(root('account.js'), 'utf8'),
    /collection: options\?\.allowEmptyCollection \|\| localCollection\.length > 0[\s\S]*?cloudCollection/,
    'Master-set-only sync must preserve a populated cloud collection when local collection data is empty.',
);
assert.match(
    dexSource,
    /function writeCollection\(next, options\) \{[\s\S]*?areJsonValuesEqual\(safeParseJson\(currentRaw\), safe\)\) return true;[\s\S]*?markDexStateUpdated\(\)/,
    'Identical collection hydration must not rebroadcast state or advance its timestamp.',
);
assert.match(
    dexSource,
    /function writeMasterSets\(next, options\) \{[\s\S]*?areJsonValuesEqual\(safeParseJson\(currentRaw\), safe\)\) return true;[\s\S]*?markDexStateUpdated\(\)/,
    'Identical master-set hydration must not rebroadcast state or advance its timestamp.',
);

console.log('Dex cloud sync failure safety checks passed.');

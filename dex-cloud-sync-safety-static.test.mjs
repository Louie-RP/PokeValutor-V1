import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = (...parts) => resolve(dirname(fileURLToPath(import.meta.url)), ...parts);
const firebaseSource = await readFile(root('firebase.js'), 'utf8');
const sealedSource = await readFile(root('sealed.js'), 'utf8');

assert.match(
    firebaseSource,
    /async function loadDexState\(\)[\s\S]*?catch \(error\) \{[\s\S]*?throw error;/,
    'Dex cloud read failures must not be converted into an empty state.',
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
    await readFile(root('account.js'), 'utf8'),
    /saved\?\.snapshotSyncFailed[\s\S]*?old shared links may remain available until the snapshot is refreshed\./,
    'Account UI must distinguish saved sharing settings from failed snapshot refresh.',
);

console.log('Dex cloud sync failure safety checks passed.');

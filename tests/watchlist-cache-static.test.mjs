import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [firebase, home, worker] = await Promise.all([
    readFile('firebase.js', 'utf8'),
    readFile('script.js', 'utf8'),
    readFile('scrydex-worker.js', 'utf8'),
]);

assert.match(firebase, /WATCHLIST_CLOUD_CACHE_TTL_MS = 8 \* 60 \* 60 \* 1000/);
assert.match(firebase, /readWatchlistCloudCache\(user\.uid, kind\)/);
assert.match(firebase, /writeWatchlistCloudCache\(user\.uid, kind, result\)/);
assert.match(firebase, /invalidateWatchlistCloudCache\(user\.uid, kind\)/);
assert.match(firebase, /readCollectionWithStatus\(watchRef\)/);
assert.match(firebase, /if \(!watchResult\.ok\) return \[\];/);
assert.match(firebase, /if \(!legacyResult\.ok\) return Array\.from\(byId\.values\(\)\);/);

assert.match(home, /HOME_MARKET_SNAPSHOT_TTL_MS = 8 \* 60 \* 60 \* 1000/);
assert.match(home, /Date\.now\(\) - Number\(cached\?\.seenAt \|\| 0\) < HOME_MARKET_SNAPSHOT_TTL_MS/);
assert.match(home, /seenAt: isFresh \? Number\(cached\.seenAt\) : Date\.now\(\)/);
assert.match(home, /fetchJsonWithOptionalAuth\(url, \{ cache: 'no-store' \}\)/);

assert.match(worker, /CACHE_TTL_CARD_PRICES_SECONDS', 6 \* 60 \* 60/);
assert.match(worker, /CACHE_TTL_SEALED_PRICES_SECONDS', 6 \* 60 \* 60/);
assert.match(worker, /pv:scrydex:card:v1/);
assert.match(worker, /pv:scrydex:sealedSearch:v3/);
assert.match(worker, /pv:scrydex:sealed:v1/);

console.log('Watchlist and market cache static checks passed.');
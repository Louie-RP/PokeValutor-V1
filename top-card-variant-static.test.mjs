import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workerSource = await readFile('scrydex-worker.js', 'utf8');
const homeSource = await readFile('script.js', 'utf8');
const searchSource = await readFile('search.js', 'utf8');

for (const [label, source] of [
    ['worker ranking', workerSource],
    ['home display', homeSource],
    ['search ranking fallback', searchSource],
]) {
    assert.match(source, /\['holofoil', 'normal'\]/, `${label} should prefer base variants in order`);
    assert.match(source, /toLowerCase\(\) === preferredName/, `${label} should compare variant names case-insensitively`);
}

const workerStart = workerSource.indexOf('function getBestMarketForCard(card)');
assert.ok(workerStart >= 0, 'Worker ranking helper should exist');
const workerBodyStart = workerSource.indexOf('{', workerStart);
let depth = 0;
let workerEnd = -1;
for (let index = workerBodyStart; index < workerSource.length; index += 1) {
    if (workerSource[index] === '{') depth += 1;
    if (workerSource[index] === '}') {
        depth -= 1;
        if (depth === 0) {
            workerEnd = index + 1;
            break;
        }
    }
}
assert.ok(workerEnd > workerStart, 'Worker ranking helper should have a complete body');
const workerSelector = workerSource.slice(workerStart, workerEnd);
assert.ok(workerSelector.indexOf("const preferredNames = ['holofoil', 'normal'];") < workerSelector.indexOf('let best = null'));
assert.match(workerSelector, /if \(market != null\) return market;/);
assert.match(workerSource, /topByExpansion:v3:/, 'Top-card cache changes should invalidate old entries.');
assert.match(searchSource, /top-by-expansion\?expansionId=.*variantPreference=v2/);
assert.match(homeSource, /top-by-expansion\?expansionId=.*variantPreference=v2/);
assert.match(
    searchSource,
    /isEmptyTopCardsResponse\(url, cached\)[\s\S]*localStorage\.removeItem\(cacheKey\)/,
    'Browser cache reads must evict empty top-card responses.',
);
assert.match(
    searchSource,
    /if \(!isEmptyTopCardsResponse\(url, data\)\) cacheSet\(cacheKey, data, ttlMs\)/,
    'Browser cache writes must skip empty top-card responses.',
);
assert.match(
    homeSource,
    /cached && !isEmptyTopCardsResponse\(cached\)[\s\S]*if \(!isEmptyTopCardsResponse\(data\)\) cacheSet\(cacheKey, data, ttlMs\)/,
    'Home spotlight caching must evict and skip empty top-card responses.',
);
assert.match(
    workerSource,
    /if \(cacheKey && hasResults\)[\s\S]*'cache-control': hasResults \? `public, max-age=\$\{ttl\}` : 'no-store'/,
    'Worker cache writes and HTTP caching must skip empty top-card responses.',
);
assert.match(workerSource, /cache: 'no-store'/, 'Top-card upstream errors must not enter the Cloudflare fetch cache.');
assert.match(
    workerSource,
    /if \(!allCards\.length && upstreamFailure\)[\s\S]*return finalizeResponse\(failed, allowOrigin, 'BYPASS', quotaInfo\)/,
    'Upstream top-card failures must remain errors instead of becoming zero results.',
);
assert.match(searchSource, /const bestVariantData = getBestVariantWithPrices\(variantsFull\)/);
assert.match(searchSource, /if \(hasPreferredVariant\) return null;/);
assert.match(searchSource, /lastResults:v2/, 'Old saved search selections should not restore stamped variants.');

console.log('Top-card preferred variant ranking checks passed.');
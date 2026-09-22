import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function extractFunction(source, name) {
    const asyncStart = source.indexOf(`async function ${name}(`);
    const syncStart = source.indexOf(`function ${name}(`);
    const start = asyncStart >= 0 ? asyncStart : syncStart;
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

const [sharedSource, dexSource, functionsSource, sharedHtml, dexHtml, workflowSource] = await Promise.all([
    readFile('shared-collection.js', 'utf8'),
    readFile('dex-tracker-pages.js', 'utf8'),
    readFile('functions/index.js', 'utf8'),
    readFile('shared-collection.html', 'utf8'),
    readFile('dex.html', 'utf8'),
    readFile('.github/workflows/deploy-pages.yml', 'utf8'),
]);

const sharedNormalizeSource = extractFunction(sharedSource, 'normalizeCollectionEntry');
const sharedCurrentValueSource = extractFunction(sharedSource, 'getCurrentSealedValue');
const sharedRefreshSource = extractFunction(sharedSource, 'refreshSelectedCollectionValues');

for (const field of ['baseProductId', 'variantName', 'variantLabel', 'hasMultipleVariants']) {
    assert.match(sharedNormalizeSource, new RegExp(`${field}:`), `Shared normalization should preserve ${field}.`);
}
assert.match(sharedSource, /collectionValueCache:v3/);
assert.match(sharedCurrentValueSource, /getSealedPricingIdentity\(item\)/);
assert.match(sharedCurrentValueSource, /fetchCurrentSealedProduct\(baseProductId\)/);
assert.match(sharedCurrentValueSource, /getMarketFromTrackedSealedVariant\(fetchedVariants, identity\)/);
assert.match(sharedCurrentValueSource, /buildSealedValueCacheKey\(identity\)/);
assert.doesNotMatch(sharedRefreshSource, /fetchSealedWithPrices\(item\?\.id\)/);

assert.match(dexSource, /window\.PV_SEALED_PRICING/);
assert.match(dexSource, /collectionValueCache:v3/);

for (const html of [sharedHtml, dexHtml]) {
    const coreIndex = html.indexOf('sealed-pricing-core.js');
    const consumerIndex = Math.max(html.indexOf('shared-collection.js'), html.indexOf('dex-tracker-pages.js'));
    assert.ok(coreIndex >= 0 && consumerIndex > coreIndex, 'The shared pricing core must load before its page consumer.');
}

assert.match(functionsSource, /require\('\.\/lib\/sealed-pricing-core'\)/);
assert.match(functionsSource, /getSealedPricingIdentity\(item\)/);
assert.match(functionsSource, /fetchSealedWithPrices\(identity\.baseProductId\)/);
assert.match(functionsSource, /getMarketFromTrackedSealedVariant\(liveVariants, identity\)/);
assert.match(functionsSource, /sealedPricing\.buildSealedValueCacheKey\(identity\)/);

assert.match(
    workflowSource,
    /cp functions\/lib\/sealed-pricing-core\.js dist\/functions\/lib\/sealed-pricing-core\.js/,
    'Pages build must copy the canonical browser module into dist.',
);

const unsafeHtmlSink = /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/;
assert.doesNotMatch(sharedRefreshSource, unsafeHtmlSink);
assert.match(sharedRefreshSource, /render\(currentQuery, \{ animate: false \}\)/);
assert.doesNotMatch(
    await readFile('shared-sealed-price-refresh-static.test.mjs', 'utf8'),
    /\b(?:eval|Function|runInContext|runInNewContext)\s*\(/,
);

console.log('Shared sealed live-price integration and XSS checks passed.');
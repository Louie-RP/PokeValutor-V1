import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = (...parts) => resolve(__dirname, ...parts);

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

const dexSource = await readFile(ROOT('dex-tracker-pages.js'), 'utf8');
const identitySource = extractFunction(dexSource, 'getSealedPricingIdentity');
const cacheKeySource = extractFunction(dexSource, 'buildSealedValueCacheKey');
const currentValueSource = extractFunction(dexSource, 'getCurrentSealedValue');
const normalizeSource = extractFunction(dexSource, 'normalizeSealedCollectionEntry');
const variantLabelSource = extractFunction(dexSource, 'getSealedCollectionVariantLabel');
const rendererSource = extractFunction(dexSource, 'refreshCollectionValues');

assert.match(identitySource, /item\?\.baseProductId/);
assert.match(identitySource, /displayId\.indexOf\('::'\)/);
assert.match(identitySource, /item\?\.variantName/);
assert.match(cacheKeySource, /sealed:v2:/, 'The sealed cache namespace should invalidate stale v1 values.');

const sealedSource = await readFile(ROOT('sealed.js'), 'utf8');
assert.match(sealedSource, /SEARCH_CACHE_VERSION = 'v2'/, 'Sealed search requests should invalidate stale browser cache entries.');
assert.match(sealedSource, /SEARCH_TTL_MS = 12 \* 60 \* 60 \* 1000/, 'Sealed search browser cache should remain valid for 12 hours.');
assert.match(sealedSource, /searchVersion=\$\{SEARCH_CACHE_VERSION\}/, 'Sealed search requests should carry the cache version.');
const sealedCacheValiditySource = extractFunction(sealedSource, 'isUnpricedSealedSearchResponse');
assert.match(sealedCacheValiditySource, /products\.length > 0/);
assert.match(sealedCacheValiditySource, /getMarketQuote\(product\)/, 'Sealed cache validity should use the rendered market-price rule.');
const sealedFetchCacheSource = extractFunction(sealedSource, 'fetchJsonWithCache');
assert.match(
    sealedFetchCacheSource,
    /cached && !isUnpricedSealedSearchResponse\(cached\)/,
    'Previously cached all-unpriced sealed searches must be evicted.',
);
assert.match(
    sealedFetchCacheSource,
    /if \(!isUnpricedSealedSearchResponse\(data\)\) cacheSet\(cacheKey, data, ttlMs\)/,
    'All-unpriced sealed searches must not be cached for 12 hours.',
);
const sealedLoadLastResultsSource = extractFunction(sealedSource, 'loadLastResults');
assert.match(
    sealedLoadLastResultsSource,
    /isUnpricedSealedSearchResponse\(\{ data: parsed\.products \}\)[\s\S]*localStorage\.removeItem\(LAST_RESULTS_KEY\)/,
    'Legacy all-unpriced sealed results must not restore after reload.',
);
const sealedSaveLastResultsSource = extractFunction(sealedSource, 'saveLastResults');
assert.match(
    sealedSaveLastResultsSource,
    /isUnpricedSealedSearchResponse\(\{ data: next\?\.products \}\)[\s\S]*localStorage\.removeItem\(LAST_RESULTS_KEY\)/,
    'All-unpriced sealed results must not persist through last-results storage.',
);

assert.match(currentValueSource, /fetchSealedFromSearchById\(baseProductId\)/);
assert.match(currentValueSource, /fetchSealedWithPrices\(baseProductId\)/);
assert.match(currentValueSource, /buildSealedValueCacheKey\(displayId\)/);
assert.match(currentValueSource, /getTrackedSealedMarketFromVariants\(fetchedVariants, variantName\)/);
assert.ok(
    currentValueSource.indexOf('if (cached &&') < currentValueSource.indexOf('if (allowNetwork)'),
    'A valid sealed cache entry must prevent another API request.',
);

for (const field of ['baseProductId', 'variantName', 'variantLabel', 'hasMultipleVariants']) {
    assert.match(normalizeSource, new RegExp(`${field}:`), `Dex normalization should preserve ${field}.`);
}
assert.match(variantLabelSource, /item\?\.variantLabel/);
assert.match(variantLabelSource, /item\?\.variantName/);
assert.match(variantLabelSource, /variants\[0\]\?\.name/);
assert.match(variantLabelSource, /normalizedLabel === 'pokemoncenter'/);
assert.match(variantLabelSource, /return 'Pokemon Center'/);
assert.match(variantLabelSource, /normalizedLabel === 'normal'/);
assert.match(variantLabelSource, /normalizedLabel === 'default'/);
assert.match(variantLabelSource, /normalizedLabel === 'standard'/);
const collectionRendererSource = extractFunction(dexSource, 'renderCollectionPage');
assert.match(collectionRendererSource, /getSealedCollectionVariantLabel\(item\)/);
assert.match(collectionRendererSource, /escapeHtml\(getSealedCollectionVariantLabel\(item\)\)/);

const firebaseSource = await readFile(ROOT('firebase.js'), 'utf8');
const compactSource = extractFunction(firebaseSource, 'compactDexCollectionForCloud');
for (const field of ['baseProductId', 'variantName', 'variantLabel', 'hasMultipleVariants']) {
    assert.match(compactSource, new RegExp(`entry\\.${field}\\s*=`), `Cloud sync should preserve ${field}.`);
}

// XSS regression check for the downstream renderer reached by API and cloud price data.
const unsafeHtmlSink = /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/;
assert.doesNotMatch(rendererSource, unsafeHtmlSink);
assert.match(rendererSource, /valueEl\.textContent = formatUsd\(market\)/);
assert.doesNotMatch(
    await readFile(ROOT('dex-sealed-price-refresh-static.test.mjs'), 'utf8'),
    /\b(?:eval|Function|runInContext|runInNewContext)\s*\(/,
    'Security tests must not dynamically execute source text.',
);

console.log('Dex sealed live-price refresh, variant identity, cloud sync, and XSS checks passed.');

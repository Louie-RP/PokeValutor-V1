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
const rendererSource = extractFunction(dexSource, 'refreshCollectionValues');

assert.match(identitySource, /item\?\.baseProductId/);
assert.match(identitySource, /displayId\.indexOf\('::'\)/);
assert.match(identitySource, /item\?\.variantName/);
assert.match(cacheKeySource, /sealed:v2:/, 'The sealed cache namespace should invalidate stale v1 values.');

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

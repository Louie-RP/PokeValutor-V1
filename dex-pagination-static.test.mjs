import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile('dex-tracker-pages.js', 'utf8');
const start = source.indexOf('    function renderCollectionPagination(');
const end = source.indexOf('    function bindCollectionSortControls(', start);

assert.ok(start >= 0 && end > start, 'Collection pagination renderer should be present.');

const renderer = source.slice(start, end);

// XSS regression check required by AGENTS.md for this downstream renderer.
assert.doesNotMatch(
    renderer,
    /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/,
    'Collection pagination must build its UI with safe DOM APIs.',
);
assert.match(renderer, /document\.createElement\(/);
assert.match(renderer, /\.textContent\s*=/);
assert.match(renderer, /\.replaceChildren\(/);

for (const [label, nav] of [
    ['First', 'first'],
    ['Previous', 'prev'],
    ['Next', 'next'],
    ['Last', 'last'],
]) {
    assert.match(
        renderer,
        new RegExp(`createPageButton\\('${label}', '${nav}',`),
        `${label} pagination control should be rendered.`,
    );
}

assert.match(renderer, /firstBtn\.addEventListener\('click', \(\) => goToPage\(1\)\)/);
assert.match(renderer, /lastBtn\.addEventListener\('click', \(\) => goToPage\(totalPages\)\)/);
assert.match(renderer, /createPageButton\('First', 'first', currentPage <= 1\)/);
assert.match(renderer, /createPageButton\('Last', 'last', currentPage >= totalPages\)/);

const collectionPageStart = source.indexOf('    function renderCollectionPage(options)');
const collectionPageEnd = source.indexOf('\n    function renderMasterSetsPage(', collectionPageStart);
assert.ok(collectionPageStart >= 0 && collectionPageEnd > collectionPageStart, 'Collection page renderer should be present.');

const collectionPageRenderer = source.slice(collectionPageStart, collectionPageEnd);
assert.match(
    collectionPageRenderer,
    /options\?\.skipNetworkRefresh !== true\s*&&\s*shouldAllowCollectionNetworkRefresh\(items\)/,
    'A cache-only pagination render must not restart network pricing.',
);
assert.match(
    collectionPageRenderer,
    /setCollectionLastValueRefreshMs\([\s\S]*?renderCollectionPage\(\{ skipNetworkRefresh: true \}\)/,
    'Refreshed prices should recompute pagination exactly once without another network refresh.',
);

const refreshValuesStart = source.indexOf('    async function refreshCollectionValues(');
const refreshValuesEnd = source.indexOf('\n    function pickFrontMediumImage(', refreshValuesStart);
const refreshValues = source.slice(refreshValuesStart, refreshValuesEnd);
assert.match(
    refreshValues,
    /if \(allowNetwork\) \{\s*setCollectionTotalValueText\('Value: Loading\.\.\.'\);\s*\}/,
    'Cache-only cross-tab renders must preserve the settled collection total.',
);

const storageHandlerStart = source.indexOf('    function handleDexStorageChange(');
const storageHandlerEnd = source.indexOf('\n    document.addEventListener(\'DOMContentLoaded\'', storageHandlerStart);
const storageHandler = source.slice(storageHandlerStart, storageHandlerEnd);
assert.ok(storageHandlerStart >= 0 && storageHandlerEnd > storageHandlerStart, 'Dex storage handler should be present.');
assert.match(storageHandler, /key === VALUE_CACHE_KEY/);
assert.match(storageHandler, /renderAll: false, allowNetwork: false/);
assert.match(storageHandler, /key === DEX_COLLECTION_KEY \|\| key === DEX_ACTIVE_COLLECTION_KEY/);
assert.match(source, /window\.addEventListener\('storage', handleDexStorageChange\)/);
assert.doesNotMatch(
    source,
    /window\.addEventListener\('storage', renderActivePage\)/,
    'Unrelated cross-tab storage writes must not trigger full Dex renders.',
);

console.log('Dex pagination static, boundary-navigation, and XSS checks passed.');

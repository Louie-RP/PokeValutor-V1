import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const collectionView = require('./collection-view-utils.js');

const [sharedSource, sharedHtml, dexHtml, styles] = await Promise.all([
    readFile('shared-collection.js', 'utf8'),
    readFile('shared-collection.html', 'utf8'),
    readFile('dex.html', 'utf8'),
    readFile('styles.css', 'utf8'),
]);

assert.equal(collectionView.formatUsd(1234567.8), '$1,234,567.80');
assert.equal(collectionView.normalizeTypeFilter('SEALED'), 'sealed');
assert.equal(collectionView.normalizeTypeFilter('invalid'), 'all');
assert.deepEqual(
    collectionView.getPagination(121, 60, 3),
    {
        totalItems: 121,
        pageSize: 60,
        totalPages: 3,
        currentPage: 3,
        startIndex: 120,
        endIndex: 121,
    },
);

for (const [html, consumer] of [
    [sharedHtml, 'shared-collection.js'],
    [dexHtml, 'dex-tracker-pages.js'],
]) {
    const utilityIndex = html.indexOf('collection-view-utils.js');
    const consumerIndex = html.indexOf(consumer);
    assert.ok(utilityIndex >= 0 && consumerIndex > utilityIndex, `Utilities must load before ${consumer}.`);
}

assert.match(sharedHtml, /id="pv-shared-type-filter"/);
assert.match(sharedHtml, /<option value="all" selected>Cards \+ Sealed<\/option>/);
assert.match(sharedHtml, /<option value="card">Cards only<\/option>/);
assert.match(sharedHtml, /<option value="sealed">Sealed only<\/option>/);
assert.match(sharedHtml, /id="pv-shared-pagination"/);
const sharedValueIndex = sharedHtml.indexOf('id="pv-shared-value-total"');
const sharedInfoIndex = sharedHtml.indexOf('id="pv-shared-value-info"');
const sharedUnitsIndex = sharedHtml.indexOf('id="pv-shared-total"');
assert.ok(
    sharedValueIndex >= 0 && sharedInfoIndex > sharedValueIndex && sharedUnitsIndex > sharedInfoIndex,
    'Value and its coverage info button should appear above Total units.',
);
assert.match(
    sharedHtml,
    /<span class="pv-collectionTotalValue">\s*Value:\s*<button[\s\S]*?id="pv-shared-value-total"[\s\S]*?class="pv-collectionTotalValueButton"[\s\S]*?aria-label="View collection value breakdown"[\s\S]*?>\$0\.00<\/button>/,
);
assert.match(sharedHtml, /id="pv-shared-value-info"[\s\S]*class="pv-collectionValueInfoBtn"[\s\S]*data-collection-value-hint=/);
assert.match(sharedHtml, /id="pv-shared-total" class="pv-collectionTotalAmount">Total units: 0<\/span>/);
assert.match(sharedHtml, /id="pv-shared-value-dialog"[\s\S]*id="pv-shared-card-value"[\s\S]*id="pv-shared-sealed-value"[\s\S]*id="pv-shared-breakdown-total"/);
assert.match(sharedSource, /setText\(valueTotalEl, formatUsd\(totalValue\)\)/);
assert.match(sharedSource, /collectionView\.setCoverageTooltip\(valueInfoEl, coverage\)/);
assert.match(sharedSource, /collectionView\.bindValueSummaryInteractions\(/);
assert.match(sharedSource, /sharedTotalsState\.cardValue = cardValue/);
assert.match(sharedSource, /sharedTotalsState\.sealedValue = sealedValue/);

const typeFilterIndex = sharedSource.indexOf('const typeFilteredItems = selectedItems.filter');
const searchFilterIndex = sharedSource.indexOf('const filtered = applyCollectionFilter(typeFilteredItems, query)');
const sortIndex = sharedSource.indexOf('const sortedFiltered = sortCollectionItems(filtered, sortMode)');
const paginationIndex = sharedSource.indexOf('const pagination = collectionView.getPagination(sortedFiltered.length');
const sliceIndex = sharedSource.indexOf('const visibleItems = sortedFiltered.slice(pagination.startIndex, pagination.endIndex)');
assert.ok(typeFilterIndex >= 0 && searchFilterIndex > typeFilterIndex, 'Type filtering must precede text filtering.');
assert.ok(sortIndex > searchFilterIndex, 'Sorting must follow filtering.');
assert.ok(paginationIndex > sortIndex && sliceIndex > paginationIndex, 'Pagination must slice the sorted filtered results.');
assert.match(sharedSource, /collectionView\.renderPagination\(paginationEl/);
assert.match(sharedSource, /paginationState\.page = 1/);
assert.match(sharedSource, /return collectionView\.formatUsd\(amount\)/);
assert.match(styles, /#pv-shared-body\) \.pv-collectionPagination/);
assert.match(
    styles,
    /#pv-shared-body \.pv-sharedFilterRow \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    'Display and Sort should share an equal two-column row on mobile.',
);
assert.match(
    styles,
    /#pv-shared-body \.pv-sharedFilterControl--sort,\s*#pv-shared-body \.pv-sharedFilterControl--type \{[\s\S]*?width: 100%;/,
    'Display and Sort controls should use equal widths.',
);
assert.match(
    styles,
    /grid-template-columns: minmax\(0, 430px\) repeat\(2, 180px\);/,
    'Display and Sort should remain equally sized on desktop.',
);

const unsafeHtmlSink = /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/;
assert.doesNotMatch(sharedSource, unsafeHtmlSink, 'Shared snapshot rendering must not use unsafe HTML sinks.');
assert.match(sharedSource, /function getSafeImageUrl\(/);
assert.match(sharedSource, /if \(!value\) return '';/);
assert.match(sharedSource, /url\.protocol === 'https:' \|\| url\.protocol === 'http:'/);
const sharedBreakdownStart = sharedSource.indexOf('function renderSharedValueBreakdown()');
const sharedBreakdownEnd = sharedSource.indexOf('\n        function resetSharedValueSummary()', sharedBreakdownStart);
assert.ok(sharedBreakdownStart >= 0 && sharedBreakdownEnd > sharedBreakdownStart);
const sharedBreakdownRenderer = sharedSource.slice(sharedBreakdownStart, sharedBreakdownEnd);
assert.doesNotMatch(
    sharedBreakdownRenderer,
    /Total value:.*coverage/,
    'Pricing coverage should remain in the info tooltip rather than the breakdown total.',
);

console.log('Shared collection pagination, display filter, formatting, and XSS checks passed.');
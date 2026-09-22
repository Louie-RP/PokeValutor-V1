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

const unsafeHtmlSink = /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/;
assert.doesNotMatch(sharedSource, unsafeHtmlSink, 'Shared snapshot rendering must not use unsafe HTML sinks.');
assert.match(sharedSource, /function getSafeImageUrl\(/);
assert.match(sharedSource, /if \(!value\) return '';/);
assert.match(sharedSource, /url\.protocol === 'https:' \|\| url\.protocol === 'http:'/);

console.log('Shared collection pagination, display filter, formatting, and XSS checks passed.');
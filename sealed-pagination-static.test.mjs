import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const collectionView = require('./collection-view-utils.js');
const [source, html, utilitySource, styles] = await Promise.all([
    readFile('sealed.js', 'utf8'),
    readFile('sealed.html', 'utf8'),
    readFile('collection-view-utils.js', 'utf8'),
    readFile('styles.css', 'utf8'),
]);

function section(startText, endText) {
    const start = source.indexOf(startText);
    const end = source.indexOf(endText, start);
    assert.ok(start >= 0 && end > start, `Expected section: ${startText}`);
    return source.slice(start, end);
}

for (const [mobile, pageSize] of [[true, 36], [false, 60]]) {
    assert.equal(collectionView.getResponsivePageSize({
        matchMedia(query) {
            assert.equal(query, '(max-width: 767.98px)');
            return { matches: mobile };
        },
    }), pageSize);
    for (const count of [0, 1, pageSize, pageSize + 1, 137]) {
        const bounds = collectionView.getPagination(count, pageSize, 999);
        assert.equal(bounds.endIndex, count);
        assert.equal(bounds.currentPage, Math.max(1, Math.ceil(count / pageSize)));
    }
}

assert.ok(html.indexOf('collection-view-utils.js') >= 0);
assert.ok(html.indexOf('collection-view-utils.js') < html.indexOf('src="sealed.js'));
assert.match(html, /id="pv-sealed-results-title"[^>]*tabindex="-1"/);
for (const position of ['top', 'bottom']) {
    assert.match(html, new RegExp(`id="pv-sealed-pagination-${position}"[^>]*hidden`));
}
assert.match(styles, /:is\(#pv-search-body, #pv-sealed-body, #pv-dex-body, #pv-shared-body\) \.pv-collectionPagination/);
assert.doesNotMatch(html, /Pages browse loaded cards/);

const renderer = section('    function renderProducts(', '\n    async function searchByName(');
const expandIndex = renderer.indexOf('createSealedDisplayProducts(sourceProducts)');
const sortIndex = renderer.indexOf('displayProducts.slice().sort(compareSealedProductsForSort)');
const pagingIndex = renderer.indexOf('paginateProducts(sortedProducts)');
assert.ok(expandIndex >= 0 && sortIndex > expandIndex && pagingIndex > sortIndex,
    'Variants must expand and sort globally before pagination.');
assert.match(renderer, /currentResultsProducts = sourceProducts\.slice\(\)/,
    'Keep the full raw product list for future page renders and Load More merging.');
assert.match(renderer, /for \(const p of visibleProducts\)/);
assert.match(renderer, /if \(!displayProducts\.length\)[\s\S]*?paginateProducts\(\[\]\)/);

const paging = section('    function paginateProducts(', '    function renderProducts(');
assert.match(paging, /collectionView\.getResponsivePageSize\(window\)/);
assert.match(paging, /collectionView\.renderPagination\(paginationEl,/);
assert.match(paging, /showSinglePage: true/);
assert.match(paging, /pagesLabel: 'Sealed result pages'/);
assert.match(paging, /firstVisibleIndex = \(paginationState\.page - 1\) \* paginationState\.perPage/);
assert.match(paging, /return sortedProducts\.slice\(pagination\.startIndex, pagination\.endIndex\)/);
assert.match(paging, /onPageChange\(page\)[\s\S]*?renderProducts\(currentResultsProducts,[\s\S]*?scrollResultsToTop\(\)/);
assert.match(paging, /matchMedia\('\(max-width: 767\.98px\)'\)\.addEventListener\('change'/);
assert.doesNotMatch(paging, /fetchSealedSearchPage|fetchJsonWithCache/,
    'Page navigation and responsive changes must not fetch additional search results.');

const sortControls = section('    function bindSealedSortControls(', '    const SEALED_FAVORITES_SORT_MODES');
assert.match(sortControls, /paginationState\.page = 1;[\s\S]*?renderProducts\(currentResultsProducts,/);
assert.doesNotMatch(source, /applySealedSortToGrid/,
    'Sorting only rendered DOM tiles would leave other pages incorrectly ordered.');
const scroll = section('    function scrollResultsToTop(', '    function paginateProducts(');
assert.match(scroll, /pv-sealed-header/);
assert.match(scroll, /prefers-reduced-motion: reduce/);
assert.match(scroll, /focus\(\{ preventScroll: true \}\)/);

const search = section('    async function searchByName(', '    async function loadMoreResults(');
assert.match(search, /const requestVersion = \+\+searchRequestVersion/);
assert.match(search, /paginationState\.page = 1/);
assert.match(search, /paginateProducts\(\[\]\)/);
assert.match(search, /await fetchSealedSearchPage[\s\S]*?if \(requestVersion !== searchRequestVersion\) return/);
const loadMore = section('    async function loadMoreResults(', '    function clearResultsUI(');
assert.match(source, /const SEARCH_PAGE_SIZE = 10;/);
assert.match(loadMore, /if \(!currentSearchQuery \|\| isLoadingMore \|\| !currentSearchHasMore\) return/);
assert.match(loadMore, /await fetchSealedSearchPage[\s\S]*?if \(requestVersion !== searchRequestVersion\) return/);
assert.match(loadMore, /paginationState\.page = 1;\s*renderProducts\(merged, loadLastResults\(\) \|\| undefined\);\s*scrollResultsToTop\(\)/);
assert.match(loadMore, /finally \{\s*if \(requestVersion === searchRequestVersion\)/);
const clear = section('    function clearResultsUI(', '    if (form && input)');
assert.match(clear, /searchRequestVersion\+\+/);
assert.match(clear, /paginateProducts\(\[\]\)/);

// Inspect downstream renderers reached by API and restored storage values.
const unsafeSink = /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/;
assert.doesNotMatch(renderer, unsafeSink);
assert.doesNotMatch(paging, unsafeSink);
assert.doesNotMatch(utilitySource, unsafeSink);
assert.match(renderer, /document\.createElement\(/);
assert.match(renderer, /title\.textContent = String\(p\?\.name/);
const marketRenderer = section('    function renderMarketLineContent(', '\n    function ');
assert.doesNotMatch(marketRenderer, unsafeSink);
assert.match(marketRenderer, /\.textContent\s*=/);

console.log('Sealed responsive pagination, variant ordering, load lifecycle, scroll, and XSS checks passed.');

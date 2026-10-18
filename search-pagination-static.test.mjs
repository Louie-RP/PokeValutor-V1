import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const collectionView = require('./collection-view-utils.js');
const [source, html, utilitySource, styles] = await Promise.all([
    readFile('search.js', 'utf8'),
    readFile('search.html', 'utf8'),
    readFile('collection-view-utils.js', 'utf8'),
    readFile('styles.css', 'utf8'),
]);

for (const [mobile, pageSize] of [[true, 36], [false, 60]]) {
    assert.equal(collectionView.getResponsivePageSize({
        matchMedia(query) {
            assert.equal(query, '(max-width: 767.98px)');
            return { matches: mobile };
        },
    }), pageSize);

    for (const count of [0, 1, pageSize, pageSize + 1, 137]) {
        const first = collectionView.getPagination(count, pageSize, -1);
        const last = collectionView.getPagination(count, pageSize, 999);
        assert.equal(first.currentPage, 1);
        assert.equal(last.currentPage, Math.max(1, Math.ceil(count / pageSize)));
        assert.equal(last.endIndex, count);
        const cards = Array.from({ length: count }, (_, id) => id);
        const seen = [];
        for (let page = 1; page <= last.totalPages; page++) {
            const bounds = collectionView.getPagination(count, pageSize, page);
            seen.push(...cards.slice(bounds.startIndex, bounds.endIndex));
        }
        assert.deepEqual(seen, cards, 'Every loaded card must be reachable exactly once.');
    }
}

function element(documentObject) {
    return {
        ownerDocument: documentObject,
        children: [],
        attributes: {},
        handlers: {},
        hidden: false,
        textContent: '',
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; },
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(name, handler) { this.handlers[name] = handler; },
    };
}
const documentObject = { createElement() { return element(documentObject); } };
const container = element(documentObject);
let currentPage = 1;
function render() {
    collectionView.renderPagination(container, {
        totalItems: 137,
        pageSize: 60,
        currentPage,
        pagesLabel: 'Search result pages',
        onPageChange(page) { currentPage = page; render(); },
    });
}
function controls() { return container.children[0].children[1]; }
function click(label) {
    const button = controls().children.find((child) => child.textContent === label);
    assert.ok(button && !button.disabled, `${label} should be available.`);
    button.handlers.click();
}
render();
assert.equal(controls().attributes['aria-label'], 'Search result pages');
assert.equal(controls().children[0].disabled, true);
assert.equal(controls().children[1].disabled, true);
click('Next');
assert.equal(currentPage, 2);
assert.equal(container.children[0].children[0].textContent, 'Showing 61-120 of 137');
click('Last');
assert.equal(currentPage, 3);
assert.equal(controls().children[3].disabled, true);
assert.equal(controls().children[4].disabled, true);
click('Previous');
assert.equal(currentPage, 2);
click('First');
assert.equal(currentPage, 1);
collectionView.renderPagination(container, { totalItems: 60, pageSize: 60 });
assert.equal(container.hidden, true);
assert.deepEqual(container.children, []);

for (const [count, pageSize, totalPages] of [
    [1, 60, 1],
    [15, 60, 1],
    [45, 60, 1],
    [60, 60, 1],
    [61, 60, 2],
    [45, 36, 2],
]) {
    collectionView.renderPagination(container, {
        totalItems: count,
        pageSize,
        currentPage: 1,
        showSinglePage: true,
    });
    assert.equal(container.hidden, false, 'Search pagination stays visible at both viewport sizes.');
    assert.equal(controls().children[2].textContent, `Page 1 of ${totalPages}`);
    assert.equal(controls().children[0].disabled, true);
    assert.equal(controls().children[1].disabled, true);
    assert.equal(controls().children[3].disabled, totalPages === 1);
    assert.equal(controls().children[4].disabled, totalPages === 1);
}
collectionView.renderPagination(container, { totalItems: 0, pageSize: 60, showSinglePage: true });
assert.equal(container.hidden, true, 'Empty results must still hide pagination.');
assert.deepEqual(container.children, []);

assert.ok(html.indexOf('collection-view-utils.js') < html.indexOf('src="search.js'));
for (const position of ['top', 'bottom']) {
    assert.match(html, new RegExp(`id="pv-search-pagination-${position}"[^>]*hidden`));
}
assert.match(html, /id="pv-search-results-title"[^>]*tabindex="-1"/);
assert.doesNotMatch(html, /pv-search-load-more-help|Pages browse loaded cards/);
assert.doesNotMatch(source, /loadMoreHelp|pv-search-load-more-help/);
assert.match(styles, /:is\(#pv-search-body, #pv-dex-body, #pv-shared-body\) \.pv-collectionPagination/);

const renderStart = source.indexOf('    function renderCards(');
const renderEnd = source.indexOf('\n    async function searchByName(', renderStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart);
const renderer = source.slice(renderStart, renderEnd);
assert.match(renderer, /currentResultsCards = sourceCards\.slice\(\)/);
assert.match(renderer, /const sortedCards = sourceCards\.slice\(\)\.sort\(compareSearchCardsForSort\);\s*const visibleCards = paginateSearchCards\(sortedCards\);/);
assert.match(renderer, /for \(const card of visibleCards\)/);

const pagingStart = source.indexOf('    function paginateSearchCards(');
const pagingEnd = source.indexOf('    function renderCards(', pagingStart);
const paging = source.slice(pagingStart, pagingEnd);
assert.match(paging, /collectionView\.getResponsivePageSize\(window\)/);
assert.match(paging, /showSinglePage: true/, 'Search must opt into single-page controls on desktop and mobile.');
assert.match(paging, /firstVisibleIndex = \(searchPaginationState\.page - 1\) \* searchPaginationState\.perPage/);
assert.match(paging, /return sortedCards\.slice\(pagination\.startIndex, pagination\.endIndex\)/);
assert.match(paging, /onPageChange\(page\)[\s\S]*renderCards\(currentResultsCards,[\s\S]*scrollSearchResultsToTop\(\)/);
assert.doesNotMatch(paging, /fetchCardsSearchPage|fetchJsonWithCache/);
assert.match(paging, /addEventListener\('change'/);

const sortStart = source.indexOf('    function bindSearchSortControls(');
const sortEnd = source.indexOf('    const FAVORITES_SORT_MODES', sortStart);
assert.match(source.slice(sortStart, sortEnd), /searchPaginationState\.page = 1;[\s\S]*renderCards\(currentResultsCards,/);
assert.match(source, /if \(searchResultsLoading \|\| grid\.querySelector\('\.pv-skeleton'\)\) return/,
    'A queued price sort must not overwrite loading placeholders for a new search.');
assert.match(source, /expectedIds\.some\(\(id\) => !renderedIds\.includes\(id\)\)/,
    'Asynchronous prices must reconcile page membership, not just reorder visible nodes.');

const moreStart = source.indexOf('    async function loadMoreDexSetCards(');
const moreEnd = source.indexOf('    if (form && input)', moreStart);
const loadMore = source.slice(moreStart, moreEnd);
assert.match(loadMore, /if \(loadingBrowseState === dexSetBrowseState\) return/);
assert.match(loadMore, /await fetchCardsSearchPage[\s\S]*if \(dexSetBrowseState !== browseState\) return/);
assert.match(loadMore, /searchPaginationState\.page = 1;\s*renderCards\(merged, restored \|\| undefined\);\s*scrollSearchResultsToTop\(\)/);
assert.match(loadMore, /finally[\s\S]*loadingBrowseState = null/);
assert.match(source, /prefers-reduced-motion: reduce/);
assert.match(source, /const restoredCards = !isSearchPage && restored\.cards\.length > MAX_RESTORE_RENDER_CARDS/,
    'Search pagination must make all cached results reachable instead of truncating restoration.');
assert.match(source, /function clearResultsUI\(\)[\s\S]*?paginateSearchCards\(\[\]\)/,
    'Clearing results must also remove both pagers.');

// Inspect the downstream card and pagination renderers reached by API/storage data.
const unsafeSink = /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/;
assert.doesNotMatch(renderer, unsafeSink);
assert.doesNotMatch(paging, unsafeSink);
assert.doesNotMatch(utilitySource, unsafeSink);
assert.match(renderer, /document\.createElement\(/);
assert.match(renderer, /\.textContent\s*=/);
assert.match(renderer, /sanitizeUrl\(pickFrontMediumImage\(card\?\.images\)\)/);

console.log('Search pagination responsive sizes, navigation, sorting, loading, and XSS checks passed.');

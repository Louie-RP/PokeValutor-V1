import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (file) => readFile(new URL(file, import.meta.url), 'utf8');
const [home, sealed, cards] = await Promise.all([
    read('home-preview.js'),
    read('sealed.js'),
    read('search.js'),
]);
const functionBody = (source, start, end) => {
    const from = source.indexOf(start);
    const to = source.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `Missing function boundaries: ${start}`);
    return source.slice(from, to);
};

test('home search links encode queries for both destinations, including restored previews', () => {
    const href = functionBody(home, 'function getLiveSearchHref(', 'function updateSearchPreview(');
    assert.match(href, /mode === 'sealed' \? 'sealed\.html' : 'search\.html'/);
    assert.match(href, /new URLSearchParams\(\{ query, source: 'home-preview' \}\)/);
    assert.match(home, /resultLink\.href = getLiveSearchHref\(activeMode, cachedSearch\.query\)/);
    for (const mode of ['cards', 'sealed']) {
        assert.match(home, new RegExp(`linkHref: getLiveSearchHref\\('${mode}', query\\)`));
    }
    const row = functionBody(home, 'function createLiveSealedRow(', 'function renderCachedSearchResults(');
    assert.match(row, /detailsLink\.href = getLiveSearchHref\('sealed', name\)/);
});

test('URL text queries prefill without automatically consuming search credits', () => {
    assert.match(sealed, /const deepLinkQuery = \(new URLSearchParams\(window\.location\.search\)\.get\('query'\) \|\| ''\)\.trim\(\)/);
    assert.match(sealed, /const restored = deepLinkQuery \? null : loadLastResults\(\)/);
    const readyBranch = /(?:else )?if \(deepLinkQuery\) \{\s*(?:activateDexSearchMode\(\);\s*)?if \(input\) input\.value = deepLinkQuery;\s*setStatus\('Search is ready\.[^']*'\);/g;
    assert.equal([...sealed.matchAll(readyBranch)].length, 1);
    assert.equal([...cards.matchAll(readyBranch)].length, 2, 'Both Card Search and Dex must require confirmation.');
    for (const source of [sealed, cards]) {
        assert.doesNotMatch(source, /searchByName\(deepLinkQuery\)/);
        assert.match(source, /addEventListener\('submit',[\s\S]*?searchByName\((?:input\.value|query)\)/,
            'Submitting the form must still execute searches.');
    }
    assert.match(cards, /const shouldRestoreResults = !deepLinkQuery && \(!deepLinkExpansionId \|\| matchesDeepLinkExpansion\)/);
    assert.match(cards, /else if \(deepLinkQuery\) \{\s*activateDexSearchMode\(\)/,
        'Dex must open Quick Add so users can confirm the prefilled query.');
});

test('clearing removes saved results and only recognized search URL parameters', () => {
    const sealedClear = functionBody(sealed, "clearBtn.addEventListener('click'", 'if (loadMoreBtn)');
    const cardClear = functionBody(cards, "clearBtn.addEventListener('click'", 'let deepLinkExpansionId');
    const sealedReset = functionBody(sealed, 'function clearResultsUI(', 'if (form && input)');
    assert.match(sealedReset, /clearLastResults\(\)/);
    assert.match(sealedReset, /searchRequestVersion\+\+/,
        'Pending sealed requests must not repopulate cleared saved results.');
    assert.match(cardClear, /clearLastResults\(\)/);
    assert.match(sealedClear, /params\.delete\('query'\)/);
    assert.match(cardClear, /\['query', 'cardId', 'cardName', 'expansionId', 'expansionName'\]/);
    for (const clear of [sealedClear, cardClear]) {
        assert.match(clear, /clearResultsUI\(\)/);
        assert.match(clear, /new URLSearchParams\(window\.location\.search\)/);
        assert.match(clear, /if \(params\.get\('source'\) === 'home-preview'\) params\.delete\('source'\)/);
        assert.match(clear, /params\.toString\(\)/);
        assert.match(clear, /window\.location\.hash/);
        assert.match(clear, /window\.history\.replaceState\(window\.history\.state, '', nextUrl\)/);
        assert.doesNotMatch(clear, /params\.delete\('(?:utm_source|campaign|ref)'\)/);
    }
});

test('direct card and set links retain their existing behavior', () => {
    assert.match(cards, /deepLinkQuery = \(params\.get\('query'\) \|\| ''\)\.trim\(\)/);
    assert.match(cards, /if \(deepLinkCardId\) \{\s*void searchByCardId\(deepLinkCardId, deepLinkCardName\)/);
    assert.match(cards, /else if \(deepLinkExpansionId\) \{\s*void searchTopByExpansion\(/);
    const row = functionBody(home, 'function createLiveCardRow(', 'function createLiveSealedRow(');
    assert.match(row, /new URLSearchParams\(\{ cardId: id, cardName: name \}\)/);
});

test('downstream sealed results and home rows render external names without HTML parsing', () => {
    const renderer = functionBody(sealed, 'function renderProducts(', 'async function searchByName(');
    assert.match(renderer, /title\.textContent = String\(p\?\.name \|\| 'Unknown'\)/);
    assert.match(renderer, /setNameLine\.textContent = getSealedSetName\(p\)/);
    assert.match(renderer, /option\.textContent = `\$\{pp\}%`/);
    const rows = functionBody(home, 'function createLiveCardRow(', 'function renderCachedSearchResults(');
    assert.match(rows, /nameElement\.textContent = name/);
    for (const source of [renderer, rows]) {
        assert.doesNotMatch(source, /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/);
    }
});

test('both home entries and the sealed page load cache-busted handoff scripts', async () => {
    for (const file of ['index.html', 'home-preview.html']) {
        assert.match(await read(file), /home-preview\.js\?v=2026-10-18-search-handoff-1/);
    }
    assert.match(await read('sealed.html'), /sealed\.js\?v=2026-10-18-review-handoff-1/);
    for (const file of ['search.html', 'dex.html']) {
        assert.match(await read(file), /search\.js\?v=2026-10-18-review-handoff-1/);
    }
});

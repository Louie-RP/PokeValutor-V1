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

test('sealed URL queries auto-search and take precedence over saved results', () => {
    assert.match(sealed, /const deepLinkQuery = \(new URLSearchParams\(window\.location\.search\)\.get\('query'\) \|\| ''\)\.trim\(\)/);
    assert.match(sealed, /const restored = deepLinkQuery \? null : loadLastResults\(\)/);
    assert.match(sealed, /if \(deepLinkQuery\) \{\s*if \(input\) input\.value = deepLinkQuery;\s*void searchByName\(deepLinkQuery\);/);
    const clear = functionBody(sealed, "clearBtn.addEventListener('click'", 'if (loadMoreBtn)');
    assert.match(clear, /clearResultsUI\(\)/);
    assert.match(clear, /window\.history\.replaceState\(null, '', window\.location\.pathname \+ window\.location\.hash\)/);
});

test('card query and exact-card handoffs remain connected to their searches', () => {
    assert.match(cards, /deepLinkQuery = params\.get\('query'\) \|\| ''/);
    assert.match(cards, /else if \(deepLinkQuery\) \{\s*if \(input\) input\.value = deepLinkQuery;\s*void searchByName\(deepLinkQuery\);/);
    assert.match(cards, /if \(deepLinkCardId\) \{\s*void searchByCardId\(deepLinkCardId, deepLinkCardName\)/);
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
    assert.match(await read('sealed.html'), /sealed\.js\?v=2026-10-18-search-handoff-1/);
});

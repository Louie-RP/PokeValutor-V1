'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const homeSource = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const searchSource = fs.readFileSync(path.join(root, 'search.js'), 'utf8');

const linkHelper = homeSource.match(
  /function buildSearchLinkForCard\(cardLike\) \{[\s\S]*?\n  \}/
)?.[0] || '';
const exactCardSearch = searchSource.match(
  /async function searchByCardId\(cardId, cardName\) \{[\s\S]*?\n    \}/
)?.[0] || '';

assert.match(linkHelper, /params\.set\('cardId', cardId\)/);
assert.doesNotMatch(linkHelper, /expansionId/);
assert.match(searchSource, /deepLinkCardId = params\.get\('cardId'\) \|\| ''/);
assert.match(exactCardSearch, /\/cards\/\$\{encodeURIComponent\(id\)\}/);
assert.match(exactCardSearch, /renderCards\(cards\)/);

// XSS regression: URL values must be encoded through URLSearchParams, and the
// deep-link loading state must construct nodes without an HTML parsing sink.
assert.match(linkHelper, /new URLSearchParams\(\)/);
assert.doesNotMatch(linkHelper, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
assert.match(exactCardSearch, /grid\.textContent = ''/);
assert.doesNotMatch(exactCardSearch, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);

console.log('Trending card exact-search and XSS checks passed.');

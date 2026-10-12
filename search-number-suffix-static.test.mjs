import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile('search.js', 'utf8');
const start = source.indexOf('    function isLikelyCardNumberQuery(');
const end = source.indexOf('    function formatPriceList(', start);

assert.ok(start >= 0 && end > start, 'Card-number query classifier should be present.');

const classifier = source.slice(start, end);
assert.match(
    classifier,
    /\/\^\\d\{1,4\}\[A-Z\]\\\/\\d\{1,4\}\$\/\.test\(upper\)/,
    'Collector numbers with a letter suffix, such as 77a/73, should use number search.',
);
assert.match(
    classifier,
    /\/\^\\d\{1,4\}\[A-Z\]\$\/\.test\(upper\)/,
    'Collector number fragments with a letter suffix, such as 77a, should use number search.',
);

console.log('Search suffixed-number regression check passed.');

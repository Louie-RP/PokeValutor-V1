import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile('search.js', 'utf8');
const start = source.indexOf('    function buildCanonicalPokemonName(');
const end = source.indexOf('    function isLikelyCardNumberQuery(', start);

assert.ok(start >= 0 && end > start, 'Name query candidate builder should be present.');

const builder = source.slice(start, end);
assert.match(builder, /replace\(\/\\bpoke\\b\/gi/);
assert.match(builder, /'Poké'/);
assert.match(builder, /'poké'/);
assert.match(
    builder,
    /push\(buildFieldQuery\('name', canonicalName\)\)/,
    'Unaccented Pokemon names should try the canonical accented exact query.',
);
assert.ok(
    builder.indexOf("push(buildFieldQuery('name', canonicalName))") < builder.indexOf('const tokens ='),
    'The canonical exact query should run before wildcard fallbacks.',
);

console.log('Search name accent regression check passed.');
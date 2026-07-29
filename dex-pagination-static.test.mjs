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

console.log('Dex pagination static, boundary-navigation, and XSS checks passed.');

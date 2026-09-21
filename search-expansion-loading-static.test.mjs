import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile('search.js', 'utf8');

assert.match(
    source,
    /restored\?\.mode === 'expansion' && restoredId === requestedId/,
    'Only an exact expansion-mode result set should remain visible during a top-cards refresh.',
);
assert.match(
    source,
    /const shouldRestoreResults = !deepLinkExpansionId \|\| matchesDeepLinkExpansion;/,
    'A different expansion deep link must skip restoration of stale cards.',
);
assert.match(
    source,
    /if \(!preserveExistingResults\) \{\s*setStatus\(''\);\s*renderCardSkeletons\(grid, RESULT_LIMIT, `Loading top cards[^`]+`\);\s*revealExpansionLoadingResults\(\);\s*\}/,
    'A different set should show its loading message in the results grid and clear the small page status.',
);
assert.match(
    source,
    /const messageText = safeString\(loadingMessage, ''\)\.trim\(\);[\s\S]*label\.textContent = messageText;/,
    'The results loading message must render untrusted set names through textContent.',
);
assert.match(
    source,
    /preserveExistingResults: restoredMatchingDeepLinkExpansion/,
    'Visible cards should only be replaced by loading skeletons for a different result set.',
);
assert.match(
    source,
    /if \(!isSearchPage \|\| !searchResultsEl \|\| !window\.matchMedia\('\(max-width: 767\.98px\)'\)\.matches\) return;/,
    'Only the mobile Search page should automatically reveal expansion loading results.',
);
assert.match(
    source,
    /renderCardSkeletons\(grid, RESULT_LIMIT, `Loading top cards[^`]+`\);\s*revealExpansionLoadingResults\(\);/,
    'A different-set expansion load should reveal its loading panel after rendering it.',
);
assert.match(
    source,
    /const dataPromise = fetchJsonWithCache\(url, SEARCH_TTL_MS\);\s*const \[data\] = await Promise\.all\(\[\s*dataPromise,\s*preserveExistingResults \? Promise\.resolve\(\) : waitForSearchLoadingPaint\(\),/,
    'The request should start immediately while a visible loader receives one browser paint.',
);

console.log('Expansion loading-state regression checks passed.');
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
    /if \(!preserveExistingResults\) \{\s*setStatus\(''\);\s*renderCardSkeletons\(grid, RESULT_LIMIT, `Loading top cards[^`]+`\);\s*\}/,
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

console.log('Expansion loading-state regression checks passed.');
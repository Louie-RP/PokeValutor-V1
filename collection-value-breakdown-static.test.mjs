import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, script, styles] = await Promise.all([
    readFile('dex.html', 'utf8'),
    readFile('dex-tracker-pages.js', 'utf8'),
    readFile('styles.css', 'utf8'),
]);

assert.match(
    html,
    /id="pv-collection-value-info"[\s\S]*data-collection-value-hint=/,
    'Priced coverage should be exposed from the info tooltip.',
);
assert.match(
    html,
    /<span class="pv-collectionTotalValue">\s*Value:\s*<button[\s\S]*?id="pv-collection-total-value"[\s\S]*?class="pv-collectionTotalValueButton"[\s\S]*?aria-label="View collection value breakdown"[\s\S]*?>\$0\.00<\/button>/,
    'Only the collection value amount should be the accessible breakdown trigger.',
);
assert.match(
    html,
    /id="pv-collection-card-value"[\s\S]*id="pv-collection-sealed-value"[\s\S]*id="pv-collection-breakdown-total"/,
    'The dialog should show card, sealed, and combined values.',
);

assert.match(styles, /\.pv-collectionTotalValueButton\s*\{[\s\S]*?text-decoration: underline;/);
assert.match(styles, /\.pv-collectionValueInfoBtn::after\s*\{[\s\S]*?content: attr\(data-collection-value-hint\);/);

assert.match(script, /sealedValue \+= itemTotal;/, 'Sealed values should contribute to the sealed subtotal.');
assert.match(script, /cardValue \+= cardTotal;/, 'Card values should contribute to the card subtotal.');
assert.match(
    script,
    /const refreshGeneration = \+\+collectionValueRefreshGeneration;[\s\S]*?resetCollectionValueBreakdownState\(\);/,
    'Each refresh should get a new generation and clear the previous breakdown first.',
);
assert.match(
    script,
    /function resetCollectionValueBreakdownState\(\) \{[\s\S]*?cardValue = 0;[\s\S]*?sealedValue = 0;[\s\S]*?totalValue = 0;[\s\S]*?renderCollectionValueBreakdownValues\(\);/,
    'Resetting breakdown state should also repaint an open dialog.',
);
const refreshGenerationChecks = script.match(/refreshGeneration !== collectionValueRefreshGeneration/g) || [];
assert.ok(
    refreshGenerationChecks.length >= 4,
    'Async sealed, card, item, and final publication paths should reject stale refresh generations.',
);
assert.match(
    script,
    /if \(refreshGeneration !== collectionValueRefreshGeneration\) \{[\s\S]*?stale: true/,
    'An out-of-order refresh should return without publishing stale totals.',
);
assert.match(
    script,
    /if \(!items\.length\) \{\s*collectionValueRefreshGeneration \+= 1;\s*resetCollectionValueBreakdownState\(\);/,
    'An empty collection render should invalidate pending refreshes and clear the breakdown.',
);
assert.match(script, /if \(result\?\.stale\) return;/, 'Stale refreshes should not trigger follow-up renders.');
assert.match(
    script,
    /setCollectionTotalValueText\(`Value: \$\{formatUsd\(total\)\}`, coverage\);/,
    'The large value and smaller coverage label should be updated independently.',
);
assert.match(
    script,
    /function getCollectionValueAmountText\(valueText\)[\s\S]*?replace\(\/\^Value:\\s\*\/i, ''\)/,
    'Dex should strip the plain-text Value label before updating the clickable amount.',
);
assert.match(script, /breakdownBtn\.disabled = hidden;/, 'Privacy mode should disable the Value breakdown trigger.');
assert.match(script, /infoBtn\.disabled = hidden;/, 'Privacy mode should disable the coverage tooltip trigger.');

const binderStart = script.indexOf('function renderCollectionValueBreakdownValues()');
const binderEnd = script.indexOf('\n    function setCollectionTotalValueText', binderStart);
assert.ok(binderStart >= 0 && binderEnd > binderStart, 'The breakdown renderer and dialog binder should exist.');
const binder = script.slice(binderStart, binderEnd);
assert.match(binder, /\.textContent = formatUsd\(/, 'Breakdown values should render through textContent.');
assert.match(binder, /bindValueSummaryInteractions\(/, 'Dex should use the shared value-summary interaction helper.');
assert.doesNotMatch(
    binder,
    /Total value:.*coverageText/,
    'Pricing coverage should live in the info tooltip rather than the breakdown total.',
);
assert.doesNotMatch(
    binder,
    /innerHTML|outerHTML|insertAdjacentHTML|document\.write/,
    'The external-data breakdown renderer must not use an unsafe HTML sink.',
);

console.log('Collection value breakdown regression checks passed.');
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import trade from './trade-workspace.js';

assert.equal(trade.normalizePercent(undefined), 80);
assert.equal(trade.normalizePercent(150), 100);
assert.equal(trade.normalizePercent(-20), 0);

const searchMarkup = await readFile('search.html', 'utf8');
assert.match(searchMarkup, /id="pv-trade-target"/);
assert.match(searchMarkup, /max="10000000"/);
assert.match(searchMarkup, /id="pv-trade-target-help"[^>]*data-tooltip=/);
assert.match(searchMarkup, /id="pv-trade-target-help"[^>]*>i<\/span>/);
assert.match(searchMarkup, /class="pv-trade__summary"[\s\S]*id="pv-trade-totals"/);
assert.match(searchMarkup, /id="pv-trade-title"[^>]*>Trade<\/h2>[\s\S]*pv-trade-apply-percent/);
assert.match(searchMarkup, /pv-trade__bulk[\s\S]*pv-trade-apply-percent-button/);
assert.match(searchMarkup, /pv-trade__bulkHelp/);
assert.match(searchMarkup, /pv-trade__bulkActions[\s\S]*pv-trade-apply-percent-button/);
assert.match(searchMarkup, /id="pv-trade-remaining"/);
assert.match(searchMarkup, /pv-trade__goalDivider/);
assert.match(searchMarkup, /id="pv-trade-toggle"[\s\S]*id="pv-trade-clear"/);
assert.match(searchMarkup, /styles\.css\?v=20260817-trade-summary-1/);
const stylesSource = await readFile('styles.css', 'utf8');
assert.match(stylesSource, /pv-trade__summary[\s\S]*margin-top: 0\.9rem/);
assert.match(stylesSource, /pv-trade__target \.form-label[\s\S]*font-size: 0\.92rem/);
assert.match(stylesSource, /grid-template-columns: minmax\(0, 1fr\) auto/);
assert.match(stylesSource, /pv-trade__target[\s\S]*grid-column: 1 \/ -1/);

const first = {
    id: 'base1-4',
    name: '<Charizard>',
    expansion: { id: 'base1', name: 'Base Set' },
    image: 'javascript:alert(1)',
    marketValue: 100,
    tradePercent: 50,
    selectedVariant: '</select><script>alert(1)</script>',
};
const workspace = trade.addOrUpdateTradeItem({ items: [] }, first, 1000);
assert.equal(workspace.items.length, 1);
assert.equal(workspace.items[0].image, '');
assert.equal(workspace.items[0].tradePercent, 50);
assert.equal(workspace.items[0].selectedCondition, 'NM');

const duplicate = trade.addOrUpdateTradeItem(workspace, { ...first, name: 'Updated', marketValue: 120, tradePercent: 100 }, 2000);
assert.equal(duplicate.items.length, 1);
assert.equal(duplicate.items[0].name, 'Updated');
assert.equal(duplicate.items[0].marketValue, 120);
assert.equal(duplicate.items[0].tradePercent, 50);

const conditioned = trade.addOrUpdateTradeItem({ items: [] }, {
    id: 'conditioned-card',
    marketValue: 100,
    conditionValues: { NM: 100, LP: 72.5, MP: 48 },
}, 2500);
const lightlyPlayed = trade.setTradeItemCondition(conditioned, 'conditioned-card', 'LP', 2600);
assert.equal(lightlyPlayed.items[0].selectedCondition, 'LP');
assert.equal(lightlyPlayed.items[0].marketValue, 72.5);
assert.equal(trade.normalizeTradeItem({
    id: 'lp-only',
    selectedCondition: 'LP',
    conditionValues: { LP: 12.5 },
    marketValue: null,
}).marketValue, 12.5);

const totals = trade.calculateTradeTotals([
    { marketValue: 100, tradePercent: 50 },
    { marketValue: 10, tradePercent: 100 },
    { marketValue: null, tradePercent: 80 },
]);
assert.deepEqual(totals, {
    pricedItemCount: 2,
    unpricedItemCount: 1,
    rawMarketTotal: 110,
    tradeAdjustedTotal: 60,
    effectiveTradePercent: (60 / 110) * 100,
});

const capped = trade.normalizeWorkspace({
    items: Array.from({ length: 55 }, (_, index) => ({ id: `card-${index}`, marketValue: 0 })),
});
assert.equal(capped.items.length, 50);

const storage = new Map();
const storageAdapter = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
};
trade.saveTradeWorkspace(duplicate, storageAdapter, 3000);
assert.equal(trade.loadTradeWorkspace(storageAdapter).items[0].id, 'base1-4');

const [searchSource, cardSource] = await Promise.all([
    readFile('search.js', 'utf8'),
    readFile('card.js', 'utf8'),
]);
for (const [label, source] of [['Search', searchSource], ['Card Details', cardSource]]) {
    assert.doesNotMatch(
        source,
        /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/,
        `${label} Trade integration must not add unsafe HTML sinks.`,
    );
}
assert.match(searchSource, /tradeApi\.calculateTradeTotals\(tradeWorkspace\.items\)/);
assert.match(searchSource, /pv-tradeTotals__market/);
assert.match(searchSource, /pv-tradeTotals__trade/);
assert.match(searchSource, /pv-tradeTotals__unavailable/);
assert.match(searchSource, /pv-tradeTotals__separator/);
assert.match(searchSource, /tradeRemainingEl\.appendChild/);
assert.match(searchSource, /renderTradeWorkspace\(tradeTargetInput\.value\)/);
assert.match(searchSource, /placeTradeBulkForViewport/);
assert.match(stylesSource, /pv-trade__bulk \.pv-sortSelect[\s\S]*min-width: 88px/);
assert.match(stylesSource, /#pv-search-body #pv-trade \.pv-tradeTotals__remaining/);
assert.match(stylesSource, /#pv-search-body #pv-trade \.pv-tradeTotals__targetMet/);
assert.match(stylesSource, /pv-tradeTotals__remaining[\s\S]*font-weight: 700/);
assert.match(stylesSource, /pv-tradeTotals__targetMet[\s\S]*font-weight: 700/);
assert.match(stylesSource, /pv-tradeTotals__remaining[\s\S]*font-family: "Space Grotesk"[\s\S]*font-size: 0\.92rem/);
assert.match(stylesSource, /pv-tradeTotals__targetMet[\s\S]*font-family: "Space Grotesk"[\s\S]*font-size: 0\.92rem/);
assert.match(stylesSource, /@media \(min-width: 641px\)[\s\S]*pv-trade__remaining[\s\S]*align-self: baseline/);
assert.match(searchSource, /normalizeTradeTarget/);
assert.match(searchSource, /pv-tradeTotals__remaining/);
assert.match(searchSource, /pv-tradeTotals__targetMet/);
assert.match(searchSource, /syncTradeResultButtons\(\)/);
assert.match(searchSource, /data-trade-card-id/);
assert.match(await readFile('styles.css', 'utf8'), /#pv-search-body #pv-trade-totals[\s\S]*font-family: "Space Grotesk"/);
assert.match(searchSource, /conditionValues/);
assert.match(searchSource, /pv-tradeCard__details/);
assert.match(searchSource, /cardDetailsSummary\.textContent = 'Card details'/);
assert.match(searchSource, /col-12 col-md-6 pv-trade__item/);
assert.match(cardSource, /tradeApi\.addOrUpdateTradeItem\(workspace/);

console.log('Trade workspace normalization, persistence, totals, and XSS checks passed.');
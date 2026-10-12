import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [frontend, data, chart, service, card, html, flags, css] = await Promise.all([
    readFile('price-history.js', 'utf8'),
    readFile('price-history-data.js', 'utf8'),
    readFile('price-history-chart.js', 'utf8'),
    readFile('price-history-service.js', 'utf8'),
    readFile('card.js', 'utf8'),
    readFile('card.html', 'utf8'),
    readFile('feature-flags.js', 'utf8'),
    readFile('price-history.css', 'utf8'),
]);
const renderer = `${frontend}\n${data}\n${chart}\n${service}`;

// XSS regression check required by AGENTS.md for external-data rendering.
assert.doesNotMatch(
    renderer,
    /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/,
    'Price history must build external-data UI with safe DOM APIs.',
);
assert.match(renderer, /PV_DOM\?\.createElement/);
assert.match(renderer, /PV_DOM\?\.createSvgElement/);
assert.match(renderer, /\.textContent\s*=/);

assert.match(frontend, /const CONDITION = 'NM'/);
assert.match(frontend, /const RANGE_DAYS = \[7, 30, 90\]/);
assert.doesNotMatch(frontend, /(?:1Y|365D|365 days)/i);
assert.match(renderer, /new Set\(\['premium', 'admin', 'tester'\]\)/);
assert.match(frontend, /PV_FEATURES\?\.\[FEATURE_NAME\] === true/);
assert.doesNotMatch(frontend, /tier === 'pro'/);
assert.match(frontend, /addEventListener\('click', \(\) => loadHistory\(\)\)/);
assert.match(renderer, /Authorization: `Bearer \$\{token\}`/);
assert.match(renderer, /cache: 'no-store'/);
assert.match(frontend, /buildPreviewPoints\(\)/);
assert.match(renderer, /\^\(\\d\{4\}\)\(\[\/-\]\)/);
assert.match(renderer, /value === null \|\| value === undefined \|\| value === ''/);
assert.match(renderer, /function calculateMetrics\(/);
assert.match(renderer, /function niceScale\(/);
assert.match(renderer, /pv-priceHistory__crosshair/);
assert.match(renderer, /pv-priceHistory__tooltip/);
assert.match(renderer, /vs\. prior day/);
assert.match(frontend, /pv-price-history-active-variant/);
assert.doesNotMatch(frontend, /Change variant/);

assert.match(card, /new CustomEvent\('pv:card-loaded'/);
assert.match(card, /cardId: safeString\(card\?\.id, ''\)/);
assert.match(html, /id="pv-price-history"/);
assert.match(html, /id="pv-price-history-root"/);
assert.match(html, />Price History<\/h2>/);
assert.doesNotMatch(html, /id="pv-card-history-table"/);
assert.doesNotMatch(html, /id="pv-history-condition"/);

const featureFlagsIndex = html.indexOf('src="feature-flags.js');
const cardIndex = html.indexOf('src="card.js');
const priceHistoryIndex = html.indexOf('src="price-history.js');
assert.ok(featureFlagsIndex >= 0 && cardIndex > featureFlagsIndex && priceHistoryIndex > cardIndex);
assert.match(html, /href="price-history\.css/);
assert.match(flags, /priceHistory: (?:true|false)/);

assert.match(css, /\.pv-priceHistory/);
assert.match(css, /\.pv-priceHistory\.is-positive/);
assert.match(css, /\.pv-priceHistory\.is-negative/);
assert.match(css, /url\("#pv-price-history-area-gradient"\)/);
assert.doesNotMatch(css, /(^|\})\s*(?:button|select|svg|section|table|form)\b[^{]*\{/m);

console.log('Price-history frontend static and XSS checks passed.');

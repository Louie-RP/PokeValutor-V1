import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [frontend, data, chart, html, css, pageCss] = await Promise.all([
    readFile('price-history.js', 'utf8'),
    readFile('price-history-data.js', 'utf8'),
    readFile('price-history-chart.js', 'utf8'),
    readFile('card.html', 'utf8'),
    readFile('price-history.css', 'utf8'),
    readFile('styles.css', 'utf8'),
]);
const renderer = `${frontend}\n${data}\n${chart}`;

// External price-history data must only reach the UI through safe DOM APIs.
assert.doesNotMatch(
    renderer,
    /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/,
    'Price history must not render API data through an HTML parsing sink.',
);
assert.match(renderer, /PV_DOM\?\.createElement/);
assert.match(renderer, /PV_DOM\?\.createSvgElement/);
assert.match(renderer, /\.textContent\s*=/);

assert.match(frontend, /const RANGE_DAYS = \[7, 30, 90\]/);
assert.doesNotMatch(frontend, /(?:1Y|365D|365 days)/i);
assert.match(renderer, /function calculateMetrics\(/);
assert.match(renderer, /function niceScale\(/);
assert.match(renderer, /pv-priceHistory__crosshair/);
assert.match(renderer, /pv-priceHistory__tooltip/);
assert.match(renderer, /scrollContainer\.scrollLeft/);
assert.match(renderer, /scrollContainer\.clientWidth/);
assert.match(renderer, /tooltip\.offsetWidth/);
assert.match(renderer, /tooltip\.offsetHeight/);
assert.match(renderer, /classList\.toggle\(\s*'is-below'/s);
assert.match(renderer, /vs\. prior day/);
assert.match(frontend, /pv-price-history-active-variant/);
assert.doesNotMatch(frontend, /Change variant/);

assert.match(html, />Price History<\/h2>/);
assert.match(html, /class="pv-section container pv-cardPageContent"/);
assert.doesNotMatch(css, /#pv-card-history-title/);
assert.match(css, /\.pv-priceHistory\.is-positive/);
assert.match(css, /\.pv-priceHistory\.is-negative/);
assert.match(css, /url\("#pv-price-history-area-gradient"\)/);
assert.match(css, /\.pv-priceHistory__tooltip\.is-below/);
assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
assert.match(css, /grid-template-columns: minmax\(0, 1fr\) minmax\(7\.5rem, auto\)/);
assert.match(css, /min-height: 220px/);
assert.match(css, /\.pv-priceHistory__axisLabel\s*\{[^}]*fill: #cbd5e1;[^}]*opacity: 1;/s);
assert.match(
    pageCss,
    /\.pv-cardPageContent > \.pv-section\s*\{[^}]*width: 100%;[^}]*max-width: none;[^}]*padding-inline: 0;/s,
);
assert.match(pageCss, /body\s*\{[^}]*background-color: var\(--pv-bg\);/s);
assert.doesNotMatch(pageCss, /body\s*\{[^}]*background-image:/s);

console.log('Price-history UI behavior and XSS checks passed.');

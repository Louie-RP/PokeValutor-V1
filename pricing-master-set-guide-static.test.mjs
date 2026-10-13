import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const html = await readFile('pricing.html', 'utf8');
const comparisonHtml = await readFile('plan-comparison.html', 'utf8');
const css = await readFile('pricing-refresh.css', 'utf8');
const comparisonCss = await readFile('plan-comparison.css', 'utf8');
const sitemap = await readFile('sitemap.xml', 'utf8');

test('pricing page keeps Plan Comparison compact and links to detailed plan comparison', () => {
    assert.doesNotMatch(html, /pv-guidePricing/);
    assert.match(html, /href="plan-comparison\.html">View Free vs Premium comparison<\/a>/);
    assert.match(html, /Master Set Binder Guide planning tools/);
    assert.match(html, /Master Set Binder Guide PDF inserts and placeholders/);
    assert.match(html, /Launch offer: \$5\.99 - Limited time/);
    assert.match(html, /pv-pricingPlan__priceWas">\$8\.99/);
    assert.match(html, /<strong>\$5\.99<\/strong>/);
    assert.match(css, /\.pv-pricingPlansShell__details/);
    assert.match(sitemap, /<loc>https:\/\/www\.pokevaluator\.com\/plan-comparison\.html<\/loc>/);
});

test('detailed comparison page includes the Master Set Binder Guide entitlement split', () => {
    assert.match(comparisonHtml, /<title>Free vs Premium \| PokeValutor<\/title>/);
    assert.match(comparisonHtml, /<h2 id="pv-feature-table-title"[^>]*>Feature comparison<\/h2>/);
    assert.match(comparisonHtml, /<h2 id="pv-binder-guide-comparison-title"[^>]*>Master Set Binder Guide<\/h2>/);
    assert.match(comparisonHtml, /Choose binder layouts and card variants/);
    assert.match(comparisonHtml, /Export the planned binder as a PDF/);
    assert.match(comparisonHtml, /artwork inserts or ink-saving placeholders/);
    assert.match(comparisonHtml, /href="master-set-guide\.html">Open Guide and Export<\/a>/);
    assert.match(comparisonCss, /\.pv-comparisonTable/);
    assert.match(comparisonCss, /\.pv-planDetail--premium/);
});

console.log('Pricing master set guide entitlement copy passed.');
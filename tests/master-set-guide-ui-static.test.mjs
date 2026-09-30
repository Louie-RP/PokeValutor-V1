import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('master-set-guide.js', 'utf8');
const html = await readFile('master-set-guide.html', 'utf8');
const masterSetsHtml = await readFile('master-sets.html', 'utf8');
const guideIndex = JSON.parse(await readFile('data/master-set-guides/index.json', 'utf8'));
const css = await readFile('master-set-guide.css', 'utf8');

test('the downstream guide renderer avoids unsafe HTML parsing sinks', () => {
    assert.doesNotMatch(source, /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/);
    assert.match(source, /document\.createElement\(/);
    assert.match(source, /\.textContent\s*=/);
    assert.match(source, /replaceChildren\(/);
});

test('external image URLs are validated before assignment', () => {
    assert.match(source, /function getSafeImageUrl\(value\)/);
    assert.match(source, /url\.protocol === 'https:'/);
    assert.match(source, /const safeUrl = getSafeImageUrl\(rawUrl\)/);
    assert.match(source, /image\.src = safeUrl/);
});

test('uses medium images for binder thumbnails and large images for card dialogs', () => {
    assert.match(
        source,
        /slot\?\.images\?\.medium\s*\|\|\s*slot\?\.images\?\.large\s*\|\|\s*slot\?\.images\?\.small\s*\|\|\s*card\?\.images\?\.medium\s*\|\|\s*card\?\.images\?\.large\s*\|\|\s*card\?\.images\?\.small/,
    );
    assert.match(
        source,
        /const largeImageUrl = slot\?\.images\?\.large\s*\|\|\s*card\?\.images\?\.large/,
    );
    assert.match(
        source,
        /const previewImageUrl = slot\?\.images\?\.medium\s*\|\|\s*slot\?\.images\?\.small\s*\|\|\s*card\?\.images\?\.medium\s*\|\|\s*card\?\.images\?\.small\s*\|\|\s*largeImageUrl/,
    );
    assert.match(source, /preload\.onload\s*=\s*\(\)\s*=>/);
    assert.match(source, /requestId === state\.dialogImageRequestId/);
});

test('keeps lazy async image loading and contained-image styling hooks', async () => {
    assert.match(source, /image\.loading = 'lazy'/);
    assert.match(source, /image\.decoding = 'async'/);
    assert.match(css, /object-fit:\s*contain/);
    assert.match(css, /\.pv-guideSlot\s*\{[\s\S]*display:\s*flex/);
    assert.match(css, /\.pv-guideSlot\s*\{[\s\S]*flex-direction:\s*column/);
    assert.match(css, /\.pv-guideSlot__imageWrap\s*\{[\s\S]*aspect-ratio:\s*2\.5\s*\/\s*3\.5/);
    assert.match(css, /@media \(min-width: 900px\)[\s\S]*\.pv-guideSlot__imageWrap\s*\{[\s\S]*max-height:\s*clamp\(220px,\s*30vh,\s*340px\)/);
});

test('the guide never loads pricing code or asks the manifest for pricing', () => {
    assert.doesNotMatch(html, /price-history|pricing\.js|search\.js/);
    assert.doesNotMatch(source, /include=prices|pop_reports|\/prices/);
    assert.doesNotMatch(source, /Pricing is not included\./);
    assert.doesNotMatch(source, /Organize every supported card variant\./);
    assert.doesNotMatch(html, /Organize every supported card variant\./);
});

test('builds only the current manifest variants with safe DOM controls', () => {
    assert.match(html, /id="pv-guide-variants" class="pv-guideVariantPills"><\/div>/);
    assert.doesNotMatch(html, /value="(?:normal|holofoil|reverseHolofoil)" data-guide-variant/);
    assert.match(source, /for \(const option of getGuideVariantOptions\(state.manifest\)\)/);
    assert.match(source, /input.value = option.value/);
    assert.match(source, /option.label/);
    assert.match(source, /elements.variants.replaceChildren\(\.\.\.nodes\)/);
    assert.match(source, /isGuideVariant\(slot\?\.variant\)/);
    assert.match(source, /getGuideVariantSelection\(state.manifest, preferences\)/);
    assert.match(source, /variantSelections/);
});

test('reverse and stamp disclosures exist only when their set contains those variants', () => {
    assert.match(source, /if \(reverse.length === 1\)/);
    assert.match(source, /else if \(reverse.length\)/);
    assert.match(source, /if \(stamps.length\) nodes.push\(disclosure\('Stamps and promos', stamps\)\)/);
    assert.match(source, /data-guide-variant-state/);
    assert.match(source, /state === 'partial' \? '−'/);
    assert.match(css, /\.pv-guideVariantDisclosure\[open\]/);
});

test('uses a compact single-row pager with a live page label', () => {
    assert.match(html, /id="pv-guide-pager-label" class="pv-guidePager__page"/);
    assert.match(source, /pagerLabel: document\.getElementById\('pv-guide-pager-label'\)/);
    assert.match(source, /elements\.pagerLabel\.textContent = `Page/);
    assert.match(css, /\.pv-guidePager\s*\{[\s\S]*display:\s*flex/);
    assert.match(css, /\.pv-guidePager__page\s*\{[\s\S]*flex:\s*1 1 auto/);
});

test('provides a no-selection binder guide catalog from the master sets page', () => {
    assert.match(masterSetsHtml, /href="master-set-guide\.html">Build a Binder<\/a>/);
    assert.match(html, /id="pv-guide-catalog"/);
    assert.match(html, /id="pv-guide-catalog-filter"/);
    assert.match(html, /id="pv-guide-catalog-grid"/);
    assert.match(source, /data\/master-set-guides\/index\.json/);
    assert.match(source, /function sortGuideEntries\(entries\)/);
    assert.match(source, /right\.releaseTimestamp - left\.releaseTimestamp/);
    assert.match(source, /function setGuideViewMode\(showBuilder\)/);
});

test('shows validated set logos and returns selected guides to the builder catalog', () => {
    assert.ok(Array.isArray(guideIndex.guides) && guideIndex.guides.length > 0);
    assert.ok(guideIndex.guides.every((entry) => /^https:\/\//.test(entry.logo)));
    assert.match(source, /logo: safeString\(entry\?\.logo\)/);
    assert.match(source, /setImage\(logo, entry\.logo, `\$\{entry\.name\} logo`\)/);
    assert.match(css, /\.pv-guideCatalog__logo\s*\{/);
    assert.match(html, /href="master-sets\.html">&larr; Back to Master Sets/);
    assert.match(source, /elements\.backLink\.textContent = '← Back to Master Sets'/);
    assert.match(source, /elements\.backLink\.href = 'master-sets\.html'/);
    assert.match(source, /elements\.backLink\.textContent = '← Back to Master Set Guide'/);
    assert.match(source, /elements\.backLink\.href = 'master-set-guide\.html'/);
});

test('keeps catalog copy separate from set logos', () => {
    assert.doesNotMatch(html, /Binder Layout/);
    assert.doesNotMatch(source, /Choose a set to plan its binder layout/);
    assert.doesNotMatch(source, /elements\.title\.textContent = 'Binder Builder'/);
    assert.match(source, /details\.className = 'pv-guideCatalog__details'/);
    assert.match(css, /\.pv-guideCatalog__logo\s*\{[\s\S]*overflow:\s*hidden/);
    assert.match(css, /\.pv-guideCatalog__details\s*\{[\s\S]*border-top/);
});

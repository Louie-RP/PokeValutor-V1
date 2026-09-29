import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('master-set-guide.js', 'utf8');
const html = await readFile('master-set-guide.html', 'utf8');
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

test('only the intended master-set variants are accepted by the UI', () => {
    for (const variant of [
        'normal',
        'reverseHolofoil',
        'energyReverseHolofoil',
        'pokeBallReverseHolofoil',
        'rocketReverseHolofoil',
        'quickBallReverseHolofoil',
        'duskBallReverseHolofoil',
        'loveBallReverseHolofoil',
        'friendBallReverseHolofoil',
        'cosmosHolofoil',
        'holofoil',
    ]) {
        assert.match(source, new RegExp(`['"]${variant}['"]`));
        assert.match(html, new RegExp(`value=['"]${variant}['"]`));
        const controls = html.match(new RegExp(`value=['"]${variant}['"]`, 'g')) || [];
        assert.equal(controls.length, 1, `${variant} must appear exactly once in the guide controls`);
    }
});

test('groups reverse holo variants under an expandable reverse holofoil control', () => {
    const group = html.match(/<details class="pv-guideVariantDisclosure"[\s\S]*?<\/details>/)?.[0] || '';
    assert.match(group, /data-guide-variant-disclosure/);
    assert.match(group, /<span>Reverse Holofoil<\/span>/);
    for (const variant of [
        'reverseHolofoil',
        'energyReverseHolofoil',
        'pokeBallReverseHolofoil',
        'rocketReverseHolofoil',
        'quickBallReverseHolofoil',
        'duskBallReverseHolofoil',
        'loveBallReverseHolofoil',
        'friendBallReverseHolofoil',
    ]) {
        assert.match(group, new RegExp(`value=['"]${variant}['"]`));
    }
    assert.doesNotMatch(group, /cosmosHolofoil|holofoil/);
    assert.match(html, /class="pv-guideVariantPill">\s*<input type="checkbox" value="cosmosHolofoil"/);
    assert.match(html, /class="pv-guideVariantPill">\s*<input type="checkbox" value="holofoil"/);
    assert.match(css, /\.pv-guideVariantPills\s*\{[\s\S]*grid-template-columns:\s*repeat\(2/);
    assert.match(css, /\.pv-guideVariantDisclosure\[open\]\s*\{[\s\S]*grid-column:\s*1\s*\/\s*-1/);
    assert.match(css, /@media \(min-width: 900px\)[\s\S]*grid-template-columns:\s*repeat\(4/);
    assert.match(source, /function updateVariantDisclosureState\(\)/);
    assert.match(source, /data-guide-variant-state/);
    assert.match(source, /state === 'partial' \? '−'/);
});

test('uses a compact single-row pager with a live page label', () => {
    assert.match(html, /id="pv-guide-pager-label" class="pv-guidePager__page"/);
    assert.match(source, /pagerLabel: document\.getElementById\('pv-guide-pager-label'\)/);
    assert.match(source, /elements\.pagerLabel\.textContent = `Page/);
    assert.match(css, /\.pv-guidePager\s*\{[\s\S]*display:\s*flex/);
    assert.match(css, /\.pv-guidePager__page\s*\{[\s\S]*flex:\s*1 1 auto/);
});

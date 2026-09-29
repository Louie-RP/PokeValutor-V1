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

<<<<<<< HEAD
test('uses medium images for binder thumbnails and large images for card dialogs', () => {
    assert.match(
        source,
        /slot\?\.images\?\.medium \|\| slot\?\.images\?\.large \|\| slot\?\.images\?\.small\s+\|\| card\?\.images\?\.medium \|\| card\?\.images\?\.large \|\| card\?\.images\?\.small/,
    );
    assert.match(
        source,
        /slot\?\.images\?\.large \|\| slot\?\.images\?\.medium \|\| slot\?\.images\?\.small\s+\|\| card\?\.images\?\.large \|\| card\?\.images\?\.medium \|\| card\?\.images\?\.small/,
    );
});

test('keeps lazy async image loading and contained-image styling hooks', async () => {
    assert.match(source, /image\.loading = 'lazy'/);
    assert.match(source, /image\.decoding = 'async'/);
    assert.match(css, /object-fit:\s*contain/);
=======
test('the grid prefers medium images and the dialog prefers large images', () => {
    assert.match(source, /const imageUrl = slot\?\.images\?\.large[\s\S]*openCardDialog/);
    assert.match(source, /const imageUrl = slot\?\.images\?\.medium[\s\S]*createSlot/);
>>>>>>> 04338dd901de0badef95db87874d087048c7de6d
});

test('the guide never loads pricing code or asks the manifest for pricing', () => {
    assert.doesNotMatch(html, /price-history|pricing\.js|search\.js/);
    assert.doesNotMatch(source, /include=prices|pop_reports|\/prices/);
    assert.match(source, /Pricing is not included\./);
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
    }
});

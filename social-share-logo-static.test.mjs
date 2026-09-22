import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const expectedImageUrl = 'https://www.pokevaluator.com/PokeValuator_Logo.png';
const htmlFiles = (await readdir('.', { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => entry.name)
    .sort();

assert.ok(htmlFiles.length > 0, 'At least one root HTML page should exist.');

for (const htmlFile of htmlFiles) {
    const html = await readFile(htmlFile, 'utf8');
    assert.match(
        html,
        new RegExp(`<meta\\s+property="og:image"[^>]+content="${expectedImageUrl.replaceAll('.', '\\.') }"[^>]*>`),
        `${htmlFile} should use the new logo for Open Graph shares.`,
    );
    assert.match(
        html,
        /<meta\s+name="twitter:card"\s+content="summary_large_image"\s*\/>/,
        `${htmlFile} should request a large Twitter/X preview.`,
    );
    assert.match(
        html,
        new RegExp(`<meta\\s+name="twitter:image"[^>]+content="${expectedImageUrl.replaceAll('.', '\\.') }"[^>]*>`),
        `${htmlFile} should use the new logo for Twitter/X shares.`,
    );
}

const cardScript = await readFile('card.js', 'utf8');
assert.match(
    cardScript,
    /const shareImageUrl = buildAbsoluteUrl\('PokeValuator_Logo\.png'\);/,
    'Card detail metadata should retain the new social logo as its fallback.',
);
assert.match(
    cardScript,
    /metaOgImageEl\.setAttribute\('content', imageUrl \|\| shareImageUrl\)/,
    'Card detail Open Graph metadata should prefer the card image.',
);
assert.match(
    cardScript,
    /metaTwitterImageEl\.setAttribute\('content', imageUrl \|\| shareImageUrl\)/,
    'Card detail Twitter\/X metadata should prefer the card image.',
);

const logo = await readFile('PokeValuator_Logo.png');
assert.equal(logo.toString('ascii', 1, 4), 'PNG', 'The social logo should be a PNG.');
assert.equal(logo.readUInt32BE(16), 1774, 'The social logo width should remain 1774 pixels.');
assert.equal(logo.readUInt32BE(20), 887, 'The social logo height should remain 887 pixels.');

console.log(`Social share logo checks passed for ${htmlFiles.length} pages.`);
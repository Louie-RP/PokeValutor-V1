import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
    buildGuideOwnershipIndex, buildBinderPlan, selectPrintableInserts, packPrintSheets,
    sanitizeBinderFilename, hasBinderPdfAccess, validateExportManifest,
} from '../master-set-guide-model.mjs';

const manifest = JSON.parse(await readFile(new URL('../data/master-set-guides/me2pt5.json', import.meta.url)));

test('all real manifest slots retain resolved variants, images, and canonical order', () => {
    const plan = buildBinderPlan(manifest);
    assert.equal(plan.length, 620);
    assert.equal(new Set(plan.map(row => row.slotId)).size, 620);
    assert.deepEqual(plan.map(row => row.slotId), manifest.slots.map(slot => slot.slotId));
    assert.equal(plan.filter(row => row.imageSource === 'base').length, 7);
    assert.equal(plan.filter(row => row.imageSource === 'baseGoldRarity').length, 2);
    assert.deepEqual(plan[0].images, manifest.slots[0].images);
});

test('all three binder layouts assign row-major positions and real-set page counts', () => {
    for (const [layout, columns, size, pages] of [['3x3', 3, 9, 69], ['4x3', 4, 12, 52], ['4x4', 4, 16, 39]]) {
        const plan = buildBinderPlan(manifest, new Map(), { layout });
        assert.equal(plan.at(-1).binderPage, pages);
        assert.equal(plan[size].binderPage, 2);
        assert.equal(plan[size].pocket, 1);
        assert.equal(plan[columns].row, 2);
        assert.equal(plan[columns].column, 1);
    }
});

test('ownership counts finite positive quantities in Default Collection only', () => {
    const index = buildGuideOwnershipIndex([
        { id: 'a', variantQuantities: { Standard: '2', reverseHolofoil: 0, holofoil: -1, bad: 'NaN', infinite: Infinity, boolean: true } },
        { id: 'a', variantQuantities: { reverseHolofoil: 1 } },
        { id: 'b', itemType: 'sealed', variantQuantities: { normal: 1 } },
        { id: 'c', collectionId: 'custom', variantQuantities: { normal: 1 } },
        { id: 'd', selectedVariant: 'normal' },
        { id: 'e', selectedVariant: 'normal', variantQuantities: { normal: 0 } },
        { id: 'f', selectedVariant: 'normal', variantQuantities: { normal: 'broken' } },
        { id: 'g', selectedVariant: 'normal', conditionQuantities: { NM: 0 } },
        { id: 'h', selectedVariant: 'normal', conditionQuantities: { NM: 1 } },
        { id: 'i', selectedVariant: 'normal', quantity: 0 },
    ]);
    assert.deepEqual([...index.get('a')], ['normal', 'reverseholofoil']);
    assert.deepEqual([...index.keys()], ['a', 'd', 'h']);
});

test('missing-only and manual print omissions preserve original binder positions', () => {
    const ownership = buildGuideOwnershipIndex([{ id: manifest.slots[0].cardId, variantQuantities: { normal: 1 } }]);
    const plan = buildBinderPlan(manifest, ownership, { layout: '4x4' });
    const missing = selectPrintableInserts(plan);
    assert.equal(missing.length, 619);
    assert.equal(missing[0].pocket, 2);
    const skipped = new Set(missing.slice(0, 16).map(row => row.slotId));
    const selected = selectPrintableInserts(plan, { skippedSlotIds: skipped });
    assert.equal(selected[0].planIndex, 17);
    assert.equal(selected[0].binderPage, 2);
    assert.equal(selected[0].pocket, 2);
    assert.equal(plan.filter(row => row.owned).length + missing.length, plan.length);
});

test('binder composition exclusions reflow only the chosen plan', () => {
    const excluded = new Set([manifest.slots[0].slotId]);
    const plan = buildBinderPlan(manifest, new Map(), { excludedSlotIds: excluded });
    assert.equal(plan.length, 619);
    assert.equal(plan[0].slotId, manifest.slots[1].slotId);
    assert.equal(plan[0].pocket, 1);
    const normal = buildBinderPlan(manifest, new Map(), { enabledVariants: ['normal'] });
    assert.equal(normal.length, 153);
    assert.equal(buildBinderPlan(manifest, new Map(), { enabledVariants: [] }).length, 0);
});

test('Letter packing keeps exact card sizes and correct partial/empty sheets', () => {
    const plan = buildBinderPlan(manifest);
    for (const [count, expected] of [[0, 0], [1, 1], [9, 1], [10, 2], [18, 2], [620, 69]]) {
        const { preset, sheets } = packPrintSheets(plan.slice(0, count));
        assert.equal(sheets.length, expected);
        assert.equal(sheets.flat().length, count);
        for (const cell of sheets.flat()) {
            assert.equal(cell.width, 180);
            assert.equal(cell.height, 252);
            assert.ok(cell.x >= 0 && cell.y >= 0);
            assert.ok(cell.x + cell.width <= preset.width && cell.y + cell.height <= preset.height);
        }
    }
    assert.equal(packPrintSheets(plan, 'letter6').sheets.length, 104);
    assert.throws(() => packPrintSheets(plan, 'made-up'));
});

test('malformed/duplicate manifest data is rejected instead of exporting duplicate slots', () => {
    const copy = structuredClone(manifest);
    copy.slots.push(copy.slots[0]);
    assert.throws(() => validateExportManifest(copy), /duplicate slots/);
    assert.throws(() => buildBinderPlan(manifest, new Map(), { layout: '5x5' }));
    assert.throws(() => selectPrintableInserts([], { scope: 'owned' }));
});

test('filenames contain no path/control characters, and roles use current authenticated claims', () => {
    const filename = sanitizeBinderFilename('../../Pokémon <script> / 151\n', '4x4', 'all', 'ink');
    assert.match(filename, /^pokevaluator-pokemon-script-151-4x4-all-ink-saving-binder-inserts\.pdf$/);
    assert.equal(hasBinderPdfAccess(null, { admin: true }), false);
    for (const role of ['admin', 'tester', 'premium']) assert.equal(hasBinderPdfAccess({ uid: 'x' }, { role }), true);
    assert.equal(hasBinderPdfAccess({ uid: 'x' }, { role: 'basic', premium: true }), false);
    assert.equal(hasBinderPdfAccess({ uid: 'x' }, { premium: true }), true);
    assert.equal(hasBinderPdfAccess({ uid: 'x' }, { premium: 'true' }), false);
});

test('the actual export dialog and preview renderer avoid unsafe parsing or dynamic source execution', async () => {
    for (const name of ['master-set-guide-export.mjs', 'master-set-guide-pdf.mjs', 'master-set-guide-model.mjs']) {
        const source = await readFile(new URL(`../${name}`, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval)\b|new\s+Function\b/);
    }
    const renderer = await readFile(new URL('../master-set-guide-export.mjs', import.meta.url), 'utf8');
    assert.match(renderer, /document\.createElement\(/);
    assert.match(renderer, /\.textContent\s*=/);
    assert.match(renderer, /replaceChildren\(/);
    const html = await readFile(new URL('../master-set-guide.html', import.meta.url), 'utf8');
    assert.doesNotMatch(html, /script-src[^;]*unsafe-eval/);
    assert.doesNotMatch(html, /<script[^>]*src="vendor\//);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { buildBinderPlan } from '../master-set-guide-model.mjs';
import { renderBinderPdf, safePdfImageUrl } from '../master-set-guide-pdf.mjs';

const require = createRequire(import.meta.url);
const pdfLib = require('../vendor/pdf-lib-1.17.1.min.js');
const fontkit = require('../vendor/fontkit-1.1.1.min.js');
const dependencies = { pdfLib, fontkit, fonts: {
    regular: await readFile(new URL('../fonts/binder/DejaVuSans.ttf', import.meta.url)),
    bold: await readFile(new URL('../fonts/binder/DejaVuSans-Bold.ttf', import.meta.url)),
} };
const manifest = JSON.parse(await readFile(new URL('../data/master-set-guides/me2pt5.json', import.meta.url)));
const plan = buildBinderPlan(manifest);

test('ink-saving export embeds zero card images and creates Letter pages with calibration', async () => {
    let calls = 0;
    const result = await renderBinderPdf(plan.slice(0, 10), {
        style: 'ink', calibration: true, dependencies,
        loadImage: () => { calls++; throw new Error('Ink-saving must never fetch artwork.'); },
    });
    assert.equal(calls, 0);
    assert.equal(result.failedImages, 0);
    assert.equal(result.printSheets, 2);
    assert.equal(result.pageCount, 3);
    const pdf = await pdfLib.PDFDocument.load(result.bytes);
    assert.equal(pdf.getPageCount(), 3);
    for (const page of pdf.getPages()) {
        assert.equal(page.getWidth(), 612);
        assert.equal(page.getHeight(), 792);
        const images = page.node.Resources().get(pdfLib.PDFName.of('XObject'));
        assert.equal(images?.keys().length || 0, 0);
    }
});

test('full 620-slot labels export has 69 printer sheets even for a 4x4 binder', async () => {
    const rows = buildBinderPlan(manifest, new Map(), { layout: '4x4' });
    const result = await renderBinderPdf(rows, { style: 'ink', dependencies });
    assert.equal(rows.at(-1).binderPage, 39);
    assert.equal(result.pageCount, 69);
    assert.ok(result.bytes.length < 1000000, 'Labels-only PDF should remain compact.');
});

test('failed artwork preserves every identifying insert and duplicate URLs load only once', async () => {
    let calls = 0;
    const rows = plan.slice(0, 3).map(row => ({ ...row, images: { medium: 'https://images.scrydex.com/same.png' } }));
    const result = await renderBinderPdf(rows, { dependencies, loadImage: async () => { calls++; throw new Error('CORS failure'); } });
    assert.equal(calls, 1);
    assert.equal(result.insertCount, 3);
    assert.equal(result.failedImages, 3);
    assert.equal(result.pageCount, 1);
});

test('successful PNG artwork is embedded and accented names/symbols do not fail', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvH0AAAAASUVORK5CYII=', 'base64');
    const rows = [{ ...plan[0], name: 'Pokémon Nidoran ♀ ♂', variantLabel: 'Poké Ball Reverse Holofoil' }];
    const result = await renderBinderPdf(rows, { dependencies, loadImage: async () => ({ bytes: png, format: 'png' }) });
    assert.equal(result.failedImages, 0);
    const pdf = await pdfLib.PDFDocument.load(result.bytes);
    assert.equal(pdf.getPage(0).node.Resources().get(pdfLib.PDFName.of('XObject')).keys().length, 1);
});

test('empty exports, cancellations, and unsafe image schemes are handled', async () => {
    await assert.rejects(renderBinderPdf([], { dependencies }), /at least one/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(renderBinderPdf(plan.slice(0, 1), { dependencies, signal: controller.signal }), { name: 'AbortError' });
    for (const url of ['javascript:alert(1)', 'data:image/png;base64,x', 'http://outside.test/x', 'https://user:pass@outside.test/x']) {
        assert.equal(safePdfImageUrl(url, 'https://www.pokevaluator.com/'), '');
    }
    assert.equal(safePdfImageUrl('/card.png', 'https://www.pokevaluator.com/'), 'https://www.pokevaluator.com/card.png');
});

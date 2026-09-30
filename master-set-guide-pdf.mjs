import { cleanText, packPrintSheets } from './master-set-guide-model.mjs';

const BRAND = 'PokeValuator.com';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 16000000;
let dependenciesPromise;

function abortIfNeeded(signal) {
    if (signal?.aborted) throw new DOMException('PDF generation cancelled.', 'AbortError');
}

function loadScript(path, globalName) {
    if (globalThis[globalName]) return Promise.resolve(globalThis[globalName]);
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const timeout = setTimeout(() => { script.remove(); reject(new Error('PDF tools took too long to load. Please retry.')); }, 20000);
        script.src = new URL(path, import.meta.url).href;
        script.onload = () => {
            clearTimeout(timeout);
            if (globalThis[globalName]) resolve(globalThis[globalName]);
            else reject(new Error('PDF tools did not initialize. Please retry.'));
        };
        script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error('PDF tools could not load. Please retry.')); };
        document.head.append(script);
    });
}

async function loadDependencies() {
    if (!dependenciesPromise) {
        dependenciesPromise = (async () => {
            const [pdfLib, fontkit, regular, bold] = await Promise.all([
                loadScript('./vendor/pdf-lib-1.17.1.min.js', 'PDFLib'),
                loadScript('./vendor/fontkit-1.1.1.min.js', 'fontkit'),
                fetch(new URL('./fonts/binder/DejaVuSans.ttf', import.meta.url)).then(readAsset),
                fetch(new URL('./fonts/binder/DejaVuSans-Bold.ttf', import.meta.url)).then(readAsset),
            ]);
            return { pdfLib, fontkit, fonts: { regular, bold } };
        })().catch(error => { dependenciesPromise = undefined; throw error; });
    }
    return dependenciesPromise;
}

async function readAsset(response) {
    if (!response.ok) throw new Error('A PDF font could not load. Please retry.');
    return response.arrayBuffer();
}

export function safePdfImageUrl(value, baseUrl) {
    try {
        const url = new URL(cleanText(value, 2000), baseUrl);
        if (!cleanText(value, 2000) || url.username || url.password) return '';
        const base = new URL(baseUrl);
        if (url.protocol === 'https:' || (url.origin === base.origin && url.protocol === base.protocol)) return url.href;
    } catch { /* An invalid image remains a labels-only insert. */ }
    return '';
}

export async function fetchPdfImage(url, signal) {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
        abortIfNeeded(signal);
        const response = await fetch(url, { signal: controller.signal, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!response.ok) throw new Error('Image unavailable.');
        const type = response.headers.get('content-type')?.split(';')[0] || '';
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/avif'].includes(type)) throw new Error('Unsupported image format.');
        if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('Image is too large.');
        // Enforce a byte limit even when Content-Length is absent or incorrect.
        const reader = response.body.getReader();
        const chunks = [];
        let size = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error('Image is too large.'); }
            chunks.push(value);
        }
        const blob = new Blob(chunks, { type });
        const bitmap = await createImageBitmap(blob);
        try {
            abortIfNeeded(signal);
            if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) throw new Error('Image dimensions are too large.');
            const scale = Math.min(1, 525 / bitmap.height, 375 / bitmap.width);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            const context = canvas.getContext('2d');
            if (!context) throw new Error('Image processing is unavailable.');
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const encoded = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
            canvas.width = canvas.height = 0;
            if (!encoded) throw new Error('Image processing failed.');
            return { bytes: await encoded.arrayBuffer(), format: 'jpeg' };
        } finally { bitmap.close(); }
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', forwardAbort);
    }
}

function supportedText(text, font) {
    return Array.from(cleanText(text)).map(character => {
        try { font.encodeText(character); return character; } catch { return '?'; }
    }).join('');
}

function fittedLines(text, font, maxWidth, initialSize, minimumSize, maxLines) {
    const value = supportedText(text, font);
    let finalLines = [];
    for (let size = initialSize; size >= minimumSize; size--) {
        const lines = [];
        let line = '';
        for (const character of value) {
            if (font.widthOfTextAtSize(line + character, size) > maxWidth && line) {
                const breakAt = line.lastIndexOf(' ');
                if (breakAt > 0) { lines.push(line.slice(0, breakAt)); line = line.slice(breakAt + 1) + character; }
                else { lines.push(line); line = character; }
            } else line += character;
        }
        if (line) lines.push(line.trim());
        if (lines.length <= maxLines) return { lines, size };
        finalLines = lines;
    }
    // Never allow a pathological external label to draw outside its insert.
    const lines = finalLines.slice(0, maxLines);
    let last = lines[maxLines - 1] || '';
    while (last && font.widthOfTextAtSize(last + '…', minimumSize) > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
    return { lines, size: minimumSize };
}

function drawCentered(page, text, font, black, centerX, topY, width, size, minSize = size, maxLines = 1) {
    const fitted = fittedLines(text, font, width, size, minSize, maxLines);
    fitted.lines.forEach((line, i) => page.drawText(line, {
        x: centerX - font.widthOfTextAtSize(line, fitted.size) / 2,
        y: topY - fitted.size - i * fitted.size * 1.2, size: fitted.size, font, color: black,
    }));
}

function drawRoundedOutline(page, x, y, width, height, black) {
    // Inset the stroke so the outside still measures exactly 2.5 x 3.5 inches.
    const inset = 0.25, radius = 9;
    const left = inset, top = inset, right = width - inset, bottom = height - inset;
    const path = [
        `M ${left + radius} ${top}`,
        `H ${right - radius} A ${radius} ${radius} 0 0 1 ${right} ${top + radius}`,
        `V ${bottom - radius} A ${radius} ${radius} 0 0 1 ${right - radius} ${bottom}`,
        `H ${left + radius} A ${radius} ${radius} 0 0 1 ${left} ${bottom - radius}`,
        `V ${top + radius} A ${radius} ${radius} 0 0 1 ${left + radius} ${top} Z`,
    ].join(' ');
    page.drawSvgPath(path, { x, y: y + height, borderWidth: 0.5, borderColor: black });
}

function drawInsert(page, cell, style, image, fonts, black) {
    const { x, y, width, height, insert } = cell;
    const cx = x + width / 2;
    drawRoundedOutline(page, x, y, width, height, black);
    if (style === 'images' && image) {
        const factor = Math.min((width - 16) / image.width, 172 / image.height);
        const iw = image.width * factor, ih = image.height * factor;
        page.drawImage(image, { x: cx - iw / 2, y: y + 70 + (172 - ih) / 2, width: iw, height: ih });
        drawCentered(page, `${insert.name} · ${insert.printedNumber}`, fonts.bold, black, cx, y + 65, width - 16, 9, 7, 2);
        drawCentered(page, insert.variantLabel, fonts.regular, black, cx, y + 41, width - 16, 8, 6, 2);
    } else {
        drawCentered(page, insert.printedNumber, fonts.bold, black, cx, y + height - 24, width - 24, 12, 9, 2);
        drawCentered(page, insert.name, fonts.bold, black, cx, y + 151, width - 24, 18, 12, 3);
        drawCentered(page, insert.variantLabel, fonts.regular, black, cx, y + 66, width - 24, 10, 8, 2);
        if (style === 'images') drawCentered(page, 'Image unavailable', fonts.regular, black, cx, y + 92, width - 24, 8);
    }
    drawCentered(page, `Page ${insert.binderPage} · Pocket ${insert.pocket}`, fonts.regular, black, cx, y + 25, width - 12, 6.5);
    drawCentered(page, BRAND, fonts.regular, black, cx, y + 13, width - 12, 7);
}

export async function renderBinderPdf(inserts, options = {}) {
    if (!Array.isArray(inserts) || inserts.length === 0) throw new Error('Select at least one insert to generate a PDF.');
    const style = options.style === 'ink' ? 'ink' : 'images';
    const { preset, sheets } = packPrintSheets(inserts, options.paper || 'letter9');
    const { pdfLib, fontkit, fonts: fontBytes } = options.dependencies || await loadDependencies();
    abortIfNeeded(options.signal);
    const pdf = await pdfLib.PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const fonts = {
        regular: await pdf.embedFont(fontBytes.regular, { subset: true }),
        bold: await pdf.embedFont(fontBytes.bold, { subset: true }),
    };
    const black = pdfLib.rgb(0, 0, 0);
    pdf.setTitle(`${cleanText(options.setName) || 'Master Set'} Binder Inserts`);
    pdf.setAuthor('PokéValuator');
    pdf.setSubject('Print at Actual Size / 100%. Each insert is 2.5 x 3.5 inches.');
    const embeddedImages = new Map();
    let failedImages = 0, completed = 0;
    const loadImage = options.loadImage || fetchPdfImage;
    const baseUrl = options.baseUrl || globalThis.location?.href || 'https://www.pokevaluator.com/';
    for (const cells of sheets) {
        abortIfNeeded(options.signal);
        const page = pdf.addPage([preset.width, preset.height]);
        for (let start = 0; start < cells.length; start += 3) {
            const batch = cells.slice(start, start + 3);
            const images = await Promise.all(batch.map(async cell => {
                if (style === 'ink') return null;
                const candidates = cell.insert.images;
                const url = safePdfImageUrl(candidates?.medium || candidates?.small || candidates?.large, baseUrl);
                if (!url) return null;
                if (!embeddedImages.has(url)) {
                    embeddedImages.set(url, (async () => {
                        const image = await loadImage(url, options.signal);
                        return image.format === 'png' ? pdf.embedPng(image.bytes) : pdf.embedJpg(image.bytes);
                    })().catch(error => { abortIfNeeded(options.signal); return null; }));
                }
                return embeddedImages.get(url);
            }));
            abortIfNeeded(options.signal);
            batch.forEach((cell, i) => {
                if (style === 'images' && !images[i]) failedImages++;
                drawInsert(page, cell, style, images[i], fonts, black);
                options.onProgress?.({ stage: 'Drawing inserts', completed: ++completed, total: inserts.length });
            });
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    abortIfNeeded(options.signal);
    options.onProgress?.({ stage: 'Finalizing PDF', completed, total: inserts.length });
    const bytes = await pdf.save();
    abortIfNeeded(options.signal);
    return { bytes, failedImages, insertCount: inserts.length, printSheets: sheets.length, pageCount: sheets.length };
}

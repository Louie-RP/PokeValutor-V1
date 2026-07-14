/*
 * One-time migration: backfill cardCatalog printedTotal and full slash numbers.
 *
 * Usage:
 *   1) Ensure Firebase Admin credentials are available (service account env).
 *   2) node functions/scripts/backfill-card-catalog-full-number.js --dry-run
 *   3) node functions/scripts/backfill-card-catalog-full-number.js
 */

const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp();
}

const DEFAULT_WORKER_BASE = 'https://pokevalutor-v1.lreyperez18.workers.dev';
const DRY_RUN = process.argv.includes('--dry-run');
const PAGE_SIZE = 400;

function toNumString(value) {
    const s = String(value || '').trim();
    if (!/^\d{1,3}$/.test(s)) return '';
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return '';
    return String(n);
}

function normalizeCatalogNumberKey(value) {
    const raw = String(value || '').trim().toUpperCase();
    if (!raw) return '';

    const slash = raw.match(/^(\d{1,3})\/(\d{1,3})$/);
    if (slash) {
        const left = String(Number(slash[1] || ''));
        const right = String(Number(slash[2] || ''));
        if (left && right) return `${left}_${right}`;
    }

    const plain = raw.replace(/[^A-Z0-9]/g, '');
    return plain;
}

function buildFullNumber(shortNumber, printedTotal) {
    const left = toNumString(shortNumber);
    const total = toNumString(printedTotal);
    if (!left || !total) return '';

    const width = Math.max(2, String(total).length);
    return `${left.padStart(width, '0')}/${total}`;
}

async function fetchSetPrintedTotal(workerBase, setId, cache) {
    const key = String(setId || '').trim();
    if (!key) return '';
    if (cache.has(key)) return cache.get(key);

    const q = encodeURIComponent(`set.id:${key}`);
    const url = `${workerBase}/cards/search?q=${q}&page=1&pageSize=1&lang=en`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            cache.set(key, '');
            return '';
        }

        const payload = await res.json();
        const card = Array.isArray(payload?.data) ? payload.data[0] : null;
        const expansion = card?.expansion && typeof card.expansion === 'object' ? card.expansion : null;

        const total = String(
            expansion?.printedTotal
            || expansion?.printed_total
            || expansion?.total
            || ''
        ).trim();

        cache.set(key, total);
        return total;
    } catch {
        cache.set(key, '');
        return '';
    }
}

function getShortNumericNumber(docData) {
    const candidates = [
        docData?.printedNumber,
        docData?.collectorNumber,
        docData?.number,
    ];

    for (const value of candidates) {
        const s = String(value || '').trim();
        if (/^\d{1,3}$/.test(s)) return s;
    }

    return '';
}

async function run() {
    const db = admin.firestore();
    const workerBase = String(process.env.PV_API_URL || DEFAULT_WORKER_BASE).replace(/\/$/, '');
    const setTotals = new Map();

    let lastDoc = null;
    let scanned = 0;
    let updated = 0;

    console.log(`[catalog-backfill] mode=${DRY_RUN ? 'dry-run' : 'write'} worker=${workerBase}`);

    while (true) {
        let query = db.collection('cardCatalog').orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE_SIZE);
        if (lastDoc) query = query.startAfter(lastDoc);

        const snap = await query.get();
        if (snap.empty) break;

        const batch = db.batch();
        let batchOps = 0;

        for (const doc of snap.docs) {
            scanned += 1;
            const data = doc.data() || {};

            const currentPrintedTotal = String(data.printedTotal || '').trim();
            const setId = String(data.setId || '').trim();
            const shortNumber = getShortNumericNumber(data);

            let printedTotal = currentPrintedTotal;
            if (!printedTotal && setId) {
                printedTotal = await fetchSetPrintedTotal(workerBase, setId, setTotals);
            }

            const fullNumber = buildFullNumber(shortNumber, printedTotal);
            const needsPrintedTotal = !currentPrintedTotal && !!printedTotal;

            const currentNumber = String(data.number || '').trim();
            const currentPrintedNumber = String(data.printedNumber || '').trim();
            const currentCollectorNumber = String(data.collectorNumber || '').trim();

            const numberIsShort = /^\d{1,3}$/.test(currentNumber);
            const printedIsShort = /^\d{1,3}$/.test(currentPrintedNumber);
            const collectorIsShort = /^\d{1,3}$/.test(currentCollectorNumber);

            const shouldRewriteNumber = !!fullNumber && (numberIsShort || printedIsShort || collectorIsShort);

            if (!needsPrintedTotal && !shouldRewriteNumber) {
                continue;
            }

            const update = {};

            if (needsPrintedTotal) {
                update.printedTotal = printedTotal;
            }

            if (shouldRewriteNumber) {
                if (numberIsShort || !currentNumber) update.number = fullNumber;
                if (printedIsShort || !currentPrintedNumber) update.printedNumber = fullNumber;
                if (collectorIsShort || !currentCollectorNumber) update.collectorNumber = fullNumber;
                update.numberKey = normalizeCatalogNumberKey(fullNumber);
            }

            updated += 1;

            if (!DRY_RUN) {
                batch.update(doc.ref, update);
                batchOps += 1;
            }
        }

        if (!DRY_RUN && batchOps > 0) {
            await batch.commit();
        }

        lastDoc = snap.docs[snap.docs.length - 1];
        console.log(`[catalog-backfill] scanned=${scanned} updated=${updated} last=${lastDoc.id}`);
    }

    console.log(`[catalog-backfill] complete scanned=${scanned} updated=${updated} mode=${DRY_RUN ? 'dry-run' : 'write'}`);
}

run().catch((error) => {
    console.error('[catalog-backfill] failed', error);
    process.exitCode = 1;
});

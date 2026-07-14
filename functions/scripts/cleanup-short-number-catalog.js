/*
  Targeted cleanup script for cardCatalog docs that still store short-only numbers.

  Usage (PowerShell):
    cd functions
    npm install
    $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\serviceAccountKey.json"

    # Dry run by card name
    node scripts/cleanup-short-number-catalog.js --name Clauncher --dry-run

    # Dry run by set id
    node scripts/cleanup-short-number-catalog.js --setId me1 --dry-run

    # Delete matching docs (targeted)
    node scripts/cleanup-short-number-catalog.js --name Clauncher --execute

  Optional:
    --projectId pokevaluator-v1
    --limit 1000

  Notes:
    - This deletes only docs that look short-only or missing printedTotal context.
    - Rehydration happens naturally when those cards are searched again.
*/

const admin = require('firebase-admin');

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function isShortNumber(value) {
  return /^\d{1,3}$/.test(String(value || '').trim());
}

function isSlashNumber(value) {
  return /^\d{1,3}\/\d{2,3}$/.test(String(value || '').trim());
}

function looksProblematic(data) {
  const number = String(data?.number || '').trim();
  const printedNumber = String(data?.printedNumber || '').trim();
  const collectorNumber = String(data?.collectorNumber || '').trim();
  const printedTotal = String(data?.printedTotal || '').trim();

  const values = [number, printedNumber, collectorNumber].filter(Boolean);
  if (!values.length) return false;

  const hasShort = values.some(isShortNumber);
  const hasSlash = values.some(isSlashNumber);
  const shortOnly = hasShort && !hasSlash;
  const missingTotal = hasShort && !printedTotal;

  return shortOnly || missingTotal;
}

function matchesFilters(data, filters) {
  const nameFilter = normalizeText(filters.name);
  const setIdFilter = String(filters.setId || '').trim().toLowerCase();

  if (nameFilter) {
    const name = normalizeText(data?.name || data?.normalizedName || '');
    if (name !== nameFilter) {
      return false;
    }
  }

  if (setIdFilter) {
    const setId = String(data?.setId || '').trim().toLowerCase();
    if (setId !== setIdFilter) {
      return false;
    }
  }

  return true;
}

async function main() {
  const name = String(getArg('--name') || '').trim();
  const setId = String(getArg('--setId') || '').trim();
  const projectId = String(getArg('--projectId') || '').trim();
  const limitRaw = Number(getArg('--limit') || '0');
  const maxMatches = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : Infinity;

  const execute = hasFlag('--execute');
  const dryRun = hasFlag('--dry-run') || !execute;

  if (!name && !setId) {
    console.error('Provide at least one filter: --name <Card Name> or --setId <setId>.');
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: projectId || undefined,
  });

  const db = admin.firestore();
  const filters = { name, setId };

  let scanned = 0;
  let matched = 0;
  let deleted = 0;
  let cursor = null;
  const pageSize = 400;

  /** @type {Array<{id:string,name:string,number:string,printedNumber:string,collectorNumber:string,setId:string,printedTotal:string}>} */
  const samples = [];
  /** @type {Array<FirebaseFirestore.DocumentReference>} */
  const toDelete = [];

  console.log(`[cleanup-catalog] mode=${dryRun ? 'dry-run' : 'execute'} name="${name}" setId="${setId}" limit=${Number.isFinite(maxMatches) ? maxMatches : 'none'}`);

  while (true) {
    let query = db.collection('cardCatalog').orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
    if (cursor) query = query.startAfter(cursor);

    const snap = await query.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned += 1;
      const data = doc.data() || {};

      if (!matchesFilters(data, filters)) {
        continue;
      }

      if (!looksProblematic(data)) {
        continue;
      }

      matched += 1;
      toDelete.push(doc.ref);

      if (samples.length < 30) {
        samples.push({
          id: doc.id,
          name: String(data.name || ''),
          number: String(data.number || ''),
          printedNumber: String(data.printedNumber || ''),
          collectorNumber: String(data.collectorNumber || ''),
          setId: String(data.setId || ''),
          printedTotal: String(data.printedTotal || ''),
        });
      }

      if (matched >= maxMatches) {
        break;
      }
    }

    cursor = snap.docs[snap.docs.length - 1];
    if (matched >= maxMatches) break;
  }

  console.log(`[cleanup-catalog] scanned=${scanned} matched=${matched}`);

  if (samples.length) {
    console.log('[cleanup-catalog] sample matches:');
    samples.forEach((s) => {
      console.log(`- ${s.id} | ${s.name} | n=${s.number} pn=${s.printedNumber} cn=${s.collectorNumber} set=${s.setId} total=${s.printedTotal || '(empty)'}`);
    });
  }

  if (dryRun) {
    console.log('[cleanup-catalog] dry-run complete. Re-run with --execute to delete matched docs.');
    return;
  }

  if (!toDelete.length) {
    console.log('[cleanup-catalog] nothing to delete.');
    return;
  }

  const chunkSize = 450;
  for (let i = 0; i < toDelete.length; i += chunkSize) {
    const chunk = toDelete.slice(i, i + chunkSize);
    const batch = db.batch();
    chunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
    deleted += chunk.length;
    console.log(`[cleanup-catalog] deleted ${deleted}/${toDelete.length}`);
  }

  console.log(`[cleanup-catalog] done. deleted=${deleted}`);
}

main().catch((err) => {
  console.error('[cleanup-catalog] failed', err);
  process.exit(1);
});

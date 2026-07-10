# Firebase Patch: Scanner Name Correction

Add this to `functions/index.js`.

Before adding this patch, remove the duplicate `exports.scannerCandidates` block so the file only exports that function once.

## 1. Add config helpers near the other scanner/card-catalog config helpers

```js
function getScannerNameSuggestionsSecret() {
    return configValue(
        'SCANNER_NAME_SUGGESTIONS_SECRET',
        ['scanner', 'name_suggestions_secret'],
        getCardCatalogCandidatesSecret()
    );
}

function isScannerNameSuggestionsEnabled() {
    const raw = configValue('SCANNER_NAME_SUGGESTIONS_ENABLED', ['scanner', 'name_suggestions_enabled'], 'false');
    const normalized = String(raw || '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function getScannerNameSuggestionsMaxResults() {
    const raw = Number(configValue('SCANNER_NAME_SUGGESTIONS_MAX_RESULTS', ['scanner', 'name_suggestions_max_results'], '5'));
    return Number.isFinite(raw) && raw > 0 ? Math.min(10, Math.floor(raw)) : 5;
}

function getScannerNameSuggestionsMinScore() {
    const raw = Number(configValue('SCANNER_NAME_SUGGESTIONS_MIN_SCORE', ['scanner', 'name_suggestions_min_score'], '0.70'));
    return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.70;
}
```

## 2. Add name-index helpers near the catalog helpers

```js
function getScannerNameIndexDocId(normalizedName) {
    return String(normalizedName || '')
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120);
}

function buildScannerNameIndexEntryFromCatalogDoc(doc) {
    if (!doc || typeof doc !== 'object') return null;

    const displayName = String(doc.name || '').trim().slice(0, 120);
    const normalizedName = normalizeCatalogText(displayName);

    if (!displayName || !normalizedName || normalizedName.length < 2) {
        return null;
    }

    const tokens = normalizedName.split(/\s+/).filter(Boolean).slice(0, 8);
    const compact = normalizedName.replace(/\s+/g, '');

    return {
        docId: getScannerNameIndexDocId(normalizedName),
        displayName,
        normalizedName,
        tokens,
        firstLetter: compact.slice(0, 1),
        prefix2: compact.slice(0, 2),
        prefix3: compact.slice(0, 3),
        cardId: String(doc.id || '').trim(),
    };
}

function buildScannerNameIndexEntries(docs) {
    const byName = new Map();

    for (const doc of Array.isArray(docs) ? docs : []) {
        const entry = buildScannerNameIndexEntryFromCatalogDoc(doc);
        if (!entry || !entry.docId) continue;

        const existing = byName.get(entry.docId);
        if (!existing) {
            byName.set(entry.docId, {
                ...entry,
                cardIds: entry.cardId ? [entry.cardId] : [],
                cardCountDelta: 1,
            });
            continue;
        }

        if (entry.cardId && existing.cardIds.indexOf(entry.cardId) < 0 && existing.cardIds.length < 20) {
            existing.cardIds.push(entry.cardId);
        }
        existing.cardCountDelta += 1;
    }

    return Array.from(byName.values());
}

function addScannerNameIndexWritesToBatch(batch, db, docs) {
    const entries = buildScannerNameIndexEntries(docs);
    const collection = db.collection('scannerNameIndex');

    for (const entry of entries) {
        const ref = collection.doc(entry.docId);

        batch.set(ref, {
            displayName: entry.displayName,
            normalizedName: entry.normalizedName,
            tokens: entry.tokens,
            firstLetter: entry.firstLetter,
            prefix2: entry.prefix2,
            prefix3: entry.prefix3,
            exampleCardIds: FieldValue.arrayUnion(...entry.cardIds.slice(0, 10)),
            cardCount: FieldValue.increment(entry.cardCountDelta),
            source: 'cardCatalog',
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
    }
}
```

## 3. Update `hydrateCardCatalog`

Inside `exports.hydrateCardCatalog`, after the loop that adds `cardCatalog` writes to the batch and before `await batch.commit();`, add:

```js
addScannerNameIndexWritesToBatch(batch, db, docs);
```

Example location:

```js
docs.forEach((doc, index) => {
    // existing cardCatalog batch.set(...)
});

addScannerNameIndexWritesToBatch(batch, db, docs);

await batch.commit();
```

## 4. Add fuzzy scoring helpers

```js
function compactScannerName(value) {
    return normalizeCatalogText(value).replace(/\s+/g, '');
}

function levenshteinDistance(a, b) {
    const left = String(a || '');
    const right = String(b || '');

    if (left === right) return 0;
    if (!left) return right.length;
    if (!right) return left.length;

    const prev = new Array(right.length + 1);
    const cur = new Array(right.length + 1);

    for (let j = 0; j <= right.length; j += 1) {
        prev[j] = j;
    }

    for (let i = 1; i <= left.length; i += 1) {
        cur[0] = i;
        for (let j = 1; j <= right.length; j += 1) {
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
            cur[j] = Math.min(
                prev[j] + 1,
                cur[j - 1] + 1,
                prev[j - 1] + cost
            );
        }

        for (let j = 0; j <= right.length; j += 1) {
            prev[j] = cur[j];
        }
    }

    return prev[right.length];
}

function bigrams(value) {
    const text = compactScannerName(value);
    const out = [];

    if (text.length < 2) {
        if (text) out.push(text);
        return out;
    }

    for (let i = 0; i < text.length - 1; i += 1) {
        out.push(text.slice(i, i + 2));
    }

    return out;
}

function diceSimilarity(a, b) {
    const left = bigrams(a);
    const right = bigrams(b);

    if (!left.length || !right.length) return 0;

    const counts = new Map();
    for (const item of left) {
        counts.set(item, (counts.get(item) || 0) + 1);
    }

    let overlap = 0;
    for (const item of right) {
        const count = counts.get(item) || 0;
        if (count > 0) {
            overlap += 1;
            counts.set(item, count - 1);
        }
    }

    return (2 * overlap) / (left.length + right.length);
}

function normalizedEditSimilarity(a, b) {
    const left = compactScannerName(a);
    const right = compactScannerName(b);

    if (!left || !right) return 0;
    if (left === right) return 1;

    const distance = levenshteinDistance(left, right);
    return Math.max(0, 1 - (distance / Math.max(left.length, right.length)));
}

function scoreScannerNameSuggestion(inputText, candidate) {
    const input = compactScannerName(inputText);
    const name = compactScannerName(candidate?.displayName || candidate?.normalizedName || '');

    if (!input || !name) return 0;
    if (input === name) return 1;

    const edit = normalizedEditSimilarity(input, name);
    const dice = diceSimilarity(input, name);

    let score = (edit * 0.65) + (dice * 0.35);

    if (name.startsWith(input) || input.startsWith(name)) {
        score = Math.max(score, 0.82);
    }

    return Math.max(0, Math.min(1, score));
}

function nameIndexDocToSuggestion(inputText, doc) {
    const data = doc && typeof doc.data === 'function' ? doc.data() : doc;
    if (!data || typeof data !== 'object') return null;

    const name = String(data.displayName || '').trim();
    const normalizedName = String(data.normalizedName || normalizeCatalogText(name)).trim();
    if (!name || !normalizedName) return null;

    const score = scoreScannerNameSuggestion(inputText, data);
    const matchedBy = [];

    const compactInput = compactScannerName(inputText);
    if (compactInput === compactScannerName(name)) matchedBy.push('exact');
    if (compactInput.slice(0, 3) && compactInput.slice(0, 3) === String(data.prefix3 || '')) matchedBy.push('prefix3');
    if (compactInput.slice(0, 2) && compactInput.slice(0, 2) === String(data.prefix2 || '')) matchedBy.push('prefix2');
    matchedBy.push('fuzzy');

    return {
        name,
        normalizedName,
        score,
        source: 'scannerNameIndex',
        matchedBy: Array.from(new Set(matchedBy)),
        exampleCardIds: Array.isArray(data.exampleCardIds) ? data.exampleCardIds.slice(0, 5) : [],
    };
}
```

## 5. Add lookup helper

```js
async function findScannerNameSuggestions(inputText, limit) {
    const text = String(inputText || '').trim().slice(0, 120);
    const normalized = normalizeCatalogText(text);
    const compact = compactScannerName(text);

    if (compact.length < 2) {
        return [];
    }

    const db = admin.firestore();
    const collection = db.collection('scannerNameIndex');
    const tasks = [];

    const exactDocId = getScannerNameIndexDocId(normalized);
    if (exactDocId) {
        tasks.push(collection.doc(exactDocId).get().then((doc) => ({
            docs: doc.exists ? [doc] : []
        })));
    }

    if (compact.length >= 3) {
        tasks.push(collection.where('prefix3', '==', compact.slice(0, 3)).limit(80).get());
    }

    if (compact.length >= 2) {
        tasks.push(collection.where('prefix2', '==', compact.slice(0, 2)).limit(120).get());
    }

    const firstLetter = compact.slice(0, 1);
    if (firstLetter) {
        tasks.push(collection.where('firstLetter', '==', firstLetter).limit(200).get());
    }

    const token = normalized.split(/\s+/).filter(Boolean)[0] || '';
    if (token && token.length >= 3) {
        tasks.push(collection.where('tokens', 'array-contains', token).limit(80).get());
    }

    const snapshots = await Promise.all(tasks);
    const byName = new Map();

    for (const snap of snapshots) {
        for (const doc of snap.docs || []) {
            const suggestion = nameIndexDocToSuggestion(text, doc);
            if (!suggestion) continue;

            const key = suggestion.normalizedName;
            const prev = byName.get(key);
            if (!prev || suggestion.score > prev.score) {
                byName.set(key, suggestion);
            }
        }
    }

    const minScore = getScannerNameSuggestionsMinScore();

    return Array.from(byName.values())
        .filter((item) => Number(item.score || 0) >= minScore)
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
        .slice(0, limit);
}
```

## 6. Add HTTPS endpoint

```js
exports.scannerNameSuggestions = functions.https.onRequest(async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, X-PV-Catalog-Secret');
        res.status(204).send('');
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ ok: false, error: 'Method Not Allowed' });
        return;
    }

    if (!isScannerNameSuggestionsEnabled()) {
        res.status(200).json({
            ok: true,
            enabled: false,
            source: 'scannerNameIndex',
            data: [],
        });
        return;
    }

    const expectedSecret = getScannerNameSuggestionsSecret();
    const providedSecret = String(req.get('x-pv-catalog-secret') || '').trim();

    if (!expectedSecret || !providedSecret || !timingSafeStringEquals(providedSecret, expectedSecret)) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
    }

    const text = String(req.body?.text || req.body?.name || '').trim().slice(0, 120);
    const rawLimit = Number(req.body?.limit || getScannerNameSuggestionsMaxResults());
    const limit = Math.max(1, Math.min(getScannerNameSuggestionsMaxResults(), Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 5));

    if (!text || compactScannerName(text).length < 2) {
        res.status(200).json({
            ok: true,
            enabled: true,
            source: 'scannerNameIndex',
            data: [],
        });
        return;
    }

    try {
        const data = await findScannerNameSuggestions(text, limit);

        res.status(200).json({
            ok: true,
            enabled: true,
            source: 'scannerNameIndex',
            count: data.length,
            data,
            input: {
                text,
                limit,
            },
        });
    } catch (error) {
        functions.logger.error('scannerNameSuggestions failed', {
            message: String(error?.message || error),
        });

        res.status(500).json({
            ok: false,
            error: 'Could not load scanner name suggestions.',
        });
    }
});
```

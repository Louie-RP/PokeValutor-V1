# Firebase Functions Patch: scannerCandidates

Add this to `functions/index.js`.

Your file already has:
- `admin`
- `functions`
- `crypto`
- `FieldValue`
- `configValue`
- `timingSafeStringEquals`
- `normalizeCatalogText`
- `normalizeCatalogNumberKey`

So this patch reuses those existing helpers.

## 1. Add config helpers near your card catalog hydration config helpers

```js
function getCardCatalogCandidatesSecret() {
    return configValue(
        'CARD_CATALOG_CANDIDATES_SECRET',
        ['card_catalog', 'candidates_secret'],
        getCardCatalogHydrationSecret()
    );
}

function isCardCatalogCandidatesEnabled() {
    const raw = configValue('CARD_CATALOG_CANDIDATES_ENABLED', ['card_catalog', 'candidates_enabled'], 'false');
    const normalized = String(raw || '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function getCardCatalogCandidatesMaxResults() {
    const raw = Number(configValue('CARD_CATALOG_CANDIDATES_MAX_RESULTS', ['card_catalog', 'candidates_max_results'], '12'));
    return Number.isFinite(raw) && raw > 0 ? Math.min(25, Math.floor(raw)) : 12;
}
```

## 2. Add candidate helpers before exports

```js
function normalizeScannerCandidateInput(raw) {
    const name = String(raw?.name || raw?.cardName || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    const number = String(raw?.number || raw?.collectorNumber || raw?.cardNumber || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 32);
    const numberKey = normalizeCatalogNumberKey(raw?.numberKey || number);
    const setId = String(raw?.setId || raw?.expansionId || '').trim().toLowerCase().slice(0, 80);
    const rawLimit = Number(raw?.limit || getCardCatalogCandidatesMaxResults());
    const limit = Math.max(1, Math.min(getCardCatalogCandidatesMaxResults(), Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 12));

    return {
        name,
        normalizedName: normalizeCatalogText(name),
        nameTokens: normalizeCatalogText(name).split(/\s+/).filter(Boolean).slice(0, 5),
        number,
        numberKey,
        setId,
        limit,
    };
}

function numberForCandidateCompare(value) {
    return normalizeCatalogNumberKey(value);
}

function scoreNameCandidate(inputName, cardName) {
    const input = normalizeCatalogText(inputName);
    const card = normalizeCatalogText(cardName);

    if (!input || !card) return 0;
    if (input === card) return 25;
    if (card.includes(input) || input.includes(card)) return 18;

    const inputTokens = input.split(/\s+/).filter(Boolean);
    const cardTokens = new Set(card.split(/\s+/).filter(Boolean));
    if (!inputTokens.length || !cardTokens.size) return 0;

    let overlap = 0;
    for (const token of inputTokens) {
        if (cardTokens.has(token)) overlap += 1;
    }

    return Math.round((overlap / Math.max(inputTokens.length, cardTokens.size)) * 12);
}

function scoreCatalogCandidate(input, doc) {
    let score = 0;
    const matchedBy = [];

    const cardNumberKey = numberForCandidateCompare(doc?.numberKey || doc?.number || doc?.printedNumber || doc?.collectorNumber || '');
    if (input.numberKey && cardNumberKey && input.numberKey === cardNumberKey) {
        score += 55;
        matchedBy.push('numberKey');
    }

    const nameScore = scoreNameCandidate(input.name, doc?.name || '');
    if (nameScore > 0) {
        score += nameScore;
        matchedBy.push(nameScore >= 25 ? 'normalizedName' : 'namePartial');
    }

    const cardSetId = String(doc?.setId || '').trim().toLowerCase();
    if (input.setId && cardSetId && input.setId === cardSetId) {
        score += 15;
        matchedBy.push('setId');
    }

    if (doc?.imageLarge || doc?.imageSmall) {
        score += 5;
        matchedBy.push('imageUrl');
    }

    return {
        score: Math.max(0, Math.min(100, score)),
        matchedBy,
    };
}

function cardCatalogDocToScannerCandidate(doc, input) {
    const data = doc && typeof doc.data === 'function' ? doc.data() : doc;
    if (!data || typeof data !== 'object') return null;

    const id = String(data.id || doc?.id || '').trim();
    if (!id) return null;

    const scored = scoreCatalogCandidate(input, data);
    if (scored.score <= 0) return null;

    const setId = String(data.setId || '').trim();
    const setName = String(data.setName || '').trim();
    const series = String(data.series || '').trim();
    const imageSmall = String(data.imageSmall || '').trim();
    const imageLarge = String(data.imageLarge || imageSmall || '').trim();

    return {
        id,
        name: String(data.name || '').trim(),
        number: String(data.number || data.printedNumber || data.collectorNumber || '').trim(),
        printedNumber: String(data.printedNumber || data.number || '').trim(),
        collectorNumber: String(data.collectorNumber || data.number || '').trim(),
        rarity: String(data.rarity || '').trim(),
        setId,
        setName,
        series,
        imageSmall,
        imageLarge,
        expansion: {
            id: setId,
            name: setName,
            series,
        },
        set: {
            id: setId,
            name: setName,
            series,
        },
        images: {
            small: imageSmall,
            medium: imageLarge || imageSmall,
            large: imageLarge || imageSmall,
        },
        _candidate: {
            source: 'firestore-cardCatalog',
            score: scored.score,
            matchedBy: scored.matchedBy,
        },
    };
}

function mergeAndSortCatalogCandidates(input, snapshots) {
    const byId = new Map();

    for (const snap of snapshots) {
        for (const doc of snap.docs || []) {
            const candidate = cardCatalogDocToScannerCandidate(doc, input);
            if (!candidate?.id) continue;

            const prev = byId.get(candidate.id);
            if (!prev || Number(candidate._candidate?.score || 0) > Number(prev._candidate?.score || 0)) {
                byId.set(candidate.id, candidate);
            }
        }
    }

    const out = Array.from(byId.values())
        .sort((a, b) => {
            const scoreDiff = Number(b._candidate?.score || 0) - Number(a._candidate?.score || 0);
            if (scoreDiff) return scoreDiff;

            const setA = String(a.setId || '');
            const setB = String(b.setId || '');
            if (input.setId && setA === input.setId && setB !== input.setId) return -1;
            if (input.setId && setB === input.setId && setA !== input.setId) return 1;

            return String(a.name || '').localeCompare(String(b.name || ''));
        })
        .slice(0, input.limit);

    return out;
}

async function findScannerCatalogCandidates(input) {
    const db = admin.firestore();
    const collection = db.collection('cardCatalog');
    const tasks = [];

    if (input.numberKey) {
        tasks.push(collection.where('numberKey', '==', input.numberKey).limit(60).get());
    }

    if (input.normalizedName) {
        tasks.push(collection.where('normalizedName', '==', input.normalizedName).limit(40).get());
    }

    const firstToken = input.nameTokens[0] || '';
    if (firstToken) {
        tasks.push(collection.where('nameTokens', 'array-contains', firstToken).limit(60).get());
    }

    if (!tasks.length) {
        return [];
    }

    const snapshots = await Promise.all(tasks);
    return mergeAndSortCatalogCandidates(input, snapshots);
}
```

## 3. Add the HTTPS Function near your other HTTP exports

```js
exports.scannerCandidates = functions.https.onRequest(async (req, res) => {
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

    if (!isCardCatalogCandidatesEnabled()) {
        res.status(200).json({
            ok: true,
            enabled: false,
            source: 'firestore-cardCatalog',
            data: [],
        });
        return;
    }

    const expectedSecret = getCardCatalogCandidatesSecret();
    const providedSecret = String(req.get('x-pv-catalog-secret') || '').trim();

    if (!expectedSecret || !providedSecret || !timingSafeStringEquals(providedSecret, expectedSecret)) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
    }

    const input = normalizeScannerCandidateInput(req.body || {});

    if (!input.name && !input.numberKey) {
        res.status(400).json({
            ok: false,
            error: 'Missing scanner candidate input. Provide name or number.',
        });
        return;
    }

    try {
        const data = await findScannerCatalogCandidates(input);

        res.status(200).json({
            ok: true,
            enabled: true,
            source: 'firestore-cardCatalog',
            count: data.length,
            data,
            input: {
                name: input.name,
                number: input.number,
                numberKey: input.numberKey,
                setId: input.setId,
                limit: input.limit,
            },
        });
    } catch (error) {
        functions.logger.error('scannerCandidates failed', {
            message: String(error?.message || error),
        });

        res.status(500).json({
            ok: false,
            error: 'Could not load scanner candidates.',
        });
    }
});
```

## 4. Required Firebase config/env

```txt
CARD_CATALOG_CANDIDATES_ENABLED=true
CARD_CATALOG_CANDIDATES_SECRET=<secret>
CARD_CATALOG_CANDIDATES_MAX_RESULTS=12
```

If you do not set `CARD_CATALOG_CANDIDATES_SECRET`, the helper falls back to `CARD_CATALOG_HYDRATION_SECRET`.

# Firebase Functions code: trusted Firestore catalog writer

Add this to `functions/index.js`.

This assumes your existing file already has:

```js
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');
```

It also assumes `admin.initializeApp()` already exists.

## 1. Add config helpers

```js
function getCardCatalogHydrationSecret() {
    return configValue('CARD_CATALOG_HYDRATION_SECRET', ['card_catalog', 'hydration_secret'], '');
}

function isCardCatalogHydrationEnabled() {
    const raw = configValue('CARD_CATALOG_HYDRATION_ENABLED', ['card_catalog', 'hydration_enabled'], 'false');
    const normalized = String(raw || '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function getCardCatalogHydrationMaxCards() {
    const raw = Number(configValue('CARD_CATALOG_HYDRATION_MAX_CARDS', ['card_catalog', 'hydration_max_cards'], '25'));
    return Number.isFinite(raw) && raw > 0 ? Math.min(50, Math.floor(raw)) : 25;
}

function safeTimingEqual(a, b) {
    const left = Buffer.from(String(a || ''), 'utf8');
    const right = Buffer.from(String(b || ''), 'utf8');

    if (left.length !== right.length) {
        return false;
    }

    return crypto.timingSafeEqual(left, right);
}
```

If your file already has `timingSafeStringEquals`, you can use that instead of adding `safeTimingEqual`.

## 2. Add normalizers

```js
function normalizeCatalogText(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[’']/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeCatalogNumberKey(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[OQD]/g, '0')
        .replace(/[IL|!]/g, '1')
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function normalizeCatalogCardDoc(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const id = String(raw.id || '').trim();
    if (!/^[a-z0-9][a-z0-9._:-]{1,120}$/i.test(id)) {
        return null;
    }

    const name = String(raw.name || '').trim().slice(0, 120);
    const number = String(raw.number || raw.printedNumber || raw.collectorNumber || '').trim().slice(0, 32);
    const setId = String(raw.setId || raw.expansionId || '').trim().slice(0, 80);
    const setName = String(raw.setName || raw.expansionName || '').trim().slice(0, 120);
    const series = String(raw.series || '').trim().slice(0, 80);
    const rarity = String(raw.rarity || '').trim().slice(0, 80);
    const imageSmall = String(raw.imageSmall || '').trim().slice(0, 500);
    const imageLarge = String(raw.imageLarge || raw.imageSmall || '').trim().slice(0, 500);

    if (!name && !number) {
        return null;
    }

    return {
        id,
        name,
        normalizedName: normalizeCatalogText(name),
        nameTokens: normalizeCatalogText(name).split(/\s+/).filter(Boolean).slice(0, 10),
        number,
        numberKey: normalizeCatalogNumberKey(number),
        printedNumber: String(raw.printedNumber || number).trim().slice(0, 32),
        collectorNumber: String(raw.collectorNumber || number).trim().slice(0, 32),
        setId,
        setName,
        series,
        rarity,
        imageSmall,
        imageLarge,
        source: 'scrydex-worker',
        updatedAt: FieldValue.serverTimestamp(),
    };
}
```

## 3. Add HTTPS function

```js
exports.hydrateCardCatalog = functions.https.onRequest(async (req, res) => {
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

    if (!isCardCatalogHydrationEnabled()) {
        res.status(503).json({ ok: false, error: 'Card catalog hydration is disabled.' });
        return;
    }

    const expectedSecret = getCardCatalogHydrationSecret();
    const providedSecret = String(req.get('x-pv-catalog-secret') || '').trim();

    if (!expectedSecret || !providedSecret || !safeTimingEqual(providedSecret, expectedSecret)) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
    }

    const rawCards = Array.isArray(req.body?.cards) ? req.body.cards : [];
    const maxCards = getCardCatalogHydrationMaxCards();

    const docs = rawCards
        .slice(0, maxCards)
        .map(normalizeCatalogCardDoc)
        .filter(Boolean);

    if (!docs.length) {
        res.status(200).json({ ok: true, attempted: 0, saved: 0, ids: [] });
        return;
    }

    try {
        const db = admin.firestore();
        const refs = docs.map((doc) => db.collection('cardCatalog').doc(doc.id));
        const snaps = await db.getAll(...refs);

        const batch = db.batch();
        const ids = [];

        docs.forEach((doc, index) => {
            const ref = refs[index];
            const snap = snaps[index];

            const payload = {
                ...doc,
                updatedAt: FieldValue.serverTimestamp(),
            };

            if (!snap.exists) {
                payload.firstSeenAt = FieldValue.serverTimestamp();
            }

            batch.set(ref, payload, { merge: true });
            ids.push(doc.id);
        });

        await batch.commit();

        res.status(200).json({
            ok: true,
            attempted: docs.length,
            saved: docs.length,
            ids,
        });
    } catch (error) {
        functions.logger.error('hydrateCardCatalog failed', {
            message: String(error?.message || error),
        });

        res.status(500).json({
            ok: false,
            error: 'Could not hydrate card catalog.',
        });
    }
});
```

## 4. Firestore rules

Add this to your Firestore rules:

```js
match /cardCatalog/{cardId} {
  allow read: if true;
  allow write: if false;
}
```

## 5. Deploy / config notes

Set the Function secret:

```bash
firebase functions:secrets:set CARD_CATALOG_HYDRATION_SECRET
```

Or use environment config depending on your current Firebase Functions setup.

Then set Worker secrets:

```bash
wrangler secret put CARD_CATALOG_HYDRATION_SECRET
```

Set Worker vars:

```txt
CARD_CATALOG_HYDRATION_ENABLED=1
CARD_CATALOG_HYDRATION_URL=https://<region>-<project>.cloudfunctions.net/hydrateCardCatalog
CARD_CATALOG_HYDRATION_MAX_CARDS=25
CARD_CATALOG_KNOWN_TTL_SECONDS=2592000
```

Start disabled first, deploy, then enable in dev.

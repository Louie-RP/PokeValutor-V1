# Spec: Collection Value Tracking

## Status

Phase 1 feature. This should be implemented before offers, trade history, or graded ROI.

## Goal

Add a collection value dashboard to the Dex page that shows the user's current collection value and the change from the previous saved snapshot.

The user should be able to quickly see:

- Current collection value
- Previous snapshot value
- Dollar change
- Percent change
- Green increase indicator
- Red decrease indicator
- Number of priced items vs unpriced items
- Snapshot timestamp

## Important API Credit Rule

PokéValuator must be conservative with Scrydex API credits.

All Scrydex API calls must continue to go through the existing Worker path. The browser should not call Scrydex directly.

This feature should not add a manual refresh button in the MVP. Manual refresh sounds useful, but it can turn into repeated API usage very quickly. For Phase 1, collection value should update through saved snapshots and cached prices only.

## Current App Context

Current repo structure already supports this feature well:

- `dex.html` already has a Collection section and a `pv-collection-total` element.
- `dex-tracker-pages.js` already reads/writes Dex collection data with `localStorage` and cloud sync.
- `dex-tracker-pages.js` already calculates item values using card/sealed prices.
- `firebase.js` already exposes `PV_AUTH.callFunction`, `loadDexState`, and `saveDexState`.
- `functions/index.js` already uses Firebase Admin, callable functions, Upstash config, Stripe, custom roles, and Scrydex webhook dirty keys.
- `firestore.rules` already supports `users/{uid}/dex/state` and `dexShared/{shareToken}`.

The main change is to move collection value tracking away from short-lived client-only value calculation and toward durable Firestore snapshots.

## Non-Goals for Phase 1

Do not build these yet:

- Manual refresh button
- Live price recalculation on every Dex page load
- Public collection value history
- Per-card historical charts
- Graded ROI calculations
- Offer/trade system
- Email notifications

## User Story

As a logged-in user, I want to open my Dex page and see whether my collection value is up or down since the previous snapshot, without burning extra API credits every time I visit the page.

## Product Behavior

### On Dex page load

1. Load the user's collection like it already does.
2. Load the latest value snapshot from Firestore.
3. If today's snapshot already exists, display it.
4. If no current snapshot exists, request snapshot creation from a Firebase callable function.
5. The callable function should calculate from existing cached prices first.
6. The callable function should not call the Worker by default.
7. If some cards do not have cached prices, mark them as unpriced instead of forcing new Scrydex calls.

### Snapshot frequency

MVP recommendation:

- One automatic snapshot per user per collection per day.
- Use the user's active Dex collection ID.
- Use the user's local day if available, otherwise UTC day.
- No manual refresh button.

### Display examples

Increase:

```text
Collection Value
$1,245.80
+$38.42 (+3.18%) since last snapshot
214/220 items priced
Last updated: Jun 17, 2026, 8:15 AM
```

Decrease:

```text
Collection Value
$1,207.38
-$12.50 (-1.04%) since last snapshot
213/220 items priced
Last updated: Jun 17, 2026, 8:15 AM
```

No previous snapshot:

```text
Collection Value
$1,245.80
First saved snapshot
214/220 items priced
```

## Data Model

### User snapshot collection

Path:

```text
users/{uid}/dexValueSnapshots/{snapshotId}
```

Suggested `snapshotId`:

```text
{collectionId}_{YYYY-MM-DD}
```

Example:

```text
default_2026-06-17
```

Snapshot document:

```js
{
  uid: "firebaseUid",
  collectionId: "default",
  snapshotDate: "2026-06-17",
  totalValueCents: 124580,
  previousValueCents: 120738,
  changeCents: 3842,
  changePercent: 3.18,
  pricedItemCount: 214,
  totalItemCount: 220,
  pricedUnitCount: 240,
  totalUnitCount: 248,
  unpricedItemIds: ["sv1-001", "base1-4"],
  source: "cached-prices-only",
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp()
}
```

### Global price cache

Path:

```text
cardPriceCache/{priceKey}
```

Suggested `priceKey` format:

```text
card:{cardId}:{variant}:{condition}
sealed:{sealedId}
```

Price cache document:

```js
{
  key: "card:base1-4:standard:NM",
  itemType: "card",
  cardId: "base1-4",
  variant: "Standard",
  condition: "NM",
  marketCents: 12550,
  currency: "USD",
  source: "scrydex-worker",
  fetchedAt: FieldValue.serverTimestamp(),
  staleAfter: Timestamp,
  dirtyVersion: 3
}
```

Important: client code can read cached prices if allowed, but only trusted server code should write price cache docs.

## API Credit Strategy

### Allowed

- Read existing Firestore snapshots.
- Read existing Firestore price cache docs.
- Use collection item prices already saved in the user's Dex state as a fallback.
- Use Upstash dirty keys/webhook signals to know which expansions may need refreshing.
- Use scheduled/server-controlled refreshes with strict limits.

### Not allowed in MVP

- Calling Scrydex through the Worker every time the Dex loads.
- Adding a manual refresh button that directly triggers Worker calls.
- Refreshing every card in a large collection on demand.
- Running unlimited `Promise.all()` Worker calls for hundreds of collection items.

## Recommended Architecture

```text
Dex page
  ↓
PV_AUTH.callFunction("getCollectionValueSnapshot")
  ↓
Firebase Function reads users/{uid}/dex/state
  ↓
Function reads cardPriceCache docs
  ↓
Function calculates total and writes users/{uid}/dexValueSnapshots/{collectionId_YYYY-MM-DD}
  ↓
Dex page displays snapshot
```

Optional later background flow:

```text
Scrydex webhook / scheduled function
  ↓
Mark dirty expansions in Upstash
  ↓
Scheduled job refreshes a capped number of stale prices through Worker
  ↓
Update cardPriceCache
  ↓
Next user snapshot uses refreshed cached prices
```

## Firebase Callable Function Contract

Function name:

```text
getCollectionValueSnapshot
```

Input:

```js
{
  collectionId: "default",
  timezone: "America/Phoenix"
}
```

Output:

```js
{
  ok: true,
  snapshot: {
    collectionId: "default",
    snapshotDate: "2026-06-17",
    totalValueCents: 124580,
    previousValueCents: 120738,
    changeCents: 3842,
    changePercent: 3.18,
    pricedItemCount: 214,
    totalItemCount: 220,
    pricedUnitCount: 240,
    totalUnitCount: 248,
    unpricedItemIds: [],
    source: "cached-prices-only",
    createdAtMs: 1781712900000
  }
}
```

## Functions Code Example

Add to `functions/index.js`.

This is intended as implementation guidance, not a full copy/paste replacement.

```js
function normalizeCollectionId(raw, fallback = 'default') {
  const normalized = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return normalized || fallback;
}

function toSnapshotDate(timezone) {
  // Simple MVP: use UTC date. Later, use Intl.DateTimeFormat with timezone.
  return new Date().toISOString().slice(0, 10);
}

function cents(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function centsFromMarket(raw) {
  const direct = Number(raw?.market ?? raw?.marketPrice ?? raw?.market_price ?? raw?.price ?? raw?.value);
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct * 100);
  return 0;
}

function normalizeCondition(raw) {
  const upper = String(raw || '').trim().toUpperCase();
  if (upper === 'NM' || upper.startsWith('NEAR')) return 'NM';
  if (upper === 'LP' || upper.startsWith('LIGHT')) return 'LP';
  if (upper === 'MP' || upper.startsWith('MODERATE')) return 'MP';
  if (upper === 'HP' || upper.startsWith('HEAVY')) return 'HP';
  if (upper === 'DM' || upper.startsWith('DAMAGE')) return 'DM';
  return '';
}

function getConditionEntries(item) {
  const map = item?.conditionQuantities && typeof item.conditionQuantities === 'object'
    ? item.conditionQuantities
    : {};

  const entries = [];
  for (const [rawCondition, rawQty] of Object.entries(map)) {
    const condition = normalizeCondition(rawCondition);
    const qty = Math.floor(Number(rawQty));
    if (!condition || !Number.isFinite(qty) || qty <= 0) continue;
    entries.push({ condition, qty });
  }

  if (!entries.length) {
    const fallback = normalizeCondition(item?.selectedCondition);
    if (fallback) entries.push({ condition: fallback, qty: 1 });
  }

  return entries;
}

function buildPriceKeyForCard(item, condition) {
  const id = String(item?.id || '').trim();
  const variant = String(item?.selectedVariant || 'Standard').trim() || 'Standard';
  return `card:${id}:${variant}:${condition}`.toLowerCase();
}

function buildPriceKeyForSealed(item) {
  return `sealed:${String(item?.id || '').trim()}`.toLowerCase();
}

async function readPriceCacheMap(db, keys) {
  const uniqueKeys = Array.from(new Set(keys.filter(Boolean)));
  const out = new Map();

  // Firestore getAll keeps this to one backend operation group.
  const refs = uniqueKeys.map((key) => db.collection('cardPriceCache').doc(key));
  const snaps = refs.length ? await db.getAll(...refs) : [];

  for (const snap of snaps) {
    if (!snap.exists) continue;
    out.set(snap.id, snap.data());
  }

  return out;
}

async function getPreviousSnapshot(db, uid, collectionId, snapshotDate) {
  const snap = await db.collection('users')
    .doc(uid)
    .collection('dexValueSnapshots')
    .where('collectionId', '==', collectionId)
    .where('snapshotDate', '<', snapshotDate)
    .orderBy('snapshotDate', 'desc')
    .limit(1)
    .get();

  if (snap.empty) return null;
  return snap.docs[0].data();
}

exports.getCollectionValueSnapshot = functions.https.onCall(async (data, context) => {
  const uid = requireAuthUid(context);
  const db = admin.firestore();

  const collectionId = normalizeCollectionId(data?.collectionId, 'default');
  const snapshotDate = toSnapshotDate(data?.timezone);
  const snapshotId = `${collectionId}_${snapshotDate}`;

  const snapshotRef = db.collection('users')
    .doc(uid)
    .collection('dexValueSnapshots')
    .doc(snapshotId);

  const existing = await snapshotRef.get();
  if (existing.exists) {
    return { ok: true, snapshot: existing.data(), cached: true };
  }

  const stateRef = db.collection('users').doc(uid).collection('dex').doc('state');
  const stateSnap = await stateRef.get();
  const state = stateSnap.exists ? stateSnap.data() : {};
  const collection = Array.isArray(state.collection) ? state.collection : [];

  const activeItems = collection.filter((item) => {
    return normalizeCollectionId(item?.collectionId, 'default') === collectionId;
  });

  const requiredKeys = [];
  for (const item of activeItems) {
    const itemType = String(item?.itemType || '').toLowerCase() === 'sealed' ? 'sealed' : 'card';
    if (itemType === 'sealed') {
      requiredKeys.push(buildPriceKeyForSealed(item));
      continue;
    }

    for (const entry of getConditionEntries(item)) {
      requiredKeys.push(buildPriceKeyForCard(item, entry.condition));
    }
  }

  const priceCache = await readPriceCacheMap(db, requiredKeys);

  let totalValueCents = 0;
  let pricedItemCount = 0;
  let pricedUnitCount = 0;
  let totalUnitCount = 0;
  const unpricedItemIds = [];

  for (const item of activeItems) {
    const itemId = String(item?.id || '').trim();
    if (!itemId) continue;

    const itemType = String(item?.itemType || '').toLowerCase() === 'sealed' ? 'sealed' : 'card';
    let itemHadPrice = false;

    if (itemType === 'sealed') {
      const qty = Math.max(1, Math.floor(Number(item?.quantity ?? item?.sealedQuantity ?? 1) || 1));
      totalUnitCount += qty;

      const cacheDoc = priceCache.get(buildPriceKeyForSealed(item));
      const unitCents = cents(cacheDoc?.marketCents ? cacheDoc.marketCents / 100 : 0) || centsFromMarket(item);

      if (unitCents > 0) {
        totalValueCents += unitCents * qty;
        pricedUnitCount += qty;
        pricedItemCount += 1;
        itemHadPrice = true;
      }
    } else {
      const conditionEntries = getConditionEntries(item);
      for (const entry of conditionEntries) {
        totalUnitCount += entry.qty;
        const cacheDoc = priceCache.get(buildPriceKeyForCard(item, entry.condition));
        const unitCents = cents(cacheDoc?.marketCents ? cacheDoc.marketCents / 100 : 0) || centsFromMarket(item);

        if (unitCents > 0) {
          totalValueCents += unitCents * entry.qty;
          pricedUnitCount += entry.qty;
          itemHadPrice = true;
        }
      }
      if (itemHadPrice) pricedItemCount += 1;
    }

    if (!itemHadPrice) unpricedItemIds.push(itemId);
  }

  const previous = await getPreviousSnapshot(db, uid, collectionId, snapshotDate);
  const previousValueCents = Math.max(0, Math.floor(Number(previous?.totalValueCents || 0)));
  const changeCents = previous ? totalValueCents - previousValueCents : 0;
  const changePercent = previousValueCents > 0
    ? Math.round((changeCents / previousValueCents) * 10000) / 100
    : 0;

  const snapshot = {
    uid,
    collectionId,
    snapshotDate,
    totalValueCents,
    previousValueCents,
    changeCents,
    changePercent,
    pricedItemCount,
    totalItemCount: activeItems.length,
    pricedUnitCount,
    totalUnitCount,
    unpricedItemIds: unpricedItemIds.slice(0, 100),
    source: 'cached-prices-only',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await snapshotRef.set(snapshot, { merge: true });
  return { ok: true, snapshot, cached: false };
});
```

## Front-End API Additions

Add stub methods to the unconfigured `PV_AUTH` fallback in `firebase.js`:

```js
loadCollectionValueSnapshot: async () => null,
```

Add real method near the existing `callFunction` usage:

```js
async function loadCollectionValueSnapshot(collectionId) {
  return callFunction('getCollectionValueSnapshot', {
    collectionId: String(collectionId || 'default'),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  });
}
```

Export it in `window.PV_AUTH`:

```js
loadCollectionValueSnapshot,
```

## Dex HTML Addition

Add this under the existing `pv-collection-total` paragraph in `dex.html`.

```html
<div id="pv-collection-value-trend" class="pv-valueTrend" role="status" aria-live="polite" hidden>
  <p class="pv-valueTrend__main">
    <span id="pv-value-trend-amount">$0.00</span>
    <span id="pv-value-trend-percent">0.00%</span>
  </p>
  <p id="pv-value-trend-meta" class="pv-valueTrend__meta"></p>
</div>
```

## Dex JS Example

Add this logic in `dex-tracker-pages.js` after collection render and active collection selection are known.

```js
function formatSignedUsdFromCents(centsRaw) {
  const n = Math.round(Number(centsRaw) || 0);
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  return `${sign}$${(Math.abs(n) / 100).toFixed(2)}`;
}

function formatUsdFromCents(centsRaw) {
  const n = Math.max(0, Math.round(Number(centsRaw) || 0));
  return `$${(n / 100).toFixed(2)}`;
}

function renderCollectionValueSnapshot(snapshot) {
  const totalEl = document.getElementById('pv-collection-total');
  const trendWrap = document.getElementById('pv-collection-value-trend');
  const trendAmountEl = document.getElementById('pv-value-trend-amount');
  const trendPercentEl = document.getElementById('pv-value-trend-percent');
  const trendMetaEl = document.getElementById('pv-value-trend-meta');

  if (!snapshot || !totalEl) return;

  totalEl.textContent = `Value: ${formatUsdFromCents(snapshot.totalValueCents)}`;

  if (!trendWrap || !trendAmountEl || !trendPercentEl || !trendMetaEl) return;

  const changeCents = Number(snapshot.changeCents || 0);
  const changePercent = Number(snapshot.changePercent || 0);
  const hasPrevious = Number(snapshot.previousValueCents || 0) > 0;

  trendWrap.hidden = false;
  trendWrap.classList.toggle('pv-valueTrend--up', changeCents > 0);
  trendWrap.classList.toggle('pv-valueTrend--down', changeCents < 0);
  trendWrap.classList.toggle('pv-valueTrend--flat', changeCents === 0);

  if (hasPrevious) {
    trendAmountEl.textContent = formatSignedUsdFromCents(changeCents);
    trendPercentEl.textContent = `(${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)`;
  } else {
    trendAmountEl.textContent = 'First saved snapshot';
    trendPercentEl.textContent = '';
  }

  const pricedItems = Number(snapshot.pricedItemCount || 0);
  const totalItems = Number(snapshot.totalItemCount || 0);
  trendMetaEl.textContent = `${pricedItems}/${totalItems} items priced • Snapshot ${snapshot.snapshotDate || ''}`;
}

async function loadAndRenderCollectionValueSnapshot() {
  const authApi = window?.PV_AUTH;
  const user = authApi?.getUser ? authApi.getUser() : null;
  if (!user || !authApi?.loadCollectionValueSnapshot) return;

  const collectionId = getActiveCollectionId();
  try {
    const result = await authApi.loadCollectionValueSnapshot(collectionId);
    renderCollectionValueSnapshot(result?.snapshot || null);
  } catch {
    // Do not block Dex rendering if snapshot fails.
  }
}
```

Call it after collection render:

```js
renderCollection();
loadAndRenderCollectionValueSnapshot();
```

## CSS Example

Add to `styles.css`.

```css
.pv-valueTrend {
  margin: 0.5rem 0 1rem;
  padding: 0.75rem 1rem;
  border-radius: 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.16);
}

.pv-valueTrend__main {
  margin: 0;
  font-weight: 700;
}

.pv-valueTrend__meta {
  margin: 0.25rem 0 0;
  opacity: 0.85;
  font-size: 0.95rem;
}

.pv-valueTrend--up .pv-valueTrend__main {
  color: #2ecc71;
}

.pv-valueTrend--down .pv-valueTrend__main {
  color: #ff6b6b;
}

.pv-valueTrend--flat .pv-valueTrend__main {
  color: inherit;
}
```

If you prefer to avoid hardcoded colors, use existing design tokens if your stylesheet already defines green/red variables.

## Firestore Rules Addition

Add this before the deny-all rule.

```js
function isValidSnapshotId(snapshotId) {
  return snapshotId is string
    && snapshotId.size() >= 12
    && snapshotId.size() <= 64
    && snapshotId.matches('^[a-z0-9_-]+_[0-9]{4}-[0-9]{2}-[0-9]{2}$');
}

match /users/{userId}/dexValueSnapshots/{snapshotId} {
  allow read: if isOwner(userId) && isValidSnapshotId(snapshotId);
  allow create, update, delete: if false;
}

match /cardPriceCache/{priceKey} {
  allow read: if isSignedIn();
  allow create, update, delete: if false;
}
```

Note: Firebase Admin SDK writes bypass Firestore rules, so callable/scheduled functions can still create snapshots and update cache docs.

## Testing Plan

### Unit-ish function tests

Use Firebase emulator where possible.

Test cases:

1. User with empty collection gets `$0.00` snapshot.
2. User with one card and cached NM price gets correct total.
3. User with three copies gets `unit price * quantity`.
4. User with NM and LP quantities gets both conditions included.
5. User with no cached price gets item counted as unpriced.
6. Second snapshot calculates dollar and percent change from previous snapshot.
7. Repeated same-day calls return existing snapshot and do not recalculate.
8. Snapshot only uses the requested collection ID.
9. Basic user collection ID normalization still supports `default`.
10. Function refuses unauthenticated calls.

### Browser tests

1. Dex page loads with old collection UI still intact.
2. Value trend appears after login.
3. Value trend is hidden or neutral when no snapshot exists and function fails.
4. Green styling appears for positive change.
5. Red styling appears for negative change.
6. First snapshot displays “First saved snapshot.”
7. Collection sort still works after snapshot render.
8. Shared collection page is not affected.

### API credit tests

1. Opening Dex should not call `/cards/{id}?includePrices=1` for snapshot calculation.
2. Reopening Dex on the same day should return the same snapshot.
3. Snapshot function should read Firestore and not call Scrydex Worker by default.
4. If Worker calls are added later, confirm strict caps and logs.

## Performance Expectations

This feature should make the site feel faster, not slower.

Expected behavior:

- Dex page renders existing collection immediately.
- Snapshot loads separately and updates the value UI when ready.
- Same-day snapshot calls should be cheap Firestore reads.
- No hundreds-of-card Worker call burst on page load.
- Large collections should show partial pricing coverage instead of forcing API calls.

## Acceptance Criteria

- User can view latest collection value on Dex.
- User can view change from the previous snapshot.
- User can see green positive percent and red negative percent.
- User can see priced item coverage.
- No manual refresh button is added.
- No direct Scrydex call is made from the browser.
- Snapshot creation does not call the Worker by default.
- Existing Dex add/remove/update behavior still works.
- Existing shared collection behavior still works.
- Firestore rules prevent client writes to snapshots and price cache.

## Rollout Plan

1. Add callable function and Firestore rules.
2. Deploy functions/rules to dev or staging.
3. Add front-end method in `firebase.js`.
4. Add Dex UI elements.
5. Add rendering logic in `dex-tracker-pages.js`.
6. Test with one small account and one larger collection.
7. Confirm no extra Worker/Scrydex traffic from Dex page load.
8. Release to production.

## Future Enhancements

- Weekly/monthly value chart.
- Per-set value change.
- Per-card movers.
- Premium daily trend history.
- Scheduled price cache refresh.
- Email/push alerts for large collection changes.


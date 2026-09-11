# PokeValuator Trade Section — Implementation Specification

**Status:** Ready for controlled implementation  
**Feature scope:** Card Search page trade workspace + Card Details add-to-trade action + optional Firebase sync  
**Required placement:** Collapsible Trade section above Watchlist on `search.html`  
**Default trade percentage:** 80%  
**Primary constraint:** Trade operations must use already-loaded/cached card data and must not trigger unnecessary Scrydex requests

## 1. Goal

Add a persistent Trade workspace where users can build a group of cards across multiple searches, choose a trade percentage for each card, optionally apply one percentage to every card, and see accurate totals for:

- raw market value
- trade-adjusted value
- per-card trade value
- overall trade percentage/effective value

The workspace must survive additional searches and normal page navigation, remain collapsible, appear above Watchlist, and avoid regressions in Search, Card Details, Watchlist, Dex, auth, quota, or API-credit usage.

The Trade workspace is a **calculator/workspace**, not a marketplace in V1. It does not create offers between users, transfer cards, send messages, or publish trades publicly.

---

## 2. Confirmed repository findings

### Existing trade-percentage logic already exists

`search.js` already has:

```text
DEFAULT_TRADE_PERCENT = 80
TRADE_PERCENT_CHOICES = [100, 90, 80, 70, 60, 50]
TRADE_PERCENT_MAP_KEY = pv:scrydex:tradePercentById:v1
```

It also already normalizes and persists a trade percentage by card ID and stores selected-card state in existing Search result persistence.

This is useful code and should be reused/refactored rather than creating a second percentage calculation with different rules.

### Existing Watchlist persistence pattern

The Card Search and Card Details pages already use:

```text
pv:scrydex:watchlist:v1
```

for local storage and Firebase helpers for signed-in cloud persistence.

`firebase.js` already exposes card Watchlist load/save/remove helpers and keeps an 8-hour local cloud cache.

This provides a proven reference pattern for Trade persistence, but the Trade workspace should remain a separate collection/key so Watchlist semantics do not become overloaded.

### Current Firestore rules

The current generic tracked-item rule allows only these user subcollections:

```text
cardWatchlist
sealedWatchlist
cardFavorites
sealedFavorites
```

A cloud-backed Trade collection is therefore **not currently allowed**. If Trade is synced to Firestore, `firestore.rules` must be updated intentionally.

### Current Card Details actions

`card.html` currently exposes:

- Add/Remove Watchlist
- Share

The Trade feature should add a third card action, **Add to Trade**, beside those existing actions.

### Current Search page placement

`search.html` currently renders:

1. Search workspace/results
2. Watchlist section

The new Trade section must be inserted between those two.

---

## 3. Recommended architecture

Use a local-first workspace with optional signed-in cloud sync.

### Local storage — source for immediate UI

New key:

```text
pv:scrydex:tradeWorkspace:v1
```

Suggested shape:

```js
{
  version: 1,
  defaultPercent: 80,
  updatedAt: 1787040000000,
  items: [
    {
      id: 'base1-4',
      name: 'Charizard',
      expansion: { id: 'base1', name: 'Base Set' },
      image: 'https://...',
      rarity: 'Rare Holo',
      selectedVariant: 'Holofoil',
      selectedCondition: 'NM',
      marketValue: 350.25,
      tradePercent: 80,
      priceUpdatedAt: 1787040000000,
      addedAt: 1787040000000
    }
  ]
}
```

Do not store a full unbounded Scrydex response for every Trade item. Store only the fields needed to render and calculate the workspace.

### Cloud sync — optional signed-in durability

Recommended Firestore path:

```text
/users/{uid}/cardTrade/{cardId}
```

Each document contains one item. This mirrors Watchlist and makes add/remove/update inexpensive.

Recommended helper API in `window.PV_AUTH`:

```text
loadTradeItems()
saveTradeItem(item)
removeTradeItem(id)
```

If cloud sync makes the first implementation too large, local-only V1 is acceptable, provided the storage interface is isolated so cloud sync can be added without changing the UI calculations. However, because the site already syncs Watchlist, cloud sync is the preferred final state for signed-in users.

### Do not use Upstash for the user's Trade list

Upstash is best kept for shared server cache/quota use. A personal mutable Trade workspace belongs in localStorage and/or Firestore, not the shared Scrydex cache.

---

## 4. Trade item identity

V1 uses one Trade entry per `card.id`.

If the user adds the same card again:

- do not create a duplicate row
- bring/update the existing item
- preserve its current trade percentage unless the user explicitly changes it
- update the cached card snapshot if the newly added snapshot is newer/more complete

### Variant handling

A Pokémon card can have several variants. V1 must save the selected variant with the Trade item.

If the user adds a card from Search:

- use the currently selected result-card variant if one is selected
- otherwise use the existing Search result default variant logic

If the user adds a card from Card Details:

- V1 may default to the first/best priced variant if Card Details has no selected-variant state
- better implementation: add a compact `Variant` selector beside Add to Trade using the already-loaded `currentCard.variants`

No additional network call is allowed just to populate the variant selector because Card Details already has the card payload.

### Condition handling

V1 should use `NM` market by default because it is the current primary pricing basis in the UI and gives a predictable calculator.

If the existing Search result card already has a selected condition/price context, preserve it when reasonable. Do not add a complex condition matrix to the first Trade release.

---

## 5. Price and trade calculation contract

For each item:

```text
tradeValue = marketValue * (tradePercent / 100)
```

Example:

```text
marketValue = $100
tradePercent = 80
tradeValue = $80
```

### Overall totals

```text
rawMarketTotal = sum(each marketValue)
tradeAdjustedTotal = sum(each tradeValue)
```

### Effective overall percentage

Do not average the card percentages arithmetically because cards can have very different values.

Correct weighted calculation:

```text
effectiveTradePercent =
  rawMarketTotal > 0
    ? (tradeAdjustedTotal / rawMarketTotal) * 100
    : 0
```

Example:

```text
Card A: $100 at 50% = $50
Card B: $10 at 100% = $10

Raw total = $110
Trade total = $60
Effective overall trade percentage = 54.55%
```

A simple `(50 + 100) / 2 = 75%` would be wrong and must not be used.

### Money rounding

Keep calculations in Number precision and round **for display**, not after each multiplication if avoidable.

Display USD using the existing `Intl.NumberFormat` helpers/pattern.

---

## 6. Search page Trade section

Insert above Watchlist:

```text
Search Results
↓
Trade
↓
Watchlist
```

Suggested HTML structure:

```text
<section id="pv-trade" ...>
  header
  summary/totals
  controls
  collapsible body
  trade grid/list
</section>
```

Suggested IDs:

```text
pv-trade
pv-trade-title
pv-trade-totals
pv-trade-toggle
pv-trade-clear
pv-trade-body
pv-trade-grid
pv-trade-apply-percent
pv-trade-apply-percent-button
```

### Collapsible behavior

Use the same general UX pattern as Watchlist.

New local key:

```text
pv:scrydex:tradeCollapsed:v1
```

Requirements:

- default expanded for first use
- toggle text is `Hide` / `Show`
- `aria-expanded` stays accurate
- collapsed state survives refresh
- collapsing must not remove data or trigger any API call

### Empty state

Example:

```text
No cards added to Trade yet. Add cards from Search results or a Card Details page.
```

---

## 7. Trade row/card UI

Each Trade item should display:

- card image thumbnail
- card name
- set name
- card number if available
- selected variant
- NM/current market value
- trade percentage control
- calculated trade value
- Remove button

### Per-card percentage

Use a native select or validated numeric control.

Reuse the existing standard choices:

```text
100%
90%
80%
70%
60%
50%
```

The existing normalizer currently supports a wider 0–200 numeric range. For the new Trade workspace, the product should choose one clear rule:

**Recommended V1:** allow 0–100%, while presenting the standard dropdown choices above.

Why cap at 100%:

- it matches the normal meaning of a trade-percentage discount
- it prevents accidental 150–200% entries that make totals confusing
- it can be expanded later if users explicitly need trade premiums

If backward compatibility with existing `tradePercentById` values above 100 is important, migrate/clamp those values only when they are imported into the new workspace; do not silently rewrite the old key globally during the same PR.

### Bulk percentage control

At the top of the Trade section:

```text
Apply to all: [80% ▼] [Apply]
```

Clicking Apply:

- updates every item to the selected percentage
- recalculates every row
- recalculates totals
- persists the updated workspace
- syncs cloud updates efficiently

The user can then change any individual card again.

### Bulk update cloud efficiency

Do not fire an unbounded cloud write loop one after another with UI blocking.

For Firestore V1:

- update local UI/localStorage immediately
- use a Firestore batch write for the Trade documents when available
- cap workspace item count so batch size remains safe
- if existing Firebase compat helper style makes batch writes awkward, use `Promise.allSettled` with a small bounded item limit

Recommended Trade limit:

```text
50 cards
```

That is more than enough for an in-person trade calculator and avoids a huge DOM/storage/cloud write workload.

---

## 8. Add to Trade — Search results

Each Search result card gets a new action:

```text
Add to Trade
```

When already added:

```text
In Trade
```

or:

```text
Remove from Trade
```

Choose one consistent button pattern. Recommended: toggle behavior matching Watchlist.

### Add flow

1. Read the card object already present in the result renderer.
2. Read selected variant/price state already present on that result card.
3. Determine a usable NM market value from loaded variant prices.
4. Create the compact Trade snapshot.
5. Add/update local workspace.
6. Render/recalculate Trade section.
7. Queue cloud save if signed in.
8. Show existing-style action toast.

### Critical credit rule

If the result card already has price data, Add to Trade makes **zero** Worker/Scrydex calls.

If a single-search result does not yet have price data:

- user clicking Add to Trade is an explicit action, so one cached `/cards/{id}?includePrices=1` lookup is acceptable if needed
- always use `fetchJsonWithCache` first
- after response, save the selected compact pricing snapshot
- never refresh every Trade item because one card was added

For the multi-card-search feature, batch results should already contain prices, so adding those results to Trade should never need the per-card fallback.

---

## 9. Add to Trade — Card Details

Add to the existing Card Details action group:

```text
Add to Watchlist
Add to Trade
Share
```

Suggested element:

```html
<button id="pv-card-trade-toggle" ...>Add to Trade</button>
```

In `card.js`:

- derive Trade snapshot from `currentCard`
- do not fetch the card again
- use the variants already loaded for Variant Pricing
- use NM market for the selected/default variant
- persist locally
- optionally sync to Firestore
- update pressed/button state

### Cross-page persistence

After Add to Trade on `card.html`, navigating back to `search.html` must show the card in Trade immediately from localStorage without a network request.

---

## 10. Price freshness strategy

This area must be conservative because Trade is a calculator and prices can change, but refreshing all cards on every page load would waste API credits and make Search slow.

### Store a snapshot, not a live dependency

Every Trade item stores:

```text
marketValue
priceUpdatedAt
selectedVariant
selectedCondition
```

The Trade section renders those snapshots immediately.

### Do not refresh on section render

Loading `search.html` or expanding Trade must make **zero** Scrydex calls.

### Do not refresh on percentage changes

Changing one percentage or applying one to all makes **zero** API calls. The calculation is entirely local.

### Explicit refresh only

Recommended V1 optional control:

```text
Refresh Trade Prices
```

If implemented, it must be explicit and guarded:

- reuse browser cache first
- refresh only stale items
- stagger/limit requests
- preferably use a future cached batch-by-ID Worker endpoint rather than 50 independent card calls

Because API conservation is a priority, **it is acceptable and safer to omit Refresh Trade Prices from the first release**. A clear `Price snapshot` / `Last updated` label is preferable to silently burning credits.

### Recommended V1 freshness message

Show:

```text
Trade values use the prices captured when each card was added or last loaded.
```

This is transparent and cheap.

---

## 11. Persistence design

### Local storage API

Create one set of helpers:

```text
loadTradeWorkspace()
saveTradeWorkspace(workspace)
addOrUpdateTradeItem(item)
removeTradeItem(id)
clearTradeWorkspace()
setTradeItemPercent(id, percent)
applyTradePercentToAll(percent)
```

Keep these helpers responsible for normalization/schema validation so UI code does not directly mutate raw localStorage structures everywhere.

### Storage safety

Follow existing storage limits/patterns.

Recommended:

```text
MAX_TRADE_ITEMS = 50
MAX_TRADE_STORAGE_JSON_CHARS = 180000
```

Trade records are compact, so this is intentionally much smaller than saving full search responses.

### Schema versioning

Use:

```text
version: 1
```

If a future schema changes, migrate explicitly rather than guessing old shapes.

### Legacy `TRADE_PERCENT_MAP_KEY`

The current Search code uses:

```text
pv:scrydex:tradePercentById:v1
```

Recommended migration path:

- keep the key temporarily to avoid regression in existing Search result controls
- when adding a card to the new Trade workspace, read an existing percent from that map if present
- otherwise default to 80
- after the new Trade workspace is stable, consolidate old percentage state in a separate cleanup PR

Do not remove the old key in the first Trade implementation.

---

## 12. Firebase cloud-sync option

### New helper methods

Add safe no-op fallbacks in the unconfigured Firebase branches, just like Watchlist:

```text
loadTradeItems: async () => []
saveTradeItem: async () => {}
removeTradeItem: async () => {}
saveTradeItemsBatch: async () => {}
```

### Collection

```text
users/{uid}/cardTrade/{cardId}
```

Payload example:

```js
{
  id,
  name,
  expansion,
  image,
  rarity,
  selectedVariant,
  selectedCondition,
  marketValue,
  tradePercent,
  priceUpdatedAt,
  addedAt,
  updatedAt: serverTimestamp()
}
```

### Firestore rules

Do not simply add `cardTrade` to the loose legacy tracked collection list without considering field validation.

Preferred new validator:

```text
isValidTradeItem(itemId)
```

Validate at minimum:

- `id` exists, string, matches document ID
- `tradePercent` is number between 0 and 100
- `marketValue` is number >= 0 when present
- `name` is string with a reasonable max length
- `selectedVariant` is string with a reasonable max length
- `selectedCondition` is a short allowed string (`NM` for V1)
- `updatedAt` is timestamp

Then add a dedicated match:

```text
/users/{userId}/cardTrade/{itemId}
```

owner-only read/write.

This is safer than letting arbitrary maps be stored under a new collection.

### Account deletion

`purgeOwnFirestoreData()` currently clears tracked Watchlist/Favorites collections. Add `cardTrade` to account deletion cleanup if cloud sync is enabled.

---

## 13. Local/cloud merge behavior

Use a simple last-write/newest-snapshot approach, not a complicated realtime listener.

On signed-in Search page initialization:

1. Render local Trade immediately.
2. Load cloud Trade once after auth resolves.
3. Merge by card ID.
4. Prefer the item with newer `updatedAt`/local update timestamp when available.
5. Save merged local copy.
6. Render once more if cloud changes the result.

No Scrydex lookup is involved in the merge.

### Signed-out users

Local Trade remains available on that device.

### Sign-in transition

Do not delete local items. Merge them into the signed-in workspace and sync missing/newer local entries to cloud.

### Sign-out transition

Keep the last local snapshot so the UI does not unexpectedly erase a user's active trade calculator. Cloud data remains protected by auth rules.

---

## 14. Trade totals renderer

Create one pure calculation helper so totals can be unit-tested without DOM or network calls.

Suggested:

```js
calculateTradeTotals(items) -> {
    pricedItemCount,
    unpricedItemCount,
    rawMarketTotal,
    tradeAdjustedTotal,
    effectiveTradePercent
}
```

Rules:

- ignore non-finite market values from monetary sums
- count those items as unpriced
- normalize/clamp percentage before calculation
- `0` market value is valid
- no items => all totals zero
- effective percentage is zero when raw total is zero

Suggested header display:

```text
3 cards · Market $245.50 · Trade $196.40 · Effective 80.0%
```

If some cards are unpriced:

```text
3 priced + 1 unavailable · Market $245.50 · Trade $196.40
```

Do not pretend an unavailable price is `$0.00` without identifying it as unavailable.

---

## 15. Performance requirements

- Initial Search render must not wait on Trade cloud sync.
- Local Trade renders immediately from localStorage.
- Opening/collapsing Trade makes zero API requests.
- Percentage changes make zero API requests.
- Apply-to-all makes zero Scrydex requests.
- Search result Add to Trade reuses existing card state whenever available.
- Card Details Add to Trade reuses `currentCard`.
- Multi-search Add to Trade uses batch-loaded prices and makes zero per-card requests.
- Maximum 50 Trade items in V1.
- Render with DOM nodes, not an HTML string.
- Use event delegation or bounded listeners where it improves large-list rendering.
- Do not add realtime Firestore listeners unless a real cross-device realtime requirement appears.

---

## 16. API-credit protections

### Required zero-credit operations

These must never contact Scrydex:

- load Trade workspace
- expand/collapse Trade
- remove item
- clear Trade
- edit one trade percentage
- apply percentage to all
- calculate totals
- local/cloud Trade synchronization

### Add from already priced card

Zero Scrydex request.

### Add from unpriced single Search result

At most one cached card-detail price request after an explicit Add to Trade action.

### Add from Card Details

Zero additional request because the page already loaded the card/variants.

### Do not automatically keep prices live

No background interval should walk the Trade list and refresh every card.

The current Watchlist has its own price refresh behavior; do not copy that refresh loop blindly into Trade. A trade calculator should prioritize predictable API cost and fast interaction.

---

## 17. Interaction with Multi-Card Search

The two specs are intentionally compatible.

Multi-card Search batch response should include prices. Therefore:

```text
multi search
  ↓ one cached Scrydex request containing prices
result card
  ↓ user clicks Add to Trade
trade snapshot saved locally
  ↓
zero additional Scrydex calls
```

This is the best path for someone building a large trade quickly.

### Example workflow

User searches:

```text
Charizard, Pikachu ex, 94/165, SWSH101
```

They add four desired cards to Trade, run another search, add two more, and then set all six to 80%.

Expected network behavior:

- one batch search for first submit
- one batch search for second submit
- zero Trade percentage/totals requests
- zero duplicate price calls for cards whose batch results already contained prices

---

## 18. Accessibility

- Trade section title is a real heading.
- Collapse control has `aria-controls` and accurate `aria-expanded`.
- Percentage selects have card-specific accessible labels, e.g. `Trade percentage for Charizard`.
- Remove buttons include card names in accessible labels.
- Totals use `aria-live="polite"` so updates are announced without being disruptive.
- Buttons remain keyboard accessible.
- Do not rely on color alone to communicate `In Trade` or changed percentage.

---

## 19. Security

Follow `AGENTS.md` strictly.

Trade data is untrusted even when read back from localStorage or Firestore.

### Required

- no `innerHTML`
- no dynamic code execution
- use `createElement` / `PV_DOM`
- use `textContent` for card names/set/variant/storage values
- validate external image URLs
- sanitize/validate numeric values before calculations
- validate Firestore payloads with restrictive rules
- owner-only cloud Trade access
- do not store auth tokens/API keys in Trade records

### XSS regression test

Store a fake Trade item with values like:

```text
name = <img src=x onerror=alert(1)>
selectedVariant = </select><script>alert(1)</script>
```

Renderer must show plain text and create no executable nodes.

---

## 20. Feature flag and rollback

Add:

```js
window.PV_FEATURES = Object.assign({}, window.PV_FEATURES, {
    tradeWorkspace: false,
});
```

### Flag off

- hide Trade section
- hide Add to Trade buttons
- do not initialize cloud Trade sync
- do not alter Watchlist/Search behavior
- leaving stored local Trade data intact is acceptable

### Rollout

1. Implement local storage + calculations behind flag.
2. Test Add to Trade from Search and Card Details.
3. Add cloud sync/rules if included in initial scope.
4. Canary with admin/tester.
5. Verify no new background card-price traffic.
6. Enable publicly.

### Emergency rollback

Set `tradeWorkspace: false`. No Worker rollback should be required because the Trade workspace itself does not need a new Scrydex endpoint.

---

## 21. Recommended implementation sequence

### Phase 0 — pure helpers and tests

Implement/test:

- percentage normalizer
- compact Trade-item normalizer
- add/update/remove
- apply-to-all
- weighted totals
- persistence schema validation

No UI or network changes yet.

### Phase 1 — local Trade workspace on Search page

Update `search.html`:

- insert Trade section above Watchlist
- collapsible body
- bulk percent control
- totals region

Update `search.js`:

- load/save local workspace
- render Trade rows
- remove/clear
- per-row percentage
- apply-to-all
- totals

No Scrydex request should be necessary to open/use this section.

### Phase 2 — Add to Trade from Search results

- add result action
- reuse loaded card/variant/price state
- use cached explicit lookup only when absolutely needed for an unpriced single-search result
- action toast
- sync result-button state after Trade changes

### Phase 3 — Card Details integration

Update `card.html`:

- Add to Trade button

Update `card.js`:

- load Trade state
- create compact snapshot from `currentCard`
- save/remove
- update button state

Do not fetch card again.

### Phase 4 — optional Firebase sync

Update `firebase.js`:

- fallbacks
- refs/helpers
- optional batch save
- local cloud cache if useful
- account deletion cleanup

Update `firestore.rules`:

- dedicated `cardTrade` owner-only rule
- field validation

### Phase 5 — integration with multi-search

When multi-search is enabled:

- ensure Trade snapshot can read batch-loaded variant prices
- ensure Add to Trade does not call `/cards/{id}`

### Phase 6 — styling/mobile/accessibility

Update `styles.css` with Trade-specific namespace:

```text
pv-trade...
```

Avoid altering generic card/watchlist styles unless intentionally shared.

### Phase 7 — canary and API verification

Use Network panel:

- reload Search with Trade items: no card API calls caused by Trade
- collapse/expand: no calls
- change percent: no calls
- apply all: no calls
- remove/clear: no calls
- add from priced result: no calls
- add from Card Details: no additional calls

---

## 22. Acceptance criteria

### Layout

- [ ] Trade appears above Watchlist on Search page.
- [ ] Trade is collapsible.
- [ ] Collapse state survives reload.
- [ ] Watchlist remains visually/functionally separate.

### Persistence

- [ ] Added cards survive a new card search.
- [ ] Added cards survive page refresh.
- [ ] Added cards survive Card Details → Search navigation.
- [ ] Duplicate card IDs do not create duplicate rows.
- [ ] Clear removes only Trade items, not Watchlist.
- [ ] Signed-in cloud sync works if included.

### Card actions

- [ ] Search result can Add/Remove Trade.
- [ ] Card Details can Add/Remove Trade.
- [ ] Existing Watchlist action remains unchanged.
- [ ] Share remains unchanged.

### Percentages

- [ ] New item defaults to 80% unless existing saved percent is available.
- [ ] One card's percentage can change independently.
- [ ] Apply to all updates every current item.
- [ ] User can override one item after Apply to all.
- [ ] Values are clamped/validated to the supported range.

### Totals

- [ ] Raw market total is correct.
- [ ] Per-card adjusted value is correct.
- [ ] Trade-adjusted total is correct.
- [ ] Overall percentage uses a weighted calculation.
- [ ] Unpriced cards are identified, not silently counted as zero-priced cards.

### API / performance

- [ ] Loading Trade makes zero Scrydex calls.
- [ ] Collapse/expand makes zero Scrydex calls.
- [ ] Percentage changes make zero Scrydex calls.
- [ ] Apply-to-all makes zero Scrydex calls.
- [ ] Add from already-priced Search result makes zero Scrydex calls.
- [ ] Add from Card Details makes zero additional Scrydex calls.
- [ ] Multi-search priced results add to Trade without per-card price lookup.
- [ ] Search page does not become blocked waiting on Firestore.

### Regression

- [ ] Single card search unchanged.
- [ ] Multi-card search unchanged once implemented.
- [ ] Search sorting still works.
- [ ] Load More still works in single mode.
- [ ] Watchlist still loads/adds/removes/clears.
- [ ] Dex-related Search controls still work.
- [ ] Card Details pricing/history/related cards still work.
- [ ] Auth sign-in/sign-out works.
- [ ] Mobile Search and Card pages remain usable.

### Security

- [ ] Trade renderer passes malicious localStorage value test.
- [ ] Trade renderer passes malicious Firestore/API display value test.
- [ ] No unsafe HTML sink added.
- [ ] Firestore Trade documents are owner-only and field-validated.

---

## 23. Recommended tests

### Pure unit/static tests

Suggested files:

```text
trade-workspace-static.test.mjs
trade-totals.test.mjs
trade-security-static.test.mjs
```

Cover:

- default 80%
- one item at 80%
- several mixed percentages
- weighted effective percentage
- zero raw total
- unpriced item
- clamp invalid percentages
- duplicate ID update
- 50-item limit
- persistence schema
- no unsafe renderer sink

### Browser/manual tests

1. Search Pikachu.
2. Choose a variant and Add to Trade.
3. Search Charizard; confirm Pikachu remains.
4. Add Charizard.
5. Set Pikachu 70% and Charizard 90%.
6. Confirm weighted totals.
7. Apply 80% to all.
8. Change Charizard back to 90%.
9. Open a Card Details page, Add to Trade, return to Search.
10. Collapse Trade, refresh, confirm collapsed state.
11. Clear Trade; Watchlist must remain unchanged.

### Network assertion test

During steps 5–8 there must be no `/cards/search` or `/cards/{id}` traffic caused by the Trade calculations.

---

## 24. Files expected to change during implementation

Local-only V1:

```text
search.html
search.js
card.html
card.js
styles.css
feature-flags.js
new Trade tests
```

With cloud sync:

```text
firebase.js
firestore.rules
```

No Worker change is required for the core Trade workspace.

The Multi-Card Search Worker changes complement this feature but are specified separately.

---

## 25. Out of scope for V1

- user-to-user offers
- public trade listings
- direct messaging/counteroffers
- location matching
- trade history between different accounts
- automatic fairness recommendations
- graded-card trade multipliers
- eBay/TCGPlayer transaction execution
- background refresh of all Trade prices
- more than one saved/named trade workspace

A future V2 can add left-side/right-side trade comparison (`My cards` vs `Their cards`) on top of the same item/percentage/totals foundation.

---

## 26. Final architecture rule

Trade is a persistent **local calculation workspace**, not another API-driven page.

The intended flow is:

```text
existing Search/Card Details data
           ↓
       Add to Trade
           ↓
compact local/Firestore snapshot
           ↓
percentage edits + totals computed locally
           ↓
zero Scrydex traffic for calculator operations
```

That gives users the useful trading workflow while protecting API credits, keeping the Search page fast, and reusing the site's existing storage, pricing, auth, and rendering patterns.
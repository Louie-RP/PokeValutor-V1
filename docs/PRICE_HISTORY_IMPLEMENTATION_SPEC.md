# PokeValuator NM Price History — Implementation Specification

**Status:** Ready for controlled implementation  
**Feature scope:** Card Details page only  
**History source:** Scrydex 90-day price-history endpoint  
**Supported condition:** Near Mint (`NM`) only  
**Entitled roles:** `premium`, `admin`, `tester`  
**Locked experience:** anonymous, `free`, `basic`, unknown roles

## 1. Goal

Add a secure, efficient NM market-price history graph to the Card Details page without slowing normal card loading, exposing premium data, wasting Scrydex credits, or creating regressions in card search, Dex navigation, current pricing, watchlist, sharing, SEO, or related cards.

The feature must remain isolated so it can be hidden, disabled, rolled back, or removed without rewriting `card.js`.

## 2. Confirmed user flow

1. A user searches for a card or views a card in Dex.
2. Selecting the card opens `card.html?id=<cardId>`.
3. `card.js` loads and renders the existing card details exactly as it does today.
4. After the card has rendered, `card.js` emits a `pv:card-loaded` browser event.
5. The isolated `price-history.js` feature receives the card and evaluates the user's Firebase claims.
6. Anonymous, free, basic, failed, or unknown roles see a local locked preview. No history endpoint request is made.
7. Premium, admin, and tester users see an enabled **View NM Price History** button.
8. The real history request occurs only after the entitled user clicks the button.
9. The Worker independently verifies the Firebase token and role before checking Redis or contacting Scrydex.
10. One cached 90-day NM dataset powers 7D, 30D, and 90D graph views.

## 3. Architecture

### Existing files retained

- `card.html`: card page and small feature mounting point
- `card.js`: existing card loading/rendering; receives only a small event-dispatch addition
- `styles.css`: existing site-wide styles
- Existing Worker routes, including TCGGO routes

### New isolated files

- `price-history.js`: feature logic
- `price-history.css`: feature-only styles
- `feature-flags.js`: frontend kill switch

### Worker update

Adds a new route without replacing an existing route:

```text
GET /cards/{cardId}/scrydex-price-history?variant=holofoil&condition=NM
```

The existing `/cards/{id}/price-history` TCGGO route remains unchanged.

## 4. Why one component with two states

Do not build two full chart implementations.

Use one component with:

- **Locked state:** local decorative SVG and subscription message
- **Premium state:** real NM graph after an explicit click

This avoids duplicated styling, range logic, accessibility work, and maintenance. The locked preview must never use fetched real card history, even if blurred, because fetching already consumes credits and data remains visible through developer tools.

## 5. API-credit protections

### Required behavior

- Only NM history is supported.
- Free/basic/anonymous clients never call the history route.
- The Worker rejects unauthorized users before any Redis or Scrydex work.
- The Worker rejects non-NM requests before any upstream work.
- Premium history is click-to-load, not page-load.
- Request 90 days once; derive 7D/30D/90D locally.
- Cache the unfiltered card-level NM response in Upstash for 24 hours.
- Reuse the same cache when switching variants.
- Retain stale data for 72 hours to avoid unnecessary refreshes during outages.
- Use a Redis lock to prevent concurrent duplicate cold-cache requests.
- Enforce a global daily upstream refresh limit.
- Do not expose a browser force-refresh or cache-bypass parameter.

### Default Worker limits

```text
CACHE_TTL_SCRYDEX_PRICE_HISTORY_SECONDS=86400
CACHE_RETENTION_SCRYDEX_PRICE_HISTORY_SECONDS=259200
SCRYDEX_PRICE_HISTORY_MAX_UPSTREAM_REQUESTS_PER_DAY=25
SCRYDEX_PRICE_HISTORY_LOCK_SECONDS=20
SCRYDEX_PRICE_HISTORY_FAIL_OPEN=0
SCRYDEX_PRICE_HISTORY_ALLOW_NO_REDIS=0
```

At 25 refreshes per day and three credits per Scrydex history request, the configured ceiling is 75 history credits per day.

## 6. Entitlement and security

### Frontend check

`price-history.js` reads Firebase token claims through `PV_AUTH.getIdTokenResult(false)`.

Premium access is granted only for:

```text
premium
admin
tester
```

All other values fail closed to the locked state.

The frontend check is for experience and credit avoidance only. It is not the security boundary.

### Worker check

The Worker must independently validate the bearer token and normalized role. Manually calling the endpoint as an anonymous, free, or basic user must return `403` before Redis and Scrydex are reached.

Do not add an environment-variable entitlement bypass that can make history public accidentally.

## 7. Frontend integration contract

### `card.js`

After `renderCard()` completes its existing work, dispatch:

```js
window.dispatchEvent(new CustomEvent('pv:card-loaded', {
    detail: {
        cardId: safeString(card?.id, ''),
        card,
    },
}));
```

Do not make `price-history.js` fetch the card again.

### `price-history.js`

Owns only:

- feature-flag handling
- locked preview
- role resolution
- entitled click-to-load behavior
- Worker history request
- variant selection
- 7D/30D/90D rendering
- chart-specific status and error messages
- sign-in/sign-out state updates

It must not modify:

- current-pricing table
- `currentCard` inside `card.js`
- watchlist state
- card-page status text
- related-card results
- SEO metadata
- Dex data

### `price-history.css`

All selectors use the `pv-priceHistory` namespace. It should not alter generic tables, buttons, forms, SVGs, or page sections globally.

## 8. Performance requirements

- Initial card rendering must not wait on role resolution or history.
- Free/basic users load only the small local script, CSS, and decorative SVG markup.
- No third-party chart library is used.
- Real history is fetched only on premium click.
- Rendering uses an inline SVG generated from normalized market values.
- Changing 7D/30D/90D does not make a network request.
- Switching variants uses the Worker's shared NM cache and should not contact Scrydex again while fresh.

## 9. Data rules

- Graph the `market` value as the primary series.
- Do not use `low` as the main line because isolated low listings can create misleading drops.
- Parse Scrydex dates explicitly from `YYYY/MM/DD` into UTC.
- Treat snake_case and camelCase endpoint differences carefully.
- Preserve missing values as missing; do not invent prices.
- Use the latest returned date as the end date for range filtering.

## 10. Feature flags and rollback

### Frontend kill switch

```js
window.PV_FEATURES = Object.assign({}, window.PV_FEATURES, {
    priceHistory: false,
});
```

This hides the section and prevents frontend initialization.

### Worker kill switch

```text
SCRYDEX_PRICE_HISTORY_ENABLED=0
```

This disables the backend route's real data behavior.

### Emergency rollback order

1. Set Worker flag to `0` to stop upstream history refreshes immediately.
2. Set frontend `priceHistory` to `false` to hide the component.
3. If necessary, remove the two new asset references from `card.html`.
4. The original card-detail flow continues because the only `card.js` integration is a harmless custom event.

## 11. Existing browser-observed history

The old `card.js` localStorage history code may remain temporarily during the first deployment even though its HTML table is replaced. This minimizes the first patch size and regression risk.

After the new feature is stable, remove in a separate cleanup PR:

- `HISTORY_PREFIX`
- `HISTORY_MAX_POINTS`
- old history element lookups
- `historyKey`
- `recordHistoryPoint`
- `getHistoryRows`
- `renderHistory`
- NM/LP/MP local-history writes in `renderPricing`
- old history change listeners

Do not combine that cleanup with the initial production rollout.

## 12. Failure behavior

- Role lookup failure: locked preview, zero request
- No Firebase token: no history request or sign-in-again error after premium click
- `403`: subscription/access message
- `400`: invalid card, variant, or non-NM request
- Worker feature disabled: unavailable message
- Redis unavailable with fail-closed settings: `503`, no Scrydex call
- Daily history refresh budget reached: `429`, no additional Scrydex call
- Scrydex failure with stale cache: serve stale data
- Scrydex failure without cache: localized history error only

A history failure must never hide or break the card details.

## 13. Acceptance criteria

### Free/basic/anonymous

- Locked preview appears.
- Subscribe message appears.
- Controls are disabled or absent.
- Browser Network panel shows no `/scrydex-price-history` request.
- Direct endpoint request returns `403`.

### Premium/admin/tester

- View button appears after role resolution.
- No history request occurs before button click.
- Clicking sends one authenticated Worker request.
- Graph displays NM market history.
- 7D/30D/90D buttons reuse loaded data.
- Repeat card view within cache TTL produces a Worker cache hit.
- Variant change reuses card-level NM cache.

### Regression checks

- Search-to-card navigation works.
- Dex-to-card navigation works.
- Card image and metadata render.
- Current NM/LP/MP pricing still renders.
- Watchlist works.
- Share works.
- Related cards load.
- Auth sign-in/sign-out works.
- Mobile card page remains usable.
- Disabling either flag does not break card details.

## 14. Test evidence included

The Worker test verifies:

- anonymous blocked before Scrydex
- basic blocked before Scrydex
- non-NM blocked before Scrydex
- premium cold request produces one upstream call
- repeat request is a cache hit
- variant change reuses NM cache
- 7D/30D/90D calculations match expected results

The frontend static test verifies:

- NM-only configuration
- premium-role allowlist
- fail-closed locked state
- no automatic history fetch
- click-to-load wiring
- bearer-token request
- `no-store` client request
- decorative locked preview
- event handoff
- isolated asset references
- frontend feature flag
- locked-state CSS

## 15. Files in this package

```text
PRICE_HISTORY_IMPLEMENTATION_SPEC.md
IMPLEMENTATION_STEPS.md
worker.js
worker.patch
price-history.js
price-history.css
feature-flags.js
card.html.patch
card.js.patch
test-worker.mjs
test-frontend.mjs
worker-test-results.json
frontend-test-results.json
```

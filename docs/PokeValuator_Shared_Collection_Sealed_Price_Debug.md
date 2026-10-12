# PokéValuator: Shared Collection vs. Dex Sealed-Value Drift

## Goal

Make sealed-product values identical across **Sealed Search**, **Dex**, **Shared Collection**, and the backend collection-value snapshot. A Pokémon Center variant must be priced from that exact variant, never from the Standard variant and never from a stale price saved when the item was added.

## Confirmed examples (live production, September 22, 2026)

| Product | Display ID | Base product ID | Variant | Live Sealed Search value |
|---|---|---|---|---:|
| Ascended Heroes Elite Trainer Box | `me2pt5-s3::pokemoncenter` | `me2pt5-s3` | `PokemonCenter` / Pokémon Center | `$364.18` |
| Phantasmal Flames Elite Trainer Box | `me2-s5::pokemoncenter` | `me2-s5` | `PokemonCenter` / Pokémon Center | `$287.37` |

Standard variants are separate products for collection/pricing purposes:

| Product | Display ID | Live Sealed Search value |
|---|---|---:|
| Ascended Heroes ETB — Standard | `me2pt5-s3` | `$146.55` |
| Phantasmal Flames ETB — Standard | `me2-s5` | `$150.82` |

These amounts are useful regression fixtures, but tests should mock API responses rather than assert live prices permanently.

## Root cause

The code contains multiple independent implementations of sealed-product identity, variant selection, cache keys, fetching, and market selection. The Dex implementation was repaired recently; Shared Collection and the backend snapshot implementation were not updated with the same rules.

### 1. Dex is variant-aware

`dex-tracker-pages.js` correctly distinguishes:

- `displayId`: collection identity, such as `me2pt5-s3::pokemoncenter`
- `baseProductId`: API identity, such as `me2pt5-s3`
- `variantName`: the exact tracked variant, such as `PokemonCenter`

It requests the API with `baseProductId`, selects the requested variant, and caches by `displayId` under the `sealed:v3:` namespace.

Relevant functions:

- `getSealedPricingIdentity` around line 1525
- `getTrackedSealedMarketFromVariants` around line 1540
- `buildSealedValueCacheKey` around line 1554
- `getCurrentSealedValue` around line 1772

### 2. Shared Collection still uses the old implementation

`shared-collection.js` has several connected defects:

1. `normalizeCollectionEntry` does not preserve `baseProductId`, `variantName`, `variantLabel`, or `hasMultipleVariants` on the normalized item. They remain only inside `item.raw`.
2. `refreshSelectedCollectionValues` calls `fetchSealedWithPrices(item.id)` around line 1240. For a Pokémon Center ETB, `item.id` is the synthetic display ID (`base::variant`), but the worker endpoint expects only the base product ID.
3. `getCurrentSealedValue` also uses `item.id` for both the API lookup and its legacy `sealed:${id}` cache key.
4. The refresh path passes saved `variants` as an override. When the direct request fails, the function prices the saved variant data instead of making a correct base-ID request. That saved price can be weeks old.
5. Shared Collection uses `pv:scrydex:collectionValueCache:v1`, while Dex uses `pv:scrydex:collectionValueCache:v2`. The two pages therefore do not share the same corrected cache namespace or cache entries.
6. `shared-collection.html` still loads `shared-collection.js?v=2026-06-18-cache-protect-2`, whereas the Dex page loads the September Dex-value fix. This does not create the logic bug by itself, but it confirms that Shared Collection did not receive the same fix and risks clients retaining an older asset.

Result: the Shared Collection live request fails for a synthetic Pokémon Center ID, then the UI silently retains the collection snapshot price. This explains why the Ascended Heroes value can remain wrong for weeks even though Sealed Search and Dex have a current value.

### 3. The backend snapshot repeats the same identity error

`functions/index.js` also needs correction:

- `buildPriceKeyForSealed(item)` keys only from the raw `item.id` without using a shared identity helper.
- `fetchSealedWithPrices(itemId)` is called with the synthetic ID for variant entries.
- `bestSealedMarket(live)` chooses the lowest market across every variant. Even after changing the request to the base ID, this would incorrectly select the Standard value for a Pokémon Center item.
- There is no test covering `baseId::pokemoncenter` and Standard/Pokémon Center variants with significantly different prices.

This backend issue can produce incorrect historical collection-value snapshots even if the visible Dex total is correct.

## Recommended implementation

Do not copy the repaired Dex functions into a third location. Create one pure sealed-pricing module and consume it from the Dex page, Shared Collection, and Cloud Functions.

### Canonical module

Suggested canonical source: `functions/lib/sealed-pricing-core.js`.

The file should use a small UMD-style wrapper so it works in both environments:

- Cloud Functions: `const sealedPricing = require('./lib/sealed-pricing-core');`
- Browser: expose `window.PV_SEALED_PRICING`
- GitHub Pages workflow: explicitly copy this one canonical source file to `dist/functions/lib/sealed-pricing-core.js`, because the workflow currently excludes the entire `functions/` directory

Do not maintain a second hand-copied browser version.

The module should export pure functions only:

```js
getSealedPricingIdentity(item)
normalizeSealedVariantKey(name)
findTrackedSealedVariant(variants, identity)
getMarketFromTrackedSealedVariant(variants, identity)
buildSealedValueCacheKey(identity)
```

### Required identity rules

`getSealedPricingIdentity(item)` must return:

```js
{
  displayId,     // e.g. me2pt5-s3::pokemoncenter
  baseProductId, // e.g. me2pt5-s3
  variantName,   // e.g. PokemonCenter
  variantKey     // normalized comparison key, e.g. pokemoncenter
}
```

Rules:

1. Prefer the explicit `baseProductId` and `variantName` saved on the collection item.
2. For legacy items, split `displayId` at `::` to derive the base ID and variant suffix.
3. Normalize variant comparisons by lowercasing and removing spaces, punctuation, hyphens, and underscores, so `PokemonCenter`, `Pokemon Center`, and `pokemoncenter` match.
4. API requests must always use `baseProductId`.
5. UI identity and price-cache identity must use `displayId` so Standard and Pokémon Center variants cannot collide.
6. If a variant was requested but is absent in the live response, return “unpriced”/`null`. Do **not** silently use another variant or the lowest price across all variants.
7. Only use the lowest positive market across all variants when the product truly has no requested variant identity.

### Cache behavior

Use one cache namespace and key builder on both browser pages, for example:

```text
pv:scrydex:collectionValueCache:v3
sealed:v3:<displayId>
```

The version bump is required to invalidate values produced by the old logic.

An eight-hour cache should not prevent a live refresh. Use stale-while-revalidate behavior:

1. A cached value may render immediately.
2. On page load, fetch the current value in the background using the base ID.
3. Replace the displayed item value and total after a successful response.
4. Use the cached/saved value only if the live request fails.
5. Do not overwrite a valid live value with an older async result; retain the existing run/generation guard.

This keeps the page fast while avoiding an eight-hour disagreement between Dex and Shared Collection.

## File-by-file change list

### `functions/lib/sealed-pricing-core.js` (new, canonical)

- Add the shared identity, variant matching, market selection, and cache-key functions described above.
- Keep the module pure: no DOM, `window`, Firebase, fetch, or localStorage access inside the calculation functions.

### `.github/workflows/deploy-pages.yml`

- After the existing `rsync`, copy `functions/lib/sealed-pricing-core.js` to `dist/functions/lib/sealed-pricing-core.js`.
- This preserves one source of truth while making the browser build able to load it.

### `dex.html` and `shared-collection.html`

- Load `sealed-pricing-core.js` before the page-specific script.
- Update asset query strings to a new release version.

### `dex-tracker-pages.js`

- Replace the local copies of identity, variant-market, and sealed cache-key logic with calls to `window.PV_SEALED_PRICING`.
- Preserve existing request deduplication, timeout behavior, generation guards, and safe `textContent` rendering.
- Do not change card pricing as part of this fix.

### `shared-collection.js`

- Preserve `baseProductId`, `variantName`, `variantLabel`, and `hasMultipleVariants` in `normalizeCollectionEntry` for sealed entries.
- Replace its sealed identity, market-selection, and cache-key behavior with the shared module.
- In `refreshSelectedCollectionValues`, remove the eager `fetchSealedWithPrices(item.id)` call and call one resolver that:
  - derives identity;
  - fetches search/detail data using `baseProductId`;
  - selects only the tracked variant;
  - updates `unitValue`, `totalValue`, `pricedUnits`, and the shared total.
- Do not let a non-empty saved `variants` array suppress the live request. Saved variants are fallback data only.
- Continue using `textContent` for updated prices. Do not add new `innerHTML` rendering of API data.

### `functions/index.js`

- Require the shared module.
- Build the sealed price-cache key from `displayId` via the shared helper.
- Fetch the worker with `baseProductId`.
- Replace `bestSealedMarket(live)` with variant-aware market selection.
- When a requested variant is missing, leave it unpriced and fall back to the item’s saved exact-variant price only if available; never substitute Standard for Pokémon Center.
- Bump the server cache-key namespace so previously incorrect documents are not reused.

## Regression tests to add

Create behavior tests for the shared pure module and static integration checks for all three consumers.

### Pure module fixtures

Use a product with two variants:

```js
const variants = [
  { name: 'Normal', prices: [{ market: 146.55 }] },
  { name: 'PokemonCenter', prices: [{ market: 364.18 }] },
];
```

Required assertions:

1. `me2pt5-s3::pokemoncenter` resolves base ID `me2pt5-s3`.
2. `PokemonCenter`, `Pokemon Center`, and `pokemoncenter` normalize to the same key.
3. The Pokémon Center item returns `364.18`, not `146.55`.
4. The Standard item returns `146.55`, not `364.18`.
5. A requested missing variant returns `null`; it does not fall back to Standard.
6. Standard and Pokémon Center produce different cache keys.
7. A legacy synthetic item with no explicit `baseProductId` still resolves correctly.

Repeat the variant-selection assertions with Phantasmal Flames fixtures (`150.82` Standard and `287.37` Pokémon Center).

### Integration/static assertions

Add a new test such as `shared-sealed-price-refresh-static.test.mjs` that verifies:

- Shared normalization preserves the four sealed identity fields.
- Shared fetches by `baseProductId`, not raw synthetic `item.id`.
- Shared uses the shared module’s variant-aware selector and versioned cache key.
- `shared-collection.html` loads the core module before `shared-collection.js`.
- Cloud Functions use `baseProductId` and the same selector.
- The downstream Shared and Dex renderers write live price text through `textContent` and introduce no unsafe HTML sink.

### End-to-end acceptance test

1. Add both the Standard and Pokémon Center variants of each ETB to a collection.
2. Open Dex and record all four unit values and the sealed subtotal.
3. Open the share link in a private/incognito window with empty localStorage.
4. Confirm all four unit values and the total exactly match Dex after refresh completes.
5. Change mocked worker prices, reload both pages, and confirm both surfaces converge on the new values without editing/re-adding collection items.
6. Confirm historical snapshot calculation uses the Pokémon Center values for the Pokémon Center display IDs.
7. Test a worker failure and confirm the UI uses the last known value with an appropriate stale/fallback state rather than substituting another variant.

## Acceptance criteria

- Ascended Heroes Pokémon Center ETB uses the price for `me2pt5-s3::pokemoncenter`, fetched through base ID `me2pt5-s3`.
- Phantasmal Flames Pokémon Center ETB uses the price for `me2-s5::pokemoncenter`, fetched through base ID `me2-s5`.
- Standard and Pokémon Center variants never share a cache entry.
- Dex, Shared Collection, and backend snapshots use the same pure identity and variant-selection implementation.
- A successful live response replaces a stale saved value on Shared Collection without requiring the item to be removed and re-added.
- Existing card pricing, condition pricing, quantities, collection switching, sorting, and XSS protections still pass.

## Copilot implementation instruction

Implement the fix described in this document. First create tests that reproduce the synthetic-ID and cross-variant failures, then create the single shared pure pricing module and update Dex, Shared Collection, Cloud Functions, HTML script order, and the Pages build. Keep the change scoped to sealed-product price identity/refresh. Do not modify card pricing. Preserve request deduplication, async generation guards, fallback behavior, and safe DOM rendering. Run all existing static tests plus the new sealed-pricing tests and report the exact files changed and test results.


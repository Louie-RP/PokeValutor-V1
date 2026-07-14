# Spec: Lazy Card Catalog Hydration from Manual Search

## Status

Recommended implementation for the `scan-card-feature-implementation` branch.

## Goal

Build a trusted `cardCatalog` collection in Firestore automatically when users manually search for cards, without requiring manual imports and without allowing browser users to write fake catalog records.

The catalog will store official card metadata and official image URLs. It will not store actual image files.

## Why

The scanner needs a reliable source of official card metadata and image URLs so it can eventually show candidate matches and compare scanned cards against official card images.

Manual search already receives official card results from the Worker. That makes manual search the best place to hydrate the catalog over time.

## Architecture

```txt
User searches card manually
↓
Frontend calls Cloudflare Worker /cards/search
↓
Worker fetches official Scrydex results
↓
Worker returns results to frontend as it does today
↓
Worker sends top results to Firebase Function in the background
↓
Firebase Function validates shared secret
↓
Firebase Function writes trusted metadata to Firestore cardCatalog/{cardId}
↓
Worker marks card IDs as known in Upstash Redis
```

## Data Ownership

### Firestore

Firestore is the durable catalog store.

Path:

```txt
cardCatalog/{cardId}
```

Example:

```js
{
  id: "base1-4",
  name: "Charizard",
  normalizedName: "charizard",
  number: "4/102",
  numberKey: "4_102",
  printedNumber: "4/102",
  collectorNumber: "4/102",
  setId: "base1",
  setName: "Base Set",
  series: "Base",
  rarity: "Rare Holo",
  imageSmall: "https://...",
  imageLarge: "https://...",
  source: "scrydex-worker",
  updatedAt: FieldValue.serverTimestamp(),
  firstSeenAt: FieldValue.serverTimestamp()
}
```

### Upstash Redis

Upstash is only a fast dedupe layer.

Example keys:

```txt
pv:cardCatalog:known:base1-4:v1 = 1
```

TTL:

```txt
30 days
```

This prevents the Worker from repeatedly calling Firebase for popular cards.

## Important Design Rules

1. Do not write catalog cards directly from browser JavaScript.
2. Do not store official image files in Firestore.
3. Store official image URLs only.
4. Do not store prices in this catalog document.
5. Do not block search results if hydration fails.
6. Limit hydration to the first 10–25 cards per search response.
7. Keep the feature behind a kill switch.

## New Worker Environment Variables

```txt
CARD_CATALOG_HYDRATION_ENABLED=0
CARD_CATALOG_HYDRATION_URL=https://<region>-<project>.cloudfunctions.net/hydrateCardCatalog
CARD_CATALOG_HYDRATION_SECRET=<shared-secret>
CARD_CATALOG_HYDRATION_MAX_CARDS=25
CARD_CATALOG_KNOWN_TTL_SECONDS=2592000
```

## New Firebase Function Environment Variables

```txt
CARD_CATALOG_HYDRATION_ENABLED=true
CARD_CATALOG_HYDRATION_SECRET=<same-shared-secret>
```

If your `functions/index.js` uses the existing `configValue()` helper, support both env vars and legacy `functions.config()`.

## Worker Change Summary

### Change 1

Update the Worker `fetch` signature from:

```js
async fetch(request, env) {
```

to:

```js
async fetch(request, env, ctx) {
```

This allows background work with:

```js
ctx.waitUntil(...)
```

### Change 2

Replace the current text-only card filter path with a helper that returns both:

```js
{
  text: "filtered JSON text",
  cards: [...]
}
```

### Change 3

After `/cards/search` receives a successful JSON response, schedule:

```js
scheduleCardCatalogHydration(ctx, env, filtered.cards);
```

Do this for cold-cache responses and optionally cache-hit responses.

### Change 4

The Worker should only send normalized safe metadata to Firebase, not the full upstream payload with prices.

## Firebase Function Change Summary

Add a new HTTPS function:

```txt
POST /hydrateCardCatalog
```

Request:

```js
{
  source: "scrydex-search",
  cards: [
    {
      id: "base1-4",
      name: "Charizard",
      number: "4/102",
      setId: "base1",
      setName: "Base Set",
      imageSmall: "...",
      imageLarge: "..."
    }
  ]
}
```

Required header:

```txt
x-pv-catalog-secret: <shared-secret>
```

Response:

```js
{
  ok: true,
  attempted: 12,
  saved: 12,
  ids: ["base1-4", "..."]
}
```

## Firestore Security Rules

Client reads may be public if you want scanner candidate lookup from the browser.

Client writes should be denied.

```js
match /cardCatalog/{cardId} {
  allow read: if true;
  allow write: if false;
}
```

All writes happen through trusted Firebase Admin SDK code.

## Rollout Plan

1. Add Firebase Function, deploy with hydration disabled.
2. Add Worker helpers, deploy with hydration disabled.
3. Enable the Firebase Function flag.
4. Enable Worker hydration in development only.
5. Search for several cards manually.
6. Confirm `cardCatalog/{cardId}` documents appear.
7. Confirm search still returns fast.
8. Confirm Upstash known keys are created.
9. Enable production after small validation.

## Verification Checklist

### Existing behavior

- [ ] `/cards/search` still returns the same shape.
- [ ] Manual search page still works.
- [ ] Search by name still works.
- [ ] Search by number still works.
- [ ] Series/set filters still work.
- [ ] Quota headers still appear.
- [ ] Upstash search cache still works.
- [ ] No user-facing error appears if hydration fails.

### New behavior

- [ ] Search results create `cardCatalog/{cardId}` docs.
- [ ] Catalog docs include official image URLs.
- [ ] Existing docs update `updatedAt`.
- [ ] Existing docs keep original `firstSeenAt`.
- [ ] Worker does not send more than `CARD_CATALOG_HYDRATION_MAX_CARDS`.
- [ ] Worker skips known card IDs using Upstash.
- [ ] Firebase Function rejects missing/invalid shared secret.
- [ ] Client cannot write `cardCatalog` directly.

## Future Scanner Use

After this lands, scanner candidate matching can use:

```txt
cardCatalog where numberKey == scannedNumberKey
```

or:

```txt
cardCatalog where normalizedName == scannedName
```

Then show top candidates with `imageSmall` / `imageLarge`.

Do not start with full image matching until this metadata catalog is filling correctly.

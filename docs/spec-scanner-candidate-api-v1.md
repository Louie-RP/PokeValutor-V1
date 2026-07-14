# Spec: Scanner Candidate API v1

## Goal

Make card scans more accurate by using the Firestore `cardCatalog` that is now being hydrated from manual searches.

The scanner should first ask your own catalog for likely official card candidates, then use the current scanner ranking logic to compare name, number, set, and image similarity.

## Current State

Already implemented or mostly implemented:

- `functions/index.js` has `hydrateCardCatalog`.
- Worker has catalog hydration environment variables.
- Worker calls `scheduleCardCatalogHydration()` from `/cards/search`.
- `scanner.js` already has camera capture, OCR, optional vision hook, OpenCV normalization hook, candidate UI, candidate ranking, local image hash comparison, and `/cards/search` fallback candidate lookup.

Missing:

- A read endpoint for scanner candidates from Firestore.
- A Worker route that exposes that candidate lookup to the browser.
- A scanner.js change that calls `/scanner/candidates` before falling back to `/cards/search`.

## Proposed Architecture

```txt
scanner.js
  OCR detects name/number
  ↓
GET Worker /scanner/candidates?name=...&number=...&setId=...
  ↓
Worker validates params, caches response in Upstash
  ↓
Worker POSTs to Firebase Function scannerCandidates
  ↓
Firebase Admin SDK queries Firestore cardCatalog
  ↓
Worker returns normalized card candidates
  ↓
scanner.js ranks candidates with existing image hash logic
  ↓
User selects correct card
```

## Why Worker + Firebase Function

Cloudflare Worker should not directly use Firebase Admin SDK.

Firebase Function is the trusted Firestore reader/writer layer.

Worker remains the public API gateway for your static site and can cache candidate responses in Upstash.

## New Firebase Function

Name:

```txt
scannerCandidates
```

Method:

```txt
POST
```

Required header:

```txt
x-pv-catalog-secret: <shared secret>
```

Request body:

```js
{
  "name": "Charizard",
  "number": "4/102",
  "numberKey": "4_102",
  "setId": "base1",
  "limit": 12
}
```

Response body:

```js
{
  "ok": true,
  "source": "firestore-cardCatalog",
  "count": 5,
  "data": [
    {
      "id": "base1-4",
      "name": "Charizard",
      "number": "4/102",
      "printedNumber": "4/102",
      "collectorNumber": "4/102",
      "rarity": "Rare Holo",
      "setId": "base1",
      "setName": "Base Set",
      "series": "Base",
      "imageSmall": "https://...",
      "imageLarge": "https://...",
      "expansion": {
        "id": "base1",
        "name": "Base Set",
        "series": "Base"
      },
      "images": {
        "small": "https://...",
        "medium": "https://...",
        "large": "https://..."
      },
      "_candidate": {
        "score": 100,
        "matchedBy": ["numberKey", "normalizedName", "setId"],
        "source": "firestore-cardCatalog"
      }
    }
  ]
}
```

## New Worker Route

```txt
GET /scanner/candidates?name=Charizard&number=4/102&setId=base1&limit=12
```

The Worker should:

1. Parse query params.
2. Return 400 if both name and number are missing.
3. Check Upstash cache.
4. POST to Firebase Function `scannerCandidates`.
5. Cache successful JSON.
6. Return JSON to scanner.js.

## New Worker Environment Variables

```txt
CARD_CATALOG_CANDIDATES_ENABLED=1
CARD_CATALOG_CANDIDATES_URL=https://<region>-<project>.cloudfunctions.net/scannerCandidates
CARD_CATALOG_CANDIDATES_SECRET=<same or separate shared secret>
CARD_CATALOG_CANDIDATES_TTL_SECONDS=86400
CARD_CATALOG_CANDIDATES_MAX_RESULTS=12
```

You can reuse `CARD_CATALOG_HYDRATION_SECRET`, but I prefer a separate secret long-term.

For quick implementation, allow fallback:

```txt
CARD_CATALOG_CANDIDATES_SECRET || CARD_CATALOG_HYDRATION_SECRET
```

## New Firebase Function Environment Variables

```txt
CARD_CATALOG_CANDIDATES_ENABLED=true
CARD_CATALOG_CANDIDATES_SECRET=<same secret as Worker>
CARD_CATALOG_CANDIDATES_MAX_RESULTS=12
```

Also allow fallback to:

```txt
CARD_CATALOG_HYDRATION_SECRET
```

## Firestore Query Strategy

Use multiple small queries, then merge and score in memory.

Recommended queries:

1. Exact `numberKey`
2. Exact `normalizedName`
3. First `nameTokens` value
4. Optional setId only as an in-memory boost, not the primary query

This avoids needing composite indexes immediately.

Do not query the whole collection.

## Candidate Scoring

Server-side score is only for ordering and limiting.

Suggested weights:

```txt
numberKey exact: +55
normalizedName exact: +25
name partial/token match: +10 to +18
setId exact: +15
image URL present: +5
```

The browser still performs final ranking using:

```txt
name score
number score
image hash score
set score
```

## Scanner.js Behavior

Update `fetchScannerCandidates()` so it does:

```txt
1. Try /scanner/candidates
2. Merge catalog results
3. If fewer than enough candidates, fall back to current /cards/search calls
4. De-dupe by card.id
5. Return up to SCANNER_CANDIDATE_FETCH_LIMIT
```

This means:

- Catalog matches are preferred.
- Existing Scrydex fallback still works.
- Scans still work even when Firestore catalog is incomplete.

## Acceptance Criteria

### Backend

- [ ] `scannerCandidates` Firebase Function exists.
- [ ] It rejects missing/invalid secret.
- [ ] It returns empty array, not an error, when no candidates are found.
- [ ] It queries by `numberKey`.
- [ ] It queries by `normalizedName`.
- [ ] It queries by first `nameTokens`.
- [ ] It returns Scrydex-compatible card shape.
- [ ] It never returns prices.
- [ ] It limits response size.

### Worker

- [ ] `/scanner/candidates` exists.
- [ ] It is added before the Scrydex secret check.
- [ ] It uses Upstash cache if available.
- [ ] It has no dependency on Scrydex API keys.
- [ ] It returns CORS headers.
- [ ] It returns `{ ok: true, data: [] }` when catalog is empty.

### Frontend

- [ ] `scanner.js` calls `/scanner/candidates` first.
- [ ] It falls back to `/cards/search`.
- [ ] Candidate UI still renders.
- [ ] Existing image hash ranking still works.
- [ ] Manual search still works.
- [ ] No card is auto-added to the collection.

## Test Plan

1. Manually search several cards to hydrate Firestore.
2. Confirm Firestore has `cardCatalog` docs.
3. Call Worker directly:

```txt
/scanner/candidates?name=Charizard&number=4/102&limit=12
```

4. Confirm response has candidates.
5. Capture a card in scanner.
6. Confirm `Find Possible Matches` shows catalog candidates.
7. Confirm selecting a candidate updates detected name/number.
8. Confirm final search still uses the existing search flow.

## Not Part of This Step

Do not add Upstash Vector yet.

Upstash Vector comes later after catalog candidate matching works, real scan testing shows local image hash is not strong enough, and you choose a vector embedding generation method.

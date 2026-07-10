# Spec: Scanner Name Correction v1

## Goal

Improve bad OCR card-name output without slowing the site, wasting Scrydex credits, or changing the normal search flow.

Instead of putting random OCR letters directly into the "Detected Card Name" field, the scanner should compare the detected text against official names already stored in Firestore.

## Current Repo Observations

Current branch already has:

- `scanner.js` scanner feature flags.
- Candidate lookup enabled.
- Catalog candidate lookup enabled.
- Local scanner request cache.
- Candidate ranking based on Firestore score, number score, image score, and fallback Scrydex search.
- Firebase `cardCatalog` hydration.
- Firebase `scannerCandidates`.
- Firestore rules allowing public reads for `cardCatalog` and blocking direct client writes.

Important cleanup found:

- `functions/index.js` currently exports `scannerCandidates` twice. Remove the duplicate before adding this feature.

## Problem

OCR can return messy names such as:

```txt
Chanzard
Charizrd
Prfssor Resarch
Cnarizara
```

If we place that directly into the name field, the scanner may:

- Search with bad text.
- Pull weak candidates.
- Burn unnecessary search requests.
- Make the scanner feel unreliable.

## Proposed Solution

Add a lightweight name-correction layer:

```txt
OCR name
↓
Worker /scanner/name-suggestions
↓
Firebase scannerNameSuggestions
↓
Firestore scannerNameIndex
↓
Return best official name suggestions
↓
scanner.js auto-applies only high-confidence matches
```

## Key Rule

This feature must not call Scrydex.

It only uses:

- Firestore `scannerNameIndex`
- Firestore `cardCatalog` during hydration/backfill
- Upstash Worker cache
- Client-side session cache

## New Firestore Collection

```txt
scannerNameIndex/{normalizedName}
```

Example document:

```js
{
  displayName: "Charizard",
  normalizedName: "charizard",
  tokens: ["charizard"],
  firstLetter: "c",
  prefix2: "ch",
  prefix3: "cha",
  exampleCardIds: ["base1-4", "swsh066"],
  cardCount: 15,
  source: "cardCatalog",
  updatedAt: serverTimestamp()
}
```

## How the Index Gets Filled

Update `hydrateCardCatalog` so every saved card also updates `scannerNameIndex`.

This avoids a separate Scrydex job.

When a card is hydrated:

```txt
cardCatalog/base1-4
↓
scannerNameIndex/charizard
```

## Optional Backfill

Since you already have some `cardCatalog` docs, add a one-time backfill script/function later that creates index docs from existing catalog docs.

This does not need Scrydex.

## New Firebase Function

Name:

```txt
scannerNameSuggestions
```

Type:

```txt
HTTPS onRequest
```

Method:

```txt
POST
```

Request:

```js
{
  "text": "Charizrd",
  "limit": 5
}
```

Response:

```js
{
  "ok": true,
  "source": "scannerNameIndex",
  "data": [
    {
      "name": "Charizard",
      "normalizedName": "charizard",
      "score": 0.91,
      "source": "scannerNameIndex",
      "matchedBy": ["prefix3", "fuzzy"]
    }
  ]
}
```

## New Worker Route

```txt
GET /scanner/name-suggestions?text=Charizrd&limit=5
```

Worker responsibilities:

1. Validate text length.
2. Cache by normalized OCR text.
3. Call Firebase `scannerNameSuggestions`.
4. Return suggestions.
5. Never call Scrydex.
6. Return empty suggestions on failure so scans still work.

## New Worker Environment Variables

```txt
SCANNER_NAME_SUGGESTIONS_ENABLED=1
SCANNER_NAME_SUGGESTIONS_URL=https://<region>-<project>.cloudfunctions.net/scannerNameSuggestions
SCANNER_NAME_SUGGESTIONS_SECRET=<secret>
SCANNER_NAME_SUGGESTIONS_TTL_SECONDS=604800
SCANNER_NAME_SUGGESTIONS_MAX_RESULTS=5
SCANNER_NAME_SUGGESTIONS_TIMEOUT_MS=1200
```

Secret fallback order:

```txt
SCANNER_NAME_SUGGESTIONS_SECRET
CARD_CATALOG_CANDIDATES_SECRET
CARD_CATALOG_HYDRATION_SECRET
```

## New Firebase Environment Variables

```txt
SCANNER_NAME_SUGGESTIONS_ENABLED=true
SCANNER_NAME_SUGGESTIONS_SECRET=<secret>
SCANNER_NAME_SUGGESTIONS_MAX_RESULTS=5
SCANNER_NAME_SUGGESTIONS_MIN_SCORE=0.70
```

Secret fallback order:

```txt
SCANNER_NAME_SUGGESTIONS_SECRET
CARD_CATALOG_CANDIDATES_SECRET
CARD_CATALOG_HYDRATION_SECRET
```

## scanner.js Behavior

Add feature flag:

```js
const PV_SCANNER_ENABLE_NAME_CORRECTION = false;
```

Keep it false until backend and Worker are deployed.

After OCR extraction:

```txt
raw OCR name
↓
try name suggestion endpoint with 1.2s timeout
↓
if score >= 0.88, auto-fill corrected official name
↓
if score 0.70–0.87, do not auto-fill yet
↓
if no strong match and OCR name looks like garbage, clear the field
```

## Confidence Rules

```txt
0.88+      auto-correct
0.70–0.87 suggestion only / future UI
below 0.70 keep current flow
```

For v1, only auto-apply high-confidence matches.

## Performance Rules

1. Do not call name suggestions on every keypress.
2. Call only once after OCR finishes.
3. Use client session cache.
4. Use Worker Upstash cache.
5. Use Firebase limits.
6. Use a short client timeout.
7. Fail open: if suggestions fail, continue with existing scanner behavior.

## Scrydex Credit Safety

This feature uses zero Scrydex credits.

It should never call:

```txt
/cards/search
/cards/{id}
Scrydex upstream
```

Name correction only reads your Firestore name index.

## Regression Safety

Deploy in this order:

1. Clean duplicate `scannerCandidates` export.
2. Add index helper code to Firebase.
3. Add `scannerNameSuggestions` Firebase Function disabled.
4. Add Worker `/scanner/name-suggestions` disabled.
5. Add scanner.js code with frontend flag disabled.
6. Deploy.
7. Enable Firebase + Worker env vars.
8. Turn frontend flag on after direct endpoint tests pass.

## Acceptance Criteria

- [ ] Site search still works unchanged.
- [ ] Scanner still works when name suggestions are disabled.
- [ ] Scanner still works when name suggestion endpoint fails.
- [ ] No Scrydex requests are made by name correction.
- [ ] Name suggestion endpoint is cached in Upstash.
- [ ] Bad OCR names are not blindly inserted into the name field.
- [ ] High-confidence official names auto-fill.
- [ ] Medium/low confidence names do not auto-fill.
- [ ] Candidate lookup still falls back to existing flow.
- [ ] No client writes to `scannerNameIndex`.

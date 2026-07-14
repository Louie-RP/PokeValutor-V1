# PokéValuator Card Scanner V2 Spec — Hybrid Recognition

## Status

Recommended next version after the current OCR-first scanner branch.

## Problem

The current scanner can open the camera, capture a card, run OCR, and submit the existing search form. The problem is that OCR is unreliable for Pokémon cards because the card name and collector number are small, stylized, often reflective, and often blocked by sleeve glare.

The scanner should stop treating OCR as the final answer. OCR should become one signal in a larger matching pipeline.

## Current Branch Baseline

Current branch behavior:

1. `search.html` mounts the scanner above the existing search form.
2. `scanner.js` renders the scanner UI, opens the camera, captures a centered crop, runs Tesseract OCR, extracts name/number, and submits the existing search form.
3. `scanner.js` already contains stubs for OpenCV normalization and vision extraction, but both are disabled by default.
4. `functions/index.js` already contains a `scanCard` HTTP function, but it is guarded by an environment kill switch and is not called from the frontend yet.
5. The branch should be rebased or merged with the latest `main` before continuing.

## Goal

Improve scan accuracy without breaking existing search, Watchlist, Dex/Collection behavior, Firebase auth, quota UI, or pricing behavior.

## Recommended Architecture

```text
Camera capture
↓
Centered crop
↓
Optional OpenCV card normalization
↓
OCR targeted regions
↓
Candidate retrieval
↓
Image similarity scoring
↓
Confidence score
↓
Candidate picker / user confirmation
↓
Existing search or collection flow
```

## Design Rules

1. Keep the existing search form working exactly as-is.
2. Keep manual confirmation required.
3. Do not store scanned images in production by default.
4. Do not expose AI/API keys in frontend JavaScript.
5. Put every expensive or risky behavior behind a feature flag.
6. Use OCR as a helper, not the source of truth.

## Version 2.1 — Stabilize Current Scanner

### Scope

1. Rebase/merge `main` into the scanner branch.
2. Replace boolean constants with feature flags that can be controlled from `window`.
3. Wire `normalizeImage()` to actually use `normalizeCardWithOpenCv()` when enabled.
4. Wire `extractWithVision()` to call the existing backend function only when enabled.
5. Add image compression before any vision request.
6. Keep OCR fallback always available.
7. Keep `Search Detected Card` as the final user-triggered action.

### Acceptance Criteria

- Manual search still works.
- Scanner still works with all flags off.
- OpenCV flag can be enabled locally without breaking fallback.
- Vision flag can be enabled locally/dev only.
- If OpenCV fails, OCR still runs.
- If vision fails/times out, OCR still runs.
- User can edit name/number before searching.

## Version 2.2 — Add Candidate Matching

### Scope

1. Build a candidate list from the OCR output:
   - collector number first
   - selected set filter if available
   - name fallback
2. Fetch official candidate images from the existing card data source.
3. Compute a lightweight image fingerprint for the scanned crop and each candidate image.
4. Rank candidates by a combined score:
   - collector number match
   - name match
   - set match
   - image similarity
5. Show top 3–5 possible matches to the user.

### Candidate Score Example

```js
finalScore =
  numberScore * 0.40 +
  imageScore * 0.35 +
  nameScore * 0.15 +
  setScore * 0.10
```

### Acceptance Criteria

- Correct card appears in top 3 for most clean scans.
- Wrong auto-fill rate decreases compared with OCR-only.
- If confidence is low, the app shows choices instead of pretending it knows.
- User can select the correct card before searching or adding to collection.

## Version 2.3 — Scan to Collection

### Scope

After the candidate picker is stable:

1. User scans card.
2. App shows top matches.
3. User picks exact card.
4. User chooses condition, variant, and quantity.
5. App adds card to Collection using existing Dex/Collection logic.

### Non-Goal

Do not auto-add cards from the first scan without user confirmation.

## Feature Flags

Recommended frontend flags:

```js
window.PV_SCANNER_ENABLE_OPENCV_NORMALIZE = false;
window.PV_SCANNER_ENABLE_VISION = false;
window.PV_SCANNER_ENABLE_ADVANCED_OCR_FALLBACK = true;
window.PV_SCANNER_VISION_ENDPOINT = "";
window.PV_SCANNER_VISION_TIMEOUT_MS = 9000;
```

Recommended server-side flags:

```txt
ENABLE_SCANNER_VISION=false
SCANNER_VISION_API_KEY=<server-only secret>
SCANNER_VISION_MODEL=<server-side vision-capable model>
```

## Metrics to Track

For each test scan, track:

1. Expected card ID.
2. Detected name.
3. Detected collector number.
4. Top candidate card IDs.
5. Whether correct card was top 1.
6. Whether correct card was top 3.
7. Whether user edited the fields.
8. Processing time.
9. Failure reason, if any.

## Test Matrix

Use at least 25–50 cards across:

1. Modern non-holo.
2. Modern holo.
3. Full-art / SIR.
4. Gallery cards with `TG` or `GG` numbering.
5. Promos with `SWSH`, `SVP`, etc.
6. Vintage cards with bottom-right numbering.
7. Cards in penny sleeves.
8. Cards in top loaders.
9. Cards with dark backgrounds.
10. Cards under bad lighting/glare.

## Rollout Plan

1. Keep scanner hidden or beta-labeled.
2. Ship OCR-only baseline.
3. Enable OpenCV locally.
4. Enable OpenCV in dev.
5. Add candidate picker.
6. Only after candidate matching is stable, test optional vision fallback.
7. Keep production vision disabled until rate limits and budget caps are tested.

## Recommended Next Work Order

1. Rebase branch with `main`.
2. Patch `normalizeImage()`.
3. Patch `extractWithVision()`.
4. Add frontend flag overrides.
5. Add candidate picker UI skeleton.
6. Add no-AI image similarity after candidate retrieval.
7. Only then consider paid/server-side vision fallback.

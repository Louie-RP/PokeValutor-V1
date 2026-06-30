# Card Scanner V2 Migration Plan (Low-Risk, One Step at a Time)

## Goal

Improve scan reliability across modern, holo, gallery, and vintage cards by moving from OCR-only extraction to a hybrid pipeline:

1. In-browser card normalization (perspective crop).
2. Backend vision extraction for structured fields.
3. OCR retained only as fallback/manual assist.

This plan is intentionally staged to prevent regressions to existing search, watchlist, Dex, quota UI, and auth behavior.

## Non-Regression Rules

1. Do not modify `search.js`.
2. Keep existing scanner UI controls and search submit behavior unchanged.
3. Gate all new runtime behavior behind feature flags.
4. Every phase ships with rollback toggle.
5. If a phase fails validation, disable only that phase and keep scanner baseline working.

## Feature Flags

Add scanner-local flags (in `scanner.js`) for controlled rollout:

- `PV_SCANNER_ENABLE_VISION` (default: false)
- `PV_SCANNER_ENABLE_OPENCV_NORMALIZE` (default: false)
- `PV_SCANNER_ENABLE_ADVANCED_OCR_FALLBACK` (default: true)

Flags can be constants initially, then moved to config later.

## Phase 1 (Now): Stabilize Baseline + Plan

Scope:

1. Freeze current scanner behavior as baseline fallback path.
2. Document migration architecture and rollout checks.

Deliverables:

1. This migration plan document.
2. No runtime behavior changes.

Exit Criteria:

1. Existing scanner still captures, OCRs, and submits.
2. Existing Cards page features remain unaffected.

## Phase 2: Refactor Scanner into Isolated Pipeline Modules

Scope:

1. Split `scanner.js` internals into clear functions:
   - `captureFrame`
   - `normalizeImage` (stub/no-op initially)
   - `extractWithVision` (stub returns null)
   - `extractWithOcrFallback` (current behavior)
   - `mergeAndValidateDetections`
2. Preserve current output behavior exactly.

Deliverables:

1. Same runtime outputs for baseline cards.
2. Cleaner internals for low-risk V3 integration.

Exit Criteria:

1. No functional regressions in manual search + scanner flow.
2. Same event contract:
   - `pv:scanner:ready`
   - `pv:scanner:detected`
   - `pv:scanner:search`

Rollback:

1. Revert refactor commit only.

## Phase 3: Add OpenCV.js Card Normalization (Flagged Off by Default)

Scope:

1. Add optional OpenCV.js script include in `search.html` (guarded use).
2. Implement card contour detection + perspective warp in scanner module.
3. If OpenCV fails, silently fall back to current crop.

Deliverables:

1. `normalizeImage` returns perspective-correct card image when enabled.
2. No behavior change while flag is false.

Exit Criteria:

1. When enabled locally, normalized preview/crop works on test cards.
2. When disabled, behavior matches baseline.

Rollback:

1. Disable `PV_SCANNER_ENABLE_OPENCV_NORMALIZE`.

## Phase 4: Add Vision Endpoint (Flagged Off by Default)

Scope:

1. Add serverless endpoint (Cloudflare Worker or Firebase Function):
   - `POST /scan-card`
   - input: normalized image
   - output JSON: `{ name, collectorNumber, setHint, confidence }`
2. Keep secrets server-side only.
3. Add strict rate limiting.

Deliverables:

1. `extractWithVision` function in scanner calls endpoint when enabled.
2. If endpoint fails/timeouts, scanner auto-falls back to OCR path.

Exit Criteria:

1. Vision path improves name+number hit rate on test set.
2. Fallback always works when vision unavailable.

Rollback:

1. Disable `PV_SCANNER_ENABLE_VISION`.

## Phase 5: Tune Validation + Confidence Gating

Scope:

1. Add confidence threshold routing:
   - high confidence: auto-fill fields
   - low confidence: fill partial + prompt edits
2. Keep user confirmation required before submit.

Deliverables:

1. Reduced false positives on card numbers.
2. Better handling of holo glare and old card layouts.

Exit Criteria:

1. Better precision than OCR-only baseline.
2. No regressions in submit/search flow.

## Recommended Test Matrix Per Phase

Use these card categories each phase:

1. Modern non-holo (easy text).
2. Modern holo/full-art (glare).
3. Gallery/promo format numbers (`GG`, `TG`, `SVP`, `SWSH`).
4. Vintage cards with bottom-right numbering.
5. Sleeved/top-loader cards.

Per card verify:

1. Name field quality.
2. Number field quality.
3. Search submit still works.
4. No console errors.

## Metrics to Track

Track before/after for each phase:

1. Name exact-match rate.
2. Collector-number exact-match rate.
3. False positive number rate.
4. OCR/vision processing time.
5. User manual edit rate before submit.

## Rollout Strategy

1. Ship Phase 2 to baseline branch.
2. Enable Phase 3 locally only.
3. Enable Phase 4 in dev/staging only.
4. Compare metrics against baseline.
5. Enable in production gradually via flag.

## Next Immediate Task

Implement Phase 2 refactor only, preserving current behavior and outputs exactly.

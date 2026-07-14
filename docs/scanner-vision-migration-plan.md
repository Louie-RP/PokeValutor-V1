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

## Pause-State Addendum (2026-06): Hybrid Scanner Recommendation

This addendum captures the current decision point: OCR-only extraction is not reliable enough across all card styles (holo glare, vintage layouts, promo numbering, sleeves/top loaders). The recommended direction is a hybrid scanner with a no-AI-first rollout.

### Recommended Target Architecture

1. Browser camera capture (`getUserMedia`) with mobile rear-camera preference.
2. Optional in-browser perspective normalization (OpenCV.js), with silent fallback when normalization fails.
3. OCR extraction from targeted regions (name area, collector-number area, optional set/rarity hints).
4. Candidate retrieval from existing card data using number-first and set-aware filtering.
5. Deterministic image matching against official card images for final disambiguation.
6. Confidence scoring with user-confirmation UI (auto-fill only when confidence is high).

### Why This Approach

1. OCR-only has high variance across print styles and glare conditions.
2. Image matching adds a second signal that is robust when text is noisy.
3. No-AI-first delivery avoids paid model costs while still improving accuracy.
4. Paid vision can remain an optional fallback, not the primary path.

## Phase 6: Deterministic Image Matching (No API Credits)

Scope:

1. Build candidate set from OCR output (collector number first, then set hints, then fuzzy name).
2. Fetch top-N candidate official card images.
3. Compute local similarity score per candidate using deterministic methods (for example, dHash/pHash and optional ORB tie-breaker).
4. Combine OCR confidence and image similarity into a single confidence score.
5. Show top 3-5 candidate matches when confidence is not high enough for auto-fill.

Deliverables:

1. Candidate ranking module in scanner flow.
2. Lightweight candidate review UI (tap to select exact card).
3. No third-party AI calls required.

Exit Criteria:

1. Lower false-positive rate versus OCR-only baseline.
2. Improved exact-match rate on holo, vintage, and promo cards.
3. No regressions to existing search submit behavior.

Rollback:

1. Disable image-match step and return to OCR/manual review path.

## Phase 7: Optional Vision Fallback (Credit-Gated)

Scope:

1. Use server-side vision extraction only when local OCR + image match confidence is below threshold.
2. Keep scanner vision disabled by default.
3. Enforce hard server-side kill switch and daily/monthly usage caps.

Deliverables:

1. Conditional fallback policy (never call vision for high-confidence scans).
2. Budget guardrails (rate limits, request caps, payload size limits).

Exit Criteria:

1. Vision fallback improves low-confidence cases.
2. Credit usage remains within predefined budget.

Rollback:

1. Disable vision flag and continue with deterministic hybrid path.

## API Credit Impact Model

### Current State (No-AI Mode)

1. Client scanner vision flag is off.
2. Server endpoint is guarded by an environment kill switch.
3. Expected vision-model credits consumed: zero.

### No-AI Hybrid (Phases 6 without 7)

1. Expected vision-model credits consumed: zero.
2. Incremental cost is only standard hosting/network/compute from fetching candidate images.

### AI Fallback Enabled (Phase 7)

1. Vision credits scale with number of fallback scans.
2. Monthly credit impact is approximately proportional to:

   `fallback_scans_per_month * average_cost_per_vision_request`

3. Keep costs predictable by reducing fallback frequency:
   - call vision only below strict confidence threshold
   - cap fallback scans per user/day
   - cap total fallback scans per month
   - keep image payload compressed and bounded

## Implementation Readiness Checklist (When Resuming)

1. Confirm no-AI mode remains default in production.
2. Define confidence thresholds for auto-fill vs candidate picker.
3. Select deterministic matcher (dHash/pHash baseline, optional ORB tie-breaker).
4. Build and test candidate picker UI with top 3-5 results.
5. Validate against the full card matrix (modern, holo, gallery, vintage, sleeved).
6. Decide whether optional vision fallback is still needed after deterministic metrics.

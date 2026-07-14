# CardSight Scanner Integration Plan (Task-by-Task)

## Goal
Integrate CardSight as an identification provider while preserving existing scanner UX, candidate confirmation flow, and PokeValutor catalog IDs as the source of truth.

## Current Status
- Completed Task 1: scanner provider flags scaffolded in scanner.js with safe defaults.
- Completed Task 2 (part A): pure CardSight payload mapping helpers added in scrydex-worker.js.
- Completed Task 2 (part B): fixture + script test for mapping behavior.
- Completed Task 3: worker CardSight proxy endpoint added with normalized response and timeout/feature-flag controls.
- Completed Task 4: CardSight detections resolve through the existing catalog candidate provider with ordered query fallback and deduped internal candidates.
- Completed Task 5: scanner provider-mode routing wired (ocr/cardsight/compare), CardSight endpoint integration added, and compare telemetry event emitted.
- Completed Task 6: scanner now carries multi-detection CardSight results, merges deduped internal candidates into candidate suggestions, and preserves top candidate confirmation flow.
- Completed Task 7: CardSight uses a dedicated higher-resolution compression path with payload-size bounds, while OCR keeps its existing image path; CardSight warning guidance is now surfaced in scanner status text.
- Completed Task 8: worker and scanner diagnostics/metrics payloads now include request IDs, warning codes, confidence summaries, and top1/top3 evaluation signals while keeping image persistence disabled.

## Implementation Order

1. Feature flag scaffolding (scanner + worker)
- Add provider mode flags and confidence threshold flags with defaults:
  - provider: compare
  - cardsight enabled: false
  - min confidence: 0.85
- Keep OCR-first behavior unchanged while flags are off.
- Testing checkpoint:
  - Verify search page loads.
  - Verify scanner opens, captures, and still runs OCR path.

2. CardSight normalization helpers
- Keep helper functions pure and provider-specific:
  - fieldsToMap
  - buildCardSightCollectorNumber
  - normalizeCardSightDetection
  - normalizeCardSightMessages
- Testing checkpoint:
  - Validate helper output using the confirmed fixture shape from spec.
  - Confirm display number uses PRINTED_TOTAL denominator.

3. Worker CardSight client endpoint
- Add a new worker route to proxy CardSight request and normalize output.
- Keep secrets server-side only (never in frontend):
  - CARDSIGHT_API_KEY
  - CARDSIGHT_TEAM_ID (if required by provider)
- Include provider requestId, processing time, and normalized warnings.
- Testing checkpoint:
  - Route returns normalized data for known good payload.
  - Route failure returns safe fallback error object.

4. Catalog resolution adapter
- Resolve normalized CardSight detections using existing scanner candidate endpoint.
- Query priority:
  1) releaseCode + number
  2) releaseName + number
  3) releaseName + name + number
  4) name + number
- Testing checkpoint:
  - Provider IDs are never used as internal card IDs.
  - Candidate list is populated through existing candidate renderer.

5. Scanner provider mode integration
- Add provider mode switch in executeDetectionPipeline:
  - ocr: current behavior
  - cardsight: CardSight first, OCR fallback
  - compare: run both and record comparison metadata
- Keep user confirmation mandatory in POC.
- Testing checkpoint:
  - High confidence only preselects candidate, never auto-adds.
  - Low confidence still shows editable fields and candidate picker.

6. Multi-detection support
- Normalize all detections, discard invalid entries, sort by confidence.
- Resolve each detection to internal candidates and dedupe by internal ID.
- Keep top 3-5 display.
- Testing checkpoint:
  - Multiple detections do not duplicate cards.
  - Candidate order remains deterministic.

7. Image handling refinement
- Add dedicated higher-resolution crop/compression path for CardSight requests.
- Keep OCR crop path unchanged until compare data is collected.
- Testing checkpoint:
  - Low-resolution warning mapping appears with user guidance.
  - Payload size remains bounded.

8. Metrics and diagnostics
- Log provider requestId, confidence, top1/top3 outcome, warning codes.
- Never store image payloads by default.
- Testing checkpoint:
  - Metrics omit sensitive content and full provider payload text.

## Cloudflare Worker Update Workflow
When worker changes are required, copy the full updated scrydex-worker.js into Cloudflare Worker editor and deploy.

Recommended deploy checklist for each worker change:
- Confirm required secrets exist in Worker environment.
- Confirm route-level CORS still matches existing behavior.
- Hit /health and scanner endpoints after deploy.
- Verify search/scanner flow still works from search page.

## Regression Guardrails
- Do not modify search.js behavior.
- Do not auto-add cards to collection.
- Do not persist raw images.
- Keep OCR mode fully functional when CardSight is disabled.

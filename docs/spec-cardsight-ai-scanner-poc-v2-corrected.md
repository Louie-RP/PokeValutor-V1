# PokéValuator CardSight AI Scanner POC Specification — Payload-Mapped Revision

## Status

Revised after testing CardSight AI Playground and reviewing a successful Pokémon card detection payload.

## Branch Decision

Create the proof-of-concept branch from the existing scanner branch:

```bash
git checkout scan-card-feature-implementation
git pull origin scan-card-feature-implementation
git checkout -b cardsight-ai-scanner-poc
```

Do not restart from `main`. The existing scanner branch already owns camera capture, image cropping,
scanner UI, OCR fallback, candidate display, Firebase endpoints, and search integration.

---

## Confirmed CardSight Response Shape

A successful CardSight request returned:

```json
{
  "success": true,
  "requestId": "c8f7540f-6d3e-431b-b3a8-199a15f169cf",
  "detections": [
    {
      "confidence": "High",
      "card": {
        "id": "75147e1f-8c90-423b-8fec-72291fe20327",
        "segmentId": "3266fff9-dfcb-4e00-80fb-922a8ab023d5",
        "releaseId": "36c318db-8e6e-4023-a995-f6254755afbf",
        "setId": "6621b8f8-6f7e-44ec-aa7e-ef66074b1cd1",
        "year": "2025",
        "manufacturer": "The Pokemon Company",
        "releaseName": "Phantasmal Flames",
        "setName": "Checklist",
        "name": "Mega Charizard X ex",
        "number": "125",
        "attributes": [
          "pokemon-ex",
          "pokemon-fire",
          "pokemon-illustration-rare"
        ],
        "fields": [
          { "key": "LANGUAGE", "value": "en" },
          { "key": "RELEASE_CODE", "value": "PFL" },
          { "key": "ACTUAL_TOTAL", "value": "130" },
          { "key": "PRINTED_TOTAL", "value": "94" },
          { "key": "RARITY", "value": "Special Illustration Rare" }
        ]
      }
    }
  ],
  "processingTime": 225,
  "messages": [
    {
      "type": "warning",
      "message": "Image resolution (367x512) is below the recommended size for accurate results."
    }
  ]
}
```

---

## What This Changes

CardSight can become the scanner's **identification source**, while PokéValuator remains the source of
truth for:

- Existing internal/ScryDex card IDs.
- Official card images used in the application.
- Prices.
- Search results.
- Watchlist and collection behavior.
- Variants and conditions.

CardSight IDs must be treated as provider IDs only. They should not be inserted directly into
PokéValuator search, pricing, Dex, or collection requests.

---

## Field Mapping

### Top-Level Response

| CardSight field | PokéValuator use |
|---|---|
| `success` | Determines whether the provider request succeeded |
| `requestId` | Safe correlation ID for logs and diagnostics |
| `detections` | Provider matches; map each one into an internal candidate |
| `processingTime` | Provider latency metric |
| `messages` | User guidance and diagnostics, especially image-quality warnings |

### Detection Fields

| CardSight field | PokéValuator use |
|---|---|
| `confidence` | Map `High`, `Medium`, and `Low` into internal confidence values |
| `card` | Source object for candidate resolution |

Suggested confidence mapping:

```js
const CARDSIGHT_CONFIDENCE_SCORE = {
    high: 0.95,
    medium: 0.75,
    low: 0.50
};
```

This numeric value is for routing and display. It is not proof that CardSight's confidence is a
calibrated probability.

### Card Identity Fields

| CardSight field | PokéValuator use |
|---|---|
| `card.id` | Store as `providerCardId` for debugging only |
| `card.segmentId` | Provider metadata only |
| `card.releaseId` | Provider metadata only |
| `card.setId` | Provider metadata only |
| `card.name` | Main catalog search signal |
| `card.number` | Main exact-card lookup signal |
| `card.releaseName` | Main expansion/set-name lookup signal |
| `card.setName` | Secondary grouping metadata; do not assume it equals Pokémon expansion name |
| `card.year` | Optional tie-breaker |
| `card.manufacturer` | Validate expected game/manufacturer |
| `card.attributes` | Supplemental validation and UI metadata |
| `card.fields` | Structured metadata such as release code, language, rarity, and totals |

---

## Important `releaseName` vs `setName` Rule

The payload returned:

```json
{
  "releaseName": "Phantasmal Flames",
  "setName": "Checklist"
}
```

For PokéValuator catalog matching, use:

```text
releaseName = Pokémon expansion/set
setName     = provider subgroup/checklist/category
```

Therefore, catalog resolution should prioritize `releaseName`, not `setName`.

Recommended lookup order:

1. `RELEASE_CODE + card.number`
2. `releaseName + card.number`
3. `releaseName + card.name + card.number`
4. `card.name + card.number`
5. Existing candidate endpoint
6. User confirmation/manual search

---

## Structured Fields Helper

Add one reusable helper:

```js
function fieldsToMap(fields) {
    const result = {};

    for (const entry of Array.isArray(fields) ? fields : []) {
        const key = String(entry?.key || '').trim().toUpperCase();
        if (!key) continue;
        result[key] = String(entry?.value || '').trim();
    }

    return result;
}
```

Usage:

```js
const fieldMap = fieldsToMap(card.fields);

const releaseCode = fieldMap.RELEASE_CODE || '';
const language = fieldMap.LANGUAGE || '';
const rarity = fieldMap.RARITY || '';
const actualTotal = fieldMap.ACTUAL_TOTAL || '';
const printedTotal = fieldMap.PRINTED_TOTAL || '';
```

---

## Collector Number Construction

CardSight returned:

```json
{
  "number": "125",
  "ACTUAL_TOTAL": "130",
  "PRINTED_TOTAL": "94"
}
```

Use the raw number for exact catalog matching:

```text
125
```

For display and exact collector-number matching, construct:

```text
125/094
```

Use `PRINTED_TOTAL` as the denominator because that is the denominator printed on the physical card.
`ACTUAL_TOTAL` represents the full checklist size and must not be substituted into the printed
collector number.

Preserve leading zeroes from `PRINTED_TOTAL`.

Suggested helper:

```js
function buildCollectorNumber(card, fieldMap) {
    const number = String(card?.number || '').trim();
    const printedTotal = String(fieldMap?.PRINTED_TOTAL || '').trim();

    if (!number) return '';
    if (number.includes('/')) return number;
    if (!printedTotal) return number;

    return `${number}/${printedTotal}`;
}
```

Store both:

```js
{
  number: "125",
  displayNumber: "125/094"
}
```

The existing catalog resolver should receive both because different APIs may index the card by raw
number or full collector number.

---

## Normalized CardSight Detection

Create a provider mapper:

```js
function normalizeCardSightDetection(detection) {
    const card = detection?.card || {};
    const fieldMap = fieldsToMap(card.fields);

    const confidenceLabel = String(detection?.confidence || '')
        .trim()
        .toLowerCase();

    const confidenceScore =
        CARDSIGHT_CONFIDENCE_SCORE[confidenceLabel] ?? 0.40;

    return {
        provider: 'cardsight',
        providerCardId: String(card.id || ''),
        providerSegmentId: String(card.segmentId || ''),
        providerReleaseId: String(card.releaseId || ''),
        providerSetId: String(card.setId || ''),

        name: String(card.name || '').trim(),
        number: String(card.number || '').trim(),
        displayNumber: buildCollectorNumber(card, fieldMap),

        releaseName: String(card.releaseName || '').trim(),
        providerSetName: String(card.setName || '').trim(),
        releaseCode: fieldMap.RELEASE_CODE || '',
        language: fieldMap.LANGUAGE || '',
        rarity: fieldMap.RARITY || '',
        series: fieldMap.SERIES || '',
        actualTotal: fieldMap.ACTUAL_TOTAL || '',
        printedTotal: fieldMap.PRINTED_TOTAL || '',

        year: String(card.year || '').trim(),
        manufacturer: String(card.manufacturer || '').trim(),
        attributes: Array.isArray(card.attributes) ? card.attributes : [],

        confidenceLabel,
        confidenceScore,

        rawProviderMetadata: {
            requestSafe: true
        }
    };
}
```

Do not return or persist the full card description unless the UI needs it. It is unnecessary for
identification and increases payload/log size.

---

## Normalized Backend Response

The Firebase Function should return a provider-independent shape:

```json
{
  "ok": true,
  "provider": "cardsight",
  "requestId": "c8f7540f-6d3e-431b-b3a8-199a15f169cf",
  "providerProcessingMs": 225,
  "totalProcessingMs": 410,
  "warnings": [
    {
      "code": "LOW_IMAGE_RESOLUTION",
      "message": "The image resolution may reduce recognition accuracy."
    }
  ],
  "detections": [
    {
      "providerCardId": "75147e1f-8c90-423b-8fec-72291fe20327",
      "name": "Mega Charizard X ex",
      "number": "125",
      "displayNumber": "125/094",
      "releaseName": "Phantasmal Flames",
      "releaseCode": "PFL",
      "language": "en",
      "rarity": "Special Illustration Rare",
      "confidenceLabel": "high",
      "confidenceScore": 0.95
    }
  ]
}
```

---

## Existing Scanner Integration

The existing scanner branch already has:

- `capturedBlob`
- OCR extraction
- editable `name` and `number` inputs
- candidate lookup
- candidate ranking
- candidate picker UI
- feature flags
- Firebase backend scanner support

CardSight should enter immediately after image capture and normalization:

```text
capture
  ↓
normalize/compress
  ↓
identify with CardSight
  ↓
resolve CardSight result against PokéValuator catalog
  ↓
render existing candidates
  ↓
user confirms
  ↓
existing search submit
```

### Do Not

- Rebuild the camera UI.
- Replace `search.js`.
- Send CardSight IDs into the existing search form.
- Skip the candidate confirmation step.
- remove OCR during the proof of concept.

---

## Provider Mode

Add:

```js
const PV_SCANNER_PROVIDER = 'compare';
const PV_SCANNER_ENABLE_CARDSIGHT = false;
const PV_SCANNER_CARDSIGHT_MIN_CONFIDENCE = 0.85;
```

Read them through the existing feature-flag helpers.

Supported modes:

```text
ocr       Current OCR/candidate behavior
cardsight CardSight first, OCR fallback
compare   Run both and record which performs better
```

Initial branch default:

```js
PV_SCANNER_PROVIDER = 'compare';
PV_SCANNER_ENABLE_CARDSIGHT = false;
```

Enable it locally or for tester/admin accounts only.

---

## Catalog Resolution Adapter

Create a function that converts a CardSight detection into your existing catalog candidate request:

```js
async function resolveCardSightDetection(detection) {
    const queries = [
        {
            releaseCode: detection.releaseCode,
            number: detection.number,
            name: detection.name
        },
        {
            setName: detection.releaseName,
            number: detection.number,
            name: detection.name
        },
        {
            name: detection.name,
            number: detection.number
        }
    ];

    for (const query of queries) {
        const result = await fetchCatalogCandidates(query);

        if (Array.isArray(result) && result.length) {
            return rankCatalogCandidates(result, detection);
        }
    }

    return [];
}
```

Reuse the existing candidate endpoint and existing candidate cards. The only new responsibility is
feeding better identification fields into that pipeline.

---

## Candidate Ranking

CardSight supplies better fields than OCR, so use a CardSight-specific score:

```js
finalScore =
    exactNumberScore * 0.35 +
    releaseCodeScore * 0.25 +
    releaseNameScore * 0.15 +
    exactNameScore * 0.15 +
    providerConfidenceScore * 0.10;
```

Recommended scoring:

```text
Exact collector number:      1.00
Exact release code:          1.00
Exact normalized release:    1.00
Exact normalized card name:  1.00
```

The correct internal card should still be selected from PokéValuator's catalog, not directly from the
provider response.

---

## Multiple Detections

The API returns `detections` as an array. Support all entries even if the first test returned one.

Rules:

1. Normalize every valid detection.
2. Discard detections missing both card name and number.
3. Sort by mapped confidence.
4. Resolve each detection against the internal catalog.
5. Deduplicate internal card IDs.
6. Display the top 3–5 candidates in the existing picker.

This also prepares the scanner for images containing multiple cards.

---

## Image Resolution Warning

The provider reported:

```text
Image resolution (367x512) is below the recommended size.
```

Your current cropped scanner image may be too small for the best CardSight result.

Change the capture/compression rules for CardSight requests:

- Preserve the full card crop at a higher resolution.
- Target at least roughly 700–1000 pixels on the shorter card edge when the camera source supports it.
- Do not upscale a low-resolution crop and assume it adds detail.
- Use JPEG quality around `0.82–0.90`.
- Keep a provider payload-size limit.
- Use the smaller OCR crop separately if OCR performs better with it.

Recommended flow:

```text
camera frame
 ├── high-resolution card crop → CardSight
 └── targeted/processed regions → OCR fallback
```

Do not use the exact same aggressively compressed image for both systems without testing.

---

## Warning Mapping

Do not display raw provider messages blindly.

Map known messages:

```js
function normalizeCardSightMessages(messages) {
    return (Array.isArray(messages) ? messages : []).map((item) => {
        const message = String(item?.message || '').trim();
        const lower = message.toLowerCase();

        if (lower.includes('resolution') && lower.includes('below')) {
            return {
                code: 'LOW_IMAGE_RESOLUTION',
                type: 'warning',
                message: 'Move closer and keep the full card inside the frame for a clearer scan.'
            };
        }

        return {
            code: 'PROVIDER_WARNING',
            type: String(item?.type || 'warning'),
            message: 'The card image may be difficult to identify. Try retaking the photo.'
        };
    });
}
```

---

## High-Confidence Behavior

Even for `"confidence": "High"`:

- Resolve against the PokéValuator catalog.
- Show the candidate result.
- Require confirmation during the POC.
- Do not automatically add to a collection.
- Do not treat `High` as guaranteed correctness.

Suggested routing:

```text
High + exact internal catalog match:
    Preselect top candidate, require confirmation.

High + multiple internal matches:
    Show candidate picker.

Medium/Low:
    Show candidates and OCR fallback fields.

No internal match:
    Populate editable name/number fields and run existing search.
```

---

## Backend Files

Recommended additions:

```text
functions/scanner/cardsight-client.js
functions/scanner/cardsight-mapper.js
functions/scanner/cardsight-catalog-resolver.js
functions/scanner/cardsight-errors.js
functions/scripts/test-cardsight-identification.js
```

Temporary implementation in `functions/index.js` is acceptable for the first spike, but isolate the
mapping functions so the large file does not grow further.

---

## Metrics

Record:

```json
{
  "provider": "cardsight",
  "providerRequestId": "c8f7540f-6d3e-431b-b3a8-199a15f169cf",
  "providerConfidence": "high",
  "providerProcessingMs": 225,
  "releaseCode": "PFL",
  "detectedNumber": "125",
  "resolvedInternalCardId": "internal-card-id",
  "top1Correct": true,
  "top3Correct": true,
  "ocrTop1Correct": false,
  "imageWarningCodes": ["LOW_IMAGE_RESOLUTION"],
  "manualCorrectionRequired": false
}
```

Do not store the image or full provider description.

---

## First Implementation Slice

### Commit 1

```text
docs: map confirmed CardSight payload into scanner POC
```

### Commit 2

Add pure, testable helpers:

- `fieldsToMap`
- `buildCollectorNumber`
- `normalizeCardSightDetection`
- `normalizeCardSightMessages`

Use the sample response as a sanitized JSON fixture.

### Commit 3

Create a server-side CardSight client and test script.

### Commit 4

Add Firebase endpoint and server-side feature flag.

### Commit 5

Add `compare` provider mode to `scanner.js`.

### Commit 6

Resolve CardSight detections through the existing catalog candidate endpoint.

### Commit 7

Adjust CardSight image crop resolution and display retake guidance.

---

## Acceptance Criteria

- CardSight API key never appears in frontend code.
- Existing OCR-only mode works unchanged.
- CardSight response maps correctly from the provided fixture.
- `releaseName` is used as the expansion name.
- `setName: Checklist` is not incorrectly used as the Pokémon expansion.
- Card number `125/094` can resolve using release code `PFL`, with raw number `125` retained as a fallback.
- Display number becomes `125/094`, preserving the printed denominator and leading zero.
- Provider IDs are never used as internal card IDs.
- High-confidence CardSight output still requires user confirmation.
- Low-resolution warnings produce useful retake instructions.
- Multiple detections are supported.
- Images are not stored by default.
- The existing search form, candidate picker, and collection behavior remain functional.

---

## Recommended Final Architecture

The strongest expected production design is:

```text
CardSight identification
        ↓
PokéValuator catalog resolution
        ↓
Existing candidate picker
        ↓
User confirmation
        ↓
Existing price/search/collection flow
```

OCR should remain a fallback until comparison testing shows that CardSight is reliable enough to
replace it entirely.

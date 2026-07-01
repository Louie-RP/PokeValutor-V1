# scanner.js Patch: use /scanner/candidates first

Your current `scanner.js` already has candidate UI and fallback `/cards/search` calls.

This patch updates the candidate lookup order:

```txt
1. Try /scanner/candidates
2. Fall back to /cards/search when catalog results are missing or low
```

## 1. Add feature flag constant near the other scanner constants

```js
const PV_SCANNER_ENABLE_CATALOG_CANDIDATES = true;
```

## 2. Add it to `getScannerFeatureFlags()`

```js
enableCatalogCandidates: readBooleanFlag('PV_SCANNER_ENABLE_CATALOG_CANDIDATES', PV_SCANNER_ENABLE_CATALOG_CANDIDATES),
```

Example:

```js
function getScannerFeatureFlags() {
    return {
        enableVision: readBooleanFlag('PV_SCANNER_ENABLE_VISION', PV_SCANNER_ENABLE_VISION),
        enableOpenCvNormalize: readBooleanFlag('PV_SCANNER_ENABLE_OPENCV_NORMALIZE', PV_SCANNER_ENABLE_OPENCV_NORMALIZE),
        enableAdvancedOcrFallback: readBooleanFlag('PV_SCANNER_ENABLE_ADVANCED_OCR_FALLBACK', PV_SCANNER_ENABLE_ADVANCED_OCR_FALLBACK),
        enableCandidates: readBooleanFlag('PV_SCANNER_ENABLE_CANDIDATES', PV_SCANNER_ENABLE_CANDIDATES),
        enableCatalogCandidates: readBooleanFlag('PV_SCANNER_ENABLE_CATALOG_CANDIDATES', PV_SCANNER_ENABLE_CATALOG_CANDIDATES),
        candidatesConsumeQuota: readBooleanFlag('PV_SCANNER_CANDIDATES_CONSUME_QUOTA', PV_SCANNER_CANDIDATES_CONSUME_QUOTA),
        candidateHighConfidence: readNumberFlag('PV_SCANNER_CANDIDATE_HIGH_CONFIDENCE', PV_SCANNER_CANDIDATE_HIGH_CONFIDENCE, 0.55, 0.99),
        visionEndpoint: String(window?.PV_SCANNER_VISION_ENDPOINT || PV_SCANNER_VISION_ENDPOINT || '').trim(),
        visionTimeoutMs: Number(window?.PV_SCANNER_VISION_TIMEOUT_MS || PV_SCANNER_VISION_TIMEOUT_MS) || PV_SCANNER_VISION_TIMEOUT_MS
    };
}
```

## 3. Replace current `fetchScannerCandidates` with this version

```js
async function fetchScannerCandidates(detected, flags) {
    const base = getScannerWorkerBase();
    const number = normalizeExtractedCardNumber(detected?.number || '');
    const name = normalizeDetectedName(detected?.name || '');
    const results = [];
    const seen = new Set();

    function mergeCards(cards) {
        const list = Array.isArray(cards) ? cards : [];

        list.forEach(function (card) {
            const id = String(card?.id || '').trim();
            if (!id || seen.has(id)) {
                return;
            }

            seen.add(id);
            results.push(card);
        });
    }

    if (flags?.enableCatalogCandidates) {
        try {
            const catalogPayload = await fetchScannerCatalogCandidates(base, {
                name: name,
                number: number,
                setId: detected?.setId || '',
                limit: SCANNER_CANDIDATE_FETCH_LIMIT
            });

            mergeCards(catalogPayload?.data);
        } catch (error) {
            console.warn('[PokeValutor Scanner] catalog candidate lookup failed', error);
        }
    }

    async function mergeQuery(query, pageSize) {
        if (!query || results.length >= SCANNER_CANDIDATE_FETCH_LIMIT) {
            return;
        }

        const payload = await fetchScannerCardsSearch(base, query, Math.max(6, Number(pageSize || 8)), flags);
        const list = Array.isArray(payload?.data) ? payload.data : [];

        mergeCards(list);
    }

    // Keep Scrydex fallback while the Firestore catalog is still growing.
    const minimumBeforeFallback = 4;

    if (results.length < minimumBeforeFallback && name) {
        await mergeQuery(buildFieldQuery('name', name), 10);
    }

    if (results.length < Math.min(6, SCANNER_CANDIDATE_FETCH_LIMIT) && number) {
        await mergeQuery(buildFieldQuery('printed_number', number), 8);
    }

    if (results.length < Math.min(6, SCANNER_CANDIDATE_FETCH_LIMIT) && number) {
        await mergeQuery(buildFieldQuery('number', number), 8);
    }

    if (detected?.setId) {
        const setId = String(detected.setId).trim();

        if (setId) {
            return results.filter(function (card) {
                return getCandidateSetId(card) === setId;
            }).concat(results.filter(function (card) {
                return getCandidateSetId(card) !== setId;
            })).slice(0, SCANNER_CANDIDATE_FETCH_LIMIT);
        }
    }

    return results.slice(0, SCANNER_CANDIDATE_FETCH_LIMIT);
}
```

## 4. Add this new helper near `fetchScannerCardsSearch`

```js
async function fetchScannerCatalogCandidates(base, detected) {
    const params = [
        `limit=${encodeURIComponent(String(detected?.limit || SCANNER_CANDIDATE_FETCH_LIMIT))}`
    ];

    const name = String(detected?.name || '').trim();
    const number = String(detected?.number || '').trim();
    const setId = String(detected?.setId || '').trim();

    if (name) {
        params.push(`name=${encodeURIComponent(name)}`);
    }

    if (number) {
        params.push(`number=${encodeURIComponent(number)}`);
    }

    if (setId) {
        params.push(`setId=${encodeURIComponent(setId)}`);
    }

    const url = `${base}/scanner/candidates?${params.join('&')}`;
    return fetchScannerJson(url);
}
```

## 5. No change needed to ranking

Keep your existing `rankScannerCandidates()` logic.

It already scores:

- card number
- card name
- selected set
- image hash similarity

That is exactly what we want after candidate retrieval.

# scanner.js Patch: Name Correction After OCR

This patch keeps the feature off by default to avoid regression.

Turn it on only after Firebase + Worker endpoint tests pass.

## 1. Add constants near existing scanner flags

```js
const PV_SCANNER_ENABLE_NAME_CORRECTION = false;
const PV_SCANNER_NAME_CORRECTION_AUTO_SCORE = 0.88;
const PV_SCANNER_NAME_CORRECTION_SUGGEST_SCORE = 0.70;
const PV_SCANNER_NAME_CORRECTION_TIMEOUT_MS = 1200;
```

## 2. Add flags to `getScannerFeatureFlags()`

```js
enableNameCorrection: readBooleanFlag('PV_SCANNER_ENABLE_NAME_CORRECTION', PV_SCANNER_ENABLE_NAME_CORRECTION),
nameCorrectionAutoScore: readNumberFlag('PV_SCANNER_NAME_CORRECTION_AUTO_SCORE', PV_SCANNER_NAME_CORRECTION_AUTO_SCORE, 0.70, 0.99),
nameCorrectionSuggestScore: readNumberFlag('PV_SCANNER_NAME_CORRECTION_SUGGEST_SCORE', PV_SCANNER_NAME_CORRECTION_SUGGEST_SCORE, 0.40, 0.95),
nameCorrectionTimeoutMs: readNumberFlag('PV_SCANNER_NAME_CORRECTION_TIMEOUT_MS', PV_SCANNER_NAME_CORRECTION_TIMEOUT_MS, 300, 2500),
```

## 3. Add helper functions near `fetchScannerCatalogCandidates`

```js
async function resolveScannerNameCorrection(base, detectedName, flags) {
    const rawName = normalizeDetectedName(detectedName || '');

    if (!flags?.enableNameCorrection || !rawName || rawName.length < 2) {
        return null;
    }

    const params = [
        `text=${encodeURIComponent(rawName)}`,
        'limit=5'
    ];

    const url = `${base}/scanner/name-suggestions?${params.join('&')}`;
    const payload = await fetchScannerJsonWithTimeout(url, Number(flags.nameCorrectionTimeoutMs || PV_SCANNER_NAME_CORRECTION_TIMEOUT_MS));
    const suggestions = Array.isArray(payload?.data) ? payload.data : [];

    if (!suggestions.length) {
        return null;
    }

    const best = suggestions[0];
    const name = normalizeDetectedName(best?.name || '');
    const score = Number(best?.score || 0);

    if (!name || !Number.isFinite(score)) {
        return null;
    }

    return {
        name,
        score,
        autoApply: score >= Number(flags.nameCorrectionAutoScore || PV_SCANNER_NAME_CORRECTION_AUTO_SCORE),
        suggestOnly: score >= Number(flags.nameCorrectionSuggestScore || PV_SCANNER_NAME_CORRECTION_SUGGEST_SCORE),
        source: best?.source || 'scannerNameIndex',
    };
}

async function fetchScannerJsonWithTimeout(url, timeoutMs) {
    const cacheKey = String(url || '').trim();

    if (!cacheKey) {
        return null;
    }

    if (scannerRequestCache.has(cacheKey)) {
        return scannerRequestCache.get(cacheKey);
    }

    let headers = undefined;

    try {
        const tokenRaw = window?.PV_AUTH?.getIdToken ? await window.PV_AUTH.getIdToken(true) : null;
        const token = typeof tokenRaw === 'string' ? tokenRaw.trim() : '';

        if (token && token.split('.').length === 3) {
            headers = { Authorization: `Bearer ${token}` };
        }
    } catch {
        // Ignore token errors.
    }

    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = window.setTimeout(function () {
        if (controller) {
            try {
                controller.abort();
            } catch {
                // Ignore abort errors.
            }
        }
    }, Math.max(300, Number(timeoutMs || 1200)));

    try {
        const response = await fetch(url, {
            ...(headers ? { headers: headers } : {}),
            ...(controller ? { signal: controller.signal } : {})
        });

        if (!response.ok) {
            throw new Error(`Scanner request failed (${response.status}).`);
        }

        const data = await response.json();
        scannerRequestCache.set(cacheKey, data);
        return data;
    } finally {
        window.clearTimeout(timer);
    }
}

function isLikelyGarbageDetectedName(name) {
    const value = normalizeDetectedName(name || '');
    const lettersOnly = value.replace(/[^A-Za-z]/g, '');

    if (!value || lettersOnly.length < 5) {
        return false;
    }

    if (!/[AEIOUaeiou]/.test(lettersOnly)) {
        return true;
    }

    if (scoreDetectedName(value) < 1) {
        return true;
    }

    const singleLetterTokens = value.split(/\s+/).filter(function (token) {
        return /^[A-Za-z]$/.test(token);
    });

    return singleLetterTokens.length >= 3;
}
```

## 4. Update `runOcr`

Inside `runOcr`, after:

```js
const extracted = pipelineResult.extracted;
const combinedRawText = pipelineResult.rawText;
```

add:

```js
const originalDetectedName = extracted.name || '';
let nameCorrection = null;

try {
    const flagsForCorrection = getScannerFeatureFlags();
    nameCorrection = await resolveScannerNameCorrection(
        getScannerWorkerBase(),
        originalDetectedName,
        flagsForCorrection
    );

    if (nameCorrection?.autoApply && nameCorrection.name) {
        extracted.name = nameCorrection.name;
    } else if (!nameCorrection && isLikelyGarbageDetectedName(extracted.name)) {
        // Do not put obvious OCR garbage in the card name field.
        // Raw OCR remains visible in the raw OCR textarea.
        extracted.name = '';
    }
} catch (error) {
    console.warn('[PokeValutor Scanner] name correction unavailable', error);
}
```

Then update the detected event payload from:

```js
dispatchScannerEvent('pv:scanner:detected', {
    rawText: combinedRawText,
    name: extracted.name,
    number: extracted.number
});
```

to:

```js
dispatchScannerEvent('pv:scanner:detected', {
    rawText: combinedRawText,
    name: extracted.name,
    originalName: originalDetectedName,
    number: extracted.number,
    nameCorrection: nameCorrection
});
```

Optional status improvement:

After the current status message, add:

```js
if (nameCorrection?.autoApply && nameCorrection.name && nameCorrection.name !== originalDetectedName) {
    setStatus(elements, `Corrected detected name to ${nameCorrection.name}. Review it, then tap Find Possible Matches.`);
}
```

## 5. Enable only after backend is deployed

Option A: change the constant later:

```js
const PV_SCANNER_ENABLE_NAME_CORRECTION = true;
```

Option B: set a window override before `scanner.js` loads:

```html
<script>
  window.PV_SCANNER_ENABLE_NAME_CORRECTION = true;
</script>
```

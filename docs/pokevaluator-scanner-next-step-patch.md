# PokéValuator Scanner Next-Step Patch Notes

These snippets are intended for `scanner.js` on branch `scan-card-feature-implementation`.

## 1. Improve feature flags

Replace the current `getScannerFeatureFlags()` with this version:

```js
function readBooleanFlag(globalName, fallback) {
    const raw = window?.[globalName];

    if (raw == null || raw === '') {
        return !!fallback;
    }

    if (typeof raw === 'boolean') {
        return raw;
    }

    const normalized = String(raw).trim().toLowerCase();
    return normalized === '1'
        || normalized === 'true'
        || normalized === 'yes'
        || normalized === 'on';
}

function getScannerFeatureFlags() {
    return {
        enableVision: readBooleanFlag('PV_SCANNER_ENABLE_VISION', PV_SCANNER_ENABLE_VISION),
        enableOpenCvNormalize: readBooleanFlag('PV_SCANNER_ENABLE_OPENCV_NORMALIZE', PV_SCANNER_ENABLE_OPENCV_NORMALIZE),
        enableAdvancedOcrFallback: readBooleanFlag('PV_SCANNER_ENABLE_ADVANCED_OCR_FALLBACK', PV_SCANNER_ENABLE_ADVANCED_OCR_FALLBACK),
        visionEndpoint: String(window?.PV_SCANNER_VISION_ENDPOINT || PV_SCANNER_VISION_ENDPOINT || '').trim(),
        visionTimeoutMs: Number(window?.PV_SCANNER_VISION_TIMEOUT_MS || PV_SCANNER_VISION_TIMEOUT_MS) || PV_SCANNER_VISION_TIMEOUT_MS
    };
}
```

## 2. Make OpenCV normalization actually run when enabled

Replace the current `normalizeImage()` with this:

```js
async function normalizeImage(imageBlob, flags) {
    if (!imageBlob) {
        return imageBlob;
    }

    if (!flags?.enableOpenCvNormalize) {
        return imageBlob;
    }

    const normalized = await normalizeCardWithOpenCv(imageBlob);

    if (normalized) {
        return normalized;
    }

    return imageBlob;
}
```

## 3. Add image compression before vision calls

Add this helper near `blobToDataUrl()`:

```js
async function compressImageForVision(imageBlob, maxWidth, quality) {
    if (!imageBlob || !window.createImageBitmap) {
        return imageBlob;
    }

    let bitmap = null;

    try {
        bitmap = await window.createImageBitmap(imageBlob);

        const sourceWidth = Math.max(1, bitmap.width || 1);
        const sourceHeight = Math.max(1, bitmap.height || 1);
        const targetWidth = Math.min(sourceWidth, Math.max(320, Number(maxWidth || 900)));
        const scale = targetWidth / sourceWidth;
        const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(targetWidth);
        canvas.height = targetHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return imageBlob;
        }

        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

        return await new Promise(function (resolve) {
            canvas.toBlob(function (blob) {
                resolve(blob || imageBlob);
            }, 'image/jpeg', Math.max(0.5, Math.min(0.9, Number(quality || 0.78))));
        });
    } catch {
        return imageBlob;
    } finally {
        if (bitmap && typeof bitmap.close === 'function') {
            try {
                bitmap.close();
            } catch {
                // Ignore cleanup errors.
            }
        }
    }
}
```

## 4. Wire the frontend to the backend vision endpoint

Replace the current `extractWithVision()` stub with this:

```js
async function extractWithVision(imageBlob, flags) {
    if (!imageBlob || !flags?.enableVision || !flags?.visionEndpoint) {
        return null;
    }

    const controller = new AbortController();
    const timeoutMs = Math.max(2500, Number(flags.visionTimeoutMs || PV_SCANNER_VISION_TIMEOUT_MS));
    const timeoutId = window.setTimeout(function () {
        controller.abort();
    }, timeoutMs);

    try {
        const compressedBlob = await compressImageForVision(imageBlob, 900, 0.78);
        const imageDataUrl = await blobToDataUrl(compressedBlob);

        if (!imageDataUrl) {
            return null;
        }

        const response = await fetch(flags.visionEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                imageDataUrl: imageDataUrl
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            return null;
        }

        const data = await response.json();

        if (!data?.ok) {
            return null;
        }

        const name = normalizeDetectedName(data.name || data.cardName || '');
        const number = normalizeExtractedCardNumber(data.collectorNumber || data.cardNumber || data.number || '');
        const confidenceRaw = Number(data.confidence);
        const confidence = Number.isFinite(confidenceRaw)
            ? Math.max(0, Math.min(1, confidenceRaw))
            : null;

        return {
            name,
            number,
            confidence
        };
    } catch {
        return null;
    } finally {
        window.clearTimeout(timeoutId);
    }
}
```

## 5. Local/dev config example

Do not hard-code this in `scanner.js`. Put it in a local config file or page-level script during testing:

```js
window.PV_SCANNER_ENABLE_OPENCV_NORMALIZE = true;
window.PV_SCANNER_ENABLE_VISION = false;
window.PV_SCANNER_VISION_ENDPOINT = "https://YOUR_FUNCTION_URL/scanCard";
window.PV_SCANNER_VISION_TIMEOUT_MS = 9000;
```

Keep `PV_SCANNER_ENABLE_VISION = false` until the backend secret, CORS, rate limits, and usage caps are confirmed.

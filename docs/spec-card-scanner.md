# Spec-Driven Development: PokeValutor Card Scanner MVP

## Feature Name

Card Scanner MVP: Scan to Search

## Purpose

Add a safe first version of card scanning to PokeValutor without breaking the existing Cards search page.

The scanner should let users use their phone camera, capture a card image, run OCR, review/edit the detected card name and card number, and then trigger the existing card search flow.

## Current Site Context

PokeValutor currently has:

- Static frontend hosted on GitHub Pages.
- `search.html` for card search.
- Existing `search.js` handling card search, watchlist, sorting, condition filters, Dex/collection behavior, and quota UI.
- Firebase compat scripts loaded on the Cards page.
- A strict Content Security Policy.
- One primary search input: `#pv-search-query`.
- One primary search form: `#pv-search-form`.

Because `search.js` is already large and handles important behavior, the scanner must be isolated in new files.

## Design Rule

Do not directly modify `search.js` for Version 1.

Version 1 must only require:

1. A small mount point added to `search.html`.
2. A new `scanner.css` file.
3. A new `scanner.js` file.
4. A Tesseract.js import.
5. A CSP update to allow the OCR script/worker/language data.

## Goals

Version 1 should:

- Open the user's camera.
- Prefer the rear camera on mobile.
- Capture a still image.
- Run OCR on the captured image.
- Attempt to detect:
  - Card name
  - Card number
- Let the user review and edit detected fields.
- Fill the existing `#pv-search-query` input.
- Submit the existing `#pv-search-form`.
- Dispatch custom events for future version upgrades.

## Non-Goals for Version 1

Version 1 will not:

- Automatically add cards to the user's collection.
- Store scanned card images.
- Upload images to Firebase Storage.
- Use paid AI vision APIs.
- Train a custom card-recognition model.
- Detect exact holo/reverse holo variants.
- Guarantee perfect recognition.

The user must confirm the detected information before searching.

## User Flow

1. User opens Cards page.
2. User taps **Start Camera**.
3. Browser asks for camera permission.
4. User places card in frame.
5. User taps **Capture**.
6. Scanner runs OCR.
7. Scanner shows:
   - Detected card name
   - Detected card number
   - Raw OCR text
8. User edits fields if needed.
9. User taps **Search Detected Card**.
10. Existing PokeValutor search runs.

## Files to Add

```txt
scanner.js
scanner.css
docs/spec-card-scanner.md
```

## File to Lightly Update

```txt
search.html
```

## Version 1 Architecture

```txt
search.html
  ├── existing search form
  ├── scanner mount point
  ├── scanner.css
  ├── Tesseract.js CDN
  └── scanner.js

scanner.js
  ├── renders scanner UI into mount point
  ├── opens camera with getUserMedia
  ├── captures image with canvas
  ├── runs OCR with Tesseract.js
  ├── extracts likely card name/card number
  ├── fills #pv-search-query
  └── submits #pv-search-form
```

## Version 1 Acceptance Criteria

The feature is complete when:

- Cards page loads with no console errors.
- Existing search still works without using scanner.
- Existing watchlist/Dex behavior still works.
- Scanner panel appears above the search form.
- Start Camera opens the phone camera.
- Capture shows a card preview.
- OCR returns raw text or gracefully fails.
- Detected name/number fields can be edited.
- Search Detected Card fills the existing search field.
- Search Detected Card submits the existing search form.
- Camera tracks stop when user taps Stop Camera, Retake, Clear, or leaves page.
- If OCR library fails to load, user can still type detected fields manually.
- If browser camera is unsupported, user sees a helpful message.

## Version 1 Testing Checklist

### Desktop Browser

- Page loads without scanner errors.
- Existing manual search still works.
- Scanner panel renders.
- Start Camera either opens webcam or shows permission error.
- Clear Scanner resets scanner fields.

### Mobile Browser

- Start Camera opens camera.
- Rear camera is preferred.
- Capture creates preview.
- OCR starts after capture.
- Search Detected Card fills search field.
- Results appear using existing search flow.

### Regression Tests

Verify these existing features still work:

- Manual card search.
- Series dropdown.
- Set dropdown.
- Condition filter.
- Sort buttons.
- Watchlist.
- Load More.
- Account/Firebase scripts.
- Quota banner behavior.

## Known Limitations

OCR may struggle with:

- Foil glare.
- Sleeved cards.
- Small text.
- Angled photos.
- Dark cards.
- Japanese cards.
- Promo symbols.
- Reverse holo patterns.
- Cards inside top loaders.

This is expected for Version 1.

## Version 2 Plan: Scan to Collection

Version 2 should add a confirmation flow after search results load.

Possible Version 2 user flow:

```txt
Scan Card
↓
Search Detected Card
↓
User selects correct result
↓
User chooses condition, variant, and quantity
↓
Add to Collection
↓
Save to Firebase/local Dex collection
```

Version 2 should not rely only on OCR. It should use the scanner output to start the search, then let the user select the exact result.

## Version 2 Technical Notes

Add a custom event listener for:

```js
document.addEventListener('pv:scanner:search', function (event) {
  // Future hook for analytics, scan history, or scan-to-collection flow.
});
```

Potential Version 2 files:

```txt
scanner-results.js
scanner-collection-adapter.js
scanner-storage.js
```

Version 2 should connect to your existing collection/Dex logic instead of duplicating collection code.

## Version 3 Plan: AI Vision Scanner

Version 3 can improve accuracy by sending a compressed image to a Cloudflare Worker.

Possible flow:

```txt
Camera capture
↓
Compress image in browser
↓
Send to Cloudflare Worker
↓
Worker sends image to AI vision model
↓
AI extracts name, number, set, language, variant clues
↓
Worker searches card API
↓
Return top matches
↓
User confirms
```

Version 3 should include:

- Rate limiting through Upstash.
- API keys protected in Cloudflare.
- No client-side AI keys.
- Image size limit.
- Privacy copy explaining how scans are processed.
- Optional setting to avoid storing scan images.

## Implementation Order

1. Create branch from `dev`.
2. Add `docs/spec-card-scanner.md`.
3. Add `scanner.css`.
4. Add `scanner.js`.
5. Update `search.html` CSP.
6. Add scanner CSS import.
7. Add scanner mount point above the search form.
8. Add Tesseract.js script.
9. Add scanner.js script.
10. Test manual search first.
11. Test scanner on desktop.
12. Test scanner on phone.
13. Confirm no existing behavior broke.
14. Merge into `dev`.
15. After validation, merge `dev` into `main`.

## Rollback Plan

If scanner causes issues:

1. Remove the `scanner.css` import.
2. Remove the scanner mount point.
3. Remove the Tesseract.js script.
4. Remove the `scanner.js` script.
5. Restore the old CSP.
6. Keep `scanner.js` and `scanner.css` in the repo but unused until fixed.

Because Version 1 does not change `search.js`, rollback should be fast and low-risk.

---

# Version 1 Code

## 1. Create `scanner.css`

```css
/* PokeValutor Card Scanner MVP */
/* Isolated styles only. Does not modify search.js behavior. */

.pv-cardScanner {
  position: relative;
  margin: 0 0 1.5rem;
  padding: 1rem;
  border: 1px solid rgba(255, 203, 5, 0.28);
  border-radius: 18px;
  background:
    radial-gradient(circle at 12% 0%, rgba(255, 203, 5, 0.14), rgba(255, 203, 5, 0) 36%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0)),
    var(--pv-surface, #0a0a0a);
  box-shadow: 0 16px 34px rgba(0, 0, 0, 0.32);
  overflow: hidden;
}

.pv-cardScanner__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
}

.pv-cardScanner__title {
  margin: 0 0 0.25rem;
  color: var(--pv-primary, #ffcb05);
  font-family: var(--pv-heading-font, serif);
  font-size: clamp(1.25rem, 3vw, 1.65rem);
}

.pv-cardScanner__text {
  margin: 0;
  color: var(--pv-muted, #cbd5e1);
}

.pv-cardScanner__badge {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.22rem 0.6rem;
  border-radius: 999px;
  border: 1px solid rgba(255, 203, 5, 0.38);
  background: rgba(255, 203, 5, 0.13);
  color: var(--pv-primary, #ffcb05);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.pv-cardScanner__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  margin-bottom: 0.9rem;
}

.pv-cardScanner__cameraWrap {
  position: relative;
  min-height: 0;
  border: 1px dashed rgba(148, 163, 184, 0.45);
  border-radius: 16px;
  background: rgba(2, 6, 23, 0.42);
  overflow: hidden;
}

.pv-cardScanner__empty {
  padding: 1rem;
  color: var(--pv-muted, #cbd5e1);
  text-align: center;
}

.pv-cardScanner__video,
.pv-cardScanner__preview {
  display: block;
  width: 100%;
  max-height: 68vh;
  object-fit: contain;
  background: #050505;
}

.pv-cardScanner__frame {
  pointer-events: none;
  position: absolute;
  inset: 8%;
  border: 2px solid rgba(255, 203, 5, 0.72);
  border-radius: 18px;
  box-shadow:
    0 0 0 999px rgba(0, 0, 0, 0.22),
    0 0 24px rgba(255, 203, 5, 0.2);
}

.pv-cardScanner[data-state="idle"] .pv-cardScanner__frame,
.pv-cardScanner[data-state="stopped"] .pv-cardScanner__frame {
  display: none;
}

.pv-cardScanner__status {
  margin: 0.85rem 0;
  color: #ffffff;
}

.pv-cardScanner__review {
  display: grid;
  gap: 0.85rem;
  grid-template-columns: 1fr;
  margin-bottom: 0.9rem;
}

.pv-cardScanner__ocrField {
  grid-column: 1 / -1;
}

.pv-cardScanner textarea {
  resize: vertical;
}

.pv-cardScanner [hidden] {
  display: none !important;
}

@media (min-width: 768px) {
  .pv-cardScanner {
    padding: 1.15rem;
  }

  .pv-cardScanner__review {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 575.98px) {
  .pv-cardScanner__header {
    flex-direction: column;
  }

  .pv-cardScanner__actions .pv-button {
    width: 100%;
    text-align: center;
  }

  .pv-cardScanner__frame {
    inset: 6%;
  }
}
```

## 2. Create `scanner.js`

```js
/* PokeValutor Card Scanner MVP
   Version 1: Scan -> OCR -> Review -> Fill existing search -> Submit existing search

   Safe integration rule:
   - Do not modify search.js.
   - Do not save images.
   - Do not auto-add cards to collection.
   - Use custom events for future upgrades.

   Version 2 TODO:
   - Listen for pv:scanner:search or pv:scanner:detected.
   - After search results render, let user pick exact card result.
   - Then reuse existing Dex/collection logic to add card.
*/

(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', initCardScanner);

    const CARD_SCANNER_VERSION = 'scanner-mvp-2026-05-13-1';

    function initCardScanner() {
        const root = document.getElementById('pv-card-scanner-root');

        if (!root) {
            return;
        }

        const targetInputId = root.getAttribute('data-target-input') || 'pv-search-query';
        const targetFormId = root.getAttribute('data-target-form') || 'pv-search-form';

        root.innerHTML = buildScannerMarkup();

        const elements = getScannerElements(root);
        const state = {
            stream: null,
            capturedBlob: null,
            busy: false
        };

        bindScannerEvents({
            root,
            elements,
            state,
            targetInputId,
            targetFormId
        });

        setScannerState(root, 'idle');
        setStatus(elements, 'Tap Start Camera to scan a card. For best results, avoid glare and use a dark background.');

        dispatchScannerEvent('pv:scanner:ready', {
            version: CARD_SCANNER_VERSION
        });
    }

    function buildScannerMarkup() {
        return `
            <section class="pv-cardScanner" data-state="idle" aria-labelledby="pv-cardScanner-title">
                <div class="pv-cardScanner__header">
                    <div>
                        <h2 id="pv-cardScanner-title" class="pv-cardScanner__title">Scan Card</h2>
                        <p class="pv-cardScanner__text">
                            Use your phone camera to scan a card, review the detected text, then search for the best match.
                        </p>
                    </div>
                    <span class="pv-cardScanner__badge">Beta</span>
                </div>

                <div class="pv-cardScanner__actions" role="group" aria-label="Card scanner controls">
                    <button id="pv-cardScanner-start" class="pv-button pv-button--primary btn" type="button">Start Camera</button>
                    <button id="pv-cardScanner-capture" class="pv-button pv-button--secondary btn" type="button" hidden>Capture</button>
                    <button id="pv-cardScanner-retake" class="pv-button pv-button--secondary btn" type="button" hidden>Retake</button>
                    <button id="pv-cardScanner-stop" class="pv-button pv-button--secondary btn" type="button" hidden>Stop Camera</button>
                    <button id="pv-cardScanner-clear" class="pv-button pv-button--secondary btn" type="button">Clear Scanner</button>
                </div>

                <div class="pv-cardScanner__cameraWrap">
                    <div id="pv-cardScanner-empty" class="pv-cardScanner__empty">
                        Camera preview will appear here.
                    </div>
                    <video id="pv-cardScanner-video" class="pv-cardScanner__video" autoplay playsinline muted hidden></video>
                    <img id="pv-cardScanner-preview" class="pv-cardScanner__preview" alt="Captured card preview" hidden />
                    <canvas id="pv-cardScanner-canvas" hidden></canvas>
                    <div class="pv-cardScanner__frame" aria-hidden="true"></div>
                </div>

                <p id="pv-cardScanner-status" class="pv-cardScanner__status" role="status" aria-live="polite"></p>

                <div class="pv-cardScanner__review">
                    <div class="pv-form__field">
                        <label for="pv-cardScanner-name" class="form-label">Detected Card Name</label>
                        <input id="pv-cardScanner-name" class="form-control" type="text" placeholder="e.g., Charizard" autocomplete="off" />
                    </div>

                    <div class="pv-form__field">
                        <label for="pv-cardScanner-number" class="form-label">Detected Card Number</label>
                        <input id="pv-cardScanner-number" class="form-control" type="text" placeholder="e.g., 4/102 or SWSH101" autocomplete="off" />
                    </div>

                    <div class="pv-form__field pv-cardScanner__ocrField">
                        <label for="pv-cardScanner-ocr" class="form-label">Raw OCR Text</label>
                        <textarea id="pv-cardScanner-ocr" class="form-control" rows="4" placeholder="OCR text will appear here. You can review it if the scan is not accurate."></textarea>
                    </div>
                </div>

                <button id="pv-cardScanner-search" class="pv-button pv-button--primary btn" type="button">
                    Search Detected Card
                </button>
            </section>
        `;
    }

    function getScannerElements(root) {
        return {
            panel: root.querySelector('.pv-cardScanner'),
            startBtn: root.querySelector('#pv-cardScanner-start'),
            captureBtn: root.querySelector('#pv-cardScanner-capture'),
            retakeBtn: root.querySelector('#pv-cardScanner-retake'),
            stopBtn: root.querySelector('#pv-cardScanner-stop'),
            clearBtn: root.querySelector('#pv-cardScanner-clear'),
            searchBtn: root.querySelector('#pv-cardScanner-search'),
            empty: root.querySelector('#pv-cardScanner-empty'),
            video: root.querySelector('#pv-cardScanner-video'),
            canvas: root.querySelector('#pv-cardScanner-canvas'),
            preview: root.querySelector('#pv-cardScanner-preview'),
            status: root.querySelector('#pv-cardScanner-status'),
            detectedName: root.querySelector('#pv-cardScanner-name'),
            detectedNumber: root.querySelector('#pv-cardScanner-number'),
            rawOcr: root.querySelector('#pv-cardScanner-ocr')
        };
    }

    function bindScannerEvents(context) {
        const { root, elements, state, targetInputId, targetFormId } = context;

        if (elements.startBtn) {
            elements.startBtn.addEventListener('click', function () {
                startCamera(root, elements, state);
            });
        }

        if (elements.captureBtn) {
            elements.captureBtn.addEventListener('click', function () {
                captureCard(root, elements, state);
            });
        }

        if (elements.retakeBtn) {
            elements.retakeBtn.addEventListener('click', function () {
                startCamera(root, elements, state);
            });
        }

        if (elements.stopBtn) {
            elements.stopBtn.addEventListener('click', function () {
                stopCamera(elements, state);
                setScannerState(root, 'stopped');
                setStatus(elements, 'Camera stopped.');
            });
        }

        if (elements.clearBtn) {
            elements.clearBtn.addEventListener('click', function () {
                clearScanner(root, elements, state);
            });
        }

        if (elements.searchBtn) {
            elements.searchBtn.addEventListener('click', function () {
                fillAndSubmitSearch(elements, targetInputId, targetFormId);
            });
        }

        window.addEventListener('pagehide', function () {
            stopCamera(elements, state);
        });
    }

    async function startCamera(root, elements, state) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setStatus(elements, 'Camera scanning is not supported in this browser. Try Safari, Chrome, or Edge on your phone.');
            return;
        }

        try {
            setBusy(elements, state, true);
            setStatus(elements, 'Opening camera...');

            stopCamera(elements, state);
            resetDetectedFields(elements);

            state.stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            });

            if (!elements.video) {
                throw new Error('Scanner video element is missing.');
            }

            elements.video.srcObject = state.stream;
            await elements.video.play();

            if (elements.empty) elements.empty.hidden = true;
            if (elements.video) elements.video.hidden = false;
            if (elements.preview) {
                elements.preview.hidden = true;
                elements.preview.removeAttribute('src');
            }

            if (elements.captureBtn) elements.captureBtn.hidden = false;
            if (elements.stopBtn) elements.stopBtn.hidden = false;
            if (elements.retakeBtn) elements.retakeBtn.hidden = true;

            setScannerState(root, 'camera');
            setStatus(elements, 'Place the card inside the frame, reduce glare, then tap Capture.');
        } catch (error) {
            console.warn('[PokeValutor Scanner] camera error', error);
            setStatus(elements, 'Unable to open the camera. Check browser camera permissions and make sure the site is using HTTPS.');
            stopCamera(elements, state);
            setScannerState(root, 'stopped');
        } finally {
            setBusy(elements, state, false);
        }
    }

    async function captureCard(root, elements, state) {
        try {
            setBusy(elements, state, true);
            setStatus(elements, 'Capturing image...');

            state.capturedBlob = await captureFrame(elements);

            if (!state.capturedBlob) {
                throw new Error('Unable to capture image.');
            }

            const previewUrl = URL.createObjectURL(state.capturedBlob);

            if (elements.preview) {
                elements.preview.src = previewUrl;
                elements.preview.hidden = false;
            }

            if (elements.video) elements.video.hidden = true;
            if (elements.captureBtn) elements.captureBtn.hidden = true;
            if (elements.stopBtn) elements.stopBtn.hidden = true;
            if (elements.retakeBtn) elements.retakeBtn.hidden = false;

            stopCamera(elements, state);

            setScannerState(root, 'captured');
            setStatus(elements, 'Reading card text... This can take a few seconds.');

            await runOcr(elements, state.capturedBlob);
        } catch (error) {
            console.warn('[PokeValutor Scanner] capture error', error);
            setStatus(elements, 'Unable to capture/read the card. Try retaking the photo with better lighting.');
        } finally {
            setBusy(elements, state, false);
        }
    }

    function captureFrame(elements) {
        const video = elements.video;
        const canvas = elements.canvas;

        if (!video || !canvas) {
            return Promise.resolve(null);
        }

        const sourceWidth = video.videoWidth || 1280;
        const sourceHeight = video.videoHeight || 720;

        const crop = getCenteredCrop(sourceWidth, sourceHeight);

        canvas.width = crop.width;
        canvas.height = crop.height;

        const ctx = canvas.getContext('2d');

        if (!ctx) {
            return Promise.resolve(null);
        }

        ctx.drawImage(
            video,
            crop.x,
            crop.y,
            crop.width,
            crop.height,
            0,
            0,
            crop.width,
            crop.height
        );

        return new Promise(function (resolve) {
            canvas.toBlob(function (blob) {
                resolve(blob);
            }, 'image/jpeg', 0.88);
        });
    }

    function getCenteredCrop(width, height) {
        const cropWidth = Math.round(width * 0.86);
        const cropHeight = Math.round(height * 0.86);

        return {
            x: Math.round((width - cropWidth) / 2),
            y: Math.round((height - cropHeight) / 2),
            width: cropWidth,
            height: cropHeight
        };
    }

    async function runOcr(elements, imageBlob) {
        if (!window.Tesseract || typeof window.Tesseract.createWorker !== 'function') {
            setStatus(elements, 'OCR library did not load. You can still type the card name or number manually below.');
            return;
        }

        let worker = null;

        try {
            worker = await window.Tesseract.createWorker('eng', 1, {
                logger: function (message) {
                    if (!message || message.progress == null) return;

                    const progress = Math.round(Number(message.progress || 0) * 100);

                    if (message.status) {
                        setStatus(elements, `Reading card text... ${progress}%`);
                    }
                }
            });

            const result = await worker.recognize(imageBlob);
            const text = String(result?.data?.text || '').trim();

            if (elements.rawOcr) {
                elements.rawOcr.value = text;
            }

            const extracted = extractCardSearchParts(text);

            if (elements.detectedName) {
                elements.detectedName.value = extracted.name;
            }

            if (elements.detectedNumber) {
                elements.detectedNumber.value = extracted.number;
            }

            dispatchScannerEvent('pv:scanner:detected', {
                rawText: text,
                name: extracted.name,
                number: extracted.number
            });

            if (extracted.name || extracted.number) {
                setStatus(elements, 'Review the detected text, then tap Search Detected Card.');
            } else {
                setStatus(elements, 'I could not confidently detect the card. Try editing the fields or retaking the photo.');
            }
        } catch (error) {
            console.warn('[PokeValutor Scanner] OCR error', error);
            setStatus(elements, 'OCR could not read the image. Try retaking the photo or type the card name/number manually.');
        } finally {
            if (worker && typeof worker.terminate === 'function') {
                try {
                    await worker.terminate();
                } catch {
                    // Ignore cleanup errors.
                }
            }
        }
    }

    function extractCardSearchParts(rawText) {
        const originalText = String(rawText || '');

        const collapsedText = originalText
            .replace(/[|\]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const lines = originalText
            .split(/?
/)
            .map(function (line) {
                return line.trim();
            })
            .filter(Boolean);

        return {
            name: extractCardName(lines),
            number: extractCardNumber(collapsedText)
        };
    }

    function extractCardNumber(text) {
        const normalized = String(text || '').toUpperCase();

        const patterns = [
            /([A-Z]{0,4}\s?\d{1,3}\s?\/\s?[A-Z]{0,4}\d{1,3})/i,
            /(SWSH\s?\d{1,3})/i,
            /(SV\s?P\s?\d{1,3})/i,
            /(SVP\s?\d{1,3})/i,
            /(TG\s?\d{1,2}\s?\/\s?TG\s?\d{1,2})/i,
            /(GG\s?\d{1,2}\s?\/\s?GG\s?\d{1,2})/i
        ];

        for (const pattern of patterns) {
            const match = normalized.match(pattern);

            if (match && match[1]) {
                return match[1].replace(/\s+/g, '').toUpperCase();
            }
        }

        return '';
    }

    function extractCardName(lines) {
        const blockedWords = new Set([
            'pokemon',
            'pokémon',
            'basic',
            'stage',
            'trainer',
            'supporter',
            'item',
            'stadium',
            'energy',
            'evolves',
            'from',
            'weakness',
            'resistance',
            'retreat',
            'illustrator',
            'copyright',
            'nintendo',
            'creatures',
            'gamefreak',
            'game',
            'freak',
            'hp',
            'rule',
            'ability',
            'damage',
            'during',
            'opponent',
            'active',
            'bench'
        ]);

        for (const rawLine of lines.slice(0, 12)) {
            const cleaned = rawLine
                .replace(/[^A-Za-z0-9 .'-]/g, ' ')
                .replace(/\d{1,3}\s?HP/ig, '')
                .replace(/HP\s?\d{1,3}/ig, '')
                .replace(/\s+/g, ' ')
                .trim();

            if (!cleaned) continue;
            if (cleaned.length < 3 || cleaned.length > 34) continue;
            if (/^\d/.test(cleaned)) continue;
            if (/\d+\s?\/\s?\d+/.test(cleaned)) continue;
            if (/\d{2,3}$/.test(cleaned)) continue;

            const lowerWords = cleaned.toLowerCase().split(/\s+/);

            if (lowerWords.some(function (word) {
                return blockedWords.has(word);
            })) {
                continue;
            }

            return cleaned;
        }

        return '';
    }

    function fillAndSubmitSearch(elements, targetInputId, targetFormId) {
        const query = buildSearchQuery(elements);

        if (!query) {
            setStatus(elements, 'Enter or confirm a card name/card number first.');
            return;
        }

        const searchInput = document.getElementById(targetInputId);
        const searchForm = document.getElementById(targetFormId);

        if (!searchInput || !searchForm) {
            setStatus(elements, 'Search form was not found. Please refresh and try again.');
            return;
        }

        searchInput.value = query;
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));

        dispatchScannerEvent('pv:scanner:search', {
            query: query,
            name: elements.detectedName ? elements.detectedName.value.trim() : '',
            number: elements.detectedNumber ? elements.detectedNumber.value.trim() : ''
        });

        setStatus(elements, `Searching for: ${query}`);

        if (typeof searchForm.requestSubmit === 'function') {
            searchForm.requestSubmit();
        } else {
            searchForm.dispatchEvent(new Event('submit', {
                bubbles: true,
                cancelable: true
            }));
        }

        const results = document.getElementById('pv-search-results');

        if (results) {
            results.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    }

    function buildSearchQuery(elements) {
        const name = elements.detectedName ? elements.detectedName.value.trim() : '';
        const number = elements.detectedNumber ? elements.detectedNumber.value.trim() : '';

        return [name, number].filter(Boolean).join(' ').trim();
    }

    function clearScanner(root, elements, state) {
        stopCamera(elements, state);
        resetDetectedFields(elements);

        state.capturedBlob = null;

        if (elements.preview) {
            elements.preview.hidden = true;
            elements.preview.removeAttribute('src');
        }

        if (elements.empty) elements.empty.hidden = false;
        if (elements.captureBtn) elements.captureBtn.hidden = true;
        if (elements.retakeBtn) elements.retakeBtn.hidden = true;
        if (elements.stopBtn) elements.stopBtn.hidden = true;
        if (elements.video) elements.video.hidden = true;

        setScannerState(root, 'idle');
        setStatus(elements, 'Scanner cleared. Tap Start Camera when you are ready.');
    }

    function stopCamera(elements, state) {
        if (state.stream) {
            state.stream.getTracks().forEach(function (track) {
                track.stop();
            });

            state.stream = null;
        }

        if (elements.video) {
            elements.video.pause();
            elements.video.srcObject = null;
            elements.video.hidden = true;
        }

        if (elements.captureBtn) elements.captureBtn.hidden = true;
        if (elements.stopBtn) elements.stopBtn.hidden = true;
    }

    function resetDetectedFields(elements) {
        if (elements.detectedName) elements.detectedName.value = '';
        if (elements.detectedNumber) elements.detectedNumber.value = '';
        if (elements.rawOcr) elements.rawOcr.value = '';
    }

    function setBusy(elements, state, isBusy) {
        state.busy = !!isBusy;

        const buttons = [
            elements.startBtn,
            elements.captureBtn,
            elements.retakeBtn,
            elements.stopBtn,
            elements.clearBtn,
            elements.searchBtn
        ];

        buttons.forEach(function (button) {
            if (button) button.disabled = !!isBusy;
        });
    }

    function setScannerState(root, scannerState) {
        const panel = root.querySelector('.pv-cardScanner');

        if (panel) {
            panel.setAttribute('data-state', scannerState);
        }
    }

    function setStatus(elements, message) {
        if (elements.status) {
            elements.status.textContent = message || '';
        }
    }

    function dispatchScannerEvent(name, detail) {
        document.dispatchEvent(new CustomEvent(name, {
            bubbles: true,
            detail: detail || {}
        }));
    }
})();
```

## 3. Update `search.html`

### Add `scanner.css`

In the `<head>`, right after:

```html
<link rel="stylesheet" href="styles.css" />
```

add:

```html
<link rel="stylesheet" href="scanner.css" />
```

### Add the scanner mount point

Find:

```html
<section id="pv-search-section" class="pv-section container">
    <form id="pv-search-form" class="pv-form row g-3" role="search">
```

Change it to:

```html
<section id="pv-search-section" class="pv-section container">
    <div
        id="pv-card-scanner-root"
        data-target-input="pv-search-query"
        data-target-form="pv-search-form">
    </div>

    <form id="pv-search-form" class="pv-form row g-3" role="search">
```

### Add scanner scripts

Near the bottom, after:

```html
<script src="search.js?v=2026-05-12-11" defer></script>
```

add:

```html
<script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js" defer></script>
<script src="scanner.js?v=2026-05-13-1" defer></script>
```

## 4. Update the CSP in `search.html`

Replace the current CSP meta tag with:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' https://www.gstatic.com https://apis.google.com https://cdn.jsdelivr.net 'wasm-unsafe-eval'; worker-src 'self' blob: https://cdn.jsdelivr.net; child-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data: blob:; media-src 'self' blob:; connect-src 'self' https: https://www.googleapis.com https://*.googleapis.com https://cdn.jsdelivr.net https://tessdata.projectnaptha.com; frame-src https://*.firebaseapp.com https://accounts.google.com https://*.google.com; upgrade-insecure-requests" />
```

## Best Implementation Commands

```bash
git checkout dev
git pull
git checkout -b feature/card-scanner-mvp

mkdir -p docs

# Add:
# docs/spec-card-scanner.md
# scanner.css
# scanner.js
# update search.html

git add docs/spec-card-scanner.md scanner.css scanner.js search.html
git commit -m "Add card scanner MVP"
git push origin feature/card-scanner-mvp
```

Then open a PR into `dev`.

## Manual QA Before Merge

1. Load Cards page.
2. Confirm manual search still works.
3. Confirm series/set dropdowns still work.
4. Confirm watchlist still works.
5. Confirm scanner panel appears.
6. Test Start Camera.
7. Test Capture.
8. Test OCR result.
9. Test Search Detected Card.
10. Check mobile Safari/Chrome.
11. Check browser console for errors.

## Rollback

If anything breaks, remove the following from `search.html`:

```html
<link rel="stylesheet" href="scanner.css" />
```

```html
<div
    id="pv-card-scanner-root"
    data-target-input="pv-search-query"
    data-target-form="pv-search-form">
</div>
```

```html
<script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js" defer></script>
<script src="scanner.js?v=2026-05-13-1" defer></script>
```

Then restore the previous CSP.

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

    const CARD_SCANNER_VERSION = 'scanner-mvp-2026-06-29-2';
    const PV_SCANNER_QUERY_MODE = 'number-first';
    // Keep vision disabled by default to avoid third-party AI usage/cost.
    const PV_SCANNER_ENABLE_VISION = false;
    const PV_SCANNER_ENABLE_OPENCV_NORMALIZE = false;
    const PV_SCANNER_ENABLE_ADVANCED_OCR_FALLBACK = true;
    const PV_SCANNER_ENABLE_CANDIDATES = true;
    const PV_SCANNER_ENABLE_CATALOG_CANDIDATES = true;
    const PV_SCANNER_ENABLE_NAME_CORRECTION = false;
    const PV_SCANNER_NAME_CORRECTION_AUTO_SCORE = 0.88;
    const PV_SCANNER_NAME_CORRECTION_SUGGEST_SCORE = 0.70;
    const PV_SCANNER_NAME_CORRECTION_TIMEOUT_MS = 1200;
    const PV_SCANNER_CANDIDATES_CONSUME_QUOTA = false;
    const PV_SCANNER_CANDIDATE_HIGH_CONFIDENCE = 0.86;
    const PV_SCANNER_VISION_ENDPOINT = '';
    const PV_SCANNER_VISION_TIMEOUT_MS = 9000;
    const PV_SCANNER_OPENCV_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0/dist/opencv.js';
    const PV_SCANNER_OPENCV_READY_TIMEOUT_MS = 6000;

    const SCANNER_CANDIDATE_LIMIT = 5;
    const SCANNER_CANDIDATE_FETCH_LIMIT = 12;
    const SCANNER_HASH_SIZE = 16;
    const SCANNER_RANK_WEIGHT_NAME = 0.45;
    const SCANNER_RANK_WEIGHT_NUMBER = 0.25;
    const SCANNER_RANK_WEIGHT_IMAGE = 0.20;
    const SCANNER_RANK_WEIGHT_SET = 0.10;
    const scannerRequestCache = new Map();

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

    function readNumberFlag(globalName, fallback, min, max) {
        const raw = window?.[globalName];
        const value = Number(raw == null || raw === '' ? fallback : raw);

        if (!Number.isFinite(value)) {
            return Number(fallback) || 0;
        }

        const lo = Number.isFinite(Number(min)) ? Number(min) : value;
        const hi = Number.isFinite(Number(max)) ? Number(max) : value;

        return Math.max(lo, Math.min(hi, value));
    }

    function getScannerFeatureFlags() {
        return {
            enableVision: readBooleanFlag('PV_SCANNER_ENABLE_VISION', PV_SCANNER_ENABLE_VISION),
            enableOpenCvNormalize: readBooleanFlag('PV_SCANNER_ENABLE_OPENCV_NORMALIZE', PV_SCANNER_ENABLE_OPENCV_NORMALIZE),
            enableAdvancedOcrFallback: readBooleanFlag('PV_SCANNER_ENABLE_ADVANCED_OCR_FALLBACK', PV_SCANNER_ENABLE_ADVANCED_OCR_FALLBACK),
            enableCandidates: readBooleanFlag('PV_SCANNER_ENABLE_CANDIDATES', PV_SCANNER_ENABLE_CANDIDATES),
            enableCatalogCandidates: readBooleanFlag('PV_SCANNER_ENABLE_CATALOG_CANDIDATES', PV_SCANNER_ENABLE_CATALOG_CANDIDATES),
            enableNameCorrection: readBooleanFlag('PV_SCANNER_ENABLE_NAME_CORRECTION', PV_SCANNER_ENABLE_NAME_CORRECTION),
            nameCorrectionAutoScore: readNumberFlag('PV_SCANNER_NAME_CORRECTION_AUTO_SCORE', PV_SCANNER_NAME_CORRECTION_AUTO_SCORE, 0.70, 0.99),
            nameCorrectionSuggestScore: readNumberFlag('PV_SCANNER_NAME_CORRECTION_SUGGEST_SCORE', PV_SCANNER_NAME_CORRECTION_SUGGEST_SCORE, 0.40, 0.95),
            nameCorrectionTimeoutMs: readNumberFlag('PV_SCANNER_NAME_CORRECTION_TIMEOUT_MS', PV_SCANNER_NAME_CORRECTION_TIMEOUT_MS, 300, 2500),
            candidatesConsumeQuota: readBooleanFlag('PV_SCANNER_CANDIDATES_CONSUME_QUOTA', PV_SCANNER_CANDIDATES_CONSUME_QUOTA),
            candidateHighConfidence: readNumberFlag('PV_SCANNER_CANDIDATE_HIGH_CONFIDENCE', PV_SCANNER_CANDIDATE_HIGH_CONFIDENCE, 0.55, 0.99),
            visionEndpoint: String(window?.PV_SCANNER_VISION_ENDPOINT || PV_SCANNER_VISION_ENDPOINT || '').trim(),
            visionTimeoutMs: Number(window?.PV_SCANNER_VISION_TIMEOUT_MS || PV_SCANNER_VISION_TIMEOUT_MS) || PV_SCANNER_VISION_TIMEOUT_MS
        };
    }

    function isMobileScannerViewport() {
        return !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
    }

    function syncCaptureFab(elements, mode) {
        if (!elements.captureFabBtn) {
            return;
        }

        if (!isMobileScannerViewport()) {
            elements.captureFabBtn.hidden = true;
            return;
        }

        if (mode !== 'camera') {
            elements.captureFabBtn.hidden = true;
            return;
        }

        const captureLabel = elements.captureFabBtn.querySelector('.pv-cardScanner__captureLabel');

        elements.captureFabBtn.hidden = false;

        if (captureLabel) captureLabel.textContent = 'Capture';
        elements.captureFabBtn.setAttribute('aria-label', 'Capture card');
        elements.captureFabBtn.dataset.mode = 'capture';
    }

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
            previewUrl: '',
            busy: false,
            cameraSessionStarted: false
        };

        bindScannerEvents({
            root,
            elements,
            state,
            targetInputId,
            targetFormId
        });

        setScannerState(root, 'idle');
        syncSessionButtons(elements, state);
        syncCaptureFab(elements, 'idle');
        setStatus(elements, 'Tap Start Camera to scan a card. For best results, avoid glare and use a dark background.');

        dispatchScannerEvent('pv:scanner:ready', {
            version: CARD_SCANNER_VERSION
        });
    }

    function buildScannerMarkup() {
        return `
            <details class="pv-cardScannerShell" id="pv-cardScanner-shell">
                <summary class="pv-cardScannerShell__summary">
                    <span class="pv-cardScannerShell__summaryTitle">Scan a Card <span class="pv-cardScanner__badge">Beta</span></span>
                    <span class="pv-cardScannerShell__summaryAction">Open Scanner</span>
                </summary>

                <section class="pv-cardScanner" data-state="idle" aria-labelledby="pv-cardScanner-title">
                    <div class="pv-cardScanner__header">
                        <div>
                            <h2 id="pv-cardScanner-title" class="pv-cardScanner__title">Scan Card</h2>
                            <p class="pv-cardScanner__text">
                                Use your phone camera to scan a card, review the detected text, then search for the best match.
                            </p>
                        </div>
                    </div>

                    <div class="pv-cardScanner__actions" role="group" aria-label="Card scanner controls">
                        <button id="pv-cardScanner-start" class="pv-button pv-button--primary btn" type="button">Start Camera</button>
                        <button id="pv-cardScanner-capture" class="pv-button pv-button--secondary btn" type="button" hidden>Capture</button>
                        <button id="pv-cardScanner-retake" class="pv-button pv-button--secondary btn" type="button" hidden>Retake</button>
                        <button id="pv-cardScanner-find-candidates" class="pv-button pv-button--secondary btn" type="button" hidden>Find Possible Matches</button>
                        <button id="pv-cardScanner-search" class="pv-button pv-button--primary btn" type="button" hidden>Search Selected/Detected Card</button>
                        <button id="pv-cardScanner-stop" class="pv-button pv-button--secondary btn" type="button" hidden>Stop Camera</button>
                    </div>

                    <div class="pv-cardScanner__cameraWrap">
                        <div id="pv-cardScanner-empty" class="pv-cardScanner__empty">
                            Camera preview will appear here.
                        </div>
                        <video id="pv-cardScanner-video" class="pv-cardScanner__video" autoplay playsinline muted hidden></video>
                        <img id="pv-cardScanner-preview" class="pv-cardScanner__preview" alt="Captured card preview" hidden />
                        <canvas id="pv-cardScanner-canvas" hidden></canvas>
                        <div class="pv-cardScanner__frame" aria-hidden="true"></div>
                        <button id="pv-cardScanner-capture-fab" class="pv-cardScanner__captureFab btn" type="button" hidden aria-label="Capture card">
                            <svg class="pv-cardScanner__captureIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path d="M9 3 7.5 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.5L15 3H9Zm3 15a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z"></path>
                            </svg>
                            <span class="pv-cardScanner__captureLabel">Capture</span>
                        </button>
                    </div>

                    <p id="pv-cardScanner-status" class="pv-cardScanner__status" role="status" aria-live="polite"></p>

                    <div class="pv-cardScanner__review">
                        <div class="pv-form__field">
                            <label for="pv-cardScanner-name" class="form-label">Card Name</label>
                            <input id="pv-cardScanner-name" class="form-control" type="text" placeholder="e.g., Charizard" autocomplete="off" />
                        </div>

                        <div class="pv-form__field">
                            <label for="pv-cardScanner-number" class="form-label">Card Number</label>
                            <input id="pv-cardScanner-number" class="form-control" type="text" placeholder="e.g., 4/102 or SWSH101" autocomplete="off" />
                        </div>

                        <p class="pv-cardScanner__reviewHelp">Review and edit before searching.</p>

                        <details class="pv-form__field pv-cardScanner__ocrDetails pv-cardScanner__ocrField">
                            <summary class="pv-cardScanner__ocrSummary">Show raw OCR text</summary>
                            <div class="pv-cardScanner__ocrToolbar">
                                <button id="pv-cardScanner-copy-ocr" class="pv-button pv-button--secondary btn pv-cardScanner__ocrCopy" type="button">Copy Text</button>
                            </div>
                            <textarea id="pv-cardScanner-ocr" class="form-control" rows="4" placeholder="OCR text will appear here. You can review it if the scan is not accurate."></textarea>
                        </details>
                    </div>

                    <div id="pv-cardScanner-name-suggestion" class="pv-cardScanner__nameSuggestion" hidden>
                        <span>Catalog suggestion: <strong id="pv-cardScanner-name-suggestion-text"></strong></span>
                        <button id="pv-cardScanner-apply-name-suggestion" class="pv-button pv-button--secondary btn" type="button">Use Suggested Name</button>
                    </div>

                    <section id="pv-cardScanner-candidates" class="pv-cardScanner__candidates" hidden aria-live="polite">
                        <button id="pv-cardScanner-search-near-candidates" class="pv-button pv-button--primary btn pv-cardScanner__searchNearCandidates" type="button" hidden>Search Selected/Detected Card</button>
                        <h3 class="pv-cardScanner__candidatesTitle">Possible Matches</h3>
                        <p class="pv-cardScanner__candidatesText">Pick a candidate to replace detected fields before searching.</p>
                        <div id="pv-cardScanner-candidate-list" class="pv-cardScanner__candidateList"></div>
                    </section>

                    <p id="pv-cardScanner-selected" class="pv-cardScanner__selected" hidden>
                        Selected: <span id="pv-cardScanner-selected-text"></span>
                    </p>
                </section>
            </details>
        `;
    }

    function getScannerElements(root) {
        return {
            panel: root.querySelector('.pv-cardScanner'),
            startBtn: root.querySelector('#pv-cardScanner-start'),
            captureBtn: root.querySelector('#pv-cardScanner-capture'),
            retakeBtn: root.querySelector('#pv-cardScanner-retake'),
            stopBtn: root.querySelector('#pv-cardScanner-stop'),
            searchBtn: root.querySelector('#pv-cardScanner-search'),
            searchNearCandidatesBtn: root.querySelector('#pv-cardScanner-search-near-candidates'),
            findCandidatesBtn: root.querySelector('#pv-cardScanner-find-candidates'),
            empty: root.querySelector('#pv-cardScanner-empty'),
            video: root.querySelector('#pv-cardScanner-video'),
            canvas: root.querySelector('#pv-cardScanner-canvas'),
            preview: root.querySelector('#pv-cardScanner-preview'),
            captureFabBtn: root.querySelector('#pv-cardScanner-capture-fab'),
            status: root.querySelector('#pv-cardScanner-status'),
            detectedName: root.querySelector('#pv-cardScanner-name'),
            detectedNumber: root.querySelector('#pv-cardScanner-number'),
            rawOcr: root.querySelector('#pv-cardScanner-ocr'),
            copyOcrBtn: root.querySelector('#pv-cardScanner-copy-ocr'),
            nameSuggestionWrap: root.querySelector('#pv-cardScanner-name-suggestion'),
            nameSuggestionText: root.querySelector('#pv-cardScanner-name-suggestion-text'),
            applyNameSuggestionBtn: root.querySelector('#pv-cardScanner-apply-name-suggestion'),
            candidateWrap: root.querySelector('#pv-cardScanner-candidates'),
            candidateList: root.querySelector('#pv-cardScanner-candidate-list'),
            selectedWrap: root.querySelector('#pv-cardScanner-selected'),
            selectedText: root.querySelector('#pv-cardScanner-selected-text')
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
        if (elements.captureFabBtn) {
            elements.captureFabBtn.addEventListener('click', function () {
                if (state.stream) {
                    captureCard(root, elements, state);
                    return;
                }

                startCamera(root, elements, state);
            });
        }

        if (elements.retakeBtn) {
            elements.retakeBtn.addEventListener('click', function () {
                startCamera(root, elements, state);
            });
        }

        if (elements.stopBtn) {
            elements.stopBtn.addEventListener('click', function () {
                stopScannerSession(root, elements, state);
            });
        }

        if (elements.searchBtn) {
            elements.searchBtn.addEventListener('click', function () {
                fillAndSubmitSearch(elements, targetInputId, targetFormId);
            });
        }

        if (elements.searchNearCandidatesBtn) {
            elements.searchNearCandidatesBtn.addEventListener('click', function () {
                fillAndSubmitSearch(elements, targetInputId, targetFormId);
            });
        }

        if (elements.findCandidatesBtn) {
            elements.findCandidatesBtn.addEventListener('click', function () {
                if (!state.capturedBlob) {
                    setStatus(elements, 'Capture a card first, then find possible matches.');
                    return;
                }

                const extracted = {
                    name: elements.detectedName ? elements.detectedName.value.trim() : '',
                    number: elements.detectedNumber ? elements.detectedNumber.value.trim() : ''
                };

                const flags = getScannerFeatureFlags();
                refreshCandidateSuggestions(elements, state.capturedBlob, extracted, flags);
            });
        }

        if (elements.applyNameSuggestionBtn) {
            elements.applyNameSuggestionBtn.addEventListener('click', function () {
                const suggestedName = String(elements.nameSuggestionWrap?.dataset?.suggestedName || '').trim();
                if (!suggestedName || !elements.detectedName) return;

                elements.detectedName.value = suggestedName;
                clearNameSuggestion(elements);
                setStatus(elements, `Using catalog name ${suggestedName}. Tap Find Possible Matches to identify the exact card.`);
            });
        }

        if (elements.detectedName) {
            elements.detectedName.addEventListener('input', function () {
                clearNameSuggestion(elements);
                clearSelectedCandidateDisplay(elements);
            });
        }

        if (elements.detectedNumber) {
            elements.detectedNumber.addEventListener('input', function () {
                clearSelectedCandidateDisplay(elements);
            });
        }

        if (elements.copyOcrBtn) {
            elements.copyOcrBtn.addEventListener('click', function () {
                copyRawOcrText(elements);
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
            clearCandidateSuggestions(elements);

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
                revokePreviewUrl(state);
                elements.preview.hidden = true;
                elements.preview.removeAttribute('src');
            }

            if (elements.captureBtn) elements.captureBtn.hidden = false;
            if (elements.stopBtn) elements.stopBtn.hidden = false;
            if (elements.retakeBtn) elements.retakeBtn.hidden = true;
            state.capturedBlob = null;
            state.cameraSessionStarted = true;
            syncSessionButtons(elements, state);
            syncCaptureFab(elements, 'camera');

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
            revokePreviewUrl(state);
            state.previewUrl = previewUrl;

            if (elements.preview) {
                elements.preview.src = previewUrl;
                elements.preview.hidden = false;
            }

            stopCamera(elements, state);

            if (elements.video) elements.video.hidden = true;
            if (elements.captureBtn) elements.captureBtn.hidden = true;
            if (elements.stopBtn) elements.stopBtn.hidden = false;
            if (elements.retakeBtn) elements.retakeBtn.hidden = false;
            syncCaptureFab(elements, 'idle');
            syncSessionButtons(elements, state);

            setScannerState(root, 'captured');
            setStatus(elements, 'Reading card text... This can take a few seconds.');

            await runOcr(elements, state.capturedBlob, state);
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
        const isCompactViewport = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
        const targetRatio = isCompactViewport ? 5 / 8 : 5 / 7;
        const cropScale = isCompactViewport ? 1 : 0.84;
        const maxWidth = Math.round(width * cropScale);
        const maxHeight = Math.round(height * cropScale);

        let cropWidth = maxWidth;
        let cropHeight = Math.round(cropWidth / targetRatio);

        if (cropHeight > maxHeight) {
            cropHeight = maxHeight;
            cropWidth = Math.round(cropHeight * targetRatio);
        }

        return {
            x: Math.round((width - cropWidth) / 2),
            y: Math.round((height - cropHeight) / 2),
            width: cropWidth,
            height: cropHeight
        };
    }

    async function runOcr(elements, imageBlob, state) {
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

            if (typeof worker.setParameters === 'function') {
                await worker.setParameters({
                    tessedit_pageseg_mode: '6',
                    preserve_interword_spaces: '1'
                });
            }

            const flags = getScannerFeatureFlags();
            const pipelineResult = await executeDetectionPipeline({
                worker,
                imageBlob,
                elements,
                flags
            });

            const extracted = pipelineResult.extracted;
            const combinedRawText = pipelineResult.rawText;
            const originalDetectedName = extracted.name || '';
            let nameCorrection = null;
            let catalogNumberAssist = null;
            let rejectedUnverifiedName = false;

            try {
                nameCorrection = await resolveScannerNameCorrection(
                    getScannerWorkerBase(),
                    originalDetectedName,
                    flags,
                    combinedRawText
                );

                if (nameCorrection?.autoApply && nameCorrection.name) {
                    extracted.name = nameCorrection.name;
                } else if (
                    flags.enableNameCorrection
                    && !nameCorrection
                    && (
                        isLikelyGarbageDetectedName(extracted.name)
                        || isUnverifiedWeakDetectedName(extracted.name, extracted.number)
                    )
                ) {
                    // Do not present a short/noisy OCR token as a confident card
                    // name when neither the catalog nor a collector number supports it.
                    rejectedUnverifiedName = Boolean(extracted.name);
                    extracted.name = '';
                }
            } catch (error) {
                console.warn('[PokeValutor Scanner] name correction unavailable', error);
            }

            try {
                catalogNumberAssist = await tryAutoFillCollectorNumberFromCatalog(extracted, flags);
                if (catalogNumberAssist?.filled && catalogNumberAssist.number) {
                    extracted.number = catalogNumberAssist.number;
                }
            } catch (error) {
                console.warn('[PokeValutor Scanner] catalog number assist unavailable', error);
            }

            if (elements.rawOcr) {
                elements.rawOcr.value = combinedRawText;
            }

            if (elements.detectedName) {
                elements.detectedName.value = extracted.name;
            }

            if (elements.detectedNumber) {
                elements.detectedNumber.value = extracted.number;
            }

            clearNameSuggestion(elements);

            if (
                nameCorrection?.suggestOnly
                && nameCorrection.name
            ) {
                showNameSuggestion(elements, nameCorrection.name);
            }

            dispatchScannerEvent('pv:scanner:detected', {
                rawText: combinedRawText,
                name: extracted.name,
                originalName: originalDetectedName,
                number: extracted.number,
                nameCorrection: nameCorrection,
                catalogNumberAssist: catalogNumberAssist
            });

            if (extracted.name || extracted.number) {
                if (elements.findCandidatesBtn) {
                    elements.findCandidatesBtn.hidden = false;
                }
                if (elements.searchBtn) {
                    elements.searchBtn.hidden = false;
                }
                if (elements.searchNearCandidatesBtn) {
                    elements.searchNearCandidatesBtn.hidden = false;
                }

                setStatus(elements, 'Review detected text. Tap Find Possible Matches, then Search Detected Card.');

                if (
                    nameCorrection?.autoApply
                    && nameCorrection.name
                    && nameCorrection.name !== originalDetectedName
                    && catalogNumberAssist?.filled
                    && catalogNumberAssist.number
                ) {
                    setStatus(elements, `Corrected name to ${nameCorrection.name} and filled number ${catalogNumberAssist.number} from catalog. Review, then tap Find Possible Matches.`);
                } else if (nameCorrection?.autoApply && nameCorrection.name && nameCorrection.name !== originalDetectedName) {
                    setStatus(elements, `Corrected detected name to ${nameCorrection.name}. Review it, then tap Find Possible Matches.`);
                } else if (catalogNumberAssist?.filled && catalogNumberAssist.number) {
                    setStatus(elements, `Filled collector number ${catalogNumberAssist.number} from catalog. Review detected text, then tap Find Possible Matches.`);
                } else if (nameCorrection?.suggestOnly && nameCorrection.name) {
                    setStatus(elements, `OCR may be incorrect. Review the catalog suggestion ${nameCorrection.name} below.`);
                }
            } else {
                clearCandidateSuggestions(elements);
                clearSelectedCandidateDisplay(elements);

                if (elements.findCandidatesBtn) {
                    elements.findCandidatesBtn.hidden = true;
                }
                if (elements.searchBtn) {
                    elements.searchBtn.hidden = true;
                }
                if (elements.searchNearCandidatesBtn) {
                    elements.searchNearCandidatesBtn.hidden = true;
                }

                setStatus(elements, rejectedUnverifiedName
                    ? `I rejected the weak OCR name “${originalDetectedName}” because no card match or number supported it. Retake the photo or type the name.`
                    : 'I could not confidently detect the card. Try editing the fields or retaking the photo.');
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

    async function executeDetectionPipeline(context) {
        const { worker, imageBlob, elements, flags } = context;
        const normalizedImage = await normalizeImage(imageBlob, flags);
        const visionResult = await extractWithVision(normalizedImage, flags);
        const ocrResult = await extractWithOcrFallback(worker, normalizedImage || imageBlob, elements, flags);
        const merged = mergeAndValidateDetections(visionResult, ocrResult);

        return {
            extracted: {
                name: merged.name || '',
                number: merged.number || ''
            },
            rawText: ocrResult.rawText || ''
        };
    }

    async function normalizeImage(imageBlob, flags) {
        if (!imageBlob) {
            return imageBlob;
        }

        if (!flags?.enableOpenCvNormalize) {
            return imageBlob;
        }

        const normalized = await normalizeCardWithOpenCv(imageBlob);

        return normalized || imageBlob;
    }

    async function ensureOpenCvAvailable() {
        if (window.cv && typeof window.cv.Mat === 'function') {
            return true;
        }

        if (window.__pvOpenCvLoadPromise) {
            return window.__pvOpenCvLoadPromise;
        }

        window.__pvOpenCvLoadPromise = new Promise(function (resolve) {
            let settled = false;

            function done(value) {
                if (settled) {
                    return;
                }

                settled = true;
                resolve(!!value);
            }

            function wireRuntimeReady() {
                if (!window.cv || typeof window.cv !== 'object') {
                    done(false);
                    return;
                }

                if (typeof window.cv.Mat === 'function') {
                    done(true);
                    return;
                }

                const previous = window.cv.onRuntimeInitialized;
                window.cv.onRuntimeInitialized = function () {
                    if (typeof previous === 'function') {
                        try {
                            previous();
                        } catch {
                            // Ignore callback errors.
                        }
                    }

                    done(window.cv && typeof window.cv.Mat === 'function');
                };

                window.setTimeout(function () {
                    done(window.cv && typeof window.cv.Mat === 'function');
                }, PV_SCANNER_OPENCV_READY_TIMEOUT_MS);
            }

            const existing = document.getElementById('pv-opencv-script');

            if (existing) {
                wireRuntimeReady();
                return;
            }

            const script = document.createElement('script');
            script.id = 'pv-opencv-script';
            script.async = true;
            script.src = PV_SCANNER_OPENCV_SCRIPT_URL;

            script.onload = function () {
                if (window.cv && typeof window.cv.Mat === 'function') {
                    done(true);
                    return;
                }

                wireRuntimeReady();
            };

            script.onerror = function () {
                done(false);
            };

            document.head.appendChild(script);
        });

        return window.__pvOpenCvLoadPromise;
    }

    async function normalizeCardWithOpenCv(imageBlob) {
        if (!imageBlob || !window.createImageBitmap) {
            return null;
        }

        const hasOpenCv = await ensureOpenCvAvailable();

        if (!hasOpenCv || !window.cv) {
            return null;
        }

        const cv = window.cv;
        let bitmap = null;

        let src = null;
        let gray = null;
        let blur = null;
        let edges = null;
        let contours = null;
        let hierarchy = null;
        let srcTri = null;
        let dstTri = null;
        let matrix = null;
        let dst = null;

        try {
            bitmap = await window.createImageBitmap(imageBlob);
            const inputCanvas = document.createElement('canvas');
            inputCanvas.width = bitmap.width;
            inputCanvas.height = bitmap.height;

            const inputCtx = inputCanvas.getContext('2d');

            if (!inputCtx) {
                return null;
            }

            inputCtx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);

            src = cv.imread(inputCanvas);
            gray = new cv.Mat();
            blur = new cv.Mat();
            edges = new cv.Mat();
            contours = new cv.MatVector();
            hierarchy = new cv.Mat();

            cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
            cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
            cv.Canny(blur, edges, 60, 160, 3, false);
            cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

            let bestArea = 0;
            let bestQuad = null;

            for (let i = 0; i < contours.size(); i += 1) {
                const cnt = contours.get(i);
                const peri = cv.arcLength(cnt, true);
                const approx = new cv.Mat();
                cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

                const area = cv.contourArea(approx);

                if (approx.rows === 4 && area > bestArea) {
                    const quad = [];

                    for (let j = 0; j < 4; j += 1) {
                        const point = approx.intPtr(j, 0);
                        quad.push({ x: point[0], y: point[1] });
                    }

                    bestArea = area;
                    bestQuad = quad;
                }

                approx.delete();
                cnt.delete();
            }

            if (!bestQuad || bestArea < (src.rows * src.cols) * 0.1) {
                return null;
            }

            const ordered = orderQuadPoints(bestQuad);

            const widthA = distanceBetween(ordered.br, ordered.bl);
            const widthB = distanceBetween(ordered.tr, ordered.tl);
            const heightA = distanceBetween(ordered.tr, ordered.br);
            const heightB = distanceBetween(ordered.tl, ordered.bl);

            let targetWidth = Math.max(1, Math.round(Math.max(widthA, widthB)));
            let targetHeight = Math.max(1, Math.round(Math.max(heightA, heightB)));

            const targetRatio = 5 / 7;
            if (targetWidth / targetHeight > targetRatio) {
                targetWidth = Math.max(1, Math.round(targetHeight * targetRatio));
            } else {
                targetHeight = Math.max(1, Math.round(targetWidth / targetRatio));
            }

            srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
                ordered.tl.x, ordered.tl.y,
                ordered.tr.x, ordered.tr.y,
                ordered.br.x, ordered.br.y,
                ordered.bl.x, ordered.bl.y
            ]);

            dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
                0, 0,
                targetWidth - 1, 0,
                targetWidth - 1, targetHeight - 1,
                0, targetHeight - 1
            ]);

            matrix = cv.getPerspectiveTransform(srcTri, dstTri);
            dst = new cv.Mat();

            cv.warpPerspective(
                src,
                dst,
                matrix,
                new cv.Size(targetWidth, targetHeight),
                cv.INTER_LINEAR,
                cv.BORDER_REPLICATE,
                new cv.Scalar()
            );

            const outputCanvas = document.createElement('canvas');
            outputCanvas.width = targetWidth;
            outputCanvas.height = targetHeight;
            cv.imshow(outputCanvas, dst);

            return await new Promise(function (resolve) {
                outputCanvas.toBlob(function (blob) {
                    resolve(blob || null);
                }, 'image/jpeg', 0.92);
            });
        } catch (error) {
            console.warn('[PokeValutor Scanner] OpenCV normalize error', error);
            return null;
        } finally {
            if (bitmap && typeof bitmap.close === 'function') {
                try {
                    bitmap.close();
                } catch {
                    // Ignore cleanup errors.
                }
            }

            if (dst) dst.delete();
            if (matrix) matrix.delete();
            if (dstTri) dstTri.delete();
            if (srcTri) srcTri.delete();
            if (hierarchy) hierarchy.delete();
            if (contours) contours.delete();
            if (edges) edges.delete();
            if (blur) blur.delete();
            if (gray) gray.delete();
            if (src) src.delete();
        }
    }

    function orderQuadPoints(points) {
        const withScores = points.map(function (p) {
            return {
                x: p.x,
                y: p.y,
                sum: p.x + p.y,
                diff: p.x - p.y
            };
        });

        const tl = withScores.reduce(function (best, cur) {
            return cur.sum < best.sum ? cur : best;
        }, withScores[0]);

        const br = withScores.reduce(function (best, cur) {
            return cur.sum > best.sum ? cur : best;
        }, withScores[0]);

        const tr = withScores.reduce(function (best, cur) {
            return cur.diff > best.diff ? cur : best;
        }, withScores[0]);

        const bl = withScores.reduce(function (best, cur) {
            return cur.diff < best.diff ? cur : best;
        }, withScores[0]);

        return {
            tl: { x: tl.x, y: tl.y },
            tr: { x: tr.x, y: tr.y },
            br: { x: br.x, y: br.y },
            bl: { x: bl.x, y: bl.y }
        };
    }

    function distanceBetween(a, b) {
        const dx = Number(a?.x || 0) - Number(b?.x || 0);
        const dy = Number(a?.y || 0) - Number(b?.y || 0);
        return Math.sqrt((dx * dx) + (dy * dy));
    }

    async function extractWithVision(imageBlob, flags) {
        if (!imageBlob || !flags?.enableVision || !flags?.visionEndpoint) {
            return null;
        }

        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timeoutMs = Math.max(2500, Number(flags.visionTimeoutMs || PV_SCANNER_VISION_TIMEOUT_MS));
        const timeoutId = window.setTimeout(function () {
            if (controller) {
                try {
                    controller.abort();
                } catch {
                    // Ignore abort errors.
                }
            }
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
                signal: controller ? controller.signal : undefined
            });

            if (!response.ok) {
                return null;
            }

            const data = await response.json().catch(function () {
                return null;
            });

            if (!data || data.ok === false) {
                return null;
            }

            const name = normalizeDetectedName(data.name || data.cardName || '');
            const number = normalizeExtractedCardNumber(data.collectorNumber || data.cardNumber || data.number || '');
            const confidenceRaw = Number(data.confidence);
            const confidence = Number.isFinite(confidenceRaw)
                ? Math.max(0, Math.min(1, confidenceRaw))
                : null;

            return {
                name: name,
                number: number,
                confidence: confidence
            };
        } catch {
            return null;
        } finally {
            window.clearTimeout(timeoutId);
        }
    }

    function mergeAndValidateDetections(visionResult, ocrResult) {
        const safeOcr = ocrResult || { name: '', number: '' };

        if (!visionResult) {
            return {
                name: safeOcr.name || '',
                number: safeOcr.number || ''
            };
        }

        if (visionResult.confidence != null && visionResult.confidence < 0.45) {
            return {
                name: safeOcr.name || '',
                number: safeOcr.number || ''
            };
        }

        let mergedName = visionResult.name || safeOcr.name || '';
        let mergedNumber = visionResult.number || safeOcr.number || '';

        if (mergedName && scoreDetectedName(mergedName) < 1) {
            mergedName = safeOcr.name || '';
        }

        if (!isPlausibleDetectedNumber(mergedNumber)) {
            mergedNumber = safeOcr.number || '';
        }

        return {
            name: mergedName,
            number: mergedNumber
        };
    }

    function blobToDataUrl(blob) {
        return new Promise(function (resolve, reject) {
            if (!blob) {
                resolve('');
                return;
            }

            const reader = new FileReader();
            reader.onload = function () {
                resolve(String(reader.result || ''));
            };
            reader.onerror = function () {
                reject(reader.error || new Error('Failed to read blob.'));
            };
            reader.readAsDataURL(blob);
        });
    }

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

    async function refreshCandidateSuggestions(elements, capturedBlob, extracted, flags) {
        if (!elements || !elements.candidateWrap || !elements.candidateList) {
            return;
        }

        clearCandidateSuggestions(elements);

        if (!flags?.enableCandidates) {
            return;
        }

        const detectedName = normalizeDetectedName(extracted?.name || '');
        const detectedNumber = normalizeExtractedCardNumber(extracted?.number || '');

        if (!detectedName && !detectedNumber) {
            return;
        }

        try {
            setStatus(elements, 'Finding likely card matches...');

            clearScannerRequestQueryCache();

            const candidates = await fetchScannerCandidates({
                name: detectedName,
                number: detectedNumber,
                setId: getSelectedSetId()
            }, flags);

            if (!candidates.length) {
                setStatus(elements, 'No close candidate matches found. You can still edit fields and search.');
                return;
            }

            const ranked = await rankScannerCandidates(capturedBlob, candidates, {
                name: detectedName,
                number: detectedNumber,
                setId: getSelectedSetId()
            });

            if (!ranked.length) {
                return;
            }

            const top = ranked[0];
            const threshold = Number(flags?.candidateHighConfidence || PV_SCANNER_CANDIDATE_HIGH_CONFIDENCE);
            const highConfidence = !!top && Number(top.score || 0) >= threshold;
            const recommendedId = top ? String(top.card?.id || '') : '';

            renderCandidateSuggestions(elements, ranked.slice(0, SCANNER_CANDIDATE_LIMIT), {
                recommendedId: recommendedId,
                highConfidence: highConfidence,
                fallbackNumber: detectedNumber
            });

            if (highConfidence && top?.card) {
                applyCandidateSelection(elements, top.card, top.score, true, detectedNumber);
            } else {
                setStatus(elements, 'Low confidence match. Pick one of the possible matches before searching.');
            }
        } catch (error) {
            console.warn('[PokeValutor Scanner] candidate lookup error', error);
            setStatus(elements, 'Candidate suggestions are unavailable right now. You can still search manually.');
        }
    }

    function clearScannerRequestQueryCache() {
        for (const key of Array.from(scannerRequestCache.keys())) {
            if (typeof key !== 'string') {
                continue;
            }

            if (key.indexOf('/scanner/candidates?') >= 0 || key.indexOf('/cards/search?') >= 0) {
                scannerRequestCache.delete(key);
            }
        }
    }

    function clearCandidateSuggestions(elements) {
        if (elements?.candidateList) {
            elements.candidateList.innerHTML = '';
        }

        if (elements?.candidateWrap) {
            elements.candidateWrap.hidden = true;
        }
    }

    function showSelectedCandidate(elements, candidate, number) {
        if (!elements?.selectedWrap || !elements?.selectedText) {
            return;
        }

        const name = getCandidateCardName(candidate) || '';
        const setName = getCandidateSetName(candidate) || '';
        const displayNumber = String(number || '').trim();
        const value = [name, setName, displayNumber].filter(Boolean).join(' · ');

        if (!value) {
            clearSelectedCandidateDisplay(elements);
            return;
        }

        elements.selectedText.textContent = value;
        elements.selectedWrap.hidden = false;
    }

    function clearSelectedCandidateDisplay(elements) {
        if (elements?.selectedWrap) {
            elements.selectedWrap.hidden = true;
        }
        if (elements?.selectedText) {
            elements.selectedText.textContent = '';
        }
    }

    async function copyRawOcrText(elements) {
        const text = String(elements?.rawOcr?.value || '').trim();

        if (!text) {
            setStatus(elements, 'There is no raw OCR text to copy yet.');
            return;
        }

        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(text);
            } else if (elements?.rawOcr) {
                elements.rawOcr.focus();
                elements.rawOcr.select();
                const copied = document.execCommand('copy');
                elements.rawOcr.setSelectionRange(0, 0);
                if (!copied) {
                    throw new Error('copy_failed');
                }
            }

            setStatus(elements, 'Raw OCR text copied to clipboard.');
        } catch (error) {
            console.warn('[PokeValutor Scanner] copy OCR failed', error);
            setStatus(elements, 'Could not copy automatically. You can still select the OCR text and copy it manually.');
        }
    }

    function markSelectedCandidate(elements, candidateId) {
        if (!elements?.candidateList) {
            return;
        }

        const selectedId = String(candidateId || '').trim();
        const buttons = Array.from(elements.candidateList.querySelectorAll('.pv-cardScanner__candidate'));

        buttons.forEach(function (button) {
            const isMatch = selectedId && String(button.getAttribute('data-candidate-id') || '') === selectedId;
            button.classList.toggle('is-selected', !!isMatch);
            button.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
        });
    }

    function renderCandidateSuggestions(elements, ranked, options) {
        if (!elements?.candidateWrap || !elements?.candidateList) {
            return;
        }

        const recommendedId = String(options?.recommendedId || '');
        const highConfidence = !!options?.highConfidence;

        elements.candidateList.innerHTML = '';

        ranked.forEach(function (entry) {
            const candidate = entry.card;
            const candidateId = String(candidate?.id || '');
            const fallbackNumber = String(options?.fallbackNumber || '').trim();
            const displayNumber = getBestCandidateSearchNumber(candidate, fallbackNumber);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'pv-cardScanner__candidate';
            button.setAttribute('data-candidate-id', candidateId);
            button.setAttribute('aria-pressed', 'false');
            if (displayNumber) {
                button.setAttribute('data-display-number', displayNumber);
            }

            if (recommendedId && candidateId && candidateId === recommendedId) {
                button.classList.add('is-recommended');
            }

            const image = document.createElement('img');
            image.className = 'pv-cardScanner__candidateImage';
            image.alt = `${getCandidateCardName(candidate)} card image`;
            image.loading = 'lazy';

            const imageUrl = pickCandidateImageUrl(candidate);
            if (imageUrl) {
                image.src = imageUrl;
            } else {
                image.hidden = true;
            }

            const content = document.createElement('div');
            content.className = 'pv-cardScanner__candidateContent';

            const title = document.createElement('div');
            title.className = 'pv-cardScanner__candidateTitle';
            title.textContent = getCandidateCardName(candidate) || 'Unknown card';

            if (recommendedId && candidateId && candidateId === recommendedId) {
                const badge = document.createElement('span');
                badge.className = 'pv-cardScanner__candidateBadge';
                badge.textContent = highConfidence ? 'Top Match' : 'Best Match';
                title.appendChild(document.createTextNode(' '));
                title.appendChild(badge);
            }

            const meta = document.createElement('div');
            meta.className = 'pv-cardScanner__candidateMeta';

            const number = displayNumber || getCandidateCardNumber(candidate);
            const setName = getCandidateSetName(candidate);
            const scorePct = Math.round((Number(entry.score) || 0) * 100);
            meta.textContent = [
                number ? `No. ${number}` : '',
                setName,
                `Score ${scorePct}%`
            ].filter(Boolean).join(' • ');

            const debug = document.createElement('div');
            debug.className = 'pv-cardScanner__candidateDebug';
            debug.textContent = [
                `num ${Math.round((Number(entry.numberScore) || 0) * 100)}%`,
                `img ${Math.round((Number(entry.imageScore) || 0) * 100)}%`,
                `name ${Math.round((Number(entry.nameScore) || 0) * 100)}%`,
                `set ${Math.round((Number(entry.setScore) || 0) * 100)}%`
            ].join(' · ');

            const debugDetails = document.createElement('details');
            debugDetails.className = 'pv-cardScanner__candidateDetails';

            const debugSummary = document.createElement('summary');
            debugSummary.className = 'pv-cardScanner__candidateDetailsSummary';
            debugSummary.textContent = 'Show match details';

            debugDetails.appendChild(debugSummary);
            debugDetails.appendChild(debug);

            content.appendChild(title);
            content.appendChild(meta);
            content.appendChild(debugDetails);

            button.appendChild(image);
            button.appendChild(content);

            button.addEventListener('click', function () {
                applyCandidateSelection(elements, candidate, entry.score, false, fallbackNumber, displayNumber);
            });

            elements.candidateList.appendChild(button);
        });

        elements.candidateWrap.hidden = ranked.length === 0;

        if (recommendedId) {
            markSelectedCandidate(elements, recommendedId);
        }
    }

    function applyCandidateSelection(elements, candidate, score, autoApplied, fallbackNumber, preferredDisplayNumber) {
        const name = getCandidateCardName(candidate);
        const existingNumber = elements?.detectedNumber ? String(elements.detectedNumber.value || '').trim() : '';
        const preferredFallbackNumber = existingNumber || String(fallbackNumber || '').trim();
        const preferredDisplay = normalizeExtractedCardNumber(preferredDisplayNumber || '');
        let number = preferredDisplay || getBestCandidateSearchNumber(candidate, preferredFallbackNumber);
        const candidateId = String(candidate?.id || '').trim();

        // Keep an existing full collector number when a candidate only provides a short number
        // for the same card index (e.g. keep 4/102 instead of replacing with 4).
        const existingNormalized = normalizeExtractedCardNumber(existingNumber);
        const selectedNormalized = normalizeExtractedCardNumber(number);
        if (existingNormalized.indexOf('/') >= 0 && selectedNormalized.indexOf('/') < 0) {
            const existingLeft = String(Number(existingNormalized.split('/')[0] || ''));
            const selectedLeft = String(Number(selectedNormalized || ''));

            if (existingLeft && selectedLeft && existingLeft === selectedLeft) {
                number = existingNormalized;
            }
        }

        if (elements.detectedName) {
            elements.detectedName.value = name;
        }

        if (elements.detectedNumber) {
            elements.detectedNumber.value = number;
        }

        const prefix = autoApplied ? 'Top high-confidence match applied' : 'Selected candidate';
        setStatus(elements, `${prefix}: ${name}${number ? ` (${number})` : ''}.`);
        markSelectedCandidate(elements, candidateId);
        showSelectedCandidate(elements, candidate, number);

        if (elements.searchBtn) {
            elements.searchBtn.hidden = false;
        }
        if (elements.searchNearCandidatesBtn) {
            elements.searchNearCandidatesBtn.hidden = false;
        }

        dispatchScannerEvent('pv:scanner:candidate-selected', {
            id: candidateId,
            name: name,
            number: number,
            score: score,
            autoApplied: !!autoApplied
        });
    }

    function getCandidatePrintedTotal(card) {
        const setObj = (card?.expansion && typeof card.expansion === 'object')
            ? card.expansion
            : (card?.set && typeof card.set === 'object' ? card.set : null);

        const raw = Number(
            setObj?.printed_total
            || setObj?.printedTotal
            || setObj?.total
            || card?.printedTotal
            || card?.total
            || 0
        );

        if (!Number.isFinite(raw) || raw < 1) {
            return '';
        }

        return String(Math.floor(raw));
    }

    function getBestCandidateSearchNumber(card, fallbackNumber) {
        const candidateNumber = getCandidateCardNumber(card);
        const total = getCandidatePrintedTotal(card);
        const fallback = normalizeCollectorNumberWithPrintedTotal(fallbackNumber || '', total);

        if (!candidateNumber) {
            return fallback;
        }

        const galleryMatch = candidateNumber.match(/^(GG|TG)(\d{1,2})$/i);
        if (galleryMatch && /^\d{1,3}$/.test(total)) {
            const prefix = String(galleryMatch[1] || '').toUpperCase();
            const left = String(galleryMatch[2] || '').padStart(2, '0');
            const right = String(total).padStart(Math.max(2, String(total).length), '0');
            return `${prefix}${left}/${prefix}${right}`;
        }

        if (candidateNumber.indexOf('/') < 0 && fallback.indexOf('/') >= 0) {
            const fallbackParts = fallback.split('/');
            const candidateLeft = String(Number(candidateNumber || ''));
            const fallbackLeftRaw = String(fallbackParts[0] || '').trim();
            const fallbackLeft = String(Number(fallbackLeftRaw || ''));

            if (candidateLeft && fallbackLeft && candidateLeft === fallbackLeft) {
                // Preserve detected full collector number only when it is the same card index.
                return fallback;
            }
        }

        if (candidateNumber.indexOf('/') >= 0) {
            const normalizedCandidate = normalizeCollectorNumberWithPrintedTotal(candidateNumber, total);
            const fallback = normalizeCollectorNumberWithPrintedTotal(fallbackNumber || '', total);

            if (fallback.indexOf('/') >= 0) {
                const candidateParts = normalizedCandidate.split('/');
                const fallbackParts = fallback.split('/');

                if (candidateParts.length === 2 && fallbackParts.length === 2) {
                    const candidateLeft = String(Number(candidateParts[0] || ''));
                    const fallbackLeft = String(Number(fallbackParts[0] || ''));
                    const candidateRight = String(Number(candidateParts[1] || ''));
                    const fallbackRight = String(Number(fallbackParts[1] || ''));

                    if (
                        candidateLeft
                        && fallbackLeft
                        && candidateLeft === fallbackLeft
                        && candidateRight
                        && fallbackRight
                        && candidateRight === fallbackRight
                        && fallbackParts[1].length > candidateParts[1].length
                    ) {
                        return `${candidateParts[0]}/${fallbackParts[1]}`;
                    }
                }
            }

            return normalizedCandidate;
        }

        if (/^\d{1,3}$/.test(candidateNumber) && /^\d{2,3}$/.test(total)) {
            if (fallback.indexOf('/') >= 0) {
                const fallbackParts = fallback.split('/');

                if (fallbackParts.length === 2) {
                    const candidateLeft = String(Number(candidateNumber));
                    const fallbackLeft = String(Number(fallbackParts[0] || ''));

                    if (candidateLeft && fallbackLeft && candidateLeft === fallbackLeft) {
                        return fallback;
                    }
                }
            }

            const left = String(Number(candidateNumber));
            const width = Math.max(2, total.length);
            return `${left.padStart(width, '0')}/${total}`;
        }

        if (fallback.indexOf('/') >= 0) {
            const candidateLeft = String(Number(candidateNumber));
            const fallbackLeft = String(Number(fallback.split('/')[0] || ''));

            if (candidateLeft && fallbackLeft && candidateLeft === fallbackLeft) {
                return fallback;
            }
        }

        return candidateNumber;
    }

    function normalizeCollectorNumberWithPrintedTotal(rawNumber, printedTotal) {
        const normalized = normalizeExtractedCardNumber(rawNumber || '');
        const total = String(printedTotal || '').trim();

        if (!normalized || normalized.indexOf('/') < 0 || !/^\d{2,3}$/.test(total)) {
            return normalized;
        }

        const parts = normalized.split('/');

        if (parts.length !== 2) {
            return normalized;
        }

        const left = String(parts[0] || '').trim();
        const right = String(parts[1] || '').trim();

        if (!/^\d{1,3}$/.test(left) || !/^\d{1,3}$/.test(right)) {
            return normalized;
        }

        const targetWidth = Math.max(total.length, right.length);
        const normalizedRight = String(Number(right)).padStart(targetWidth, '0');

        if (String(Number(right)) !== String(Number(total))) {
            return `${left}/${normalizedRight}`;
        }

        if (right.length > total.length) {
            return `${left}/${right}`;
        }

        return `${left}/${String(total).padStart(targetWidth, '0')}`;
    }

    async function rankScannerCandidates(capturedBlob, candidates, detected) {
        const scanHash = await createImageHashFromBlob(capturedBlob, SCANNER_HASH_SIZE);
        const ranked = [];
        const detectedName = normalizeDetectedName(detected?.name || '');
        const normalizedDetectedNumber = normalizeExtractedCardNumber(detected?.number || '');
        const hasExplicitDetectedNumber = /^\d{1,3}\/\d{2,3}$/.test(normalizedDetectedNumber);
        const hasNumericDetectedNumber = /^\d{1,3}$/.test(normalizedDetectedNumber);

        for (const candidate of candidates) {
            // If candidate came from Firestore catalog with Firebase scoring, use that as primary signal
            const firebaseScore = candidate?._candidate?.score || null;
            const hasFirebaseScore = typeof firebaseScore === 'number' && firebaseScore > 0;

            const candidateSearchNumber = getBestCandidateSearchNumber(candidate, detected?.number || '');
            const numberScore = scoreCandidateNumberMatch(detected?.number, candidateSearchNumber);
            const nameScore = scoreCandidateNameMatch(detected?.name, getCandidateCardName(candidate));
            const setScore = scoreCandidateSetMatch(detected?.setId, getCandidateSetId(candidate));
            const imageScore = await scoreCandidateImageSimilarity(scanHash, candidate);

            let adjustedNumberScore = numberScore;

            // Name is the strongest signal for best-match ranking. If name mismatch is high,
            // heavily down-rank number-driven matches to avoid wrong "best match" cards.
            if (detectedName && nameScore < 0.35) {
                adjustedNumberScore *= 0.2;
            }

            let finalScore;

            if (hasFirebaseScore) {
                // Firebase retrieves the candidate pool, while browser scoring
                // combines all available evidence. Keep name as a first-class
                // signal so unrelated cards sharing a bare number cannot win.
                finalScore = (firebaseScore / 100) * 0.35
                    + (nameScore * 0.35)
                    + (adjustedNumberScore * 0.15)
                    + (imageScore * 0.15);

                if (hasExplicitDetectedNumber) {
                    if (numberScore >= 0.99) {
                        finalScore = Math.min(1, finalScore + 0.15);
                    } else if (numberScore < 0.95) {
                        finalScore *= 0.7;
                    }
                } else if (hasNumericDetectedNumber) {
                    if (numberScore >= 0.79) {
                        finalScore = Math.min(1, finalScore + 0.08);
                    } else if (numberScore < 0.5) {
                        finalScore *= 0.78;
                    }
                }
            } else {
                // Fallback scoring for non-catalog candidates (e.g., from Scrydex search)
                finalScore =
                    (nameScore * SCANNER_RANK_WEIGHT_NAME)
                    + (adjustedNumberScore * SCANNER_RANK_WEIGHT_NUMBER)
                    + (imageScore * SCANNER_RANK_WEIGHT_IMAGE)
                    + (setScore * SCANNER_RANK_WEIGHT_SET);

                if (detectedName && nameScore < 0.2) {
                    finalScore *= 0.6;
                }

                if (hasExplicitDetectedNumber) {
                    if (numberScore >= 0.99) {
                        finalScore = Math.min(1, finalScore + 0.2);
                    } else if (numberScore < 0.95) {
                        // Strongly de-prioritize same-name cards with different collector numbers.
                        finalScore *= 0.55;
                    }
                } else if (hasNumericDetectedNumber) {
                    if (numberScore >= 0.79) {
                        finalScore = Math.min(1, finalScore + 0.1);
                    } else if (numberScore < 0.5) {
                        finalScore *= 0.8;
                    }
                }
            }

            ranked.push({
                card: candidate,
                score: Math.max(0, Math.min(1, finalScore)),
                numberScore: numberScore,
                imageScore: imageScore,
                nameScore: nameScore,
                setScore: setScore,
                firebaseScore: hasFirebaseScore ? firebaseScore : null
            });
        }

        ranked.sort(function (a, b) {
            const scoreDiff = b.score - a.score;
            if (scoreDiff) return scoreDiff;

            const numberDiff = (Number(b.numberScore) || 0) - (Number(a.numberScore) || 0);
            if (numberDiff) return numberDiff;

            const nameDiff = (Number(b.nameScore) || 0) - (Number(a.nameScore) || 0);
            if (nameDiff) return nameDiff;

            return (Number(b.imageScore) || 0) - (Number(a.imageScore) || 0);
        });

        return ranked;
    }

    async function fetchScannerCandidates(detected, flags) {
        const base = getScannerWorkerBase();
        const number = normalizeExtractedCardNumber(detected?.number || '');
        const name = normalizeDetectedName(detected?.name || '');
        const shouldEnrichForDisplay = !number || number.indexOf('/') >= 0 || /^\d{1,3}$/.test(number);
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
                if (shouldEnrichForDisplay) {
                    await enrichCandidatesWithPrintedTotals(base, results, flags);
                }

                return results.filter(function (card) {
                    return getCandidateSetId(card) === setId;
                }).concat(results.filter(function (card) {
                    return getCandidateSetId(card) !== setId;
                })).slice(0, SCANNER_CANDIDATE_FETCH_LIMIT);
            }
        }

        if (shouldEnrichForDisplay) {
            await enrichCandidatesWithPrintedTotals(base, results, flags);
        }

        return results.slice(0, SCANNER_CANDIDATE_FETCH_LIMIT);
    }

    function candidateNeedsPrintedTotalEnrichment(card) {
        if (!card || typeof card !== 'object') return false;

        const total = getCandidatePrintedTotal(card);
        if (/^\d{1,3}$/.test(total)) return false;

        const number = getCandidateCardNumber(card);
        return /^\d{1,3}$/.test(number);
    }

    function applyCandidatePrintedTotal(card, total) {
        const normalizedTotal = String(total || '').trim();
        if (!/^\d{1,3}$/.test(normalizedTotal)) return;

        if (!card.expansion || typeof card.expansion !== 'object') {
            card.expansion = {};
        }
        if (!card.set || typeof card.set !== 'object') {
            card.set = {};
        }

        card.expansion.printedTotal = normalizedTotal;
        card.set.printedTotal = normalizedTotal;
    }

    async function enrichCandidatesWithPrintedTotals(base, cards, flags) {
        const list = Array.isArray(cards) ? cards : [];
        const pending = list.filter(candidateNeedsPrintedTotalEnrichment).slice(0, 10);

        for (const card of pending) {
            const id = String(card?.id || '').trim();
            if (!id) continue;

            try {
                const query = buildFieldQuery('id', id);
                const payload = await fetchScannerCardsSearch(base, query, 1, flags);
                const matched = (Array.isArray(payload?.data) ? payload.data : []).find(function (item) {
                    return String(item?.id || '').trim() === id;
                });

                if (!matched) continue;

                const total = getCandidatePrintedTotal(matched);
                applyCandidatePrintedTotal(card, total);
            } catch {
                // Keep candidate as-is if enrichment fails.
            }
        }
    }

    function buildFieldQuery(fieldName, value) {
        const trimmed = String(value || '').trim();

        if (!trimmed) {
            return '';
        }

        const needsQuotes = /\s/.test(trimmed) || /[^A-Za-z0-9]/.test(trimmed);
        const term = needsQuotes ? `"${trimmed.replace(/"/g, '\\"')}"` : trimmed;

        return `${fieldName}:${term}`;
    }

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

    async function tryAutoFillCollectorNumberFromCatalog(extracted, flags) {
        const detectedName = normalizeDetectedName(extracted?.name || '');
        const detectedNumber = normalizeExtractedCardNumber(extracted?.number || '');

        if (!detectedName || detectedNumber) {
            return { filled: false, reason: 'name_or_number_not_eligible' };
        }

        if (!flags?.enableCandidates || !flags?.enableCatalogCandidates) {
            return { filled: false, reason: 'candidates_disabled' };
        }

        const setId = getSelectedSetId();
        const base = getScannerWorkerBase();
        const payload = await fetchScannerCatalogCandidates(base, {
            name: detectedName,
            number: '',
            setId: setId,
            limit: 6
        });

        const cards = Array.isArray(payload?.data) ? payload.data : [];

        const exactByName = cards
            .map(function (card) {
                const candidateName = normalizeDetectedName(getCandidateCardName(card) || '');
                const number = normalizeExtractedCardNumber(getBestCandidateSearchNumber(card, ''));
                const scoreRaw = Number(card?._candidate?.score);
                const score = Number.isFinite(scoreRaw) ? scoreRaw : 0;

                return {
                    card: card,
                    name: candidateName,
                    number: number,
                    score: score,
                    setId: String(getCandidateSetId(card) || ''),
                    id: String(card?.id || '')
                };
            })
            .filter(function (item) {
                const candidateComparable = normalizeScannerComparableName(item.name);
                const detectedComparable = normalizeScannerComparableName(detectedName);

                return candidateComparable
                    && detectedComparable
                    && candidateComparable.toLowerCase() === detectedComparable.toLowerCase()
                    && item.number
                    && item.number.indexOf('/') >= 0;
            });

        if (!exactByName.length) {
            return { filled: false, reason: 'no_exact_name_slash_candidate' };
        }

        const sameSet = setId
            ? exactByName.filter(function (item) {
                return item.setId && item.setId === setId;
            })
            : [];

        const pool = sameSet.length ? sameSet : exactByName;
        pool.sort(function (a, b) {
            return Number(b.score || 0) - Number(a.score || 0);
        });

        const top = pool[0] || null;
        const second = pool[1] || null;

        if (!top || !top.number) {
            return { filled: false, reason: 'missing_top_candidate' };
        }

        const gap = second ? Number(top.score || 0) - Number(second.score || 0) : 999;
        const hasSetFilter = Boolean(setId);
        const strongTop = hasSetFilter ? Number(top.score || 0) >= 74 : Number(top.score || 0) >= 88;
        const clearLeader = !second || gap >= 10;
        const singleCandidate = pool.length === 1;

        if (!singleCandidate && (!strongTop || !clearLeader)) {
            return {
                filled: false,
                reason: 'confidence_too_low',
                topScore: Number(top.score || 0),
                gap: gap
            };
        }

        if (singleCandidate && Number(top.score || 0) < (hasSetFilter ? 65 : 80)) {
            return {
                filled: false,
                reason: 'single_candidate_score_too_low',
                topScore: Number(top.score || 0)
            };
        }

        return {
            filled: true,
            number: top.number,
            score: Number(top.score || 0),
            id: top.id,
            setId: top.setId,
            source: 'catalog-candidate'
        };
    }

    async function resolveScannerNameCorrection(base, detectedName, flags, rawOcrText) {
        const rawName = normalizeDetectedName(detectedName || '');

        if (!flags?.enableNameCorrection) {
            return null;
        }

        const candidateNames = collectScannerNameCorrectionCandidates(rawName, rawOcrText);
        if (!candidateNames.length) return null;

        const results = await Promise.all(candidateNames.map(function (candidateName) {
            return fetchScannerNameCorrection(base, candidateName, flags).catch(function () {
                return null;
            });
        }));

        return results
            .filter(Boolean)
            .sort(function (a, b) {
                return Number(b.score || 0) - Number(a.score || 0);
            })[0] || null;
    }

    function collectScannerNameCorrectionCandidates(detectedName, rawOcrText) {
        const primary = normalizeDetectedName(detectedName || '');
        const candidates = [];

        function add(value) {
            const normalized = normalizeDetectedName(value || '');
            const compact = normalized.toLowerCase().replace(/[^a-z]/g, '');
            if (!normalized || compact.length < 4 || compact.length > 20) return;
            if (candidates.some(function (item) {
                return item.toLowerCase() === normalized.toLowerCase();
            })) return;
            candidates.push(normalized);
        }

        add(primary);

        const lines = String(rawOcrText || '').split(/\r?\n/);
        for (const line of lines) {
            // Card headers normally pair the name with a two/three digit HP
            // value. Restrict token harvesting to those lines so attack text
            // and rules prose do not generate correction requests.
            if (!/(?:^|\D)(?:[3-9]\d|[1-3]\d{2,3})(?:\D|$)/.test(line)) continue;

            const tokens = String(line || '')
                .replace(/\b(?:BASIC|STAGE|HP|VMAX|VSTAR|EX|GX)\b/ig, ' ')
                .match(/[A-Za-z][A-Za-z'-]{3,19}/g) || [];

            for (const token of tokens) {
                add(token);
            }
        }

        // Bound network work for mobile responsiveness and lower backend load.
        return candidates.slice(0, 3);
    }

    async function fetchScannerNameCorrection(base, rawName, flags) {
        const normalizedName = normalizeDetectedName(rawName || '');
        if (!normalizedName || normalizedName.length < 2) return null;

        const params = [
            `text=${encodeURIComponent(normalizedName)}`,
            'limit=5'
        ];
        const url = `${base}/scanner/name-suggestions?${params.join('&')}`;
        const payload = await fetchScannerJsonWithTimeout(
            url,
            Number(flags.nameCorrectionTimeoutMs || PV_SCANNER_NAME_CORRECTION_TIMEOUT_MS)
        );
        const suggestions = Array.isArray(payload?.data) ? payload.data : [];

        if (!suggestions.length) return null;

        const best = suggestions[0];
        const name = normalizeDetectedName(best?.name || '');
        const score = Number(best?.score || 0);

        if (!name || !Number.isFinite(score)) return null;

        return {
            name,
            score,
            autoApply: score >= Number(flags.nameCorrectionAutoScore || PV_SCANNER_NAME_CORRECTION_AUTO_SCORE),
            suggestOnly: score >= Number(flags.nameCorrectionSuggestScore || PV_SCANNER_NAME_CORRECTION_SUGGEST_SCORE),
            source: best?.source || 'scannerNameIndex',
            inputName: normalizedName
        };
    }

    async function fetchScannerJsonWithTimeout(url, timeoutMs) {
        const cacheKey = String(url || '').trim();
        if (!cacheKey) return null;
        if (scannerRequestCache.has(cacheKey)) return scannerRequestCache.get(cacheKey);

        let headers = undefined;

        try {
            const tokenRaw = window?.PV_AUTH?.getIdToken ? await window.PV_AUTH.getIdToken(true) : null;
            const token = typeof tokenRaw === 'string' ? tokenRaw.trim() : '';
            if (token && token.split('.').length === 3) headers = { Authorization: `Bearer ${token}` };
        } catch {
            // Ignore token errors.
        }

        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = window.setTimeout(function () {
            if (!controller) return;
            try {
                controller.abort();
            } catch {
                // Ignore abort errors.
            }
        }, Math.max(300, Number(timeoutMs || 1200)));

        try {
            const response = await fetch(url, {
                ...(headers ? { headers: headers } : {}),
                ...(controller ? { signal: controller.signal } : {})
            });

            if (!response.ok) throw new Error(`Scanner request failed (${response.status}).`);

            const data = await response.json();
            // The name index is populated incrementally. Do not pin an empty lookup
            // in the browser after the requested card name is hydrated later.
            if (Array.isArray(data?.data) && data.data.length > 0) {
                scannerRequestCache.set(cacheKey, data);
            }
            return data;
        } finally {
            window.clearTimeout(timer);
        }
    }

    function isLikelyGarbageDetectedName(name) {
        const value = normalizeDetectedName(name || '');
        const lettersOnly = value.replace(/[^A-Za-z]/g, '');

        if (!value || lettersOnly.length < 5) return false;
        if (!/[AEIOUaeiou]/.test(lettersOnly)) return true;
        if (scoreDetectedName(value) < 1) return true;

        const singleLetterTokens = value.split(/\s+/).filter(function (token) {
            return /^[A-Za-z]$/.test(token);
        });

        return singleLetterTokens.length >= 3;
    }

    async function fetchScannerCardsSearch(base, query, pageSize, flags) {
        const params = [
            `q=${encodeURIComponent(query)}`,
            'page=1',
            `pageSize=${encodeURIComponent(String(pageSize || 8))}`,
            'lang=en'
        ];

        if (flags?.candidatesConsumeQuota) {
            params.push('consumeQuota=1');
        }

        const qs = params.join('&');
        const url = `${base}/cards/search?${qs}`;
        return fetchScannerJson(url);
    }

    async function fetchScannerJson(url) {
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

        const response = await fetch(url, headers ? { headers: headers } : undefined);

        if (!response.ok) {
            throw new Error(`Scanner candidate request failed (${response.status}).`);
        }

        const data = await response.json();
        scannerRequestCache.set(cacheKey, data);
        return data;
    }

    function getScannerWorkerBase() {
        const defaultWorker = 'https://pokevalutor-v1.lreyperez18.workers.dev';
        return String(window?.PV_SECRETS?.PV_API_URL || defaultWorker).replace(/\/$/, '');
    }

    function getSelectedSetId() {
        const setSelect = document.getElementById('pv-search-set');
        return String(setSelect?.value || '').trim();
    }

    function getCandidateCardName(card) {
        return normalizeDetectedName(String(card?.name || '').trim());
    }

    function normalizeScannerComparableName(value) {
        return normalizeDetectedName(String(value || '')
            .replace(/\s*[-–—]?\s*(EX|GX|VSTAR|VMAX)\s*$/i, '')
            .trim());
    }

    function getCandidateCardNumber(card) {
        const raw = String(
            card?.printedNumber
            || card?.collectorNumber
            || card?.printed_number
            || card?.card_no
            || card?.cardNumber
            || card?.number
            || ''
        ).trim();

        if (!raw) {
            return '';
        }

        return normalizeExtractedCardNumber(raw);
    }

    function getCandidateSetId(card) {
        const setObj = (card?.expansion && typeof card.expansion === 'object') ? card.expansion : (card?.set && typeof card.set === 'object' ? card.set : null);
        return String(setObj?.id || card?.expansionId || card?.setId || '').trim();
    }

    function getCandidateSetName(card) {
        const setObj = (card?.expansion && typeof card.expansion === 'object') ? card.expansion : (card?.set && typeof card.set === 'object' ? card.set : null);
        return String(setObj?.name || card?.expansionName || card?.setName || '').trim();
    }

    function pickCandidateImageUrl(card) {
        const images = card?.images;

        if (Array.isArray(images)) {
            const front = images.find(function (img) {
                return String(img?.type || '').toLowerCase() === 'front';
            }) || images[0];

            return String(front?.medium || front?.large || front?.small || '').trim();
        }

        if (images && typeof images === 'object') {
            return String(images?.medium || images?.large || images?.small || images?.url || '').trim();
        }

        return String(card?.image || card?.imageUrl || '').trim();
    }

    function scoreCandidateNumberMatch(detectedNumber, candidateNumber) {
        const detected = normalizeExtractedCardNumber(detectedNumber || '');
        const candidate = normalizeExtractedCardNumber(candidateNumber || '');

        if (!detected || !candidate) {
            return 0;
        }

        if (detected === candidate) {
            return 1;
        }

        const detectedNumericSlash = detected.match(/^(\d{1,3})\/(\d{1,3})$/);
        const candidateNumericSlash = candidate.match(/^(\d{1,3})\/(\d{1,3})$/);

        if (detectedNumericSlash && candidateNumericSlash) {
            const detectedLeft = String(Number(detectedNumericSlash[1] || ''));
            const detectedRight = String(Number(detectedNumericSlash[2] || ''));
            const candidateLeft = String(Number(candidateNumericSlash[1] || ''));
            const candidateRight = String(Number(candidateNumericSlash[2] || ''));

            if (detectedLeft && detectedRight && detectedLeft === candidateLeft && detectedRight === candidateRight) {
                // Treat 037/132 and 37/132 as exact matches.
                return 1;
            }

            if (detectedLeft && candidateLeft && detectedLeft === candidateLeft) {
                return 0.75;
            }

            return 0;
        }

        if (detectedNumericSlash && /^\d{1,3}$/.test(candidate)) {
            const detectedLeft = String(Number(detectedNumericSlash[1] || ''));
            const candidateLeft = String(Number(candidate || ''));

            if (detectedLeft && candidateLeft && detectedLeft === candidateLeft) {
                // Short candidate number (e.g. 37) is weaker than explicit 37/132.
                return 0.4;
            }

            return 0;
        }

        if (/^\d{1,3}$/.test(detected) && candidateNumericSlash) {
            const detectedLeft = String(Number(detected || ''));
            const candidateLeft = String(Number(candidateNumericSlash[1] || ''));

            if (detectedLeft && candidateLeft && detectedLeft === candidateLeft) {
                return 0.8;
            }

            return 0;
        }

        const dParts = detected.split('/');
        const cParts = candidate.split('/');

        if (dParts.length === 2 && cParts.length === 2 && dParts[0] === cParts[0]) {
            return 0.75;
        }

        if (candidate.indexOf(detected) >= 0 || detected.indexOf(candidate) >= 0) {
            return 0.6;
        }

        return 0;
    }

    function scoreCandidateNameMatch(detectedName, candidateName) {
        const detected = normalizeDetectedName(detectedName || '').toLowerCase();
        const candidate = normalizeDetectedName(candidateName || '').toLowerCase();

        if (!detected || !candidate) {
            return 0;
        }

        if (detected === candidate) {
            return 1;
        }

        if (candidate.indexOf(detected) >= 0 || detected.indexOf(candidate) >= 0) {
            return 0.8;
        }

        const detectedTokens = detected.split(/\s+/).filter(Boolean);
        const candidateTokens = candidate.split(/\s+/).filter(Boolean);

        if (!detectedTokens.length || !candidateTokens.length) {
            return 0;
        }

        const candidateSet = new Set(candidateTokens);
        let overlap = 0;

        detectedTokens.forEach(function (token) {
            if (candidateSet.has(token)) {
                overlap += 1;
            }
        });

        return overlap / Math.max(detectedTokens.length, candidateTokens.length);
    }

    function scoreCandidateSetMatch(detectedSetId, candidateSetId) {
        const detected = String(detectedSetId || '').trim();
        const candidate = String(candidateSetId || '').trim();

        if (!detected || !candidate) {
            return 0;
        }

        return detected === candidate ? 1 : 0;
    }

    async function scoreCandidateImageSimilarity(scanHash, candidate) {
        if (!scanHash) {
            return 0;
        }

        const imageUrl = pickCandidateImageUrl(candidate);

        if (!imageUrl) {
            return 0;
        }

        const candidateBlob = await fetchImageBlob(imageUrl);
        const candidateHash = await createImageHashFromBlob(candidateBlob, SCANNER_HASH_SIZE);

        if (!candidateHash) {
            return 0;
        }

        return hashSimilarity(scanHash, candidateHash);
    }

    async function fetchImageBlob(url) {
        const key = `img:${String(url || '').trim()}`;

        if (!url) {
            return null;
        }

        if (scannerRequestCache.has(key)) {
            return scannerRequestCache.get(key);
        }

        try {
            const response = await fetch(url, { mode: 'cors' });

            if (!response.ok) {
                return null;
            }

            const blob = await response.blob();
            scannerRequestCache.set(key, blob);
            return blob;
        } catch {
            return null;
        }
    }

    async function createImageHashFromBlob(imageBlob, hashSize) {
        if (!imageBlob || !window.createImageBitmap) {
            return '';
        }

        let bitmap = null;

        try {
            bitmap = await window.createImageBitmap(imageBlob);
            const size = Math.max(8, Number(hashSize || SCANNER_HASH_SIZE));
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;

            const ctx = canvas.getContext('2d', { willReadFrequently: true });

            if (!ctx) {
                return '';
            }

            ctx.drawImage(bitmap, 0, 0, size, size);
            const imageData = ctx.getImageData(0, 0, size, size).data;
            const gray = [];
            let sum = 0;

            for (let i = 0; i < imageData.length; i += 4) {
                const g = Math.round((imageData[i] * 0.299) + (imageData[i + 1] * 0.587) + (imageData[i + 2] * 0.114));
                gray.push(g);
                sum += g;
            }

            const avg = sum / gray.length;

            return gray.map(function (value) {
                return value >= avg ? '1' : '0';
            }).join('');
        } catch {
            return '';
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

    function hashSimilarity(a, b) {
        const left = String(a || '');
        const right = String(b || '');

        if (!left || !right || left.length !== right.length) {
            return 0;
        }

        let same = 0;

        for (let i = 0; i < left.length; i += 1) {
            if (left[i] === right[i]) {
                same += 1;
            }
        }

        return same / left.length;
    }

    async function extractWithOcrFallback(worker, imageBlob, elements, flags) {
        const extracted = {
            name: '',
            number: ''
        };
        let preparedText = '';
        let preparedExtracted = null;
        let numberDetection = { number: '', raw: '' };
        let fallbackRaw = '';

        const primaryResult = await worker.recognize(imageBlob);
        const primaryText = String(primaryResult?.data?.text || '').trim();

        extracted.name = extractCardSearchParts(primaryText).name;

        if (flags?.enableAdvancedOcrFallback && (!extracted.name || !extracted.number)) {
            const preparedImage = await prepareImageForOcr(imageBlob);

            if (preparedImage && preparedImage !== imageBlob) {
                const preparedResult = await worker.recognize(preparedImage);
                preparedText = String(preparedResult?.data?.text || '').trim();

                preparedExtracted = extractCardSearchParts(preparedText);

                if (!extracted.name && preparedExtracted?.name) {
                    extracted.name = preparedExtracted.name;
                }
            }
        }

        numberDetection = await detectCardNumber(worker, imageBlob, elements);
        extracted.number = numberDetection.number;

        const needFallbackName = !extracted.name || scoreDetectedName(extracted.name) < 3;
        const needFallbackNumber = !extracted.number;
        const fallback = (needFallbackName || needFallbackNumber)
            ? await runRegionalOcrFallback(worker, imageBlob, elements, {
                needName: needFallbackName,
                needNumber: needFallbackNumber
            })
            : { name: '', number: '', raw: '' };

        if (needFallbackName && fallback.name) {
            extracted.name = pickBetterDetectedName(extracted.name, fallback.name);
        }

        const fallbackExplicitNumber = extractExplicitCollectorNumber(fallback.raw);

        if (fallbackExplicitNumber && (!extracted.number || !hasExplicitCollectorNumber(numberDetection.raw))) {
            extracted.number = fallbackExplicitNumber;
        } else if (fallback.number && !extracted.number) {
            extracted.number = fallback.number;
        }

        if (preparedExtracted?.name) {
            extracted.name = pickBetterDetectedName(extracted.name, preparedExtracted.name);
        }

        if (extracted.number && !isPlausibleDetectedNumber(extracted.number)) {
            extracted.number = '';
        }

        if (!extracted.number) {
            extracted.number = detectCollectorNumberFromCandidateTexts([
                { text: numberDetection.raw, allowFuzzy: true },
                { text: fallback.raw, allowFuzzy: true },
                { text: preparedText, allowFuzzy: false },
                { text: primaryText, allowFuzzy: false }
            ]);
        }

        if (!isPlausibleDetectedNumber(extracted.number)) {
            extracted.number = '';
        }

        const explicitNumberEvidence = collectExplicitCollectorNumberEvidence([
            numberDetection.raw,
            fallback.raw,
            preparedText,
            primaryText
        ]);

        if (explicitNumberEvidence.length) {
            extracted.number = chooseBestExplicitCollectorNumber(explicitNumberEvidence, extracted.number);
        } else if (extracted.number) {
            // If OCR did not produce any explicit collector number evidence,
            // prefer an empty field over a likely wrong inferred number.
            extracted.number = '';
        }

        fallbackRaw = fallback.raw;

        const rawParts = [primaryText];

        if (preparedText) {
            rawParts.push(`--- Preprocessed OCR ---\n${preparedText}`);
        }

        if (numberDetection.raw) {
            rawParts.push(`--- Card Number OCR ---\n${numberDetection.raw}`);
        }

        if (fallbackRaw) {
            rawParts.push(fallbackRaw);
        }

        return {
            name: extracted.name,
            number: extracted.number,
            rawText: rawParts.filter(Boolean).join('\n\n')
        };
    }

    function collectExplicitCollectorNumberEvidence(textSources) {
        const out = [];
        const list = Array.isArray(textSources) ? textSources : [];

        for (const source of list) {
            const text = String(source || '');

            if (!text) {
                continue;
            }

            const raw = text.toUpperCase();
            const matches = Array.from(raw.matchAll(/(?:^|[^A-Z0-9])([A-Z]{0,4}\s*\d{1,3}\s*\/\s*\d{2,3})(?=$|[^A-Z0-9])/g));

            for (const match of matches) {
                const normalized = normalizeExtractedCardNumber(match && match[1] ? match[1] : '');

                if (normalized && isPlausibleDetectedNumber(normalized)) {
                    out.push(normalized);
                }
            }

            const setNumberMatches = Array.from(raw.matchAll(/(?:^|[^A-Z0-9])((?:SWSH|SVP|SM|BW|XY)\s*\d{1,3})(?=$|[^A-Z0-9])/g));

            for (const match of setNumberMatches) {
                const normalized = normalizeExtractedCardNumber(match && match[1] ? match[1] : '');

                if (normalized && isPlausibleDetectedNumber(normalized)) {
                    out.push(normalized);
                }
            }
        }

        return out;
    }

    function chooseBestExplicitCollectorNumber(evidenceList, currentNumber) {
        const counts = new Map();

        for (const item of evidenceList) {
            const key = String(item || '').trim().toUpperCase();
            if (!key) continue;
            counts.set(key, (counts.get(key) || 0) + 1);
        }

        if (!counts.size) {
            return '';
        }

        const current = String(currentNumber || '').trim().toUpperCase();
        if (current && counts.has(current)) {
            return current;
        }

        let best = '';
        let bestCount = -1;

        counts.forEach(function (count, key) {
            if (count > bestCount) {
                best = key;
                bestCount = count;
            }
        });

        return best;
    }

    async function runRegionalOcrFallback(worker, imageBlob, elements, options) {
        if (!worker || !imageBlob) {
            return { name: '', number: '', raw: '' };
        }

        const needName = options && options.needName === false ? false : true;
        const needNumber = options && options.needNumber === false ? false : true;

        const regions = [
            { key: 'top', yStart: 0.02, yEnd: 0.32, kind: 'name' },
            { key: 'bottom', yStart: 0.76, yEnd: 0.99, kind: 'number' }
        ];

        let mergedName = '';
        let mergedNumber = '';
        const rawChunks = [];

        // The card name lives in a narrow header strip. Reading the entire top
        // third mixes the header with artwork and HP, especially on tilted cards.
        // Try overlapping, enlarged single-line crops before the broad regions.
        if (needName) {
            const headerBands = [
                { key: 'top-name-high', yStart: 0.07, yEnd: 0.20 },
                { key: 'top-name-middle', yStart: 0.11, yEnd: 0.25 },
                { key: 'top-name-low', yStart: 0.15, yEnd: 0.29 }
            ];

            for (const band of headerBands) {
                const headerBlob = await createRegionBlob(
                    imageBlob,
                    band.yStart,
                    band.yEnd,
                    0.01,
                    0.99,
                    4
                );

                if (!headerBlob) continue;

                const headerPass = await runTopNameOcr(worker, headerBlob);

                if (headerPass.raw) {
                    rawChunks.push(`[${band.key}]\n${headerPass.raw}`);
                }

                if (headerPass.name) {
                    mergedName = pickBetterDetectedName(mergedName, headerPass.name);
                }

                const preparedHeaderBlob = await prepareImageForOcr(headerBlob);

                if (preparedHeaderBlob && preparedHeaderBlob !== headerBlob) {
                    const preparedHeaderPass = await runTopNameOcr(worker, preparedHeaderBlob);

                    if (preparedHeaderPass.raw) {
                        rawChunks.push(`[${band.key} preprocessed]\n${preparedHeaderPass.raw}`);
                    }

                    if (preparedHeaderPass.name) {
                        mergedName = pickBetterDetectedName(mergedName, preparedHeaderPass.name);
                    }
                }
            }
        }

        for (const region of regions) {
            if ((region.kind === 'name' && !needName) || (region.kind === 'number' && !needNumber)) {
                continue;
            }

            const regionBlob = await createRegionBlob(imageBlob, region.yStart, region.yEnd);

            if (!regionBlob) {
                continue;
            }

            setStatus(elements, needName
                ? 'Refining card text from key card areas...'
                : 'Refining collector number from key card areas...');

            const result = await worker.recognize(regionBlob);
            const regionText = String(result?.data?.text || '').trim();

            if (!regionText) {
                continue;
            }

            const parsed = extractCardSearchParts(regionText);

            if (needName && !mergedName && parsed.name) {
                mergedName = parsed.name;
            }

            if (!mergedNumber && parsed.number) {
                mergedNumber = parsed.number;
            }

            rawChunks.push(`[${region.key} region]\n${regionText}`);

            if (needName && region.key === 'top') {
                const preparedRegionBlob = await prepareImageForOcr(regionBlob);

                if (preparedRegionBlob && preparedRegionBlob !== regionBlob) {
                    const preparedTopResult = await worker.recognize(preparedRegionBlob);
                    const preparedTopText = String(preparedTopResult?.data?.text || '').trim();

                    if (preparedTopText) {
                        const preparedTopParsed = extractCardSearchParts(preparedTopText);

                        if (preparedTopParsed.name) {
                            mergedName = pickBetterDetectedName(mergedName, preparedTopParsed.name);
                        }

                        rawChunks.push(`[top preprocessed]\n${preparedTopText}`);
                    }
                }
            }

            if (needNumber && region.key === 'bottom' && !mergedNumber) {
                const collectorBlob = await createRegionBlob(imageBlob, 0.84, 0.99, 0.0, 0.46);
                const numeric = await runBottomNumericOcr(worker, collectorBlob || regionBlob);

                if (numeric.raw) {
                    rawChunks.push(`[bottom numeric]\n${numeric.raw}`);
                }

                if (numeric.number) {
                    mergedNumber = numeric.number;
                }
            }
        }

        return {
            name: mergedName,
            number: mergedNumber,
            raw: rawChunks.length ? `--- Regional OCR Fallback ---\n${rawChunks.join('\n\n')}` : ''
        };
    }

    async function runTopNameOcr(worker, regionBlob) {
        if (!worker || !regionBlob || typeof worker.setParameters !== 'function') {
            return { name: '', raw: '' };
        }

        try {
            await worker.setParameters({
                tessedit_pageseg_mode: '7',
                preserve_interword_spaces: '1',
                tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '-0123456789"
            });

            const result = await worker.recognize(regionBlob);
            const rawText = String(result?.data?.text || '').trim();
            const parsed = extractCardSearchParts(rawText);

            return {
                name: normalizeDetectedName(parsed.name || ''),
                raw: rawText
            };
        } catch {
            return { name: '', raw: '' };
        } finally {
            try {
                await worker.setParameters({
                    tessedit_pageseg_mode: '6',
                    preserve_interword_spaces: '1',
                    tessedit_char_whitelist: ''
                });
            } catch {
                // Ignore reset errors.
            }
        }
    }

    async function detectCardNumber(worker, imageBlob, elements) {
        if (!worker || !imageBlob) {
            return { number: '', raw: '' };
        }

        setStatus(elements, 'Reading collector number...');
        const regionSpecs = [
            { key: 'modern-left-micro', yStart: 0.92, yEnd: 0.998, xStart: 0.0, xEnd: 0.26, scale: 5 },
            { key: 'modern-left-tight', yStart: 0.90, yEnd: 0.998, xStart: 0.0, xEnd: 0.30, scale: 4 },
            { key: 'modern-left', yStart: 0.87, yEnd: 0.998, xStart: 0.0, xEnd: 0.42, scale: 3 },
            { key: 'bottom-wide', yStart: 0.84, yEnd: 0.998, xStart: 0.0, xEnd: 0.76, scale: 2 },
            { key: 'vintage-right', yStart: 0.88, yEnd: 0.998, xStart: 0.56, xEnd: 1.0, scale: 3 },
            { key: 'vintage-right-tight', yStart: 0.91, yEnd: 0.998, xStart: 0.70, xEnd: 1.0, scale: 4 },
            { key: 'vintage-right-micro', yStart: 0.93, yEnd: 0.998, xStart: 0.78, xEnd: 1.0, scale: 5 }
        ];

        const candidates = [];
        const rawChunks = [];

        for (const regionSpec of regionSpecs) {
            const regionBlob = await createRegionBlob(
                imageBlob,
                regionSpec.yStart,
                regionSpec.yEnd,
                regionSpec.xStart,
                regionSpec.xEnd,
                regionSpec.scale
            );

            if (!regionBlob) {
                continue;
            }

            const textPass = await runCollectorTextOcr(worker, regionBlob);

            if (textPass.raw) {
                rawChunks.push(`[${regionSpec.key} text]\n${textPass.raw}`);
            }

            if (textPass.number && isPlausibleDetectedNumber(textPass.number)) {
                candidates.push({
                    number: textPass.number,
                    score: scoreNumberCandidate(textPass.number, 'text', regionSpec.key),
                    regionKey: regionSpec.key,
                    source: 'text'
                });
            }

            const preparedRegionBlob = await prepareImageForOcr(regionBlob);

            if (preparedRegionBlob && preparedRegionBlob !== regionBlob) {
                const preparedTextPass = await runCollectorTextOcr(worker, preparedRegionBlob);

                if (preparedTextPass.raw) {
                    rawChunks.push(`[${regionSpec.key} preprocessed-text]\n${preparedTextPass.raw}`);
                }

                if (preparedTextPass.number && isPlausibleDetectedNumber(preparedTextPass.number)) {
                    candidates.push({
                        number: preparedTextPass.number,
                        score: scoreNumberCandidate(preparedTextPass.number, 'preprocessed-text', regionSpec.key),
                        regionKey: regionSpec.key,
                        source: 'preprocessed-text'
                    });
                }

                const preparedNumericPass = await runBottomNumericOcr(worker, preparedRegionBlob);

                if (preparedNumericPass.raw) {
                    rawChunks.push(`[${regionSpec.key} preprocessed-numeric]\n${preparedNumericPass.raw}`);
                }

                if (preparedNumericPass.number && isPlausibleDetectedNumber(preparedNumericPass.number)) {
                    candidates.push({
                        number: preparedNumericPass.number,
                        score: scoreNumberCandidate(preparedNumericPass.number, 'preprocessed-numeric', regionSpec.key),
                        regionKey: regionSpec.key,
                        source: 'preprocessed-numeric'
                    });
                }
            }

            const numericPass = await runBottomNumericOcr(worker, regionBlob);

            if (numericPass.raw) {
                rawChunks.push(`[${regionSpec.key} numeric]\n${numericPass.raw}`);
            }

            if (numericPass.number && isPlausibleDetectedNumber(numericPass.number)) {
                candidates.push({
                    number: numericPass.number,
                    score: scoreNumberCandidate(numericPass.number, 'numeric', regionSpec.key),
                    regionKey: regionSpec.key,
                    source: 'numeric'
                });
            }
        }

        // Full-art/holo cards often render collector numbers as tiny low-contrast
        // text in the bottom-left area. If no slash candidate survived the
        // primary passes, run an enhanced recovery pass on that area only.
        const hasSlashCandidate = candidates.some(function (item) {
            return String(item?.number || '').indexOf('/') >= 0;
        });

        if (!hasSlashCandidate) {
            setStatus(elements, 'Trying full-art collector number recovery...');

            const enhancedRegionSpecs = [
                { key: 'fullart-bottom-left-tight', yStart: 0.90, yEnd: 0.999, xStart: 0.0, xEnd: 0.30, scale: 6 },
                { key: 'fullart-bottom-left-wide', yStart: 0.86, yEnd: 0.999, xStart: 0.0, xEnd: 0.38, scale: 5 }
            ];

            for (const regionSpec of enhancedRegionSpecs) {
                const regionBlob = await createRegionBlob(
                    imageBlob,
                    regionSpec.yStart,
                    regionSpec.yEnd,
                    regionSpec.xStart,
                    regionSpec.xEnd,
                    regionSpec.scale
                );

                if (!regionBlob) {
                    continue;
                }

                const enhancedBlob = await prepareNumberRegionForOcr(regionBlob, false);
                const enhancedInvertedBlob = await prepareNumberRegionForOcr(regionBlob, true);

                const passes = [
                    { blob: enhancedBlob, sourceText: 'enhanced-text', rawTextLabel: 'enhanced-text' },
                    { blob: enhancedInvertedBlob, sourceText: 'enhanced-inverted-text', rawTextLabel: 'enhanced-inverted-text' }
                ];

                for (const pass of passes) {
                    if (!pass.blob) continue;

                    const textPass = await runCollectorTextOcr(worker, pass.blob);
                    if (textPass.raw) {
                        rawChunks.push(`[${regionSpec.key} ${pass.rawTextLabel}]\n${textPass.raw}`);
                    }
                    if (textPass.number && isPlausibleDetectedNumber(textPass.number)) {
                        candidates.push({
                            number: textPass.number,
                            score: scoreNumberCandidate(textPass.number, pass.sourceText, regionSpec.key),
                            regionKey: regionSpec.key,
                            source: pass.sourceText
                        });

                        if (String(textPass.number).indexOf('/') >= 0) {
                            break;
                        }
                    }
                }

                if (candidates.some(function (item) {
                    return String(item?.number || '').indexOf('/') >= 0;
                })) {
                    break;
                }
            }
        }

        candidates.sort(function (a, b) {
            return b.score - a.score;
        });

        return {
            number: candidates.length ? candidates[0].number : '',
            raw: rawChunks.join('\n')
        };
    }

    function scoreNumberCandidate(number, source, regionKey) {
        const value = String(number || '').toUpperCase();
        let score = 0;

        if (/^(TG\d{1,2}\/TG\d{1,2}|GG\d{1,2}\/GG\d{1,2})$/.test(value)) {
            score += 12;
        } else if (/^\d{1,3}\/\d{2,3}$/.test(value)) {
            score += 10;
        } else if (/^(SWSH|SVP|SM|BW|XY)\d{1,3}$/.test(value)) {
            score += 8;
        }

        if (source === 'text') {
            score += 6;
        } else if (source === 'preprocessed-text') {
            score += 5;
        } else if (source === 'enhanced-text') {
            score += 6;
        } else if (source === 'enhanced-inverted-text') {
            score += 5;
        } else if (source === 'numeric') {
            score += 1;
        } else if (source === 'preprocessed-numeric') {
            score += 0;
        }

        if (regionKey === 'modern-left-micro' || regionKey === 'vintage-right-micro') {
            score += 5;
        } else if (regionKey === 'modern-left-tight' || regionKey === 'vintage-right-tight') {
            score += 4;
        } else if (regionKey === 'fullart-bottom-left-tight') {
            score += 5;
        } else if (regionKey === 'modern-left' || regionKey === 'vintage-right') {
            score += 3;
        } else if (regionKey === 'fullart-bottom-left-wide') {
            score += 4;
        } else if (regionKey === 'bottom-wide') {
            score += 1;
        }

        const slashMatch = value.match(/^(\d{1,3})\/(\d{2,3})$/);

        if (slashMatch) {
            const left = Number(slashMatch[1]);
            const right = Number(slashMatch[2]);

            if (right < 20 || right > 400) {
                score -= 8;
            }

            if (left === 0 || right === 0) {
                score -= 10;
            }

            if (left === 1 && right >= 120) {
                score -= 4;
            }
        }

        return score;
    }

    async function runCollectorTextOcr(worker, regionBlob) {
        if (!worker || !regionBlob || typeof worker.setParameters !== 'function') {
            return { number: '', raw: '' };
        }

        try {
            await worker.setParameters({
                tessedit_pageseg_mode: '7',
                preserve_interword_spaces: '1',
                tessedit_char_whitelist: ''
            });

            const result = await worker.recognize(regionBlob);
            const rawText = String(result?.data?.text || '').trim();
            const number = normalizeExtractedCardNumber(extractCardNumber(rawText));

            return {
                number: number,
                raw: rawText
            };
        } catch {
            return { number: '', raw: '' };
        } finally {
            try {
                await worker.setParameters({
                    tessedit_pageseg_mode: '6',
                    preserve_interword_spaces: '1',
                    tessedit_char_whitelist: ''
                });
            } catch {
                // Ignore reset errors.
            }
        }
    }

    async function runBottomNumericOcr(worker, regionBlob) {
        if (!worker || !regionBlob || typeof worker.setParameters !== 'function') {
            return { number: '', raw: '' };
        }

        try {
            await worker.setParameters({
                tessedit_pageseg_mode: '7',
                tessedit_char_whitelist: '0123456789/'
            });

            const result = await worker.recognize(regionBlob);
            const rawText = String(result?.data?.text || '').trim();

            const normalized = rawText
                .replace(/\s+/g, '')
                .replace(/[^0-9/]/g, '');

            const number = extractCardNumber(normalized) || inferCollectorFromDigitNoise(normalized);

            return {
                number: number,
                raw: rawText
            };
        } catch {
            return { number: '', raw: '' };
        } finally {
            try {
                await worker.setParameters({
                    tessedit_pageseg_mode: '6',
                    preserve_interword_spaces: '1',
                    tessedit_char_whitelist: ''
                });
            } catch {
                // Ignore reset errors.
            }
        }
    }

    async function createRegionBlob(imageBlob, yStart, yEnd, xStart, xEnd, scaleMultiplier) {
        if (!imageBlob || !window.createImageBitmap) {
            return null;
        }

        let bitmap = null;

        try {
            bitmap = await window.createImageBitmap(imageBlob);

            const startY = Math.max(0, Math.min(1, Number(yStart || 0)));
            const endY = Math.max(startY + 0.01, Math.min(1, Number(yEnd || 1)));
            const startX = Math.max(0, Math.min(1, Number(xStart == null ? 0 : xStart)));
            const endX = Math.max(startX + 0.01, Math.min(1, Number(xEnd == null ? 1 : xEnd)));

            const srcX = Math.round(bitmap.width * startX);
            const srcY = Math.round(bitmap.height * startY);
            const srcWidth = Math.max(1, Math.round(bitmap.width * (endX - startX)));
            const srcHeight = Math.max(1, Math.round(bitmap.height * (endY - startY)));

            const canvas = document.createElement('canvas');
            const scale = Math.max(1, Number(scaleMultiplier || 2));

            canvas.width = Math.max(1, Math.round(srcWidth * scale));
            canvas.height = Math.max(1, Math.round(srcHeight * scale));

            const ctx = canvas.getContext('2d');

            if (!ctx) {
                return null;
            }

            ctx.drawImage(
                bitmap,
                srcX,
                srcY,
                srcWidth,
                srcHeight,
                0,
                0,
                canvas.width,
                canvas.height
            );

            return await new Promise(function (resolve) {
                canvas.toBlob(function (blob) {
                    resolve(blob || null);
                }, 'image/png');
            });
        } catch {
            return null;
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

    async function prepareImageForOcr(imageBlob) {
        if (!imageBlob || !window.createImageBitmap) {
            return imageBlob;
        }

        let bitmap = null;

        try {
            bitmap = await window.createImageBitmap(imageBlob);

            const canvas = document.createElement('canvas');
            const scale = 1.8;
            const width = Math.max(1, Math.round(bitmap.width * scale));
            const height = Math.max(1, Math.round(bitmap.height * scale));

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d', { willReadFrequently: true });

            if (!ctx) {
                return imageBlob;
            }

            ctx.drawImage(bitmap, 0, 0, width, height);

            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;

            // Boost contrast and binarize softly to reduce holo glare/noise.
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];

                const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
                const contrasted = (luminance - 128) * 1.45 + 128;
                const bin = contrasted > 152 ? 255 : contrasted < 82 ? 0 : contrasted;

                data[i] = bin;
                data[i + 1] = bin;
                data[i + 2] = bin;
            }

            ctx.putImageData(imageData, 0, 0);

            return await new Promise(function (resolve) {
                canvas.toBlob(function (blob) {
                    resolve(blob || imageBlob);
                }, 'image/png');
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

    async function prepareNumberRegionForOcr(imageBlob, invert) {
        if (!imageBlob || !window.createImageBitmap) {
            return imageBlob;
        }

        let bitmap = null;

        try {
            bitmap = await window.createImageBitmap(imageBlob);

            const canvas = document.createElement('canvas');
            const scale = 2.2;
            const width = Math.max(1, Math.round(bitmap.width * scale));
            const height = Math.max(1, Math.round(bitmap.height * scale));

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) {
                return imageBlob;
            }

            ctx.drawImage(bitmap, 0, 0, width, height);

            const imageData = ctx.getImageData(0, 0, width, height);
            const data = imageData.data;
            const threshold = invert ? 124 : 146;

            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];

                let luminance = (0.299 * r) + (0.587 * g) + (0.114 * b);
                luminance = (luminance - 128) * 1.8 + 128;
                luminance = Math.max(0, Math.min(255, luminance));

                if (invert) {
                    luminance = 255 - luminance;
                }

                const bin = luminance >= threshold ? 255 : 0;
                data[i] = bin;
                data[i + 1] = bin;
                data[i + 2] = bin;
            }

            ctx.putImageData(imageData, 0, 0);

            return await new Promise(function (resolve) {
                canvas.toBlob(function (blob) {
                    resolve(blob || imageBlob);
                }, 'image/png');
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

    function extractCardSearchParts(rawText) {
        const originalText = String(rawText || '');

        const collapsedText = originalText
            .replace(/[|\\]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const lines = originalText
            .split(/\r?\n/)
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
        const compact = normalizeCardNumberText(normalized);

        const patterns = [
            /\b(SWSH\s?\d{1,3})\b/i,
            /\b(SV\s?P\s?\d{1,3})\b/i,
            /\b(SVP\s?\d{1,3})\b/i,
            /\b((?:SM|BW|XY)\s?\d{1,3})\b/i,
            /\b(TG\s?\d{1,2}\s?\/\s?TG\s?\d{1,2})\b/i,
            /\b(GG\s?\d{1,2}\s?\/\s?GG\s?\d{1,2})\b/i,
            /\b([A-Z]{0,4}\d{1,3}\s*\/\s*\d{2,3})\b/i,
            /\b(\d{1,3}\s*\/\s*\d{2,3})\b/i,
            /\b((?:SWSH|SVP|SM|BW|XY)\d{1,3})\b/i
        ];

        for (const pattern of patterns) {
            const match = normalized.match(pattern);

            if (match && match[1]) {
                return normalizeExtractedCardNumber(match[1]);
            }
        }

        const compactPatterns = [
            /(\d{1,3}\/\d{2,3})/i,
            /(SWSH\d{1,3})/i,
            /(SVP\d{1,3})/i,
            /(TG\d{1,2}\/TG\d{1,2})/i,
            /(GG\d{1,2}\/GG\d{1,2})/i
        ];

        for (const pattern of compactPatterns) {
            const match = compact.match(pattern);

            if (match && match[1]) {
                return normalizeExtractedCardNumber(match[1]);
            }
        }

        const fusedMatch = compact.match(/(?:^|[^0-9])(\d{5,6})(?:[^0-9]|$)/);

        if (fusedMatch && fusedMatch[1]) {
            const inferred = inferCollectorNumberFromDigits(fusedMatch[1]);

            if (inferred) {
                return normalizeExtractedCardNumber(inferred);
            }
        }

        const noisyDigitsInferred = inferCollectorFromDigitNoise(normalized);

        if (noisyDigitsInferred) {
            return normalizeExtractedCardNumber(noisyDigitsInferred);
        }

        return '';
    }

    function detectCollectorNumberFromCandidateTexts(candidates) {
        const list = Array.isArray(candidates) ? candidates : [];

        for (const candidate of list) {
            const candidateText = typeof candidate === 'string' ? candidate : candidate && candidate.text;
            const explicit = extractExplicitCollectorNumber(String(candidateText || ''));

            if (explicit && isPlausibleDetectedNumber(explicit)) {
                return explicit;
            }
        }

        for (const candidate of list) {
            const candidateText = typeof candidate === 'string' ? candidate : candidate && candidate.text;
            const allowFuzzy = typeof candidate === 'string' ? true : !!(candidate && candidate.allowFuzzy);

            if (!allowFuzzy) {
                continue;
            }

            const detected = fuzzyExtractCollectorNumber(String(candidateText || ''));

            if (detected && isPlausibleDetectedNumber(detected)) {
                return detected;
            }
        }

        return '';
    }

    function hasExplicitCollectorNumber(text) {
        return !!extractExplicitCollectorNumber(text);
    }

    function extractExplicitCollectorNumber(text) {
        const raw = String(text || '').toUpperCase();

        if (!raw) {
            return '';
        }

        const matches = Array.from(raw.matchAll(/(?:^|[^A-Z0-9])([A-Z]{0,4}\s*\d{1,3}\s*\/\s*\d{2,3})(?=$|[^A-Z0-9])/g));

        for (const match of matches) {
            const normalized = normalizeExtractedCardNumber(match && match[1] ? match[1] : '');

            if (normalized && isPlausibleDetectedNumber(normalized)) {
                return normalized;
            }
        }

        const compact = normalizeCardNumberText(raw);
        const compactMatch = compact.match(/(\d{1,3}\/\d{2,3})/);

        if (compactMatch && compactMatch[1]) {
            const normalized = normalizeExtractedCardNumber(compactMatch[1]);

            if (normalized && isPlausibleDetectedNumber(normalized)) {
                return normalized;
            }
        }

        return '';
    }

    function fuzzyExtractCollectorNumber(text) {
        const direct = extractCardNumber(text);

        if (direct && isPlausibleDetectedNumber(direct)) {
            return direct;
        }

        const tokens = String(text || '').toUpperCase().match(/[A-Z0-9/$]{5,12}/g) || [];

        for (const token of tokens) {
            const normalized = normalizeFuzzyCollectorToken(token);

            if (normalized && isPlausibleDetectedNumber(normalized)) {
                return normalized;
            }
        }

        return '';
    }

    function normalizeFuzzyCollectorToken(token) {
        const raw = String(token || '').toUpperCase().replace(/\s+/g, '');

        if (!raw) {
            return '';
        }

        const cleanSlash = raw.match(/(\d{1,3})\/(\d{2,3})/);

        if (cleanSlash) {
            return normalizeExtractedCardNumber(cleanSlash[0]);
        }

        const tailMatch = raw.match(/([A-Z0-9/$]{2,6})(\d{2,3})$/);

        if (!tailMatch) {
            return '';
        }

        const prefix = tailMatch[1];
        const denominator = normalizeFuzzyDigits(tailMatch[2], false);

        if (!denominator || denominator.length < 2) {
            return '';
        }

        const sepIndex = Math.max(prefix.lastIndexOf('/'), prefix.lastIndexOf('S'), prefix.lastIndexOf('$'));
        const numeratorSource = sepIndex >= 0 ? prefix.slice(0, sepIndex) : prefix;
        const numerator = normalizeFuzzyDigits(numeratorSource.slice(-3), true);

        if (!numerator || numerator.length < 2) {
            return '';
        }

        return `${numerator}/${denominator}`;
    }

    function normalizeFuzzyDigits(value, allowAForThree) {
        const chars = String(value || '').toUpperCase().split('');
        const mapped = chars.map(function (char) {
            if (/\d/.test(char)) {
                return char;
            }

            if ('OQDUEC'.indexOf(char) >= 0) {
                return '0';
            }

            if ('ILT!|'.indexOf(char) >= 0) {
                return '1';
            }

            if (char === 'Z') {
                return '2';
            }

            if (allowAForThree && char === 'A') {
                return '3';
            }

            if (char === 'T') {
                return '7';
            }

            if (!allowAForThree && char === 'S') {
                return '5';
            }

            if (char === 'G') {
                return '6';
            }

            if (char === 'B') {
                return '8';
            }

            return '';
        }).join('');

        return mapped.replace(/\D+/g, '');
    }

    function normalizeExtractedCardNumber(rawNumber) {
        const value = String(rawNumber || '')
            .replace(/\s+/g, '')
            .toUpperCase();

        if (!value) {
            return '';
        }

        if (/^(TG\d{1,2}\/TG\d{1,2}|GG\d{1,2}\/GG\d{1,2})$/.test(value)) {
            return value;
        }

        if (value.indexOf('/') >= 0) {
            return normalizeSlashCollectorNumber(value);
        }

        if (/^[A-Z]{1,4}\d{1,3}\/\d{2,3}$/.test(value)) {
            const stripped = value.replace(/^[A-Z]{1,4}(?=\d{1,3}\/\d{2,3}$)/, '');
            return stripped;
        }

        return value;
    }

    function isPlausibleDetectedNumber(value) {
        const raw = String(value || '').toUpperCase().trim();

        if (!raw) {
            return false;
        }

        if (/^(TG\d{1,2}\/TG\d{1,2}|GG\d{1,2}\/GG\d{1,2})$/.test(raw)) {
            return true;
        }

        if (/^(SWSH|SVP|SM|BW|XY)\d{1,3}$/.test(raw)) {
            return true;
        }

        const slashMatch = raw.match(/^(\d{1,3})\/(\d{2,3})$/);

        if (slashMatch) {
            const left = Number(slashMatch[1]);
            const right = Number(slashMatch[2]);

            if (!Number.isFinite(left) || !Number.isFinite(right)) {
                return false;
            }

            if (left < 1 || left > 500) {
                return false;
            }

            if (right < 20 || right > 400) {
                return false;
            }

            const maxOverrun = right <= 100 ? 20 : right <= 200 ? 35 : 60;

            if (left > right + maxOverrun) {
                return false;
            }

            if (left === 1 && right >= 100) {
                return false;
            }

            if (left <= 12 && right <= 40) {
                return false;
            }

            return true;
        }

        return false;
    }

    function isUnverifiedWeakDetectedName(name, number) {
        const value = normalizeDetectedName(name || '');
        const lettersOnly = value.replace(/[^A-Za-z]/g, '');

        // Short OCR tokens are frequently attack text or random prose. Keep them
        // only when the name index returned a match (handled before this check)
        // or a plausible collector number independently supports the detection.
        return Boolean(value)
            && !isPlausibleDetectedNumber(number)
            && !value.includes(' ')
            && lettersOnly.length <= 4;
    }

    function pickBetterDetectedName(currentName, nextName) {
        const current = normalizeDetectedName(currentName);
        const next = normalizeDetectedName(nextName);

        if (!current) {
            return next;
        }

        if (!next) {
            return current;
        }

        if (current.toLowerCase() === next.toLowerCase()) {
            return current.length >= next.length ? current : next;
        }

        if (current.toLowerCase().startsWith(next.toLowerCase()) && current.length - next.length <= 2) {
            return current;
        }

        if (next.toLowerCase().startsWith(current.toLowerCase()) && next.length - current.length <= 4) {
            return next;
        }

        const currentScore = scoreDetectedName(current);
        const nextScore = scoreDetectedName(next);

        return nextScore > currentScore ? next : current;
    }

    function scoreDetectedName(name) {
        const value = normalizeDetectedName(name);

        if (!value) {
            return -1;
        }

        let score = 0;

        if (/^[A-Z][a-z'\-]+(?:\s+[A-Z][a-z'\-]+){0,2}$/.test(value)) {
            score += 5;
        }

        if (value.indexOf("'") >= 0 || value.indexOf(' ') >= 0) {
            score += 2;
        }

        if (value.length >= 6 && value.length <= 14) {
            score += 4;
        } else if (value.length >= 4 && value.length <= 18) {
            score += 2;
        }

        if (/[AEIOUaeiou]/.test(value)) {
            score += 1;
        }

        if (/^M\s+[A-Z][a-z'\-]+(?:\s+[A-Z]{2,5})?$/.test(value)) {
            score += 6;
        }

        if (/\bCharizard\b/i.test(value)) {
            score += 5;
        }

        if (/\b(?:V|EX|GX|VSTAR|VMAX)$/i.test(value)) {
            score += 3;
        }

        const wordLengths = value
            .split(/\s+/)
            .filter(Boolean)
            .map(function (word) {
                return word.replace(/[^A-Za-z]/g, '').length;
            });

        const hasMegaPrefix = /^M\s+[A-Z][a-z'\-]+(?:\s+[A-Z]{2,5})?$/.test(value);
        const hasBattleSuffix = /\b(?:V|EX|GX|VSTAR|VMAX)$/i.test(value);

        // Regional header OCR often turns glare, borders, and symbols into
        // title-cased fragments such as "Fos Se". The old title-case and space
        // bonuses let those fragments replace a correctly read name such as
        // "Cinccino" from the full-card pass. Real multi-word names normally
        // contain at least one substantial token; strongly discount candidates
        // made entirely from tiny OCR fragments.
        if (!hasMegaPrefix && !hasBattleSuffix) {
            if (wordLengths.length > 1 && wordLengths.every(function (length) {
                return length <= 3;
            })) {
                score -= 7;
            } else if (wordLengths.some(function (length) {
                return length <= 2;
            })) {
                score -= 3;
            }
        }

        return score;
    }

    function normalizeDetectedName(name) {
        let value = String(name || '')
            .replace(/[’`]/g, "'")
            .replace(/[^A-Za-z .'-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!value) {
            return '';
        }

        value = expandFusedMegaPrefix(value);

        value = value
            .replace(/^(?:BASIC|FASIC|BACIC|BASICC|BASIG|BASIO|STAGE|STACE|STAGEE|POKEMON|POK MON|POK MON|POKE MON)\s+/i, '')
            .replace(/\s+(?:BASIC|FASIC|STAGE|POKEMON)$/i, '')
            .trim();

        if (/^[A-Z][a-z]{4,}l$/.test(value)) {
            value = value.slice(0, -1);
        }

        if (
            (/(?:\bM[ec]o\s*w[si]car[a-z]{1,7}\b|\bM[a-z]{0,3}w\s*s?carad[a-z]{0,4}\b|\b(?:Meo|Mso|Msw|Mss)w?carad[a-z]{0,4}\b|\b(?:Meo)?w\s*s?carad[a-z]{0,4}\b)/i.test(value))
            && !/\bMeowscarada\b/i.test(value)
        ) {
            value = value.replace(/\bM[ec]o\s*w[si]car[a-z]{1,7}\b/ig, 'Meowscarada');
            value = value.replace(/\bM[a-z]{0,3}w\s*s?carad[a-z]{0,4}\b/ig, 'Meowscarada');
            value = value.replace(/\b(?:Meo|Mso|Msw|Mss)w?carad[a-z]{0,4}\b/ig, 'Meowscarada');
            value = value.replace(/\b(?:Meo)?w\s*s?carad[a-z]{0,4}\b/ig, 'Meowscarada');
        }

        // Some holo scans split/warp the ending into forms like "Meowsem aay".
        // Keep this mapping narrow: must still look like a Meows* token.
        const compactName = value.toLowerCase().replace(/[^a-z]/g, '');
        if (
            !/\bMeowscarada\b/i.test(value)
            && compactName.length >= 8
            && compactName.length <= 14
            && compactName.indexOf('meows') === 0
            && (compactName.indexOf('aay') > 0 || compactName.indexOf('aray') > 0 || compactName.indexOf('arad') > 0)
        ) {
            value = 'Meowscarada';
        }

        if (/\bClaunc[a-z']*\b/i.test(value) && !/\bClauncher\b/i.test(value)) {
            value = value.replace(/Claunc[a-z']*\b/ig, 'Clauncher');
        }

        if (/\b(?:t?chafizand|t?chafizard|chafizand|chafizard|charizand|charizad|charizard)\b/i.test(value)) {
            value = value.replace(/\b(?:t?chafizand|t?chafizard|chafizand|chafizard|charizand|charizad|charizard)\b/ig, 'Charizard');
        }

        if (/^[A-Za-z]{2,4}\s+Charizard(?:\s+(?:V|EX|GX|VSTAR|VMAX))?$/i.test(value)) {
            value = value.replace(/^[A-Za-z]{2,4}\s+/i, '');
        }

        if (/^Charizard\s+Va?$/i.test(value) || /^CharizardVa$/i.test(value) || /^CharizardV$/i.test(value)) {
            value = 'Charizard V';
        }

        // Foil glare repeatedly clips the leading C/R and corrupts the tail of
        // Charmander (for example "ha mander" and "harmandfili"). Normalize
        // these strong shared stems before catalog lookup so the exact indexed
        // name can validate the reading.
        if (/\b(?:c\s*)?ha\s*(?:r\s*)?mand(?:er|[a-z]{0,5})\b/i.test(value)) {
            value = value.replace(/\b(?:c\s*)?ha\s*(?:r\s*)?mand(?:er|[a-z]{0,5})\b/ig, 'Charmander');
        }

        if (/^Clauncher\s+[A-Za-z]{1,3}$/i.test(value)) {
            value = 'Clauncher';
        }

        if (/\bKeldeol\b/i.test(value)) {
            value = value.replace(/Keldeol\b/ig, 'Keldeo');
        }

        if (/\bGiovanni'?s\b/i.test(value) && /\bMachop\b/i.test(value) === false) {
            value = value.replace(/Giovanni'?s\b/ig, "Giovanni's");
        }

        return value;
    }

    function normalizeSlashCollectorNumber(value) {
        const parts = String(value || '').split('/');

        if (parts.length !== 2) {
            return value;
        }

        const leftRaw = parts[0] || '';
        const rightRaw = parts[1] || '';

        const leftDigits = leftRaw
            .replace(/[OQD]/g, '0')
            .replace(/[IL|!]/g, '1')
            .replace(/Z/g, '2')
            .replace(/S/g, '3')
            .replace(/B/g, '8')
            .replace(/G/g, '6')
            .replace(/[^0-9]/g, '');

        const rightDigits = rightRaw
            .replace(/[OQD]/g, '0')
            .replace(/[IL|!]/g, '1')
            .replace(/Z/g, '2')
            .replace(/S/g, '5')
            .replace(/B/g, '8')
            .replace(/G/g, '6')
            .replace(/[^0-9]/g, '');

        if (!leftDigits || rightDigits.length < 2) {
            return value;
        }

        return `${leftDigits}/${rightDigits}`;
    }

    function inferCollectorNumberFromDigits(rawDigits) {
        const digits = String(rawDigits || '').replace(/\D+/g, '');

        if (digits.length === 6) {
            return `${digits.slice(0, 3)}/${digits.slice(3)}`;
        }

        if (digits.length === 5) {
            return `${digits.slice(0, 2)}/${digits.slice(2)}`;
        }

        return '';
    }

    function inferCollectorFromDigitNoise(text) {
        const raw = String(text || '').toUpperCase();
        const digitLike = raw
            .replace(/[OQD]/g, '0')
            .replace(/[IL|!]/g, '1')
            .replace(/Z/g, '2')
            .replace(/S/g, '5')
            .replace(/B/g, '8')
            .replace(/G/g, '6')
            .replace(/[^0-9]/g, '');

        if (digitLike.length < 5) {
            return '';
        }

        const sizes = [6, 5];

        for (const size of sizes) {
            if (digitLike.length < size) {
                continue;
            }

            for (let i = 0; i <= digitLike.length - size; i += 1) {
                const chunk = digitLike.slice(i, i + size);
                const inferred = inferCollectorNumberFromDigits(chunk);

                if (inferred) {
                    return inferred;
                }
            }
        }

        return '';
    }

    function normalizeCardNumberText(text) {
        return String(text || '')
            .replace(/[|]/g, '1')
            .replace(/[OQD]/g, '0')
            .replace(/[,.;:_]/g, '')
            .replace(/\s+/g, '')
            .replace(/[^A-Z0-9/]/g, '');
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

        const hpLine = lines.find(function (line) {
            return /\b(?:HP\s?\d{2,3}|\d{2,3}\s?HP)\b/i.test(line);
        });

        if (hpLine) {
            const hpName = extractNameFromHpLine(hpLine, blockedWords);

            if (hpName) {
                return normalizeDetectedName(hpName);
            }
        }

        const statLineName = extractNameNearTopStatLine(lines, blockedWords);

        if (statLineName) {
            return normalizeDetectedName(statLineName);
        }

        const topLineName = extractNameFromTopLines(lines, blockedWords);

        if (topLineName) {
            return normalizeDetectedName(topLineName);
        }

        let bestFallbackName = '';
        let bestFallbackScore = -1;

        for (const rawLine of lines) {
            const candidate = extractBestNameCandidateFromLine(rawLine, blockedWords);

            if (!candidate) {
                continue;
            }

            const candidateScore = scoreDetectedName(candidate);
            if (candidateScore > bestFallbackScore || (candidateScore === bestFallbackScore && candidate.length > bestFallbackName.length)) {
                bestFallbackName = candidate;
                bestFallbackScore = candidateScore;
            }
        }

        return bestFallbackName;
    }

    function extractNameFromHpLine(rawLine, blockedWords) {
        const cleaned = expandFusedMegaPrefix(String(rawLine || ''))
            .replace(/[’`]/g, "'")
            .replace(/\b(BASIC|FASIC|BACIC|BASIG|STAGE|STACE|STAGE\s?[12]|VMAX|VSTAR|EX|GX|POKEMON)\b/ig, ' ')
            .replace(/\b\d{2,3}\s?HP\b/ig, ' ')
            .replace(/\bHP\s?\d{2,3}\b/ig, ' ')
            .replace(/[^A-Za-z .'-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!cleaned) {
            return '';
        }

        const words = cleaned
            .split(/\s+/)
            .filter(function (word) {
                const lower = word.toLowerCase();

                return lower && !blockedWords.has(lower) && !isLikelyHeaderNoiseWord(lower) && /^[A-Za-z.'-]+$/.test(word);
            });

        if (!words.length) {
            return '';
        }

        const name = words.slice(0, 3).join(' ');

        if (name.length < 3 || name.length > 34) {
            return '';
        }

        return normalizeDetectedName(name);
    }

    function extractNameFromTopLines(lines, blockedWords) {
        const maxLines = Math.min(12, Array.isArray(lines) ? lines.length : 0);
        let bestCandidate = '';
        let bestScore = -1;

        for (let i = 0; i < maxLines; i += 1) {
            const candidate = extractBestNameCandidateFromLine(lines[i], blockedWords);

            if (!candidate) {
                continue;
            }

            const score = scoreDetectedName(candidate) + Math.max(0, 6 - i);

            if (score > bestScore || (score === bestScore && candidate.length > bestCandidate.length)) {
                bestCandidate = candidate;
                bestScore = score;
            }
        }

        return bestCandidate;
    }

    function extractBestNameCandidateFromLine(rawLine, blockedWords) {
        const cleaned = expandFusedMegaPrefix(String(rawLine || ''))
            .replace(/[’`]/g, "'")
            .replace(/\b(BASIC|FASIC|BACIC|BASIG|STAGE|STACE|STAGE\s?[12]|VMAX|VSTAR|EX|GX|POKEMON)\b/ig, ' ')
            .replace(/\bHP\s?\d{2,3}\b/ig, ' ')
            .replace(/[+]?\d{2,3}\b/g, ' ')
            .replace(/[^A-Za-z .'-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!cleaned) {
            return '';
        }

        const words = cleaned
            .split(/\s+/)
            .filter(function (word) {
                const lower = word.toLowerCase();

                if (!lower || blockedWords.has(lower)) {
                    return false;
                }

                if (isLikelyHeaderNoiseWord(lower)) {
                    return false;
                }

                if (!/^[A-Za-z.'-]+$/.test(word)) {
                    return false;
                }

                return /^[A-Za-z][A-Za-z'\-]{2,}$/.test(word)
                    || /^M[A-Za-z'\-]{1,}$/.test(word)
                    || /^(?:V|Va|EX|GX|VSTAR|VMAX)$/i.test(word);
            });

        if (!words.length) {
            return '';
        }

        let bestCandidate = '';
        let bestScore = -1;

        for (let start = 0; start < words.length; start += 1) {
            for (let length = 1; length <= 3 && start + length <= words.length; length += 1) {
                const candidate = normalizeDetectedName(words.slice(start, start + length).join(' '));

                if (!candidate || candidate.length < 4 || candidate.length > 28) {
                    continue;
                }

                const score = scoreDetectedName(candidate);

                if (score > bestScore || (score === bestScore && candidate.length > bestCandidate.length)) {
                    bestCandidate = candidate;
                    bestScore = score;
                }
            }
        }

        return bestCandidate;
    }

    function extractNameNearTopStatLine(lines, blockedWords) {
        const maxLines = Math.min(5, Array.isArray(lines) ? lines.length : 0);

        for (let i = 0; i < maxLines; i += 1) {
            const rawLine = expandFusedMegaPrefix(String(lines[i] || ''));

            if (!rawLine) {
                continue;
            }

            const cleaned = rawLine
                .replace(/[’`]/g, "'")
                .replace(/\b(BASIC|FASIC|BACIC|BASIG|STAGE|STACE|VMAX|VSTAR|EX|GX|POKEMON)\b/ig, ' ')
                .replace(/[^A-Za-z0-9 .'+-]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            if (!cleaned) {
                continue;
            }

            const match = cleaned.match(/([A-Za-z][A-Za-z'\-]{2,}(?:\s+[A-Za-z][A-Za-z'\-]{2,}){0,2})\s*(?:HP\s*)?[+]?\d{2,3}\b/i);

            if (!match || !match[1]) {
                continue;
            }

            const candidate = normalizeDetectedName(match[1]);

            if (!candidate) {
                continue;
            }

            const words = candidate.toLowerCase().split(/\s+/);

            if (words.some(function (word) {
                return blockedWords.has(word) || isLikelyHeaderNoiseWord(word);
            })) {
                continue;
            }

            if (candidate.length >= 4 && candidate.length <= 28) {
                return candidate;
            }
        }

        return '';
    }

    function isLikelyHeaderNoiseWord(lowerWord) {
        return [
            'basic',
            'fasic',
            'bacic',
            'basig',
            'buc',
            'suc',
            'stage',
            'stace',
            'pokemon',
            'pokmon',
            'poin',
            'point',
            'sat'
        ].indexOf(String(lowerWord || '')) >= 0;
    }

    function expandFusedMegaPrefix(value) {
        return String(value || '')
            .replace(/\bM(?=[A-Z][a-z]{2,})/g, 'M ')
            .replace(/\s+/g, ' ')
            .trim();
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

        switch (PV_SCANNER_QUERY_MODE) {
            case 'name-only':
                return name;
            case 'combined':
                return [name, number].filter(Boolean).join(' ').trim();
            case 'number-first':
            default:
                if (number) {
                    return number;
                }

                return name;
        }
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
        syncCaptureFab(elements, 'idle');
    }

    function stopScannerSession(root, elements, state) {
        stopCamera(elements, state);
        resetDetectedFields(elements);
        clearCandidateSuggestions(elements);
        clearSelectedCandidateDisplay(elements);

        state.cameraSessionStarted = false;
        state.capturedBlob = null;
        revokePreviewUrl(state);

        if (elements.preview) {
            elements.preview.hidden = true;
            elements.preview.removeAttribute('src');
        }

        if (elements.empty) elements.empty.hidden = false;
        if (elements.video) elements.video.hidden = true;
        if (elements.captureBtn) elements.captureBtn.hidden = true;
        if (elements.retakeBtn) elements.retakeBtn.hidden = true;
        if (elements.stopBtn) elements.stopBtn.hidden = true;
        if (elements.findCandidatesBtn) elements.findCandidatesBtn.hidden = true;
        if (elements.searchBtn) elements.searchBtn.hidden = true;
        if (elements.searchNearCandidatesBtn) elements.searchNearCandidatesBtn.hidden = true;

        syncSessionButtons(elements, state);
        syncCaptureFab(elements, 'idle');
        setScannerState(root, 'idle');
        setStatus(elements, 'Camera stopped. Tap Start Camera when you are ready.');

        if (root && typeof root.scrollIntoView === 'function') {
            root.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    }

    function syncSessionButtons(elements, state) {
        const sessionStarted = !!state?.cameraSessionStarted;

        if (elements.startBtn) {
            elements.startBtn.hidden = sessionStarted;
        }
    }

    function revokePreviewUrl(state) {
        if (!state || !state.previewUrl) {
            return;
        }

        try {
            URL.revokeObjectURL(state.previewUrl);
        } catch {
            // Ignore cleanup errors.
        }

        state.previewUrl = '';
    }

    function resetDetectedFields(elements) {
        if (elements.detectedName) elements.detectedName.value = '';
        if (elements.detectedNumber) elements.detectedNumber.value = '';
        if (elements.rawOcr) elements.rawOcr.value = '';

        if (elements.findCandidatesBtn) {
            elements.findCandidatesBtn.hidden = true;
        }

        clearNameSuggestion(elements);
        clearCandidateSuggestions(elements);
        clearSelectedCandidateDisplay(elements);
    }

    function showNameSuggestion(elements, name) {
        const suggestedName = normalizeDetectedName(name || '');
        if (!suggestedName || !elements.nameSuggestionWrap) return;

        elements.nameSuggestionWrap.dataset.suggestedName = suggestedName;
        elements.nameSuggestionWrap.hidden = false;
        if (elements.nameSuggestionText) elements.nameSuggestionText.textContent = suggestedName;
    }

    function clearNameSuggestion(elements) {
        if (elements.nameSuggestionWrap) {
            elements.nameSuggestionWrap.hidden = true;
            delete elements.nameSuggestionWrap.dataset.suggestedName;
        }
        if (elements.nameSuggestionText) elements.nameSuggestionText.textContent = '';
    }

    function setBusy(elements, state, isBusy) {
        state.busy = !!isBusy;

        const buttons = [
            elements.startBtn,
            elements.captureBtn,
            elements.captureFabBtn,
            elements.retakeBtn,
            elements.stopBtn,
            elements.searchBtn,
            elements.searchNearCandidatesBtn,
            elements.findCandidatesBtn
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

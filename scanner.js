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
    const PV_SCANNER_QUERY_MODE = 'number-first';
    // Keep vision disabled by default to avoid third-party AI usage/cost.
    const PV_SCANNER_ENABLE_VISION = false;
    const PV_SCANNER_ENABLE_OPENCV_NORMALIZE = false;
    const PV_SCANNER_ENABLE_ADVANCED_OCR_FALLBACK = true;
    const PV_SCANNER_VISION_ENDPOINT = '';
    const PV_SCANNER_VISION_TIMEOUT_MS = 9000;
    const PV_SCANNER_OPENCV_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0/dist/opencv.js';
    const PV_SCANNER_OPENCV_READY_TIMEOUT_MS = 6000;

    function getScannerFeatureFlags() {
        return {
            enableVision: PV_SCANNER_ENABLE_VISION,
            enableOpenCvNormalize: PV_SCANNER_ENABLE_OPENCV_NORMALIZE,
            enableAdvancedOcrFallback: PV_SCANNER_ENABLE_ADVANCED_OCR_FALLBACK,
            visionEndpoint: String(window?.PV_SCANNER_VISION_ENDPOINT || PV_SCANNER_VISION_ENDPOINT || '').trim(),
            visionTimeoutMs: Number(window?.PV_SCANNER_VISION_TIMEOUT_MS || PV_SCANNER_VISION_TIMEOUT_MS) || PV_SCANNER_VISION_TIMEOUT_MS
        };
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
                revokePreviewUrl(state);
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
            revokePreviewUrl(state);
            state.previewUrl = previewUrl;

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
        const targetRatio = 5 / 7;
        const maxWidth = Math.round(width * 0.84);
        const maxHeight = Math.round(height * 0.84);

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

            if (elements.rawOcr) {
                elements.rawOcr.value = combinedRawText;
            }

            if (elements.detectedName) {
                elements.detectedName.value = extracted.name;
            }

            if (elements.detectedNumber) {
                elements.detectedNumber.value = extracted.number;
            }

            dispatchScannerEvent('pv:scanner:detected', {
                rawText: combinedRawText,
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
        // No-AI mode: keep normalization parked to avoid runtime variability.
        // Phase 3 OpenCV path remains in file for later opt-in work.
        return imageBlob;
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
        // No-AI mode: keep vision extraction parked.
        return null;
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

        const fallback = await runRegionalOcrFallback(worker, imageBlob, elements);

        if (fallback.name) {
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

    async function runRegionalOcrFallback(worker, imageBlob, elements) {
        if (!worker || !imageBlob) {
            return { name: '', number: '', raw: '' };
        }

        const regions = [
            { key: 'top', yStart: 0.02, yEnd: 0.32 },
            { key: 'bottom', yStart: 0.76, yEnd: 0.99 }
        ];

        let mergedName = '';
        let mergedNumber = '';
        const rawChunks = [];

        for (const region of regions) {
            const regionBlob = await createRegionBlob(imageBlob, region.yStart, region.yEnd);

            if (!regionBlob) {
                continue;
            }

            setStatus(elements, 'Refining card text from key card areas...');

            const result = await worker.recognize(regionBlob);
            const regionText = String(result?.data?.text || '').trim();

            if (!regionText) {
                continue;
            }

            const parsed = extractCardSearchParts(regionText);

            if (!mergedName && parsed.name) {
                mergedName = parsed.name;
            }

            if (!mergedNumber && parsed.number) {
                mergedNumber = parsed.number;
            }

            rawChunks.push(`[${region.key} region]\n${regionText}`);

            if (region.key === 'top') {
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

            if (region.key === 'bottom' && !mergedNumber) {
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
        } else if (source === 'numeric') {
            score += 1;
        } else if (source === 'preprocessed-numeric') {
            score += 0;
        }

        if (regionKey === 'modern-left-micro' || regionKey === 'vintage-right-micro') {
            score += 5;
        } else if (regionKey === 'modern-left-tight' || regionKey === 'vintage-right-tight') {
            score += 4;
        } else if (regionKey === 'modern-left' || regionKey === 'vintage-right') {
            score += 3;
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

        value = value
            .replace(/^(?:BASIC|FASIC|BACIC|BASICC|BASIG|BASIO|STAGE|STACE|STAGEE|POKEMON|POK MON|POK MON|POKE MON)\s+/i, '')
            .replace(/\s+(?:BASIC|FASIC|STAGE|POKEMON)$/i, '')
            .trim();

        if (/^[A-Z][a-z]{4,}l$/.test(value)) {
            value = value.slice(0, -1);
        }

        if (/\bMeowscarad\b/i.test(value) && !/\bMeowscarada\b/i.test(value)) {
            value = value.replace(/Meowscarad\b/ig, 'Meowscarada');
        }

        if (/\bClaunc[a-z']*\b/i.test(value) && !/\bClauncher\b/i.test(value)) {
            value = value.replace(/Claunc[a-z']*\b/ig, 'Clauncher');
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

        for (const rawLine of lines.slice(0, 12)) {
            const cleaned = rawLine
                .replace(/[^A-Za-z0-9 .'-]/g, ' ')
                .replace(/\b\d{1,3}\s?HP\b/ig, '')
                .replace(/\bHP\s?\d{1,3}\b/ig, '')
                .replace(/\s+/g, ' ')
                .trim();

            if (!cleaned) continue;
            if (cleaned.length < 3 || cleaned.length > 34) continue;
            if (/^\d/.test(cleaned)) continue;
            if (/\b\d+\s?\/\s?\d+\b/.test(cleaned)) continue;
            if (/\b\d{2,3}$/.test(cleaned)) continue;

            const lowerWords = cleaned.toLowerCase().split(/\s+/);

            if (lowerWords.some(function (word) {
                return blockedWords.has(word);
            })) {
                continue;
            }

            return normalizeDetectedName(cleaned);
        }

        return '';
    }

    function extractNameFromHpLine(rawLine, blockedWords) {
        const cleaned = String(rawLine || '')
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
        const maxLines = Math.min(6, Array.isArray(lines) ? lines.length : 0);
        let bestCandidate = '';
        let bestScore = -1;

        for (let i = 0; i < maxLines; i += 1) {
            const rawLine = String(lines[i] || '');

            const cleaned = rawLine
                .replace(/[’`]/g, "'")
                .replace(/\b(BASIC|FASIC|BACIC|BASIG|STAGE|STACE|STAGE\s?[12]|VMAX|VSTAR|EX|GX|POKEMON)\b/ig, ' ')
                .replace(/\bHP\s?\d{2,3}\b/ig, ' ')
                .replace(/[+]?\d{2,3}\b/g, ' ')
                .replace(/[^A-Za-z .'-]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            if (!cleaned) {
                continue;
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

                    return /^[A-Z][a-z'\-]{2,}$/.test(word);
                });

            if (!words.length) {
                continue;
            }

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
        }

        return bestCandidate;
    }

    function extractNameNearTopStatLine(lines, blockedWords) {
        const maxLines = Math.min(5, Array.isArray(lines) ? lines.length : 0);

        for (let i = 0; i < maxLines; i += 1) {
            const rawLine = String(lines[i] || '');

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

    function clearScanner(root, elements, state) {
        stopCamera(elements, state);
        resetDetectedFields(elements);

        state.capturedBlob = null;
        revokePreviewUrl(state);

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
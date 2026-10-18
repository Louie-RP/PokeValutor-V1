import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [scanner, styles, html] = await Promise.all([
    readFile('scanner.js', 'utf8'),
    readFile('scanner.css', 'utf8'),
    readFile('search.html', 'utf8'),
]);

assert.match(html, /id="pv-card-scanner-root" data-target-input="pv-search-query" data-target-form="pv-search-form"/);
assert.match(html, /src="scanner\.js\?v=20261018-14"/);
assert.match(html, /href="scanner\.css\?v=20261018-14"/);

assert.doesNotMatch(scanner, /Use your phone camera to scan a card, review the detected text, then search for the best match\./);
assert.doesNotMatch(scanner, /Place the card inside the frame, reduce glare, then tap Capture\./);
assert.match(scanner, /setScannerState\(root, 'camera'\);[\s\S]*?setStatus\(elements, ''\);/);
assert.match(scanner, /elements\.status\.textContent = message \|\| '';\s*elements\.status\.hidden = !message;/);
assert.match(scanner, /id="pv-cardScanner-video" class="pv-cardScanner__video" autoplay playsinline muted hidden/);
assert.match(scanner, /id="pv-cardScanner-capture-fab"[^>]*aria-label="Capture card"/);
assert.match(scanner, /id="pv-cardScanner-flash"[^>]*aria-label="Turn flash on" aria-pressed="false" hidden/);
assert.match(scanner, /id="pv-cardScanner-camera" class="pv-cardScanner__cameraSelect" aria-label="Camera lens"/);
assert.match(scanner, /videoConstraints\.facingMode = \{ exact: 'environment' \}/);
assert.match(scanner, /cameraRequest\.video\.facingMode = \{ ideal: 'environment' \}/);
assert.match(scanner, /function isRearCameraConstraintError\(error\)[\s\S]*?error\?\.name === 'OverconstrainedError'[\s\S]*?error\?\.name === 'NotFoundError'/);
assert.match(scanner, /currentCameraOption\.textContent = 'Back camera \(default\)'/);
assert.match(scanner, /if \(selectedCameraId === state\.selectedCameraId\) \{\s*return;/);
assert.doesNotMatch(scanner, /const activeDeviceId = state\.cameraTrack\?\.getSettings/);
assert.match(scanner, /videoConstraints\.deviceId = \{ exact: selectedCameraId \}/);
assert.match(scanner, /navigator\.mediaDevices\?\.enumerateDevices/);
assert.match(scanner, /\.filter\(\(device\) => device\.kind === 'videoinput' && device\.deviceId\)/);
assert.match(scanner, /option\.textContent = camera\.label\.trim\(\) \|\| `Camera \$\{index \+ 1\}`/);
assert.match(scanner, /elements\.cameraSelect\.addEventListener\('change'/);
assert.match(scanner, /if \(elements\.cameraControl\) \{\s*elements\.cameraControl\.hidden = true;/);
assert.match(scanner, /stopCamera\(elements, state\);\s*setScannerState\(root, 'starting'\);[\s\S]*?elements\.video\.srcObject = state\.stream;\s*elements\.video\.hidden = false;\s*await elements\.video\.play\(\);\s*await waitForVideoDimensions\(elements\.video\);\s*setScannerState\(root, 'camera'\);\s*startLivePreview\(root, elements, state\)/);
assert.match(scanner, /function startLivePreview[\s\S]*?Math\.max\(width \/ video\.videoWidth, height \/ video\.videoHeight\)[\s\S]*?context\.drawImage\([\s\S]*?canvas\.hidden = false/);
assert.match(scanner, /function stopCamera[\s\S]*?cancelAnimationFrame\(state\.previewAnimationId\)[\s\S]*?elements\.liveCanvas\.hidden = true/);
assert.match(scanner, /live preview error[\s\S]*?stopCamera\(elements, state\)/);
assert.match(scanner, /const isCompactCameraLayout = window\.matchMedia[\s\S]*?window\.matchMedia\('\(max-width: 768px\)'\)\.matches;[\s\S]*?width: \{ ideal: 720 \},\s*height: \{ ideal: 1280 \},\s*aspectRatio: \{ ideal: 5 \/ 8 \}/);
assert.doesNotMatch(scanner, /fitCameraVideoToStage|video\.style\.width\s*=|video\.style\.height\s*=/);
assert.match(scanner, /function waitForVideoDimensions\(video\)[\s\S]*?video\.videoWidth > 0 && video\.videoHeight > 0[\s\S]*?video\.addEventListener\('loadedmetadata'/);
assert.match(scanner, /elements\.video\.style\.removeProperty\('visibility'\);\s*elements\.video\.pause\(\);\s*elements\.video\.srcObject = null/);
assert.match(scanner, /track\.getCapabilities\(\)/);
assert.match(scanner, /capabilities\?\.torch === true && typeof track\?\.applyConstraints === 'function'/);
assert.match(scanner, /advanced: \[\{ torch: nextTorchState \}\]/);
assert.match(scanner, /function syncCameraTorchButton\(elements, state\)[\s\S]*?button\.hidden = !available/);
assert.match(scanner, /catch \(error\) \{\s*console\.warn\('\[PokeValutor Scanner\] unable to toggle camera flash', error\);\s*setStatus\(elements, `Unable to turn the flash/);
assert.match(scanner, /state\.torchSupported = false;\s*state\.torchEnabled = false;\s*syncCameraTorchButton\(elements, state\)/);
assert.match(scanner, /const crop = getCenteredCrop\(sourceWidth, sourceHeight\)/);
assert.match(scanner, /ctx\.drawImage\(\s*video,\s*crop\.x,\s*crop\.y,\s*crop\.width,\s*crop\.height/s);
assert.match(scanner, /const targetRatio = isCompactViewport \? 5 \/ 8 : 5 \/ 7/);
assert.match(scanner, /window\.addEventListener\('resize', function \(\) \{\s*syncCaptureFab\(elements, state\.stream \? 'camera' : 'idle'\)/);

assert.match(styles, /width: min\(100%, 28rem, 42vh\);\s*aspect-ratio: auto/);
assert.match(styles, /width: 80%;\s*height: 80%;\s*max-height: none;\s*aspect-ratio: 5 \/ 7/);
assert.match(styles, /padding-top: 140%/);
assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?padding-top: 160%/);
assert.match(styles, /height: 70%;\s*aspect-ratio: 5 \/ 7/);
assert.match(styles, /width: 4\.25rem;\s*height: 4\.25rem;[\s\S]*?#pv-search-body\.pv-searchRefresh \.pv-cardScanner[\s\S]*?border-radius: 50%/);
assert.match(styles, /object-fit: cover/);
assert.match(styles, /\.pv-cardScanner__cameraWrap \{\s*position: relative;\s*min-height: 0;\s*border: 1px dashed/);
assert.match(styles, /\.pv-cardScanner\[data-state="starting"\] \.pv-cardScanner__cameraWrap,[\s\S]*?border: 0;\s*border-radius: 12px;\s*background: transparent/);
assert.match(styles, /\.pv-cardScanner__video,\s*\.pv-cardScanner__live,\s*\.pv-cardScanner__preview \{\s*display: block;\s*position: absolute;\s*inset: 0;\s*width: 100%;\s*height: 100%;[\s\S]*?object-fit: cover;\s*object-position: center/);
assert.match(styles, /\.pv-cardScanner__video \{\s*opacity: 0;\s*pointer-events: none/);
assert.doesNotMatch(styles, /object-fit:\s*fill/);
assert.doesNotMatch(styles, /\.pv-cardScanner__video,\s*\.pv-cardScanner__preview\s*\{\s*max-height:\s*58vh/);
assert.match(styles, /linear-gradient\(var\(--pv-primary, #ffcb05\), var\(--pv-primary, #ffcb05\)\) left top \/ 3px 26px no-repeat/);
assert.match(styles, /background-size: 100% 15%, 100% 15%, 10% 70%, 10% 70%/);
assert.match(styles, /\.pv-cardScanner\[data-state="camera"\] \.pv-cardScanner__frame \{[^}]*box-shadow: none/s);
assert.match(styles, /background: rgba\(8, 13, 25, 0\.34\)/);
assert.match(styles, /env\(safe-area-inset-bottom/);

console.log('Scanner camera layout preserves the existing capture and search flow.');

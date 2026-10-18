import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [scanner, styles, html] = await Promise.all([
    readFile('scanner.js', 'utf8'),
    readFile('scanner.css', 'utf8'),
    readFile('search.html', 'utf8'),
]);

assert.match(html, /id="pv-card-scanner-root" data-target-input="pv-search-query" data-target-form="pv-search-form"/);
assert.match(html, /src="scanner\.js\?v=20261018-2"/);
assert.match(html, /href="scanner\.css\?v=20261018-2"/);

assert.doesNotMatch(scanner, /Use your phone camera to scan a card, review the detected text, then search for the best match\./);
assert.doesNotMatch(scanner, /Place the card inside the frame, reduce glare, then tap Capture\./);
assert.match(scanner, /setScannerState\(root, 'camera'\);\s*setStatus\(elements, ''\);/);
assert.match(scanner, /elements\.status\.textContent = message \|\| '';\s*elements\.status\.hidden = !message;/);
assert.match(scanner, /id="pv-cardScanner-video" class="pv-cardScanner__video" autoplay playsinline muted hidden/);
assert.match(scanner, /id="pv-cardScanner-capture-fab"[^>]*aria-label="Capture card"/);
assert.match(scanner, /id="pv-cardScanner-flash"[^>]*aria-label="Turn flash on" aria-pressed="false" hidden/);
assert.match(scanner, /facingMode: \{ ideal: 'environment' \}/);
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

assert.match(styles, /data-state="camera"[^}]*\.pv-cardScanner__cameraWrap/s);
assert.match(styles, /width: min\(100%, 28rem, 42vh\);\s*aspect-ratio: 5 \/ 7/);
assert.match(styles, /width: 86%;\s*height: auto;\s*max-height: none;\s*aspect-ratio: 5 \/ 7/);
assert.match(styles, /@media \(max-width: 768px\)[\s\S]*?width: min\(100%, 36vh\);\s*aspect-ratio: 5 \/ 8/);
assert.match(styles, /aspect-ratio: 5 \/ 8/);
assert.match(styles, /width: 4\.25rem;\s*height: 4\.25rem;[\s\S]*?#pv-search-body\.pv-searchRefresh \.pv-cardScanner[\s\S]*?border-radius: 50%/);
assert.match(styles, /object-fit: cover/);
assert.match(styles, /env\(safe-area-inset-bottom/);

console.log('Scanner camera layout preserves the existing capture and search flow.');

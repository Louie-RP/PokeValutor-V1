/*
  Integration-style harness for scrydex-worker.js CardSight endpoint.
  Runs without Cloudflare by evaluating the worker module in a VM context.
*/

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function loadWorker(fetchImpl) {
  const workerPath = path.resolve(__dirname, '../../scrydex-worker.js');
  const code = fs.readFileSync(workerPath, 'utf8');

  const context = vm.createContext({
    console,
    fetch: fetchImpl,
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams,
    FormData,
    Blob,
    AbortController,
    TextEncoder,
    TextDecoder,
    crypto,
    atob,
    btoa,
    setTimeout,
    clearTimeout,
    Map,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    JSON,
    RegExp,
    Object,
    Error,
  });

  const module = new vm.SourceTextModule(code, { context });
  await module.link(() => {
    throw new Error('Unexpected import in worker module.');
  });
  await module.evaluate();

  const worker = module.namespace.default;
  assert(worker && typeof worker.fetch === 'function', 'Worker default export fetch() not found.');
  return worker;
}

async function run() {
  let upstreamCalls = 0;
  let catalogCalls = 0;

  const mockFetch = async (url, init = {}) => {
    const u = String(url || '');

    // Only CardSight upstream call should happen in these tests.
    if (u === 'https://api.cardsight.ai/v1/identify/card') {
      upstreamCalls += 1;
      const apiKey = String(init.headers && (init.headers['x-api-key'] || init.headers['X-API-Key']) || '');
      assert(apiKey === 'test_cardsight_key_32_chars_123456', 'X-API-Key header missing or incorrect.');
      assert(init.body instanceof FormData, 'CardSight request body is not multipart FormData.');

      return new Response(JSON.stringify({
        success: true,
        requestId: 'req-test-123',
        processingTime: 150,
        detections: [
          {
            confidence: 'High',
            card: {
              id: 'provider-card-1',
              name: 'Mega Charizard X ex',
              number: '125',
              releaseName: 'Phantasmal Flames',
              setName: 'Checklist',
              fields: [
                { key: 'RELEASE_CODE', value: 'PFL' },
                { key: 'PRINTED_TOTAL', value: '094' }
              ]
            }
          }
        ],
        messages: [
          { type: 'warning', message: 'Image resolution (367x512) is below the recommended size for accurate results.' }
        ]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }

    if (u === 'https://catalog.example/scanner/candidates') {
      catalogCalls += 1;
      const secret = String(init.headers && (init.headers['x-pv-catalog-secret'] || init.headers['X-PV-Catalog-Secret']) || '');
      assert(secret === 'catalog_secret_value', 'Catalog secret header missing or incorrect.');

      return new Response(JSON.stringify({
        ok: true,
        source: 'firestore-cardCatalog',
        data: [
          {
            id: 'internal-card-123',
            name: 'Mega Charizard X ex',
            number: '125/094',
            expansion: { id: 'svx', name: 'Phantasmal Flames' }
          }
        ]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }

    throw new Error(`Unexpected fetch URL in test: ${u}`);
  };

  const worker = await loadWorker(mockFetch);
  const ctx = { waitUntil: () => {} };

  // Case 1: Disabled endpoint.
  {
    const req = new Request('https://worker.test/scanner/cardsight/identify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageBase64: 'aGVsbG8=' })
    });
    const env = {
      SCANNER_CARDSIGHT_ENABLED: '0'
    };

    const res = await worker.fetch(req, env, ctx);
    const body = await res.json();

    assert(res.status === 503, `Expected 503 when disabled, got ${res.status}`);
    assert(body && body.ok === false, 'Expected ok=false when disabled.');
  }

  // Case 2: Enabled but missing image payload.
  {
    const req = new Request('https://worker.test/scanner/cardsight/identify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    const env = {
      SCANNER_CARDSIGHT_ENABLED: '1',
      SCANNER_CARDSIGHT_API_KEY: 'test_cardsight_key_32_chars_123456',
      SCANNER_CARDSIGHT_IDENTIFY_URL: 'https://api.cardsight.ai/v1/identify/card'
    };

    const res = await worker.fetch(req, env, ctx);
    const body = await res.json();

    assert(res.status === 400, `Expected 400 for missing image, got ${res.status}`);
    assert(body && body.ok === false, 'Expected ok=false for missing image.');
  }

  // Case 3: Success path with data URL input.
  {
    const onePixelPngDataUrl =
      'data:image/png;base64,' +
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    const req = new Request('https://worker.test/scanner/cardsight/identify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        imageDataUrl: onePixelPngDataUrl,
        maxDetections: 3
      })
    });

    const env = {
      SCANNER_CARDSIGHT_ENABLED: '1',
      SCANNER_CARDSIGHT_API_KEY: 'test_cardsight_key_32_chars_123456',
      SCANNER_CARDSIGHT_IDENTIFY_URL: 'https://api.cardsight.ai/v1/identify/card',
      SCANNER_CARDSIGHT_MAX_DETECTIONS: '5',
      SCANNER_CARDSIGHT_TIMEOUT_MS: '6000',
      CARD_CATALOG_CANDIDATES_ENABLED: '1',
      CARD_CATALOG_CANDIDATES_URL: 'https://catalog.example/scanner/candidates',
      CARD_CATALOG_CANDIDATES_SECRET: 'catalog_secret_value'
    };

    const res = await worker.fetch(req, env, ctx);
    const body = await res.json();

    if (res.status !== 200) {
      console.error('Unexpected success-case status/body:', res.status, body);
    }

    assert(res.status === 200, `Expected 200 on success, got ${res.status}`);
    assert(body && body.ok === true, 'Expected ok=true on success.');
    assert(body.provider === 'cardsight', 'Expected provider=cardsight.');
    assert(Array.isArray(body.detections) && body.detections.length === 1, 'Expected one normalized detection.');
    assert(body.detections[0].displayNumber === '125/094', `Expected displayNumber 125/094, got ${body.detections[0].displayNumber}`);
    assert(Array.isArray(body.warnings) && body.warnings[0] && body.warnings[0].code === 'LOW_IMAGE_RESOLUTION', 'Expected normalized low-resolution warning.');
    assert(Array.isArray(body.resolvedCandidates) && body.resolvedCandidates.length === 1, 'Expected one resolved internal candidate.');
    assert(body.resolvedCandidates[0].id === 'internal-card-123', 'Expected resolved internal card id.');
    assert(body.diagnostics && typeof body.diagnostics === 'object', 'Expected diagnostics object in response.');
    assert(body.diagnostics.providerRequestId === 'req-test-123', 'Expected diagnostics providerRequestId.');
    assert(Array.isArray(body.diagnostics.warningCodes) && body.diagnostics.warningCodes.includes('LOW_IMAGE_RESOLUTION'), 'Expected diagnostics warningCodes.');
    assert(Array.isArray(body.diagnostics.resolvedCandidateIdsTop3) && body.diagnostics.resolvedCandidateIdsTop3[0] === 'internal-card-123', 'Expected diagnostics resolved top candidate id.');
  }

  assert(upstreamCalls === 1, `Expected 1 upstream call, got ${upstreamCalls}`);
  assert(catalogCalls >= 1, `Expected at least 1 catalog resolution call, got ${catalogCalls}`);

  console.log('CardSight worker endpoint tests passed.');
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

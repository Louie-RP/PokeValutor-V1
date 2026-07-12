/*
  Fixture test for CardSight normalization helpers.
  Keep helper behavior in sync with scrydex-worker.js.
*/

const fs = require('fs');
const path = require('path');

const CARDSIGHT_CONFIDENCE_SCORE = {
  high: 0.95,
  medium: 0.75,
  low: 0.50,
};

function fieldsToMap(fields) {
  const result = {};

  for (const entry of Array.isArray(fields) ? fields : []) {
    const key = String(entry && entry.key || '').trim().toUpperCase();
    if (!key) continue;
    result[key] = String(entry && entry.value || '').trim();
  }

  return result;
}

function buildCardSightCollectorNumber(card, fieldMap) {
  const number = String(card && card.number || '').trim();
  const printedTotal = String(fieldMap && fieldMap.PRINTED_TOTAL || '').trim();

  if (!number) return '';
  if (number.includes('/')) return number;
  if (!printedTotal) return number;

  return `${number}/${printedTotal}`;
}

function normalizeCardSightMessages(messages) {
  return (Array.isArray(messages) ? messages : []).map((item) => {
    const message = String(item && item.message || '').trim();
    const lower = message.toLowerCase();

    if (lower.includes('resolution') && lower.includes('below')) {
      return {
        code: 'LOW_IMAGE_RESOLUTION',
        type: 'warning',
        message: 'Move closer and keep the full card inside the frame for a clearer scan.',
      };
    }

    return {
      code: 'PROVIDER_WARNING',
      type: String(item && item.type || 'warning').trim().toLowerCase() || 'warning',
      message: 'The card image may be difficult to identify. Try retaking the photo.',
    };
  });
}

function normalizeCardSightDetection(detection) {
  const card = detection && detection.card || {};
  const fieldMap = fieldsToMap(card.fields);

  const confidenceLabel = String(detection && detection.confidence || '')
    .trim()
    .toLowerCase();

  const confidenceScore = CARDSIGHT_CONFIDENCE_SCORE[confidenceLabel] || 0.40;

  return {
    provider: 'cardsight',
    providerCardId: String(card.id || ''),
    providerSegmentId: String(card.segmentId || ''),
    providerReleaseId: String(card.releaseId || ''),
    providerSetId: String(card.setId || ''),

    name: String(card.name || '').trim(),
    number: String(card.number || '').trim(),
    displayNumber: buildCardSightCollectorNumber(card, fieldMap),

    releaseName: String(card.releaseName || '').trim(),
    providerSetName: String(card.setName || '').trim(),
    releaseCode: String(fieldMap.RELEASE_CODE || '').trim(),
    language: String(fieldMap.LANGUAGE || '').trim(),
    rarity: String(fieldMap.RARITY || '').trim(),
    series: String(fieldMap.SERIES || '').trim(),
    actualTotal: String(fieldMap.ACTUAL_TOTAL || '').trim(),
    printedTotal: String(fieldMap.PRINTED_TOTAL || '').trim(),

    year: String(card.year || '').trim(),
    manufacturer: String(card.manufacturer || '').trim(),
    attributes: Array.isArray(card.attributes) ? card.attributes : [],

    confidenceLabel,
    confidenceScore,

    rawProviderMetadata: {
      requestSafe: true,
    },
  };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected "${expected}" but got "${actual}"`);
  }
}

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function run() {
  const fixturePath = path.resolve(__dirname, '../../docs/fixtures/cardsight-sample-response.json');
  const payload = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  const normalized = normalizeCardSightDetection(payload.detections[0]);
  const warnings = normalizeCardSightMessages(payload.messages);

  assertEqual(normalized.provider, 'cardsight', 'provider');
  assertEqual(normalized.name, 'Mega Charizard X ex', 'name');
  assertEqual(normalized.number, '125', 'number');
  assertEqual(normalized.displayNumber, '125/094', 'displayNumber');
  assertEqual(normalized.releaseName, 'Phantasmal Flames', 'releaseName');
  assertEqual(normalized.providerSetName, 'Checklist', 'providerSetName');
  assertEqual(normalized.releaseCode, 'PFL', 'releaseCode');
  assertEqual(String(normalized.confidenceScore), '0.95', 'confidenceScore');
  assertEqual(warnings[0].code, 'LOW_IMAGE_RESOLUTION', 'warningCode');

  assert(normalized.rawProviderMetadata && normalized.rawProviderMetadata.requestSafe === true, 'requestSafe marker missing');

  console.log('CardSight mapping fixture test passed.');
}

run();

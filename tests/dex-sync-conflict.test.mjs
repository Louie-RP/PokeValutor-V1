import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function extractFunction(source, name) {
    const asyncStart = source.indexOf(`async function ${name}(`);
    const syncStart = source.indexOf(`function ${name}(`);
    const start = asyncStart >= 0 ? asyncStart : syncStart;
    assert.ok(start >= 0, `${name} should exist`);
    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(start, index + 1);
        }
    }
    throw new Error(`Could not extract ${name}`);
}

const firebaseSource = await readFile('firebase.js', 'utf8');
const saveDexStateSource = extractFunction(firebaseSource, 'saveDexState');

assert.match(saveDexStateSource, /db\.runTransaction/);
assert.match(saveDexStateSource, /currentRevision !== expectedRevision/);
assert.match(saveDexStateSource, /saved:\s*false[\s\S]*conflict:\s*true/);
assert.match(saveDexStateSource, /revision:\s*expectedRevision \+ 1/);
const revisionCheckIndex = saveDexStateSource.indexOf('currentRevision !== expectedRevision');
const transactionWriteIndex = saveDexStateSource.indexOf('transaction.set(');
assert.ok(revisionCheckIndex >= 0 && transactionWriteIndex > revisionCheckIndex,
    'the stale revision check must happen before the transaction write');

for (const file of ['dex-tracker-pages.js', 'search.js']) {
    const source = await readFile(file, 'utf8');
    const handlerSource = extractFunction(source, 'handleDexCloudSaveResult');
    assert.match(handlerSource, /writeDexCloudRevision\(result\.revision\)/);
    assert.match(handlerSource, /readDexStateUpdatedAt\(\)\s*<=\s*getDexUpdatedAt\(submittedUpdatedAt\)/);
    assert.match(handlerSource, /writeDexStateUpdatedAt\(result\.updatedAt\)/);
}

const rules = await readFile('firestore.rules', 'utf8');
assert.match(rules, /request\.resource\.data\.revision is int/);
assert.match(rules, /request\.resource\.data\.revision > 0/);
assert.match(rules, /request\.resource\.data\.revision == resource\.data\.revision \+ 1/);

// XSS regression checks for cloud/API values and the downstream select renderers they reach.
const unsafeHtmlSink = /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/;
for (const file of ['dex-tracker-pages.js', 'search.js']) {
    const source = await readFile(file, 'utf8');
    const start = source.indexOf('function handleDexCloudSaveResult(');
    const end = source.indexOf('\n    function ', start + 1);
    assert.ok(start >= 0 && end > start);
    assert.doesNotMatch(source.slice(start, end), unsafeHtmlSink, `${file} conflict handler must avoid unsafe HTML sinks`);
}

const searchSource = await readFile('search.js', 'utf8');
assert.doesNotMatch(searchSource, unsafeHtmlSink,
    'search.js must not use unsafe HTML sinks anywhere');
for (const functionName of [
    'setSetFilterLoadingUi',
    'renderSeriesOptions',
    'renderSetOptionsForSeries',
    'renderSearchCollectionContext',
    'renderFavorites',
    'createPriceDisplayFragment',
    'setCardPricesDisplay',
    'renderCards',
]) {
    assert.doesNotMatch(extractFunction(searchSource, functionName), unsafeHtmlSink,
        `${functionName} must render API/cloud values without unsafe HTML sinks`);
}
const sealedSource = await readFile('sealed.js', 'utf8');
assert.doesNotMatch(extractFunction(sealedSource, 'renderSealedCollectionContext'), unsafeHtmlSink,
    'renderSealedCollectionContext must render cloud values without unsafe HTML sinks');
assert.doesNotMatch(await readFile('tests/dex-sync-conflict.test.mjs', 'utf8'),
    /\b(?:eval|Function|runInContext|runInNewContext)\s*\(/,
    'security tests must not dynamically execute source text');

console.log('Dex stale-write conflict and XSS checks passed.');

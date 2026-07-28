'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourcePaths = [
    '../../card.js',
    '../../price-history-chart.js',
    '../../price-history.js',
    '../../price-history-local.js',
    '../../pv-dom.js',
].map((relativePath) => path.resolve(__dirname, relativePath));
const forbiddenSinks = /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/g;
const matches = sourcePaths.flatMap((sourcePath) => {
    const source = fs.readFileSync(sourcePath, 'utf8');
    return (source.match(forbiddenSinks) || []).map((sink) => ({
        file: path.basename(sourcePath),
        sink,
    }));
});

assert.deepEqual(
    matches,
    [],
    `Card rendering must not use unsafe HTML sinks: ${JSON.stringify(matches)}`
);

const domSource = fs.readFileSync(path.resolve(__dirname, '../../pv-dom.js'), 'utf8');
assert.match(domSource, /textContent\s*=\s*String\(text\)/);

global.document = {
    createElement(tagName) {
        return {
            tagName,
            attributes: {},
            setAttribute(name, value) {
                this.attributes[name] = value;
            },
        };
    },
    createElementNS(namespace, tagName) {
        return this.createElement(tagName);
    },
};
const { createElement } = require('../../pv-dom.js');
const hostileText = '<img src=x onerror=alert(1)>';
const rendered = createElement('span', { text: hostileText });
assert.equal(rendered.textContent, hostileText);
assert.equal(rendered.innerHTML, undefined);

const hostileAttributeValue = 'preview" onerror="alert(1)';
const attributed = createElement('span', {
    attributes: { title: hostileAttributeValue },
});
assert.equal(attributed.attributes.title, hostileAttributeValue);
assert.equal(attributed.attributes.onerror, undefined);

console.log('Price history XSS static check passed.');

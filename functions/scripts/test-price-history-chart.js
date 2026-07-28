'use strict';

const assert = require('node:assert/strict');

class TestNode {
    constructor(nodeName, nodeType = 1) {
        this.nodeName = nodeName;
        this.nodeType = nodeType;
        this.childNodes = [];
        this.attributes = {};
        this.style = {};
        this.classList = {
            add() {},
            remove() {},
            toggle() {},
        };
    }

    append(...nodes) {
        this.childNodes.push(...nodes);
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    getAttribute(name) {
        return this.attributes[name] ?? null;
    }

    addEventListener() {}

    querySelector(nodeName) {
        const pending = [...this.childNodes];
        while (pending.length) {
            const node = pending.shift();
            if (node?.nodeName === nodeName) return node;
            pending.push(...(node?.childNodes || []));
        }
        return null;
    }
}

global.document = {
    createElement(tagName) {
        return new TestNode(tagName);
    },
    createElementNS(_namespace, tagName) {
        return new TestNode(tagName);
    },
    createDocumentFragment() {
        return new TestNode('#document-fragment', 11);
    },
};
require('../../pv-dom.js');
const chart = require('../../price-history-chart.js');

assert.deepEqual(chart.niceScale(10, 20), {
    min: 10,
    max: 20,
    step: 5,
});
assert.deepEqual(chart.niceScale(4, 4), {
    min: 4,
    max: 4.5,
    step: 0.5,
});
assert.equal(
    chart.formatDate(new Date(Date.UTC(2026, 6, 28))),
    'Jul 28'
);
assert.equal(
    chart.formatDate(new Date(Date.UTC(2026, 6, 28)), true),
    'July 28, 2026'
);

const fragment = chart.build({
    rows: [
        { date: new Date(Date.UTC(2026, 6, 27)), market: 10 },
        { date: new Date(Date.UTC(2026, 6, 28)), market: 12 },
    ],
    selectedVariant: 'holofoil',
    getVariantColor: () => ({ color: '#34d399' }),
});
assert.equal(fragment.nodeType, 11);
const svg = fragment.querySelector('svg');
assert.ok(svg);
assert.equal(svg.getAttribute('role'), 'img');
assert.equal(svg.getAttribute('aria-label'), 'Near Mint market price history');

console.log('Price history chart checks passed.');

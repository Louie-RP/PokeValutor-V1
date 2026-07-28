'use strict';

const assert = require('node:assert/strict');
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

console.log('Price history chart checks passed.');

'use strict';

const assert = require('node:assert/strict');
const data = require('../../price-history-data.js');
const localHistory = require('../../price-history-local.js');

const payload = {
    data: [
        { date: '2026-07-03', prices: [{ market: '12.50', low: '10' }] },
        { date: 'invalid', prices: [{ market: 99 }] },
        { date: '2026-07-01', prices: [{ market: 10, low: null }] },
        { date: '2026-07-02', prices: [{ market: null }] },
    ],
};
const rows = data.normalizeRows(payload);

assert.equal(rows.length, 2);
assert.equal(rows[0].dateLabel, '2026-07-01');
assert.equal(rows[1].market, 12.5);
assert.deepEqual(data.calculateMetrics(rows), {
    high: 12.5,
    low: 10,
    average: 11.25,
});
assert.deepEqual(data.calculateMetrics([]), {
    high: null,
    low: null,
    average: null,
});
assert.deepEqual(data.filterRowsForRange([], 1), []);
assert.equal(data.filterRowsForRange(rows, 1).length, 1);
assert.equal(data.parseScrydexDate('2026-02-30'), null);
assert.equal(data.parseScrydexDate('2026-07-01').toISOString(), '2026-07-01T00:00:00.000Z');
assert.equal(data.parseScrydexDate('2026/07/01').toISOString(), '2026-07-01T00:00:00.000Z');

const storage = {
    getItem() {
        return JSON.stringify([
            { ts: 1, market: 2 },
            { ts: 'bad', market: 4 },
            { ts: 3, market: 6 },
        ]);
    },
};
assert.deepEqual(localHistory.getRows(storage, 'card', 'holofoil', 'NM'), [
    { ts: 3, market: 6 },
    { ts: 1, market: 2 },
]);
for (const storedValue of ['null', '{}']) {
    assert.deepEqual(localHistory.getRows({
        getItem() {
            return storedValue;
        },
    }, 'card', 'holofoil', 'NM'), []);
}

console.log('Price history data checks passed.');

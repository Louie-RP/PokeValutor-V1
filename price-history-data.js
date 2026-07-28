(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.PV_PRICE_HISTORY_DATA = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function parseScrydexDate(value) {
        const match = String(value || '').trim().match(/^(\d{4})([/-])(\d{2})\2(\d{2})$/);
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[3]);
        const day = Number(match[4]);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (
            date.getUTCFullYear() !== year
            || date.getUTCMonth() !== month - 1
            || date.getUTCDate() !== day
        ) {
            return null;
        }
        return date;
    }

    function finiteNumberOrNull(value) {
        if (value === null || value === undefined || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function normalizeRows(payload) {
        return (Array.isArray(payload?.data) ? payload.data : [])
            .map((row) => {
                const date = parseScrydexDate(row?.date);
                const price = Array.isArray(row?.prices) ? row.prices[0] : null;
                return {
                    date,
                    dateLabel: String(row?.date || ''),
                    market: finiteNumberOrNull(price?.market),
                    low: finiteNumberOrNull(price?.low),
                };
            })
            .filter((row) => row.date && Number.isFinite(row.market))
            .sort((a, b) => a.date - b.date);
    }

    function filterRowsForRange(rows, days) {
        if (!Array.isArray(rows) || !rows.length) return [];
        const latest = rows[rows.length - 1].date.getTime();
        const threshold = latest - days * 24 * 60 * 60 * 1000;
        return rows.filter((row) => row.date.getTime() >= threshold);
    }

    function calculateMetrics(rows) {
        const values = (Array.isArray(rows) ? rows : [])
            .map((row) => row.market)
            .filter(Number.isFinite);
        if (!values.length) return { high: null, low: null, average: null };
        return {
            high: Math.max(...values),
            low: Math.min(...values),
            average: values.reduce((sum, value) => sum + value, 0) / values.length,
        };
    }

    return {
        calculateMetrics,
        filterRowsForRange,
        finiteNumberOrNull,
        normalizeRows,
        parseScrydexDate,
    };
}));

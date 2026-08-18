(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.PV_TRADE = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    const STORAGE_KEY = 'pv:scrydex:tradeWorkspace:v1';
    const VERSION = 1;
    const DEFAULT_PERCENT = 80;
    const MAX_ITEMS = 50;
    const MAX_STORAGE_JSON_CHARS = 180000;
    const ALLOWED_CONDITIONS = new Set(['NM', 'LP', 'MP', 'HP', 'DM']);

    function safeString(value, fallback = '', maxLength = 240) {
        const text = String(value ?? '').trim();
        return (text || fallback).slice(0, maxLength);
    }

    function normalizePercent(value, fallback = DEFAULT_PERCENT) {
        const percent = Number(value);
        if (!Number.isFinite(percent)) return fallback;
        return Math.max(0, Math.min(100, Math.round(percent)));
    }

    function normalizeMoney(value) {
        if (value === null || value === undefined || value === '') return null;
        const amount = Number(value);
        return Number.isFinite(amount) && amount >= 0 ? amount : null;
    }

    function normalizeConditionValues(raw) {
        const values = {};
        if (!raw || typeof raw !== 'object') return values;
        for (const condition of ALLOWED_CONDITIONS) {
            const value = normalizeMoney(raw[condition]);
            if (value !== null) values[condition] = value;
        }
        return values;
    }

    function normalizeTimestamp(value, fallback = Date.now()) {
        const timestamp = Number(value);
        return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : fallback;
    }

    function normalizeImage(value) {
        const image = safeString(value, '', 1000);
        if (!image) return '';
        try {
            const url = new URL(image, root?.location?.origin || 'https://pokevalutor.local');
            return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
        } catch {
            return '';
        }
    }

    function normalizeTradeItem(item, now = Date.now()) {
        if (!item || typeof item !== 'object') return null;
        const id = safeString(item.id, '', 160);
        if (!id) return null;
        const expansion = item.expansion && typeof item.expansion === 'object'
            ? {
                id: safeString(item.expansion.id, '', 120),
                name: safeString(item.expansion.name, '', 160),
            }
            : { id: '', name: '' };
        const selectedCondition = safeString(item.selectedCondition, 'NM', 8).toUpperCase();
        const conditionValues = normalizeConditionValues(item.conditionValues);
        const selectedMarketValue = normalizeMoney(item.marketValue);
        const marketValue = conditionValues[selectedCondition] ?? selectedMarketValue;

        return {
            id,
            name: safeString(item.name, 'Unknown', 200),
            expansion,
            image: normalizeImage(item.image),
            rarity: safeString(item.rarity, '', 120),
            cardNumber: safeString(item.cardNumber ?? item.number, '', 80),
            selectedVariant: safeString(item.selectedVariant, '', 160),
            selectedCondition: ALLOWED_CONDITIONS.has(selectedCondition) ? selectedCondition : 'NM',
            conditionValues,
            marketValue,
            tradePercent: normalizePercent(item.tradePercent),
            priceUpdatedAt: normalizeTimestamp(item.priceUpdatedAt, 0),
            addedAt: normalizeTimestamp(item.addedAt, now),
            updatedAt: normalizeTimestamp(item.updatedAt, now),
        };
    }

    function normalizeWorkspace(value, now = Date.now()) {
        const source = value && typeof value === 'object' ? value : {};
        const byId = new Map();
        for (const rawItem of Array.isArray(source.items) ? source.items : []) {
            const item = normalizeTradeItem(rawItem, now);
            if (item && !byId.has(item.id)) byId.set(item.id, item);
        }
        return {
            version: VERSION,
            defaultPercent: normalizePercent(source.defaultPercent),
            updatedAt: normalizeTimestamp(source.updatedAt, now),
            items: Array.from(byId.values()).slice(0, MAX_ITEMS),
        };
    }

    function loadTradeWorkspace(storage = root?.localStorage) {
        if (!storage) return normalizeWorkspace({});
        try {
            const raw = storage.getItem(STORAGE_KEY);
            return normalizeWorkspace(raw ? JSON.parse(raw) : {});
        } catch {
            return normalizeWorkspace({});
        }
    }

    function saveTradeWorkspace(workspace, storage = root?.localStorage, now = Date.now()) {
        const normalized = normalizeWorkspace({ ...workspace, updatedAt: now }, now);
        if (!storage) return normalized;
        try {
            const serialized = JSON.stringify(normalized);
            if (serialized.length <= MAX_STORAGE_JSON_CHARS) storage.setItem(STORAGE_KEY, serialized);
        } catch {
            // Storage may be unavailable or full; the in-memory result remains usable.
        }
        return normalized;
    }

    function addOrUpdateTradeItem(workspace, item, now = Date.now()) {
        const current = normalizeWorkspace(workspace, now);
        const normalized = normalizeTradeItem(item, now);
        if (!normalized) return current;
        const existingIndex = current.items.findIndex((entry) => entry.id === normalized.id);
        if (existingIndex >= 0) {
            normalized.tradePercent = current.items[existingIndex].tradePercent;
            normalized.addedAt = current.items[existingIndex].addedAt;
            current.items[existingIndex] = { ...current.items[existingIndex], ...normalized, updatedAt: now };
        } else if (current.items.length < MAX_ITEMS) {
            current.items.push({ ...normalized, updatedAt: now });
        }
        current.updatedAt = now;
        return current;
    }

    function removeTradeItem(workspace, id, now = Date.now()) {
        const current = normalizeWorkspace(workspace, now);
        current.items = current.items.filter((item) => item.id !== safeString(id));
        current.updatedAt = now;
        return current;
    }

    function clearTradeWorkspace(now = Date.now()) {
        return normalizeWorkspace({ updatedAt: now, items: [] }, now);
    }

    function setTradeItemPercent(workspace, id, percent, now = Date.now()) {
        const current = normalizeWorkspace(workspace, now);
        const target = current.items.find((item) => item.id === safeString(id));
        if (target) target.tradePercent = normalizePercent(percent);
        current.updatedAt = now;
        return current;
    }

    function setTradeItemCondition(workspace, id, condition, now = Date.now()) {
        const current = normalizeWorkspace(workspace, now);
        const normalizedCondition = safeString(condition, 'NM', 8).toUpperCase();
        const target = current.items.find((item) => item.id === safeString(id));
        if (target && ALLOWED_CONDITIONS.has(normalizedCondition)) {
            target.selectedCondition = normalizedCondition;
            target.marketValue = target.conditionValues[normalizedCondition] ?? null;
        }
        current.updatedAt = now;
        return current;
    }

    function applyTradePercentToAll(workspace, percent, now = Date.now()) {
        const current = normalizeWorkspace(workspace, now);
        const nextPercent = normalizePercent(percent);
        current.items.forEach((item) => { item.tradePercent = nextPercent; });
        current.updatedAt = now;
        return current;
    }

    function calculateTradeTotals(items) {
        let pricedItemCount = 0;
        let unpricedItemCount = 0;
        let rawMarketTotal = 0;
        let tradeAdjustedTotal = 0;
        for (const item of Array.isArray(items) ? items : []) {
            const marketValue = normalizeMoney(item?.marketValue);
            if (marketValue === null) {
                unpricedItemCount += 1;
                continue;
            }
            pricedItemCount += 1;
            rawMarketTotal += marketValue;
            tradeAdjustedTotal += marketValue * (normalizePercent(item?.tradePercent) / 100);
        }
        return {
            pricedItemCount,
            unpricedItemCount,
            rawMarketTotal,
            tradeAdjustedTotal,
            effectiveTradePercent: rawMarketTotal > 0 ? (tradeAdjustedTotal / rawMarketTotal) * 100 : 0,
        };
    }

    return {
        STORAGE_KEY,
        DEFAULT_PERCENT,
        MAX_ITEMS,
        normalizePercent,
        normalizeTradeItem,
        normalizeWorkspace,
        loadTradeWorkspace,
        saveTradeWorkspace,
        addOrUpdateTradeItem,
        removeTradeItem,
        clearTradeWorkspace,
        setTradeItemPercent,
        setTradeItemCondition,
        applyTradePercentToAll,
        calculateTradeTotals,
    };
}));
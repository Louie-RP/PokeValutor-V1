(function (root, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root && typeof root === 'object') {
        root.PV_SEALED_PRICING = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function safeString(value) {
        return String(value ?? '').trim();
    }

    function normalizeSealedVariantKey(name) {
        return safeString(name).toLowerCase().replace(/[^a-z0-9]+/g, '');
    }

    function getSealedPricingIdentity(item) {
        const displayId = safeString(item?.displayId || item?.id);
        const separatorIndex = displayId.indexOf('::');
        const syntheticBaseId = separatorIndex > 0 ? displayId.slice(0, separatorIndex) : displayId;
        const syntheticVariantName = separatorIndex > 0 ? displayId.slice(separatorIndex + 2) : '';
        const baseProductId = safeString(item?.baseProductId) || syntheticBaseId;
        const variantName = safeString(item?.variantName) || syntheticVariantName;

        return {
            displayId,
            baseProductId,
            variantName,
            variantKey: normalizeSealedVariantKey(variantName),
        };
    }

    function findTrackedSealedVariant(variants, identity) {
        if (!Array.isArray(variants) || !variants.length) return null;

        const variantKey = normalizeSealedVariantKey(identity?.variantKey || identity?.variantName);
        if (!variantKey) return null;

        return variants.find((variant) => normalizeSealedVariantKey(variant?.name) === variantKey) || null;
    }

    function getLowestPositiveMarket(variants) {
        let lowestMarket = null;

        for (const variant of Array.isArray(variants) ? variants : []) {
            for (const price of Array.isArray(variant?.prices) ? variant.prices : []) {
                const market = Number(price?.market ?? price?.marketPrice ?? price?.market_price ?? null);
                if (!Number.isFinite(market) || market <= 0) continue;
                if (lowestMarket == null || market < lowestMarket) lowestMarket = market;
            }
        }

        return lowestMarket;
    }

    function getMarketFromTrackedSealedVariant(variants, identity) {
        if (!Array.isArray(variants) || !variants.length) return null;

        const variantKey = normalizeSealedVariantKey(identity?.variantKey || identity?.variantName);
        if (variantKey) {
            const trackedVariant = findTrackedSealedVariant(variants, identity);
            return trackedVariant ? getLowestPositiveMarket([trackedVariant]) : null;
        }

        return getLowestPositiveMarket(variants);
    }

    function buildSealedValueCacheKey(identity) {
        const resolvedIdentity = identity && typeof identity === 'object'
            ? identity
            : getSealedPricingIdentity({ id: identity });
        return `sealed:v3:${safeString(resolvedIdentity?.displayId).toLowerCase()}`;
    }

    return Object.freeze({
        getSealedPricingIdentity,
        normalizeSealedVariantKey,
        findTrackedSealedVariant,
        getMarketFromTrackedSealedVariant,
        buildSealedValueCacheKey,
    });
}));
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.PV_PRICE_HISTORY_SERVICE = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const PREMIUM_ROLES = new Set(['premium', 'admin', 'tester']);

    function normalizeRoleFromClaims(claims) {
        const source = claims && typeof claims === 'object' ? claims : {};
        const role = String(
            source.role
            || source.userRole
            || source.user_role
            || source.tier
            || source.plan
            || source.subscriptionTier
            || source.subscription_tier
            || ''
        ).trim().toLowerCase();
        if (['admin', 'tester', 'premium', 'basic', 'free'].includes(role)) return role;
        if (role) return 'basic';
        if (source.admin === true || String(source.admin).toLowerCase() === 'true') return 'admin';
        if (source.tester === true || String(source.tester).toLowerCase() === 'true') return 'tester';
        if (source.premium === true || String(source.premium).toLowerCase() === 'true') return 'premium';
        return 'basic';
    }

    function isPremiumRole(role) {
        return PREMIUM_ROLES.has(String(role || '').trim().toLowerCase());
    }

    async function resolveRole(auth) {
        try {
            const user = auth?.getUser ? auth.getUser() : null;
            if (!user) return 'basic';
            const tokenResult = auth?.getIdTokenResult
                ? await auth.getIdTokenResult(false)
                : null;
            return normalizeRoleFromClaims(tokenResult?.claims || {});
        } catch {
            return 'basic';
        }
    }

    async function fetchHistory({
        auth,
        fetchImpl,
        workerBase,
        cardId,
        variant,
        condition = 'NM',
    }) {
        const token = auth?.getIdToken ? await auth.getIdToken(false) : null;
        if (!token) throw new Error('Please sign in again to view price history.');
        const url = `${String(workerBase || '').replace(/\/$/, '')}/cards/${encodeURIComponent(cardId)}/scrydex-price-history?variant=${encodeURIComponent(variant)}&condition=${encodeURIComponent(condition)}`;
        const response = await fetchImpl(url, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
        });
        const text = await response.text();
        let payload = null;
        try { payload = JSON.parse(text); } catch { /* handled below */ }
        if (!response.ok || !payload || payload.ok === false) {
            let message = payload?.error || payload?.message || `Price history request failed (${response.status}).`;
            if (response.status === 401) message = 'Please sign in again to view price history.';
            if (response.status === 403) message = 'A Premium subscription is required to view NM price history.';
            if (response.status === 429) message = 'NM price history has reached its daily refresh limit. Please try again later.';
            throw new Error(String(message));
        }
        return payload;
    }

    return {
        fetchHistory,
        isPremiumRole,
        normalizeRoleFromClaims,
        resolveRole,
    };
}));

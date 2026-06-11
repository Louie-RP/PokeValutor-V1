/* Scrydex-backed Sealed page behavior */
document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('pv-sealed-form');
    const input = /** @type {HTMLInputElement} */(document.getElementById('pv-sealed-query'));
    const PV_BUILD = '2026-06-08-1';
    try {
        if (localStorage.getItem('pv:debug') === '1') {
            console.info('[PokeValutor] sealed.js build', PV_BUILD);
        }
    } catch {
        // ignore
    }
    const status = document.getElementById('pv-sealed-status');
    const grid = document.getElementById('pv-sealed-grid');
    const favoritesGrid = document.getElementById('pv-sealed-favorites-grid');
    const favoritesBody = document.getElementById('pv-sealed-favorites-body');
    const favoritesToggle = document.getElementById('pv-sealed-favorites-toggle');
    const favoritesClearBtn = document.getElementById('pv-sealed-favorites-clear');
    const favoritesTotalsEl = document.getElementById('pv-sealed-favorites-totals');
    const scrollTopBtn = document.getElementById('pv-scroll-top');
    const clearBtn = document.getElementById('pv-sealed-clear');
    const loadMoreBtn = document.getElementById('pv-sealed-load-more');
    const loadMoreWrap = document.getElementById('pv-sealed-load-more-wrap');
    const sealedSortSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('pv-sealed-sort-select'));
    const sealedFavoritesSortSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('pv-sealed-favorites-sort-select'));
    const sealedCollectionContextEl = document.getElementById('pv-sealed-collection-context');
    const sealedCollectionSelectEl = /** @type {HTMLSelectElement|null} */ (document.getElementById('pv-sealed-collection-select'));
    const sealedCollectionStatusEl = document.getElementById('pv-sealed-collection-status');

    const quotaBanner = document.getElementById('pv-quota-banner');
    const quotaMessageEl = document.getElementById('pv-quota-message');
    const quotaCtaEl = /** @type {HTMLAnchorElement|null} */ (document.getElementById('pv-quota-cta'));

    const CACHE_PREFIX = 'pv:scrydex:sealed:';
    const SEARCH_TTL_MS = 12 * 60 * 60 * 1000;
    const SEARCH_PAGE_SIZE = 10;
    const DEFAULT_TRADE_PERCENT = 80;
    const TRADE_PERCENT_CHOICES = [100, 90, 80, 70, 60, 50];

    const QUOTA_STORAGE_KEY = 'pv:quota:last:v1';

    // Hide quota banner by default; only show for signed-out users after auth resolves.
    function forceHideQuotaBanner() {
        if (quotaBanner) {
            quotaBanner.hidden = true;
            quotaBanner.setAttribute('hidden', '');
            quotaBanner.style.setProperty('display', 'none', 'important');
        }
        if (quotaCtaEl) {
            quotaCtaEl.hidden = true;
            quotaCtaEl.setAttribute('hidden', '');
            quotaCtaEl.style.setProperty('display', 'none', 'important');
        }
    }

    function clearForcedHideQuotaBanner() {
        if (quotaBanner) {
            quotaBanner.style.removeProperty('display');
            quotaBanner.removeAttribute('hidden');
            quotaBanner.hidden = false;
        }
        if (quotaCtaEl) {
            quotaCtaEl.style.removeProperty('display');
        }
    }

    forceHideQuotaBanner();

    const LAST_RESULTS_KEY = `${CACHE_PREFIX}lastResults:v1`;
    // Single saved-items list is now the Watchlist.
    // Migrate legacy Favorites storage into Watchlist to avoid data loss.
    const WATCHLIST_KEY = `${CACHE_PREFIX}watchlist:v1`;
    const WATCHLIST_COLLAPSED_KEY = `${CACHE_PREFIX}watchlistCollapsed:v1`;
    const LEGACY_FAVORITES_KEY = `${CACHE_PREFIX}favorites:v1`;
    const LEGACY_FAVORITES_COLLAPSED_KEY = `${CACHE_PREFIX}favoritesCollapsed:v1`;
    const DEX_COLLECTION_KEY = 'pv:scrydex:collection:v1';
    const DEX_MASTER_SETS_KEY = 'pv:scrydex:masterSets:v1';
    const DEX_ACTIVE_COLLECTION_KEY = 'pv:scrydex:activeCollectionId:v1';
    const DEX_COLLECTIONS_META_KEY = 'pv:scrydex:collectionsMeta:v1';
    const DEX_DEFAULT_COLLECTION_ID = 'default';
    const DEX_DEFAULT_COLLECTION_NAME = 'Default Collection';
    const DEX_MAX_COLLECTIONS_PREMIUM = 3;
    const TRADE_PERCENT_MAP_KEY = `${CACHE_PREFIX}tradePercentById:v1`;
    const SEALED_RESULTS_SORT_PREF_KEY = `${CACHE_PREFIX}resultsSortMode:v1`;
    const SEALED_WATCHLIST_SORT_PREF_KEY = `${CACHE_PREFIX}watchlistSortMode:v1`;

    /** @type {Array<any>} */
    let currentResultsProducts = [];
    const sealedSortState = {
        active: 'value',
        nameDir: 'asc',
        valueDir: 'desc',
    };
    const sealedFavoritesSortState = {
        active: 'value',
        nameDir: 'asc',
        valueDir: 'desc',
    };
    /** @type {Record<string, number>} */
    const sealedValueById = {};
    let currentSearchQuery = '';
    let currentSearchPage = 0;
    let currentSearchTotalCount = null;
    let currentSearchHasMore = false;
    let isLoadingMore = false;
    let sealedCollectionContextBusy = false;
    let sealedCollectionContextMeta = {
        activeCollectionId: DEX_DEFAULT_COLLECTION_ID,
        collections: [{ id: DEX_DEFAULT_COLLECTION_ID, name: DEX_DEFAULT_COLLECTION_NAME }],
    };

    function setStatus(message) {
        if (status) status.textContent = message;
    }

    function loadSortModePreference(storageKey, allowedModes) {
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) return '';
            const mode = String(raw || '').trim();
            return allowedModes.includes(mode) ? mode : '';
        } catch {
            return '';
        }
    }

    function saveSortModePreference(storageKey, mode) {
        try {
            localStorage.setItem(storageKey, String(mode || ''));
        } catch {
            // ignore
        }
    }

    const SEALED_SORT_MODES = ['value-desc', 'value-asc', 'name-asc', 'name-desc'];

    function getSealedSortMode() {
        if (sealedSortState.active === 'name') {
            return sealedSortState.nameDir === 'desc' ? 'name-desc' : 'name-asc';
        }
        return sealedSortState.valueDir === 'asc' ? 'value-asc' : 'value-desc';
    }

    function applySealedSortMode(modeRaw) {
        const mode = SEALED_SORT_MODES.includes(modeRaw) ? modeRaw : 'value-desc';
        switch (mode) {
            case 'name-desc':
                sealedSortState.active = 'name';
                sealedSortState.nameDir = 'desc';
                break;
            case 'name-asc':
                sealedSortState.active = 'name';
                sealedSortState.nameDir = 'asc';
                break;
            case 'value-asc':
                sealedSortState.active = 'value';
                sealedSortState.valueDir = 'asc';
                break;
            case 'value-desc':
            default:
                sealedSortState.active = 'value';
                sealedSortState.valueDir = 'desc';
                break;
        }
    }

    function updateSealedSortUi() {
        if (sealedSortSelect) {
            sealedSortSelect.value = getSealedSortMode();
        }
    }

    function setSealedProductValue(productId, value) {
        const id = String(productId || '').trim();
        if (!id) return;
        const n = Number(value);
        if (Number.isFinite(n)) {
            sealedValueById[id] = n;
        } else {
            delete sealedValueById[id];
        }
    }

    function compareSealedProductsForSort(a, b) {
        const idA = String(a?.id || '');
        const idB = String(b?.id || '');
        const nameA = getSealedSortableName(a).toLowerCase();
        const nameB = getSealedSortableName(b).toLowerCase();

        if (sealedSortState.active === 'name') {
            const dir = sealedSortState.nameDir === 'asc' ? 1 : -1;
            const byName = nameA.localeCompare(nameB) * dir;
            if (byName !== 0) return byName;
            return idA.localeCompare(idB) * dir;
        }

        const va = Number(sealedValueById[idA]);
        const vb = Number(sealedValueById[idB]);
        const hasA = Number.isFinite(va);
        const hasB = Number.isFinite(vb);

        if (!hasA && !hasB) return nameA.localeCompare(nameB);
        if (!hasA) return 1;
        if (!hasB) return -1;

        const dir = sealedSortState.valueDir === 'asc' ? 1 : -1;
        if (va === vb) return nameA.localeCompare(nameB);
        return (va - vb) * dir;
    }

    function applySealedSortToGrid() {
        if (!grid) return;
        const cols = Array.from(grid.querySelectorAll('.pv-sealedCol'));
        if (cols.length <= 1) return;

        cols.sort((a, b) => {
            const nameA = safeString(a.getAttribute('data-product-name'), '').toLowerCase();
            const nameB = safeString(b.getAttribute('data-product-name'), '').toLowerCase();

            if (sealedSortState.active === 'name') {
                const dir = sealedSortState.nameDir === 'asc' ? 1 : -1;
                return nameA.localeCompare(nameB) * dir;
            }

            const idA = safeString(a.getAttribute('data-product-id'), '');
            const idB = safeString(b.getAttribute('data-product-id'), '');
            const va = Number(sealedValueById[idA]);
            const vb = Number(sealedValueById[idB]);
            const hasA = Number.isFinite(va);
            const hasB = Number.isFinite(vb);

            if (!hasA && !hasB) return nameA.localeCompare(nameB);
            if (!hasA) return 1;
            if (!hasB) return -1;

            const dir = sealedSortState.valueDir === 'asc' ? 1 : -1;
            if (va === vb) return nameA.localeCompare(nameB);
            return (va - vb) * dir;
        });

        for (const col of cols) {
            grid.appendChild(col);
        }
    }

    function bindSealedSortControls() {
        if (sealedSortSelect && sealedSortSelect.getAttribute('data-bound') !== '1') {
            sealedSortSelect.setAttribute('data-bound', '1');
            sealedSortSelect.addEventListener('change', () => {
                applySealedSortMode(sealedSortSelect.value);
                updateSealedSortUi();
                applySealedSortToGrid();
                saveSortModePreference(SEALED_RESULTS_SORT_PREF_KEY, getSealedSortMode());
            });
        }

        const storedMode = loadSortModePreference(SEALED_RESULTS_SORT_PREF_KEY, SEALED_SORT_MODES);
        applySealedSortMode(storedMode || sealedSortSelect?.value || getSealedSortMode());
        updateSealedSortUi();
    }

    const SEALED_FAVORITES_SORT_MODES = ['value-desc', 'value-asc', 'name-asc', 'name-desc'];

    function getSealedFavoritesSortMode() {
        if (sealedFavoritesSortState.active === 'name') {
            return sealedFavoritesSortState.nameDir === 'desc' ? 'name-desc' : 'name-asc';
        }
        return sealedFavoritesSortState.valueDir === 'asc' ? 'value-asc' : 'value-desc';
    }

    function applySealedFavoritesSortMode(modeRaw) {
        const mode = SEALED_FAVORITES_SORT_MODES.includes(modeRaw) ? modeRaw : 'value-desc';
        switch (mode) {
            case 'name-desc':
                sealedFavoritesSortState.active = 'name';
                sealedFavoritesSortState.nameDir = 'desc';
                break;
            case 'name-asc':
                sealedFavoritesSortState.active = 'name';
                sealedFavoritesSortState.nameDir = 'asc';
                break;
            case 'value-asc':
                sealedFavoritesSortState.active = 'value';
                sealedFavoritesSortState.valueDir = 'asc';
                break;
            case 'value-desc':
            default:
                sealedFavoritesSortState.active = 'value';
                sealedFavoritesSortState.valueDir = 'desc';
                break;
        }
    }

    function updateSealedFavoritesSortUi() {
        if (sealedFavoritesSortSelect) {
            sealedFavoritesSortSelect.value = getSealedFavoritesSortMode();
        }
    }

    function compareSealedFavoritesForSort(a, b) {
        const idA = safeString(a?.id, '');
        const idB = safeString(b?.id, '');
        const nameA = getSealedSortableName(a).toLowerCase();
        const nameB = getSealedSortableName(b).toLowerCase();

        if (sealedFavoritesSortState.active === 'name') {
            const dir = sealedFavoritesSortState.nameDir === 'asc' ? 1 : -1;
            const byName = nameA.localeCompare(nameB) * dir;
            if (byName !== 0) return byName;
            return idA.localeCompare(idB) * dir;
        }

        const va = Number(getMarketQuote(a)?.market);
        const vb = Number(getMarketQuote(b)?.market);
        const hasA = Number.isFinite(va);
        const hasB = Number.isFinite(vb);

        if (!hasA && !hasB) return nameA.localeCompare(nameB);
        if (!hasA) return 1;
        if (!hasB) return -1;

        const dir = sealedFavoritesSortState.valueDir === 'asc' ? 1 : -1;
        if (va === vb) return nameA.localeCompare(nameB);
        return (va - vb) * dir;
    }

    function bindSealedFavoritesSortControls() {
        if (sealedFavoritesSortSelect && sealedFavoritesSortSelect.getAttribute('data-bound') !== '1') {
            sealedFavoritesSortSelect.setAttribute('data-bound', '1');
            sealedFavoritesSortSelect.addEventListener('change', () => {
                applySealedFavoritesSortMode(sealedFavoritesSortSelect.value);
                updateSealedFavoritesSortUi();
                renderFavorites(loadLastResults() || undefined);
                saveSortModePreference(SEALED_WATCHLIST_SORT_PREF_KEY, getSealedFavoritesSortMode());
            });
        }

        const storedMode = loadSortModePreference(SEALED_WATCHLIST_SORT_PREF_KEY, SEALED_FAVORITES_SORT_MODES);
        applySealedFavoritesSortMode(storedMode || sealedFavoritesSortSelect?.value || getSealedFavoritesSortMode());
        updateSealedFavoritesSortUi();
    }

    function isQuotaExceededError(err) {
        return !!(err && typeof err === 'object' && (err.isQuotaExceeded === true || err.status === 429));
    }

    function safeParseIntOrNull(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }

    function loadSavedQuota() {
        try {
            const raw = localStorage.getItem(QUOTA_STORAGE_KEY);
            if (!raw) return null;
            const parsed = safeParseJson(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            return {
                tier: typeof parsed.tier === 'string' ? parsed.tier : '',
                limit: parsed.limit == null ? null : safeParseIntOrNull(parsed.limit),
                used: parsed.used == null ? null : safeParseIntOrNull(parsed.used),
                remaining: parsed.remaining == null ? null : safeParseIntOrNull(parsed.remaining),
                savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
            };
        } catch {
            return null;
        }
    }

    function saveQuota(quota) {
        try {
            if (!quota || typeof quota !== 'object') return;
            localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify({ ...quota, savedAt: Date.now() }));
        } catch {
            // ignore
        }
    }

    function renderQuotaBanner(quota) {
        if (!quotaBanner || !quotaMessageEl) return;
        const signedIn = Boolean(window?.PV_AUTH?.getUser && window.PV_AUTH.getUser());

        // Requirement: don't show the quota / sign-in banner at all when signed in.
        if (signedIn) {
            forceHideQuotaBanner();
            return;
        }

        if (!quota || typeof quota !== 'object') {
            quotaBanner.hidden = true;
            if (quotaCtaEl) quotaCtaEl.hidden = true;
            return;
        }

        const tier = String(quota.tier || '').toLowerCase();
        const limit = quota.limit;
        const remaining = quota.remaining;

        quotaBanner.classList.remove('pv-quotaBanner--warn', 'pv-quotaBanner--error');

        const hasNumbers = remaining != null && limit != null;
        const ratioText = hasNumbers ? `${remaining}/${limit} remaining` : 'Daily allowance';

        let message = '';
        let showCta = false;

        if (tier === 'admin') {
            message = 'Admin access: unlimited.';
        } else if (tier === 'tester') {
            message = 'Tester access: unlimited.';
        } else if (tier === 'anon' || tier === 'guest') {
            showCta = true;
            if (remaining != null && remaining <= 0) {
                quotaBanner.classList.add('pv-quotaBanner--error');
                message = 'Daily guest allowance reached. Sign in to continue (and sync your Watchlist).';
            } else if (remaining != null && remaining <= 2) {
                quotaBanner.classList.add('pv-quotaBanner--warn');
                message = `Guest allowance running low: ${ratioText}. Sign in to increase your daily limit.`;
            } else {
                message = `Guest allowance: ${ratioText}. Sign in to increase your daily limit.`;
            }
        } else if (tier === 'premium' || tier === 'pro') {
            message = hasNumbers ? `Premium allowance: ${ratioText}.` : 'Premium allowance available.';
        } else {
            message = hasNumbers ? `Daily allowance: ${ratioText}.` : 'Daily allowance available.';
        }

        quotaMessageEl.textContent = message;
        clearForcedHideQuotaBanner();
        if (quotaCtaEl) {
            quotaCtaEl.hidden = !showCta;
            if (showCta) {
                quotaCtaEl.style.removeProperty('display');
                quotaCtaEl.removeAttribute('hidden');
            } else {
                quotaCtaEl.setAttribute('hidden', '');
                quotaCtaEl.style.setProperty('display', 'none', 'important');
            }
        }
    }

    function updateQuotaFromResponse(res) {
        try {
            const tier = String(res?.headers?.get('x-pv-quota-tier') || '').trim();
            const limitRaw = res?.headers?.get('x-pv-quota-limit');
            const usedRaw = res?.headers?.get('x-pv-quota-used');
            const remainingRaw = res?.headers?.get('x-pv-quota-remaining');

            const limit = limitRaw != null ? safeParseIntOrNull(limitRaw) : null;
            const used = usedRaw != null ? safeParseIntOrNull(usedRaw) : null;
            const remaining = remainingRaw != null ? safeParseIntOrNull(remainingRaw) : null;

            const hasAny = Boolean(tier) || limit != null || used != null || remaining != null;
            if (!hasAny) return;

            const quota = { tier, limit, used, remaining };
            saveQuota(quota);
            renderQuotaBanner(quota);
        } catch {
            // ignore
        }
    }

    // Only show quota UI once we KNOW the user is signed out.
    try {
        const debug = (() => {
            try { return localStorage.getItem('pv:debug') === '1'; } catch { return false; }
        })();

        if (window?.PV_AUTH?.onAuthStateChanged) {
            window.PV_AUTH.onAuthStateChanged((user) => {
                if (debug) console.info('[PokeValutor] auth state (sealed)', user ? 'signed-in' : 'signed-out');
                if (user) {
                    forceHideQuotaBanner();
                } else {
                    renderQuotaBanner(loadSavedQuota());
                }
            });
        } else {
            renderQuotaBanner(loadSavedQuota());
        }
    } catch {
        renderQuotaBanner(loadSavedQuota());
    }

    function getRoleFromClaims(claims) {
        const roleRaw = String(claims?.role || '').trim().toLowerCase();
        if (roleRaw === 'admin' || roleRaw === 'tester' || roleRaw === 'premium' || roleRaw === 'basic') return roleRaw;

        const adminRaw = claims?.admin;
        if (adminRaw === true || String(adminRaw || '').toLowerCase() === 'true') return 'admin';

        const testerRaw = claims?.tester;
        if (testerRaw === true || String(testerRaw || '').toLowerCase() === 'true') return 'tester';

        const premiumRaw = claims?.premium;
        if (premiumRaw === true || String(premiumRaw || '').toLowerCase() === 'true') return 'premium';

        const tierRaw = String(claims?.tier || '').trim().toLowerCase();
        if (tierRaw === 'premium' || tierRaw === 'pro') return 'premium';

        return 'basic';
    }

    function isPremiumRole(role) {
        const normalized = String(role || '').trim().toLowerCase();
        return normalized === 'admin' || normalized === 'tester' || normalized === 'premium';
    }

    function setSealedCollectionContextVisible(isVisible) {
        const show = Boolean(isVisible);
        if (sealedCollectionContextEl) sealedCollectionContextEl.hidden = !show;
        if (!show) {
            setSealedCollectionStatus('');
        }
    }

    function setSealedCollectionStatus(message) {
        if (!sealedCollectionStatusEl) return;
        const text = String(message || '').trim();
        sealedCollectionStatusEl.hidden = text.length === 0;
        sealedCollectionStatusEl.textContent = text;
    }

    function setSealedCollectionBusy(isBusy) {
        sealedCollectionContextBusy = Boolean(isBusy);
        if (sealedCollectionSelectEl) {
            sealedCollectionSelectEl.disabled = sealedCollectionContextBusy;
        }
    }

    function normalizeCollectionContextMeta(raw, premiumEnabled) {
        const maxCollections = premiumEnabled ? DEX_MAX_COLLECTIONS_PREMIUM : 1;
        const byId = new Map();
        const source = Array.isArray(raw?.collections) ? raw.collections : [];

        for (const entry of source) {
            const id = normalizeDexCollectionId(entry?.id, '');
            if (!id) continue;

            byId.set(id, {
                id,
                name: safeString(entry?.name, id === DEX_DEFAULT_COLLECTION_ID ? DEX_DEFAULT_COLLECTION_NAME : id).trim() || (id === DEX_DEFAULT_COLLECTION_ID ? DEX_DEFAULT_COLLECTION_NAME : id),
            });
        }

        if (!byId.has(DEX_DEFAULT_COLLECTION_ID)) {
            byId.set(DEX_DEFAULT_COLLECTION_ID, { id: DEX_DEFAULT_COLLECTION_ID, name: DEX_DEFAULT_COLLECTION_NAME });
        } else {
            byId.set(DEX_DEFAULT_COLLECTION_ID, { id: DEX_DEFAULT_COLLECTION_ID, name: DEX_DEFAULT_COLLECTION_NAME });
        }

        const collections = Array.from(byId.values())
            .sort((a, b) => {
                if (a.id === DEX_DEFAULT_COLLECTION_ID) return -1;
                if (b.id === DEX_DEFAULT_COLLECTION_ID) return 1;
                return String(a?.name || '').localeCompare(String(b?.name || ''));
            })
            .slice(0, Math.max(1, maxCollections));

        const candidate = normalizeDexCollectionId(raw?.activeCollectionId, DEX_DEFAULT_COLLECTION_ID);
        const activeCollectionId = collections.some((entry) => entry.id === candidate)
            ? candidate
            : DEX_DEFAULT_COLLECTION_ID;

        return { activeCollectionId, collections };
    }

    function readCollectionContextMetaLocal() {
        try {
            const raw = localStorage.getItem(DEX_COLLECTIONS_META_KEY);
            const parsed = raw ? safeParseJson(raw) : null;
            const activeFromKey = normalizeDexCollectionId(localStorage.getItem(DEX_ACTIVE_COLLECTION_KEY), DEX_DEFAULT_COLLECTION_ID);
            return normalizeCollectionContextMeta({
                activeCollectionId: activeFromKey,
                collections: parsed?.collections,
            }, true);
        } catch {
            return normalizeCollectionContextMeta({}, true);
        }
    }

    function persistCollectionContextMetaLocal(meta) {
        const normalized = normalizeCollectionContextMeta(meta, true);
        sealedCollectionContextMeta = normalized;

        try {
            localStorage.setItem(DEX_ACTIVE_COLLECTION_KEY, normalized.activeCollectionId);
        } catch {
            // ignore
        }

        try {
            localStorage.setItem(DEX_COLLECTIONS_META_KEY, JSON.stringify(normalized));
        } catch {
            // ignore
        }
    }

    function renderSealedCollectionContext(meta) {
        const normalized = normalizeCollectionContextMeta(meta, true);
        sealedCollectionContextMeta = normalized;
        if (!sealedCollectionSelectEl) return;

        sealedCollectionSelectEl.innerHTML = normalized.collections.map((entry) => {
            const label = entry.id === DEX_DEFAULT_COLLECTION_ID
                ? `${entry.name} (Master Sets)`
                : entry.name;
            return `<option value="${escapeAttr(entry.id)}">${escapeHtml(label)}</option>`;
        }).join('');
        sealedCollectionSelectEl.value = normalized.activeCollectionId;
    }

    function getActiveCollectionNameFromMeta(meta) {
        const normalized = normalizeCollectionContextMeta(meta, true);
        const match = normalized.collections.find((entry) => entry.id === normalized.activeCollectionId);
        return match ? match.name : DEX_DEFAULT_COLLECTION_NAME;
    }

    function rerenderForCollectionContext() {
        const restored = loadLastResults();
        renderProducts(currentResultsProducts, restored || undefined);
        renderFavorites(restored || undefined);
    }

    async function loadCollectionContextMetaFromCloud() {
        const authApi = window?.PV_AUTH;
        if (!authApi?.loadDexCollectionsMeta) {
            const fallback = readCollectionContextMetaLocal();
            renderSealedCollectionContext(fallback);
            persistCollectionContextMetaLocal(fallback);
            return fallback;
        }

        const cloudMeta = await authApi.loadDexCollectionsMeta();
        const normalized = normalizeCollectionContextMeta(cloudMeta, true);
        renderSealedCollectionContext(normalized);
        persistCollectionContextMetaLocal(normalized);
        return normalized;
    }

    async function saveCollectionContextMetaToCloud(nextMeta) {
        const authApi = window?.PV_AUTH;
        if (!authApi?.saveDexCollectionsMeta) {
            throw new Error('Collection switching is unavailable right now.');
        }

        const saved = await authApi.saveDexCollectionsMeta(nextMeta);
        const normalized = normalizeCollectionContextMeta(saved, true);
        renderSealedCollectionContext(normalized);
        persistCollectionContextMetaLocal(normalized);
        return normalized;
    }

    function forceDefaultCollectionContext() {
        const fallback = {
            activeCollectionId: DEX_DEFAULT_COLLECTION_ID,
            collections: [{ id: DEX_DEFAULT_COLLECTION_ID, name: DEX_DEFAULT_COLLECTION_NAME }],
        };
        renderSealedCollectionContext(fallback);
        persistCollectionContextMetaLocal(fallback);
    }

    async function readCurrentRole() {
        try {
            const authApi = window?.PV_AUTH;
            if (!authApi?.getUser) return 'basic';
            if (!authApi.getUser()) return 'basic';
            if (!authApi?.getIdTokenResult) return 'basic';
            const tokenResult = await authApi.getIdTokenResult(false);
            return getRoleFromClaims(tokenResult?.claims || {});
        } catch {
            return 'basic';
        }
    }

    async function switchActiveCollectionContext(nextCollectionId) {
        if (!sealedCollectionSelectEl) return;
        if (sealedCollectionContextBusy) return;

        const selectedId = normalizeDexCollectionId(nextCollectionId, DEX_DEFAULT_COLLECTION_ID);
        if (!isPremiumRole(await readCurrentRole())) {
            forceDefaultCollectionContext();
            setSealedCollectionContextVisible(false);
            rerenderForCollectionContext();
            return;
        }

        const currentMeta = normalizeCollectionContextMeta(sealedCollectionContextMeta, true);
        if (!currentMeta.collections.some((entry) => entry.id === selectedId)) {
            renderSealedCollectionContext(currentMeta);
            setSealedCollectionStatus('That collection is unavailable right now.');
            return;
        }

        setSealedCollectionBusy(true);
        setSealedCollectionStatus('Switching active collection...');

        try {
            const saved = await saveCollectionContextMetaToCloud({
                collections: currentMeta.collections,
                activeCollectionId: selectedId,
            });
            const name = getActiveCollectionNameFromMeta(saved);
            setSealedCollectionStatus(`Active collection: ${name}.`);
            rerenderForCollectionContext();
        } catch (error) {
            renderSealedCollectionContext(currentMeta);
            setSealedCollectionStatus(String(error?.message || 'Could not switch collections.'));
        } finally {
            setSealedCollectionBusy(false);
        }
    }

    async function refreshCollectionContextUi() {
        const authApi = window?.PV_AUTH;
        const user = authApi?.getUser ? authApi.getUser() : null;
        if (!user) {
            setSealedCollectionContextVisible(false);
            return;
        }

        const role = await readCurrentRole();
        if (!isPremiumRole(role)) {
            forceDefaultCollectionContext();
            setSealedCollectionContextVisible(false);
            rerenderForCollectionContext();
            return;
        }

        setSealedCollectionContextVisible(true);
        setSealedCollectionBusy(true);
        setSealedCollectionStatus('Loading collections...');

        try {
            const meta = await loadCollectionContextMetaFromCloud();
            const name = getActiveCollectionNameFromMeta(meta);
            setSealedCollectionStatus(`Active collection: ${name}.`);
            rerenderForCollectionContext();
        } catch (error) {
            const fallback = readCollectionContextMetaLocal();
            renderSealedCollectionContext(fallback);
            persistCollectionContextMetaLocal(fallback);
            setSealedCollectionStatus(String(error?.message || 'Could not load collections.'));
            rerenderForCollectionContext();
        } finally {
            setSealedCollectionBusy(false);
        }
    }

    async function refreshQuotaBannerForAuthState() {
        try {
            const user = window?.PV_AUTH?.getUser ? window.PV_AUTH.getUser() : null;
            if (!user) {
                renderQuotaBanner(loadSavedQuota());
                return;
            }

            // Signed in: hide banner entirely.
            quotaBanner.hidden = true;
            if (quotaCtaEl) quotaCtaEl.hidden = true;
        } catch {
            // ignore
        }
    }

    try {
        if (window?.PV_AUTH?.onAuthStateChanged) {
            window.PV_AUTH.onAuthStateChanged(() => { void refreshQuotaBannerForAuthState(); });
        }
    } catch {
        // ignore
    }

    function safeString(value, fallback) {
        const s = String(value ?? '');
        return s ? s : (fallback || '');
    }

    function escapeHtml(value) {
        const s = String(value ?? '');
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttr(value) {
        return escapeHtml(value);
    }

    function normalizeFavoriteProduct(product) {
        // Keep a minimal snapshot so Watchlist can render without extra API calls.
        return {
            id: safeString(product?.id, ''),
            baseProductId: safeString(product?.baseProductId, safeString(product?.id, '')),
            variantName: safeString(product?.variantName, ''),
            variantLabel: safeString(product?.variantLabel, ''),
            hasMultipleVariants: product?.hasMultipleVariants === true,
            name: safeString(product?.name, 'Unknown'),
            type: safeString(product?.type, ''),
            images: Array.isArray(product?.images) ? product.images : [],
            expansion: (product?.expansion && typeof product.expansion === 'object') ? product.expansion : null,
            variants: Array.isArray(product?.variants) ? product.variants : [],
        };
    }

    function normalizeCollectionItemType(rawType) {
        const value = String(rawType || '').trim().toLowerCase();
        return value === 'sealed' ? 'sealed' : 'card';
    }

    function normalizeDexCollectionId(rawId, fallbackId) {
        const normalized = String(rawId || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '');

        if (!normalized) return String(fallbackId || DEX_DEFAULT_COLLECTION_ID);
        return normalized.slice(0, 40);
    }

    function getActiveDexCollectionId() {
        try {
            const raw = localStorage.getItem(DEX_ACTIVE_COLLECTION_KEY);
            return normalizeDexCollectionId(raw, DEX_DEFAULT_COLLECTION_ID);
        } catch {
            return DEX_DEFAULT_COLLECTION_ID;
        }
    }

    function normalizeSealedQuantity(rawQty, fallback) {
        const fallbackQty = Math.max(0, Math.floor(Number(fallback) || 0));
        const parsed = Math.floor(Number(rawQty));
        if (!Number.isFinite(parsed)) return fallbackQty;
        return Math.max(0, parsed);
    }

    function normalizeSealedCollectionProduct(product) {
        const addedAtRaw = Number(product?.addedAt || 0);
        const updatedAtRaw = Number(product?.updatedAt || 0);
        const timestamp = Date.now();
        const rawQty = product?.quantity ?? product?.sealedQuantity;
        const quantity = Math.max(1, normalizeSealedQuantity(rawQty, 1));
        const collectionId = normalizeDexCollectionId(product?.collectionId, DEX_DEFAULT_COLLECTION_ID);
        return {
            itemType: 'sealed',
            collectionId,
            id: safeString(product?.id, ''),
            baseProductId: safeString(product?.baseProductId, safeString(product?.id, '')),
            variantName: safeString(product?.variantName, ''),
            variantLabel: safeString(product?.variantLabel, ''),
            hasMultipleVariants: product?.hasMultipleVariants === true,
            name: safeString(product?.name, 'Unknown'),
            type: safeString(product?.type, ''),
            expansion: (product?.expansion && typeof product.expansion === 'object') ? product.expansion : null,
            set: (product?.set && typeof product.set === 'object') ? product.set : null,
            images: Array.isArray(product?.images) ? product.images : [],
            variants: Array.isArray(product?.variants) ? product.variants : [],
            pricesText: safeString(product?.pricesText, ''),
            quantity,
            addedAt: Number.isFinite(addedAtRaw) && addedAtRaw > 0 ? addedAtRaw : timestamp,
            updatedAt: Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? updatedAtRaw : timestamp,
        };
    }

    function readDexCollection() {
        try {
            const raw = localStorage.getItem(DEX_COLLECTION_KEY);
            if (!raw) return [];
            const parsed = safeParseJson(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.filter((entry) => entry && typeof entry === 'object' && safeString(entry?.id, '').trim());
        } catch {
            return [];
        }
    }

    function readDexMasterSets() {
        try {
            const raw = localStorage.getItem(DEX_MASTER_SETS_KEY);
            if (!raw) return {};
            const parsed = safeParseJson(raw);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch {
            return {};
        }
    }

    function isStorageQuotaExceededError(error) {
        const code = Number(error?.code);
        const name = String(error?.name || '').trim().toLowerCase();
        const message = String(error?.message || '').trim().toLowerCase();

        if (code === 22 || code === 1014) return true;
        if (name === 'quotaexceedederror' || name === 'ns_error_dom_quota_reached') return true;
        if (message.includes('quota') || message.includes('storage')) return true;
        return false;
    }

    function getUrlCacheKeysByOldestSave() {
        const keys = [];
        try {
            const prefix = `${CACHE_PREFIX}url:`;
            for (let i = 0; i < localStorage.length; i += 1) {
                const key = localStorage.key(i);
                if (!key || !key.startsWith(prefix)) continue;

                const parsed = safeParseJson(localStorage.getItem(key));
                const savedAt = Number(parsed?.savedAt || 0);
                keys.push({ key, savedAt: Number.isFinite(savedAt) ? savedAt : 0 });
            }
        } catch {
            // ignore
        }

        keys.sort((a, b) => a.savedAt - b.savedAt);
        return keys;
    }

    function writeCriticalStorageItem(key, serialized) {
        try {
            localStorage.setItem(key, serialized);
            return true;
        } catch (error) {
            if (!isStorageQuotaExceededError(error)) return false;
        }

        const urlCacheKeys = getUrlCacheKeysByOldestSave();
        for (const entry of urlCacheKeys) {
            try {
                localStorage.removeItem(entry.key);
            } catch {
                // ignore
            }

            try {
                localStorage.setItem(key, serialized);
                return true;
            } catch (error) {
                if (!isStorageQuotaExceededError(error)) return false;
            }
        }

        try {
            localStorage.removeItem(LAST_RESULTS_KEY);
        } catch {
            // ignore
        }

        try {
            localStorage.setItem(key, serialized);
            return true;
        } catch {
            return false;
        }
    }

    function syncSealedCollectionInCloud(entryOrId, nextQuantityRaw) {
        const authApi = window?.PV_AUTH;
        const user = authApi?.getUser ? authApi.getUser() : null;
        if (!user || !authApi?.saveDexState || !authApi?.loadDexState) return;

        const id = safeString(entryOrId?.id ?? entryOrId, '').trim();
        if (!id) return;
        const activeCollectionId = normalizeDexCollectionId(entryOrId?.collectionId, getActiveDexCollectionId());

        const nextQuantity = normalizeSealedQuantity(nextQuantityRaw, 0);
        const normalized = nextQuantity > 0
            ? normalizeSealedCollectionProduct({ ...entryOrId, collectionId: activeCollectionId, quantity: nextQuantity, updatedAt: Date.now() })
            : null;

        Promise.resolve(authApi.loadDexState())
            .then((cloudState) => {
                const cloudCollection = Array.isArray(cloudState?.collection) ? cloudState.collection : [];
                const nextCollection = cloudCollection.filter((item) => {
                    return !(normalizeCollectionItemType(item?.itemType) === 'sealed'
                        && safeString(item?.id, '').trim() === id
                        && normalizeDexCollectionId(item?.collectionId, DEX_DEFAULT_COLLECTION_ID) === activeCollectionId);
                });

                if (normalized) {
                    nextCollection.push(normalized);
                }

                const masterSets = (cloudState?.masterSets && typeof cloudState.masterSets === 'object')
                    ? cloudState.masterSets
                    : readDexMasterSets();

                return authApi.saveDexState({
                    collection: nextCollection,
                    masterSets,
                });
            })
            .catch(() => {
                // ignore
            });
    }

    function writeDexCollection(next) {
        let persisted = false;
        try {
            persisted = writeCriticalStorageItem(DEX_COLLECTION_KEY, JSON.stringify(Array.isArray(next) ? next : []));
        } catch {
            persisted = false;
        }

        if (!persisted) return false;

        try {
            window.dispatchEvent(new CustomEvent('pv:dex-state-changed'));
        } catch {
            // ignore
        }

        return true;
    }

    function getSealedCollectionQuantityMap() {
        /** @type {Record<string, number>} */
        const out = {};
        const activeCollectionId = getActiveDexCollectionId();
        const entries = readDexCollection();
        for (const entry of entries) {
            if (normalizeCollectionItemType(entry?.itemType) !== 'sealed') continue;
            if (normalizeDexCollectionId(entry?.collectionId, DEX_DEFAULT_COLLECTION_ID) !== activeCollectionId) continue;
            const id = safeString(entry?.id, '').trim();
            if (!id) continue;
            const qty = Math.max(1, normalizeSealedQuantity(entry?.quantity ?? entry?.sealedQuantity, 1));
            out[id] = (out[id] || 0) + qty;
        }
        return out;
    }

    function updateSealedCollectionQuantity(product, delta) {
        const id = safeString(product?.id, '').trim();
        const activeCollectionId = getActiveDexCollectionId();
        const qtyDelta = Math.floor(Number(delta));
        if (!Number.isFinite(qtyDelta) || qtyDelta === 0) {
            return { changed: false, quantity: 0 };
        }

        if (!id) {
            return { changed: false, quantity: 0 };
        }

        const list = readDexCollection();
        const existingIndex = list.findIndex((entry) => {
            return normalizeCollectionItemType(entry?.itemType) === 'sealed'
                && safeString(entry?.id, '').trim() === id
                && normalizeDexCollectionId(entry?.collectionId, DEX_DEFAULT_COLLECTION_ID) === activeCollectionId;
        });

        const existingEntry = existingIndex >= 0 ? list[existingIndex] : null;
        const currentQty = existingEntry
            ? Math.max(1, normalizeSealedQuantity(existingEntry?.quantity ?? existingEntry?.sealedQuantity, 1))
            : 0;
        const nextQty = Math.max(0, currentQty + qtyDelta);

        if (nextQty === currentQty) {
            return { changed: false, quantity: currentQty };
        }

        if (existingIndex >= 0) {
            if (nextQty <= 0) {
                const removed = list[existingIndex];
                const next = list.filter((_, idx) => idx !== existingIndex);
                if (!writeDexCollection(next)) {
                    return { changed: false, quantity: currentQty, storageWriteFailed: true };
                }
                syncSealedCollectionInCloud(removed, 0);
                return { changed: true, quantity: 0 };
            }

            const updated = normalizeSealedCollectionProduct({
                ...existingEntry,
                ...product,
                collectionId: activeCollectionId,
                quantity: nextQty,
                addedAt: existingEntry?.addedAt,
                updatedAt: Date.now(),
            });
            list[existingIndex] = updated;
            if (!writeDexCollection(list)) {
                return { changed: false, quantity: currentQty, storageWriteFailed: true };
            }
            syncSealedCollectionInCloud(updated, nextQty);
            return { changed: true, quantity: nextQty };
        }

        if (nextQty <= 0) {
            return { changed: false, quantity: 0 };
        }

        const normalized = normalizeSealedCollectionProduct({ ...product, collectionId: activeCollectionId, quantity: nextQty });
        list.push(normalized);
        if (!writeDexCollection(list)) {
            return { changed: false, quantity: currentQty, storageWriteFailed: true };
        }
        syncSealedCollectionInCloud(normalized, nextQty);
        return { changed: true, quantity: nextQty };
    }

    function loadFavorites() {
        try {
            /** @type {Array<any>} */
            const out = [];
            const seen = new Set();

            /** @param {any} list */
            function addList(list) {
                if (!Array.isArray(list)) return;
                for (const item of list) {
                    if (!item || typeof item !== 'object' || item.id == null) continue;
                    const normalized = normalizeFavoriteProduct(item);
                    const id = String(normalized.id || '');
                    if (!id || seen.has(id)) continue;
                    seen.add(id);
                    out.push(normalized);
                }
            }

            const watchRaw = localStorage.getItem(WATCHLIST_KEY);
            if (watchRaw) addList(safeParseJson(watchRaw));

            const legacyRaw = localStorage.getItem(LEGACY_FAVORITES_KEY);
            if (legacyRaw) addList(safeParseJson(legacyRaw));

            // Migrate/normalize into the Watchlist key.
            try {
                localStorage.setItem(WATCHLIST_KEY, JSON.stringify(out));
                localStorage.removeItem(LEGACY_FAVORITES_KEY);
            } catch {
                // ignore
            }

            return out;
        } catch {
            return [];
        }
    }

    function saveFavorites(list) {
        try {
            localStorage.setItem(WATCHLIST_KEY, JSON.stringify(Array.isArray(list) ? list : []));
            // Best-effort cleanup of legacy key.
            try { localStorage.removeItem(LEGACY_FAVORITES_KEY); } catch {}
        } catch {
            // ignore
        }
    }

    /** @type {Array<any>} */
    let favorites = loadFavorites();

    function mergeWatchlist(localList, cloudList) {
        /** @type {Array<any>} */
        const merged = [];
        const seen = new Set();

        /** @param {any} item */
        function add(item) {
            if (!item || typeof item !== 'object') return;
            const normalized = normalizeFavoriteProduct(item);
            const id = String(normalized?.id || '').trim();
            if (!id || seen.has(id)) return;
            seen.add(id);
            merged.push(normalized);
        }

        // Prefer cloud ordering/values first, then append anything local-only.
        if (Array.isArray(cloudList)) {
            for (const item of cloudList) add(item);
        }
        if (Array.isArray(localList)) {
            for (const item of localList) add(item);
        }
        return merged;
    }

    // If the user signs in, prefer cloud watchlist so it follows the account.
    // Local storage remains as an offline fallback.
    try {
        if (window?.PV_AUTH?.onAuthStateChanged && window?.PV_AUTH?.loadWatchlist) {
            window.PV_AUTH.onAuthStateChanged((user) => {
                if (!user) return;
                const localSnapshot = Array.isArray(favorites) ? favorites.slice() : loadFavorites();

                Promise.resolve(window.PV_AUTH.loadWatchlist('sealed'))
                    .then((cloudList) => {
                        if (!Array.isArray(cloudList)) return;

                        favorites = mergeWatchlist(localSnapshot, cloudList);
                        saveFavorites(favorites);

                        // Best-effort: push any local-only items into the cloud.
                        try {
                            if (window?.PV_AUTH?.saveWatchlistItem) {
                                const cloudIds = new Set(cloudList.map((x) => String(x?.id || '').trim()).filter(Boolean));
                                const toSync = localSnapshot
                                    .map(normalizeFavoriteProduct)
                                    .filter((x) => x && x.id && !cloudIds.has(String(x.id)));
                                if (toSync.length) {
                                    void Promise.allSettled(toSync.map((x) => window.PV_AUTH.saveWatchlistItem('sealed', x)));
                                }
                            }
                        } catch {
                            // ignore
                        }

                        renderFavorites();
                        renderProducts(currentResultsProducts);
                    })
                    .catch(() => {
                        // ignore
                    });
            });
        }
    } catch {
        // ignore
    }

    function loadFavoritesCollapsed() {
        try {
            const raw = localStorage.getItem(WATCHLIST_COLLAPSED_KEY);
            if (raw == null) {
                const legacy = localStorage.getItem(LEGACY_FAVORITES_COLLAPSED_KEY);
                if (legacy != null) {
                    try {
                        localStorage.setItem(WATCHLIST_COLLAPSED_KEY, legacy);
                        localStorage.removeItem(LEGACY_FAVORITES_COLLAPSED_KEY);
                    } catch {
                        // ignore
                    }
                    return legacy === '1' || legacy === 'true';
                }
            }
            return raw === '1' || raw === 'true';
        } catch {
            return false;
        }
    }

    function saveFavoritesCollapsed(isCollapsed) {
        try {
            localStorage.setItem(WATCHLIST_COLLAPSED_KEY, isCollapsed ? '1' : '0');
            try { localStorage.removeItem(LEGACY_FAVORITES_COLLAPSED_KEY); } catch {}
        } catch {
            // ignore
        }
    }

    function setFavoritesCollapsed(isCollapsed) {
        if (favoritesBody) favoritesBody.hidden = !!isCollapsed;
        if (favoritesToggle) {
            favoritesToggle.textContent = isCollapsed ? 'Show' : 'Hide';
            favoritesToggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        }
        saveFavoritesCollapsed(isCollapsed);
    }

    function isFavorite(productId) {
        const id = String(productId || '');
        return favorites.some((p) => String(p?.id || '') === id);
    }

    function toggleFavorite(product) {
        const id = safeString(product?.id, '');
        if (!id) return;

        if (isFavorite(id)) {
            favorites = favorites.filter((p) => String(p?.id || '') !== id);
            try {
                if (window?.PV_AUTH?.removeWatchlistItem) {
                    void window.PV_AUTH.removeWatchlistItem('sealed', id);
                }
            } catch {
                // ignore
            }
        } else {
            const favObj = normalizeFavoriteProduct(product);
            favorites = [...favorites, favObj];
            try {
                if (window?.PV_AUTH?.saveWatchlistItem) {
                    void window.PV_AUTH.saveWatchlistItem('sealed', favObj);
                }
            } catch {
                // ignore
            }
        }
        saveFavorites(favorites);
        renderFavorites();

        // Keep results stars in sync.
        renderProducts(currentResultsProducts);
    }

    async function clearFavorites() {
        const idsToRemove = favorites
            .map((product) => safeString(product?.id, ''))
            .filter(Boolean);
        const removedCount = idsToRemove.length;

        if (removedCount > 0) {
            setStatus('Clearing Watchlist...');
        }

        favorites = [];
        try { localStorage.removeItem(WATCHLIST_KEY); } catch {}
        try { localStorage.removeItem(LEGACY_FAVORITES_KEY); } catch {}
        renderFavorites();

        // Keep results stars in sync.
        renderProducts(currentResultsProducts);

        try {
            if (idsToRemove.length && window?.PV_AUTH?.removeWatchlistItem) {
                const settled = await Promise.allSettled(idsToRemove.map((id) => window.PV_AUTH.removeWatchlistItem('sealed', id)));
                const failedCount = settled.filter((result) => result.status === 'rejected').length;
                if (failedCount > 0) {
                    const noun = failedCount === 1 ? 'item' : 'items';
                    setStatus(`Watchlist cleared locally. ${failedCount} ${noun} could not be removed from cloud.`);
                } else {
                    setStatus('Watchlist cleared.');
                }
                return;
            }
        } catch {
            setStatus('Watchlist cleared locally. Cloud sync is currently unavailable.');
            return;
        }

        setStatus(removedCount > 0 ? 'Watchlist cleared.' : 'Watchlist already empty.');
    }

    function getWorkerBase() {
        // Always fall back to the deployed Worker URL so the app works
        // even if `secrets.js` is missing or not loaded.
        const defaultWorker = 'https://pokevalutor-v1.lreyperez18.workers.dev';
        return (window?.PV_SECRETS?.PV_API_URL || defaultWorker).replace(/\/$/, '');
    }

    function safeParseJson(value) {
        try { return JSON.parse(value); } catch { return null; }
    }

    function loadLastResults() {
        try {
            const raw = localStorage.getItem(LAST_RESULTS_KEY);
            if (!raw) return null;
            const parsed = safeParseJson(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            if (!Array.isArray(parsed.products)) return null;
            return parsed;
        } catch {
            return null;
        }
    }

    function saveLastResults(next) {
        try {
            localStorage.setItem(LAST_RESULTS_KEY, JSON.stringify(next));
        } catch {
            // ignore
        }
    }

    function clearLastResults() {
        try { localStorage.removeItem(LAST_RESULTS_KEY); } catch {}
    }

    function cacheGet(key) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const parsed = safeParseJson(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            if (typeof parsed.expiresAt !== 'number' || !('value' in parsed)) return null;
            if (Date.now() > parsed.expiresAt) {
                try { localStorage.removeItem(key); } catch {}
                return null;
            }
            return parsed.value;
        } catch {
            return null;
        }
    }

    function cacheSet(key, value, ttlMs) {
        try {
            const payload = { value, expiresAt: Date.now() + ttlMs, savedAt: Date.now() };
            localStorage.setItem(key, JSON.stringify(payload));
        } catch {
            // ignore
        }
    }

    async function fetchJsonWithCache(url, ttlMs) {
        const cacheKey = `${CACHE_PREFIX}url:${url}`;
        const cached = cacheGet(cacheKey);
        if (cached) return cached;

        let headers;
        try {
            const tokenRaw = window?.PV_AUTH?.getIdToken ? await window.PV_AUTH.getIdToken(true) : null;
            const token = typeof tokenRaw === 'string' ? tokenRaw.trim() : '';
            // Basic sanity: Firebase ID tokens are JWTs (3 dot-separated parts).
            if (token && token.split('.').length === 3) {
                headers = { Authorization: `Bearer ${token}` };
            }
        } catch {
            // ignore
        }

        const res = await fetch(url, headers ? { headers } : undefined);
        updateQuotaFromResponse(res);
        const text = await res.text();

        let data;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error('Invalid JSON response');
        }

        if (!res.ok) {
            const message = (data && typeof data === 'object' && (data.error || data.message)) ? (data.error || data.message) : `Request failed (${res.status})`;
            const err = new Error(String(message));
            // @ts-ignore
            err.status = res.status;
            // @ts-ignore
            err.isQuotaExceeded = res.status === 429;
            throw err;
        }

        cacheSet(cacheKey, data, ttlMs);
        return data;
    }

    function pickFrontSmallImage(images) {
        if (!Array.isArray(images)) return '';
        const front = images.find((img) => (img?.type || '').toLowerCase() === 'front');
        // Prefer larger assets first because some API thumbnails are tightly cropped.
        return front?.large || front?.medium || front?.small || images[0]?.large || images[0]?.medium || images[0]?.small || '';
    }

    function buildFieldQuery(fieldName, value) {
        const trimmed = String(value || '').trim();
        if (!trimmed) return '';
        const needsQuotes = /\s/.test(trimmed) || /[^A-Za-z0-9]/.test(trimmed);
        const term = needsQuotes ? `"${trimmed.replace(/"/g, '\\"')}"` : trimmed;
        return `${fieldName}:${term}`;
    }

    function escapeLucenePhrase(value) {
        return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function toWildcardToken(raw) {
        return String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function buildTokenVariants(token) {
        const base = String(token || '').trim().toLowerCase();
        if (!base) return [];

        const variants = [base];
        if (base.length >= 5 && base.endsWith('ies')) variants.push(`${base.slice(0, -3)}y`);
        if (base.length >= 4 && base.endsWith('es')) variants.push(base.slice(0, -2));
        if (base.length >= 4 && base.endsWith('s') && !base.endsWith('ss')) variants.push(base.slice(0, -1));

        return [...new Set(variants)].filter((v) => v.length >= 2);
    }

    function singularizeToken(token) {
        const base = String(token || '').trim().toLowerCase();
        if (!base) return '';
        if (base.length >= 5 && base.endsWith('ies')) return `${base.slice(0, -3)}y`;
        if (base.length >= 4 && base.endsWith('es')) return base.slice(0, -2);
        if (base.length >= 4 && base.endsWith('s') && !base.endsWith('ss')) return base.slice(0, -1);
        return base;
    }

    function buildWildcardClauseFromToken(token) {
        const variants = buildTokenVariants(token);
        if (!variants.length) return '';
        if (variants.length === 1) return `name:${variants[0]}*`;
        return `(${variants.map((v) => `name:${v}*`).join(' OR ')})`;
    }

    function isLikelyAdvancedSealedQuery(rawQuery) {
        const q = String(rawQuery || '').trim();
        if (!q) return false;

        if (/(^|\s)[a-z][a-z0-9_.]*:/.test(q)) return true;
        if (/\bAND\b|\bOR\b|\bNOT\b/i.test(q)) return true;
        if (/[()\[\]{}]/.test(q)) return true;
        if (q.includes('*')) return true;
        if (/(^|\s)-[a-z][a-z0-9_.]*:/.test(q)) return true;
        return false;
    }

    function buildSealedSearchQueryCandidates(rawInput) {
        const raw = String(rawInput || '').trim();
        if (!raw) return [];

        const candidates = [];
        const seen = new Set();
        function push(q) {
            const next = String(q || '').trim();
            if (!next || seen.has(next)) return;
            seen.add(next);
            candidates.push(next);
        }

        // Allow users to enter full Scrydex/Lucene query syntax directly.
        if (isLikelyAdvancedSealedQuery(raw)) {
            push(raw);
            return candidates;
        }

        const phraseClause = `name:"${escapeLucenePhrase(raw)}"`;
        push(phraseClause);

        const tokens = raw.split(/\s+/).map(toWildcardToken).filter(Boolean);
        if (!tokens.length) return candidates;

        const singularPhrase = tokens.map((t) => singularizeToken(t) || t).join(' ');
        if (singularPhrase && singularPhrase.toLowerCase() !== raw.toLowerCase()) {
            push(`name:"${escapeLucenePhrase(singularPhrase)}"`);
        }

        const allTokensClause = tokens
            .map((t) => buildWildcardClauseFromToken(t))
            .filter(Boolean)
            .join(' AND ');

        if (allTokensClause) push(allTokensClause);
        return candidates;
    }

    function getResultStatusText(resultCount, totalCount) {
        const shown = Number(resultCount) || 0;
        const total = Number.isFinite(Number(totalCount)) ? Number(totalCount) : null;
        if (total != null && total > shown) return `${shown} shown of ${total}.`;
        return `${shown} result${shown === 1 ? '' : 's'}.`;
    }

    function shouldShowLoadMore(resultCount, totalCount) {
        const shown = Number(resultCount) || 0;
        const total = Number.isFinite(Number(totalCount)) ? Number(totalCount) : null;
        if (total != null) return shown < total;
        return shown >= SEARCH_PAGE_SIZE && shown % SEARCH_PAGE_SIZE === 0;
    }

    function updateLoadMoreButton(visible, loading) {
        if (!loadMoreBtn) return;
        const show = Boolean(visible);
        if (loadMoreWrap) loadMoreWrap.hidden = !show;
        loadMoreBtn.hidden = !show;
        loadMoreBtn.disabled = Boolean(loading);
        loadMoreBtn.textContent = loading ? 'Loading…' : 'Load More';
    }

    function mergeUniqueProducts(existing, incoming) {
        const out = [];
        const seen = new Set();

        for (const p of Array.isArray(existing) ? existing : []) {
            const id = String(p?.id || '').trim();
            if (id && !seen.has(id)) {
                seen.add(id);
                out.push(p);
            }
        }
        for (const p of Array.isArray(incoming) ? incoming : []) {
            const id = String(p?.id || '').trim();
            if (!id || seen.has(id)) continue;
            seen.add(id);
            out.push(p);
        }
        return out;
    }

    async function fetchSealedSearchPage(query, page) {
        const base = getWorkerBase();
        const url = `${base}/sealed/search?q=${encodeURIComponent(query)}&page=${encodeURIComponent(String(page))}&pageSize=${encodeURIComponent(String(SEARCH_PAGE_SIZE))}&consumeQuota=1`;
        return fetchJsonWithCache(url, SEARCH_TTL_MS);
    }

    function formatCurrency(value, currency) {
        const n = Number(value);
        if (!Number.isFinite(n)) return 'N/A';
        const cur = String(currency || 'USD').toUpperCase();
        try {
            return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n);
        } catch {
            return `$${n.toFixed(2)}`;
        }
    }

    function getMarketQuote(product) {
        const variants = Array.isArray(product?.variants) ? product.variants : [];

        /** @type {Array<{market:number, currency:string}>} */
        const markets = [];

        for (const v of variants) {
            const prices = Array.isArray(v?.prices) ? v.prices : [];
            for (const p of prices) {
                const market = Number(p?.market);
                if (Number.isFinite(market) && market > 0) {
                    markets.push({ market, currency: String(p?.currency || 'USD') });
                }
            }
        }

        if (!markets.length) return null;

        // Prefer the lowest market value across variants/prices.
        markets.sort((a, b) => a.market - b.market);
        return markets[0];
    }

    function getMarketValue(product) {
        const quote = getMarketQuote(product);
        if (!quote) return 'N/A';
        return formatCurrency(quote.market, quote.currency);
    }

    function getSealedSetName(productLike) {
        const expansionName = safeString(productLike?.expansion?.name, '');
        const setName = safeString(productLike?.set?.name, '');
        const directSetName = safeString(productLike?.setName ?? productLike?.set_name, '');
        const directExpansionName = safeString(productLike?.expansionName ?? productLike?.expansion_name, '');
        return expansionName || setName || directSetName || directExpansionName || 'n/a';
    }

    function getSealedSeriesLabel(productLike) {
        const series = safeString(productLike?.expansion?.series ?? productLike?.series, '');
        return series || 'Sealed product';
    }

    function isDefaultSealedVariantName(rawName) {
        const normalized = safeString(rawName, '').trim().toLowerCase();
        return !normalized || normalized === 'normal' || normalized === 'default' || normalized === 'standard';
    }

    const SEALED_VARIANT_CANONICAL_ACRONYMS = new Set(['TCG', 'EX', 'GX', 'VSTAR', 'VMAX', 'XY']);

    function humanizeSealedVariantName(rawName) {
        const raw = safeString(rawName, '').trim();
        if (!raw) return '';

        const spaced = raw
            .replace(/[_-]+/g, ' ')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/\s+/g, ' ')
            .trim();

        if (!spaced) return '';

        return spaced
            .split(' ')
            .map((part) => {
                if (!part) return '';

                const upper = part.toUpperCase();
                if (/^[A-Z0-9]+$/.test(part) || SEALED_VARIANT_CANONICAL_ACRONYMS.has(upper)) {
                    return upper;
                }

                return `${part.charAt(0).toUpperCase()}${part.slice(1)}`;
            })
            .join(' ')
            .trim();
    }

    function deriveSealedVariantLabel(rawVariantName, hasMultipleVariants) {
        if (isDefaultSealedVariantName(rawVariantName)) {
            return hasMultipleVariants ? 'Standard' : '';
        }

        const raw = safeString(rawVariantName, '').trim();
        return humanizeSealedVariantName(raw) || raw;
    }

    function getSealedVariantLabel(productLike) {
        const explicit = safeString(productLike?.variantLabel, '').trim();
        if (explicit) return explicit;

        const variants = Array.isArray(productLike?.variants) ? productLike.variants : [];
        const rawName = safeString(productLike?.variantName, '').trim()
            || safeString(variants[0]?.name, '').trim();
        const hasMultipleVariants = productLike?.hasMultipleVariants === true || variants.length > 1;
        return deriveSealedVariantLabel(rawName, hasMultipleVariants);
    }

    function getSealedMetaLineText(productLike) {
        const seriesLabel = getSealedSeriesLabel(productLike);
        const variantLabel = getSealedVariantLabel(productLike);
        return variantLabel ? `${seriesLabel} • ${variantLabel}` : seriesLabel;
    }

    function getSealedSortableName(productLike) {
        const name = safeString(productLike?.name, '');
        const variantLabel = getSealedVariantLabel(productLike);
        return variantLabel ? `${name} ${variantLabel}` : name;
    }

    function buildSealedVariantProductId(baseProductIdRaw, variantNameRaw, variantIndex) {
        const baseProductId = safeString(baseProductIdRaw, '').trim();
        if (!baseProductId) return '';

        if (isDefaultSealedVariantName(variantNameRaw)) {
            // Keep default/normal IDs unchanged for backwards-compatible watchlist and collection keys.
            return baseProductId;
        }

        const fallbackKey = `variant-${Math.max(1, Number(variantIndex) + 1)}`;
        const variantKey = normalizeDexCollectionId(variantNameRaw, fallbackKey);
        return `${baseProductId}::${variantKey}`;
    }

    function createSealedDisplayProducts(products) {
        if (!Array.isArray(products) || products.length === 0) return [];

        /** @type {Array<any>} */
        const out = [];

        for (const product of products) {
            if (!product || typeof product !== 'object') continue;

            const baseProductId = safeString(product?.id, '').trim();
            // Ignore malformed products because id is required for watchlist, trade %, and collection keys.
            if (!baseProductId) continue;

            const variants = Array.isArray(product?.variants)
                ? product.variants.filter((v) => v && typeof v === 'object')
                : [];

            if (!variants.length) {
                out.push({
                    ...product,
                    id: baseProductId,
                    baseProductId,
                    variantName: '',
                    variantLabel: '',
                    hasMultipleVariants: false,
                });
                continue;
            }

            const hasMultipleVariants = variants.length > 1;
            variants.forEach((variant, index) => {
                const rawVariantName = safeString(variant?.name, '').trim();
                const variantId = buildSealedVariantProductId(baseProductId, rawVariantName, index);
                if (!variantId) return;
                const variantLabel = deriveSealedVariantLabel(rawVariantName, hasMultipleVariants);

                out.push({
                    ...product,
                    id: variantId,
                    baseProductId,
                    variantName: rawVariantName,
                    variantLabel,
                    hasMultipleVariants,
                    images: Array.isArray(variant?.images) && variant.images.length
                        ? variant.images
                        : (Array.isArray(product?.images) ? product.images : []),
                    variants: [variant],
                });
            });
        }

        return out;
    }

    function normalizeTradePercent(raw) {
        const n = Number(raw);
        if (!Number.isFinite(n)) return DEFAULT_TRADE_PERCENT;
        return Math.max(0, Math.min(200, Math.round(n)));
    }

    function loadTradePercentMap() {
        try {
            const raw = localStorage.getItem(TRADE_PERCENT_MAP_KEY);
            if (!raw) return {};
            const parsed = safeParseJson(raw);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch {
            return {};
        }
    }

    function saveTradePercentMap(map) {
        try {
            localStorage.setItem(TRADE_PERCENT_MAP_KEY, JSON.stringify(map && typeof map === 'object' ? map : {}));
        } catch {
            // ignore
        }
    }

    function getSavedTradePercentForId(id, restoreState) {
        const fromRestore = restoreState?.selections?.[id]?.tradePercent;
        if (fromRestore != null) return normalizeTradePercent(fromRestore);

        const fromMap = loadTradePercentMap()?.[id];
        if (fromMap != null) return normalizeTradePercent(fromMap);

        const prev = loadLastResults();
        const fromSaved = prev?.selections?.[id]?.tradePercent;
        if (fromSaved != null) return normalizeTradePercent(fromSaved);
        return DEFAULT_TRADE_PERCENT;
    }

    function persistTradePercent(id, tradePercent) {
        const nextPct = normalizeTradePercent(tradePercent);

        // Persist independently of lastResults so Favorites keeps the value across reload/navigation.
        const map = loadTradePercentMap();
        map[id] = nextPct;
        saveTradePercentMap(map);

        // Also persist into lastResults when available.
        const prev = loadLastResults();
        if (prev && Array.isArray(prev.products)) {
            const selections = (prev.selections && typeof prev.selections === 'object') ? prev.selections : {};
            const prevSel = (selections[id] && typeof selections[id] === 'object') ? selections[id] : {};
            selections[id] = { ...prevSel, tradePercent: nextPct };
            saveLastResults({ ...prev, selections });
        }
    }

    function buildMarketLineHtml(product, tradePercent) {
        const quote = getMarketQuote(product);
        if (!quote) {
            return '<span class="pv-priceMessage">Market price unavailable.</span>';
        }

        const pct = normalizeTradePercent(tradePercent);
        const marketText = formatCurrency(quote.market, quote.currency);
        const tradeText = formatCurrency(quote.market * (pct / 100), quote.currency);

        return `<div class="pv-priceLine"><span class="pv-priceLine__condition">Value:</span><span class="pv-priceLine__values"><span class="pv-priceToken pv-priceToken--market"><span class="pv-priceToken__amount">${escapeHtml(marketText)}</span></span></span></div><div class="pv-priceLine pv-priceLine--tradeRow"><span class="pv-priceLine__condition">Trade:</span><span class="pv-priceLine__values"><span class="pv-priceToken pv-priceToken--trade"><span class="pv-priceToken__label">@${escapeHtml(String(pct))}%</span><span class="pv-priceToken__amount">${escapeHtml(tradeText)}</span></span></span></div>`;
    }

    function setFavoritesTotalsText(totalText, tradeText) {
        if (!favoritesTotalsEl) return;
        favoritesTotalsEl.textContent = '';

        const totalSpan = document.createElement('span');
        totalSpan.className = 'pv-totals__total';
        totalSpan.textContent = totalText;

        const sepSpan = document.createElement('span');
        sepSpan.className = 'pv-totals__sep';
        sepSpan.textContent = ' • ';

        const tradeSpan = document.createElement('span');
        tradeSpan.className = 'pv-totals__trade';
        tradeSpan.textContent = tradeText;

        favoritesTotalsEl.appendChild(totalSpan);
        favoritesTotalsEl.appendChild(sepSpan);
        favoritesTotalsEl.appendChild(tradeSpan);
    }

    function updateFavoritesTotals(restoreState) {
        if (!favoritesTotalsEl) return;

        const totalCount = Array.isArray(favorites) ? favorites.length : 0;
        if (totalCount === 0) {
            setFavoritesTotalsText('Total: $0.00', 'Trade: $0.00');
            return;
        }

        let pricedCount = 0;
        let totalMarket = 0;
        let totalTrade = 0;
        let currency = null;
        let mixedCurrency = false;

        for (const fav of favorites) {
            const id = safeString(fav?.id, '');
            const pct = getSavedTradePercentForId(id, restoreState);
            const quote = getMarketQuote(fav);
            if (!quote) continue;

            const cur = String(quote.currency || 'USD');
            if (currency == null) currency = cur;
            else if (cur !== currency) mixedCurrency = true;

            pricedCount++;
            totalMarket += Number(quote.market) || 0;
            totalTrade += (Number(quote.market) || 0) * (Number(pct) / 100);
        }

        const coverage = pricedCount < totalCount ? ` • ${pricedCount}/${totalCount} priced` : '';
        if (mixedCurrency) {
            setFavoritesTotalsText('Total: N/A', `Trade: N/A${coverage}`);
            return;
        }

        setFavoritesTotalsText(
            `Total: ${formatCurrency(totalMarket, currency || 'USD')}`,
            `Trade: ${formatCurrency(totalTrade, currency || 'USD')}${coverage}`
        );
    }

    function createSealedQuantityStepper(productLike, currentQty, onAdjust) {
        const name = safeString(productLike?.name, 'sealed product');
        const qty = Math.max(0, Math.floor(Number(currentQty) || 0));

        const stepper = document.createElement('div');
        stepper.className = 'pv-qtyStepper pv-qtyStepper--sealed';
        stepper.setAttribute('role', 'group');
        stepper.setAttribute('aria-label', `Adjust sealed quantity for ${name}`);

        const decBtn = document.createElement('button');
        decBtn.className = 'pv-button btn pv-qtyBtn';
        decBtn.type = 'button';
        decBtn.textContent = '-';
        decBtn.disabled = qty <= 0;
        decBtn.setAttribute('aria-label', `Decrease sealed quantity for ${name}`);
        decBtn.addEventListener('click', () => onAdjust(-1));

        const qtyValue = document.createElement('span');
        qtyValue.className = 'pv-qtyValue';
        qtyValue.textContent = String(qty);

        const incBtn = document.createElement('button');
        incBtn.className = 'pv-button btn pv-qtyBtn';
        incBtn.type = 'button';
        incBtn.textContent = '+';
        incBtn.setAttribute('aria-label', `Increase sealed quantity for ${name}`);
        incBtn.addEventListener('click', () => onAdjust(1));

        stepper.appendChild(decBtn);
        stepper.appendChild(qtyValue);
        stepper.appendChild(incBtn);
        return stepper;
    }

    function renderFavorites(restoreState) {
        if (!favoritesGrid) return;
        favoritesGrid.innerHTML = '';

        if (!Array.isArray(favorites) || favorites.length === 0) {
            favoritesGrid.innerHTML = '<div class="col-12"><p class="pv-section__text">No watchlist items yet.</p></div>';
            updateFavoritesTotals(restoreState);
            return;
        }

        const sortedFavorites = favorites.slice().sort(compareSealedFavoritesForSort);
        const collectionQtyById = getSealedCollectionQuantityMap();

        for (const fav of sortedFavorites) {
            const col = document.createElement('div');
            col.className = 'col-6 col-sm-6 col-md-4 col-lg-3 pv-sealedCol';

            const card = document.createElement('div');
            card.className = 'pv-card pv-card--sealed h-100';

            const mediaWrap = document.createElement('div');
            mediaWrap.className = 'pv-card__imgLink pv-card__imgLink--sealed';
            mediaWrap.setAttribute('aria-hidden', 'true');

            const imgUrl = pickFrontSmallImage(fav?.images);
            if (imgUrl) {
                const img = document.createElement('img');
                img.className = 'pv-card__img pv-card__img--sealed';
                img.loading = 'lazy';
                img.alt = String(fav?.name || 'Sealed product');
                img.src = imgUrl;
                mediaWrap.appendChild(img);
            }

            card.appendChild(mediaWrap);

            const body = document.createElement('div');
            body.className = 'pv-card__body';

            const header = document.createElement('div');
            header.className = 'pv-card__header';

            const title = document.createElement('h3');
            title.className = 'pv-card__title';
            title.textContent = String(fav?.name || 'Unknown');

            const productId = safeString(fav?.id, '');
            const quantity = Math.max(0, Math.floor(Number(collectionQtyById[productId]) || 0));
            const quantityStepper = createSealedQuantityStepper(fav, quantity, (delta) => {
                const result = updateSealedCollectionQuantity(fav, delta);
                if (result.storageWriteFailed) {
                    setStatus('Could not save this collection change. Local storage is full; please try again.');
                    return;
                }
                if (!result.changed) return;
                renderFavorites(loadLastResults() || restoreState);
                renderProducts(currentResultsProducts, loadLastResults() || restoreState);
            });

            const favBtn = document.createElement('button');
            favBtn.className = 'pv-fav-btn';
            favBtn.type = 'button';
            favBtn.setAttribute('aria-label', 'Remove from watchlist');
            favBtn.textContent = '★';
            favBtn.addEventListener('click', () => toggleFavorite(fav));

            const actions = document.createElement('div');
            actions.className = 'pv-card__actions';
            actions.appendChild(quantityStepper);
            actions.appendChild(favBtn);

            header.appendChild(title);
            header.appendChild(actions);

            const setNameLine = document.createElement('p');
            setNameLine.className = 'pv-card__text pv-card__setName';
            setNameLine.textContent = getSealedSetName(fav);

            const metaLine = document.createElement('p');
            metaLine.className = 'pv-card__text pv-card__rarity';
            metaLine.textContent = getSealedMetaLineText(fav);

            const tradeField = document.createElement('div');
            tradeField.className = 'pv-form__field';
            tradeField.style.marginBottom = '0.5rem';

            const tradeLabel = document.createElement('label');
            tradeLabel.className = 'form-label';
            tradeLabel.htmlFor = `pv-sealed-trade-${productId}`;
            tradeLabel.textContent = 'Trade %';

            const tradeSelect = document.createElement('select');
            tradeSelect.className = 'form-select pv-selectCompact pv-selectTrade';
            tradeSelect.id = `pv-sealed-trade-${productId}`;
            const pct = getSavedTradePercentForId(productId, restoreState);
            tradeSelect.innerHTML = TRADE_PERCENT_CHOICES
                .map((p) => `<option value="${p}" ${p === pct ? 'selected' : ''}>${p}%</option>`)
                .join('');

            tradeField.appendChild(tradeLabel);
            tradeField.appendChild(tradeSelect);

            const marketLine = document.createElement('div');
            marketLine.className = 'pv-card__text pv-card__prices';
            marketLine.innerHTML = buildMarketLineHtml(fav, pct);

            tradeSelect.addEventListener('change', () => {
                const nextPct = normalizeTradePercent(tradeSelect.value);
                marketLine.innerHTML = buildMarketLineHtml(fav, nextPct);
                if (productId) persistTradePercent(productId, nextPct);
                updateFavoritesTotals(loadLastResults() || restoreState);
            });

            body.appendChild(header);
            body.appendChild(setNameLine);
            body.appendChild(metaLine);
            body.appendChild(tradeField);
            body.appendChild(marketLine);
            card.appendChild(body);
            col.appendChild(card);
            favoritesGrid.appendChild(col);
        }

        updateFavoritesTotals(restoreState);
    }

    function renderProducts(products, restoreState) {
        if (!grid) return;
        const sourceProducts = Array.isArray(products) ? products : [];
        const displayProducts = createSealedDisplayProducts(sourceProducts);
        currentResultsProducts = sourceProducts.slice();
        grid.innerHTML = '';

        if (!displayProducts.length) {
            for (const key of Object.keys(sealedValueById)) {
                delete sealedValueById[key];
            }
            grid.innerHTML = '<div class="col-12"><p class="pv-section__text">No results found.</p></div>';
            return;
        }

        const visibleIds = new Set();
        for (const product of displayProducts) {
            const id = safeString(product?.id, '');
            if (!id) continue;
            visibleIds.add(id);
            const market = Number(getMarketQuote(product)?.market);
            setSealedProductValue(id, market);
        }
        for (const key of Object.keys(sealedValueById)) {
            if (!visibleIds.has(key)) {
                delete sealedValueById[key];
            }
        }

        const sortedProducts = displayProducts.slice().sort(compareSealedProductsForSort);
        const collectionQtyById = getSealedCollectionQuantityMap();

        for (const p of sortedProducts) {
            const col = document.createElement('div');
            col.className = 'col-6 col-sm-6 col-md-4 col-lg-3 pv-sealedCol';
            const productId = safeString(p?.id, '');
            const sortableName = getSealedSortableName(p);
            col.setAttribute('data-product-id', escapeAttr(productId));
            col.setAttribute('data-product-name', escapeAttr(sortableName));

            const card = document.createElement('div');
            card.className = 'pv-card pv-card--sealed h-100';

            const mediaWrap = document.createElement('div');
            mediaWrap.className = 'pv-card__imgLink pv-card__imgLink--sealed';
            mediaWrap.setAttribute('aria-hidden', 'true');

            const imgUrl = pickFrontSmallImage(p?.images);
            if (imgUrl) {
                const img = document.createElement('img');
                img.className = 'pv-card__img pv-card__img--sealed';
                img.loading = 'lazy';
                img.alt = String(p?.name || 'Sealed product');
                img.src = imgUrl;
                mediaWrap.appendChild(img);
            }

            card.appendChild(mediaWrap);

            const body = document.createElement('div');
            body.className = 'pv-card__body';

            const header = document.createElement('div');
            header.className = 'pv-card__header';

            const title = document.createElement('h3');
            title.className = 'pv-card__title';
            title.textContent = String(p?.name || 'Unknown');

            const favBtn = document.createElement('button');
            favBtn.className = 'pv-fav-btn';
            favBtn.type = 'button';
            const favored = isFavorite(p?.id);
            favBtn.setAttribute('aria-label', favored ? 'Remove from watchlist' : 'Add to watchlist');
            favBtn.textContent = favored ? '★' : '☆';
            favBtn.addEventListener('click', () => toggleFavorite(p));

            const quantity = Math.max(0, Math.floor(Number(collectionQtyById[productId]) || 0));
            const quantityStepper = createSealedQuantityStepper(p, quantity, (delta) => {
                const result = updateSealedCollectionQuantity(p, delta);
                if (result.storageWriteFailed) {
                    setStatus('Could not save this collection change. Local storage is full; please try again.');
                    return;
                }
                if (!result.changed) return;
                renderProducts(currentResultsProducts, loadLastResults() || restoreState);
                renderFavorites(loadLastResults() || restoreState);
            });

            const actions = document.createElement('div');
            actions.className = 'pv-card__actions';
            actions.appendChild(quantityStepper);
            actions.appendChild(favBtn);

            header.appendChild(title);
            header.appendChild(actions);

            const setNameLine = document.createElement('p');
            setNameLine.className = 'pv-card__text pv-card__setName';
            setNameLine.textContent = getSealedSetName(p);

            const metaLine = document.createElement('p');
            metaLine.className = 'pv-card__text pv-card__rarity';
            metaLine.textContent = getSealedMetaLineText(p);

            const tradeField = document.createElement('div');
            tradeField.className = 'pv-form__field';
            tradeField.style.marginBottom = '0.5rem';

            const tradeLabel = document.createElement('label');
            tradeLabel.className = 'form-label';
            tradeLabel.htmlFor = `pv-sealed-trade-${productId}`;
            tradeLabel.textContent = 'Trade %';

            const tradeSelect = document.createElement('select');
            tradeSelect.className = 'form-select pv-selectCompact pv-selectTrade';
            tradeSelect.id = `pv-sealed-trade-${productId}`;
            const pct = getSavedTradePercentForId(productId, restoreState);
            tradeSelect.innerHTML = TRADE_PERCENT_CHOICES
                .map((pp) => `<option value="${pp}" ${pp === pct ? 'selected' : ''}>${pp}%</option>`)
                .join('');

            tradeField.appendChild(tradeLabel);
            tradeField.appendChild(tradeSelect);

            const marketLine = document.createElement('div');
            marketLine.className = 'pv-card__text pv-card__prices';
            marketLine.innerHTML = buildMarketLineHtml(p, pct);

            tradeSelect.addEventListener('change', () => {
                const nextPct = normalizeTradePercent(tradeSelect.value);
                marketLine.innerHTML = buildMarketLineHtml(p, nextPct);
                if (productId) persistTradePercent(productId, nextPct);
            });

            body.appendChild(header);
            body.appendChild(setNameLine);
            body.appendChild(metaLine);
            body.appendChild(tradeField);
            body.appendChild(marketLine);

            card.appendChild(body);
            col.appendChild(card);
            grid.appendChild(col);
        }

        applySealedSortToGrid();
    }

    async function searchByName(name) {
        const q = (name || '').trim();
        if (!q) {
            setStatus('Enter a product name.');
            if (grid) grid.innerHTML = '';
            currentSearchHasMore = false;
            updateLoadMoreButton(false, false);
            return;
        }

        const queryCandidates = buildSealedSearchQueryCandidates(q);
        const fallbackQuery = queryCandidates[0] || '';
        currentSearchQuery = fallbackQuery;
        currentSearchPage = 0;
        currentSearchTotalCount = null;
        currentSearchHasMore = false;
        isLoadingMore = false;

        setStatus('Searching…');
        if (grid) grid.innerHTML = '';
        updateLoadMoreButton(false, false);

        try {
            let usedQuery = fallbackQuery;
            let data = null;
            let list = [];

            for (const candidate of queryCandidates) {
                const nextData = await fetchSealedSearchPage(candidate, 1);
                const nextList = Array.isArray(nextData?.data) ? nextData.data : [];
                data = nextData;
                list = nextList;
                usedQuery = candidate;
                if (nextList.length > 0) break;
            }

            currentSearchQuery = usedQuery;
            const totalCountNum = Number(data?.totalCount);
            const totalCount = Number.isFinite(totalCountNum) ? totalCountNum : null;

            currentSearchPage = 1;
            currentSearchTotalCount = totalCount;
            renderProducts(list);

            if (list.length) {
                currentSearchHasMore = shouldShowLoadMore(list.length, totalCount);
                setStatus(getResultStatusText(list.length, totalCount));
                updateLoadMoreButton(currentSearchHasMore, false);
            } else {
                currentSearchHasMore = false;
                setStatus('No results found. Try another name.');
                updateLoadMoreButton(false, false);
            }

            const prev = loadLastResults();
            const preservedSelections = (prev?.selections && typeof prev.selections === 'object') ? prev.selections : {};
            const statusText = list.length
                ? getResultStatusText(list.length, totalCount)
                : 'No results found. Try another name.';

            saveLastResults({
                mode: 'name',
                query: q,
                builtQuery: usedQuery,
                page: 1,
                totalCount,
                products: list,
                statusText,
                selections: preservedSelections,
                savedAt: Date.now(),
            });
        } catch (e) {
            if (isQuotaExceededError(e)) {
                setStatus('Daily guest allowance reached. Sign in to continue.');
            } else {
                setStatus(`Error: ${e?.message || 'Search failed.'}`);
            }
            if (grid) grid.innerHTML = '';
            updateLoadMoreButton(false, false);
        }
    }

    async function loadMoreResults() {
        if (!currentSearchQuery || isLoadingMore || !currentSearchHasMore) return;

        isLoadingMore = true;
        updateLoadMoreButton(true, true);

        const nextPage = currentSearchPage + 1;
        try {
            const data = await fetchSealedSearchPage(currentSearchQuery, nextPage);
            const nextItems = Array.isArray(data?.data) ? data.data : [];
            const totalCountNum = Number(data?.totalCount);
            const totalCount = Number.isFinite(totalCountNum) ? totalCountNum : currentSearchTotalCount;

            if (!nextItems.length) {
                currentSearchHasMore = false;
                updateLoadMoreButton(false, false);
                setStatus(getResultStatusText(currentResultsProducts.length, totalCount));
                return;
            }

            const merged = mergeUniqueProducts(currentResultsProducts, nextItems);
            currentSearchPage = nextPage;
            currentSearchTotalCount = totalCount;
            renderProducts(merged);

            const statusText = getResultStatusText(merged.length, totalCount);
            setStatus(statusText);
            if (totalCount != null) {
                currentSearchHasMore = merged.length < totalCount;
            } else {
                currentSearchHasMore = nextItems.length >= SEARCH_PAGE_SIZE;
            }
            updateLoadMoreButton(currentSearchHasMore, false);

            const prev = loadLastResults();
            const preservedSelections = (prev?.selections && typeof prev.selections === 'object') ? prev.selections : {};
            saveLastResults({
                mode: 'name',
                query: input ? String(input.value || '').trim() : (prev?.query || ''),
                builtQuery: currentSearchQuery,
                page: currentSearchPage,
                totalCount,
                products: merged,
                statusText,
                selections: preservedSelections,
                savedAt: Date.now(),
            });
        } catch (e) {
            if (isQuotaExceededError(e)) {
                setStatus('Daily guest allowance reached. Sign in to continue.');
            } else {
                setStatus(`Error: ${e?.message || 'Search failed.'}`);
            }
            updateLoadMoreButton(currentSearchHasMore, false);
        } finally {
            isLoadingMore = false;
            updateLoadMoreButton(currentSearchHasMore, false);
        }
    }

    function clearResultsUI() {
        if (grid) grid.innerHTML = '';
        setStatus('');
        currentResultsProducts = [];
        for (const key of Object.keys(sealedValueById)) {
            delete sealedValueById[key];
        }
        currentSearchQuery = '';
        currentSearchPage = 0;
        currentSearchTotalCount = null;
        currentSearchHasMore = false;
        isLoadingMore = false;
        updateLoadMoreButton(false, false);
        clearLastResults();
    }

    if (form && input) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            searchByName(input.value);
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (input) input.value = '';
            clearResultsUI();
        });
    }

    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', () => {
            void loadMoreResults();
        });
    }

    bindSealedSortControls();
    bindSealedFavoritesSortControls();
    renderSealedCollectionContext(readCollectionContextMetaLocal());
    setSealedCollectionContextVisible(false);

    if (sealedCollectionSelectEl && sealedCollectionSelectEl.getAttribute('data-bound') !== '1') {
        sealedCollectionSelectEl.setAttribute('data-bound', '1');
        sealedCollectionSelectEl.addEventListener('change', () => {
            void switchActiveCollectionContext(sealedCollectionSelectEl.value);
        });
    }

    try {
        if (window?.PV_AUTH?.onAuthStateChanged) {
            window.PV_AUTH.onAuthStateChanged(() => {
                void refreshCollectionContextUi();
            });
        } else {
            void refreshCollectionContextUi();
        }
    } catch {
        // ignore
    }

    window.addEventListener('storage', (event) => {
        const key = String(event?.key || '');
        if (key !== DEX_ACTIVE_COLLECTION_KEY && key !== DEX_COLLECTIONS_META_KEY) return;
        void refreshCollectionContextUi();
    });

    window.addEventListener('pv:dex-collection-context-changed', () => {
        void refreshCollectionContextUi();
    });

    // Render Favorites immediately (persisted across refresh).
    renderFavorites();

    // Favorites collapsible behavior (persisted across refresh).
    if (favoritesToggle) {
        favoritesToggle.addEventListener('click', () => {
            const isCollapsed = favoritesBody ? !favoritesBody.hidden : false;
            setFavoritesCollapsed(isCollapsed);
        });
    }
    setFavoritesCollapsed(loadFavoritesCollapsed());

    if (favoritesClearBtn) {
        favoritesClearBtn.addEventListener('click', async () => {
            const itemCount = Array.isArray(favorites) ? favorites.length : 0;
            if (itemCount > 0) {
                const noun = itemCount === 1 ? 'item' : 'items';
                const signedIn = Boolean(window?.PV_AUTH?.getUser && window.PV_AUTH.getUser());
                const confirmMessage = signedIn
                    ? `Clear ${itemCount} watchlist ${noun}? This will remove ${itemCount === 1 ? 'it' : 'them'} from this device and your cloud watchlist.`
                    : `Clear ${itemCount} watchlist ${noun} from this browser?`;
                const confirmed = window.confirm(confirmMessage);
                if (!confirmed) {
                    setStatus('Watchlist clear canceled.');
                    return;
                }
            }

            if (favoritesClearBtn instanceof HTMLButtonElement) {
                favoritesClearBtn.disabled = true;
            }
            try {
                await clearFavorites();
            } finally {
                if (favoritesClearBtn instanceof HTMLButtonElement) {
                    favoritesClearBtn.disabled = false;
                }
            }
        });
    }

    // Restore last results after refresh.
    const restored = loadLastResults();
    if (restored && Array.isArray(restored.products) && restored.products.length) {
        if (restored.mode === 'name' && input) input.value = String(restored.query || '');
        const restoredCandidates = buildSealedSearchQueryCandidates(restored.query || '');
        currentSearchQuery = String(restored.builtQuery || restoredCandidates[0] || '');
        currentSearchPage = Math.max(1, Number(restored.page) || 1);
        const restoredTotalCountNum = Number(restored.totalCount);
        currentSearchTotalCount = Number.isFinite(restoredTotalCountNum) ? restoredTotalCountNum : null;
        currentSearchHasMore = shouldShowLoadMore(restored.products.length, currentSearchTotalCount);
        renderProducts(restored.products, restored);
        renderFavorites(restored);
        updateLoadMoreButton(currentSearchHasMore, false);
        if (restored.statusText) {
            const restoredStatus = String(restored.statusText);
            if (/\bTip:/i.test(restoredStatus)) {
                setStatus(getResultStatusText(restored.products.length, currentSearchTotalCount));
            } else {
                setStatus(restoredStatus);
            }
        }
    }

    if (scrollTopBtn) {
        scrollTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
});

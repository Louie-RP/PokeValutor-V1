/* Scrydex-backed Search page behavior */
document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('pv-search-form');
    const input = /** @type {HTMLInputElement} */(document.getElementById('pv-search-query'));
    const seriesSelect = /** @type {HTMLSelectElement|null} */(document.getElementById('pv-search-series'));
    const setSelect = /** @type {HTMLSelectElement|null} */(document.getElementById('pv-search-set'));
    const seriesSetToggle = /** @type {HTMLInputElement|null} */(document.getElementById('pv-search-series-set-toggle'));
    const loadMoreBtn = /** @type {HTMLButtonElement|null} */(document.getElementById('pv-search-load-more'));
    const status = document.getElementById('pv-search-status');
    const searchResultsTitleEl = document.getElementById('pv-search-results-title');
    const dexResultsContextEl = document.getElementById('pv-dex-results-context');
    const dexSearchPanel = /** @type {HTMLDetailsElement|null} */ (document.getElementById('pv-dex-search-panel'));
    const dexStatCardsEl = document.getElementById('pv-dex-stat-cards');
    const dexStatCopiesEl = document.getElementById('pv-dex-stat-copies');
    const grid = document.getElementById('pv-search-grid');
    const favoritesGrid = document.getElementById('pv-favorites-grid');
    const favoritesBody = document.getElementById('pv-favorites-body');
    const favoritesToggle = document.getElementById('pv-favorites-toggle');
    const favoritesClearBtn = document.getElementById('pv-favorites-clear');
    const favoritesTotalsEl = document.getElementById('pv-favorites-totals');
    const favoritesSortSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('pv-favorites-sort-select'));
    const scrollTopBtn = document.getElementById('pv-scroll-top');
    const clearBtn = document.getElementById('pv-clear-results');
    const searchSortSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('pv-search-sort-select'));
    const conditionSummaryEl = document.getElementById('pv-condition-summary');
    const conditionTipEl = document.getElementById('pv-condition-tip');
    const conditionCheckboxEls = /** @type {HTMLInputElement[]} */ (Array.from(document.querySelectorAll('input[name="pv-condition-filter"]')));
    const searchCollectionContextEl = document.getElementById('pv-search-collection-context');
    const searchCollectionSelectEl = /** @type {HTMLSelectElement|null} */ (document.getElementById('pv-search-collection-select'));
    const searchCollectionStatusEl = document.getElementById('pv-search-collection-status');

    const quotaBanner = document.getElementById('pv-quota-banner');
    const quotaMessageEl = document.getElementById('pv-quota-message');
    const quotaCtaEl = /** @type {HTMLAnchorElement|null} */ (document.getElementById('pv-quota-cta'));
    /** @type {HTMLElement|null} */
    let actionToastEl = null;
    /** @type {number} */
    let actionToastHideTimer = 0;
    /** @type {number} */
    let actionToastHideTransitionTimer = 0;

    const CACHE_PREFIX = 'pv:scrydex:';
    const SEARCH_TTL_MS = 12 * 60 * 60 * 1000;
    const CARD_TTL_MS = 24 * 60 * 60 * 1000;
    const EXPANSIONS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const EXPANSIONS_PAGE_SIZE = 100;
    const SET_SEARCH_PAGE_SIZE = 100;
    const NAME_SEARCH_PAGE_SIZE = 15;
    const NUMBER_SEARCH_PAGE_SIZE = 15;
    const SET_SEARCH_MAX_PAGES = 10;
    const MAX_CACHE_ENTRIES = 250;
    const MAX_SAVED_RESULTS_CARDS = 250;
    const MAX_RESTORE_RENDER_CARDS = 120;
    const FAVORITE_PRICE_PRELOAD_LIMIT = 12;
    const FAVORITE_PRICE_REFRESH_LIMIT = 24;
    const FAVORITE_PRICE_REFRESH_STAGGER_MS = 180;
    const FAVORITE_PRICE_REFRESH_INTERVAL_MS = 8 * 60 * 60 * 1000;
    const FAVORITE_PRICE_SCHEMA_VERSION = 2;
    const MAX_STORAGE_JSON_CHARS = 800000;
    const MAX_LAST_RESULTS_JSON_CHARS = 220000;
    const MAX_CACHE_ITEM_JSON_CHARS = 240000;
    const MAX_SAVED_SELECTIONS = 500;
    const MAX_SAVED_PRICES_TEXT_CHARS = 240;
    const LAST_RESULTS_PERSIST_DELAY_MS = 140;

    const QUOTA_STORAGE_KEY = 'pv:quota:last:v1';
    const SET_FILTER_STATE_KEY = `${CACHE_PREFIX}setFilterState:v1`;
    const SEARCH_SERIES_SET_VISIBLE_KEY = `${CACHE_PREFIX}searchSeriesSetVisibleMobile:v1`;

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

    const DEFAULT_TRADE_PERCENT = 80;
    const TRADE_PERCENT_CHOICES = [100, 90, 80, 70, 60, 50];
    const DEX_CARD_CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DM'];
    const DEX_DEFAULT_VARIANT_NAME = 'Standard';

    const LAST_RESULTS_KEY = `${CACHE_PREFIX}lastResults:v1`;
    // Single saved-items list is now the Watchlist.
    // Migrate legacy Favorites storage into Watchlist to avoid data loss.
    const WATCHLIST_KEY = `${CACHE_PREFIX}watchlist:v1`;
    const WATCHLIST_COLLAPSED_KEY = `${CACHE_PREFIX}watchlistCollapsed:v1`;
    const LEGACY_FAVORITES_KEY = `${CACHE_PREFIX}favorites:v1`;
    const LEGACY_FAVORITES_COLLAPSED_KEY = `${CACHE_PREFIX}favoritesCollapsed:v1`;
    const DEX_COLLECTION_KEY = `${CACHE_PREFIX}collection:v1`;
    const DEX_MASTER_SETS_KEY = `${CACHE_PREFIX}masterSets:v1`;
    const DEX_OWNER_UID_KEY = `${CACHE_PREFIX}dexOwnerUid:v1`;
    const DEX_ACTIVE_COLLECTION_KEY = `${CACHE_PREFIX}activeCollectionId:v1`;
    const DEX_COLLECTIONS_META_KEY = `${CACHE_PREFIX}collectionsMeta:v1`;
    const DEX_DEFAULT_COLLECTION_ID = 'default';
    const DEX_DEFAULT_COLLECTION_NAME = 'Default Collection';
    const DEX_MAX_COLLECTIONS_PREMIUM = 3;
    const TRADE_PERCENT_MAP_KEY = `${CACHE_PREFIX}tradePercentById:v1`;
    const CONDITION_FILTER_KEY = `${CACHE_PREFIX}conditionFilter:v1`;
    const DEX_SEARCH_PANEL_OPEN_KEY = `${CACHE_PREFIX}dexSearchPanelOpen:v1`;
    const storageUtil = window?.PV_STORAGE_UTIL || null;

    const CONDITION_FILTER_KEYS_FALLBACK = ['NM', 'LP', 'MP', 'OTHER'];
    const CONDITION_FILTER_KEYS = (() => {
        const keys = Array.from(new Set(
            conditionCheckboxEls
                .map((cb) => String(cb?.value || '').trim().toUpperCase())
                .filter(Boolean)
        ));
        return keys.length ? keys : CONDITION_FILTER_KEYS_FALLBACK.slice();
    })();
    const DEFAULT_CONDITION_FILTERS = (() => {
        const preferred = ['NM', 'LP', 'MP'].filter((key) => CONDITION_FILTER_KEYS.includes(key));
        if (preferred.length) return preferred;
        return [CONDITION_FILTER_KEYS[0] || 'NM'];
    })();
    const DEFAULT_CONDITION_FILTER_KEY = DEFAULT_CONDITION_FILTERS[0] || 'NM';

    const PV_BUILD = '2026-05-09-1';
    const isDexPage = document.body?.id === 'pv-dex-body';
    const isSearchPage = document.body?.id === 'pv-search-body';
    const enableDexTrackingControls = isDexPage || isSearchPage;
    const SEARCH_SORT_PREF_KEY = isDexPage
        ? `${CACHE_PREFIX}dexSearchSortMode:v1`
        : `${CACHE_PREFIX}searchSortMode:v1`;
    const FAVORITES_SORT_PREF_KEY = `${CACHE_PREFIX}searchWatchlistSortMode:v1`;
    try {
        if (localStorage.getItem('pv:debug') === '1') {
            console.info('[PokeValutor] search.js build', PV_BUILD);
        }
    } catch {
        // ignore
    }

    let startupStatusNotice = '';

    function clearSearchBootCacheForRecovery() {
        const keys = [
            LAST_RESULTS_KEY,
            WATCHLIST_KEY,
            LEGACY_FAVORITES_KEY,
            CONDITION_FILTER_KEY,
            TRADE_PERCENT_MAP_KEY,
        ];

        try {
            for (const key of keys) {
                try { localStorage.removeItem(key); } catch {}
            }

            const urlCachePrefix = `${CACHE_PREFIX}url:`;
            const urlCacheKeys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(urlCachePrefix)) {
                    urlCacheKeys.push(key);
                }
            }
            for (const key of urlCacheKeys) {
                try { localStorage.removeItem(key); } catch {}
            }
        } catch {
            // ignore
        }
    }

    try {
        const params = new URLSearchParams(window.location.search || '');
        if (params.get('pvSafeReset') === '1') {
            clearSearchBootCacheForRecovery();
            startupStatusNotice = 'Local Search cache was reset. You can use the page normally now.';

            params.delete('pvSafeReset');
            const query = params.toString();
            const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash || ''}`;
            window.history.replaceState(null, '', nextUrl);
        }
    } catch {
        // ignore
    }

    /** @type {Array<any>} */
    let currentResultsCards = [];

    const searchSortState = {
        active: 'value',
        nameDir: 'asc',
        valueDir: 'desc',
    };

    const favoritesSortState = {
        active: 'value',
        nameDir: 'asc',
        valueDir: 'desc',
    };
    const favoritePriceRefreshInFlight = new Set();
    let favoritesForceRefreshRenderTimer = 0;

    function scheduleFavoritesForceRefreshRender(restoreState) {
        if (favoritesForceRefreshRenderTimer) return;
        favoritesForceRefreshRenderTimer = window.setTimeout(() => {
            favoritesForceRefreshRenderTimer = 0;
            try {
                renderFavorites(loadLastResults() || restoreState || undefined);
            } catch {
                // ignore
            }
        }, 350);
    }

    /** @type {any|null|undefined} undefined=not loaded yet */
    let lastResultsCache = undefined;
    /** @type {Record<string, number>|null} */
    let tradePercentMapCache = null;
    let tradePercentMapLoaded = false;
    let lastResultsPersistScheduled = false;
    let lastResultsPersistTimer = 0;

    /** @type {Record<string, number>} */
    const searchValueById = {};
    let cacheWritesSinceSweep = 0;
    let searchCollectionContextBusy = false;
    let searchCollectionContextMeta = {
        activeCollectionId: DEX_DEFAULT_COLLECTION_ID,
        collections: [{ id: DEX_DEFAULT_COLLECTION_ID, name: DEX_DEFAULT_COLLECTION_NAME }],
    };

    let dexSetBrowseState = {
        active: false,
        mode: '',
        query: '',
        expansionId: '',
        expansionName: '',
        expansionSeries: '',
        queryCandidates: /** @type {Array<string>} */ ([]),
        matchedQuery: '',
        nextPage: 1,
        pageSize: SET_SEARCH_PAGE_SIZE,
        cards: /** @type {Array<any>} */ ([]),
        hasMore: false,
    };

    /** @type {Array<any>} */
    let expansionCatalog = [];

    /** @type {Promise<Array<any>>|null} */
    let expansionCatalogPromise = null;

    /** @type {string} */
    let pendingRestoredExpansionId = '';

    /** @type {Set<string>} */
    let selectedConditionFilters = loadConditionFilterSet();

    function normalizeConditionKey(raw) {
        const s = String(raw || '').trim();
        if (!s) return '';
        // Normalize common separators so values like "near_mint" / "NM-MT" match.
        const upper = s.toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (upper === 'NM' || upper === 'LP' || upper === 'MP') return upper;
        // Common abbreviated prefixes.
        if (upper.startsWith('NM')) return 'NM';
        if (upper.startsWith('LP')) return 'LP';
        if (upper.startsWith('MP')) return 'MP';
        if (upper === 'NEAR MINT') return 'NM';
        if (upper === 'NEAR MINT MINT' || upper === 'NEAR MINT MINT CONDITION') return 'NM';
        if (upper === 'LIGHT PLAY' || upper === 'LIGHTLY PLAYED') return 'LP';
        if (upper === 'LIGHT PLAYED') return 'LP';
        if (upper === 'MODERATE PLAY' || upper === 'MODERATELY PLAYED' || upper === 'MID PLAY') return 'MP';
        if (upper === 'DM' || upper === 'DAMAGED') return 'DM';
        return upper;
    }

    function formatConditionFilterLabel(key) {
        const normalizedKey = String(key || '').trim().toUpperCase();
        return normalizedKey === 'OTHER' ? 'Other' : normalizedKey;
    }

    function toConditionFilterKey(conditionKey) {
        const key = normalizeConditionKey(conditionKey);
        if (!key) return '';
        if (CONDITION_FILTER_KEYS.includes(key)) return key;
        if (CONDITION_FILTER_KEYS.includes('OTHER')) return 'OTHER';
        return '';
    }

    function loadConditionFilterSet() {
        try {
            const raw = localStorage.getItem(CONDITION_FILTER_KEY);
            if (!raw) return new Set(DEFAULT_CONDITION_FILTERS);
            const parsed = safeParseJson(raw);
            if (!Array.isArray(parsed)) return new Set(DEFAULT_CONDITION_FILTERS);

            const normalized = parsed
                .map((v) => String(v || '').trim().toUpperCase())
                .filter((v) => CONDITION_FILTER_KEYS.includes(v));

            return normalized.length ? new Set(normalized) : new Set(DEFAULT_CONDITION_FILTERS);
        } catch {
            return new Set(DEFAULT_CONDITION_FILTERS);
        }
    }

    function saveConditionFilterSet(nextSet) {
        try {
            localStorage.setItem(CONDITION_FILTER_KEY, JSON.stringify(Array.from(nextSet)));
        } catch {
            // ignore
        }
    }

    function getConditionSummaryMaxVisible() {
        if (window.matchMedia('(max-width: 767.98px)').matches) {
            return 2;
        }

        return 3;
    }

    function getConditionSummaryText() {
        const labels = CONDITION_FILTER_KEYS
            .filter((k) => selectedConditionFilters.has(k))
            .map((k) => formatConditionFilterLabel(k));
        if (!labels.length) return formatConditionFilterLabel(DEFAULT_CONDITION_FILTER_KEY);

        const maxVisible = getConditionSummaryMaxVisible();

        if (labels.length <= maxVisible) {
            return labels.join(', ');
        }

        return `${labels.slice(0, maxVisible).join(', ')}, ...`;
    }

    function syncConditionFilterUI() {
        if (conditionSummaryEl) {
            conditionSummaryEl.textContent = getConditionSummaryText();
        }

        for (const cb of conditionCheckboxEls) {
            const key = String(cb.value || '').trim().toUpperCase();
            cb.checked = selectedConditionFilters.has(key);
        }
    }

    function passesConditionFilter(conditionKey) {
        const filterKey = toConditionFilterKey(conditionKey);
        if (!filterKey) return false;
        return selectedConditionFilters.has(filterKey);
    }

    function applyConditionFilterToVisibleCards() {
        try {
            const restoredState = loadLastResults();
            renderCards(currentResultsCards, restoredState || undefined);
            renderFavorites(restoredState || undefined);
        } catch (error) {
            console.error('[PokeValutor] condition filter re-render failed', error);
        }
    }

    function clearSearchInputs() {
        if (input) input.value = '';
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

    const SEARCH_SORT_MODES = ['value-desc', 'value-asc', 'name-asc', 'name-desc'];

    function getSearchSortMode() {
        if (searchSortState.active === 'name') {
            return searchSortState.nameDir === 'desc' ? 'name-desc' : 'name-asc';
        }
        return searchSortState.valueDir === 'asc' ? 'value-asc' : 'value-desc';
    }

    function applySearchSortMode(modeRaw) {
        const mode = SEARCH_SORT_MODES.includes(modeRaw) ? modeRaw : 'value-desc';
        switch (mode) {
            case 'name-desc':
                searchSortState.active = 'name';
                searchSortState.nameDir = 'desc';
                break;
            case 'name-asc':
                searchSortState.active = 'name';
                searchSortState.nameDir = 'asc';
                break;
            case 'value-asc':
                searchSortState.active = 'value';
                searchSortState.valueDir = 'asc';
                break;
            case 'value-desc':
            default:
                searchSortState.active = 'value';
                searchSortState.valueDir = 'desc';
                break;
        }
    }

    function updateSearchSortUi() {
        if (searchSortSelect) {
            searchSortSelect.value = getSearchSortMode();
        }
    }

    function applySearchSortToGrid() {
        if (!grid) return;
        if (searchSortState.active !== 'name' && searchSortState.active !== 'value') return;

        const cols = Array.from(grid.querySelectorAll('.pv-searchCol'));
        if (cols.length <= 1) return;

        cols.sort((a, b) => {
            const nameA = safeString(a.getAttribute('data-card-name'), '').toLowerCase();
            const nameB = safeString(b.getAttribute('data-card-name'), '').toLowerCase();

            if (searchSortState.active === 'name') {
                const dir = searchSortState.nameDir === 'asc' ? 1 : -1;
                const cmp = nameA.localeCompare(nameB);
                return cmp * dir;
            }

            const idA = safeString(a.getAttribute('data-card-id'), '');
            const idB = safeString(b.getAttribute('data-card-id'), '');
            const va = Number(searchValueById[idA]);
            const vb = Number(searchValueById[idB]);
            const hasA = Number.isFinite(va);
            const hasB = Number.isFinite(vb);

            if (!hasA && !hasB) {
                const dir = searchSortState.valueDir === 'asc' ? 1 : -1;
                return nameA.localeCompare(nameB) * dir;
            }
            if (!hasA) return 1;
            if (!hasB) return -1;

            const dir = searchSortState.valueDir === 'asc' ? 1 : -1;
            if (va === vb) return nameA.localeCompare(nameB);
            return (va - vb) * dir;
        });

        for (const col of cols) {
            grid.appendChild(col);
        }
    }

    function bindSearchSortControls() {
        if (searchSortSelect && searchSortSelect.getAttribute('data-bound') !== '1') {
            searchSortSelect.setAttribute('data-bound', '1');
            searchSortSelect.addEventListener('change', () => {
                applySearchSortMode(searchSortSelect.value);
                updateSearchSortUi();
                applySearchSortToGrid();
                saveSortModePreference(SEARCH_SORT_PREF_KEY, getSearchSortMode());
            });
        }

        const storedMode = loadSortModePreference(SEARCH_SORT_PREF_KEY, SEARCH_SORT_MODES);
        applySearchSortMode(storedMode || searchSortSelect?.value || getSearchSortMode());
        updateSearchSortUi();
    }

    const FAVORITES_SORT_MODES = ['value-desc', 'value-asc', 'name-asc', 'name-desc'];

    function getFavoritesSortMode() {
        if (favoritesSortState.active === 'name') {
            return favoritesSortState.nameDir === 'desc' ? 'name-desc' : 'name-asc';
        }
        return favoritesSortState.valueDir === 'asc' ? 'value-asc' : 'value-desc';
    }

    function applyFavoritesSortMode(modeRaw) {
        const mode = FAVORITES_SORT_MODES.includes(modeRaw) ? modeRaw : 'value-desc';
        switch (mode) {
            case 'name-desc':
                favoritesSortState.active = 'name';
                favoritesSortState.nameDir = 'desc';
                break;
            case 'name-asc':
                favoritesSortState.active = 'name';
                favoritesSortState.nameDir = 'asc';
                break;
            case 'value-asc':
                favoritesSortState.active = 'value';
                favoritesSortState.valueDir = 'asc';
                break;
            case 'value-desc':
            default:
                favoritesSortState.active = 'value';
                favoritesSortState.valueDir = 'desc';
                break;
        }
    }

    function updateFavoritesSortUi() {
        if (favoritesSortSelect) {
            favoritesSortSelect.value = getFavoritesSortMode();
        }
    }

    function compareFavoriteCardsForSort(a, b, restoreState) {
        const nameA = safeString(a?.name, '').toLowerCase();
        const nameB = safeString(b?.name, '').toLowerCase();

        if (favoritesSortState.active === 'name') {
            const dir = favoritesSortState.nameDir === 'asc' ? 1 : -1;
            return nameA.localeCompare(nameB) * dir;
        }

        const va = Number(getCardMarketValueForSort(a, restoreState));
        const vb = Number(getCardMarketValueForSort(b, restoreState));
        const hasA = Number.isFinite(va);
        const hasB = Number.isFinite(vb);

        if (!hasA && !hasB) return nameA.localeCompare(nameB);
        if (!hasA) return 1;
        if (!hasB) return -1;

        const dir = favoritesSortState.valueDir === 'asc' ? 1 : -1;
        if (va === vb) return nameA.localeCompare(nameB);
        return (va - vb) * dir;
    }

    function bindFavoritesSortControls() {
        if (favoritesSortSelect && favoritesSortSelect.getAttribute('data-bound') !== '1') {
            favoritesSortSelect.setAttribute('data-bound', '1');
            favoritesSortSelect.addEventListener('change', () => {
                applyFavoritesSortMode(favoritesSortSelect.value);
                updateFavoritesSortUi();
                renderFavorites(loadLastResults() || undefined);
                saveSortModePreference(FAVORITES_SORT_PREF_KEY, getFavoritesSortMode());
            });
        }

        const storedMode = loadSortModePreference(FAVORITES_SORT_PREF_KEY, FAVORITES_SORT_MODES);
        applyFavoritesSortMode(storedMode || favoritesSortSelect?.value || getFavoritesSortMode());
        updateFavoritesSortUi();
    }

    function compareSearchCardsForSort(a, b) {
        const idA = safeString(a?.id, '');
        const idB = safeString(b?.id, '');
        const nameA = safeString(a?.name, '').toLowerCase();
        const nameB = safeString(b?.name, '').toLowerCase();

        if (searchSortState.active === 'name') {
            const dir = searchSortState.nameDir === 'asc' ? 1 : -1;
            const cmp = nameA.localeCompare(nameB);
            return cmp * dir;
        }

        const va = Number(searchValueById[idA]);
        const vb = Number(searchValueById[idB]);
        const hasA = Number.isFinite(va);
        const hasB = Number.isFinite(vb);

        if (!hasA && !hasB) {
            const dir = searchSortState.valueDir === 'asc' ? 1 : -1;
            return nameA.localeCompare(nameB) * dir;
        }
        if (!hasA) return 1;
        if (!hasB) return -1;

        const dir = searchSortState.valueDir === 'asc' ? 1 : -1;
        if (va === vb) return nameA.localeCompare(nameB);
        return (va - vb) * dir;
    }

    function setLoadMoreState(visible, loading) {
        if (!loadMoreBtn) return;
        loadMoreBtn.hidden = !visible;
        loadMoreBtn.disabled = !!loading;
        loadMoreBtn.textContent = loading ? 'Loading...' : 'Load More';
    }

    function resetDexSetBrowseState() {
        dexSetBrowseState = {
            active: false,
            mode: '',
            query: '',
            expansionId: '',
            expansionName: '',
            expansionSeries: '',
            queryCandidates: [],
            matchedQuery: '',
            nextPage: 1,
            pageSize: SET_SEARCH_PAGE_SIZE,
            cards: [],
            hasMore: false,
        };
        setLoadMoreState(false, false);
    }

    function parseReleaseDateToMs(raw) {
        const s = String(raw || '').trim();
        if (!s) return 0;

        const m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
        if (m) {
            const y = Number(m[1]);
            const mo = Number(m[2]);
            const d = Number(m[3]);
            if (Number.isFinite(y) && Number.isFinite(mo) && Number.isFinite(d)) {
                return Date.UTC(y, mo - 1, d);
            }
        }

        const t = Date.parse(s);
        return Number.isFinite(t) ? t : 0;
    }

    function normalizeSeriesName(raw) {
        return String(raw || '').trim();
    }

    function getSetOptionLabel(expansion) {
        const name = safeString(expansion?.name, 'Unknown Set');
        const code = safeString(expansion?.code, '');
        const releaseDate = safeString(expansion?.release_date ?? expansion?.releaseDate, '');

        let label = name;
        if (code) label += ` (${code})`;
        if (releaseDate) label += ` • ${releaseDate}`;
        return label;
    }

    function sortExpansionsByReleaseDesc(a, b) {
        const ad = parseReleaseDateToMs(a?.release_date ?? a?.releaseDate);
        const bd = parseReleaseDateToMs(b?.release_date ?? b?.releaseDate);
        if (ad !== bd) return bd - ad;

        const an = safeString(a?.name, '').toLowerCase();
        const bn = safeString(b?.name, '').toLowerCase();
        return an.localeCompare(bn);
    }

    function loadSetFilterState() {
        try {
            const raw = localStorage.getItem(SET_FILTER_STATE_KEY);
            if (!raw) return { series: '', expansionId: '' };
            const parsed = safeParseJson(raw);
            if (!parsed || typeof parsed !== 'object') return { series: '', expansionId: '' };
            return {
                series: safeString(parsed.series, ''),
                expansionId: safeString(parsed.expansionId, ''),
            };
        } catch {
            return { series: '', expansionId: '' };
        }
    }

    function saveSetFilterState(series, expansionId) {
        try {
            localStorage.setItem(SET_FILTER_STATE_KEY, JSON.stringify({
                series: safeString(series, ''),
                expansionId: safeString(expansionId, ''),
            }));
        } catch {
            // ignore
        }
    }

    function loadSeriesSetVisibilityPreference() {
        try {
            const raw = localStorage.getItem(SEARCH_SERIES_SET_VISIBLE_KEY);
            if (raw === null) return true;
            return raw === '1';
        } catch {
            return true;
        }
    }

    function saveSeriesSetVisibilityPreference(show) {
        try {
            localStorage.setItem(SEARCH_SERIES_SET_VISIBLE_KEY, show ? '1' : '0');
        } catch {
            // ignore
        }
    }

    function isSeriesSetFiltersVisible() {
        if (!isSearchPage) return true;
        if (!window.matchMedia('(max-width: 767.98px)').matches) return true;
        return !!seriesSetToggle?.checked;
    }

    function applySeriesSetVisibilityUi(skipPersist) {
        if (!isSearchPage || !form || !seriesSetToggle) return;

        const show = !!seriesSetToggle.checked;
        form.classList.toggle('pv-searchForm--seriesSetHidden', !show);

        if (!skipPersist) {
            saveSeriesSetVisibilityPreference(show);
        }
    }

    function setSetFilterLoadingUi(isLoading) {
        if (seriesSelect) {
            seriesSelect.disabled = isLoading;
            if (isLoading) {
                seriesSelect.innerHTML = '<option value="">Loading series...</option>';
            }
        }

        if (setSelect) {
            setSelect.disabled = true;
            if (isLoading) {
                setSelect.innerHTML = '<option value="">Loading sets...</option>';
            }
        }
    }

    function renderSeriesOptions(seriesNames, selectedSeries) {
        if (!seriesSelect) return;

        const current = safeString(selectedSeries, '');
        const options = ['<option value="">Choose a series</option>'];
        for (const s of seriesNames) {
            const isSelected = current && s === current;
            options.push(`<option value="${escapeAttr(s)}" ${isSelected ? 'selected' : ''}>${escapeHtml(s)}</option>`);
        }

        seriesSelect.innerHTML = options.join('');
    }

    function getSeriesListFromCatalog() {
        const out = new Set();
        for (const ex of expansionCatalog) {
            const series = normalizeSeriesName(ex?.series);
            if (series) out.add(series);
        }

        return Array.from(out).sort((a, b) => a.localeCompare(b));
    }

    function getSetsForSeries(seriesName) {
        const target = normalizeSeriesName(seriesName);
        if (!target) return [];

        return expansionCatalog
            .filter((ex) => normalizeSeriesName(ex?.series) === target)
            .sort(sortExpansionsByReleaseDesc);
    }

    function renderSetOptionsForSeries(seriesName, selectedExpansionId) {
        if (!setSelect) return;

        const sets = getSetsForSeries(seriesName);
        const selectedId = safeString(selectedExpansionId, '');

        const options = ['<option value="">Choose a set</option>'];
        for (const ex of sets) {
            const id = safeString(ex?.id, '');
            if (!id) continue;
            const label = getSetOptionLabel(ex);
            const isSelected = selectedId && id === selectedId;
            options.push(`<option value="${escapeAttr(id)}" ${isSelected ? 'selected' : ''}>${escapeHtml(label)}</option>`);
        }

        setSelect.innerHTML = options.join('');
        setSelect.disabled = sets.length === 0;
    }

    function getSelectedExpansionFromFilter() {
        const id = safeString(setSelect?.value, '');
        if (!id) return null;
        return expansionCatalog.find((ex) => safeString(ex?.id, '') === id) || null;
    }

    function tryHydrateSetFilterFromExpansionId(expansionId) {
        const id = safeString(expansionId, '');
        if (!id || !seriesSelect) return false;

        const match = expansionCatalog.find((ex) => safeString(ex?.id, '') === id);
        if (!match) return false;

        const series = normalizeSeriesName(match?.series);
        if (!series) return false;

        if (!Array.from(seriesSelect.options).some((o) => o.value === series)) return false;

        seriesSelect.value = series;
        renderSetOptionsForSeries(series, id);
        saveSetFilterState(series, id);
        return true;
    }

    async function ensureExpansionCatalogLoaded() {
        if (expansionCatalog.length) return expansionCatalog;
        if (expansionCatalogPromise) return expansionCatalogPromise;

        setSetFilterLoadingUi(true);

        expansionCatalogPromise = (async () => {
            const base = getWorkerBase();
            const select = 'id,name,series,code,release_date';
            const q = 'language:english';

            const buildUrl = (page) => {
                const qs = [
                    `q=${encodeURIComponent(q)}`,
                    'orderBy=-release_date',
                    `page=${encodeURIComponent(String(page))}`,
                    `pageSize=${encodeURIComponent(String(EXPANSIONS_PAGE_SIZE))}`,
                    `select=${encodeURIComponent(select)}`,
                    'casing=camel',
                ].join('&');
                return `${base}/expansions/search?${qs}`;
            };

            const first = await fetchJsonWithCache(buildUrl(1), EXPANSIONS_TTL_MS);
            const firstItems = Array.isArray(first?.data) ? first.data : [];

            /** @type {Array<any>} */
            const merged = [];
            const seen = new Set();
            for (const ex of firstItems) {
                const id = safeString(ex?.id, '');
                if (!id || seen.has(id)) continue;
                seen.add(id);
                merged.push(ex);
            }

            const totalCountRaw = Number(first?.totalCount || merged.length);
            const totalPages = Number.isFinite(totalCountRaw) && totalCountRaw > 0
                ? Math.ceil(totalCountRaw / EXPANSIONS_PAGE_SIZE)
                : 1;
            const cappedPages = Math.max(1, Math.min(10, totalPages));

            for (let page = 2; page <= cappedPages; page++) {
                const next = await fetchJsonWithCache(buildUrl(page), EXPANSIONS_TTL_MS);
                const items = Array.isArray(next?.data) ? next.data : [];

                for (const ex of items) {
                    const id = safeString(ex?.id, '');
                    if (!id || seen.has(id)) continue;
                    seen.add(id);
                    merged.push(ex);
                }

                if (items.length < EXPANSIONS_PAGE_SIZE) break;
            }

            expansionCatalog = merged
                .filter((ex) => safeString(ex?.id, '') && safeString(ex?.name, '') && normalizeSeriesName(ex?.series))
                .sort(sortExpansionsByReleaseDesc);

            const saved = loadSetFilterState();
            const seriesNames = getSeriesListFromCatalog();
            renderSeriesOptions(seriesNames, saved.series);
            if (seriesSelect) seriesSelect.disabled = false;

            let hydrated = false;
            if (pendingRestoredExpansionId) {
                hydrated = tryHydrateSetFilterFromExpansionId(pendingRestoredExpansionId);
                pendingRestoredExpansionId = '';
            }

            if (!hydrated) {
                const selectedSeries = safeString(seriesSelect?.value, '');
                renderSetOptionsForSeries(selectedSeries, saved.expansionId);
            }

            return expansionCatalog;
        })();

        try {
            return await expansionCatalogPromise;
        } catch (e) {
            if (seriesSelect) {
                seriesSelect.disabled = false;
                seriesSelect.innerHTML = '<option value="">Unable to load series</option>';
            }
            if (setSelect) {
                setSelect.disabled = true;
                setSelect.innerHTML = '<option value="">Unable to load sets</option>';
            }
            throw e;
        } finally {
            expansionCatalogPromise = null;
        }
    }

    function safeString(value, fallback) {
        const s = String(value ?? '');
        return s ? s : (fallback || '');
    }

    function normalizeDexConditionCode(raw) {
        const upper = String(raw || '')
            .trim()
            .toUpperCase()
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ');
        if (!upper) return '';
        if (upper === 'NM' || upper.startsWith('NEAR MINT')) return 'NM';
        if (upper === 'LP' || upper.startsWith('LIGHT PLAY')) return 'LP';
        if (upper === 'MP' || upper.startsWith('MODERATE PLAY') || upper.startsWith('MID PLAY')) return 'MP';
        if (upper === 'HP' || upper.startsWith('HEAVY PLAY')) return 'HP';
        if (upper === 'DM' || upper.startsWith('DAMAGE')) return 'DM';
        return DEX_CARD_CONDITIONS.includes(upper) ? upper : '';
    }

    function getDexConditionLabel(code) {
        const normalized = normalizeDexConditionCode(code);
        if (normalized === 'NM') return 'Near Mint (NM)';
        if (normalized === 'LP') return 'Lightly Played (LP)';
        if (normalized === 'MP') return 'Moderately Played (MP)';
        if (normalized === 'HP') return 'Heavily Played (HP)';
        if (normalized === 'DM') return 'Damaged (DM)';
        return normalized || 'Unknown condition';
    }

    function normalizeConditionQuantities(rawMap, fallbackCondition) {
        /** @type {Record<string, number>} */
        const out = {};

        if (rawMap && typeof rawMap === 'object') {
            for (const [rawCode, rawQty] of Object.entries(rawMap)) {
                const code = normalizeDexConditionCode(rawCode);
                if (!code) continue;

                const qty = Math.floor(Number(rawQty));
                if (!Number.isFinite(qty) || qty <= 0) continue;

                out[code] = (out[code] || 0) + qty;
            }
        }

        if (Object.keys(out).length === 0) {
            const fallback = normalizeDexConditionCode(fallbackCondition);
            if (fallback) out[fallback] = 1;
        }

        return out;
    }

    function getPrimaryConditionCode(conditionQuantities) {
        const map = normalizeConditionQuantities(conditionQuantities, '');
        for (const code of DEX_CARD_CONDITIONS) {
            const qty = Math.floor(Number(map[code] || 0));
            if (qty > 0) return code;
        }
        return '';
    }

    function getTotalDexConditionCopies(conditionQuantities, fallbackCondition) {
        const map = normalizeConditionQuantities(conditionQuantities, fallbackCondition);
        let total = 0;
        for (const code of DEX_CARD_CONDITIONS) {
            const qty = Math.floor(Number(map[code] || 0));
            if (!Number.isFinite(qty) || qty <= 0) continue;
            total += qty;
        }
        return total;
    }

    function getDexDefaultVariantForCard(cardLike) {
        const selected = safeString(cardLike?.selectedVariant, '').trim();
        if (selected) return selected;

        const variants = Array.isArray(cardLike?.variants)
            ? cardLike.variants.map((v) => safeString(v?.name, '').trim()).filter(Boolean)
            : [];
        if (variants.length) return '';
        return DEX_DEFAULT_VARIANT_NAME;
    }

    function normalizeVariantQuantities(rawMap, fallbackVariant, fallbackCopies) {
        /** @type {Record<string, number>} */
        const out = {};

        if (rawMap && typeof rawMap === 'object') {
            for (const [rawName, rawQty] of Object.entries(rawMap)) {
                const name = safeString(rawName, '').trim();
                const qty = Math.floor(Number(rawQty));
                if (!name || !Number.isFinite(qty) || qty <= 0) continue;
                out[name] = (out[name] || 0) + qty;
            }
        }

        if (Object.keys(out).length === 0) {
            const baseName = safeString(fallbackVariant, '').trim();
            const copies = Math.max(1, Math.floor(Number(fallbackCopies) || 0));
            if (baseName) {
                out[baseName] = copies;
            }
        }

        return out;
    }

    function getPrimaryVariantName(variantQuantities, fallbackVariant) {
        const map = normalizeVariantQuantities(variantQuantities, fallbackVariant, 1);
        const keys = Object.keys(map);
        if (!keys.length) return safeString(fallbackVariant, '');
        return keys[0];
    }

    function extractCardNumberFromId(cardId) {
        const id = safeString(cardId, '').trim();
        if (!id) return '';
        const parts = id.split('-').map((part) => safeString(part, '').trim()).filter(Boolean);
        if (parts.length < 2) return '';
        return parts[parts.length - 1];
    }

    function getCardDisplayNumber(cardLike) {
        const cardNo = safeString(cardLike?.card_no ?? cardLike?.cardNo ?? cardLike?.cardNumber ?? cardLike?.collectorNumber, '').trim();
        if (cardNo) return cardNo;
        const number = safeString(cardLike?.number ?? cardLike?.card_number, '').trim();
        if (number) return number;
        return extractCardNumberFromId(cardLike?.id);
    }

    function normalizeDexCollectionItemType(rawType) {
        const value = safeString(rawType, '').trim().toLowerCase();
        return value === 'sealed' ? 'sealed' : 'card';
    }

    function normalizeDexCollectionId(rawId, fallbackId) {
        const normalized = safeString(rawId, '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '');

        if (!normalized) return safeString(fallbackId, DEX_DEFAULT_COLLECTION_ID);
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

    function getDexCollectionEntryKey(item) {
        const type = normalizeDexCollectionItemType(item?.itemType);
        const id = safeString(item?.id, '').trim();
        const collectionId = normalizeDexCollectionId(item?.collectionId, DEX_DEFAULT_COLLECTION_ID);
        return `${collectionId}:${type}:${id}`;
    }

    function isDexCardCollectionItem(item) {
        return normalizeDexCollectionItemType(item?.itemType) === 'card';
    }

    function normalizeDexSealedQuantity(rawQty, fallback) {
        const fallbackQty = Math.max(0, Math.floor(Number(fallback) || 0));
        const parsed = Math.floor(Number(rawQty));
        if (!Number.isFinite(parsed)) return fallbackQty;
        return Math.max(0, parsed);
    }

    function normalizeImageList(rawImages) {
        if (Array.isArray(rawImages)) return rawImages;

        if (typeof rawImages === 'string') {
            const url = safeString(rawImages, '').trim();
            if (!url) return [];
            return [{ type: 'front', small: url, medium: url, large: url }];
        }

        if (rawImages && typeof rawImages === 'object') {
            const small = safeString(rawImages?.small ?? rawImages?.thumbnail ?? rawImages?.thumb ?? rawImages?.url ?? rawImages?.src ?? rawImages?.image, '').trim();
            const medium = safeString(rawImages?.medium ?? rawImages?.small ?? rawImages?.url ?? rawImages?.src ?? rawImages?.image, '').trim();
            const large = safeString(rawImages?.large ?? rawImages?.medium ?? rawImages?.small ?? rawImages?.url ?? rawImages?.src ?? rawImages?.image, '').trim();
            if (!small && !medium && !large) return [];
            return [{ type: 'front', small, medium, large }];
        }

        return [];
    }

    function normalizeDexCollectionSealedProduct(product) {
        const addedAtRaw = Number(product?.addedAt || 0);
        const updatedAtRaw = Number(product?.updatedAt || 0);
        const rawQty = product?.quantity ?? product?.sealedQuantity;
        const quantity = Math.max(1, normalizeDexSealedQuantity(rawQty, 1));
        const collectionId = normalizeDexCollectionId(product?.collectionId, DEX_DEFAULT_COLLECTION_ID);
        const expansionName = safeString(product?.expansionName ?? product?.expansion_name ?? product?.setName ?? product?.set_name, '');
        const setName = safeString(product?.setName ?? product?.set_name ?? product?.expansionName ?? product?.expansion_name, '');
        return {
            itemType: 'sealed',
            collectionId,
            id: safeString(product?.id, ''),
            name: safeString(product?.name, 'Unknown'),
            type: safeString(product?.type, ''),
            expansionName,
            setName,
            expansion: (product?.expansion && typeof product.expansion === 'object') ? product.expansion : null,
            set: (product?.set && typeof product.set === 'object') ? product.set : null,
            images: normalizeImageList(product?.images),
            variants: Array.isArray(product?.variants) ? product.variants : [],
            pricesText: safeString(product?.pricesText, ''),
            quantity,
            addedAt: Number.isFinite(addedAtRaw) && addedAtRaw > 0 ? addedAtRaw : Date.now(),
            updatedAt: Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? updatedAtRaw : Date.now(),
        };
    }

    function normalizeDexCollectionEntry(entry) {
        const itemType = normalizeDexCollectionItemType(entry?.itemType);
        if (itemType === 'sealed') {
            return normalizeDexCollectionSealedProduct(entry);
        }
        return normalizeDexCollectionCard(entry);
    }

    function normalizeDexCollectionCard(card) {
        const conditionQuantities = normalizeConditionQuantities(card?.conditionQuantities, card?.selectedCondition);
        const selectedCondition = getPrimaryConditionCode(conditionQuantities);
        const totalCopies = getTotalDexConditionCopies(conditionQuantities, selectedCondition);
        const fallbackVariant = getDexDefaultVariantForCard(card);
        const variantQuantities = normalizeVariantQuantities(card?.variantQuantities, fallbackVariant, totalCopies);
        const selectedVariant = getPrimaryVariantName(variantQuantities, fallbackVariant);
        const collectionId = normalizeDexCollectionId(card?.collectionId, DEX_DEFAULT_COLLECTION_ID);
        const cardNumber = getCardDisplayNumber(card);
        const addedAtRaw = Number(card?.addedAt || 0);
        const updatedAtRaw = Number(card?.updatedAt || 0);
        const expansionName = safeString(card?.expansionName ?? card?.expansion_name ?? card?.setName ?? card?.set_name, '');
        const setName = safeString(card?.setName ?? card?.set_name ?? card?.expansionName ?? card?.expansion_name, '');
        return {
            itemType: 'card',
            collectionId,
            id: safeString(card?.id, ''),
            name: safeString(card?.name, 'Unknown'),
            rarity: safeString(card?.rarity ?? card?.rarityName ?? card?.rarity_name, ''),
            card_no: cardNumber,
            number: cardNumber,
            expansionName,
            setName,
            expansion: (card?.expansion && typeof card.expansion === 'object') ? card.expansion : null,
            set: (card?.set && typeof card.set === 'object') ? card.set : null,
            images: normalizeImageList(card?.images),
            variants: Array.isArray(card?.variants) ? card.variants : [],
            selectedVariant,
            variantQuantities,
            selectedCondition,
            conditionQuantities,
            pricesText: safeString(card?.pricesText, ''),
            addedAt: Number.isFinite(addedAtRaw) && addedAtRaw > 0 ? addedAtRaw : Date.now(),
            updatedAt: Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? updatedAtRaw : Date.now(),
        };
    }

    function loadDexCollection() {
        try {
            const parsed = loadJsonFromStorage(DEX_COLLECTION_KEY, []);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter((x) => x && typeof x === 'object' && x.id)
                .map((x) => normalizeDexCollectionEntry(x));
        } catch {
            return [];
        }
    }

    function writeCriticalStorageItem(key, serialized) {
        if (storageUtil?.writeCriticalStorageItem) {
            return storageUtil.writeCriticalStorageItem({
                key,
                serialized,
                cachePrefix: CACHE_PREFIX,
                parseJson: safeParseJson,
                lastResultsKey: LAST_RESULTS_KEY,
                preCleanup: cacheSweep,
            });
        }

        try {
            localStorage.setItem(key, serialized);
            return true;
        } catch {
            return false;
        }
    }

    function getCollectionStorageWriteFailureMessage() {
        if (storageUtil?.getCollectionStorageWriteFailureMessage) {
            return storageUtil.getCollectionStorageWriteFailureMessage();
        }
        return 'Could not save this collection change. Local storage is full; please try again.';
    }

    function saveDexCollection(list, options) {
        let persisted = false;
        try {
            const safe = Array.isArray(list) ? list : [];
            persisted = writeCriticalStorageItem(DEX_COLLECTION_KEY, JSON.stringify(safe));
        } catch {
            persisted = false;
        }

        if (!persisted) return false;

        notifyDexStateChanged();

        if (!options?.skipCloudSync) {
            queueDexCloudStateSync(Boolean(options?.immediateCloudSync));
        }

        return true;
    }

    function loadDexMasterSets() {
        try {
            const parsed = loadJsonFromStorage(DEX_MASTER_SETS_KEY, {});
            if (!parsed || typeof parsed !== 'object') return {};
            return normalizeDexMasterSetsMap(parsed);
        } catch {
            return {};
        }
    }

    function saveDexMasterSets(map, options) {
        let persisted = false;
        try {
            const safe = (map && typeof map === 'object') ? map : {};
            persisted = writeCriticalStorageItem(DEX_MASTER_SETS_KEY, JSON.stringify(safe));
        } catch {
            persisted = false;
        }

        if (!persisted) return false;

        notifyDexStateChanged();

        if (!options?.skipCloudSync) {
            queueDexCloudStateSync(Boolean(options?.immediateCloudSync));
        }

        return true;
    }

    function notifyDexStateChanged() {
        try {
            window.dispatchEvent(new CustomEvent('pv:dex-state-changed'));
        } catch {
            // ignore
        }
    }

    const DEX_CLOUD_SYNC_DEBOUNCE_MS = 450;
    let dexCloudSyncTimer = 0;
    let dexCloudSyncHydrating = false;

    function getDexUpdatedAt(value) {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function readDexOwnerUid() {
        try {
            return String(localStorage.getItem(DEX_OWNER_UID_KEY) || '').trim();
        } catch {
            return '';
        }
    }

    function writeDexOwnerUid(uid) {
        const nextUid = String(uid || '').trim();
        try {
            if (nextUid) {
                localStorage.setItem(DEX_OWNER_UID_KEY, nextUid);
            } else {
                localStorage.removeItem(DEX_OWNER_UID_KEY);
            }
        } catch {
            // ignore
        }
    }

    function normalizeDexMasterSetEntry(entry, fallbackExpansionId) {
        if (!entry || typeof entry !== 'object') return null;

        const expansionId = safeString(entry?.expansionId ?? fallbackExpansionId, '').trim();
        if (!expansionId) return null;

        const ids = Array.isArray(entry?.cardIds)
            ? entry.cardIds.map((x) => safeString(x, '').trim()).filter(Boolean)
            : [];
        const cardIds = Array.from(new Set(ids));
        const updatedAt = getDexUpdatedAt(entry?.updatedAt) || Date.now();

        return {
            expansionId,
            expansionName: safeString(entry?.expansionName, 'Unknown Set'),
            series: safeString(entry?.series, ''),
            setImage: safeString(entry?.setImage, ''),
            targetCount: Number(entry?.targetCount || 0) || null,
            cardIds,
            count: cardIds.length,
            updatedAt,
        };
    }

    function normalizeDexMasterSetsMap(mapLike) {
        /** @type {Record<string, any>} */
        const out = {};
        if (!mapLike || typeof mapLike !== 'object') return out;

        for (const [key, value] of Object.entries(mapLike)) {
            const normalized = normalizeDexMasterSetEntry(value, key);
            if (!normalized) continue;
            out[normalized.expansionId] = normalized;
        }

        return out;
    }

    function queueDexCloudStateSync(immediate) {
        if (!enableDexTrackingControls || dexCloudSyncHydrating) return;
        const authApi = window?.PV_AUTH;
        const user = authApi?.getUser ? authApi.getUser() : null;
        if (!user || !authApi?.saveDexState) return;

        writeDexOwnerUid(user.uid);

        const run = () => {
            const payload = {
                collection: loadDexCollection(),
                masterSets: loadDexMasterSets(),
            };

            Promise.resolve(authApi.saveDexState(payload)).catch(() => {
                // ignore
            });
        };

        if (immediate) {
            if (dexCloudSyncTimer) {
                window.clearTimeout(dexCloudSyncTimer);
                dexCloudSyncTimer = 0;
            }
            run();
            return;
        }

        if (dexCloudSyncTimer) {
            window.clearTimeout(dexCloudSyncTimer);
        }
        dexCloudSyncTimer = window.setTimeout(run, DEX_CLOUD_SYNC_DEBOUNCE_MS);
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            queueDexCloudStateSync(true);
        }
    });

    window.addEventListener('pagehide', () => {
        queueDexCloudStateSync(true);
    });

    function mergeDexCollectionState(localList, cloudList) {
        /** @type {Map<string, any>} */
        const byId = new Map();

        function addItem(raw) {
            const normalized = normalizeDexCollectionEntry(raw);
            const id = safeString(normalized?.id, '').trim();
            if (!id) return;

            const entryKey = getDexCollectionEntryKey(normalized);

            const existing = byId.get(entryKey);
            if (!existing) {
                byId.set(entryKey, normalized);
                return;
            }

            const existingUpdatedAt = getDexUpdatedAt(existing?.updatedAt);
            const nextUpdatedAt = getDexUpdatedAt(normalized?.updatedAt);
            if (nextUpdatedAt >= existingUpdatedAt) {
                byId.set(entryKey, normalized);
            }
        }

        if (Array.isArray(localList)) {
            for (const item of localList) addItem(item);
        }
        if (Array.isArray(cloudList)) {
            for (const item of cloudList) addItem(item);
        }

        return Array.from(byId.values())
            .sort((a, b) => Number(b?.addedAt || 0) - Number(a?.addedAt || 0));
    }

    function mergeDexMasterSetsState(localMap, cloudMap, mergedCollection) {
        const local = normalizeDexMasterSetsMap(localMap);
        const cloud = normalizeDexMasterSetsMap(cloudMap);
        /** @type {Record<string, any>} */
        const seedByExpansionId = {};
        const seedKeys = Array.from(new Set([...Object.keys(local), ...Object.keys(cloud)]));

        for (const key of seedKeys) {
            const localEntry = local[key] || null;
            const cloudEntry = cloud[key] || null;

            if (!localEntry && !cloudEntry) continue;
            if (!localEntry) {
                seedByExpansionId[key] = cloudEntry;
                continue;
            }
            if (!cloudEntry) {
                seedByExpansionId[key] = localEntry;
                continue;
            }

            const localUpdatedAt = getDexUpdatedAt(localEntry?.updatedAt);
            const cloudUpdatedAt = getDexUpdatedAt(cloudEntry?.updatedAt);
            seedByExpansionId[key] = cloudUpdatedAt >= localUpdatedAt ? cloudEntry : localEntry;
        }

        /** @type {Record<string, any>} */
        const merged = {};

        for (const card of (Array.isArray(mergedCollection) ? mergedCollection : [])) {
            if (!isDexCardCollectionItem(card)) continue;
            if (normalizeDexCollectionId(card?.collectionId, DEX_DEFAULT_COLLECTION_ID) !== DEX_DEFAULT_COLLECTION_ID) {
                continue;
            }

            const cardId = safeString(card?.id, '').trim();
            if (!cardId) continue;

            const expansion = getDexExpansionInfo(card);
            const expansionId = safeString(expansion?.id, '').trim();
            if (!expansionId) continue;

            const seed = seedByExpansionId[expansionId] || null;
            const existing = merged[expansionId] || null;
            const existingIds = Array.isArray(existing?.cardIds) ? existing.cardIds : [];
            const nextIds = existingIds.includes(cardId) ? existingIds : [...existingIds, cardId];
            const seedUpdatedAt = getDexUpdatedAt(seed?.updatedAt);
            const cardUpdatedAt = getDexUpdatedAt(card?.updatedAt);

            merged[expansionId] = {
                expansionId,
                expansionName: safeString(seed?.expansionName, expansion.name),
                series: safeString(seed?.series, expansion.series),
                setImage: safeString(seed?.setImage, expansion.image),
                targetCount: Number(seed?.targetCount || expansion.printedTotal || expansion.total || 0) || null,
                cardIds: nextIds,
                count: nextIds.length,
                updatedAt: Math.max(seedUpdatedAt, cardUpdatedAt, Date.now()),
            };
        }

        return merged;
    }

    function syncDexStateFromCloudOnSignIn() {
        if (!enableDexTrackingControls || !window?.PV_AUTH?.loadDexState) return;

        const authApi = window?.PV_AUTH;
        const user = authApi?.getUser ? authApi.getUser() : null;
        const currentUid = String(user?.uid || '').trim();
        if (!currentUid) return;

        const localCollection = loadDexCollection();
        const localMasterSets = loadDexMasterSets();
        const localOwnerUid = readDexOwnerUid();
        const allowLocalMerge = localOwnerUid === currentUid;
        let mergedPayload = null;
        dexCloudSyncHydrating = true;

        Promise.resolve(authApi.loadDexState())
            .then((cloudState) => {
                const cloudCollection = Array.isArray(cloudState?.collection) ? cloudState.collection : [];
                const cloudMasterSets = (cloudState?.masterSets && typeof cloudState.masterSets === 'object')
                    ? cloudState.masterSets
                    : {};

                let resolvedCollection = cloudCollection;
                let resolvedMasterSets = cloudMasterSets;

                if (allowLocalMerge) {
                    resolvedCollection = mergeDexCollectionState(localCollection, cloudCollection);
                    resolvedMasterSets = mergeDexMasterSetsState(localMasterSets, cloudMasterSets, resolvedCollection);
                    mergedPayload = {
                        collection: resolvedCollection,
                        masterSets: resolvedMasterSets,
                    };
                }

                saveDexCollection(resolvedCollection, { skipCloudSync: true });
                saveDexMasterSets(resolvedMasterSets, { skipCloudSync: true });
                writeDexOwnerUid(currentUid);

                if (isDexPage) {
                    updateDexCollectionStats(resolvedCollection);
                }

                const restoredState = loadLastResults();
                renderCards(currentResultsCards, restoredState || undefined);
            })
            .catch(() => {
                // ignore
            })
            .finally(() => {
                dexCloudSyncHydrating = false;

                if (mergedPayload && authApi?.saveDexState) {
                    Promise.resolve(authApi.saveDexState(mergedPayload)).catch(() => {
                        // ignore
                    });
                }
            });
    }

    function getDexExpansionInfo(card) {
        const ex = (card?.expansion && typeof card.expansion === 'object') ? card.expansion : null;
        const id = safeString(ex?.id, 'unknown');
        return {
            id,
            name: safeString(ex?.name, 'Unknown Set'),
            series: safeString(ex?.series, ''),
            printedTotal: Number(ex?.printed_total ?? ex?.printedTotal ?? 0) || 0,
            total: Number(ex?.total ?? 0) || 0,
            image: safeString(ex?.logo ?? ex?.symbol ?? ex?.image ?? ex?.images?.logo ?? ex?.images?.symbol, ''),
        };
    }

    function isInDexCollection(cardId) {
        const id = safeString(cardId, '');
        if (!id) return false;
        const activeCollectionId = getActiveDexCollectionId();
        const items = loadDexCollection();
        return items.some((x) => {
            return isDexCardCollectionItem(x)
                && safeString(x?.id, '') === id
                && normalizeDexCollectionId(x?.collectionId, DEX_DEFAULT_COLLECTION_ID) === activeCollectionId;
        });
    }

    function addDexCardToTrackers(card) {
        const activeCollectionId = getActiveDexCollectionId();
        const normalized = normalizeDexCollectionCard({ ...card, collectionId: activeCollectionId });
        const id = safeString(normalized.id, '');
        if (!id) return { addedCollection: false, addedMasterSet: false, expansionName: '' };

        const collection = loadDexCollection();
        const existingIndex = collection.findIndex((x) => {
            return isDexCardCollectionItem(x)
                && safeString(x?.id, '') === id
                && normalizeDexCollectionId(x?.collectionId, DEX_DEFAULT_COLLECTION_ID) === activeCollectionId;
        });
        const existsInCollection = existingIndex >= 0;
        const addVariantName = safeString(normalized?.selectedVariant, '').trim() || getDexDefaultVariantForCard(normalized);
        let savedCollection = false;
        if (!existsInCollection) {
            collection.push(normalized);
            savedCollection = saveDexCollection(collection, { immediateCloudSync: true });
        } else {
            const existing = normalizeDexCollectionCard(collection[existingIndex]);
            const nextMap = normalizeConditionQuantities(existing?.conditionQuantities, existing?.selectedCondition);
            const nextVariantMap = normalizeVariantQuantities(existing?.variantQuantities, existing?.selectedVariant, getTotalDexConditionCopies(nextMap, existing?.selectedCondition));
            const addCode = normalizeDexConditionCode(normalized?.selectedCondition);

            if (addCode) {
                nextMap[addCode] = (nextMap[addCode] || 0) + 1;
            }

            if (addVariantName) {
                nextVariantMap[addVariantName] = (nextVariantMap[addVariantName] || 0) + 1;
            }

            const nextSelectedCondition = getPrimaryConditionCode(nextMap);
            const nextSelectedVariant = getPrimaryVariantName(nextVariantMap, addVariantName);

            collection[existingIndex] = {
                ...existing,
                ...normalized,
                addedAt: existing.addedAt,
                selectedVariant: nextSelectedVariant,
                variantQuantities: nextVariantMap,
                conditionQuantities: nextMap,
                selectedCondition: nextSelectedCondition,
                updatedAt: Date.now(),
            };
            savedCollection = saveDexCollection(collection, { immediateCloudSync: true });
        }

        if (!savedCollection) {
            return {
                addedCollection: false,
                addedMasterSet: false,
                expansionName: '',
                totalCopies: 0,
                storageWriteFailed: true,
            };
        }

        if (activeCollectionId !== DEX_DEFAULT_COLLECTION_ID) {
            const copies = existsInCollection
                ? getTotalDexConditionCopies(collection[existingIndex]?.conditionQuantities, collection[existingIndex]?.selectedCondition)
                : getTotalDexConditionCopies(normalized?.conditionQuantities, normalized?.selectedCondition);

            return {
                addedCollection: true,
                addedMasterSet: false,
                expansionName: '',
                totalCopies: copies,
                storageWriteFailed: false,
            };
        }

        const expansion = getDexExpansionInfo(card);
        const master = loadDexMasterSets();
        const existingSet = (master[expansion.id] && typeof master[expansion.id] === 'object') ? master[expansion.id] : {};
        const cardIds = Array.isArray(existingSet.cardIds) ? existingSet.cardIds.map((x) => safeString(x, '')).filter(Boolean) : [];
        const idSet = new Set(cardIds);
        const beforeSize = idSet.size;
        idSet.add(id);

        const addedMasterSet = idSet.size > beforeSize;
        if (addedMasterSet) {
            const nextCardIds = Array.from(idSet);
            master[expansion.id] = {
                expansionId: expansion.id,
                expansionName: expansion.name,
                series: expansion.series,
                setImage: expansion.image,
                targetCount: expansion.printedTotal || expansion.total || null,
                cardIds: nextCardIds,
                count: nextCardIds.length,
                updatedAt: Date.now(),
            };
            saveDexMasterSets(master);
        }

        const copies = existsInCollection
            ? getTotalDexConditionCopies(collection[existingIndex]?.conditionQuantities, collection[existingIndex]?.selectedCondition)
            : getTotalDexConditionCopies(normalized?.conditionQuantities, normalized?.selectedCondition);

        return {
            addedCollection: true,
            addedMasterSet,
            expansionName: expansion.name,
            totalCopies: copies,
            storageWriteFailed: false,
        };
    }

    function removeDexCardFromTrackers(cardOrId) {
        const id = safeString(cardOrId?.id ?? cardOrId, '');
        if (!id) return { removedCollection: false, removedMasterSet: false, expansionNames: [] };
        const activeCollectionId = getActiveDexCollectionId();

        const collection = loadDexCollection();
        const nextCollection = collection.filter((x) => {
            if (!isDexCardCollectionItem(x) || safeString(x?.id, '') !== id) return true;
            const entryCollectionId = normalizeDexCollectionId(x?.collectionId, DEX_DEFAULT_COLLECTION_ID);
            return entryCollectionId !== activeCollectionId;
        });
        const removedCollection = nextCollection.length !== collection.length;
        if (removedCollection) {
            saveDexCollection(nextCollection, { immediateCloudSync: true });
        }

        if (activeCollectionId !== DEX_DEFAULT_COLLECTION_ID) {
            return { removedCollection, removedMasterSet: false, expansionNames: [] };
        }

        const master = loadDexMasterSets();
        let removedMasterSet = false;
        /** @type {Array<string>} */
        const expansionNames = [];

        for (const key of Object.keys(master)) {
            const entry = master[key];
            if (!entry || typeof entry !== 'object') continue;

            const cardIds = Array.isArray(entry.cardIds)
                ? entry.cardIds.map((x) => safeString(x, '')).filter(Boolean)
                : [];
            if (!cardIds.includes(id)) continue;

            removedMasterSet = true;
            const name = safeString(entry.expansionName, '');
            if (name && !expansionNames.includes(name)) expansionNames.push(name);

            const nextIds = cardIds.filter((cardId) => cardId !== id);
            if (nextIds.length === 0) {
                delete master[key];
            } else {
                master[key] = {
                    ...entry,
                    cardIds: nextIds,
                    count: nextIds.length,
                    updatedAt: Date.now(),
                };
            }
        }

        if (removedMasterSet) {
            saveDexMasterSets(master, { immediateCloudSync: true });
        }

        return { removedCollection, removedMasterSet, expansionNames };
    }

    function removeDexCardCopyFromTrackers(cardOrId, conditionCode, variantName) {
        const id = safeString(cardOrId?.id ?? cardOrId, '');
        if (!id) {
            return { removedCopy: false, removedCard: false, reason: 'invalidId' };
        }
        const activeCollectionId = getActiveDexCollectionId();

        const code = normalizeDexConditionCode(conditionCode);
        if (!code) {
            return { removedCopy: false, removedCard: false, reason: 'conditionRequired' };
        }

        const collection = loadDexCollection();
        const idx = collection.findIndex((x) => {
            return isDexCardCollectionItem(x)
                && safeString(x?.id, '') === id
                && normalizeDexCollectionId(x?.collectionId, DEX_DEFAULT_COLLECTION_ID) === activeCollectionId;
        });
        if (idx < 0) {
            return { removedCopy: false, removedCard: false, reason: 'notTracked' };
        }

        const existing = normalizeDexCollectionCard(collection[idx]);
        const hasVariants = Array.isArray(existing?.variants) && existing.variants.length > 0;
        const wantedVariant = safeString(variantName, '').trim() || getDexDefaultVariantForCard(existing);
        if (hasVariants && !wantedVariant) {
            return { removedCopy: false, removedCard: false, reason: 'variantRequired' };
        }

        const conditionMap = normalizeConditionQuantities(existing?.conditionQuantities, existing?.selectedCondition);
        const totalBefore = getTotalDexConditionCopies(conditionMap, existing?.selectedCondition);
        const variantMap = normalizeVariantQuantities(existing?.variantQuantities, existing?.selectedVariant, totalBefore);

        const conditionQty = Math.floor(Number(conditionMap[code] || 0));
        if (!Number.isFinite(conditionQty) || conditionQty <= 0) {
            return {
                removedCopy: false,
                removedCard: false,
                reason: 'conditionNotTracked',
                removedCondition: code,
                removedVariant: wantedVariant,
            };
        }

        const variantQty = Math.floor(Number(variantMap[wantedVariant] || 0));
        if (!Number.isFinite(variantQty) || variantQty <= 0) {
            return {
                removedCopy: false,
                removedCard: false,
                reason: 'variantNotTracked',
                removedCondition: code,
                removedVariant: wantedVariant,
            };
        }

        const nextConditionQty = Math.max(0, conditionQty - 1);
        if (nextConditionQty > 0) {
            conditionMap[code] = nextConditionQty;
        } else {
            delete conditionMap[code];
        }

        const nextVariantQty = Math.max(0, variantQty - 1);
        if (nextVariantQty > 0) {
            variantMap[wantedVariant] = nextVariantQty;
        } else {
            delete variantMap[wantedVariant];
        }

        const remainingCopies = getTotalDexConditionCopies(conditionMap, '');
        if (remainingCopies <= 0) {
            const removed = removeDexCardFromTrackers(id);
            return {
                removedCopy: removed.removedCollection || removed.removedMasterSet,
                removedCard: true,
                reason: '',
                removedCondition: code,
                removedVariant: wantedVariant,
                ...removed,
                remainingCopies: 0,
            };
        }

        collection[idx] = {
            ...existing,
            conditionQuantities: conditionMap,
            selectedCondition: getPrimaryConditionCode(conditionMap),
            variantQuantities: variantMap,
            selectedVariant: getPrimaryVariantName(variantMap, getDexDefaultVariantForCard(existing)),
            updatedAt: Date.now(),
        };
        saveDexCollection(collection, { immediateCloudSync: true });

        return {
            removedCopy: true,
            removedCard: false,
            reason: '',
            removedCondition: code,
            removedVariant: wantedVariant,
            removedCollection: true,
            removedMasterSet: false,
            expansionNames: [getDexExpansionInfo(existing).name].filter(Boolean),
            remainingCopies,
        };
    }

    function toggleDexCardInTrackers(card) {
        const id = safeString(card?.id, '');
        if (!id) {
            return {
                action: 'none',
                addedCollection: false,
                addedMasterSet: false,
                removedCollection: false,
                removedMasterSet: false,
                expansionName: '',
                expansionNames: [],
            };
        }

        const added = addDexCardToTrackers(card);
        return {
            action: 'added',
            ...added,
            removedCollection: false,
            removedMasterSet: false,
            expansionNames: [],
        };
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
        // Same escaping as HTML text; safe for placing inside quoted attributes.
        return escapeHtml(value);
    }

    function normalizeVariantNameForCompare(name) {
        return String(name ?? '').trim().toLowerCase();
    }

    function findVariantByName(variants, variantName) {
        if (!Array.isArray(variants)) return null;
        const want = normalizeVariantNameForCompare(variantName);
        if (!want) return null;
        return variants.find((v) => normalizeVariantNameForCompare(v?.name) === want) || null;
    }

    function sanitizeUrl(raw) {
        const s = String(raw ?? '').trim();
        if (!s) return '';
        // Allow http(s) and data:image/* only.
        if (/^https?:\/\//i.test(s)) return s;
        if (/^data:image\//i.test(s)) return s;
        return '';
    }

    function getCardSetName(cardLike) {
        const expansionName = safeString(cardLike?.expansion?.name, '');
        const setName = safeString(cardLike?.set?.name, '');
        const directExpansionName = safeString(cardLike?.expansionName, '');
        const directSetName = safeString(cardLike?.setName, '');
        return expansionName || setName || directExpansionName || directSetName || 'n/a';
    }

    function slugifyForUrl(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .replace(/-{2,}/g, '-');
    }

    function buildCardDetailPath(cardLike) {
        const id = safeString(cardLike?.id, '');
        if (!id) return 'card.html';
        const name = safeString(cardLike?.name, 'card');
        const slug = slugifyForUrl(`${id}-${name}`);
        return `card.html?id=${encodeURIComponent(id)}&slug=${encodeURIComponent(slug)}`;
    }

    function buildAbsoluteUrl(path) {
        const normalizedPath = String(path || '').replace(/^\/+/, '');
        const origin = String(window.location.origin || '').trim();
        if (origin && origin !== 'null' && /^https?:/i.test(origin)) {
            const base = origin.replace(/\/$/, '');
            return `${base}/${normalizedPath}`;
        }
        try {
            return new URL(normalizedPath, window.location.href).href;
        } catch {
            return normalizedPath;
        }
    }

    async function copyTextToClipboard(value) {
        const text = String(value || '');
        if (!text) return false;

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch {
            // ignore
        }

        try {
            const temp = document.createElement('textarea');
            temp.value = text;
            temp.setAttribute('readonly', '');
            temp.style.position = 'absolute';
            temp.style.left = '-9999px';
            document.body.appendChild(temp);
            temp.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(temp);
            return !!ok;
        } catch {
            return false;
        }
    }

    async function shareCardLink(cardLike) {
        const path = buildCardDetailPath(cardLike);
        const url = buildAbsoluteUrl(path);
        const title = safeString(cardLike?.name, 'Pokemon card');
        const setName = getCardSetName(cardLike);
        const text = `${title} • ${setName}`;

        try {
            if (navigator.share) {
                await navigator.share({ title, text, url });
                setStatus('Share options opened.');
                return;
            }
        } catch (err) {
            const errName = String(err?.name || '');
            if (errName === 'AbortError') {
                setStatus('Share canceled.');
                return;
            }
        }

        const copied = await copyTextToClipboard(url);
        setStatus(copied ? 'Card link copied to clipboard.' : 'Unable to copy link on this browser.');
    }

    function normalizeFavoriteCard(card) {
        // Keep a minimal snapshot so Watchlist can render without extra API calls.
        const pricesUpdatedAtRaw = Number(card?.pricesUpdatedAt || 0);
        const pricesSchemaVersionRaw = Number(card?.pricesSchemaVersion || 0);
        return {
            id: safeString(card?.id, ''),
            name: safeString(card?.name, 'Unknown'),
            rarity: safeString(card?.rarity, ''),
            expansion: (card?.expansion && typeof card.expansion === 'object') ? card.expansion : null,
            set: (card?.set && typeof card.set === 'object') ? card.set : null,
            images: Array.isArray(card?.images) ? card.images : [],
            variants: Array.isArray(card?.variants) ? card.variants : [],
            selectedVariant: safeString(card?.selectedVariant, ''),
            pricesText: safeString(card?.pricesText, ''),
            pricesUpdatedAt: Number.isFinite(pricesUpdatedAtRaw) && pricesUpdatedAtRaw > 0 ? pricesUpdatedAtRaw : 0,
            pricesSchemaVersion: Number.isFinite(pricesSchemaVersionRaw) ? Math.max(0, Math.floor(pricesSchemaVersionRaw)) : 0,
        };
    }

    function isFavoritePriceRefreshDue(card) {
        const schemaVersion = Number(card?.pricesSchemaVersion || 0);
        if (!Number.isFinite(schemaVersion) || schemaVersion < FAVORITE_PRICE_SCHEMA_VERSION) return true;
        const lastUpdated = Number(card?.pricesUpdatedAt || 0);
        if (!Number.isFinite(lastUpdated) || lastUpdated <= 0) return true;
        return (Date.now() - lastUpdated) >= FAVORITE_PRICE_REFRESH_INTERVAL_MS;
    }

    function loadFavorites() {
        /** @type {Array<any>} */
        const out = [];
        const seen = new Set();

        /** @param {any[]} list */
        function addList(list) {
            if (!Array.isArray(list)) return;
            for (const item of list) {
                if (!item || typeof item !== 'object' || item.id == null) continue;
                const normalized = normalizeFavoriteCard(item);
                const id = String(normalized.id || '');
                if (!id || seen.has(id)) continue;
                seen.add(id);
                out.push(normalized);
            }
        }

        try {
            addList(loadJsonFromStorage(WATCHLIST_KEY, []));
            addList(loadJsonFromStorage(LEGACY_FAVORITES_KEY, []));

            // Migrate/normalize into the Watchlist key.
            try {
                localStorage.setItem(WATCHLIST_KEY, JSON.stringify(out));
                if (localStorage.getItem(LEGACY_FAVORITES_KEY)) {
                    localStorage.removeItem(LEGACY_FAVORITES_KEY);
                }
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

    async function clearFavorites() {
        const idsToRemove = favorites
            .map((card) => safeString(card?.id, ''))
            .filter(Boolean);
        const removedCount = idsToRemove.length;

        if (removedCount > 0) {
            setStatus('Clearing Watchlist...');
        }

        favorites = [];
        try { localStorage.removeItem(WATCHLIST_KEY); } catch {}
        try { localStorage.removeItem(LEGACY_FAVORITES_KEY); } catch {}
        const restoredState = loadLastResults();
        renderFavorites(restoredState || undefined);

        // Keep results stars in sync.
        renderCards(currentResultsCards, restoredState || undefined);

        try {
            if (idsToRemove.length && window?.PV_AUTH?.removeWatchlistItem) {
                const settled = await Promise.allSettled(idsToRemove.map((id) => window.PV_AUTH.removeWatchlistItem('card', id)));
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

    /** @type {Array<any>} */
    let favorites = loadFavorites();

    function mergeWatchlist(localList, cloudList) {
        /** @type {Array<any>} */
        const merged = [];
        const seen = new Set();

        /** @param {any} item */
        function add(item) {
            if (!item || typeof item !== 'object') return;
            const normalized = normalizeFavoriteCard(item);
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

    // If the user signs in, prefer cloud favorites so they follow the account.
    // Local storage remains as an offline fallback.
    try {
        if (!isDexPage && window?.PV_AUTH?.onAuthStateChanged && window?.PV_AUTH?.loadWatchlist) {
            window.PV_AUTH.onAuthStateChanged((user) => {
                if (!user) {
                    // Sign out: wipe local watchlist so it does not bleed into a different account.
                    favorites = [];
                    saveFavorites([]);
                    const restoredState = loadLastResults();
                    renderFavorites(restoredState || undefined);
                    renderCards(currentResultsCards, restoredState || undefined);
                    return;
                }
                const localSnapshot = Array.isArray(favorites) ? favorites.slice() : loadFavorites();

                Promise.resolve(window.PV_AUTH.loadWatchlist('card'))
                    .then((cloudList) => {
                        if (!Array.isArray(cloudList)) return;

                        // Merge cloud + local to avoid wiping local watchlist when cloud is empty
                        // (common during first-time setup, permission issues, or temporary offline).
                        favorites = mergeWatchlist(localSnapshot, cloudList);
                        saveFavorites(favorites);

                        // Best-effort: push any local-only items into the cloud so it follows the account.
                        try {
                            if (window?.PV_AUTH?.saveWatchlistItem) {
                                const cloudIds = new Set(cloudList.map((x) => String(x?.id || '').trim()).filter(Boolean));
                                const toSync = localSnapshot
                                    .map(normalizeFavoriteCard)
                                    .filter((x) => x && x.id && !cloudIds.has(String(x.id)));
                                if (toSync.length) {
                                    void Promise.allSettled(toSync.map((x) => window.PV_AUTH.saveWatchlistItem('card', x)));
                                }
                            }
                        } catch {
                            // ignore
                        }

                        const restoredState = loadLastResults();
                        renderFavorites(restoredState || undefined);
                        renderCards(currentResultsCards, restoredState || undefined);
                    })
                    .catch(() => {
                        // ignore
                    });
            });
        }
    } catch {
        // ignore
    }

    // When Dex users sign in, hydrate Collection + Master Sets from cloud,
    // merge with any local-only state, then push merged data back to Firestore.
    try {
        if (enableDexTrackingControls && window?.PV_AUTH?.onAuthStateChanged && window?.PV_AUTH?.loadDexState) {
            window.PV_AUTH.onAuthStateChanged((user) => {
                if (!user) {
                    // Sign out: wipe local collection so it does not bleed into a different account.
                    try { localStorage.removeItem(DEX_COLLECTION_KEY); } catch {}
                    try { localStorage.removeItem(DEX_MASTER_SETS_KEY); } catch {}
                    writeDexOwnerUid('');
                    notifyDexStateChanged();
                    if (isDexPage) {
                        updateDexCollectionStats([]);
                    }
                    const restoredState = loadLastResults();
                    renderCards(currentResultsCards, restoredState || undefined);
                    return;
                }
                syncDexStateFromCloudOnSignIn();
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

    function isFavorite(cardId) {
        const id = String(cardId || '');
        return favorites.some((c) => String(c?.id || '') === id);
    }

    function toggleFavorite(card) {
        const id = safeString(card?.id, '');
        if (!id) return;
        const cardName = getCardDisplayName(card);
        const wasInWatchlist = isFavorite(id);

        if (wasInWatchlist) {
            favorites = favorites.filter((c) => String(c?.id || '') !== id);
            try {
                if (window?.PV_AUTH?.removeWatchlistItem) {
                    void window.PV_AUTH.removeWatchlistItem('card', id);
                }
            } catch {
                // ignore
            }
        } else {
            const prev = loadLastResults();
            const selection = prev?.selections?.[id];

            // Prefer whatever is currently shown in Results (most reliable),
            // then fall back to saved lastResults selection.
            const domVariantEl = document.getElementById(`pv-variant-${id}`);
            const domTradeEl = document.getElementById(`pv-trade-${id}`);
            const domPricesEl = document.getElementById(`pv-prices-${id}`);

            const domVariant = (domVariantEl && 'value' in domVariantEl) ? String(domVariantEl.value || '') : '';
            const domTradePctRaw = (domTradeEl && 'value' in domTradeEl) ? domTradeEl.value : null;
            const domTradePct = domTradePctRaw != null ? normalizeTradePercent(domTradePctRaw) : null;
            const domPricesTextRaw = domPricesEl ? String(domPricesEl.textContent || '') : '';
            const domPricesUsable = !!domPricesTextRaw
                && !/select a holo type/i.test(domPricesTextRaw)
                && !/no prices loaded yet/i.test(domPricesTextRaw)
                && !/loading prices/i.test(domPricesTextRaw)
                && !/unable to load prices/i.test(domPricesTextRaw);

            const domPricesLooksValid = domPricesUsable
                && !/^\s*no price data available\.?\s*$/i.test(domPricesTextRaw);

            const pickedVariant = domVariant || selection?.holoType || card?.selectedVariant || '';
            const pickedPricesText = domPricesUsable
                ? (domPricesLooksValid ? domPricesTextRaw : '')
                : (selection?.pricesText || card?.pricesText || '');

            if (domTradePct != null) {
                persistTradePercent(id, domTradePct);
            } else if (selection?.tradePercent != null) {
                persistTradePercent(id, selection.tradePercent);
            }

            // Ensure lastResults has the most up-to-date snapshot (Favorites renders from it on refresh).
            if (prev && Array.isArray(prev.cards)) {
                const selections = (prev.selections && typeof prev.selections === 'object') ? prev.selections : {};
                const prevSel = (selections[id] && typeof selections[id] === 'object') ? selections[id] : {};
                const tradePercentToSave = domTradePct != null
                    ? domTradePct
                    : (selection?.tradePercent != null ? normalizeTradePercent(selection.tradePercent) : (prevSel.tradePercent != null ? normalizeTradePercent(prevSel.tradePercent) : getSavedTradePercentForId(id, prev)));
                selections[id] = {
                    ...prevSel,
                    holoType: pickedVariant || prevSel.holoType || '',
                    pricesText: pickedPricesText || prevSel.pricesText || '',
                    tradePercent: tradePercentToSave,
                };
                saveLastResults({ ...prev, selections });
            }

            const favObj = normalizeFavoriteCard({
                ...card,
                selectedVariant: pickedVariant,
                pricesText: pickedPricesText,
            });

            favorites = [...favorites, favObj];

            try {
                if (window?.PV_AUTH?.saveWatchlistItem) {
                    void window.PV_AUTH.saveWatchlistItem('card', favObj);
                }
            } catch {
                // ignore
            }
        }
        saveFavorites(favorites);
        const restoredState = loadLastResults();
        renderFavorites(restoredState || undefined);

        // Keep results stars in sync without losing variant selection.
        renderCards(currentResultsCards, restoredState || undefined);

        const watchlistMessage = wasInWatchlist
            ? `${cardName} removed from your Watchlist.`
            : `${cardName} added to your Watchlist.`;
        showActionToast(watchlistMessage, wasInWatchlist ? 'removed' : 'added');
    }

    function getCardDisplayName(cardLike) {
        const name = safeString(cardLike?.name, '').trim();
        return name || 'Card';
    }

    function ensureActionToastEl() {
        if (actionToastEl && actionToastEl.isConnected) return actionToastEl;

        const el = document.createElement('div');
        el.id = 'pv-action-toast';
        el.className = 'pv-actionToast';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.setAttribute('aria-atomic', 'true');
        el.hidden = true;
        document.body.appendChild(el);
        actionToastEl = el;
        return el;
    }

    function showActionToast(message, kind) {
        const text = safeString(message, '').trim();
        if (!text) return;

        const el = ensureActionToastEl();
        if (!el) return;

        if (actionToastHideTimer) {
            window.clearTimeout(actionToastHideTimer);
            actionToastHideTimer = 0;
        }
        if (actionToastHideTransitionTimer) {
            window.clearTimeout(actionToastHideTransitionTimer);
            actionToastHideTransitionTimer = 0;
        }

        el.textContent = text;
        el.classList.remove('is-added', 'is-removed', 'is-info', 'is-visible');
        if (kind === 'removed') {
            el.classList.add('is-removed');
        } else if (kind === 'info') {
            el.classList.add('is-info');
        } else {
            el.classList.add('is-added');
        }

        el.hidden = false;
        window.requestAnimationFrame(() => {
            el.classList.add('is-visible');
        });

        actionToastHideTimer = window.setTimeout(() => {
            el.classList.remove('is-visible');
            actionToastHideTransitionTimer = window.setTimeout(() => {
                if (!el.classList.contains('is-visible')) {
                    el.hidden = true;
                }
            }, 280);
        }, 2600);
    }

    function setStatus(message) {
        if (status) status.textContent = message;
    }

    function setResultsHeading(text) {
        if (searchResultsTitleEl) {
            searchResultsTitleEl.textContent = safeString(text, 'Results');
        }
    }

    function setDexResultsContext(message) {
        if (dexResultsContextEl) {
            dexResultsContextEl.textContent = safeString(message, '');
        }
    }

    function loadDexSearchPanelOpenState() {
        if (!isDexPage) return false;
        try {
            const raw = localStorage.getItem(DEX_SEARCH_PANEL_OPEN_KEY);
            return raw === '1' || raw === 'true';
        } catch {
            return false;
        }
    }

    function saveDexSearchPanelOpenState(isOpen) {
        if (!isDexPage) return;
        try {
            localStorage.setItem(DEX_SEARCH_PANEL_OPEN_KEY, isOpen ? '1' : '0');
        } catch {
            // ignore
        }
    }

    function setDexSearchPanelOpen(isOpen, options) {
        if (!dexSearchPanel) return;

        if (isOpen) {
            dexSearchPanel.setAttribute('open', '');
        } else {
            dexSearchPanel.removeAttribute('open');
        }

        if (!options?.skipPersist) {
            saveDexSearchPanelOpenState(!!isOpen);
        }
    }

    function updateDexCollectionStats(collectionList) {
        if (!isDexPage) return;

        const activeCollectionId = getActiveDexCollectionId();
        const list = (Array.isArray(collectionList) ? collectionList : []).filter((item) => {
            return isDexCardCollectionItem(item)
                && normalizeDexCollectionId(item?.collectionId, DEX_DEFAULT_COLLECTION_ID) === activeCollectionId;
        });
        let totalCopies = 0;
        for (const card of list) {
            totalCopies += getTotalDexConditionCopies(card?.conditionQuantities, card?.selectedCondition);
        }

        if (dexStatCardsEl) dexStatCardsEl.textContent = String(list.length);
        if (dexStatCopiesEl) dexStatCopiesEl.textContent = String(totalCopies);

        return { cardCount: list.length, copyCount: totalCopies };
    }

    function activateDexSearchMode() {
        if (!isDexPage) return;
        setResultsHeading('Search Results');
        setDexResultsContext('Search results are shown below.');
        setDexSearchPanelOpen(true);
    }

    function isCreditCapCode(value) {
        const code = String(value || '').trim().toUpperCase();
        return code === 'CREDIT_CAP_HIT' || code === 'QUOTA_EXCEEDED';
    }

    function extractApiErrorDetails(payload, status) {
        const nestedError = payload && typeof payload === 'object' ? payload.error : null;
        const nestedMessage = nestedError && typeof nestedError === 'object'
            ? (nestedError.message || nestedError.error || '')
            : '';
        const topMessage = payload && typeof payload === 'object'
            ? (payload.message || '')
            : '';
        const code = nestedError && typeof nestedError === 'object'
            ? String(nestedError.code || payload?.code || '').trim()
            : String(payload?.code || '').trim();

        const message = String(nestedMessage || topMessage || `API error ${status}`).trim();
        return { message, code };
    }

    function isQuotaExceededError(err) {
        if (!err || typeof err !== 'object') return false;
        // @ts-ignore
        const code = String(err.code || '').trim();
        // @ts-ignore
        const message = String(err.message || '').toLowerCase();
        // @ts-ignore
        return Boolean(err.isQuotaExceeded === true || err.status === 429 || isCreditCapCode(code) || message.includes('credit cap'));
    }

    function getQuotaExceededStatusMessage(err) {
        // @ts-ignore
        const code = String(err?.code || '').trim();
        // @ts-ignore
        const message = String(err?.message || '').toLowerCase();
        if (isCreditCapCode(code) || message.includes('credit cap')) {
            return 'Search is temporarily unavailable. Please try again later.';
        }
        return 'Daily guest allowance reached. Sign in to continue.';
    }

    function setStatusAndHideIfQuotaError(err) {
        const msg = getQuotaExceededStatusMessage(err);
        setStatus(msg);
        // Hide the status banner when showing quota error—use quota banner instead
        if (isQuotaExceededError(err) && status) {
            status.hidden = true;
        }
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

    function renderQuotaBanner(quota, authStateKnownArg) {
        if (!quotaBanner || !quotaMessageEl) return;
        const signedIn = Boolean(window?.PV_AUTH?.getUser && window.PV_AUTH.getUser());

        if (!quota || typeof quota !== 'object') {
            quotaBanner.hidden = true;
            if (quotaCtaEl) quotaCtaEl.hidden = true;
            return;
        }

        const tier = String(quota.tier || '').toLowerCase();
        const limit = quota.limit;
        const used = quota.used;
        const remaining = quota.remaining;

        // If signed in, only show banner if limit has been reached (remaining <= 0).
        // Otherwise hide it.
        if (signedIn) {
            if (remaining == null || remaining > 0) {
                // No data yet or limit not reached: hide banner
                forceHideQuotaBanner();
                return;
            }
            // Limit reached: continue to show error banner below
        }

        quotaBanner.classList.remove('pv-quotaBanner--warn', 'pv-quotaBanner--error');

        // Only show quota numbers after auth state is known, to avoid displaying stale cached data.
        const canShowNumbers = authStateKnownArg === true;
        const hasNumbers = canShowNumbers && remaining != null && limit != null;
        const ratioText = hasNumbers ? `${remaining}/${limit} remaining` : 'Daily allowance';

        let message = '';
        let showCta = false;

        // admin/tester require auth; when signed out this is stale quota from a
        // previous session, but signed-in privileged users should still see their
        // unlimited-access messaging.
        if (tier === 'admin' || tier === 'tester') {
            if (!signedIn) {
                quotaBanner.hidden = true;
                if (quotaCtaEl) quotaCtaEl.hidden = true;
                return;
            }

            message = tier === 'admin' ? 'Admin access: unlimited.' : 'Tester access: unlimited.';
        } else if (tier === 'anon' || tier === 'guest') {
            showCta = !signedIn;  // Only show CTA if signed out
            if (remaining != null && remaining <= 0) {
                quotaBanner.classList.add('pv-quotaBanner--error');
                message = isDexPage
                    ? 'Guest limit reached. Sign in to continue and sync Collection.'
                    : 'Daily guest allowance reached. Sign in to continue (and sync your Watchlist).';
            } else if (remaining != null && remaining <= 2) {
                quotaBanner.classList.add('pv-quotaBanner--warn');
                message = `Guest allowance running low: ${ratioText}. Sign in to increase your daily limit.`;
            } else {
                message = `Guest allowance: ${ratioText}. Sign in to increase your daily limit.`;
            }
        } else if (tier === 'premium' || tier === 'pro') {
            if (signedIn && remaining != null && remaining <= 0) {
                quotaBanner.classList.add('pv-quotaBanner--error');
                message = hasNumbers ? `Premium limit reached: ${ratioText}. Limit resets at midnight.` : 'Premium limit reached.';
                // No button for premium users—they already pay
            } else {
                message = hasNumbers ? `Premium allowance: ${ratioText}.` : 'Premium allowance available.';
            }
        } else {
            // free/basic/unknown
            if (signedIn && remaining != null && remaining <= 0) {
                quotaBanner.classList.add('pv-quotaBanner--error');
                message = hasNumbers ? `Daily limit reached: ${ratioText}. Subscribe now for unlimited access.` : 'Daily limit reached. Subscribe now for unlimited access.';
                showCta = true;  // Show button to upgrade
            } else {
                message = hasNumbers ? `Daily allowance: ${ratioText}.` : 'Daily allowance available.';
            }
        }

        quotaMessageEl.textContent = message;
        clearForcedHideQuotaBanner();
        if (quotaCtaEl) {
            // Set button text and href based on tier and situation
            if (tier === 'anon' || tier === 'guest') {
                quotaCtaEl.textContent = 'Sign in';
                quotaCtaEl.href = 'account.html';
            } else if ((tier === 'basic' || tier === 'free' || tier === '') && signedIn && remaining != null && remaining <= 0) {
                // Show upgrade button for basic/free/unsubscribed users at limit
                quotaCtaEl.textContent = 'Subscribe Now';
                quotaCtaEl.href = 'pricing.html';
            } else {
                quotaCtaEl.textContent = 'Sign in';
                quotaCtaEl.href = 'account.html';
            }

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

    // True once onAuthStateChanged has fired at least once, meaning we know whether
    // the user is signed in or out. Until then, updateQuotaFromResponse will not
    // render the quota banner to avoid race conditions with Firebase auth hydration.
    let authStateKnown = false;

    function updateQuotaFromResponse(res) {
        try {
            const tier = String(res?.headers?.get('x-pv-quota-tier') || '').trim();
            const limitRaw = res?.headers?.get('x-pv-quota-limit');
            const usedRaw = res?.headers?.get('x-pv-quota-used');
            const remainingRaw = res?.headers?.get('x-pv-quota-remaining');

            const limit = limitRaw != null ? safeParseIntOrNull(limitRaw) : null;
            const used = usedRaw != null ? safeParseIntOrNull(usedRaw) : null;
            const remaining = remainingRaw != null ? safeParseIntOrNull(remainingRaw) : null;

            // If the Worker isn't sending headers yet, don't change UI.
            const hasAny = Boolean(tier) || limit != null || used != null || remaining != null;
            if (!hasAny) return;

            const quota = { tier, limit, used, remaining };
            saveQuota(quota);
            // Only update the banner once we know auth state to avoid a race where an
            // API response arrives before Firebase confirms the signed-in user.
            if (authStateKnown) {
                renderQuotaBanner(quota, authStateKnown);
            }
        } catch {
            // ignore
        }
    }

    // Only show quota UI once we KNOW the user is signed out.
    // This avoids the banner flashing from cached data during Firebase auth hydration.
    try {
        const debug = (() => {
            try { return localStorage.getItem('pv:debug') === '1'; } catch { return false; }
        })();

        if (window?.PV_AUTH?.onAuthStateChanged) {
            window.PV_AUTH.onAuthStateChanged((user) => {
                authStateKnown = true;
                if (debug) console.info('[PokeValutor] auth state (search)', user ? 'signed-in' : 'signed-out');
                if (user) {
                    forceHideQuotaBanner();
                } else {
                    renderQuotaBanner(loadSavedQuota(), authStateKnown);
                }
            });
        } else {
            // No auth available: treat as signed out.
            authStateKnown = true;
            renderQuotaBanner(loadSavedQuota(), authStateKnown);
        }
    } catch {
        authStateKnown = true;
        renderQuotaBanner(loadSavedQuota(), authStateKnown);
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

    function setSearchCollectionContextVisible(isVisible) {
        const show = Boolean(isVisible);
        if (searchCollectionContextEl) searchCollectionContextEl.hidden = !show;
        if (!show) {
            setSearchCollectionStatus('');
        }
    }

    function setSearchCollectionStatus(message) {
        if (!searchCollectionStatusEl) return;
        const text = String(message || '').trim();
        searchCollectionStatusEl.hidden = text.length === 0;
        searchCollectionStatusEl.textContent = text;
    }

    function setSearchCollectionContextBusy(isBusy) {
        searchCollectionContextBusy = Boolean(isBusy);
        if (searchCollectionSelectEl) {
            searchCollectionSelectEl.disabled = searchCollectionContextBusy;
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
        searchCollectionContextMeta = normalized;

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

    function renderSearchCollectionContext(meta) {
        const normalized = normalizeCollectionContextMeta(meta, true);
        searchCollectionContextMeta = normalized;
        if (!searchCollectionSelectEl) return;

        searchCollectionSelectEl.innerHTML = normalized.collections.map((entry) => {
            const label = entry.id === DEX_DEFAULT_COLLECTION_ID
                ? `${entry.name} (Master Sets)`
                : entry.name;
            return `<option value="${escapeAttr(entry.id)}">${escapeHtml(label)}</option>`;
        }).join('');
        searchCollectionSelectEl.value = normalized.activeCollectionId;
    }

    function getActiveCollectionNameFromMeta(meta) {
        const normalized = normalizeCollectionContextMeta(meta, true);
        const match = normalized.collections.find((entry) => entry.id === normalized.activeCollectionId);
        return match ? match.name : DEX_DEFAULT_COLLECTION_NAME;
    }

    function rerenderForCollectionContext() {
        const restored = loadLastResults();
        renderCards(currentResultsCards, restored || undefined);
        renderFavorites(restored || undefined);
        if (isDexPage) {
            updateDexCollectionStats(loadDexCollection());
        }
    }

    async function loadCollectionContextMetaFromCloud() {
        const authApi = window?.PV_AUTH;
        if (!authApi?.loadDexCollectionsMeta) {
            const fallback = readCollectionContextMetaLocal();
            renderSearchCollectionContext(fallback);
            persistCollectionContextMetaLocal(fallback);
            return fallback;
        }

        const cloudMeta = await authApi.loadDexCollectionsMeta();
        const normalized = normalizeCollectionContextMeta(cloudMeta, true);
        renderSearchCollectionContext(normalized);
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
        renderSearchCollectionContext(normalized);
        persistCollectionContextMetaLocal(normalized);
        return normalized;
    }

    function forceDefaultCollectionContext() {
        const fallback = {
            activeCollectionId: DEX_DEFAULT_COLLECTION_ID,
            collections: [{ id: DEX_DEFAULT_COLLECTION_ID, name: DEX_DEFAULT_COLLECTION_NAME }],
        };
        renderSearchCollectionContext(fallback);
        persistCollectionContextMetaLocal(fallback);
    }

    function dispatchCollectionContextChanged(activeCollectionId) {
        try {
            window.dispatchEvent(new CustomEvent('pv:dex-collection-context-changed', {
                detail: { activeCollectionId: normalizeDexCollectionId(activeCollectionId, DEX_DEFAULT_COLLECTION_ID) },
            }));
        } catch {
            // ignore
        }
    }

    async function switchActiveCollectionContext(nextCollectionId) {
        if (!searchCollectionSelectEl) return;
        if (searchCollectionContextBusy) return;

        const previousCollectionId = normalizeDexCollectionId(
            searchCollectionContextMeta?.activeCollectionId,
            DEX_DEFAULT_COLLECTION_ID,
        );
        const selectedId = normalizeDexCollectionId(nextCollectionId, DEX_DEFAULT_COLLECTION_ID);
        if (!isPremiumRole(await readCurrentRole())) {
            forceDefaultCollectionContext();
            setSearchCollectionContextVisible(false);
            rerenderForCollectionContext();
            if (previousCollectionId !== DEX_DEFAULT_COLLECTION_ID) {
                dispatchCollectionContextChanged(DEX_DEFAULT_COLLECTION_ID);
            }
            return;
        }

        const currentMeta = normalizeCollectionContextMeta(searchCollectionContextMeta, true);
        if (!currentMeta.collections.some((entry) => entry.id === selectedId)) {
            renderSearchCollectionContext(currentMeta);
            setSearchCollectionStatus('That collection is unavailable right now.');
            return;
        }

        setSearchCollectionContextBusy(true);
        setSearchCollectionStatus('Switching active collection...');

        try {
            const saved = await saveCollectionContextMetaToCloud({
                collections: currentMeta.collections,
                activeCollectionId: selectedId,
            });
            const name = getActiveCollectionNameFromMeta(saved);
            setSearchCollectionStatus(`Active collection: ${name}.`);
            rerenderForCollectionContext();
            if (saved.activeCollectionId !== previousCollectionId) {
                dispatchCollectionContextChanged(saved.activeCollectionId);
            }
        } catch (error) {
            renderSearchCollectionContext(currentMeta);
            setSearchCollectionStatus(String(error?.message || 'Could not switch collections.'));
        } finally {
            setSearchCollectionContextBusy(false);
        }
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

    async function refreshCollectionContextUi() {
        const authApi = window?.PV_AUTH;
        const user = authApi?.getUser ? authApi.getUser() : null;
        if (!user) {
            setSearchCollectionContextVisible(false);
            return;
        }

        const role = await readCurrentRole();
        if (!isPremiumRole(role)) {
            forceDefaultCollectionContext();
            setSearchCollectionContextVisible(false);
            rerenderForCollectionContext();
            return;
        }

        setSearchCollectionContextVisible(true);
        setSearchCollectionContextBusy(true);
        setSearchCollectionStatus('Loading collections...');

        try {
            const meta = await loadCollectionContextMetaFromCloud();
            const name = getActiveCollectionNameFromMeta(meta);
            setSearchCollectionStatus(`Active collection: ${name}.`);
            rerenderForCollectionContext();
        } catch (error) {
            const fallback = readCollectionContextMetaLocal();
            renderSearchCollectionContext(fallback);
            persistCollectionContextMetaLocal(fallback);
            setSearchCollectionStatus(String(error?.message || 'Could not load collections.'));
            rerenderForCollectionContext();
        } finally {
            setSearchCollectionContextBusy(false);
        }
    }

    async function refreshQuotaBannerForAuthState() {
        authStateKnown = true;
        try {
            const user = window?.PV_AUTH?.getUser ? window.PV_AUTH.getUser() : null;
            if (!user) {
                renderQuotaBanner(loadSavedQuota(), authStateKnown);
                return;
            }

            // Signed in: hide banner entirely.
            forceHideQuotaBanner();
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

    function getWorkerBase() {
        // Always fall back to the deployed Worker URL so the app works
        // even if `secrets.js` is missing or not loaded.
        const defaultWorker = 'https://pokevalutor-v1.lreyperez18.workers.dev';
        return (window?.PV_SECRETS?.PV_API_URL || defaultWorker).replace(/\/$/, '');
    }

    function safeParseJson(value) {
        try { return JSON.parse(value); } catch { return null; }
    }

    function loadJsonFromStorage(key, fallbackValue) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallbackValue;

            // Guard against legacy oversized payloads that can stall startup parsing.
            if (raw.length > MAX_STORAGE_JSON_CHARS) {
                try { localStorage.removeItem(key); } catch {}
                console.warn('[PokeValutor] cleared oversized local storage key', key);
                return fallbackValue;
            }

            const parsed = safeParseJson(raw);
            return parsed == null ? fallbackValue : parsed;
        } catch {
            return fallbackValue;
        }
    }

    function loadLastResults() {
        if (lastResultsCache !== undefined) return lastResultsCache;
        try {
            const parsed = loadJsonFromStorage(LAST_RESULTS_KEY, null);
            if (!parsed || typeof parsed !== 'object') {
                lastResultsCache = null;
                return null;
            }
            if (!Array.isArray(parsed.cards)) {
                lastResultsCache = null;
                return null;
            }
            if (parsed.cards.length > MAX_SAVED_RESULTS_CARDS) {
                const trimmed = { ...parsed, cards: parsed.cards.slice(0, MAX_SAVED_RESULTS_CARDS) };
                try {
                    localStorage.setItem(LAST_RESULTS_KEY, JSON.stringify(trimmed));
                } catch {
                    // ignore
                }
                lastResultsCache = trimmed;
                return trimmed;
            }
            lastResultsCache = parsed;
            return parsed;
        } catch {
            lastResultsCache = null;
            return null;
        }
    }

    function compactSavedResultCard(cardLike) {
        const id = safeString(cardLike?.id, '').trim();
        if (!id) return null;

        const expansionName = safeString(cardLike?.expansion?.name ?? cardLike?.expansionName, '');
        const setName = safeString(cardLike?.set?.name ?? cardLike?.setName, '');
        const img = sanitizeUrl(pickFrontMediumImage(cardLike?.images));

        const variantsRaw = Array.isArray(cardLike?.variants) ? cardLike.variants : [];
        const variants = [];
        const seen = new Set();
        for (const v of variantsRaw) {
            const name = safeString(v?.name ?? v, '').trim();
            if (!name || seen.has(name)) continue;
            seen.add(name);
            variants.push({ name });
            if (variants.length >= 12) break;
        }

        const fromLiveMap = Number(searchValueById[id]);
        const sortMarketValueRaw = Number.isFinite(fromLiveMap)
            ? fromLiveMap
            : Number(getCardMarketValueForSort(cardLike));
        const sortMarketValue = Number.isFinite(sortMarketValueRaw) ? sortMarketValueRaw : null;

        return {
            id,
            name: safeString(cardLike?.name, 'Unknown'),
            rarity: safeString(cardLike?.rarity, ''),
            expansion: expansionName ? { name: expansionName } : null,
            set: setName ? { name: setName } : null,
            expansionName,
            setName,
            images: img ? [{ type: 'front', medium: img, large: img, small: img }] : [],
            variants,
            selectedVariant: safeString(cardLike?.selectedVariant, ''),
            pricesText: safeString(cardLike?.pricesText, ''),
            sortMarketValue,
        };
    }

    function normalizeSavedSelections(rawSelections, allowedCardIds) {
        const out = {};
        if (!rawSelections || typeof rawSelections !== 'object') return out;

        let kept = 0;
        for (const [id, raw] of Object.entries(rawSelections)) {
            const cardId = safeString(id, '').trim();
            if (!cardId) continue;
            if (allowedCardIds && !allowedCardIds.has(cardId)) continue;
            if (!raw || typeof raw !== 'object') continue;

            const next = {};
            const holoType = safeString(raw?.holoType, '').trim();
            if (holoType) next.holoType = holoType;

            const pct = Number(raw?.tradePercent);
            if (Number.isFinite(pct)) next.tradePercent = normalizeTradePercent(pct);

            const pricesText = safeString(raw?.pricesText, '').trim();
            if (pricesText) next.pricesText = pricesText.slice(0, MAX_SAVED_PRICES_TEXT_CHARS);

            if (Object.keys(next).length === 0) continue;
            out[cardId] = next;

            kept += 1;
            if (kept >= MAX_SAVED_SELECTIONS) break;
        }

        return out;
    }

    function saveLastResultsNow(next) {
        try {
            const payload = (next && typeof next === 'object') ? { ...next } : {};
            const sourceCards = Array.isArray(payload.cards) ? payload.cards.slice(0, MAX_SAVED_RESULTS_CARDS) : [];
            const compactCards = [];
            for (const c of sourceCards) {
                const compact = compactSavedResultCard(c);
                if (compact) compactCards.push(compact);
            }

            payload.cards = compactCards;
            const allowedCardIds = new Set(compactCards.map((c) => safeString(c?.id, '')));
            payload.selections = normalizeSavedSelections(payload.selections, allowedCardIds);

            let serialized = JSON.stringify(payload);
            if (serialized.length > MAX_LAST_RESULTS_JSON_CHARS && payload.cards.length > 80) {
                payload.cards = payload.cards.slice(0, 80);
                const reducedIds = new Set(payload.cards.map((c) => safeString(c?.id, '')));
                payload.selections = normalizeSavedSelections(payload.selections, reducedIds);
                serialized = JSON.stringify(payload);
            }

            if (serialized.length > MAX_LAST_RESULTS_JSON_CHARS) {
                payload.selections = {};
                serialized = JSON.stringify(payload);
            }

            if (serialized.length > MAX_LAST_RESULTS_JSON_CHARS) {
                console.warn('[PokeValutor] skipped oversized last results save');
                return;
            }

            localStorage.setItem(LAST_RESULTS_KEY, serialized);
            lastResultsCache = payload;
            return true;
        } catch {
            // ignore
            return false;
        }
    }

    function queueLastResultsPersist() {
        if (lastResultsPersistScheduled) return;

        lastResultsPersistScheduled = true;

        const flush = () => {
            lastResultsPersistScheduled = false;
            lastResultsPersistTimer = 0;

            const snapshot = lastResultsCache;
            if (!snapshot || !Array.isArray(snapshot.cards)) return;
            void saveLastResultsNow(snapshot);
        };

        if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
            try {
                lastResultsPersistTimer = window.requestIdleCallback(flush, { timeout: 500 });
                return;
            } catch {
                // fall through to setTimeout
            }
        }

        lastResultsPersistTimer = window.setTimeout(flush, LAST_RESULTS_PERSIST_DELAY_MS);
    }

    function saveLastResults(next) {
        const payload = (next && typeof next === 'object') ? next : null;
        if (!payload || !Array.isArray(payload.cards)) return;

        const sameCardsRef = !!(
            lastResultsCache
            && typeof lastResultsCache === 'object'
            && Array.isArray(lastResultsCache.cards)
            && payload.cards === lastResultsCache.cards
        );

        if (sameCardsRef) {
            lastResultsCache = payload;
            queueLastResultsPersist();
            return;
        }

        if (!saveLastResultsNow(payload)) {
            queueLastResultsPersist();
        }
    }

    function clearLastResults() {
        try { localStorage.removeItem(LAST_RESULTS_KEY); } catch {}
        lastResultsCache = null;
        if (lastResultsPersistTimer) {
            try {
                if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
                    window.cancelIdleCallback(lastResultsPersistTimer);
                } else {
                    window.clearTimeout(lastResultsPersistTimer);
                }
            } catch {
                // ignore
            }
            lastResultsPersistTimer = 0;
        }
        lastResultsPersistScheduled = false;
    }

    function normalizeTradePercent(raw) {
        const n = Number(raw);
        if (!Number.isFinite(n)) return DEFAULT_TRADE_PERCENT;
        return Math.max(0, Math.min(200, Math.round(n)));
    }

    function loadTradePercentMap() {
        if (tradePercentMapLoaded) {
            return tradePercentMapCache && typeof tradePercentMapCache === 'object'
                ? tradePercentMapCache
                : {};
        }

        try {
            const parsed = loadJsonFromStorage(TRADE_PERCENT_MAP_KEY, {});
            const out = (parsed && typeof parsed === 'object') ? parsed : {};
            tradePercentMapCache = out;
            tradePercentMapLoaded = true;
            return out;
        } catch {
            tradePercentMapCache = {};
            tradePercentMapLoaded = true;
            return {};
        }
    }

    function saveTradePercentMap(map) {
        try {
            const safeMap = (map && typeof map === 'object') ? map : {};
            localStorage.setItem(TRADE_PERCENT_MAP_KEY, JSON.stringify(safeMap));
            tradePercentMapCache = safeMap;
            tradePercentMapLoaded = true;
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
    }

    function cacheGet(key) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const parsed = safeParseJson(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            if (typeof parsed.expiresAt !== 'number' || !('value' in parsed)) return null;
            if (Date.now() > parsed.expiresAt) {
                localStorage.removeItem(key);
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
            const serialized = JSON.stringify(payload);
            if (serialized.length > MAX_CACHE_ITEM_JSON_CHARS) return;

            localStorage.setItem(key, serialized);

            cacheWritesSinceSweep += 1;
            if (cacheWritesSinceSweep >= 4) {
                cacheWritesSinceSweep = 0;
                cacheSweep();
            }
        } catch {
            // ignore
        }
    }

    function cacheSweep() {
        try {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                // Only sweep URL cache entries (do not touch persistent UI state like lastResults/favorites).
                if (k && k.startsWith(`${CACHE_PREFIX}url:`)) keys.push(k);
            }

            const now = Date.now();
            const alive = [];
            for (const k of keys) {
                const parsed = safeParseJson(localStorage.getItem(k));
                if (!parsed || typeof parsed.expiresAt !== 'number' || now > parsed.expiresAt) {
                    localStorage.removeItem(k);
                } else {
                    alive.push({ key: k, savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0 });
                }
            }

            if (alive.length > MAX_CACHE_ENTRIES) {
                alive.sort((a, b) => a.savedAt - b.savedAt);
                const toRemove = alive.length - MAX_CACHE_ENTRIES;
                for (let i = 0; i < toRemove; i++) localStorage.removeItem(alive[i].key);
            }
        } catch {
            // ignore
        }
    }

    function purgeUrlCacheEntries(matchFn) {
        try {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith(`${CACHE_PREFIX}url:`)) keys.push(k);
            }

            for (const k of keys) {
                const url = k.slice(`${CACHE_PREFIX}url:`.length);
                if (matchFn(url)) {
                    try { localStorage.removeItem(k); } catch {}
                }
            }
        } catch {
            // ignore
        }
    }

    function renderFavorites(restoreState) {
        if (!favoritesGrid) return;

        try {
            favoritesGrid.innerHTML = '';
            let favoritePricePreloadCount = 0;
            let favoritePriceRefreshCount = 0;

            if (!Array.isArray(favorites) || favorites.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'col-12';
                empty.textContent = 'No watchlist items yet. Click ☆ to save a card.';
                favoritesGrid.appendChild(empty);
                updateFavoritesTotals(restoreState);
                return;
            }

            const sortedFavorites = favorites.slice().sort((a, b) => compareFavoriteCardsForSort(a, b, restoreState));

            for (const fav of sortedFavorites) {
                const col = document.createElement('div');
                col.className = 'col-6 col-sm-6 col-md-4 col-lg-3 pv-favoritesCol';

            const id = safeString(fav?.id, '');
            const name = safeString(fav?.name, 'Unknown');
            const rarity = safeString(fav?.rarity, '');
            const setName = getCardSetName(fav);
            const imgUrl = sanitizeUrl(pickFrontMediumImage(fav?.images));
            const selectedVariant = safeString(restoreState?.selections?.[id]?.holoType ?? fav?.selectedVariant, '');
            const pct = getSavedTradePercentForId(id, restoreState);

            const restoredPricesText = safeString(restoreState?.selections?.[id]?.pricesText, '');

            const idAttr = escapeAttr(id);
            const nameHtml = escapeHtml(name);
            const nameAttr = escapeAttr(name);
            const rarityHtml = escapeHtml(rarity);
            const setNameHtml = escapeHtml(setName);
            const selectedVariantHtml = escapeHtml(selectedVariant);
            const imgUrlAttr = escapeAttr(imgUrl);
            const detailPath = buildCardDetailPath(fav);
            const detailPathAttr = escapeAttr(detailPath);

            const maybePrices = selectedVariant ? getPricesForVariant(fav, selectedVariant) : null;
            const pricesText = maybePrices
                ? formatPriceList(maybePrices, pct)
                : (restoredPricesText || safeString(fav?.pricesText, ''));
            const pricesDisplayText = pricesText || 'No prices loaded yet. Load prices in Results to show them here.';

            col.innerHTML = `
                <div class="pv-card h-100">
                    ${imgUrl ? `<a class="pv-card__imgLink" href="${detailPathAttr}" aria-label="View ${nameAttr} details"><img class="pv-card__img" src="${imgUrlAttr}" alt="${nameAttr} card image"/></a>` : ''}
                    <div class="pv-card__body">
                        <div class="pv-card__header">
                            <div class="pv-card__title"><a class="pv-card__titleLink" href="${detailPathAttr}" aria-label="View ${nameAttr} details">${nameHtml}</a></div>
                            <button id="pv-fav-${idAttr}" class="pv-fav-btn" type="button" aria-label="Remove from watchlist" aria-pressed="true" title="Remove from watchlist">★</button>
                        </div>
                        <p class="pv-card__text pv-card__setName">${setNameHtml}</p>
                        <p class="pv-card__text pv-card__rarity">${rarity ? rarityHtml : 'n/a'}</p>
                        ${selectedVariant ? `<p class="pv-card__text pv-card__variant">Variant: ${selectedVariantHtml}</p>` : ''}
                        <div class="pv-form__field" style="margin-bottom:0.5rem">
                            <label class="form-label" for="pv-fav-trade-${idAttr}">Trade %</label>
                            <select class="form-select pv-selectCompact pv-selectTrade" id="pv-fav-trade-${idAttr}">
                                ${TRADE_PERCENT_CHOICES
                                    .map((p) => `<option value="${p}" ${p === pct ? 'selected' : ''}>${p}%</option>`)
                                    .join('')}
                            </select>
                        </div>
                        <div class="pv-card__text pv-card__prices" id="pv-fav-prices-${idAttr}" aria-live="polite"></div>
                    </div>
                </div>
            `;

            const favBtn = /** @type {HTMLButtonElement|null} */ (col.querySelector(`#pv-fav-${CSS.escape(id)}`));
            if (favBtn) {
                favBtn.addEventListener('click', () => toggleFavorite(fav));
            }

            const tradeEl = /** @type {HTMLSelectElement|null} */ (col.querySelector(`#pv-fav-trade-${CSS.escape(id)}`));
            const pricesEl = /** @type {HTMLElement|null} */ (col.querySelector(`#pv-fav-prices-${CSS.escape(id)}`));

            setCardPricesDisplay(pricesEl, pricesDisplayText);

            async function ensureFavoritePricesLoaded(forceRefresh) {
                if (!pricesEl) return;
                if (forceRefresh) {
                    if (favoritePriceRefreshInFlight.has(id)) return;
                    favoritePriceRefreshInFlight.add(id);
                }
                try {
                const getLivePricesEl = () => {
                    const live = document.getElementById(`pv-fav-prices-${id}`);
                    return (live instanceof HTMLElement) ? live : pricesEl;
                };

                // If we already have real prices text, don't refetch.
                const currentText = String(getLivePricesEl().textContent || '').trim();
                const looksPlaceholder = isPriceTextPlaceholder(currentText);
                if (!forceRefresh && !looksPlaceholder) return;

                let variantName = selectedVariant;
                let loadedPrices = variantName ? getPricesForVariant(fav, variantName) : null;

                if (!forceRefresh && (!variantName || !Array.isArray(loadedPrices) || loadedPrices.length === 0) && Array.isArray(fav?.variants)) {
                    const bestLocal = getBestVariantWithPrices(fav.variants);
                    if (bestLocal?.name) {
                        variantName = bestLocal.name;
                        loadedPrices = bestLocal.prices;
                    }
                }

                if (!forceRefresh && variantName && Array.isArray(loadedPrices) && loadedPrices.length > 0) {
                    const formatted = formatPriceList(loadedPrices, getSavedTradePercentForId(id, restoreState));
                    setCardPricesDisplay(getLivePricesEl(), formatted);

                    favorites = favorites.map((f) => {
                        if (String(f?.id || '') !== id) return f;
                        return {
                            ...f,
                            selectedVariant: variantName,
                            pricesText: formatted,
                            pricesUpdatedAt: Number(f?.pricesUpdatedAt || 0),
                            pricesSchemaVersion: FAVORITE_PRICE_SCHEMA_VERSION,
                        };
                    });
                    saveFavorites(favorites);

                    const prev = loadLastResults();
                    if (prev && Array.isArray(prev.cards)) {
                        const selections = (prev.selections && typeof prev.selections === 'object') ? prev.selections : {};
                        const prevSel = (selections[id] && typeof selections[id] === 'object') ? selections[id] : {};
                        selections[id] = { ...prevSel, pricesText: formatted, holoType: prevSel.holoType || variantName };
                        saveLastResults({ ...prev, selections });
                    }

                    updateFavoritesTotals(loadLastResults() || restoreState);
                    if (!forceRefresh && favoritesSortState.active === 'value') {
                        renderFavorites(loadLastResults() || restoreState);
                    }
                    return;
                }

                if (looksPlaceholder) {
                    setCardPricesDisplay(getLivePricesEl(), 'Loading prices...');
                }
                try {
                    const base = getWorkerBase();
                    const url = `${base}/cards/${encodeURIComponent(id)}?includePrices=1&lang=en`;
                    const data = forceRefresh
                        ? await fetchJsonFresh(url)
                        : await fetchJsonWithCache(url, CARD_TTL_MS);
                    const cardObj = data?.data || data;
                    const allVariants = Array.isArray(cardObj?.variants) ? cardObj.variants : [];
                    if (!variantName || !findVariantByName(allVariants, variantName)) {
                        const bestFetched = getBestVariantWithPrices(allVariants);
                        if (bestFetched?.name) {
                            variantName = bestFetched.name;
                        }
                    }

                    const match = variantName ? findVariantByName(allVariants, variantName) : null;
                    loadedPrices = Array.isArray(match?.prices) ? match.prices : [];
                    const formatted = formatPriceList(loadedPrices, getSavedTradePercentForId(id, restoreState));
                    setCardPricesDisplay(getLivePricesEl(), formatted);

                    favorites = favorites.map((f) => {
                        if (String(f?.id || '') !== id) return f;
                        return {
                            ...f,
                            variants: allVariants,
                            selectedVariant: variantName,
                            pricesText: formatted,
                            pricesUpdatedAt: Date.now(),
                            pricesSchemaVersion: FAVORITE_PRICE_SCHEMA_VERSION,
                        };
                    });
                    saveFavorites(favorites);

                    const prev = loadLastResults();
                    if (prev && Array.isArray(prev.cards)) {
                        const selections = (prev.selections && typeof prev.selections === 'object') ? prev.selections : {};
                        const prevSel = (selections[id] && typeof selections[id] === 'object') ? selections[id] : {};
                        selections[id] = { ...prevSel, pricesText: formatted, holoType: prevSel.holoType || variantName };
                        saveLastResults({ ...prev, selections });
                    }

                    updateFavoritesTotals(loadLastResults() || restoreState);
                    if (!forceRefresh && favoritesSortState.active === 'value') {
                        renderFavorites(loadLastResults() || restoreState);
                    } else if (forceRefresh && favoritesSortState.active === 'value') {
                        scheduleFavoritesForceRefreshRender(restoreState);
                    }
                } catch (e) {
                    if (looksPlaceholder) {
                        setCardPricesDisplay(getLivePricesEl(), 'Unable to load prices.');
                    }
                    console.warn('[PokeValutor] favorite prices preload error', e);
                }
                } finally {
                    if (forceRefresh) {
                        favoritePriceRefreshInFlight.delete(id);
                    }
                }
            }
            if (tradeEl) {
                tradeEl.addEventListener('change', async () => {
                    const nextPct = normalizeTradePercent(tradeEl.value);
                    persistTradePercent(id, nextPct);

                    if (!pricesEl) return;

                    // If we have cached prices in the favorite snapshot, re-render without refetching.
                    if (selectedVariant) {
                        const cachedPrices = getPricesForVariant(fav, selectedVariant);
                        if (Array.isArray(cachedPrices) && cachedPrices.length > 0) {
                            const formatted = formatPriceList(cachedPrices, nextPct);
                            setCardPricesDisplay(pricesEl, formatted);
                            favorites = favorites.map((f) => (String(f?.id || '') === id ? { ...f, pricesText: formatted } : f));
                            saveFavorites(favorites);

                            // Keep lastResults selection text in sync so Favorites can restore reliably.
                            const prev = loadLastResults();
                            if (prev && Array.isArray(prev.cards)) {
                                const selections = (prev.selections && typeof prev.selections === 'object') ? prev.selections : {};
                                const prevSel = (selections[id] && typeof selections[id] === 'object') ? selections[id] : {};
                                selections[id] = { ...prevSel, pricesText: formatted, tradePercent: nextPct, holoType: prevSel.holoType || selectedVariant };
                                saveLastResults({ ...prev, selections });
                            }

                            updateFavoritesTotals(loadLastResults() || restoreState);
                            return;
                        }
                    }

                    // Otherwise fetch prices for the selected variant (if known) so we can compute trade values.
                    if (!selectedVariant) return;
                    setCardPricesDisplay(pricesEl, 'Loading prices…');
                    try {
                        const base = getWorkerBase();
                        const url = `${base}/cards/${encodeURIComponent(id)}?includePrices=1&lang=en`;
                        const data = await fetchJsonWithCache(url, CARD_TTL_MS);
                        const cardObj = data?.data || data;
                        const allVariants = Array.isArray(cardObj?.variants) ? cardObj.variants : [];
                        const match = findVariantByName(allVariants, selectedVariant);
                        const loadedPrices = Array.isArray(match?.prices) ? match.prices : [];
                        const formatted = formatPriceList(loadedPrices, nextPct);
                        setCardPricesDisplay(pricesEl, formatted);
                        favorites = favorites.map((f) => {
                            if (String(f?.id || '') !== id) return f;
                            return { ...f, variants: allVariants, selectedVariant, pricesText: formatted };
                        });
                        saveFavorites(favorites);

                        // Keep lastResults selection text in sync so Favorites can restore reliably.
                        const prev = loadLastResults();
                        if (prev && Array.isArray(prev.cards)) {
                            const selections = (prev.selections && typeof prev.selections === 'object') ? prev.selections : {};
                            const prevSel = (selections[id] && typeof selections[id] === 'object') ? selections[id] : {};
                            selections[id] = { ...prevSel, pricesText: formatted, tradePercent: nextPct, holoType: prevSel.holoType || selectedVariant };
                            saveLastResults({ ...prev, selections });
                        }

                        updateFavoritesTotals(loadLastResults() || restoreState);
                        if (favoritesSortState.active === 'value') {
                            renderFavorites(loadLastResults() || restoreState);
                        }
                    } catch (e) {
                        setCardPricesDisplay(pricesEl, 'Unable to load prices.');
                        console.warn('[PokeValutor] favorite prices error', e);
                    }
                });
            }

            // If a favorite has missing/placeholder prices, preload once.
            if (
                isPriceTextPlaceholder(pricesDisplayText)
                && favoritePricePreloadCount < FAVORITE_PRICE_PRELOAD_LIMIT
            ) {
                favoritePricePreloadCount += 1;
                void ensureFavoritePricesLoaded(false);
            } else if (
                favoritePriceRefreshCount < FAVORITE_PRICE_REFRESH_LIMIT
                && isFavoritePriceRefreshDue(fav)
                && !favoritePriceRefreshInFlight.has(id)
            ) {
                favoritePriceRefreshCount += 1;
                const refreshIndex = favoritePriceRefreshCount;
                window.setTimeout(() => {
                    void ensureFavoritePricesLoaded(true);
                }, refreshIndex * FAVORITE_PRICE_REFRESH_STAGGER_MS);
            }

                favoritesGrid.appendChild(col);
            }

            updateFavoritesTotals(restoreState);
        } catch (error) {
            console.error('[PokeValutor] renderFavorites failed', error);
            favoritesGrid.innerHTML = '';
            const fallback = document.createElement('div');
            fallback.className = 'col-12';
            fallback.textContent = 'Watchlist is temporarily unavailable. Reload the page to retry.';
            favoritesGrid.appendChild(fallback);
            try {
                updateFavoritesTotals(restoreState);
            } catch {
                // ignore
            }
        }
    }

    async function fetchJsonWithCache(url, ttlMs) {
        const cacheKey = `${CACHE_PREFIX}url:${url}`;
        const cached = cacheGet(cacheKey);
        if (cached) {
            // If we previously cached a malformed card+prices response (e.g., missing `variants`),
            // don't keep serving it forever. This can happen if the upstream API response shape
            // changes and the Worker has been updated since.
            const isCardWithPricesUrl = /\/cards\/.+/.test(url)
                && (/[?&]includePrices=1(?:&|$)/.test(url) || /[?&]include=prices(?:&|$)/.test(url));
            if (isCardWithPricesUrl) {
                const cardObj = (cached && typeof cached === 'object' && 'data' in cached) ? cached.data : cached;
                const variants = cardObj?.variants;
                if (!Array.isArray(variants)) {
                    try { localStorage.removeItem(cacheKey); } catch {}
                } else {
                    return cached;
                }
            } else {
                return cached;
            }
        }

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
            throw new Error(`Non-JSON response (${res.status})`);
        }
        if (!res.ok) {
            const details = extractApiErrorDetails(data, res.status);
            const err = new Error(details.message);
            // @ts-ignore
            err.status = res.status;
            // @ts-ignore
            err.code = details.code;
            // @ts-ignore
            err.isQuotaExceeded = res.status === 429 || isCreditCapCode(details.code);
            throw err;
        }

        // Some APIs return HTTP 200 with an { ok:false } payload.
        // Never cache those responses.
        if (data && typeof data === 'object' && data.ok === false) {
            const details = extractApiErrorDetails(data, res.status);
            const err = new Error(details.message || 'API error');
            // @ts-ignore
            err.status = res.status;
            // @ts-ignore
            err.code = details.code;
            // @ts-ignore
            err.isQuotaExceeded = res.status === 429 || isCreditCapCode(details.code);
            throw err;
        }
        cacheSet(cacheKey, data, ttlMs);
        return data;
    }

    async function fetchJsonFresh(url) {
        let headers;
        try {
            const tokenRaw = window?.PV_AUTH?.getIdToken ? await window.PV_AUTH.getIdToken(true) : null;
            const token = typeof tokenRaw === 'string' ? tokenRaw.trim() : '';
            if (token && token.split('.').length === 3) {
                headers = { Authorization: `Bearer ${token}` };
            }
        } catch {
            // ignore
        }

        const requestInit = headers ? { headers, cache: 'no-store' } : { cache: 'no-store' };
        const res = await fetch(url, requestInit);
        updateQuotaFromResponse(res);
        const text = await res.text();

        let data;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error(`Non-JSON response (${res.status})`);
        }

        if (!res.ok || (data && typeof data === 'object' && data.ok === false)) {
            const details = extractApiErrorDetails(data, res.status);
            const err = new Error(details.message || `API error ${res.status}`);
            // @ts-ignore
            err.status = res.status;
            // @ts-ignore
            err.code = details.code;
            // @ts-ignore
            err.isQuotaExceeded = res.status === 429 || isCreditCapCode(details.code);
            throw err;
        }

        return data;
    }

    function pickFrontMediumImage(images) {
        if (!Array.isArray(images)) return '';
        const front = images.find((img) => (img?.type || '').toLowerCase() === 'front');
        return front?.medium || front?.large || front?.small || images[0]?.medium || images[0]?.large || images[0]?.small || '';
    }

    function buildFieldQuery(fieldName, value) {
        const trimmed = String(value || '').trim();
        if (!trimmed) return '';
        const needsQuotes = /\s/.test(trimmed) || /[^A-Za-z0-9]/.test(trimmed);
        const term = needsQuotes ? `"${trimmed.replace(/"/g, '\\"')}"` : trimmed;
        return `${fieldName}:${term}`;
    }

    function toWildcardToken(raw) {
        return String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function buildNameQueryCandidates(rawName) {
        const raw = String(rawName || '').trim();
        if (!raw) return [];

        const candidates = [];
        const seen = new Set();

        function push(q) {
            const query = String(q || '').trim();
            if (!query || seen.has(query)) return;
            seen.add(query);
            candidates.push(query);
        }

        push(buildFieldQuery('name', raw));

        const tokens = raw.split(/\s+/).map(toWildcardToken).filter(Boolean);
        if (tokens.length) {
            // Prefix wildcard for each token improves partial-name matching with limited overhead.
            push(tokens.map((t) => `name:${t}*`).join(' '));

            if (tokens.length === 1) {
                const t = tokens[0];
                if (t.length >= 4) {
                    push(`name:${t.slice(0, 3)}*`);
                }
            }
        }

        return candidates;
    }

    function isLikelyCardNumberQuery(rawQuery) {
        const q = String(rawQuery || '').trim();
        if (!q) return false;

        // Number-like queries are compact and pattern-driven.
        // Keep this strict so names like "Porygon2" stay in name-search mode.
        if (/\s/.test(q)) return false;

        const upper = q.toUpperCase();
        if (/^\d{1,4}$/.test(upper)) return true;
        if (/^\d{1,4}\/\d{1,4}$/.test(upper)) return true;
        if (/^[A-Z]{1,5}\d{1,4}$/.test(upper)) return true;
        if (/^(?=.*\d)[A-Z0-9]{2,6}-[A-Z0-9]{1,6}$/.test(upper)) return true;
        if (/^[A-Z]{1,5}\d{1,4}\/[A-Z]{1,5}\d{1,4}$/.test(upper)) return true;
        return false;
    }

    function formatPriceList(prices, tradePercent) {
        if (!Array.isArray(prices) || prices.length === 0) return 'No prices available for this variant at this time';

        const pctRaw = tradePercent != null ? Number(tradePercent) : NaN;
        const pct = Number.isFinite(pctRaw) ? Math.max(0, Math.min(200, pctRaw)) : null;

        function formatMoney(currency, amount) {
            const moneySymbol = currency === 'USD' || currency === '' ? '$' : '';
            if (amount == null) return null;
            const n = typeof amount === 'number' ? amount : Number(amount);
            if (!Number.isFinite(n)) return null;
            return `${moneySymbol}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }

        /** @type {Array<{rank: number, line: string}>} */
        const lines = [];
        for (const p of prices) {
            if (!p || typeof p !== 'object') continue;
            const condition = p?.condition != null ? String(p.condition) : '';
            const currency = p?.currency != null ? String(p.currency) : '';
            const market = (p?.market ?? p?.marketPrice ?? p?.market_price ?? null);
            // const low = p?.low ?? null; // intentionally hidden (market only)

            const conditionKey = normalizeConditionKey(condition);
            if (!passesConditionFilter(conditionKey)) continue;
            const rank = conditionKey === 'NM'
                ? 0
                : conditionKey === 'LP'
                    ? 1
                    : conditionKey === 'MP'
                        ? 2
                        : 3;

            const marketText = market != null ? formatMoney(currency, market) : null;
            const tradeText = (pct != null && marketText)
                ? formatMoney(currency, (typeof market === 'number' ? market : Number(market)) * (pct / 100))
                : null;

            if (marketText) {
                const prefix = conditionKey || 'VALUE';
                const line = tradeText
                    ? `${prefix}: ${marketText} @${pct}% ${tradeText}`
                    : `${prefix}: ${marketText}`;
                lines.push({ rank, line });
                continue;
            }
            const entries = Object.entries(p)
                .filter(([k, v]) => v != null && typeof v !== 'object' && typeof v !== 'function')
                .slice(0, 6)
                .map(([k, v]) => `${k} ${v}`);
            if (entries.length) {
                const line = entries.join(' • ');
                lines.push({ rank, line });
            }
        }
        if (lines.length) {
            lines.sort((a, b) => a.rank - b.rank);
            return lines.map((x) => x.line).join('\n');
        }
        return 'No prices available for the selected conditions';
    }

    function extractConditionCodeFromLabel(labelText) {
        const label = safeString(labelText, '').trim();
        if (!label) return '';

        const shorthand = label.match(/^(NM|LP|MP|HP|DM)\b/i);
        if (shorthand) return String(shorthand[1] || '').toUpperCase();

        return normalizeConditionKey(label);
    }

    function isPriceTextPlaceholder(rawText) {
        const text = safeString(rawText, '').trim();
        if (!text) return true;
        return /select a holo type|no prices loaded yet|loading prices|unable to load prices/i.test(text);
    }

    function doesPriceTextCoverSelectedFilters(rawText) {
        const text = safeString(rawText, '').trim();
        if (!text) return false;

        const lines = text
            .split(/\r?\n/)
            .map((line) => safeString(line, '').trim())
            .filter(Boolean);
        if (!lines.length) return false;

        const coveredFilterKeys = new Set();
        for (const line of lines) {
            const colonAt = line.indexOf(':');
            const prefix = colonAt > 0 ? safeString(line.slice(0, colonAt), '').trim() : '';
            const code = extractConditionCodeFromLabel(prefix);
            if (!code) continue;
            coveredFilterKeys.add(toConditionFilterKey(code));
        }

        if (coveredFilterKeys.size === 0) return false;

        for (const selectedKey of selectedConditionFilters) {
            if (!coveredFilterKeys.has(selectedKey)) {
                return false;
            }
        }

        return true;
    }

    function filterPriceTextBySelectedFilters(rawText) {
        const text = safeString(rawText, '').trim();
        if (!text) return '';
        if (isPriceTextPlaceholder(text)) return text;

        const lines = text
            .split(/\r?\n/)
            .map((line) => safeString(line, '').trim())
            .filter(Boolean);
        if (!lines.length) return '';

        const nextLines = [];
        for (const line of lines) {
            const colonAt = line.indexOf(':');
            const prefix = colonAt > 0 ? safeString(line.slice(0, colonAt), '').trim() : '';
            const code = extractConditionCodeFromLabel(prefix);
            const filterKey = toConditionFilterKey(code);

            // Keep non-condition lines/messages as-is.
            if (!filterKey) {
                nextLines.push(line);
                continue;
            }

            if (selectedConditionFilters.has(filterKey)) {
                nextLines.push(line);
            }
        }

        return nextLines.join('\n');
    }

    function formatPriceDisplayHtml(rawText) {
        const text = safeString(rawText, '').trim();
        if (!text) return '';

        if (/loading prices|unable to load prices|select a holo type|no prices/i.test(text)) {
            return `<span class="pv-priceMessage">${escapeHtml(text)}</span>`;
        }

        const lines = text
            .split(/\r?\n/)
            .map((line) => safeString(line, '').trim())
            .filter(Boolean);

        if (!lines.length) {
            return `<span class="pv-priceMessage">${escapeHtml(text)}</span>`;
        }

        const out = [];
        for (const line of lines) {
            const colonAt = line.indexOf(':');
            const hasPrefix = colonAt > 0;
            const prefix = hasPrefix ? safeString(line.slice(0, colonAt), '').trim() : '';
            const body = hasPrefix ? safeString(line.slice(colonAt + 1), '').trim() : line;

            const code = extractConditionCodeFromLabel(prefix);
            const conditionLabel = code || prefix;
            const marketMatch = body.match(/(\$[0-9][0-9,]*(?:\.[0-9]+)?)/);
            const tradeMatch = body.match(/@([0-9]+(?:\.[0-9]+)?)%\s*(\$[0-9][0-9,]*(?:\.[0-9]+)?)/i);

            if (!marketMatch) {
                out.push(`<div class="pv-priceLine pv-priceLine--raw">${escapeHtml(line)}</div>`);
                continue;
            }

            const marketValue = safeString(marketMatch[1], '').trim();
            const tradePct = tradeMatch ? safeString(tradeMatch[1], '').trim() : '';
            const tradeValue = tradeMatch ? safeString(tradeMatch[2], '').trim() : '';

            const valueBits = [
                `<span class="pv-priceToken pv-priceToken--market"><span class="pv-priceToken__amount">${escapeHtml(marketValue)}</span></span>`,
                tradeMatch
                    ? `<span class="pv-priceToken pv-priceToken--trade"><span class="pv-priceToken__label">@${escapeHtml(tradePct)}%</span><span class="pv-priceToken__amount">${escapeHtml(tradeValue)}</span></span>`
                    : '',
            ].filter(Boolean);

            const valuesHtml = valueBits.join(' ');

            if (conditionLabel) {
                out.push(`<div class="pv-priceLine"><span class="pv-priceLine__condition">${escapeHtml(conditionLabel)}:</span><span class="pv-priceLine__values">${valuesHtml}</span></div>`);
            } else {
                out.push(`<div class="pv-priceLine"><span class="pv-priceLine__values">${valuesHtml}</span></div>`);
            }
        }

        return out.join('\n');
    }

    function setCardPricesDisplay(pricesEl, text) {
        if (!pricesEl) return;
        const formattedText = safeString(text, '');
        if (!formattedText.trim()) {
            pricesEl.textContent = '';
            return;
        }
        pricesEl.innerHTML = formatPriceDisplayHtml(formattedText);
    }

    function formatUsd(amount) {
        const n = typeof amount === 'number' ? amount : Number(amount);
        if (!Number.isFinite(n)) return '$0.00';
        return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function normalizeConditionKeyForTotals(raw) {
        return normalizeConditionKey(raw);
    }

    function getMarketFromPricesForTotals(prices) {
        if (!Array.isArray(prices) || prices.length === 0) return null;

        /** @type {Record<string, number>} */
        const bestByCondition = {};
        /** @type {number|null} */
        let bestAny = null;

        for (const p of prices) {
            if (!p || typeof p !== 'object') continue;
            const marketRaw = (p?.market ?? p?.marketPrice ?? p?.market_price ?? null);
            const market = typeof marketRaw === 'number' ? marketRaw : Number(marketRaw);
            if (!Number.isFinite(market)) continue;

            const key = normalizeConditionKeyForTotals(p?.condition);
            if (key) {
                const prev = bestByCondition[key];
                if (prev == null || market > prev) bestByCondition[key] = market;
            }
            if (bestAny == null || market > bestAny) bestAny = market;
        }

        // Prefer NM, then LP, then MP.
        if (bestByCondition.NM != null) return bestByCondition.NM;
        if (bestByCondition.LP != null) return bestByCondition.LP;
        if (bestByCondition.MP != null) return bestByCondition.MP;
        return bestAny;
    }

    function getPricesForVariant(cardLike, variantName) {
        const vars = Array.isArray(cardLike?.variants) ? cardLike.variants : [];
        const match = findVariantByName(vars, variantName);
        return Array.isArray(match?.prices) ? match.prices : null;
    }

    function getBestVariantWithPrices(variants) {
        const list = Array.isArray(variants) ? variants : [];
        let best = null;

        for (const v of list) {
            const name = safeString(v?.name, '').trim();
            if (!name) continue;

            const prices = Array.isArray(v?.prices) ? v.prices : null;
            const market = getMarketFromPricesForTotals(prices);
            if (market == null) continue;

            if (!best || market > best.market) {
                best = { name, prices, market };
            }
        }

        return best;
    }

    function getMarketFromPricesText(rawText) {
        const text = safeString(rawText, '');
        if (!text) return null;

        // Legacy format support (older cached text): "market $12.34".
        const legacy = text.match(/market\s+\$([0-9][0-9,]*(?:\.[0-9]+)?)/i);
        if (legacy) {
            const n = Number(String(legacy[1] || '').replace(/,/g, ''));
            if (Number.isFinite(n)) return n;
        }

        // Current format support: "NM: $12.34 @80% $9.87".
        // Take the first money token from the first non-empty line (market value).
        const firstLine = text
            .split(/\r?\n/)
            .map((line) => safeString(line, '').trim())
            .find(Boolean);
        if (!firstLine) return null;

        const marketMatch = firstLine.match(/\$([0-9][0-9,]*(?:\.[0-9]+)?)/);
        if (!marketMatch) return null;
        const parsed = Number(String(marketMatch[1] || '').replace(/,/g, ''));
        return Number.isFinite(parsed) ? parsed : null;
    }

    function getBestMarketFromCardVariants(cardLike) {
        const variants = Array.isArray(cardLike?.variants) ? cardLike.variants : [];
        let best = null;

        for (const v of variants) {
            const prices = Array.isArray(v?.prices) ? v.prices : null;
            const market = getMarketFromPricesForTotals(prices);
            if (market == null) continue;
            if (best == null || market > best) {
                best = market;
            }
        }

        return best;
    }

    function getCardMarketValueForSort(cardLike, restoreState) {
        const id = safeString(cardLike?.id, '');
        const selectedVariant = safeString(
            restoreState?.selections?.[id]?.holoType ?? cardLike?.selectedVariant,
            ''
        );

        if (selectedVariant) {
            const selectedPrices = getPricesForVariant(cardLike, selectedVariant);
            const selectedMarket = getMarketFromPricesForTotals(selectedPrices);
            if (selectedMarket != null) return selectedMarket;
        }

        const bestMarket = getBestMarketFromCardVariants(cardLike);
        if (bestMarket != null) return bestMarket;

        const marketFromText = getMarketFromPricesText(
            restoreState?.selections?.[id]?.pricesText ?? cardLike?.pricesText
        );
        if (marketFromText != null) return marketFromText;

        const persistedSortValue = Number(cardLike?.sortMarketValue);
        return Number.isFinite(persistedSortValue) ? persistedSortValue : null;
    }

    function setSearchCardValue(cardId, value) {
        const id = safeString(cardId, '');
        if (!id) return;

        const n = Number(value);
        if (Number.isFinite(n)) {
            searchValueById[id] = n;
        } else {
            delete searchValueById[id];
        }
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

        for (const fav of favorites) {
            const id = safeString(fav?.id, '');
            if (!id) continue;

            const selectedVariant = safeString(restoreState?.selections?.[id]?.holoType ?? fav?.selectedVariant, '');
            const pct = getSavedTradePercentForId(id, restoreState);

            const prices = selectedVariant ? getPricesForVariant(fav, selectedVariant) : null;
            let market = getMarketFromPricesForTotals(prices);

            // If we don't have structured prices yet, try using any stored formatted text
            // (from lastResults/favorites snapshot) to derive a market value.
            if (market == null) {
                const text = safeString(restoreState?.selections?.[id]?.pricesText ?? fav?.pricesText, '');
                market = getMarketFromPricesText(text);
            }

            if (market == null) continue;

            pricedCount++;
            totalMarket += market;
            totalTrade += market * (Number(pct) / 100);
        }

        const coverage = pricedCount < totalCount ? ` • ${pricedCount}/${totalCount} priced` : '';
        setFavoritesTotalsText(
            `Total: ${formatUsd(totalMarket)}`,
            `Trade: ${formatUsd(totalTrade)}${coverage}`
        );
    }

    function renderCards(cards, restoreState) {
        if (!grid) return;
        const sourceCards = Array.isArray(cards) ? cards : [];
        currentResultsCards = sourceCards.slice();
        grid.innerHTML = '';

        const dexCollectionList = enableDexTrackingControls ? loadDexCollection() : [];
        if (isDexPage) {
            updateDexCollectionStats(dexCollectionList);
        }

        const dexCollectionById = enableDexTrackingControls
            ? new Map(dexCollectionList.map((x) => [safeString(x?.id, ''), x]))
            : null;

        if (!sourceCards.length) {
            for (const key of Object.keys(searchValueById)) {
                delete searchValueById[key];
            }
            const empty = document.createElement('div');
            empty.className = 'col-12';
            empty.textContent = 'No results found.';
            grid.appendChild(empty);
            return;
        }

        const visibleIds = new Set();
        for (const card of sourceCards) {
            const id = safeString(card?.id, '');
            if (!id) continue;
            visibleIds.add(id);
            const market = getCardMarketValueForSort(card, restoreState);
            setSearchCardValue(id, market);
        }
        for (const key of Object.keys(searchValueById)) {
            if (!visibleIds.has(key)) {
                delete searchValueById[key];
            }
        }

        const sortedCards = sourceCards.slice().sort(compareSearchCardsForSort);

        for (const card of sortedCards) {
            const col = document.createElement('div');
            col.className = 'col-6 col-sm-6 col-md-4 col-lg-3 pv-searchCol';

            const id = String(card?.id || '');
            const name = String(card?.name || 'Unknown');
            const rarity = String(card?.rarity || '');
            const setName = getCardSetName(card);
            const imgUrl = sanitizeUrl(pickFrontMediumImage(card?.images));
            const variantsFull = Array.isArray(card?.variants) ? card.variants : [];
            const variants = variantsFull.map((v) => v?.name).filter(Boolean);
            const dexTracked = (enableDexTrackingControls && dexCollectionById)
                ? dexCollectionById.get(id)
                : null;
            const fav = isFavorite(id);
            const inDexCollection = enableDexTrackingControls ? !!dexTracked : false;
            const trackedCopies = enableDexTrackingControls
                ? getTotalDexConditionCopies(dexTracked?.conditionQuantities, dexTracked?.selectedCondition)
                : 0;
            const trackedCopyLabel = trackedCopies > 0 ? ` (${trackedCopies} cop${trackedCopies === 1 ? 'y' : 'ies'})` : '';
            const favSymbol = isDexPage ? (inDexCollection ? '✓' : '+') : (fav ? '★' : '☆');
            const favLabel = isDexPage
                ? (inDexCollection ? `Add another copy to collection${trackedCopyLabel}` : 'Add to collection and master set tracker')
                : (fav ? 'Remove from watchlist' : 'Add to watchlist');
            const removeLabel = enableDexTrackingControls
                ? (inDexCollection ? `Remove one tracked copy${trackedCopyLabel}` : 'No tracked copies to remove')
                : '';
            const dexAddLabel = inDexCollection
                ? `Add another copy to collection${trackedCopyLabel}`
                : 'Add to collection and master set tracker';

            const variantOptions = variants.length
                ? ['<option value="">Select a holo type</option>', ...variants.map((v) => {
                    const vv = String(v);
                    return `<option value="${escapeAttr(vv)}">${escapeHtml(vv)}</option>`;
                })].join('')
                : '<option value="">No variants</option>';

            const restoredSelection = restoreState?.selections?.[id];
            const restoredTradePercent = getSavedTradePercentForId(id, restoreState);
            const idAttr = escapeAttr(id);
            const tradePercentOptions = isDexPage
                ? ''
                : TRADE_PERCENT_CHOICES
                    .map((p) => `<option value="${p}" ${p === restoredTradePercent ? 'selected' : ''}>${p}%</option>`)
                    .join('');

            const selectedDexCondition = normalizeDexConditionCode(dexTracked?.selectedCondition);
            const hideConditionUntilTracked = isSearchPage;
            const showConditionField = !hideConditionUntilTracked || inDexCollection;
            const selectedDexVariant = safeString(dexTracked?.selectedVariant, '');
            const conditionOptions = ['<option value="">Select condition</option>', ...DEX_CARD_CONDITIONS.map((c) => {
                const label = c === 'NM'
                    ? 'Near Mint (NM)'
                    : c === 'LP'
                        ? 'Lightly Played (LP)'
                        : c === 'MP'
                            ? 'Moderately Played (MP)'
                            : c === 'HP'
                                ? 'Heavily Played (HP)'
                                : 'Damaged (DM)';
                const selected = selectedDexCondition === c ? 'selected' : '';
                return `<option value="${c}" ${selected}>${escapeHtml(label)}</option>`;
            })].join('');

            const tradeFieldHtml = isDexPage
                ? ''
                : `
                        <div class="pv-form__field" style="margin-bottom:0.5rem">
                            <label class="form-label" for="pv-trade-${idAttr}">Trade %</label>
                            <select class="form-select pv-selectCompact pv-selectTrade" id="pv-trade-${idAttr}">
                                ${tradePercentOptions}
                            </select>
                        </div>
                `;

            const conditionFieldHtml = enableDexTrackingControls
                ? `
                        <div class="pv-form__field pv-conditionField" id="pv-condition-field-${idAttr}" style="margin-bottom:0.5rem" ${showConditionField ? '' : 'hidden'}>
                            <label class="form-label" for="pv-condition-${idAttr}">Condition</label>
                            <select class="form-select pv-selectCompact pv-selectCondition" id="pv-condition-${idAttr}">
                                ${conditionOptions}
                            </select>
                        </div>
                `
                : '';

            const nameHtml = escapeHtml(name);
            const nameAttr = escapeAttr(name);
            const rarityHtml = escapeHtml(rarity);
            const setNameHtml = escapeHtml(setName);
            const favLabelAttr = escapeAttr(favLabel);
            const removeLabelAttr = escapeAttr(removeLabel);
            const imgUrlAttr = escapeAttr(imgUrl);
            const detailPath = buildCardDetailPath(card);
            const detailPathAttr = escapeAttr(detailPath);
            const moreActionsLabelAttr = escapeAttr('More card actions');
            const dexCardClass = isDexPage ? ' pv-dexCard pv-dexCard--search' : '';

            col.setAttribute('data-card-id', id);
            col.setAttribute('data-card-name', name);

            col.innerHTML = `
                <div class="pv-card h-100${dexCardClass}">
                    ${imgUrl ? `<a class="pv-card__imgLink" href="${detailPathAttr}" aria-label="View ${nameAttr} details"><img class="pv-card__img" src="${imgUrlAttr}" alt="${nameAttr} card image"/></a>` : ''}
                    <div class="pv-card__body">
                        <div class="pv-card__header">
                            <div class="pv-card__title"><a class="pv-card__titleLink" href="${detailPathAttr}" aria-label="View ${nameAttr} details">${nameHtml}</a></div>
                            <div class="pv-card__actions" role="group" aria-label="Card actions">
                                <button id="pv-fav-${idAttr}" class="pv-fav-btn" type="button" aria-label="${favLabelAttr}" aria-pressed="${fav ? 'true' : 'false'}" title="${favLabelAttr}">${favSymbol}</button>
                                ${!isDexPage && enableDexTrackingControls
                                    ? `<button id="pv-dex-add-${idAttr}" class="pv-fav-btn" type="button" aria-label="${escapeAttr(dexAddLabel)}" aria-pressed="${inDexCollection ? 'true' : 'false'}" title="${escapeAttr(dexAddLabel)}">${inDexCollection ? '✓' : '+'}</button>`
                                    : ''}
                                <details class="pv-card__actionsMore">
                                    <summary class="pv-card__moreBtn" aria-label="${moreActionsLabelAttr}" title="${moreActionsLabelAttr}">
                                        <span aria-hidden="true">...</span>
                                    </summary>
                                    <div class="pv-card__actionsMenu">
                                        <button id="pv-share-${idAttr}" class="pv-share-btn pv-share-btn--menu" type="button" aria-label="Share card link" title="Share card link">
                                            <svg class="pv-share-btn__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                                <path d="M18 16a3 3 0 0 0-2.39 1.2L9.91 14a3.28 3.28 0 0 0 0-4l5.7-3.2A3 3 0 1 0 15 5a3 3 0 0 0 .07.62l-5.7 3.2a3 3 0 1 0 0 6.36l5.7 3.2A3 3 0 1 0 18 16z"></path>
                                            </svg>
                                            <span class="pv-card__actionLabel">Share</span>
                                        </button>
                                        ${enableDexTrackingControls
                                            ? `<button id="pv-dex-remove-${idAttr}" class="pv-dex-remove-btn pv-dex-remove-btn--menu" type="button" aria-label="${removeLabelAttr}" title="${removeLabelAttr}" ${inDexCollection ? '' : 'disabled'}><span class="pv-card__actionGlyph" aria-hidden="true">-</span><span class="pv-card__actionLabel">Remove copy</span></button>`
                                            : ''}
                                    </div>
                                </details>
                            </div>
                        </div>
                        <p class="pv-card__text pv-dexCard__setName pv-card__setName">${setNameHtml}</p>
                        <p class="pv-card__text pv-dexCard__meta pv-card__rarity">${rarity ? rarityHtml : 'n/a'}</p>
                        <div class="pv-form__field" style="margin-bottom:0.5rem">
                            <label class="form-label" for="pv-variant-${idAttr}">Variant</label>
                            <select class="form-select pv-selectCompact pv-selectVariant" id="pv-variant-${idAttr}" ${variants.length ? '' : 'disabled'}>
                                ${variantOptions}
                            </select>
                        </div>
                        ${conditionFieldHtml}
                        ${tradeFieldHtml}
                        <div class="pv-card__text pv-dexCard__prices pv-card__prices" id="pv-prices-${idAttr}" aria-live="polite"></div>
                    </div>
                </div>
            `;

            // Declare these after col.innerHTML so the elements exist
            const selectEl = /** @type {HTMLSelectElement|null} */ (col.querySelector(`#pv-variant-${CSS.escape(id)}`));
            const conditionEl = /** @type {HTMLSelectElement|null} */ (col.querySelector(`#pv-condition-${CSS.escape(id)}`));
            const conditionFieldWrapEl = /** @type {HTMLElement|null} */ (col.querySelector(`#pv-condition-field-${CSS.escape(id)}`));
            const tradeEl = /** @type {HTMLSelectElement|null} */ (col.querySelector(`#pv-trade-${CSS.escape(id)}`));
            const pricesEl = /** @type {HTMLElement|null} */ (col.querySelector(`#pv-prices-${CSS.escape(id)}`));
            const shareBtn = /** @type {HTMLButtonElement|null} */ (col.querySelector(`#pv-share-${CSS.escape(id)}`));
            const favBtn = /** @type {HTMLButtonElement|null} */ (col.querySelector(`#pv-fav-${CSS.escape(id)}`));
            const dexAddBtn = /** @type {HTMLButtonElement|null} */ (col.querySelector(`#pv-dex-add-${CSS.escape(id)}`));
            const removeBtn = /** @type {HTMLButtonElement|null} */ (col.querySelector(`#pv-dex-remove-${CSS.escape(id)}`));
            const actionsMoreEl = /** @type {HTMLDetailsElement|null} */ (col.querySelector('.pv-card__actionsMore'));

            if (shareBtn) {
                shareBtn.addEventListener('click', () => {
                    if (actionsMoreEl) actionsMoreEl.open = false;
                    void shareCardLink(card);
                });
            }

            function updateDexButtonStateFromStorage() {
                if (!enableDexTrackingControls) return;

                const trackedEntry = loadDexCollection().find((x) => isDexCardCollectionItem(x) && safeString(x?.id, '') === id) || null;
                const nowTracked = !!trackedEntry;
                const nowCopies = nowTracked
                    ? getTotalDexConditionCopies(trackedEntry?.conditionQuantities, trackedEntry?.selectedCondition)
                    : 0;
                const copyLabel = nowCopies > 0 ? ` (${nowCopies} cop${nowCopies === 1 ? 'y' : 'ies'})` : '';

                const addLabel = nowTracked
                    ? `Add another copy to collection${copyLabel}`
                    : 'Add to collection and master set tracker';
                if (isDexPage && favBtn) {
                    favBtn.textContent = nowTracked ? '✓' : '+';
                    favBtn.setAttribute('aria-label', addLabel);
                    favBtn.setAttribute('title', addLabel);
                    favBtn.setAttribute('aria-pressed', nowTracked ? 'true' : 'false');
                }

                if (!isDexPage && dexAddBtn) {
                    dexAddBtn.textContent = nowTracked ? '✓' : '+';
                    dexAddBtn.setAttribute('aria-label', addLabel);
                    dexAddBtn.setAttribute('title', addLabel);
                    dexAddBtn.setAttribute('aria-pressed', nowTracked ? 'true' : 'false');
                }

                if (removeBtn) {
                    const rmLabel = nowTracked
                        ? `Remove one tracked copy${copyLabel}`
                        : 'No tracked copies to remove';
                    removeBtn.disabled = !nowTracked;
                    removeBtn.setAttribute('aria-label', rmLabel);
                    removeBtn.setAttribute('title', rmLabel);
                }

                if (conditionFieldWrapEl && isSearchPage) {
                    conditionFieldWrapEl.hidden = !nowTracked;
                }

                if (conditionEl) {
                    const trackedCode = normalizeDexConditionCode(trackedEntry?.selectedCondition);
                    if (trackedCode) {
                        conditionEl.value = trackedCode;
                    } else if (!nowTracked && isSearchPage) {
                        conditionEl.value = '';
                    }
                }
            }

            if (favBtn) {
                if (isDexPage) {
                    favBtn.setAttribute('aria-pressed', inDexCollection ? 'true' : 'false');
                }
                if (isDexPage) {
                    favBtn.addEventListener('click', () => {
                        const currentlyTracked = isInDexCollection(id);
                        const cardName = getCardDisplayName(card);
                        const selectedCondition = normalizeDexConditionCode(conditionEl?.value);
                        if (!selectedCondition) {
                            if (conditionFieldWrapEl && conditionFieldWrapEl.hidden) {
                                conditionFieldWrapEl.hidden = false;
                            }
                            showActionToast('Select a condition first, then click + again.', 'info');
                            setStatus('Select a condition first, then click + again.');
                            if (conditionEl) conditionEl.focus();
                            return;
                        }

                        const selectedVariant = safeString(selectEl?.value, '');
                        if (Array.isArray(variants) && variants.length > 0 && !selectedVariant) {
                            setStatus('Select a variant first.');
                            if (selectEl) selectEl.focus();
                            return;
                        }

                        try {
                            card.selectedCondition = selectedCondition;
                            card.selectedVariant = selectedVariant;
                        } catch {
                            // ignore
                        }

                        const result = toggleDexCardInTrackers(card);
                        updateDexButtonStateFromStorage();

                        if (result.storageWriteFailed) {
                            const actionMessage = getCollectionStorageWriteFailureMessage();
                            showActionToast(actionMessage, 'info');
                            setStatus(actionMessage);
                            return;
                        }

                        const addedConditionLabel = getDexConditionLabel(selectedCondition);
                        const addedVariantRaw = safeString(selectedVariant || getDexDefaultVariantForCard(card), '').trim();
                        const addedVariantLabel = addedVariantRaw || 'Standard';
                        const addedDetail = `${addedConditionLabel} • ${addedVariantLabel}`;

                        if (result.action === 'added' && (result.addedCollection || result.addedMasterSet)) {
                            const actionMessage = `${cardName} added to Collection.`;
                            showActionToast(actionMessage, 'added');
                        } else if (result.action === 'removed' && (result.removedCollection || result.removedMasterSet)) {
                            const actionMessage = `${cardName} removed from Collection.`;
                            showActionToast(actionMessage, 'removed');
                        } else if (result.action === 'added') {
                            setStatus('Already in Collection.');
                        } else if (result.action === 'removed') {
                            setStatus('Already removed from Collection.');
                        }
                    });
                } else {
                    favBtn.addEventListener('click', () => toggleFavorite(card));
                }
            }

            if (!isDexPage && enableDexTrackingControls && dexAddBtn) {
                dexAddBtn.addEventListener('click', () => {
                    const currentlyTracked = isInDexCollection(id);
                    const cardName = getCardDisplayName(card);
                    const selectedCondition = normalizeDexConditionCode(conditionEl?.value);
                    if (!selectedCondition) {
                        if (conditionFieldWrapEl && conditionFieldWrapEl.hidden) {
                            conditionFieldWrapEl.hidden = false;
                        }
                        showActionToast('Select a condition first, then click + again.', 'info');
                        setStatus('Select a condition first, then click + again.');
                        if (conditionEl) conditionEl.focus();
                        return;
                    }

                    const selectedVariant = safeString(selectEl?.value, '');
                    if (Array.isArray(variants) && variants.length > 0 && !selectedVariant) {
                        setStatus('Select a variant first.');
                        if (selectEl) selectEl.focus();
                        return;
                    }

                    try {
                        card.selectedCondition = selectedCondition;
                        card.selectedVariant = selectedVariant;
                    } catch {
                        // ignore
                    }

                    const result = toggleDexCardInTrackers(card);
                    updateDexButtonStateFromStorage();

                    if (result.storageWriteFailed) {
                        const actionMessage = getCollectionStorageWriteFailureMessage();
                        showActionToast(actionMessage, 'info');
                        setStatus(actionMessage);
                        return;
                    }

                    const addedConditionLabel = getDexConditionLabel(selectedCondition);
                    const addedVariantRaw = safeString(selectedVariant || getDexDefaultVariantForCard(card), '').trim();
                    const addedVariantLabel = addedVariantRaw || 'Standard';
                    const addedDetail = `${addedConditionLabel} • ${addedVariantLabel}`;

                    if (result.action === 'added' && (result.addedCollection || result.addedMasterSet)) {
                        const actionMessage = `${cardName} added to Collection.`;
                        showActionToast(actionMessage, 'added');
                    } else if (result.action === 'removed' && (result.removedCollection || result.removedMasterSet)) {
                        const actionMessage = `${cardName} removed from Collection.`;
                        showActionToast(actionMessage, 'removed');
                    } else if (result.action === 'added') {
                        setStatus('Already in Collection.');
                    } else if (result.action === 'removed') {
                        setStatus('Already removed from Collection.');
                    }
                });
            }

            if (enableDexTrackingControls && removeBtn) {
                removeBtn.addEventListener('click', () => {
                    if (actionsMoreEl) actionsMoreEl.open = false;
                    const cardName = getCardDisplayName(card);
                    if (!isInDexCollection(id)) {
                        setStatus('No tracked copies to remove.');
                        return;
                    }

                    const selectedCondition = normalizeDexConditionCode(conditionEl?.value);
                    if (!selectedCondition) {
                        setStatus('Select the condition to remove.');
                        if (conditionEl) conditionEl.focus();
                        return;
                    }

                    const selectedVariant = safeString(selectEl?.value, '');
                    if (Array.isArray(variants) && variants.length > 0 && !selectedVariant) {
                        setStatus('Select the variant to remove.');
                        if (selectEl) selectEl.focus();
                        return;
                    }

                    const removed = removeDexCardCopyFromTrackers(card, selectedCondition, selectedVariant);
                    updateDexButtonStateFromStorage();

                    const removedConditionCode = normalizeDexConditionCode(removed?.removedCondition || selectedCondition);
                    const removedConditionLabel = getDexConditionLabel(removedConditionCode);
                    const removedVariantRaw = safeString(removed?.removedVariant || selectedVariant || getDexDefaultVariantForCard(card), '').trim();
                    const removedVariantLabel = removedVariantRaw || 'Standard';
                    const removedDetail = `${removedConditionLabel} • ${removedVariantLabel}`;

                    if (!removed.removedCopy) {
                        if (removed.reason === 'conditionNotTracked') {
                            setStatus(`No tracked copy exists for ${removedDetail} on this card.`);
                        } else if (removed.reason === 'variantNotTracked') {
                            setStatus(`No tracked copy exists for ${removedDetail} on this card.`);
                        } else if (removed.reason === 'variantRequired') {
                            setStatus('Select the variant to remove.');
                            if (selectEl) selectEl.focus();
                        } else {
                            setStatus('Unable to remove copy right now.');
                        }
                        return;
                    }

                    if (removed.removedCard) {
                        const actionMessage = `${cardName} removed from Collection.`;
                        showActionToast(actionMessage, 'removed');
                    } else {
                        const actionMessage = `${cardName} removed from Collection.`;
                        showActionToast(actionMessage, 'removed');
                    }
                });
            }

            if (enableDexTrackingControls && selectEl && selectedDexVariant && variants.includes(selectedDexVariant)) {
                selectEl.value = selectedDexVariant;
            }

            let lastLoadedVariantName = '';
            /** @type {Array<any>|null} */
            let lastLoadedPrices = null;

            function getSelectedTradePercent() {
                if (isDexPage) return null;
                const raw = tradeEl?.value;
                const n = Number(raw);
                return Number.isFinite(n) ? n : DEFAULT_TRADE_PERCENT;
            }

            function persistSelection(variantName, formatted) {
                // Keep an in-memory snapshot on the card object so favoriting can
                // immediately copy what the user sees, even if localStorage writes fail.
                try {
                    card.selectedVariant = variantName;
                    card.pricesText = formatted;
                } catch {
                    // ignore
                }

                const prev = loadLastResults();
                if (prev && Array.isArray(prev.cards)) {
                    const selections = (prev.selections && typeof prev.selections === 'object') ? prev.selections : {};
                    const prevSel = (selections[id] && typeof selections[id] === 'object') ? selections[id] : {};
                    const nextTradePercent = getSelectedTradePercent();
                    selections[id] = isDexPage
                        ? { ...prevSel, holoType: variantName, pricesText: formatted }
                        : { ...prevSel, holoType: variantName, pricesText: formatted, tradePercent: nextTradePercent };
                    saveLastResults({ ...prev, selections });
                }

                // Also persist trade percent independently so it survives lastResults clearing.
                if (!isDexPage) {
                    persistTradePercent(id, getSelectedTradePercent());
                }

                // If this card is favorited, keep the Favorites price display in sync.
                if (isFavorite(id)) {
                    favorites = favorites.map((f) => {
                        if (String(f?.id || '') !== id) return f;
                        return { ...f, selectedVariant: variantName, pricesText: formatted };
                    });
                    saveFavorites(favorites);
                    const restored = loadLastResults();
                    renderFavorites(restored || undefined);
                }
            }

            function renderPricesFromLoaded() {
                if (!pricesEl) return;
                if (!lastLoadedPrices || !Array.isArray(lastLoadedPrices)) return;
                const formatted = formatPriceList(lastLoadedPrices, getSelectedTradePercent());
                setCardPricesDisplay(pricesEl, formatted);
                const market = getMarketFromPricesForTotals(lastLoadedPrices);
                setSearchCardValue(id, market);
                if (searchSortState.active === 'value') {
                    applySearchSortToGrid();
                }
                if (lastLoadedVariantName) {
                    persistSelection(lastLoadedVariantName, formatted);
                }
            }

            // Now define the function, so selectEl/pricesEl are in scope
            async function showPricesForSelectedVariant() {
                if (!selectEl || !pricesEl) return;
                const variantName = selectEl.value;
                if (!variantName) {
                    setCardPricesDisplay(pricesEl, variants.length ? 'Select a holo type to load prices.' : '');
                    return;
                }

                // If this card already has variant prices (e.g., from a cached/top list),
                // use them directly to avoid extra API credit usage.
                const localMatch = findVariantByName(variantsFull, variantName);
                const localPrices = Array.isArray(localMatch?.prices) ? localMatch.prices : null;
                // Scrydex may include `prices: []` as a placeholder when prices weren't actually included.
                // Only short-circuit if we have non-empty prices.
                if (localPrices && localPrices.length > 0) {
                    lastLoadedVariantName = variantName;
                    lastLoadedPrices = localPrices;
                    const formatted = formatPriceList(localPrices, getSelectedTradePercent());
                    setCardPricesDisplay(pricesEl, formatted);
                    const market = getMarketFromPricesForTotals(localPrices);
                    setSearchCardValue(id, market);
                    if (searchSortState.active === 'value') {
                        applySearchSortToGrid();
                    }
                    persistSelection(variantName, formatted);
                    return;
                }

                setCardPricesDisplay(pricesEl, 'Loading prices…');
                try {
                    const base = getWorkerBase();
                    const url = `${base}/cards/${encodeURIComponent(id)}?includePrices=1&lang=en`;
                    const data = await fetchJsonWithCache(url, CARD_TTL_MS);
                    const cardObj = data?.data || data;
                    const allVariants = Array.isArray(cardObj?.variants) ? cardObj.variants : [];
                    const match = findVariantByName(allVariants, variantName);
                    lastLoadedVariantName = variantName;
                    lastLoadedPrices = Array.isArray(match?.prices) ? match.prices : [];
                    const formatted = formatPriceList(lastLoadedPrices, getSelectedTradePercent());
                    setCardPricesDisplay(pricesEl, formatted);
                    const market = getMarketFromPricesForTotals(lastLoadedPrices);
                    setSearchCardValue(id, market);
                    if (searchSortState.active === 'value') {
                        applySearchSortToGrid();
                    }

                    // Keep the in-memory card object in sync with what is shown.
                    try {
                        card.variants = allVariants;
                    } catch {
                        // ignore
                    }
                    persistSelection(variantName, formatted);

                    // If favorited, store the fetched variants (with prices) so Favorites can re-render trade % without refetching.
                    if (isFavorite(id)) {
                        favorites = favorites.map((f) => {
                            if (String(f?.id || '') !== id) return f;
                            return { ...f, variants: allVariants, selectedVariant: variantName, pricesText: formatted };
                        });
                        saveFavorites(favorites);
                        const restored = loadLastResults();
                        renderFavorites(restored || undefined);
                    }
                } catch (e) {
                    setCardPricesDisplay(pricesEl, 'Unable to load prices.');
                    console.warn('[PokeValutor] prices error', e);
                }
            }

            if (selectEl && pricesEl) {
                // Restore previously selected holo type and prices if available
                if (restoredSelection?.holoType && variants.includes(restoredSelection.holoType)) {
                    selectEl.value = restoredSelection.holoType;
                    const restoredVariant = String(restoredSelection.holoType);
                    const restoredMatch = findVariantByName(variantsFull, restoredVariant);
                    const restoredPrices = Array.isArray(restoredMatch?.prices) ? restoredMatch.prices : [];
                    if (restoredPrices.length > 0) {
                        lastLoadedVariantName = restoredVariant;
                        lastLoadedPrices = restoredPrices;
                        const formatted = formatPriceList(restoredPrices, getSelectedTradePercent());
                        setCardPricesDisplay(pricesEl, formatted);
                        const market = getMarketFromPricesForTotals(restoredPrices);
                        setSearchCardValue(id, market);
                        if (searchSortState.active === 'value') {
                            applySearchSortToGrid();
                        }
                        persistSelection(restoredVariant, formatted);
                    } else if (restoredSelection.pricesText && !isDexPage) {
                        const restoredPricesText = String(restoredSelection.pricesText || '');
                        const filteredRestoredText = filterPriceTextBySelectedFilters(restoredPricesText);
                        setCardPricesDisplay(pricesEl, filteredRestoredText || 'Loading prices…');
                        lastLoadedVariantName = restoredVariant;
                        const market = getMarketFromPricesText(filteredRestoredText);
                        setSearchCardValue(id, market);
                        if (searchSortState.active === 'value') {
                            applySearchSortToGrid();
                        }

                        // Keep the in-memory card snapshot aligned with restored state.
                        try {
                            card.selectedVariant = restoredVariant;
                            card.pricesText = filteredRestoredText || restoredPricesText;
                        } catch {
                            // ignore
                        }

                        if (isPriceTextPlaceholder(restoredPricesText) || !doesPriceTextCoverSelectedFilters(restoredPricesText)) {
                            void showPricesForSelectedVariant();
                        }
                    } else {
                        // If pricesText is missing, trigger loading
                        void showPricesForSelectedVariant();
                    }
                } else {
                    // No previous selection.
                    // If there is only one variant, select it automatically.
                    if (variants.length === 1 && variants[0]) {
                        selectEl.value = String(variants[0]);
                        void showPricesForSelectedVariant();
                    } else {
                    // If prices are already present in the card payload, pick the best-valued variant
                    // and show it immediately (useful for top-by-expansion lists).
                    let bestVariant = '';
                    let bestMarket = null;
                    for (const v of variantsFull) {
                        const vName = String(v?.name || '');
                        const vPrices = Array.isArray(v?.prices) ? v.prices : null;
                        const market = getMarketFromPricesForTotals(vPrices);
                        if (!vName || market == null) continue;
                        if (bestMarket == null || market > bestMarket) {
                            bestMarket = market;
                            bestVariant = vName;
                        }
                    }

                    if (bestVariant && variants.includes(bestVariant)) {
                        selectEl.value = bestVariant;
                        const match = findVariantByName(variantsFull, bestVariant);
                        const p = Array.isArray(match?.prices) ? match.prices : [];
                        lastLoadedVariantName = bestVariant;
                        lastLoadedPrices = p;
                        const formatted = formatPriceList(p, getSelectedTradePercent());
                        setCardPricesDisplay(pricesEl, formatted);
                        const market = getMarketFromPricesForTotals(p);
                        setSearchCardValue(id, market);
                        if (searchSortState.active === 'value') {
                            applySearchSortToGrid();
                        }
                        persistSelection(bestVariant, formatted);
                    } else {
                        setCardPricesDisplay(pricesEl, variants.length ? 'Select a holo type to load prices.' : '');
                    }
                    }
                }
                selectEl.addEventListener('change', showPricesForSelectedVariant);
            }

            if (tradeEl) {
                tradeEl.addEventListener('change', () => {
                    persistTradePercent(id, getSelectedTradePercent());

                    // If we already have prices loaded, re-render without refetching.
                    if (lastLoadedPrices && Array.isArray(lastLoadedPrices) && lastLoadedVariantName) {
                        renderPricesFromLoaded();
                        return;
                    }

                    // If a variant is selected but we don't have cached prices in-memory (e.g., after refresh), fetch.
                    if (selectEl && selectEl.value) {
                        void showPricesForSelectedVariant();
                        return;
                    }

                    // Otherwise just persist the percent choice for restore.
                    // (lastResults persistence handled inside persistTradePercent)
                });
            }

            grid.appendChild(col);
        }
    }

    async function searchByName(name) {
        activateDexSearchMode();
        const q = (name || '').trim();
        if (!q) {
            setStatus('Please enter a Pokémon name.');
            renderCards([]);
            return;
        }
        resetDexSetBrowseState();
        const base = getWorkerBase();

        setStatus('Searching…');
        if (grid) {
            grid.innerHTML = '';
            for (let i = 0; i < 8; i++) {
                const col = document.createElement('div');
                col.className = 'col-6 col-sm-6 col-md-4 col-lg-3';
                col.innerHTML = '<div class="pv-card" style="height:260px"><div class="pv-skeleton" style="height:100%"></div></div>';
                grid.appendChild(col);
            }
        }

        try {
            const queryCandidates = buildNameQueryCandidates(q).slice(0, 3);
            let cards = [];
            let matchedBy = 'exact';
            let matchedQuery = '';
            let hasMore = false;

            // Try exact/strict first, then controlled wildcard fallbacks.
            for (let i = 0; i < queryCandidates.length; i++) {
                const query = queryCandidates[i];
                const page1 = await fetchCardsSearchPage(base, query, 1, NAME_SEARCH_PAGE_SIZE);
                if (page1.cards.length) {
                    cards = page1.cards;
                    matchedQuery = query;
                    hasMore = page1.hasMore;
                    matchedBy = i === 0 ? 'exact' : 'fallback';
                    break;
                }
            }

            renderCards(cards);
            const limitNote = hasMore ? ' Showing first 15. Load More for more.' : '';
            const matchNote = matchedBy === 'fallback' && cards.length
                ? ' Closest matches shown.'
                : '';
            const statusText = `${cards.length} result${cards.length !== 1 ? 's' : ''} for "${q}".${limitNote}${matchNote}`;
            setStatus(statusText);

            saveLastResults({
                savedAt: Date.now(),
                mode: 'name',
                query: q,
                cards,
                statusText,
                selections: (() => {
                    const prev = loadLastResults();
                    return (prev?.selections && typeof prev.selections === 'object') ? prev.selections : {};
                })(),
            });

            if (matchedQuery) {
                dexSetBrowseState = {
                    active: true,
                    mode: 'name',
                    query: q,
                    expansionId: '',
                    expansionName: '',
                    expansionSeries: '',
                    queryCandidates,
                    matchedQuery,
                    nextPage: 2,
                    pageSize: NAME_SEARCH_PAGE_SIZE,
                    cards: cards.slice(),
                    hasMore,
                };
                setLoadMoreState(hasMore, false);
            }
        } catch (e) {
            console.warn('[PokeValutor] search error', e);
            renderCards([]);
            resetDexSetBrowseState();
            if (isQuotaExceededError(e)) {
                setStatusAndHideIfQuotaError(e);
            } else if (e && typeof e === 'object' && 'status' in e && Number(e.status) === 401) {
                // @ts-ignore
                setStatus(String(e.message || 'Sign-in required'));
            } else {
                setStatus('Error retrieving results. Please try again later.');
            }
        }
    }

    async function searchByNameInSet(expansionId, expansionName, seriesName, pokemonName) {
        activateDexSearchMode();
        const id = String(expansionId || '').trim();
        const setName = String(expansionName || '').trim();
        const setSeries = String(seriesName || '').trim();
        const name = String(pokemonName || '').trim();

        if (!id) {
            setStatus('Please choose a set first.');
            return;
        }
        if (!name) {
            setStatus('Enter a Pokemon name to search within the selected set.');
            return;
        }

        resetDexSetBrowseState();

        const base = getWorkerBase();
        const queryCandidates = buildNameQueryCandidates(name).slice(0, 3);
        const expansionClauses = [`expansion.id:${id}`, `expansion_id:${id}`, `expansion:${id}`];

        setStatus(`Searching ${name} in ${setName || id}...`);
        if (grid) {
            grid.innerHTML = '';
            for (let i = 0; i < 8; i++) {
                const col = document.createElement('div');
                col.className = 'col-6 col-sm-6 col-md-4 col-lg-3';
                col.innerHTML = '<div class="pv-card" style="height:260px"><div class="pv-skeleton" style="height:100%"></div></div>';
                grid.appendChild(col);
            }
        }

        try {
            let cards = [];
            let usedFallback = false;
            let matchedQuery = '';
            let hasMore = false;

            // Try documented nested-field filter first, then compatibility fallbacks.
            for (let eIdx = 0; eIdx < expansionClauses.length; eIdx++) {
                const expansionClause = expansionClauses[eIdx];
                const namesToTry = eIdx === 0 ? queryCandidates : queryCandidates.slice(0, 1);
                for (let nIdx = 0; nIdx < namesToTry.length; nIdx++) {
                    const nameClause = namesToTry[nIdx];
                    const q = `${expansionClause} ${nameClause}`;
                    const page1 = await fetchCardsSearchPage(base, q, 1, NAME_SEARCH_PAGE_SIZE);
                    if (page1.cards.length) {
                        cards = page1.cards;
                        matchedQuery = q;
                        hasMore = page1.hasMore;
                        usedFallback = nIdx > 0 || eIdx > 0;
                        break;
                    }
                }
                if (cards.length) break;
            }

            renderCards(cards);

            const label = setSeries ? `${setSeries} • ${setName || id}` : (setName || id);
            const fallbackNote = usedFallback && cards.length ? ' Closest matches shown.' : '';
            const limitNote = hasMore ? ' Showing first 15. Load More for more.' : '';
            const statusText = `${cards.length} result${cards.length !== 1 ? 's' : ''} for "${name}" in "${label}".${limitNote}${fallbackNote}`;
            setStatus(statusText);

            saveLastResults({
                savedAt: Date.now(),
                mode: 'setName',
                query: name,
                cards,
                statusText,
                expansionId: id,
                expansionName: setName,
                expansionSeries: setSeries,
                selections: (() => {
                    const prev = loadLastResults();
                    return (prev?.selections && typeof prev.selections === 'object') ? prev.selections : {};
                })(),
            });

            if (matchedQuery) {
                dexSetBrowseState = {
                    active: true,
                    mode: 'setName',
                    query: name,
                    expansionId: id,
                    expansionName: setName,
                    expansionSeries: setSeries,
                    queryCandidates,
                    matchedQuery,
                    nextPage: 2,
                    pageSize: NAME_SEARCH_PAGE_SIZE,
                    cards: cards.slice(),
                    hasMore,
                };
                setLoadMoreState(hasMore, false);
            }
        } catch (e) {
            console.warn('[PokeValutor] set+name search error', e);
            renderCards([]);
            resetDexSetBrowseState();
            if (isQuotaExceededError(e)) {
                setStatusAndHideIfQuotaError(e);
            } else if (e && typeof e === 'object' && 'status' in e && Number(e.status) === 401) {
                // @ts-ignore
                setStatus(String(e.message || 'Sign-in required'));
            } else {
                setStatus('Error retrieving set results. Please try again later.');
            }
        }
    }

    async function searchByPrintedNumber(printedNumber) {
        activateDexSearchMode();
        const pn = (printedNumber || '').trim();
        if (!pn) {
            setStatus('Please enter a printed card number (e.g., 87/160 or SWSH101).');
            renderCards([]);
            return;
        }
        resetDexSetBrowseState();
        const base = getWorkerBase();

        // Number searches are high-collision (many sets share the same number),
        // so show more results than name searches.
        const RESULT_LIMIT = NUMBER_SEARCH_PAGE_SIZE;

        function normalizeSimpleDigits(raw) {
            const s = String(raw || '').trim();
            if (!/^\d+$/.test(s)) return s;
            // Strip leading zeros but keep at least one digit.
            return s.replace(/^0+(?=\d)/, '');
        }

        function padLeftZeros(value, width) {
            const s = String(value || '').trim();
            if (!/^\d+$/.test(s)) return s;
            if (s.length >= width) return s;
            return s.padStart(width, '0');
        }

        function normalizeSimplePrintedFraction(raw) {
            // Handle common input like "109/094" by stripping leading zeros only
            // when both sides are purely numeric.
            const s = String(raw || '').trim();
            const m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
            if (!m) return s;
            const left = String(m[1]).replace(/^0+(?=\d)/, '');
            const right = String(m[2]).replace(/^0+(?=\d)/, '');
            return `${left}/${right}`;
        }

        function buildPrintedFractionCandidates(raw) {
            const s = String(raw || '').trim();
            const m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
            if (!m) return [];

            const leftRaw = String(m[1] || '').trim();
            const rightRaw = String(m[2] || '').trim();
            const left = String(leftRaw).replace(/^0+(?=\d)/, '') || '0';
            const right = String(rightRaw).replace(/^0+(?=\d)/, '') || '0';

            const out = [];
            const seen = new Set();

            function push(v) {
                const key = String(v || '').trim();
                if (!key || seen.has(key)) return;
                seen.add(key);
                out.push(key);
            }

            // Keep exact user format first.
            push(`${leftRaw}/${rightRaw}`);

            // Always try fully padded retry as many cards are indexed as XXX/YYY.
            const rightPad3 = padLeftZeros(right, 3);
            const leftPad3 = padLeftZeros(left, 3);
            push(`${leftPad3}/${rightPad3}`);

            // Then try right-side set-total padding (common source of misses).
            push(`${left}/${rightPad3}`);

            // Finally try fully normalized no-leading-zero form.
            push(`${left}/${right}`);

            return out;
        }

        setStatus('Searching…');
        if (grid) {
            grid.innerHTML = '';
            for (let i = 0; i < Math.min(RESULT_LIMIT, 12); i++) {
                const col = document.createElement('div');
                col.className = 'col-6 col-sm-6 col-md-4 col-lg-3';
                col.innerHTML = '<div class="pv-card" style="height:260px"><div class="pv-skeleton" style="height:100%"></div></div>';
                grid.appendChild(col);
            }
        }

        try {
            // Scrydex query: use printed_number:<value>
            // NOTE: Some promos (e.g., svp-52 with printedNumber "052") are not discoverable via
            // printed_number/printedNumber field queries.
            // Empirically, promos are discoverable via: rarity:Promo number:<value>

            function mergeUniqueById(target, next) {
                if (!Array.isArray(next) || next.length === 0) return;
                const seen = new Set(target.map((c) => String(c?.id || '')));
                for (const c of next) {
                    const id = String(c?.id || '');
                    if (!id || seen.has(id)) continue;
                    seen.add(id);
                    target.push(c);
                }
            }

            const candidates = [];

            // 1) Exact input first.
            candidates.push(pn);

            // 2) Try fraction permutations (leading-zero preserving first).
            const fractionCandidates = buildPrintedFractionCandidates(pn);
            for (const fc of fractionCandidates) {
                if (fc && !candidates.includes(fc)) {
                    candidates.push(fc);
                }
            }

            // 2b) Keep stripped fraction fallback last.
            const normalizedFraction = normalizeSimplePrintedFraction(pn);
            if (normalizedFraction && normalizedFraction !== pn && !candidates.includes(normalizedFraction)) {
                candidates.push(normalizedFraction);
            }

            // 3) For promos (e.g., SVP 052), retry numeric forms with/without padding.
            if (/^\d+$/.test(pn)) {
                const stripped = normalizeSimpleDigits(pn);
                if (stripped && stripped !== pn) candidates.push(stripped);

                // Many promos use 3-digit printed numbers (e.g., 52 -> 052).
                const padded3 = padLeftZeros(stripped || pn, 3);
                if (padded3 && !candidates.includes(padded3)) candidates.push(padded3);
            }

            // De-duplicate while preserving order.
            const tried = new Set();
            const uniqueCandidates = candidates.filter((c) => {
                const key = String(c || '').trim();
                if (!key) return false;
                if (tried.has(key)) return false;
                tried.add(key);
                return true;
            });

            /** @type {Array<any>} */
            let cards = [];

            const numberCandidate = (() => {
                if (/^\d+$/.test(pn)) return normalizeSimpleDigits(pn);
                return pn;
            })();

            function normalizePrintedNumberForCompare(raw) {
                const text = String(raw || '').trim();
                if (!text) return '';
                if (text.includes('/')) return normalizeSimplePrintedFraction(text).toUpperCase();
                if (/^\d+$/.test(text)) return normalizeSimpleDigits(text);
                return text.toUpperCase();
            }

            function hasExactNumberMatch(list, candidate) {
                const wanted = normalizePrintedNumberForCompare(candidate);
                if (!wanted) return false;
                return (Array.isArray(list) ? list : []).some((card) => {
                    const rawNumber = card?.printedNumber ?? card?.printed_number ?? card?.number;
                    const normalized = normalizePrintedNumberForCompare(rawNumber);
                    return normalized === wanted;
                });
            }

            function hasExactIdMatch(list, candidateId) {
                const wanted = String(candidateId || '').trim().toLowerCase();
                if (!wanted) return false;
                return (Array.isArray(list) ? list : []).some((card) => String(card?.id || '').trim().toLowerCase() === wanted);
            }

            // 1) Promo-first: promos are easy to crowd out by other sets sharing the same number.
            // Use a larger page, sort, then merge into the top of results.
            if (numberCandidate && !String(numberCandidate).includes('/')) {
                const promoQ = `rarity:Promo ${buildFieldQuery('number', numberCandidate)}`;
                const promoUrl = `${base}/cards/search?q=${encodeURIComponent(promoQ)}&page=1&pageSize=25&lang=en&consumeQuota=1`;
                const promoData = await fetchJsonWithCache(promoUrl, SEARCH_TTL_MS);
                const promoFound = Array.isArray(promoData?.data) ? promoData.data : [];
                promoFound.sort((a, b) => String(a?.id || '').localeCompare(String(b?.id || '')));
                mergeUniqueById(cards, promoFound);
            }

            // 2) printed_number search (works for most non-promo cards, and fractions).
            // Keep trying candidates until we find an exact normalized number match,
            // so inputs like "94/165" can still resolve cards stored as "094/165".
            let matchedPn = pn;
            for (const attempt of uniqueCandidates) {
                const q = buildFieldQuery('printed_number', attempt);
                const url = `${base}/cards/search?q=${encodeURIComponent(q)}&page=1&pageSize=${RESULT_LIMIT}&lang=en&consumeQuota=1`;
                const data = await fetchJsonWithCache(url, SEARCH_TTL_MS);
                const found = Array.isArray(data?.data) ? data.data : [];
                if (found.length) {
                    mergeUniqueById(cards, found);
                    if (hasExactNumberMatch(found, pn) || hasExactNumberMatch(found, attempt)) {
                        matchedPn = attempt;
                        break;
                    }
                }
            }

            // 3) number:<value> fallback (covers promo codes like SWSH020 and many regular sets).
            // Run only if current results do not already include an exact number match.
            if (numberCandidate && !String(numberCandidate).includes('/') && !hasExactNumberMatch(cards, numberCandidate)) {
                const numberQ = buildFieldQuery('number', numberCandidate);
                const numberUrl = `${base}/cards/search?q=${encodeURIComponent(numberQ)}&page=1&pageSize=${RESULT_LIMIT}&lang=en&consumeQuota=1`;
                const numberData = await fetchJsonWithCache(numberUrl, SEARCH_TTL_MS);
                mergeUniqueById(cards, Array.isArray(numberData?.data) ? numberData.data : []);
            }

            // 4) If the user pasted a card id (e.g., "mep-10"), try id:<value> directly.
            if (/-/.test(pn) && /[A-Za-z]/.test(pn) && !hasExactIdMatch(cards, pn)) {
                const idQ = buildFieldQuery('id', pn);
                const idUrl = `${base}/cards/search?q=${encodeURIComponent(idQ)}&page=1&pageSize=${RESULT_LIMIT}&lang=en&consumeQuota=1`;
                const idData = await fetchJsonWithCache(idUrl, SEARCH_TTL_MS);
                mergeUniqueById(cards, Array.isArray(idData?.data) ? idData.data : []);
            }

            // Rank exact normalized printed-number matches first so the most relevant
            // card(s) are visible even when broader candidate queries also return data.
            const wantedPrinted = normalizePrintedNumberForCompare(pn);
            if (wantedPrinted) {
                cards.sort((a, b) => {
                    const aRaw = a?.printedNumber ?? a?.printed_number ?? a?.number;
                    const bRaw = b?.printedNumber ?? b?.printed_number ?? b?.number;
                    const aExact = normalizePrintedNumberForCompare(aRaw) === wantedPrinted ? 1 : 0;
                    const bExact = normalizePrintedNumberForCompare(bRaw) === wantedPrinted ? 1 : 0;
                    if (aExact !== bExact) return bExact - aExact;
                    return String(a?.id || '').localeCompare(String(b?.id || ''));
                });
            }

            // Respect UI limit.
            if (cards.length > RESULT_LIMIT) cards = cards.slice(0, RESULT_LIMIT);
            renderCards(cards);
            const matchedNote = matchedPn !== pn ? ` Matched as "${matchedPn}".` : '';
            const statusText = `${cards.length} result${cards.length !== 1 ? 's' : ''} for printed number "${pn}".${matchedNote}`;
            setStatus(statusText);

            saveLastResults({
                savedAt: Date.now(),
                mode: 'number',
                query: pn,
                cards,
                statusText,
                selections: (() => {
                    const prev = loadLastResults();
                    return (prev?.selections && typeof prev.selections === 'object') ? prev.selections : {};
                })(),
            });

            setLoadMoreState(false, false);
        } catch (e) {
            console.warn('[PokeValutor] printed number search error', e);
            renderCards([]);
            resetDexSetBrowseState();
            if (isQuotaExceededError(e)) {
                setStatusAndHideIfQuotaError(e);
            } else if (e && typeof e === 'object' && 'status' in e && Number(e.status) === 401) {
                // @ts-ignore
                setStatus(String(e.message || 'Sign-in required'));
            } else {
                setStatus('Error retrieving results. Please try again later.');
            }
        }
    }

    function mergeUniqueCardsById(target, next) {
        if (!Array.isArray(target) || !Array.isArray(next) || !next.length) return target || [];
        const out = Array.isArray(target) ? target.slice() : [];
        const seen = new Set(out.map((c) => String(c?.id || '')));
        for (const c of next) {
            const id = String(c?.id || '');
            if (!id || seen.has(id)) continue;
            seen.add(id);
            out.push(c);
        }
        return out;
    }

    async function fetchCardsSearchPage(base, query, page, pageSize) {
        const url = `${base}/cards/search?q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}&lang=en&consumeQuota=1`;
        const data = await fetchJsonWithCache(url, SEARCH_TTL_MS);
        const cards = Array.isArray(data?.data) ? data.data : [];
        const totalCount = Number(data?.totalCount || cards.length);
        const pageNum = Number(data?.page || page);
        const pageSizeNum = Number(data?.pageSize || pageSize);

        const hasMore = Number.isFinite(totalCount)
            ? (pageNum * pageSizeNum) < totalCount
            : cards.length >= pageSize;

        return { cards, hasMore };
    }

    async function searchTopByExpansion(expansionId, expansionName) {
        activateDexSearchMode();
        const id = String(expansionId || '').trim();
        const name = String(expansionName || '').trim();
        if (!id) return;

        resetDexSetBrowseState();

        const base = getWorkerBase();
        const RESULT_LIMIT = 10;

        setStatus(`Loading top cards for ${name || id}…`);

        // Clear inputs so manual searching doesn't feel blocked.
        clearSearchInputs();

        if (grid) {
            grid.innerHTML = '';
            for (let i = 0; i < RESULT_LIMIT; i++) {
                const col = document.createElement('div');
                col.className = 'col-6 col-sm-6 col-md-4 col-lg-3';
                col.innerHTML = '<div class="pv-card" style="height:260px"><div class="pv-skeleton" style="height:100%"></div></div>';
                grid.appendChild(col);
            }
        }

        try {
            // This endpoint is designed to be cache-heavy (Worker + optional Upstash)
            // to avoid repeated API credit usage.
            const url = `${base}/cards/top-by-expansion?expansionId=${encodeURIComponent(id)}&limit=${RESULT_LIMIT}&lang=en`;
            const data = await fetchJsonWithCache(url, SEARCH_TTL_MS);
            const cards = Array.isArray(data?.data) ? data.data : [];
            renderCards(cards);

            const label = name || id;
            const statusText = `${cards.length} top card${cards.length !== 1 ? 's' : ''} by market value for "${label}".`;
            setStatus(statusText);

            saveLastResults({
                savedAt: Date.now(),
                mode: 'expansion',
                query: id,
                cards,
                statusText,
                expansionId: id,
                expansionName: name,
                selections: (() => {
                    const prev = loadLastResults();
                    return (prev?.selections && typeof prev.selections === 'object') ? prev.selections : {};
                })(),
            });
        } catch (e) {
            console.warn('[PokeValutor] expansion top search error', e);
            renderCards([]);
            if (isQuotaExceededError(e)) {
                setStatusAndHideIfQuotaError(e);
            } else if (e && typeof e === 'object' && 'status' in e && Number(e.status) === 401) {
                // @ts-ignore
                setStatus(String(e.message || 'Sign-in required'));
            } else {
                setStatus('Error retrieving expansion results. Please try again later.');
            }
        }
    }

    async function searchByExpansionSet(expansionId, expansionName, seriesName) {
        activateDexSearchMode();
        const id = String(expansionId || '').trim();
        const setName = String(expansionName || '').trim();
        const setSeries = String(seriesName || '').trim();
        if (!id) {
            setStatus('Please choose a set.');
            return;
        }

        const base = getWorkerBase();
        setStatus(`Loading cards from ${setName || id}...`);

        clearSearchInputs();
        resetDexSetBrowseState();

        if (grid) {
            grid.innerHTML = '';
            for (let i = 0; i < 10; i++) {
                const col = document.createElement('div');
                col.className = 'col-6 col-sm-6 col-md-4 col-lg-3';
                col.innerHTML = '<div class="pv-card" style="height:260px"><div class="pv-skeleton" style="height:100%"></div></div>';
                grid.appendChild(col);
            }
        }

        try {
            const queryCandidates = [
                `expansion.id:${id}`,
                `expansion_id:${id}`,
                `expansion:${id}`,
            ];

            let matchedQuery = '';
            /** @type {Array<any>} */
            let cards = [];
            let hasMore = false;

            for (const query of queryCandidates) {
                const page1 = await fetchCardsSearchPage(base, query, 1, SET_SEARCH_PAGE_SIZE);
                if (page1.cards.length) {
                    matchedQuery = query;
                    cards = mergeUniqueCardsById(cards, page1.cards);
                    hasMore = page1.hasMore;
                    break;
                }
            }

            renderCards(cards);

            const label = setSeries ? `${setSeries} • ${setName || id}` : (setName || id);
            const statusText = `${cards.length} card${cards.length !== 1 ? 's' : ''} in set "${label}".`;
            setStatus(statusText);

            saveLastResults({
                savedAt: Date.now(),
                mode: 'set',
                query: id,
                cards,
                statusText,
                expansionId: id,
                expansionName: setName,
                expansionSeries: setSeries,
                selections: (() => {
                    const prev = loadLastResults();
                    return (prev?.selections && typeof prev.selections === 'object') ? prev.selections : {};
                })(),
            });

            if (matchedQuery) {
                dexSetBrowseState = {
                    active: true,
                    mode: 'set',
                    query: id,
                    expansionId: id,
                    expansionName: setName,
                    expansionSeries: setSeries,
                    queryCandidates,
                    matchedQuery,
                    nextPage: 2,
                    pageSize: SET_SEARCH_PAGE_SIZE,
                    cards: cards.slice(),
                    hasMore,
                };
                setLoadMoreState(hasMore, false);
            }
        } catch (e) {
            console.warn('[PokeValutor] set search error', e);
            renderCards([]);
            resetDexSetBrowseState();
            if (isQuotaExceededError(e)) {
                setStatusAndHideIfQuotaError(e);
            } else if (e && typeof e === 'object' && 'status' in e && Number(e.status) === 401) {
                // @ts-ignore
                setStatus(String(e.message || 'Sign-in required'));
            } else {
                setStatus('Error retrieving set cards. Please try again later.');
            }
        }
    }

    async function loadMoreDexSetCards() {
        if (!dexSetBrowseState.active || !dexSetBrowseState.hasMore || !dexSetBrowseState.matchedQuery) {
            setLoadMoreState(false, false);
            return;
        }

        const base = getWorkerBase();
        setLoadMoreState(true, true);

        try {
            const page = dexSetBrowseState.nextPage;
            const next = await fetchCardsSearchPage(base, dexSetBrowseState.matchedQuery, page, dexSetBrowseState.pageSize);

            const merged = mergeUniqueCardsById(dexSetBrowseState.cards, next.cards);
            dexSetBrowseState.cards = merged;
            dexSetBrowseState.nextPage = page + 1;
            dexSetBrowseState.hasMore = next.hasMore;

            const restored = loadLastResults();
            renderCards(merged, restored || undefined);

            const mode = String(dexSetBrowseState.mode || '');
            let statusText = `${merged.length} card${merged.length !== 1 ? 's' : ''} loaded.`;

            if (mode === 'name') {
                statusText = `${merged.length} result${merged.length !== 1 ? 's' : ''} for "${dexSetBrowseState.query}".`;
            } else if (mode === 'setName') {
                const label = dexSetBrowseState.expansionSeries
                    ? `${dexSetBrowseState.expansionSeries} • ${dexSetBrowseState.expansionName || dexSetBrowseState.expansionId}`
                    : (dexSetBrowseState.expansionName || dexSetBrowseState.expansionId);
                statusText = `${merged.length} result${merged.length !== 1 ? 's' : ''} for "${dexSetBrowseState.query}" in set "${label}".`;
            } else if (mode === 'set') {
                const label = dexSetBrowseState.expansionSeries
                    ? `${dexSetBrowseState.expansionSeries} • ${dexSetBrowseState.expansionName || dexSetBrowseState.expansionId}`
                    : (dexSetBrowseState.expansionName || dexSetBrowseState.expansionId);
                statusText = `${merged.length} card${merged.length !== 1 ? 's' : ''} loaded for set "${label}".`;
            }
            setStatus(statusText);

            const saveMode = mode === 'setName' ? 'setName' : (mode === 'set' ? 'set' : 'name');
            const saveQuery = mode === 'set' ? dexSetBrowseState.expansionId : dexSetBrowseState.query;
            saveLastResults({
                savedAt: Date.now(),
                mode: saveMode,
                query: saveQuery,
                cards: merged,
                statusText,
                expansionId: dexSetBrowseState.expansionId,
                expansionName: dexSetBrowseState.expansionName,
                expansionSeries: dexSetBrowseState.expansionSeries,
                selections: (() => {
                    const prev = loadLastResults();
                    return (prev?.selections && typeof prev.selections === 'object') ? prev.selections : {};
                })(),
            });

            setLoadMoreState(dexSetBrowseState.hasMore, false);
        } catch (e) {
            console.warn('[PokeValutor] dex load more error', e);
            setLoadMoreState(true, false);
            if (isQuotaExceededError(e)) {
                setStatusAndHideIfQuotaError(e);
            } else {
                setStatus('Unable to load more cards right now. Please try again.');
            }
        }
    }

    if (form && input) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (isDexPage) {
                activateDexSearchMode();
            }
            const query = safeString(input?.value, '').trim();
            const bySetId = isSeriesSetFiltersVisible() ? safeString(setSelect?.value, '').trim() : '';

            if (!query) {
                setStatus('Please enter a Pokemon name or card number.');
                renderCards([]);
                return;
            }

            if (isLikelyCardNumberQuery(query)) {
                void searchByPrintedNumber(query);
                return;
            }

            if (bySetId) {
                const selected = getSelectedExpansionFromFilter();
                const selectedName = safeString(selected?.name, '');
                const selectedSeries = safeString(selected?.series, '');
                void searchByNameInSet(bySetId, selectedName, selectedSeries, query);
                return;
            }

            void searchByName(query);
        });
    }

    if (isSearchPage && form && seriesSetToggle) {
        seriesSetToggle.checked = loadSeriesSetVisibilityPreference();
        applySeriesSetVisibilityUi(true);

        seriesSetToggle.addEventListener('change', () => {
            applySeriesSetVisibilityUi(false);
        });

        window.addEventListener('resize', () => {
            applySeriesSetVisibilityUi(true);
        });
    }

    if (seriesSelect) {
        const onSeriesFocus = () => {
            void ensureExpansionCatalogLoaded().catch((e) => {
                console.warn('[PokeValutor] expansions load error', e);
            });
        };

        seriesSelect.addEventListener('focus', onSeriesFocus, { once: true });
        seriesSelect.addEventListener('pointerdown', onSeriesFocus, { once: true });

        seriesSelect.addEventListener('change', () => {
            const series = safeString(seriesSelect.value, '');
            renderSetOptionsForSeries(series, '');
            saveSetFilterState(series, '');
        });
    }

    if (setSelect) {
        const onSetFocus = () => {
            void ensureExpansionCatalogLoaded().catch((e) => {
                console.warn('[PokeValutor] expansions load error', e);
            });
        };

        setSelect.addEventListener('focus', onSetFocus, { once: true });
        setSelect.addEventListener('pointerdown', onSetFocus, { once: true });

        setSelect.addEventListener('change', () => {
            const series = safeString(seriesSelect?.value, '');
            const expansionId = safeString(setSelect.value, '');
            saveSetFilterState(series, expansionId);
        });
    }

    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', () => {
            void loadMoreDexSetCards();
        });
    }

    bindSearchSortControls();

    function setConditionTipOpen(isOpen) {
        if (!conditionTipEl) return;
        if (isOpen) {
            conditionTipEl.classList.add('is-open');
            conditionTipEl.setAttribute('aria-expanded', 'true');
        } else {
            conditionTipEl.classList.remove('is-open');
            conditionTipEl.setAttribute('aria-expanded', 'false');
        }
    }

    if (conditionTipEl && conditionTipEl.getAttribute('data-bound') !== '1') {
        conditionTipEl.setAttribute('data-bound', '1');

        const toggleConditionTip = (event) => {
            event.preventDefault();
            event.stopPropagation();
            setConditionTipOpen(!conditionTipEl.classList.contains('is-open'));
        };

        conditionTipEl.addEventListener('click', toggleConditionTip);
        conditionTipEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                toggleConditionTip(event);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setConditionTipOpen(false);
            }
        });

        document.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (!conditionTipEl.contains(target)) {
                setConditionTipOpen(false);
            }
        });
    }

    renderSearchCollectionContext(readCollectionContextMetaLocal());
    setSearchCollectionContextVisible(false);

    if (searchCollectionSelectEl && searchCollectionSelectEl.getAttribute('data-bound') !== '1') {
        searchCollectionSelectEl.setAttribute('data-bound', '1');
        searchCollectionSelectEl.addEventListener('change', () => {
            void switchActiveCollectionContext(searchCollectionSelectEl.value);
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

    if (isDexPage && dexSearchPanel) {
        setDexSearchPanelOpen(loadDexSearchPanelOpenState(), { skipPersist: true });

        if (dexSearchPanel.getAttribute('data-bound') !== '1') {
            dexSearchPanel.setAttribute('data-bound', '1');
            dexSearchPanel.addEventListener('toggle', () => {
                saveDexSearchPanelOpenState(!!dexSearchPanel.open);
            });
        }
    }

    function clearResultsUI() {
        if (grid) grid.innerHTML = '';
        if (status) status.textContent = '';
        currentResultsCards = [];
        for (const key of Object.keys(searchValueById)) {
            delete searchValueById[key];
        }
        resetDexSetBrowseState();
    }

    if (conditionCheckboxEls.length) {
        syncConditionFilterUI();

        window.addEventListener('resize', () => {
            syncConditionFilterUI();
        });

        for (const cb of conditionCheckboxEls) {
            cb.addEventListener('change', (event) => {
                const target = /** @type {HTMLInputElement|null} */ (event.currentTarget);
                if (!target) return;

                const key = String(target.value || '').trim().toUpperCase();
                if (!CONDITION_FILTER_KEYS.includes(key)) return;

                if (target.checked) {
                    selectedConditionFilters.add(key);
                } else {
                    selectedConditionFilters.delete(key);
                }

                // Always keep at least one option selected.
                if (selectedConditionFilters.size === 0) {
                    selectedConditionFilters.add(DEFAULT_CONDITION_FILTER_KEY);
                }

                saveConditionFilterSet(selectedConditionFilters);
                syncConditionFilterUI();
                applyConditionFilterToVisibleCards();
            });
        }
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            clearResultsUI();
            clearLastResults();

            // If the page was deep-linked (top-by-expansion), also remove query params
            // so a reload doesn't immediately re-run the expansion flow.
            try {
                if (window.location.search) {
                    const nextUrl = window.location.pathname;
                    window.history.replaceState(null, '', nextUrl);
                }
            } catch {
                // ignore
            }

            // Also clear any cached top-by-expansion responses so a bad response can't linger.
            purgeUrlCacheEntries((u) => String(u || '').includes('/cards/top-by-expansion'));

            clearSearchInputs();

            if (isDexPage) {
                setDexSearchPanelOpen(false);
                setResultsHeading('Search Results');
                setDexResultsContext('Search and add cards to your collection.');
            }
        });
    }

    bindFavoritesSortControls();

    // Render Favorites immediately (persisted across refresh).
    renderFavorites(loadLastResults() || undefined);

    // Favorites collapsible behavior (persisted across refresh).
    if (favoritesToggle) {
        favoritesToggle.addEventListener('click', () => {
            const currentlyCollapsed = !!favoritesBody?.hidden;
            setFavoritesCollapsed(!currentlyCollapsed);
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

    let deepLinkExpansionId = '';
    let deepLinkExpansionName = '';
    try {
        const params = new URLSearchParams(window.location.search || '');
        deepLinkExpansionId = params.get('expansionId') || '';
        deepLinkExpansionName = params.get('expansionName') || '';
    } catch {
        // ignore
    }

    if (isDexPage) {
        setResultsHeading('Search Results');
        setDexResultsContext('Search and add cards to your collection.');

        if (deepLinkExpansionId) {
            void searchTopByExpansion(deepLinkExpansionId, deepLinkExpansionName);
        } else {
            clearResultsUI();
        }
    } else {
        // Restore last results after refresh.
        try {
            const restored = loadLastResults();
            if (restored && Array.isArray(restored.cards) && restored.cards.length) {
                const restoredCards = restored.cards.length > MAX_RESTORE_RENDER_CARDS
                    ? restored.cards.slice(0, MAX_RESTORE_RENDER_CARDS)
                    : restored.cards;
                const restoredView = restoredCards === restored.cards
                    ? restored
                    : { ...restored, cards: restoredCards };

                if (restored.mode === 'name' && input) input.value = String(restored.query || '');
                if (restored.mode === 'number' && input) input.value = String(restored.query || '');
                if (restored.mode === 'setName' && input) input.value = String(restored.query || '');
                if (restored.mode === 'set' && restored.expansionId) {
                    pendingRestoredExpansionId = String(restored.expansionId || '');
                    void ensureExpansionCatalogLoaded().catch((e) => {
                        console.warn('[PokeValutor] expansions load error', e);
                    });
                }
                if (restored.mode === 'setName' && restored.expansionId) {
                    pendingRestoredExpansionId = String(restored.expansionId || '');
                    void ensureExpansionCatalogLoaded().catch((e) => {
                        console.warn('[PokeValutor] expansions load error', e);
                    });
                }
                renderCards(restoredCards, restoredView);
                renderFavorites(restoredView);

                if (restored.cards.length > restoredCards.length) {
                    setStatus(`Restored ${restoredCards.length} of ${restored.cards.length} previous results to keep this page responsive.`);
                } else if (restored.statusText) {
                    setStatus(String(restored.statusText));
                }
            }
        } catch (error) {
            console.error('[PokeValutor] failed to restore previous results', error);
            clearLastResults();
            if (grid) grid.innerHTML = '';
            currentResultsCards = [];
            setStatus('Previous results cache was reset. Search again to continue.');
        }

        // Deep-link support: /search.html?expansionId=...&expansionName=...
        if (deepLinkExpansionId) {
            void searchTopByExpansion(deepLinkExpansionId, deepLinkExpansionName);
        }
    }

    if (startupStatusNotice) {
        setStatus(startupStatusNotice);
    }

    if (scrollTopBtn) {
        scrollTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

});

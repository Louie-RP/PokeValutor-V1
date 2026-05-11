/* Scrydex-backed Search page behavior */
document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('pv-search-form');
    const input = /** @type {HTMLInputElement} */(document.getElementById('pv-search-query'));
    const seriesSelect = /** @type {HTMLSelectElement|null} */(document.getElementById('pv-search-series'));
    const setSelect = /** @type {HTMLSelectElement|null} */(document.getElementById('pv-search-set'));
    const loadMoreBtn = /** @type {HTMLButtonElement|null} */(document.getElementById('pv-search-load-more'));
    const status = document.getElementById('pv-search-status');
    const grid = document.getElementById('pv-search-grid');
    const favoritesGrid = document.getElementById('pv-favorites-grid');
    const favoritesBody = document.getElementById('pv-favorites-body');
    const favoritesToggle = document.getElementById('pv-favorites-toggle');
    const favoritesClearBtn = document.getElementById('pv-favorites-clear');
    const favoritesTotalsEl = document.getElementById('pv-favorites-totals');
    const scrollTopBtn = document.getElementById('pv-scroll-top');
    const clearBtn = document.getElementById('pv-clear-results');
    const searchSortNameBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('pv-search-sort-name'));
    const searchSortValueBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('pv-search-sort-value'));
    const conditionSummaryEl = document.getElementById('pv-condition-summary');
    const conditionCheckboxEls = /** @type {HTMLInputElement[]} */ (Array.from(document.querySelectorAll('input[name="pv-condition-filter"]')));

    const quotaBanner = document.getElementById('pv-quota-banner');
    const quotaMessageEl = document.getElementById('pv-quota-message');
    const quotaCtaEl = /** @type {HTMLAnchorElement|null} */ (document.getElementById('pv-quota-cta'));

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

    const QUOTA_STORAGE_KEY = 'pv:quota:last:v1';
    const SET_FILTER_STATE_KEY = `${CACHE_PREFIX}setFilterState:v1`;

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
    const TRADE_PERCENT_MAP_KEY = `${CACHE_PREFIX}tradePercentById:v1`;
    const CONDITION_FILTER_KEY = `${CACHE_PREFIX}conditionFilter:v1`;

    const CONDITION_FILTER_KEYS = ['NM', 'LP', 'MP', 'OTHER'];
    const DEFAULT_CONDITION_FILTERS = ['NM'];

    const PV_BUILD = '2026-05-09-1';
    const isDexPage = document.body?.id === 'pv-dex-body';
    try {
        if (localStorage.getItem('pv:debug') === '1') {
            console.info('[PokeValutor] search.js build', PV_BUILD);
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

    /** @type {Record<string, number>} */
    const searchValueById = {};

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

    function toConditionFilterKey(conditionKey) {
        const key = String(conditionKey || '').trim().toUpperCase();
        if (key === 'NM' || key === 'LP' || key === 'MP') return key;
        return 'OTHER';
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

    function getConditionSummaryText() {
        const labels = CONDITION_FILTER_KEYS
            .filter((k) => selectedConditionFilters.has(k))
            .map((k) => (k === 'OTHER' ? 'Other' : k));
        if (!labels.length) return 'NM';

        const isMobile = window.matchMedia('(max-width: 575.98px)').matches;
        const maxVisible = isMobile ? 1 : 3;

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
        return selectedConditionFilters.has(filterKey);
    }

    function applyConditionFilterToVisibleCards() {
        const restoredState = loadLastResults();
        renderCards(currentResultsCards, restoredState || undefined);
        renderFavorites(restoredState || undefined);
    }

    function clearSearchInputs() {
        if (input) input.value = '';
    }

    function getSearchNameSortLabel() {
        return searchSortState.nameDir === 'asc' ? 'Name: A-Z' : 'Name: Z-A';
    }

    function getSearchValueSortLabel() {
        return searchSortState.valueDir === 'desc' ? 'Value: High-Low' : 'Value: Low-High';
    }

    function updateSearchSortUi() {
        if (searchSortNameBtn) {
            searchSortNameBtn.textContent = getSearchNameSortLabel();
            const active = searchSortState.active === 'name';
            searchSortNameBtn.classList.toggle('is-active', active);
            searchSortNameBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
        }

        if (searchSortValueBtn) {
            searchSortValueBtn.textContent = getSearchValueSortLabel();
            const active = searchSortState.active === 'value';
            searchSortValueBtn.classList.toggle('is-active', active);
            searchSortValueBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
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

            if (!hasA && !hasB) return nameA.localeCompare(nameB);
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
        if (searchSortNameBtn && searchSortNameBtn.getAttribute('data-bound') !== '1') {
            searchSortNameBtn.setAttribute('data-bound', '1');
            searchSortNameBtn.addEventListener('click', () => {
                if (searchSortState.active === 'name') {
                    searchSortState.nameDir = searchSortState.nameDir === 'asc' ? 'desc' : 'asc';
                } else {
                    searchSortState.active = 'name';
                }
                updateSearchSortUi();
                applySearchSortToGrid();
            });
        }

        if (searchSortValueBtn && searchSortValueBtn.getAttribute('data-bound') !== '1') {
            searchSortValueBtn.setAttribute('data-bound', '1');
            searchSortValueBtn.addEventListener('click', () => {
                if (searchSortState.active === 'value') {
                    searchSortState.valueDir = searchSortState.valueDir === 'desc' ? 'asc' : 'desc';
                } else {
                    searchSortState.active = 'value';
                }
                updateSearchSortUi();
                applySearchSortToGrid();
            });
        }

        updateSearchSortUi();
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

        if (!hasA && !hasB) return nameA.localeCompare(nameB);
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

    function normalizeDexCollectionCard(card) {
        const conditionQuantities = normalizeConditionQuantities(card?.conditionQuantities, card?.selectedCondition);
        const selectedCondition = getPrimaryConditionCode(conditionQuantities);
        const totalCopies = getTotalDexConditionCopies(conditionQuantities, selectedCondition);
        const fallbackVariant = getDexDefaultVariantForCard(card);
        const variantQuantities = normalizeVariantQuantities(card?.variantQuantities, fallbackVariant, totalCopies);
        const selectedVariant = getPrimaryVariantName(variantQuantities, fallbackVariant);
        const addedAtRaw = Number(card?.addedAt || 0);
        const updatedAtRaw = Number(card?.updatedAt || 0);
        return {
            id: safeString(card?.id, ''),
            name: safeString(card?.name, 'Unknown'),
            rarity: safeString(card?.rarity, ''),
            expansion: (card?.expansion && typeof card.expansion === 'object') ? card.expansion : null,
            set: (card?.set && typeof card.set === 'object') ? card.set : null,
            images: Array.isArray(card?.images) ? card.images : [],
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
            const raw = localStorage.getItem(DEX_COLLECTION_KEY);
            if (!raw) return [];
            const parsed = safeParseJson(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter((x) => x && typeof x === 'object' && x.id)
                .map((x) => normalizeDexCollectionCard(x));
        } catch {
            return [];
        }
    }

    function saveDexCollection(list, options) {
        try {
            const safe = Array.isArray(list) ? list : [];
            localStorage.setItem(DEX_COLLECTION_KEY, JSON.stringify(safe));
        } catch {
            // ignore
        }

        if (!options?.skipCloudSync) {
            queueDexCloudStateSync(false);
        }
    }

    function loadDexMasterSets() {
        try {
            const raw = localStorage.getItem(DEX_MASTER_SETS_KEY);
            if (!raw) return {};
            const parsed = safeParseJson(raw);
            if (!parsed || typeof parsed !== 'object') return {};
            return normalizeDexMasterSetsMap(parsed);
        } catch {
            return {};
        }
    }

    function saveDexMasterSets(map, options) {
        try {
            const safe = (map && typeof map === 'object') ? map : {};
            localStorage.setItem(DEX_MASTER_SETS_KEY, JSON.stringify(safe));
        } catch {
            // ignore
        }

        if (!options?.skipCloudSync) {
            queueDexCloudStateSync(false);
        }
    }

    const DEX_CLOUD_SYNC_DEBOUNCE_MS = 450;
    let dexCloudSyncTimer = 0;
    let dexCloudSyncHydrating = false;

    function getDexUpdatedAt(value) {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : 0;
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
        if (!isDexPage || dexCloudSyncHydrating) return;
        const authApi = window?.PV_AUTH;
        const user = authApi?.getUser ? authApi.getUser() : null;
        if (!user || !authApi?.saveDexState) return;

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

    function mergeDexCollectionState(localList, cloudList) {
        /** @type {Map<string, any>} */
        const byId = new Map();

        function addCard(raw) {
            const normalized = normalizeDexCollectionCard(raw);
            const id = safeString(normalized?.id, '').trim();
            if (!id) return;

            const existing = byId.get(id);
            if (!existing) {
                byId.set(id, normalized);
                return;
            }

            const existingUpdatedAt = getDexUpdatedAt(existing?.updatedAt);
            const nextUpdatedAt = getDexUpdatedAt(normalized?.updatedAt);
            if (nextUpdatedAt >= existingUpdatedAt) {
                byId.set(id, normalized);
            }
        }

        if (Array.isArray(localList)) {
            for (const item of localList) addCard(item);
        }
        if (Array.isArray(cloudList)) {
            for (const item of cloudList) addCard(item);
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
        if (!isDexPage || !window?.PV_AUTH?.loadDexState) return;

        const localCollection = loadDexCollection();
        const localMasterSets = loadDexMasterSets();
        let mergedPayload = null;
        dexCloudSyncHydrating = true;

        Promise.resolve(window.PV_AUTH.loadDexState())
            .then((cloudState) => {
                const cloudCollection = Array.isArray(cloudState?.collection) ? cloudState.collection : [];
                const cloudMasterSets = (cloudState?.masterSets && typeof cloudState.masterSets === 'object')
                    ? cloudState.masterSets
                    : {};

                const mergedCollection = mergeDexCollectionState(localCollection, cloudCollection);
                const mergedMasterSets = mergeDexMasterSetsState(localMasterSets, cloudMasterSets, mergedCollection);

                saveDexCollection(mergedCollection, { skipCloudSync: true });
                saveDexMasterSets(mergedMasterSets, { skipCloudSync: true });
                mergedPayload = {
                    collection: mergedCollection,
                    masterSets: mergedMasterSets,
                };

                const restoredState = loadLastResults();
                renderCards(currentResultsCards, restoredState || undefined);
            })
            .catch(() => {
                // ignore
            })
            .finally(() => {
                dexCloudSyncHydrating = false;

                if (mergedPayload && window?.PV_AUTH?.saveDexState) {
                    Promise.resolve(window.PV_AUTH.saveDexState(mergedPayload)).catch(() => {
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
        const items = loadDexCollection();
        return items.some((x) => safeString(x?.id, '') === id);
    }

    function addDexCardToTrackers(card) {
        const normalized = normalizeDexCollectionCard(card);
        const id = safeString(normalized.id, '');
        if (!id) return { addedCollection: false, addedMasterSet: false, expansionName: '' };

        const collection = loadDexCollection();
        const existingIndex = collection.findIndex((x) => safeString(x?.id, '') === id);
        const existsInCollection = existingIndex >= 0;
        const addVariantName = safeString(normalized?.selectedVariant, '').trim() || getDexDefaultVariantForCard(normalized);
        if (!existsInCollection) {
            collection.push(normalized);
            saveDexCollection(collection);
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
            saveDexCollection(collection);
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
        };
    }

    function removeDexCardFromTrackers(cardOrId) {
        const id = safeString(cardOrId?.id ?? cardOrId, '');
        if (!id) return { removedCollection: false, removedMasterSet: false, expansionNames: [] };

        const collection = loadDexCollection();
        const nextCollection = collection.filter((x) => safeString(x?.id, '') !== id);
        const removedCollection = nextCollection.length !== collection.length;
        if (removedCollection) {
            saveDexCollection(nextCollection);
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
            saveDexMasterSets(master);
        }

        return { removedCollection, removedMasterSet, expansionNames };
    }

    function removeDexCardCopyFromTrackers(cardOrId, conditionCode, variantName) {
        const id = safeString(cardOrId?.id ?? cardOrId, '');
        if (!id) {
            return { removedCopy: false, removedCard: false, reason: 'invalidId' };
        }

        const code = normalizeDexConditionCode(conditionCode);
        if (!code) {
            return { removedCopy: false, removedCard: false, reason: 'conditionRequired' };
        }

        const collection = loadDexCollection();
        const idx = collection.findIndex((x) => safeString(x?.id, '') === id);
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
        saveDexCollection(collection);

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
        };
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
            const watchRaw = localStorage.getItem(WATCHLIST_KEY);
            if (watchRaw) {
                const watchParsed = safeParseJson(watchRaw);
                addList(watchParsed);
            }

            const legacyRaw = localStorage.getItem(LEGACY_FAVORITES_KEY);
            if (legacyRaw) {
                const legacyParsed = safeParseJson(legacyRaw);
                addList(legacyParsed);
            }

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

    function clearFavorites() {
        favorites = [];
        try { localStorage.removeItem(WATCHLIST_KEY); } catch {}
        try { localStorage.removeItem(LEGACY_FAVORITES_KEY); } catch {}
        const restoredState = loadLastResults();
        renderFavorites(restoredState || undefined);

        // Keep results stars in sync.
        renderCards(currentResultsCards, restoredState || undefined);
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
                if (!user) return;
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
        if (isDexPage && window?.PV_AUTH?.onAuthStateChanged && window?.PV_AUTH?.loadDexState) {
            window.PV_AUTH.onAuthStateChanged((user) => {
                if (!user) return;
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

        if (isFavorite(id)) {
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
    }

    function setStatus(message) {
        if (status) status.textContent = message;
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
        const used = quota.used;
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
                message = isDexPage
                    ? 'Daily guest allowance reached. Sign in to continue (and sync your collection).'
                    : 'Daily guest allowance reached. Sign in to continue (and sync your Watchlist).';
            } else if (remaining != null && remaining <= 2) {
                quotaBanner.classList.add('pv-quotaBanner--warn');
                message = `Guest allowance running low: ${ratioText}. Sign in to increase your daily limit.`;
            } else {
                message = `Guest allowance: ${ratioText}. Sign in to increase your daily limit.`;
            }
        } else if (tier === 'premium' || tier === 'pro') {
            message = hasNumbers ? `Premium allowance: ${ratioText}.` : 'Premium allowance available.';
        } else {
            // free/unknown
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

            // If the Worker isn't sending headers yet, don't change UI.
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
    // This avoids the banner flashing from cached data during Firebase auth hydration.
    try {
        const debug = (() => {
            try { return localStorage.getItem('pv:debug') === '1'; } catch { return false; }
        })();

        if (window?.PV_AUTH?.onAuthStateChanged) {
            window.PV_AUTH.onAuthStateChanged((user) => {
                if (debug) console.info('[PokeValutor] auth state (search)', user ? 'signed-in' : 'signed-out');
                if (user) {
                    forceHideQuotaBanner();
                } else {
                    renderQuotaBanner(loadSavedQuota());
                }
            });
        } else {
            // No auth available: treat as signed out.
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

    async function refreshQuotaBannerForAuthState() {
        try {
            const user = window?.PV_AUTH?.getUser ? window.PV_AUTH.getUser() : null;
            if (!user) {
                renderQuotaBanner(loadSavedQuota());
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

    function loadLastResults() {
        try {
            const raw = localStorage.getItem(LAST_RESULTS_KEY);
            if (!raw) return null;
            const parsed = safeParseJson(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            if (!Array.isArray(parsed.cards)) return null;
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
        if (prev && Array.isArray(prev.cards)) {
            const selections = (prev.selections && typeof prev.selections === 'object') ? prev.selections : {};
            const prevSel = (selections[id] && typeof selections[id] === 'object') ? selections[id] : {};
            selections[id] = { ...prevSel, tradePercent: nextPct };
            saveLastResults({ ...prev, selections });
        }
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
            localStorage.setItem(key, JSON.stringify(payload));
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
        favoritesGrid.innerHTML = '';

        if (!Array.isArray(favorites) || favorites.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'col-12';
            empty.textContent = 'No watchlist items yet. Click ☆ on a result card to save it here.';
            favoritesGrid.appendChild(empty);
            updateFavoritesTotals(restoreState);
            return;
        }

        for (const fav of favorites) {
            const col = document.createElement('div');
            col.className = 'col-12 col-sm-6 col-md-4 col-lg-3 pv-favoritesCol';

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

            const pricesTextHtml = escapeHtml(pricesText);

            col.innerHTML = `
                <div class="pv-card h-100">
                    ${imgUrl ? `<a class="pv-card__imgLink" href="${detailPathAttr}" aria-label="View ${nameAttr} details"><img class="pv-card__img" src="${imgUrlAttr}" alt="${nameAttr} card image"/></a>` : ''}
                    <div class="pv-card__body">
                        <div class="pv-card__header">
                            <div class="pv-card__title"><a class="pv-card__titleLink" href="${detailPathAttr}" aria-label="View ${nameAttr} details">${nameHtml}</a></div>
                            <button id="pv-fav-${idAttr}" class="pv-fav-btn" type="button" aria-label="Remove from watchlist" aria-pressed="true" title="Remove from watchlist">★</button>
                        </div>
                        <p class="pv-card__text">${setNameHtml}</p>
                        <p class="pv-card__text">${rarity ? rarityHtml : 'n/a'}</p>
                        ${selectedVariant ? `<p class="pv-card__text">Variant: ${selectedVariantHtml}</p>` : ''}
                        <div class="pv-form__field" style="margin-bottom:0.5rem">
                            <label class="form-label" for="pv-fav-trade-${idAttr}">Trade %</label>
                            <select class="form-select" id="pv-fav-trade-${idAttr}">
                                ${TRADE_PERCENT_CHOICES
                                    .map((p) => `<option value="${p}" ${p === pct ? 'selected' : ''}>${p}%</option>`)
                                    .join('')}
                            </select>
                        </div>
                        <pre class="pv-card__text" id="pv-fav-prices-${idAttr}" style="white-space:pre-wrap;margin:0">${pricesText ? pricesTextHtml : 'No prices loaded yet. Load prices in Results to show them here.'}</pre>
                    </div>
                </div>
            `;

            const favBtn = /** @type {HTMLButtonElement|null} */ (col.querySelector(`#pv-fav-${CSS.escape(id)}`));
            if (favBtn) {
                favBtn.addEventListener('click', () => toggleFavorite(fav));
            }

            const tradeEl = /** @type {HTMLSelectElement|null} */ (col.querySelector(`#pv-fav-trade-${CSS.escape(id)}`));
            const pricesEl = /** @type {HTMLElement|null} */ (col.querySelector(`#pv-fav-prices-${CSS.escape(id)}`));

            async function ensureFavoritePricesLoaded() {
                if (!pricesEl) return;
                // If we already have real prices text, don't refetch.
                const currentText = String(pricesEl.textContent || '').trim();
                const looksPlaceholder = !currentText
                    || /select a holo type/i.test(currentText)
                    || /no prices loaded yet/i.test(currentText)
                    || /loading prices/i.test(currentText)
                    || /unable to load prices/i.test(currentText);
                if (!looksPlaceholder) return;
                if (!selectedVariant) return;

                pricesEl.textContent = 'Loading prices…';
                try {
                    const base = getWorkerBase();
                    const url = `${base}/cards/${encodeURIComponent(id)}?includePrices=1&lang=en`;
                    const data = await fetchJsonWithCache(url, CARD_TTL_MS);
                    const cardObj = data?.data || data;
                    const allVariants = Array.isArray(cardObj?.variants) ? cardObj.variants : [];
                    const match = findVariantByName(allVariants, selectedVariant);
                    const loadedPrices = Array.isArray(match?.prices) ? match.prices : [];
                    const formatted = formatPriceList(loadedPrices, getSavedTradePercentForId(id, restoreState));
                    pricesEl.textContent = formatted;

                    favorites = favorites.map((f) => {
                        if (String(f?.id || '') !== id) return f;
                        return { ...f, variants: allVariants, selectedVariant, pricesText: formatted };
                    });
                    saveFavorites(favorites);

                    const prev = loadLastResults();
                    if (prev && Array.isArray(prev.cards)) {
                        const selections = (prev.selections && typeof prev.selections === 'object') ? prev.selections : {};
                        const prevSel = (selections[id] && typeof selections[id] === 'object') ? selections[id] : {};
                        selections[id] = { ...prevSel, pricesText: formatted, holoType: prevSel.holoType || selectedVariant };
                        saveLastResults({ ...prev, selections });
                    }

                    updateFavoritesTotals(loadLastResults() || restoreState);
                } catch (e) {
                    pricesEl.textContent = 'Unable to load prices.';
                    console.warn('[PokeValutor] favorite prices preload error', e);
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
                            pricesEl.textContent = formatted;
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
                    pricesEl.textContent = 'Loading prices…';
                    try {
                        const base = getWorkerBase();
                        const url = `${base}/cards/${encodeURIComponent(id)}?includePrices=1&lang=en`;
                        const data = await fetchJsonWithCache(url, CARD_TTL_MS);
                        const cardObj = data?.data || data;
                        const allVariants = Array.isArray(cardObj?.variants) ? cardObj.variants : [];
                        const match = findVariantByName(allVariants, selectedVariant);
                        const loadedPrices = Array.isArray(match?.prices) ? match.prices : [];
                        const formatted = formatPriceList(loadedPrices, nextPct);
                        pricesEl.textContent = formatted;
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
                    } catch (e) {
                        pricesEl.textContent = 'Unable to load prices.';
                        console.warn('[PokeValutor] favorite prices error', e);
                    }
                });
            }

            // If a favorite has a known variant but no stored prices, fetch once to populate.
            if (!pricesText && selectedVariant) {
                void ensureFavoritePricesLoaded();
            }

            favoritesGrid.appendChild(col);
        }

        updateFavoritesTotals(restoreState);
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
            const msg = data?.error || data?.message || `API error ${res.status}`;
            const err = new Error(String(msg));
            // @ts-ignore
            err.status = res.status;
            // @ts-ignore
            err.isQuotaExceeded = res.status === 429;
            throw err;
        }

        // Some APIs return HTTP 200 with an { ok:false } payload.
        // Never cache those responses.
        if (data && typeof data === 'object' && data.ok === false) {
            const msg = data?.error || data?.message || 'API error';
            const err = new Error(String(msg));
            // @ts-ignore
            err.status = res.status;
            // @ts-ignore
            err.isQuotaExceeded = res.status === 429;
            throw err;
        }
        cacheSet(cacheKey, data, ttlMs);
        cacheSweep();
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
            return `${moneySymbol}${n.toFixed(2)}`;
        }

        /** @type {Array<{rank: number, line: string}>} */
        const lines = [];
        for (const p of prices) {
            if (!p || typeof p !== 'object') continue;
            const condition = p?.condition != null ? String(p.condition) : '';
            const type = p?.type != null ? String(p.type) : '';
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

            const bits = [
                marketText ? `market ${marketText}` : null,
                tradeText ? `@${pct}% ${tradeText}` : null,
            ].filter(Boolean);

            if (bits.length) {
                const prefix = conditionKey
                    ? (type ? `${conditionKey} (${type})` : conditionKey)
                    : (type ? `(${type})` : '');
                const line = prefix ? `${prefix}: ${bits.join(' • ')}` : bits.join(' • ');
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

    function formatUsd(amount) {
        const n = typeof amount === 'number' ? amount : Number(amount);
        if (!Number.isFinite(n)) return '$0.00';
        return `$${n.toFixed(2)}`;
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

    function getMarketFromPricesText(rawText) {
        const text = safeString(rawText, '');
        if (!text) return null;
        const m = text.match(/market\s+\$([0-9]+(?:\.[0-9]+)?)/i);
        if (!m) return null;
        const n = Number(m[1]);
        return Number.isFinite(n) ? n : null;
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

        return getMarketFromPricesText(
            restoreState?.selections?.[id]?.pricesText ?? cardLike?.pricesText
        );
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
                const m = text.match(/market\s+\$([0-9]+(?:\.[0-9]+)?)/i);
                if (m) {
                    const parsed = Number(m[1]);
                    if (Number.isFinite(parsed)) market = parsed;
                }
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

        const dexCollectionById = isDexPage
            ? new Map(loadDexCollection().map((x) => [safeString(x?.id, ''), x]))
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
            col.className = 'col-12 col-sm-6 col-md-4 col-lg-3 pv-searchCol';

            const id = String(card?.id || '');
            const name = String(card?.name || 'Unknown');
            const rarity = String(card?.rarity || '');
            const setName = getCardSetName(card);
            const imgUrl = sanitizeUrl(pickFrontMediumImage(card?.images));
            const variantsFull = Array.isArray(card?.variants) ? card.variants : [];
            const variants = variantsFull.map((v) => v?.name).filter(Boolean);
            const dexTracked = (isDexPage && dexCollectionById)
                ? dexCollectionById.get(id)
                : null;
            const fav = isFavorite(id);
            const inDexCollection = isDexPage ? !!dexTracked : false;
            const trackedCopies = isDexPage
                ? getTotalDexConditionCopies(dexTracked?.conditionQuantities, dexTracked?.selectedCondition)
                : 0;
            const trackedCopyLabel = trackedCopies > 0 ? ` (${trackedCopies} cop${trackedCopies === 1 ? 'y' : 'ies'})` : '';
            const favSymbol = isDexPage ? (inDexCollection ? '✓' : '+') : (fav ? '★' : '☆');
            const favLabel = isDexPage
                ? (inDexCollection ? `Add another copy to collection${trackedCopyLabel}` : 'Add to collection and master set tracker')
                : (fav ? 'Remove from watchlist' : 'Add to watchlist');
            const removeLabel = isDexPage
                ? (inDexCollection ? `Remove one tracked copy${trackedCopyLabel}` : 'No tracked copies to remove')
                : '';

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
                            <select class="form-select" id="pv-trade-${idAttr}">
                                ${tradePercentOptions}
                            </select>
                        </div>
                `;

            const conditionFieldHtml = isDexPage
                ? `
                        <div class="pv-form__field" style="margin-bottom:0.5rem">
                            <label class="form-label" for="pv-condition-${idAttr}">Condition</label>
                            <select class="form-select" id="pv-condition-${idAttr}">
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

            col.setAttribute('data-card-id', id);
            col.setAttribute('data-card-name', name);

            col.innerHTML = `
                <div class="pv-card h-100">
                    ${imgUrl ? `<a class="pv-card__imgLink" href="${detailPathAttr}" aria-label="View ${nameAttr} details"><img class="pv-card__img" src="${imgUrlAttr}" alt="${nameAttr} card image"/></a>` : ''}
                    <div class="pv-card__body">
                        <div class="pv-card__header">
                            <div class="pv-card__title"><a class="pv-card__titleLink" href="${detailPathAttr}" aria-label="View ${nameAttr} details">${nameHtml}</a></div>
                            <div class="pv-card__actions">
                                <button id="pv-share-${idAttr}" class="pv-share-btn" type="button" aria-label="Share card link" title="Share card link">
                                    <svg class="pv-share-btn__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                        <path d="M18 16a3 3 0 0 0-2.39 1.2L9.91 14a3.28 3.28 0 0 0 0-4l5.7-3.2A3 3 0 1 0 15 5a3 3 0 0 0 .07.62l-5.7 3.2a3 3 0 1 0 0 6.36l5.7 3.2A3 3 0 1 0 18 16z"></path>
                                    </svg>
                                </button>
                                <button id="pv-fav-${idAttr}" class="pv-fav-btn" type="button" aria-label="${favLabelAttr}" aria-pressed="${fav ? 'true' : 'false'}" title="${favLabelAttr}">${favSymbol}</button>
                                ${isDexPage
                                    ? `<button id="pv-dex-remove-${idAttr}" class="pv-dex-remove-btn" type="button" aria-label="${removeLabelAttr}" title="${removeLabelAttr}" ${inDexCollection ? '' : 'disabled'}>−</button>`
                                    : ''}
                            </div>
                        </div>
                        <p class="pv-card__text">${setNameHtml}</p>
                        <p class="pv-card__text">${rarity ? rarityHtml : 'n/a'}</p>
                        <div class="pv-form__field" style="margin-bottom:0.5rem">
                            <label class="form-label" for="pv-variant-${idAttr}">Variant</label>
                            <select class="form-select" id="pv-variant-${idAttr}" ${variants.length ? '' : 'disabled'}>
                                ${variantOptions}
                            </select>
                        </div>
                        ${conditionFieldHtml}
                        ${tradeFieldHtml}
                        <pre class="pv-card__text" id="pv-prices-${idAttr}" style="white-space:pre-wrap;margin:0"></pre>
                    </div>
                </div>
            `;

            // Declare these after col.innerHTML so the elements exist
            const selectEl = /** @type {HTMLSelectElement|null} */ (col.querySelector(`#pv-variant-${CSS.escape(id)}`));
            const conditionEl = /** @type {HTMLSelectElement|null} */ (col.querySelector(`#pv-condition-${CSS.escape(id)}`));
            const tradeEl = /** @type {HTMLSelectElement|null} */ (col.querySelector(`#pv-trade-${CSS.escape(id)}`));
            const pricesEl = /** @type {HTMLElement|null} */ (col.querySelector(`#pv-prices-${CSS.escape(id)}`));
            const shareBtn = /** @type {HTMLButtonElement|null} */ (col.querySelector(`#pv-share-${CSS.escape(id)}`));
            const favBtn = /** @type {HTMLButtonElement|null} */ (col.querySelector(`#pv-fav-${CSS.escape(id)}`));
            const removeBtn = /** @type {HTMLButtonElement|null} */ (col.querySelector(`#pv-dex-remove-${CSS.escape(id)}`));

            if (shareBtn) {
                shareBtn.addEventListener('click', () => {
                    void shareCardLink(card);
                });
            }

            function updateDexButtonStateFromStorage() {
                if (!isDexPage || !favBtn) return;

                const trackedEntry = loadDexCollection().find((x) => safeString(x?.id, '') === id) || null;
                const nowTracked = !!trackedEntry;
                const nowCopies = nowTracked
                    ? getTotalDexConditionCopies(trackedEntry?.conditionQuantities, trackedEntry?.selectedCondition)
                    : 0;
                const copyLabel = nowCopies > 0 ? ` (${nowCopies} cop${nowCopies === 1 ? 'y' : 'ies'})` : '';

                const addLabel = nowTracked
                    ? `Add another copy to collection${copyLabel}`
                    : 'Add to collection and master set tracker';
                favBtn.textContent = nowTracked ? '✓' : '+';
                favBtn.setAttribute('aria-label', addLabel);
                favBtn.setAttribute('title', addLabel);
                favBtn.setAttribute('aria-pressed', nowTracked ? 'true' : 'false');

                if (removeBtn) {
                    const rmLabel = nowTracked
                        ? `Remove one tracked copy${copyLabel}`
                        : 'No tracked copies to remove';
                    removeBtn.disabled = !nowTracked;
                    removeBtn.setAttribute('aria-label', rmLabel);
                    removeBtn.setAttribute('title', rmLabel);
                }
            }

            if (favBtn) {
                if (isDexPage) {
                    favBtn.setAttribute('aria-pressed', inDexCollection ? 'true' : 'false');
                }
                if (isDexPage) {
                    favBtn.addEventListener('click', () => {
                        const currentlyTracked = isInDexCollection(id);
                        const selectedCondition = normalizeDexConditionCode(conditionEl?.value);
                        if (!selectedCondition) {
                            setStatus('Select a card condition (NM, LP, MP, HP, or DM) before adding to your Collection.');
                            if (conditionEl) conditionEl.focus();
                            return;
                        }

                        const selectedVariant = safeString(selectEl?.value, '');
                        if (Array.isArray(variants) && variants.length > 0 && !selectedVariant) {
                            setStatus('Select a card type (variant) before adding to your Collection.');
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

                        const addedConditionLabel = getDexConditionLabel(selectedCondition);
                        const addedVariantRaw = safeString(selectedVariant || getDexDefaultVariantForCard(card), '').trim();
                        const addedVariantLabel = addedVariantRaw || 'Standard';
                        const addedDetail = `${addedConditionLabel} • ${addedVariantLabel}`;

                        if (result.action === 'added' && (result.addedCollection || result.addedMasterSet)) {
                            const setSuffix = result.expansionName ? ` (${result.expansionName})` : '';
                            const prefix = currentlyTracked ? 'Added another copy to Collection and Master Sets' : 'Added to Collection and Master Sets';
                            setStatus(`${prefix} (${addedDetail})${setSuffix}.`);
                        } else if (result.action === 'removed' && (result.removedCollection || result.removedMasterSet)) {
                            const firstSet = Array.isArray(result.expansionNames) && result.expansionNames.length
                                ? ` (${result.expansionNames[0]})`
                                : '';
                            setStatus(`Removed from Collection and Master Sets${firstSet}.`);
                        } else if (result.action === 'added') {
                            setStatus('Card is already in your Collection and Master Sets tracker.');
                        } else if (result.action === 'removed') {
                            setStatus('Card was already removed from your Collection and Master Sets tracker.');
                        }
                    });
                } else {
                    favBtn.addEventListener('click', () => toggleFavorite(card));
                }
            }

            if (isDexPage && removeBtn) {
                removeBtn.addEventListener('click', () => {
                    if (!isInDexCollection(id)) {
                        setStatus('No tracked copies to remove for this card.');
                        return;
                    }

                    const selectedCondition = normalizeDexConditionCode(conditionEl?.value);
                    if (!selectedCondition) {
                        setStatus('Select the condition of the copy you want to remove.');
                        if (conditionEl) conditionEl.focus();
                        return;
                    }

                    const selectedVariant = safeString(selectEl?.value, '');
                    if (Array.isArray(variants) && variants.length > 0 && !selectedVariant) {
                        setStatus('Select the variant you want to remove.');
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
                            setStatus('Select the variant you want to remove.');
                            if (selectEl) selectEl.focus();
                        } else {
                            setStatus('Unable to remove a copy for this card right now.');
                        }
                        return;
                    }

                    const setSuffix = Array.isArray(removed.expansionNames) && removed.expansionNames.length
                        ? ` (${removed.expansionNames[0]})`
                        : '';
                    if (removed.removedCard) {
                        setStatus(`Removed last tracked copy (${removedDetail}) from Collection and Master Sets${setSuffix}.`);
                    } else {
                        setStatus(`Removed one tracked copy (${removedDetail}) from Collection${setSuffix}.`);
                    }
                });
            }

            if (isDexPage && selectEl && selectedDexVariant && variants.includes(selectedDexVariant)) {
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
                pricesEl.textContent = formatted;
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
                    pricesEl.textContent = variants.length ? 'Select a holo type to load prices.' : '';
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
                    pricesEl.textContent = formatted;
                    const market = getMarketFromPricesForTotals(localPrices);
                    setSearchCardValue(id, market);
                    if (searchSortState.active === 'value') {
                        applySearchSortToGrid();
                    }
                    persistSelection(variantName, formatted);
                    return;
                }

                pricesEl.textContent = 'Loading prices…';
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
                    pricesEl.textContent = formatted;
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
                    pricesEl.textContent = 'Unable to load prices.';
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
                        pricesEl.textContent = formatted;
                        const market = getMarketFromPricesForTotals(restoredPrices);
                        setSearchCardValue(id, market);
                        if (searchSortState.active === 'value') {
                            applySearchSortToGrid();
                        }
                        persistSelection(restoredVariant, formatted);
                    } else if (restoredSelection.pricesText && !isDexPage) {
                        pricesEl.textContent = String(restoredSelection.pricesText);
                        lastLoadedVariantName = restoredVariant;
                        const market = getMarketFromPricesText(restoredSelection.pricesText);
                        setSearchCardValue(id, market);
                        if (searchSortState.active === 'value') {
                            applySearchSortToGrid();
                        }

                        // Keep the in-memory card snapshot aligned with restored state.
                        try {
                            card.selectedVariant = restoredVariant;
                            card.pricesText = String(restoredSelection.pricesText);
                        } catch {
                            // ignore
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
                        pricesEl.textContent = formatted;
                        const market = getMarketFromPricesForTotals(p);
                        setSearchCardValue(id, market);
                        if (searchSortState.active === 'value') {
                            applySearchSortToGrid();
                        }
                        persistSelection(bestVariant, formatted);
                    } else {
                        pricesEl.textContent = variants.length ? 'Select a holo type to load prices.' : '';
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
                col.className = 'col-12 col-sm-6 col-md-4 col-lg-3';
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
            const guidance = 'If your card is not displayed, please search by card number (printed number) instead.';
            const limitNote = hasMore ? ' Showing first 15 matches. Use Load More to see more.' : '';
            const matchNote = matchedBy === 'fallback' && cards.length
                ? ' Showing closest partial matches.'
                : '';
            const statusText = `${cards.length} result${cards.length !== 1 ? 's' : ''} for "${q}".${limitNote}${matchNote} ${guidance}`;
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
                setStatus('Daily guest allowance reached. Sign in to continue.');
            } else if (e && typeof e === 'object' && 'status' in e && Number(e.status) === 401) {
                // @ts-ignore
                setStatus(String(e.message || 'Sign-in required'));
            } else {
                setStatus('Error retrieving results. Please try again later.');
            }
        }
    }

    async function searchByNameInSet(expansionId, expansionName, seriesName, pokemonName) {
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
                col.className = 'col-12 col-sm-6 col-md-4 col-lg-3';
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
            const fallbackNote = usedFallback && cards.length ? ' Showing closest partial matches.' : '';
            const limitNote = hasMore ? ' Showing first 15 matches. Use Load More to see more.' : '';
            const statusText = `${cards.length} result${cards.length !== 1 ? 's' : ''} for "${name}" in set "${label}".${limitNote}${fallbackNote}`;
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
                setStatus('Daily guest allowance reached. Sign in to continue.');
            } else if (e && typeof e === 'object' && 'status' in e && Number(e.status) === 401) {
                // @ts-ignore
                setStatus(String(e.message || 'Sign-in required'));
            } else {
                setStatus('Error retrieving set results. Please try again later.');
            }
        }
    }

    async function searchByPrintedNumber(printedNumber) {
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

        setStatus('Searching…');
        if (grid) {
            grid.innerHTML = '';
            for (let i = 0; i < Math.min(RESULT_LIMIT, 12); i++) {
                const col = document.createElement('div');
                col.className = 'col-12 col-sm-6 col-md-4 col-lg-3';
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

            // 2) For common fractions like 109/094, retry without leading zeros.
            const normalizedFraction = normalizeSimplePrintedFraction(pn);
            if (normalizedFraction && normalizedFraction !== pn) candidates.push(normalizedFraction);

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

            // 1) Promo-first: promos are easy to crowd out by other sets sharing the same number.
            // Use a larger page, sort, then merge into the top of results.
            if (numberCandidate && !String(numberCandidate).includes('/')) {
                const promoQ = `rarity:Promo ${buildFieldQuery('number', numberCandidate)}`;
                const promoUrl = `${base}/cards/search?q=${encodeURIComponent(promoQ)}&page=1&pageSize=25&lang=en`;
                const promoData = await fetchJsonWithCache(promoUrl, SEARCH_TTL_MS);
                const promoFound = Array.isArray(promoData?.data) ? promoData.data : [];
                promoFound.sort((a, b) => String(a?.id || '').localeCompare(String(b?.id || '')));
                mergeUniqueById(cards, promoFound);
            }

            // 2) printed_number search (works for most non-promo cards, and fractions).
            let matchedPn = uniqueCandidates[0] || pn;
            for (const attempt of uniqueCandidates) {
                matchedPn = attempt;
                const q = buildFieldQuery('printed_number', matchedPn);
                const url = `${base}/cards/search?q=${encodeURIComponent(q)}&page=1&pageSize=${RESULT_LIMIT}&lang=en`;
                const data = await fetchJsonWithCache(url, SEARCH_TTL_MS);
                const found = Array.isArray(data?.data) ? data.data : [];
                if (found.length) {
                    mergeUniqueById(cards, found);
                    break;
                }
            }

            // 3) number:<value> (covers promo codes like SWSH020 and many regular sets).
            if (cards.length < RESULT_LIMIT && numberCandidate && !String(numberCandidate).includes('/')) {
                const numberQ = buildFieldQuery('number', numberCandidate);
                const numberUrl = `${base}/cards/search?q=${encodeURIComponent(numberQ)}&page=1&pageSize=${RESULT_LIMIT}&lang=en`;
                const numberData = await fetchJsonWithCache(numberUrl, SEARCH_TTL_MS);
                mergeUniqueById(cards, Array.isArray(numberData?.data) ? numberData.data : []);
            }

            // 4) If the user pasted a card id (e.g., "mep-10"), try id:<value> directly.
            if (cards.length < RESULT_LIMIT && /-/.test(pn) && /[A-Za-z]/.test(pn)) {
                const idQ = buildFieldQuery('id', pn);
                const idUrl = `${base}/cards/search?q=${encodeURIComponent(idQ)}&page=1&pageSize=${RESULT_LIMIT}&lang=en`;
                const idData = await fetchJsonWithCache(idUrl, SEARCH_TTL_MS);
                mergeUniqueById(cards, Array.isArray(idData?.data) ? idData.data : []);
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
                setStatus('Daily guest allowance reached. Sign in to continue.');
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
        const url = `${base}/cards/search?q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}&lang=en`;
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
                col.className = 'col-12 col-sm-6 col-md-4 col-lg-3';
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
                setStatus('Daily guest allowance reached. Sign in to continue.');
            } else if (e && typeof e === 'object' && 'status' in e && Number(e.status) === 401) {
                // @ts-ignore
                setStatus(String(e.message || 'Sign-in required'));
            } else {
                setStatus('Error retrieving expansion results. Please try again later.');
            }
        }
    }

    async function searchByExpansionSet(expansionId, expansionName, seriesName) {
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
                col.className = 'col-12 col-sm-6 col-md-4 col-lg-3';
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
                setStatus('Daily guest allowance reached. Sign in to continue.');
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
                setStatus('Daily guest allowance reached. Sign in to continue.');
            } else {
                setStatus('Unable to load more cards right now. Please try again.');
            }
        }
    }

    if (form && input) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const query = safeString(input?.value, '').trim();
            const bySetId = safeString(setSelect?.value, '').trim();

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
                    selectedConditionFilters.add('NM');
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
        });
    }

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
        favoritesClearBtn.addEventListener('click', () => {
            clearFavorites();
        });
    }

    // Restore last results after refresh.
    const restored = loadLastResults();
    if (restored && Array.isArray(restored.cards) && restored.cards.length) {
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
        renderCards(restored.cards, restored);
        renderFavorites(restored);
        if (restored.statusText) setStatus(String(restored.statusText));
    }

    // Deep-link support: /search.html?expansionId=...&expansionName=...
    try {
        const params = new URLSearchParams(window.location.search || '');
        const expansionId = params.get('expansionId') || '';
        const expansionName = params.get('expansionName') || '';
        if (expansionId) {
            void searchTopByExpansion(expansionId, expansionName);
        }
    } catch {
        // ignore
    }

    if (scrollTopBtn) {
        scrollTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
});

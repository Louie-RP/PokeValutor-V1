/* Dex Collection + Master Sets pages */
(function () {
    const CACHE_PREFIX = 'pv:scrydex:';
    const DEX_COLLECTION_KEY = `${CACHE_PREFIX}collection:v1`;
    const DEX_MASTER_SETS_KEY = `${CACHE_PREFIX}masterSets:v1`;
    const DEX_OWNER_UID_KEY = `${CACHE_PREFIX}dexOwnerUid:v1`;
    const DEX_CLOUD_REVISION_KEY = `${CACHE_PREFIX}dexCloudRevision:v1`;
    const DEX_STATE_UPDATED_AT_KEY = `${CACHE_PREFIX}dexStateUpdatedAt:v1`;
    const DEX_LAST_RESULTS_KEY = `${CACHE_PREFIX}lastResults:v1`;
    const DEX_ACTIVE_COLLECTION_KEY = `${CACHE_PREFIX}activeCollectionId:v1`;
    const DEX_DEFAULT_COLLECTION_ID = 'default';
    const VALUE_CACHE_KEY = `${CACHE_PREFIX}collectionValueCache:v2`;
    const SET_CARDS_CACHE_KEY = `${CACHE_PREFIX}setCardsCache:v1`;
    const COLLECTION_SORT_PREF_KEY = `${CACHE_PREFIX}collectionSortMode:v1`;
    const COLLECTION_TYPE_FILTER_PREF_KEY = `${CACHE_PREFIX}collectionTypeFilter:v1`;
    const COLLECTION_TOTALS_HIDDEN_PREF_KEY = `${CACHE_PREFIX}collectionTotalsHidden:v1`;
    const VALUE_CACHE_TTL_MS = 8 * 60 * 60 * 1000;
    const SEALED_VALUE_CACHE_TTL_MS = 8 * 60 * 60 * 1000;
    const COLLECTION_VALUE_AUTO_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
    const COLLECTION_VALUE_LAST_REFRESH_KEY = `${CACHE_PREFIX}collectionValueLastRefresh:v2`;
    const SET_CARDS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const SET_SEARCH_PAGE_SIZE = 100;
    const SET_SEARCH_MAX_PAGES = 12;
    const COLLECTION_PAGE_SIZE_MOBILE = 36;
    const COLLECTION_PAGE_SIZE_DESKTOP = 60;
    const COLLECTION_PAGE_BREAKPOINT_QUERY = '(max-width: 767.98px)';
    const DEX_CONDITION_CODES = ['NM', 'LP', 'MP', 'HP', 'DM'];
    const MASTER_DEFAULT_VARIANT_NAME = 'Standard';
    const COLLECTION_TYPE_FILTER_VALUES = ['all', 'card', 'sealed'];
    const storageUtil = window?.PV_STORAGE_UTIL || null;
    const collectionSortState = {
        active: 'value',
        nameDir: 'asc',
        valueDir: 'desc',
    };
    const collectionSnapshotState = {
        byCollectionId: {},
        inFlightByCollectionId: {},
        errorUntilByCollectionId: {},
    };
    const collectionTotalsState = {
        hidden: false,
        valueText: 'Value: $0.00',
        amountText: 'Amount: 0 items • 0 card copies',
    };
    const collectionPaginationState = {
        page: 1,
        perPage: 0,
        signature: '',
    };
    let collectionPageSizeMediaBound = false;
    /** @type {Record<string, number>} */
    const collectionValueById = {};
    /** @type {Record<string, Promise<any>>} */
    const cardPriceRequestInFlightById = {};
    /** @type {Record<string, Promise<any>>} */
    const sealedPriceRequestInFlightById = {};
    /** @type {Record<string, Promise<any>>} */
    const sealedSearchRequestInFlightById = {};

    function safeParseJson(raw) {
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    function safeString(value, fallback) {
        const s = String(value ?? '');
        return s ? s : (fallback || '');
    }

    function normalizeCollectionItemType(rawType) {
        const value = safeString(rawType, '').trim().toLowerCase();
        return value === 'sealed' ? 'sealed' : 'card';
    }

    function normalizeCollectionId(rawId, fallbackId) {
        const normalized = safeString(rawId, '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '');
        if (!normalized) return safeString(fallbackId, DEX_DEFAULT_COLLECTION_ID);
        return normalized.slice(0, 40);
    }

    function getActiveCollectionId() {
        try {
            const raw = localStorage.getItem(DEX_ACTIVE_COLLECTION_KEY);
            return normalizeCollectionId(raw, DEX_DEFAULT_COLLECTION_ID);
        } catch {
            return DEX_DEFAULT_COLLECTION_ID;
        }
    }

    function isEntryInActiveCollection(item) {
        const entryCollectionId = normalizeCollectionId(item?.collectionId, DEX_DEFAULT_COLLECTION_ID);
        return entryCollectionId === getActiveCollectionId();
    }

    function isCardCollectionItem(item) {
        return normalizeCollectionItemType(item?.itemType) === 'card';
    }

    function isSealedCollectionItem(item) {
        return normalizeCollectionItemType(item?.itemType) === 'sealed';
    }

    function getCollectionEntryKey(item) {
        const type = normalizeCollectionItemType(item?.itemType);
        const id = safeString(item?.id, '').trim();
        const collectionId = normalizeCollectionId(item?.collectionId, DEX_DEFAULT_COLLECTION_ID);
        return `${collectionId}:${type}:${id}`;
    }

    function normalizeSealedQuantity(rawQty, fallback) {
        const fallbackQty = Math.max(0, Math.floor(Number(fallback) || 0));
        const parsed = Math.floor(Number(rawQty));
        if (!Number.isFinite(parsed)) return fallbackQty;
        return Math.max(0, parsed);
    }

    function getSealedCollectionQuantity(item) {
        return Math.max(1, normalizeSealedQuantity(item?.quantity ?? item?.sealedQuantity, 1));
    }

    function normalizeCollectionTypeFilter(value) {
        const next = safeString(value, '').trim().toLowerCase();
        return COLLECTION_TYPE_FILTER_VALUES.includes(next) ? next : 'all';
    }

    function normalizeSearchText(value) {
        const raw = safeString(value, '').toLowerCase();
        return raw
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    function tokenizeSearchText(value) {
        const normalized = normalizeSearchText(value);
        if (!normalized) return [];
        return normalized.split(/\s+/).filter(Boolean);
    }

    function getTypoTolerance(tokenLength) {
        const len = Math.max(0, Math.floor(Number(tokenLength) || 0));
        if (len <= 2) return 0;
        if (len <= 5) return 1;
        if (len <= 9) return 2;
        return 3;
    }

    function isWithinLevenshteinLimit(aRaw, bRaw, limitRaw) {
        const a = safeString(aRaw, '');
        const b = safeString(bRaw, '');
        const limit = Math.max(0, Math.floor(Number(limitRaw) || 0));

        if (a === b) return true;
        const aLen = a.length;
        const bLen = b.length;
        if (Math.abs(aLen - bLen) > limit) return false;
        if (!aLen || !bLen) return Math.max(aLen, bLen) <= limit;

        let prev = new Array(bLen + 1);
        let curr = new Array(bLen + 1);

        for (let j = 0; j <= bLen; j += 1) {
            prev[j] = j;
        }

        for (let i = 1; i <= aLen; i += 1) {
            curr[0] = i;
            let rowMin = curr[0];

            for (let j = 1; j <= bLen; j += 1) {
                const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
                const deletion = prev[j] + 1;
                const insertion = curr[j - 1] + 1;
                const substitution = prev[j - 1] + cost;
                const best = Math.min(deletion, insertion, substitution);
                curr[j] = best;
                if (best < rowMin) rowMin = best;
            }

            if (rowMin > limit) return false;

            const next = prev;
            prev = curr;
            curr = next;
        }

        return prev[bLen] <= limit;
    }

    function tokenFuzzyMatch(queryTokenRaw, candidateTokenRaw) {
        const queryToken = normalizeSearchText(queryTokenRaw);
        const candidateToken = normalizeSearchText(candidateTokenRaw);
        if (!queryToken || !candidateToken) return false;

        if (candidateToken.includes(queryToken)) {
            return true;
        }

        const tolerance = Math.min(
            getTypoTolerance(queryToken.length),
            getTypoTolerance(candidateToken.length)
        );
        if (tolerance <= 0) return false;

        return isWithinLevenshteinLimit(queryToken, candidateToken, tolerance);
    }

    function getLevenshteinDistance(aRaw, bRaw, maxDistanceRaw) {
        const a = safeString(aRaw, '');
        const b = safeString(bRaw, '');
        const maxDistanceNum = Number(maxDistanceRaw);
        const maxDistance = Number.isFinite(maxDistanceNum) && maxDistanceNum >= 0
            ? Math.floor(maxDistanceNum)
            : Number.POSITIVE_INFINITY;

        if (a === b) return 0;
        const aLen = a.length;
        const bLen = b.length;
        if (!aLen) return bLen;
        if (!bLen) return aLen;
        if (Math.abs(aLen - bLen) > maxDistance) return Number.POSITIVE_INFINITY;

        let prev = new Array(bLen + 1);
        let curr = new Array(bLen + 1);

        for (let j = 0; j <= bLen; j += 1) {
            prev[j] = j;
        }

        for (let i = 1; i <= aLen; i += 1) {
            curr[0] = i;
            let rowMin = curr[0];

            for (let j = 1; j <= bLen; j += 1) {
                const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
                const deletion = prev[j] + 1;
                const insertion = curr[j - 1] + 1;
                const substitution = prev[j - 1] + cost;
                const best = Math.min(deletion, insertion, substitution);
                curr[j] = best;
                if (best < rowMin) rowMin = best;
            }

            if (rowMin > maxDistance) return Number.POSITIVE_INFINITY;

            const next = prev;
            prev = curr;
            curr = next;
        }

        return prev[bLen] <= maxDistance ? prev[bLen] : Number.POSITIVE_INFINITY;
    }

    function getTokenMatchScore(queryTokenRaw, candidateTokenRaw) {
        const queryToken = normalizeSearchText(queryTokenRaw);
        const candidateToken = normalizeSearchText(candidateTokenRaw);
        if (!queryToken || !candidateToken) return 0;

        if (queryToken === candidateToken) return 1;
        if (candidateToken.startsWith(queryToken)) return 0.9;
        if (candidateToken.includes(queryToken)) return 0.78;

        const tolerance = Math.min(
            getTypoTolerance(queryToken.length),
            getTypoTolerance(candidateToken.length)
        );
        if (tolerance <= 0) return 0;

        const distance = getLevenshteinDistance(queryToken, candidateToken, tolerance);
        if (!Number.isFinite(distance)) return 0;

        const longest = Math.max(queryToken.length, candidateToken.length, 1);
        return Math.max(0.45, 1 - (distance / longest));
    }

    function getTypoTolerantSearchScore(queryRaw, fields) {
        const normalizedQuery = normalizeSearchText(queryRaw);
        if (!normalizedQuery) return 0;

        const fieldStrings = Array.isArray(fields)
            ? fields.map((value) => normalizeSearchText(value)).filter(Boolean)
            : [];
        if (!fieldStrings.length) return -1;

        const queryTokens = tokenizeSearchText(normalizedQuery);
        if (!queryTokens.length) return 0;

        const fieldTokens = fieldStrings
            .flatMap((field) => field.split(/\s+/))
            .filter(Boolean);
        if (!fieldTokens.length) return -1;

        let score = 0;
        for (const queryToken of queryTokens) {
            let bestTokenScore = 0;
            for (const candidateToken of fieldTokens) {
                const tokenScore = getTokenMatchScore(queryToken, candidateToken);
                if (tokenScore > bestTokenScore) {
                    bestTokenScore = tokenScore;
                }
            }
            if (bestTokenScore <= 0) return -1;
            score += Math.round(bestTokenScore * 100);
        }

        if (fieldStrings.some((field) => field.includes(normalizedQuery))) {
            score += 240;
        } else {
            const joined = fieldStrings.join(' ');
            if (queryTokens.every((token) => joined.includes(token))) {
                score += 120;
            }
        }

        return score;
    }

    function isTypoTolerantSearchMatch(queryRaw, fields) {
        return getTypoTolerantSearchScore(queryRaw, fields) >= 0;
    }

    function getDidYouMeanSuggestion(queryRaw, candidateValues) {
        const query = normalizeSearchText(queryRaw);
        if (!query) return '';

        const seen = new Set();
        let best = null;

        for (const rawValue of (Array.isArray(candidateValues) ? candidateValues : [])) {
            const value = safeString(rawValue, '').trim();
            const normalizedValue = normalizeSearchText(value);
            if (!value || !normalizedValue || normalizedValue === query || seen.has(normalizedValue)) continue;
            seen.add(normalizedValue);

            let score = getTypoTolerantSearchScore(query, [value]);
            if (score < 0) {
                const queryTokens = tokenizeSearchText(query);
                const valueTokens = tokenizeSearchText(value);
                let fallbackScore = 0;
                let matched = 0;

                for (const queryToken of queryTokens) {
                    let bestTokenScore = 0;
                    for (const valueToken of valueTokens) {
                        let tokenScore = getTokenMatchScore(queryToken, valueToken);
                        if (tokenScore <= 0) {
                            const looseLimit = Math.max(
                                getTypoTolerance(queryToken.length),
                                getTypoTolerance(valueToken.length)
                            ) + 2;
                            const looseDistance = getLevenshteinDistance(queryToken, valueToken, looseLimit);
                            if (Number.isFinite(looseDistance)) {
                                const longest = Math.max(queryToken.length, valueToken.length, 1);
                                tokenScore = Math.max(0.32, 1 - (looseDistance / longest));
                            }
                        }
                        if (tokenScore > bestTokenScore) {
                            bestTokenScore = tokenScore;
                        }
                    }
                    if (bestTokenScore > 0) {
                        matched += 1;
                        fallbackScore += Math.round(bestTokenScore * 110);
                    }
                }

                score = matched ? fallbackScore - ((queryTokens.length - matched) * 40) : -1;
            }

            if (score < 45) continue;
            if (!best || score > best.score) {
                best = { value, score };
            }
        }

        return best ? best.value : '';
    }

    function escapeRegExp(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function buildSearchHighlightHtml(textRaw, queryRaw) {
        const text = safeString(textRaw, '');
        if (!text) return '';

        const queryTokens = Array.from(new Set(tokenizeSearchText(queryRaw).filter((token) => token.length >= 2)));
        if (!queryTokens.length) return escapeHtml(text);

        const lowerText = text.toLowerCase();
        let highlightTokens = queryTokens.filter((token) => lowerText.includes(token));

        if (!highlightTokens.length) {
            const rawTokens = Array.from(text.match(/[A-Za-z0-9]+/g) || []);
            let bestRawToken = '';
            let bestScore = 0;

            for (const rawToken of rawTokens) {
                const candidateToken = normalizeSearchText(rawToken);
                for (const queryToken of queryTokens) {
                    const tokenScore = getTokenMatchScore(queryToken, candidateToken);
                    if (tokenScore > bestScore) {
                        bestScore = tokenScore;
                        bestRawToken = rawToken;
                    }
                }
            }

            if (bestRawToken && bestScore >= 0.6) {
                highlightTokens = [bestRawToken];
            }
        }

        if (!highlightTokens.length) return escapeHtml(text);

        const pattern = highlightTokens
            .map((token) => escapeRegExp(token))
            .filter(Boolean)
            .sort((a, b) => b.length - a.length)
            .join('|');
        if (!pattern) return escapeHtml(text);

        const regex = new RegExp(`(${pattern})`, 'ig');
        const parts = text.split(regex);
        return parts.map((part, idx) => {
            if (idx % 2 === 1) {
                return `<mark class="pv-searchHighlight">${escapeHtml(part)}</mark>`;
            }
            return escapeHtml(part);
        }).join('');
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

    function formatUsd(amount) {
        const n = Number(amount);
        if (!Number.isFinite(n)) return '$0.00';
        return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    const COLLECTION_SORT_MODES = ['value-desc', 'value-asc', 'name-asc', 'name-desc'];

    function loadCollectionTypeFilterPreference() {
        try {
            const raw = localStorage.getItem(COLLECTION_TYPE_FILTER_PREF_KEY);
            return normalizeCollectionTypeFilter(raw);
        } catch {
            return 'all';
        }
    }

    function saveCollectionTypeFilterPreference(value) {
        try {
            localStorage.setItem(COLLECTION_TYPE_FILTER_PREF_KEY, normalizeCollectionTypeFilter(value));
        } catch {
            // ignore
        }
    }

    function loadCollectionSortPreference() {
        try {
            const raw = localStorage.getItem(COLLECTION_SORT_PREF_KEY);
            if (!raw) return '';
            const mode = String(raw || '').trim();
            return COLLECTION_SORT_MODES.includes(mode) ? mode : '';
        } catch {
            return '';
        }
    }

    function saveCollectionSortPreference(mode) {
        try {
            localStorage.setItem(COLLECTION_SORT_PREF_KEY, String(mode || ''));
        } catch {
            // ignore
        }
    }

    function loadCollectionTotalsHiddenPreference() {
        try {
            return String(localStorage.getItem(COLLECTION_TOTALS_HIDDEN_PREF_KEY) || '') === '1';
        } catch {
            return false;
        }
    }

    function saveCollectionTotalsHiddenPreference(hidden) {
        try {
            localStorage.setItem(COLLECTION_TOTALS_HIDDEN_PREF_KEY, hidden ? '1' : '0');
        } catch {
            // ignore
        }
    }

    function getCollectionSortMode() {
        if (collectionSortState.active === 'name') {
            return collectionSortState.nameDir === 'desc' ? 'name-desc' : 'name-asc';
        }
        return collectionSortState.valueDir === 'asc' ? 'value-asc' : 'value-desc';
    }

    function applyCollectionSortMode(modeRaw) {
        const mode = COLLECTION_SORT_MODES.includes(modeRaw) ? modeRaw : 'value-desc';
        switch (mode) {
            case 'name-desc':
                collectionSortState.active = 'name';
                collectionSortState.nameDir = 'desc';
                break;
            case 'name-asc':
                collectionSortState.active = 'name';
                collectionSortState.nameDir = 'asc';
                break;
            case 'value-asc':
                collectionSortState.active = 'value';
                collectionSortState.valueDir = 'asc';
                break;
            case 'value-desc':
            default:
                collectionSortState.active = 'value';
                collectionSortState.valueDir = 'desc';
                break;
        }
    }

    function updateCollectionSortUi() {
        const sortSelect = document.getElementById('pv-collection-sort-select');
        if (sortSelect instanceof HTMLSelectElement) {
            sortSelect.value = getCollectionSortMode();
        }
    }

    function applyCollectionSortToGrid(gridEl) {
        if (!gridEl) return;
        if (collectionSortState.active !== 'name' && collectionSortState.active !== 'value') return;

        const cols = Array.from(gridEl.querySelectorAll('.pv-collectionCol'));
        if (cols.length <= 1) return;

        cols.sort((a, b) => {
            const relevanceA = Number(a.getAttribute('data-search-score') || 0);
            const relevanceB = Number(b.getAttribute('data-search-score') || 0);
            if (relevanceA !== relevanceB) {
                return relevanceB - relevanceA;
            }

            const nameA = safeString(a.getAttribute('data-card-name'), '').toLowerCase();
            const nameB = safeString(b.getAttribute('data-card-name'), '').toLowerCase();

            if (collectionSortState.active === 'name') {
                const dir = collectionSortState.nameDir === 'asc' ? 1 : -1;
                const cmp = nameA.localeCompare(nameB);
                return cmp * dir;
            }

            const keyA = safeString(a.getAttribute('data-entry-key'), '');
            const keyB = safeString(b.getAttribute('data-entry-key'), '');
            const va = Number(collectionValueById[keyA]);
            const vb = Number(collectionValueById[keyB]);
            const hasA = Number.isFinite(va);
            const hasB = Number.isFinite(vb);

            if (!hasA && !hasB) {
                return nameA.localeCompare(nameB);
            }
            if (!hasA) return 1;
            if (!hasB) return -1;

            const dir = collectionSortState.valueDir === 'asc' ? 1 : -1;
            if (va === vb) return nameA.localeCompare(nameB);
            return (va - vb) * dir;
        });

        for (const col of cols) {
            gridEl.appendChild(col);
        }
    }

    function getCollectionPageSize() {
        try {
            if (window?.matchMedia && window.matchMedia(COLLECTION_PAGE_BREAKPOINT_QUERY).matches) {
                return COLLECTION_PAGE_SIZE_MOBILE;
            }
        } catch {
            // ignore
        }
        return COLLECTION_PAGE_SIZE_DESKTOP;
    }

    function sortCollectionMatches(matches) {
        const list = Array.isArray(matches) ? matches.slice() : [];
        if (list.length <= 1) return list;

        list.sort((a, b) => {
            const relevanceA = Number(a?.score || 0);
            const relevanceB = Number(b?.score || 0);
            if (relevanceA !== relevanceB) {
                return relevanceB - relevanceA;
            }

            const itemA = a?.item || {};
            const itemB = b?.item || {};
            const nameA = safeString(itemA?.name, '').toLowerCase();
            const nameB = safeString(itemB?.name, '').toLowerCase();

            if (collectionSortState.active === 'name') {
                const dir = collectionSortState.nameDir === 'asc' ? 1 : -1;
                return nameA.localeCompare(nameB) * dir;
            }

            const keyA = getCollectionEntryKey(itemA);
            const keyB = getCollectionEntryKey(itemB);
            const va = Number(collectionValueById[keyA]);
            const vb = Number(collectionValueById[keyB]);
            const hasA = Number.isFinite(va);
            const hasB = Number.isFinite(vb);

            if (!hasA && !hasB) {
                return nameA.localeCompare(nameB);
            }
            if (!hasA) return 1;
            if (!hasB) return -1;

            const dir = collectionSortState.valueDir === 'asc' ? 1 : -1;
            if (va === vb) return nameA.localeCompare(nameB);
            return (va - vb) * dir;
        });

        return list;
    }

    function renderCollectionPagination(container, options) {
        if (!(container instanceof HTMLElement)) return;

        const totalItems = Math.max(0, Math.floor(Number(options?.totalItems) || 0));
        const pageSize = Math.max(1, Math.floor(Number(options?.pageSize) || COLLECTION_PAGE_SIZE_DESKTOP));
        const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
        const currentPage = Math.min(Math.max(1, Math.floor(Number(options?.currentPage) || 1)), totalPages);

        if (totalItems <= pageSize) {
            container.hidden = true;
            container.replaceChildren();
            return;
        }

        const start = ((currentPage - 1) * pageSize) + 1;
        const end = Math.min(totalItems, currentPage * pageSize);

        container.hidden = false;
        const inner = document.createElement('div');
        inner.className = 'pv-collectionPagination__inner';

        const status = document.createElement('p');
        status.className = 'pv-collectionPagination__status';
        status.textContent = `Showing ${start}-${end} of ${totalItems}`;

        const controls = document.createElement('div');
        controls.className = 'pv-collectionPagination__controls';
        controls.setAttribute('role', 'group');
        controls.setAttribute('aria-label', 'Collection pages');

        const pageLabel = document.createElement('span');
        pageLabel.className = 'pv-collectionPagination__pageLabel';
        pageLabel.textContent = `Page ${currentPage} of ${totalPages}`;

        function createPageButton(label, nav, disabled) {
            const button = document.createElement('button');
            button.className = 'pv-button pv-button--secondary btn pv-collectionPagination__btn';
            button.type = 'button';
            button.dataset.pageNav = nav;
            button.textContent = label;
            button.disabled = disabled;
            return button;
        }

        const firstBtn = createPageButton('First', 'first', currentPage <= 1);
        const prevBtn = createPageButton('Previous', 'prev', currentPage <= 1);
        const nextBtn = createPageButton('Next', 'next', currentPage >= totalPages);
        const lastBtn = createPageButton('Last', 'last', currentPage >= totalPages);

        controls.append(firstBtn, prevBtn, pageLabel, nextBtn, lastBtn);
        inner.append(status, controls);
        container.replaceChildren(inner);

        function scrollCollectionToTop() {
            const grid = document.getElementById('pv-collection-grid');
            const firstCard = grid instanceof HTMLElement
                ? grid.querySelector('.pv-collectionCol')
                : null;
            const target = firstCard instanceof HTMLElement
                ? firstCard
                : ((grid instanceof HTMLElement) ? grid : container);
            const header = document.getElementById('pv-search-header');
            const headerHeight = header instanceof HTMLElement
                ? Math.max(0, Math.ceil(header.getBoundingClientRect().height))
                : 0;
            const topClearance = headerHeight + 20;
            const top = Math.max(
                0,
                Math.round(target.getBoundingClientRect().top + window.scrollY - topClearance)
            );
            window.scrollTo({ top, behavior: 'smooth' });
        }

        function goToPage(page) {
            const targetPage = Math.min(Math.max(1, page), totalPages);
            if (targetPage === collectionPaginationState.page) return;
            collectionPaginationState.page = targetPage;
            renderCollectionPage();
            scrollCollectionToTop();
        }

        firstBtn.addEventListener('click', () => goToPage(1));
        prevBtn.addEventListener('click', () => goToPage(collectionPaginationState.page - 1));
        nextBtn.addEventListener('click', () => goToPage(collectionPaginationState.page + 1));
        lastBtn.addEventListener('click', () => goToPage(totalPages));
    }

    function bindCollectionSortControls() {
        const sortSelect = document.getElementById('pv-collection-sort-select');

        if (sortSelect instanceof HTMLSelectElement && sortSelect.getAttribute('data-bound') !== '1') {
            sortSelect.setAttribute('data-bound', '1');
            sortSelect.addEventListener('change', () => {
                applyCollectionSortMode(sortSelect.value);
                updateCollectionSortUi();
                saveCollectionSortPreference(getCollectionSortMode());
                renderCollectionPage();
            });
        }

        const storedMode = loadCollectionSortPreference();
        applyCollectionSortMode(storedMode || (sortSelect instanceof HTMLSelectElement ? sortSelect.value : '') || getCollectionSortMode());
        updateCollectionSortUi();
    }

    function getWorkerBase() {
        const defaultWorker = 'https://pokevalutor-v1.lreyperez18.workers.dev';
        return (window?.PV_SECRETS?.PV_API_URL || defaultWorker).replace(/\/$/, '');
    }

    function normalizeVariantNameForCompare(name) {
        return String(name ?? '').trim().toLowerCase();
    }

    function getDefaultVariantNameForCard(cardLike) {
        const selected = safeString(cardLike?.selectedVariant, '').trim();
        if (selected) return selected;

        const variantNames = Array.isArray(cardLike?.variants)
            ? cardLike.variants.map((v) => safeString(v?.name, '').trim()).filter(Boolean)
            : [];
        if (variantNames.length) return '';
        return MASTER_DEFAULT_VARIANT_NAME;
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
            const fallbackName = safeString(fallbackVariant, '').trim();
            const copies = Math.max(1, Math.floor(Number(fallbackCopies) || 0));
            if (fallbackName) {
                out[fallbackName] = copies;
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

    function getOwnedVariantNames(cardLike) {
        const fallbackVariant = getDefaultVariantNameForCard(cardLike);
        const totalCopies = getTotalCopiesFromConditionMap(cardLike?.conditionQuantities, cardLike?.selectedCondition);
        const map = normalizeVariantQuantities(cardLike?.variantQuantities, fallbackVariant, totalCopies);
        return Object.entries(map)
            .filter(([, qty]) => Math.floor(Number(qty)) > 0)
            .map(([name]) => safeString(name, '').trim())
            .filter(Boolean);
    }

    function getRequiredVariantNames(cardLike) {
        const variantNames = Array.isArray(cardLike?.variants)
            ? cardLike.variants
                .map((v) => safeString(v?.name, '').trim())
                .filter(Boolean)
            : [];

        if (variantNames.length) {
            return Array.from(new Set(variantNames));
        }
        return [MASTER_DEFAULT_VARIANT_NAME];
    }

    function findVariantByName(variants, variantName) {
        if (!Array.isArray(variants)) return null;
        const want = normalizeVariantNameForCompare(variantName);
        if (!want) return null;
        return variants.find((v) => normalizeVariantNameForCompare(v?.name) === want) || null;
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
        return DEX_CONDITION_CODES.includes(upper) ? upper : '';
    }

    function getConditionLabel(code) {
        const key = normalizeDexConditionCode(code);
        if (key === 'NM') return 'Near Mint (NM)';
        if (key === 'LP') return 'Lightly Played (LP)';
        if (key === 'MP') return 'Moderately Played (MP)';
        if (key === 'HP') return 'Heavily Played (HP)';
        if (key === 'DM') return 'Damaged (DM)';
        return 'n/a';
    }

    function buildConditionOptionsHtml(selectedCondition) {
        const selected = normalizeDexConditionCode(selectedCondition);
        const options = ['<option value="">Select condition</option>'];
        for (const code of DEX_CONDITION_CODES) {
            const label = getConditionLabel(code);
            const isSelected = selected === code ? 'selected' : '';
            options.push(`<option value="${code}" ${isSelected}>${escapeHtml(label)}</option>`);
        }
        return options.join('');
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
        for (const code of DEX_CONDITION_CODES) {
            const qty = Math.floor(Number(map[code] || 0));
            if (qty > 0) return code;
        }
        return '';
    }

    function getConditionQuantityEntries(conditionQuantities, fallbackCondition) {
        const map = normalizeConditionQuantities(conditionQuantities, fallbackCondition);
        /** @type {Array<{ code: string, qty: number }>} */
        const out = [];
        for (const code of DEX_CONDITION_CODES) {
            const qty = Math.floor(Number(map[code] || 0));
            if (!Number.isFinite(qty) || qty <= 0) continue;
            out.push({ code, qty });
        }
        return out;
    }

    function getTotalCopiesFromConditionMap(conditionQuantities, fallbackCondition) {
        const entries = getConditionQuantityEntries(conditionQuantities, fallbackCondition);
        let total = 0;
        for (const entry of entries) {
            total += entry.qty;
        }
        return total;
    }

    function formatConditionSummary(conditionQuantities, fallbackCondition) {
        const entries = getConditionQuantityEntries(conditionQuantities, fallbackCondition);
        if (!entries.length) return 'n/a';
        return entries.map((x) => `${getConditionLabel(x.code)} x${x.qty}`).join(', ');
    }

    function formatSignedUsdFromCents(centsRaw) {
        const cents = Math.round(Number(centsRaw) || 0);
        const sign = cents > 0 ? '+' : cents < 0 ? '-' : '';
        return `${sign}${formatUsd(Math.abs(cents) / 100)}`;
    }

    function areCollectionTotalsHidden() {
        return Boolean(collectionTotalsState.hidden);
    }

    function applyCollectionTotalsVisibilityUi() {
        const hidden = areCollectionTotalsHidden();
        const totalEl = document.getElementById('pv-collection-total');
        const valueEl = document.getElementById('pv-collection-total-value');
        const amountEl = document.getElementById('pv-collection-total-amount');
        const toggleBtn = document.getElementById('pv-collection-total-toggle');
        const toggleLabelEl = document.getElementById('pv-collection-total-toggle-label');

        if (totalEl) {
            totalEl.classList.toggle('pv-collectionTotal--hidden', hidden);
        }

        if (valueEl) {
            valueEl.textContent = safeString(collectionTotalsState.valueText, 'Value: $0.00');
        } else if (totalEl) {
            totalEl.textContent = safeString(collectionTotalsState.valueText, 'Value: $0.00');
        }

        if (amountEl) {
            amountEl.textContent = safeString(collectionTotalsState.amountText, 'Amount: 0 items • 0 card copies');
        }

        if (toggleBtn) {
            const actionText = hidden ? 'Show' : 'Hide';
            const toggleDescription = `${actionText} collection value and amount`;
            toggleBtn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
            toggleBtn.setAttribute('aria-label', toggleDescription);
            toggleBtn.setAttribute('title', toggleDescription);
        }

        if (toggleLabelEl) {
            toggleLabelEl.textContent = hidden ? 'Show' : 'Hide';
        }
    }

    function setCollectionTotalsHidden(nextHidden, options) {
        const hidden = Boolean(nextHidden);
        collectionTotalsState.hidden = hidden;

        if (options?.persist !== false) {
            saveCollectionTotalsHiddenPreference(hidden);
        }

        applyCollectionTotalsVisibilityUi();
        void loadAndRenderCollectionValueSnapshot();
    }

    function bindCollectionTotalsVisibilityToggle() {
        const toggleBtn = document.getElementById('pv-collection-total-toggle');
        if (!(toggleBtn instanceof HTMLButtonElement)) {
            return;
        }

        if (toggleBtn.getAttribute('data-bound') !== '1') {
            toggleBtn.setAttribute('data-bound', '1');
            toggleBtn.addEventListener('click', () => {
                setCollectionTotalsHidden(!areCollectionTotalsHidden());
            });
        }

        applyCollectionTotalsVisibilityUi();
    }

    function setCollectionTotalValueText(text) {
        collectionTotalsState.valueText = safeString(text, 'Value: $0.00');
        if (areCollectionTotalsHidden()) {
            applyCollectionTotalsVisibilityUi();
            return;
        }

        const totalValueEl = document.getElementById('pv-collection-total-value');
        if (totalValueEl) {
            totalValueEl.textContent = collectionTotalsState.valueText;
            return;
        }

        const totalEl = document.getElementById('pv-collection-total');
        if (totalEl) {
            totalEl.textContent = collectionTotalsState.valueText;
        }
    }

    function setCollectionTotalAmountText(text) {
        collectionTotalsState.amountText = safeString(text, 'Amount: 0 items • 0 card copies');
        if (areCollectionTotalsHidden()) {
            applyCollectionTotalsVisibilityUi();
            return;
        }

        const amountEl = document.getElementById('pv-collection-total-amount');
        if (amountEl) {
            amountEl.textContent = collectionTotalsState.amountText;
        }
    }

    function hideCollectionValueSnapshotTrend() {
        const trendEl = document.getElementById('pv-collection-total-trend');
        if (!trendEl) return;

        trendEl.hidden = true;
        trendEl.textContent = '';
        trendEl.classList.remove('pv-collectionTotalTrend--up', 'pv-collectionTotalTrend--down', 'pv-collectionTotalTrend--flat');
    }

    function renderCollectionValueSnapshotUnavailable() {
        const trendEl = document.getElementById('pv-collection-total-trend');
        if (!trendEl) return;

        trendEl.hidden = false;
        trendEl.textContent = 'Snapshot unavailable';
        trendEl.classList.remove('pv-collectionTotalTrend--up', 'pv-collectionTotalTrend--down');
        trendEl.classList.add('pv-collectionTotalTrend--flat');
    }

    function renderCollectionValueSnapshot(snapshot) {
        const trendEl = document.getElementById('pv-collection-total-trend');
        if (!trendEl) return;

        if (!snapshot || typeof snapshot !== 'object') {
            hideCollectionValueSnapshotTrend();
            return;
        }

        const changeCents = Math.round(Number(snapshot.changeCents || 0));
        const changePercent = Number(snapshot.changePercent || 0);
        const previousValueCents = Math.round(Number(snapshot.previousValueCents || 0));
        const hasPrevious = previousValueCents > 0;

        trendEl.hidden = false;
        trendEl.classList.toggle('pv-collectionTotalTrend--up', changeCents > 0);
        trendEl.classList.toggle('pv-collectionTotalTrend--down', changeCents < 0);
        trendEl.classList.toggle('pv-collectionTotalTrend--flat', changeCents === 0);

        if (hasPrevious) {
            trendEl.textContent = `Since last check: ${formatSignedUsdFromCents(changeCents)} (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)`;
        } else {
            hideCollectionValueSnapshotTrend();
        }
    }

    async function loadAndRenderCollectionValueSnapshot(options) {
        const forceRefresh = Boolean(options?.forceRefresh);
        const authApi = window?.PV_AUTH;
        const user = authApi?.getUser ? authApi.getUser() : null;
        if (!user || !authApi?.loadCollectionValueSnapshot) {
            hideCollectionValueSnapshotTrend();
            return;
        }

        const collectionId = getActiveCollectionId();
        const nowMs = Date.now();
        const errorUntilMs = Number(collectionSnapshotState.errorUntilByCollectionId[collectionId] || 0);

        if (!forceRefresh && errorUntilMs > nowMs) {
            renderCollectionValueSnapshotUnavailable();
            return;
        }

        if (!forceRefresh && Object.prototype.hasOwnProperty.call(collectionSnapshotState.byCollectionId, collectionId)) {
            renderCollectionValueSnapshot(collectionSnapshotState.byCollectionId[collectionId]);
            return;
        }

        if (!forceRefresh && collectionSnapshotState.inFlightByCollectionId[collectionId]) {
            try {
                await collectionSnapshotState.inFlightByCollectionId[collectionId];
            } catch {
                // ignore
            }
            return;
        }

        const request = Promise.resolve(authApi.loadCollectionValueSnapshot(collectionId));
        collectionSnapshotState.inFlightByCollectionId[collectionId] = request;

        try {
            const result = await request;
            const snapshot = result?.snapshot || null;
            delete collectionSnapshotState.errorUntilByCollectionId[collectionId];
            collectionSnapshotState.byCollectionId[collectionId] = snapshot;
            renderCollectionValueSnapshot(snapshot);
        } catch {
            delete collectionSnapshotState.byCollectionId[collectionId];
            collectionSnapshotState.errorUntilByCollectionId[collectionId] = Date.now() + 60 * 1000;
            renderCollectionValueSnapshotUnavailable();
        } finally {
            delete collectionSnapshotState.inFlightByCollectionId[collectionId];
        }
    }

    function readValueCache() {
        try {
            const raw = localStorage.getItem(VALUE_CACHE_KEY);
            if (!raw) return {};
            const parsed = safeParseJson(raw);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch {
            return {};
        }
    }

    function writeValueCache(next) {
        try {
            const safe = (next && typeof next === 'object') ? next : {};
            localStorage.setItem(VALUE_CACHE_KEY, JSON.stringify(safe));
        } catch {
            // ignore
        }
    }

    function readCollectionValueRefreshMap() {
        try {
            const raw = localStorage.getItem(COLLECTION_VALUE_LAST_REFRESH_KEY);
            if (!raw) return {};
            const parsed = safeParseJson(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    function writeCollectionValueRefreshMap(next) {
        try {
            const safe = next && typeof next === 'object' ? next : {};
            localStorage.setItem(COLLECTION_VALUE_LAST_REFRESH_KEY, JSON.stringify(safe));
        } catch {
            // ignore
        }
    }

    function getCollectionLastValueRefreshMs(collectionId) {
        const id = normalizeCollectionId(collectionId, DEX_DEFAULT_COLLECTION_ID);
        const map = readCollectionValueRefreshMap();
        const ts = Number(map[id] || 0);
        return Number.isFinite(ts) && ts > 0 ? ts : 0;
    }

    function setCollectionLastValueRefreshMs(collectionId, ts) {
        const id = normalizeCollectionId(collectionId, DEX_DEFAULT_COLLECTION_ID);
        const map = readCollectionValueRefreshMap();
        map[id] = Number.isFinite(Number(ts)) ? Number(ts) : Date.now();
        writeCollectionValueRefreshMap(map);
    }

    function getCachedValue(cacheKey) {
        const map = readValueCache();
        const hit = map[cacheKey];
        if (!hit || typeof hit !== 'object') return null;

        const savedAt = Number(hit.savedAt || 0);
        const market = Number(hit.market);
        if (!Number.isFinite(savedAt) || !Number.isFinite(market)) return null;
        const ttlMs = String(cacheKey || '').startsWith('sealed:')
            ? SEALED_VALUE_CACHE_TTL_MS
            : VALUE_CACHE_TTL_MS;
        if ((Date.now() - savedAt) > ttlMs) return null;

        return {
            market,
            variantUsed: safeString(hit.variantUsed, ''),
        };
    }

    function setCachedValue(cacheKey, market, variantUsed) {
        const map = readValueCache();
        map[cacheKey] = {
            market: Number(market),
            variantUsed: safeString(variantUsed, ''),
            savedAt: Date.now(),
        };
        writeValueCache(map);
    }

    function readSetCardsCache() {
        try {
            const raw = localStorage.getItem(SET_CARDS_CACHE_KEY);
            if (!raw) return {};
            const parsed = safeParseJson(raw);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch {
            return {};
        }
    }

    function writeSetCardsCache(next) {
        try {
            const safe = (next && typeof next === 'object') ? next : {};
            localStorage.setItem(SET_CARDS_CACHE_KEY, JSON.stringify(safe));
        } catch {
            // ignore
        }
    }

    function getCachedSetCards(expansionId) {
        const id = safeString(expansionId, '').trim();
        if (!id) return null;

        const map = readSetCardsCache();
        const hit = map[id];
        if (!hit || typeof hit !== 'object') return null;

        const savedAt = Number(hit.savedAt || 0);
        const cards = Array.isArray(hit.cards) ? hit.cards : [];
        if (!Number.isFinite(savedAt) || savedAt <= 0) return null;
        if ((Date.now() - savedAt) > SET_CARDS_CACHE_TTL_MS) return null;
        return cards;
    }

    function setCachedSetCards(expansionId, cards) {
        const id = safeString(expansionId, '').trim();
        if (!id) return;

        const map = readSetCardsCache();
        map[id] = {
            savedAt: Date.now(),
            cards: Array.isArray(cards) ? cards : [],
        };
        writeSetCardsCache(map);
    }

    async function fetchJsonWithAuth(url) {
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

        const res = await fetch(url, headers ? { headers } : undefined);
        const text = await res.text();

        let data;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error(`Non-JSON response (${res.status})`);
        }

        if (!res.ok || (data && typeof data === 'object' && data.ok === false)) {
            const msg = data?.error || data?.message || `API error ${res.status}`;
            throw new Error(String(msg));
        }

        return data;
    }

    function mergeUniqueCardsById(target, next) {
        const out = Array.isArray(target) ? target.slice() : [];
        const seen = new Set(out.map((c) => safeString(c?.id, '')));
        for (const card of (Array.isArray(next) ? next : [])) {
            const id = safeString(card?.id, '');
            if (!id || seen.has(id)) continue;
            seen.add(id);
            out.push(card);
        }
        return out;
    }

    async function fetchCardsSearchPage(base, query, page, pageSize) {
        const url = `${base}/cards/search?q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}&lang=en`;
        const data = await fetchJsonWithAuth(url);
        const cards = Array.isArray(data?.data) ? data.data : [];
        const totalCount = Number(data?.totalCount || cards.length);
        const pageNum = Number(data?.page || page);
        const pageSizeNum = Number(data?.pageSize || pageSize);
        const hasMore = Number.isFinite(totalCount)
            ? (pageNum * pageSizeNum) < totalCount
            : cards.length >= pageSize;

        return { cards, hasMore };
    }

    async function fetchSetCardsByExpansion(expansionId) {
        const id = safeString(expansionId, '').trim();
        if (!id) return [];

        const cached = getCachedSetCards(id);
        if (cached) return cached;

        const base = getWorkerBase();
        const queryCandidates = [
            `expansion.id:${id}`,
            `expansion_id:${id}`,
            `expansion:${id}`,
        ];

        let merged = [];
        for (const query of queryCandidates) {
            let page = 1;
            let hasMore = true;
            let hitForQuery = false;

            while (hasMore && page <= SET_SEARCH_MAX_PAGES) {
                const pageData = await fetchCardsSearchPage(base, query, page, SET_SEARCH_PAGE_SIZE);
                if (pageData.cards.length) {
                    hitForQuery = true;
                    merged = mergeUniqueCardsById(merged, pageData.cards);
                }
                hasMore = pageData.hasMore;
                page += 1;
            }

            if (hitForQuery) break;
        }

        setCachedSetCards(id, merged);
        return merged;
    }

    function getMarketForCondition(prices, conditionCode) {
        if (!Array.isArray(prices)) return null;
        const wanted = normalizeDexConditionCode(conditionCode);
        if (!wanted) return null;

        let best = null;
        for (const p of prices) {
            if (!p || typeof p !== 'object') continue;
            const got = normalizeDexConditionCode(p?.condition);
            if (got !== wanted) continue;

            const marketRaw = (p?.market ?? p?.marketPrice ?? p?.market_price ?? null);
            const market = typeof marketRaw === 'number' ? marketRaw : Number(marketRaw);
            if (!Number.isFinite(market)) continue;
            if (best == null || market > best) best = market;
        }
        return best;
    }

    function getBestVariantMarket(variants, selectedVariant, conditionCode) {
        if (!Array.isArray(variants) || !variants.length) return null;

        const chosenName = safeString(selectedVariant, '');
        if (chosenName) {
            const match = findVariantByName(variants, chosenName);
            const market = getMarketForCondition(match?.prices, conditionCode);
            if (market != null) {
                return { market, variantUsed: safeString(match?.name, chosenName) };
            }
        }

        let best = null;
        for (const variant of variants) {
            const market = getMarketForCondition(variant?.prices, conditionCode);
            if (market == null) continue;
            if (!best || market > best.market) {
                best = {
                    market,
                    variantUsed: safeString(variant?.name, ''),
                };
            }
        }
        return best;
    }

    function getBestSealedMarketFromVariants(variants) {
        if (!Array.isArray(variants) || !variants.length) return null;

        /** @type {Array<number>} */
        const markets = [];

        for (const variant of variants) {
            const prices = Array.isArray(variant?.prices) ? variant.prices : [];
            for (const price of prices) {
                const market = Number(price?.market ?? price?.marketPrice ?? price?.market_price ?? null);
                if (Number.isFinite(market) && market > 0) {
                    markets.push(market);
                }
            }
        }

        if (!markets.length) return null;
        markets.sort((a, b) => a - b);
        return markets[0];
    }

    function getSealedPricingIdentity(item) {
        const displayId = safeString(item?.id, '').trim();
        const explicitBaseId = safeString(item?.baseProductId, '').trim();
        const syntheticIdSeparator = displayId.indexOf('::');
        const baseProductId = explicitBaseId
            || (syntheticIdSeparator > 0 ? displayId.slice(0, syntheticIdSeparator) : displayId);
        const localVariants = Array.isArray(item?.variants) ? item.variants : [];
        const variantName = safeString(item?.variantName, '').trim()
            || (syntheticIdSeparator > 0 && localVariants.length === 1
                ? safeString(localVariants[0]?.name, '').trim()
                : '');

        return { displayId, baseProductId, variantName };
    }

    function getTrackedSealedMarketFromVariants(variants, variantName) {
        if (!Array.isArray(variants) || !variants.length) return null;

        const wantedVariant = safeString(variantName, '').trim();
        if (wantedVariant) {
            const match = findVariantByName(variants, wantedVariant);
            if (match) return getBestSealedMarketFromVariants([match]);
        }

        return getBestSealedMarketFromVariants(variants);
    }

    // displayId is item.id: either a raw product ID or a synthetic "baseProductId::variantName"
    // string. Using displayId (not baseProductId) keeps per-variant cache entries separate.
    function buildSealedValueCacheKey(displayId) {
        return `sealed:v2:${safeString(displayId, '').trim()}`;
    }

    function getInFlightRequest(map, key, factory) {
        const existing = map[key];
        if (existing) return existing;

        const request = Promise.resolve()
            .then(factory)
            .finally(() => {
                delete map[key];
            });

        map[key] = request;
        return request;
    }

    async function fetchCardWithPrices(cardId) {
        const id = safeString(cardId, '');
        if (!id) return null;

        return getInFlightRequest(cardPriceRequestInFlightById, id, async () => {
            try {
                let headers;
                try {
                    const tokenRaw = window?.PV_AUTH?.getIdToken ? await window.PV_AUTH.getIdToken(false) : null;
                    const token = String(tokenRaw || '').trim();
                    if (token) headers = { Authorization: `Bearer ${token}` };
                } catch {
                    // ignore
                }

                const url = `${getWorkerBase()}/cards/${encodeURIComponent(id)}?includePrices=1&lang=en`;
                const requestInit = headers ? { headers, cache: 'no-store' } : { cache: 'no-store' };
                const res = await fetch(url, requestInit);
                if (!res.ok) return null;

                const text = await res.text();
                const parsed = safeParseJson(text);
                if (!parsed || typeof parsed !== 'object') return null;
                return parsed?.data || parsed;
            } catch {
                return null;
            }
        });
    }

    async function fetchSealedWithPrices(sealedId) {
        const id = safeString(sealedId, '');
        if (!id) return null;

        return getInFlightRequest(sealedPriceRequestInFlightById, id, async () => {
            try {
                let headers;
                try {
                    const tokenRaw = window?.PV_AUTH?.getIdToken ? await window.PV_AUTH.getIdToken(false) : null;
                    const token = String(tokenRaw || '').trim();
                    if (token) headers = { Authorization: `Bearer ${token}` };
                } catch {
                    // ignore
                }

                const url = `${getWorkerBase()}/sealed/${encodeURIComponent(id)}?includePrices=1`;
                const requestInit = headers ? { headers, cache: 'no-store' } : { cache: 'no-store' };
                const res = await fetch(url, requestInit);
                if (!res.ok) return null;

                const text = await res.text();
                const parsed = safeParseJson(text);
                if (!parsed || typeof parsed !== 'object') return null;
                return parsed?.data || parsed;
            } catch {
                return null;
            }
        });
    }

    async function fetchSealedFromSearchById(sealedId) {
        const id = safeString(sealedId, '').trim();
        if (!id) return null;

        return getInFlightRequest(sealedSearchRequestInFlightById, id, async () => {
            try {
                let headers;
                try {
                    const tokenRaw = window?.PV_AUTH?.getIdToken ? await window.PV_AUTH.getIdToken(false) : null;
                    const token = String(tokenRaw || '').trim();
                    if (token) headers = { Authorization: `Bearer ${token}` };
                } catch {
                    // ignore
                }

                const query = `id:${id}`;
                const url = `${getWorkerBase()}/sealed/search?q=${encodeURIComponent(query)}&page=1&pageSize=10`;
                const requestInit = headers ? { headers, cache: 'no-store' } : { cache: 'no-store' };
                const res = await fetch(url, requestInit);
                if (!res.ok) return null;

                const text = await res.text();
                const parsed = safeParseJson(text);
                if (!parsed || typeof parsed !== 'object') return null;

                const rows = Array.isArray(parsed)
                    ? parsed
                    : (Array.isArray(parsed?.data) ? parsed.data : []);
                return rows.find((row) => safeString(row?.id, '').trim() === id) || null;
            } catch {
                return null;
            }
        });
    }

    function isCollectionItemValueFullyCached(item) {
        if (!item || typeof item !== 'object') return true;

        if (isSealedCollectionItem(item)) {
            const id = safeString(item?.id, '');
            if (!id) return true;
            const sealedCached = getCachedValue(buildSealedValueCacheKey(id));
            return Boolean(sealedCached && Number.isFinite(sealedCached.market) && sealedCached.market > 0);
        }

        const id = safeString(item?.id, '');
        if (!id) return true;

        const selectedVariant = safeString(item?.selectedVariant, '');
        const conditionEntries = getConditionQuantityEntries(item?.conditionQuantities, item?.selectedCondition);
        if (!conditionEntries.length) return true;

        for (const entry of conditionEntries) {
            const code = normalizeDexConditionCode(entry?.code);
            if (!code) continue;
            const cacheKey = `${id}|${selectedVariant}|${code}`;
            const cached = getCachedValue(cacheKey);
            if (!cached || !Number.isFinite(cached.market) || cached.market <= 0) {
                return false;
            }
        }

        return true;
    }

    function shouldAllowCollectionNetworkRefresh(items) {
        const list = Array.isArray(items) ? items : [];
        if (!list.length) return false;

        const collectionId = getActiveCollectionId();
        const lastRefreshMs = getCollectionLastValueRefreshMs(collectionId);
        const refreshDue = !lastRefreshMs || (Date.now() - lastRefreshMs) >= COLLECTION_VALUE_AUTO_REFRESH_INTERVAL_MS;

        if (refreshDue) return true;

        const hasIncompleteCache = list.some((item) => !isCollectionItemValueFullyCached(item));
        return hasIncompleteCache;
    }

    async function getCurrentCardValue(item, options) {
        const allowNetwork = options?.allowNetwork !== false;
        const id = safeString(item?.id, '');
        const conditionCode = normalizeDexConditionCode(item?.selectedCondition);
        if (!id || !conditionCode) return null;

        const selectedVariant = safeString(item?.selectedVariant, '');
        const cacheKey = `${id}|${selectedVariant}|${conditionCode}`;
        const cached = getCachedValue(cacheKey);
        if (cached && Number.isFinite(cached.market)) {
            return cached;
        }

        const localVariants = Array.isArray(item?.variants) ? item.variants : [];
        const localBest = getBestVariantMarket(localVariants, selectedVariant, conditionCode);

        if (allowNetwork) {
            const fetched = await fetchCardWithPrices(id);
            const fetchedVariants = Array.isArray(fetched?.variants) ? fetched.variants : [];
            const sourceVariants = fetchedVariants.length ? fetchedVariants : localVariants;

            const best = getBestVariantMarket(sourceVariants, selectedVariant, conditionCode);
            if (best && Number.isFinite(best.market)) {
                setCachedValue(cacheKey, best.market, best.variantUsed);
                return best;
            }
        }

        if (localBest && Number.isFinite(localBest.market)) {
            return localBest;
        }

        return null;
    }

    async function getCurrentSealedValue(item, options) {
        const allowNetwork = options?.allowNetwork !== false;
        const { displayId, baseProductId, variantName } = getSealedPricingIdentity(item);
        if (!displayId || !baseProductId) return null;

        const cacheKey = buildSealedValueCacheKey(displayId);
        const cached = getCachedValue(cacheKey);
        if (cached && Number.isFinite(cached.market)) {
            return { market: cached.market };
        }

        const localVariants = Array.isArray(item?.variants) ? item.variants : [];
        const localMarket = getTrackedSealedMarketFromVariants(localVariants, variantName);

        if (allowNetwork) {
            const fetchedFromSearch = await fetchSealedFromSearchById(baseProductId);
            const fetched = fetchedFromSearch || await fetchSealedWithPrices(baseProductId);
            const fetchedVariants = Array.isArray(fetched?.variants) ? fetched.variants : [];

            const market = getTrackedSealedMarketFromVariants(fetchedVariants, variantName);
            if (Number.isFinite(market)) {
                setCachedValue(cacheKey, market, '');
                return { market };
            }
        }

        if (Number.isFinite(localMarket)) {
            return { market: localMarket };
        }

        return null;
    }

    async function refreshCollectionValues(items, totalEl, options) {
        if (!totalEl) return;

        const allowNetwork = options?.allowNetwork !== false;

        const list = Array.isArray(items) ? items : [];
        for (const key of Object.keys(collectionValueById)) {
            delete collectionValueById[key];
        }

        if (!list.length) {
            setCollectionTotalValueText('Value: $0.00');
            return { total: 0, totalUnits: 0, pricedUnits: 0 };
        }

        setCollectionTotalValueText('Value: Loading...');

        let total = 0;
        let totalUnits = 0;
        let pricedUnits = 0;

        await Promise.all(list.map(async (item) => {
            const id = safeString(item?.id, '');
            if (!id) return;

            const entryKey = getCollectionEntryKey(item);
            const valueElId = `pv-collection-value-${encodeURIComponent(entryKey)}`;
            const valueEl = document.getElementById(valueElId);

            if (isSealedCollectionItem(item)) {
                const quantity = getSealedCollectionQuantity(item);
                totalUnits += quantity;
                if (valueEl) valueEl.textContent = '...';

                const valueInfo = await getCurrentSealedValue(item, { allowNetwork });
                const market = Number(valueInfo?.market ?? null);
                if (!Number.isFinite(market) || market <= 0) {
                    delete collectionValueById[entryKey];
                    if (valueEl) valueEl.textContent = '--';
                    return;
                }

                pricedUnits += quantity;
                total += market * quantity;
                collectionValueById[entryKey] = market;
                if (valueEl) {
                    valueEl.textContent = formatUsd(market);
                }
                return;
            }

            const conditionEntries = getConditionQuantityEntries(item?.conditionQuantities, item?.selectedCondition);
            const copiesForCard = conditionEntries.reduce((sum, entry) => sum + entry.qty, 0);
            totalUnits += copiesForCard;

            if (valueEl) {
                valueEl.textContent = conditionEntries.length ? '...' : '--';
            }

            if (!conditionEntries.length) {
                delete collectionValueById[entryKey];
                return;
            }

            let cardTotal = 0;
            let cardPricedCopies = 0;
            let cardDisplayUnit = null;
            const primaryCondition = normalizeDexConditionCode(item?.selectedCondition);

            await Promise.all(conditionEntries.map(async (entry) => {
                const valueInfo = await getCurrentCardValue({
                    ...item,
                    selectedCondition: entry.code,
                }, { allowNetwork });
                if (!valueInfo || !Number.isFinite(valueInfo.market)) return;

                cardTotal += valueInfo.market * entry.qty;
                cardPricedCopies += entry.qty;

                if (primaryCondition && entry.code === primaryCondition) {
                    cardDisplayUnit = valueInfo.market;
                }
                if (cardDisplayUnit == null) {
                    cardDisplayUnit = valueInfo.market;
                }
            }));

            if (cardTotal <= 0) {
                delete collectionValueById[entryKey];
                if (valueEl) valueEl.textContent = '--';
                return;
            }

            pricedUnits += cardPricedCopies;
            total += cardTotal;
            collectionValueById[entryKey] = Number.isFinite(cardDisplayUnit) ? Number(cardDisplayUnit) : 0;
            if (valueEl) {
                valueEl.textContent = Number.isFinite(cardDisplayUnit) ? formatUsd(cardDisplayUnit) : '--';
            }
        }));

        const coverage = pricedUnits < totalUnits ? ` (${pricedUnits}/${totalUnits} priced)` : '';
        setCollectionTotalValueText(`Value: ${formatUsd(total)}${coverage}`);

        const grid = document.getElementById('pv-collection-grid');
        applyCollectionSortToGrid(grid);

        return { total, totalUnits, pricedUnits };
    }

    function pickFrontMediumImage(images) {
        if (!Array.isArray(images)) return '';
        const front = images.find((img) => String(img?.type || '').toLowerCase() === 'front');
        return safeString(front?.medium || front?.large || front?.small || images[0]?.medium || images[0]?.large || images[0]?.small, '');
    }

    function getCardSetName(cardLike) {
        const expansionName = safeString(cardLike?.expansion?.name, '');
        const setName = safeString(cardLike?.set?.name, '');
        const directExpansionName = safeString(cardLike?.expansionName, '');
        const directSetName = safeString(cardLike?.setName, '');
        return expansionName || setName || directExpansionName || directSetName || 'n/a';
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

    function getSealedMarketQuote(item) {
        const variants = Array.isArray(item?.variants) ? item.variants : [];
        return getBestSealedMarketFromVariants(variants);
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

    function normalizeSealedCollectionEntry(raw) {
        const addedAt = Number(raw?.addedAt || 0);
        const updatedAt = Number(raw?.updatedAt || 0);
        const quantity = getSealedCollectionQuantity(raw);
        const collectionId = normalizeCollectionId(raw?.collectionId, DEX_DEFAULT_COLLECTION_ID);
        const expansionName = safeString(raw?.expansionName ?? raw?.expansion_name ?? raw?.setName ?? raw?.set_name, '');
        const setName = safeString(raw?.setName ?? raw?.set_name ?? raw?.expansionName ?? raw?.expansion_name, '');

        return {
            itemType: 'sealed',
            collectionId,
            id: safeString(raw?.id, ''),
            baseProductId: safeString(raw?.baseProductId, ''),
            variantName: safeString(raw?.variantName, ''),
            variantLabel: safeString(raw?.variantLabel, ''),
            hasMultipleVariants: raw?.hasMultipleVariants === true,
            name: safeString(raw?.name, 'Unknown'),
            type: safeString(raw?.type, ''),
            expansionName,
            setName,
            expansion: (raw?.expansion && typeof raw.expansion === 'object') ? raw.expansion : null,
            set: (raw?.set && typeof raw.set === 'object') ? raw.set : null,
            images: normalizeImageList(raw?.images),
            variants: Array.isArray(raw?.variants) ? raw.variants : [],
            pricesText: safeString(raw?.pricesText, ''),
            quantity,
            addedAt: Number.isFinite(addedAt) && addedAt > 0 ? addedAt : Date.now(),
            updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
        };
    }

    function normalizeCollectionEntry(raw) {
        const itemType = normalizeCollectionItemType(raw?.itemType);
        if (itemType === 'sealed') {
            return normalizeSealedCollectionEntry(raw);
        }

        const conditionQuantities = normalizeConditionQuantities(raw?.conditionQuantities, raw?.selectedCondition);
        const selectedCondition = getPrimaryConditionCode(conditionQuantities);
        const totalCopies = getTotalCopiesFromConditionMap(conditionQuantities, selectedCondition);
        const fallbackVariant = getDefaultVariantNameForCard(raw);
        const variantQuantities = normalizeVariantQuantities(raw?.variantQuantities, fallbackVariant, totalCopies);
        const selectedVariant = getPrimaryVariantName(variantQuantities, fallbackVariant);
        const collectionId = normalizeCollectionId(raw?.collectionId, DEX_DEFAULT_COLLECTION_ID);
        const cardNumber = getCardDisplayNumber(raw);
        const addedAt = Number(raw?.addedAt || 0);
        const updatedAt = Number(raw?.updatedAt || 0);
        const expansionName = safeString(raw?.expansionName ?? raw?.expansion_name ?? raw?.setName ?? raw?.set_name, '');
        const setName = safeString(raw?.setName ?? raw?.set_name ?? raw?.expansionName ?? raw?.expansion_name, '');

        return {
            itemType: 'card',
            collectionId,
            id: safeString(raw?.id, ''),
            name: safeString(raw?.name, 'Unknown'),
            rarity: safeString(raw?.rarity ?? raw?.rarityName ?? raw?.rarity_name, ''),
            card_no: cardNumber,
            number: cardNumber,
            expansionName,
            setName,
            expansion: (raw?.expansion && typeof raw.expansion === 'object') ? raw.expansion : null,
            set: (raw?.set && typeof raw.set === 'object') ? raw.set : null,
            images: normalizeImageList(raw?.images),
            variants: Array.isArray(raw?.variants) ? raw.variants : [],
            selectedVariant,
            variantQuantities,
            selectedCondition,
            conditionQuantities,
            pricesText: safeString(raw?.pricesText, ''),
            addedAt: Number.isFinite(addedAt) && addedAt > 0 ? addedAt : Date.now(),
            updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
        };
    }

    function readCollection() {
        try {
            const raw = localStorage.getItem(DEX_COLLECTION_KEY);
            if (!raw) return [];
            const parsed = safeParseJson(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter((x) => x && typeof x === 'object' && x.id)
                .map((x) => normalizeCollectionEntry(x));
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
                lastResultsKey: DEX_LAST_RESULTS_KEY,
            });
        }

        try {
            localStorage.setItem(key, serialized);
            return true;
        } catch {
            return false;
        }
    }

    function writeCollection(next, options) {
        let persisted = false;
        try {
            persisted = writeCriticalStorageItem(DEX_COLLECTION_KEY, JSON.stringify(Array.isArray(next) ? next : []));
        } catch {
            persisted = false;
        }

        if (!persisted) return false;

        if (!options?.preserveUpdatedAt) {
            markDexStateUpdated();
        }

        if (!options?.skipCloudSync) {
            queueDexCloudStateSync(Boolean(options?.immediateCloudSync));
        }

        return true;
    }

    function normalizeMasterSetEntry(entry, fallbackExpansionId) {
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

    function normalizeMasterSetsMap(mapLike) {
        /** @type {Record<string, any>} */
        const out = {};
        if (!mapLike || typeof mapLike !== 'object') return out;

        for (const [key, value] of Object.entries(mapLike)) {
            const normalized = normalizeMasterSetEntry(value, key);
            if (!normalized) continue;
            out[normalized.expansionId] = normalized;
        }

        return out;
    }

    function readMasterSets() {
        try {
            const raw = localStorage.getItem(DEX_MASTER_SETS_KEY);
            if (!raw) return {};
            const parsed = safeParseJson(raw);
            if (!parsed || typeof parsed !== 'object') return {};
            return normalizeMasterSetsMap(parsed);
        } catch {
            return {};
        }
    }

    function writeMasterSets(next, options) {
        let persisted = false;
        try {
            const safe = (next && typeof next === 'object') ? next : {};
            persisted = writeCriticalStorageItem(DEX_MASTER_SETS_KEY, JSON.stringify(safe));
        } catch {
            persisted = false;
        }

        if (!persisted) return false;

        if (!options?.preserveUpdatedAt) {
            markDexStateUpdated();
        }

        if (!options?.skipCloudSync) {
            queueDexCloudStateSync(Boolean(options?.immediateCloudSync));
        }

        return true;
    }

    const DEX_CLOUD_SYNC_DEBOUNCE_MS = 450;
    let dexCloudSyncTimer = 0;
    let dexCloudSyncHydrating = false;
    let dexCloudSyncPromise = Promise.resolve();

    function getDexUpdatedAt(value) {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function readDexCloudRevision() {
        try {
            return Math.max(0, Math.floor(Number(localStorage.getItem(DEX_CLOUD_REVISION_KEY)) || 0));
        } catch {
            return 0;
        }
    }

    function writeDexCloudRevision(revision) {
        try {
            localStorage.setItem(DEX_CLOUD_REVISION_KEY, String(Math.max(0, Math.floor(Number(revision) || 0))));
        } catch {
            // ignore
        }
    }

    function readDexStateUpdatedAt() {
        try {
            return getDexUpdatedAt(localStorage.getItem(DEX_STATE_UPDATED_AT_KEY));
        } catch {
            return 0;
        }
    }

    function writeDexStateUpdatedAt(updatedAt) {
        try {
            localStorage.setItem(DEX_STATE_UPDATED_AT_KEY, String(getDexUpdatedAt(updatedAt)));
        } catch {
            // ignore
        }
    }

    function markDexStateUpdated() {
        const nextUpdatedAt = Math.max(Date.now(), readDexStateUpdatedAt() + 1);
        writeDexStateUpdatedAt(nextUpdatedAt);
        return nextUpdatedAt;
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

    function queueDexCloudStateSync(immediate) {
        if (dexCloudSyncHydrating) return;
        const authApi = window?.PV_AUTH;
        const user = authApi?.getUser ? authApi.getUser() : null;
        if (!user || !authApi?.saveDexState) return;

        writeDexOwnerUid(user.uid);

        const run = () => {
            dexCloudSyncPromise = dexCloudSyncPromise
                .catch(() => {
                    // keep later saves moving after a transient failure
                })
                .then(async () => {
                    const payload = {
                        collection: readCollection(),
                        masterSets: readMasterSets(),
                        revision: readDexCloudRevision(),
                        updatedAt: readDexStateUpdatedAt() || Date.now(),
                    };
                    const result = await authApi.saveDexState(payload);
                    return { result, submittedUpdatedAt: payload.updatedAt };
                })
                .then(({ result, submittedUpdatedAt }) => {
                    handleDexCloudSaveResult(result, user.uid, submittedUpdatedAt);
                })
                .catch(() => {
                    // ignore transient sync failures
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

    function handleDexCloudSaveResult(result, ownerUid, submittedUpdatedAt) {
        if (!result || typeof result !== 'object') return;

        if (result.saved) {
            writeDexCloudRevision(result.revision);
            if (readDexStateUpdatedAt() <= getDexUpdatedAt(submittedUpdatedAt)) {
                writeDexStateUpdatedAt(result.updatedAt);
            }
            return;
        }

        if (!result.conflict) return;

        dexCloudSyncHydrating = true;
        try {
            writeCollection(Array.isArray(result.collection) ? result.collection : [], {
                skipCloudSync: true,
                preserveUpdatedAt: true,
            });
            writeMasterSets((result.masterSets && typeof result.masterSets === 'object') ? result.masterSets : {}, {
                skipCloudSync: true,
                preserveUpdatedAt: true,
            });
            writeDexCloudRevision(result.revision);
            writeDexStateUpdatedAt(result.updatedAt);
            writeDexOwnerUid(ownerUid);
            renderActivePage();
            const summary = document.getElementById('pv-collection-summary');
            if (summary) {
                summary.hidden = false;
                summary.textContent = 'A newer collection was found in cloud sync. This page was refreshed without overwriting it.';
            }
        } finally {
            dexCloudSyncHydrating = false;
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            queueDexCloudStateSync(true);
        }
    });

    window.addEventListener('pagehide', () => {
        queueDexCloudStateSync(true);
    });

    function mergeCollectionState(localList, cloudList) {
        /** @type {Map<string, any>} */
        const byId = new Map();

        function addItem(raw) {
            const normalized = normalizeCollectionEntry(raw);
            const id = safeString(normalized?.id, '').trim();
            if (!id) return;

            const entryKey = getCollectionEntryKey(normalized);

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

    function mergeMasterSetsState(localMap, cloudMap, mergedCollection) {
        const local = normalizeMasterSetsMap(localMap);
        const cloud = normalizeMasterSetsMap(cloudMap);
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
            if (!isCardCollectionItem(card)) continue;
            if (normalizeCollectionId(card?.collectionId, DEX_DEFAULT_COLLECTION_ID) !== DEX_DEFAULT_COLLECTION_ID) {
                continue;
            }

            const cardId = safeString(card?.id, '').trim();
            if (!cardId) continue;

            const ex = (card?.expansion && typeof card.expansion === 'object')
                ? card.expansion
                : ((card?.set && typeof card.set === 'object') ? card.set : null);
            const expansionId = safeString(ex?.id, '').trim();
            if (!expansionId) continue;

            const seed = seedByExpansionId[expansionId] || null;
            const existing = merged[expansionId] || null;
            const existingIds = Array.isArray(existing?.cardIds) ? existing.cardIds : [];
            const nextIds = existingIds.includes(cardId) ? existingIds : [...existingIds, cardId];
            const seedUpdatedAt = getDexUpdatedAt(seed?.updatedAt);
            const cardUpdatedAt = getDexUpdatedAt(card?.updatedAt);
            const expansionName = safeString(ex?.name, safeString(card?.expansionName ?? card?.setName, 'Unknown Set'));
            const expansionSeries = safeString(ex?.series, '');
            const expansionImage = safeString(ex?.logo ?? ex?.symbol ?? ex?.image ?? ex?.images?.logo ?? ex?.images?.symbol, '');
            const targetCount = Number(ex?.printed_total ?? ex?.printedTotal ?? ex?.total ?? 0) || null;

            merged[expansionId] = {
                expansionId,
                expansionName: safeString(seed?.expansionName, expansionName),
                series: safeString(seed?.series, expansionSeries),
                setImage: safeString(seed?.setImage, expansionImage),
                targetCount: Number(seed?.targetCount || targetCount || 0) || null,
                cardIds: nextIds,
                count: nextIds.length,
                updatedAt: Math.max(seedUpdatedAt, cardUpdatedAt, Date.now()),
            };
        }

        return merged;
    }

    function syncDexStateFromCloudOnSignIn() {
        if (!window?.PV_AUTH?.loadDexState) return;

        const authApi = window?.PV_AUTH;
        const user = authApi?.getUser ? authApi.getUser() : null;
        const currentUid = String(user?.uid || '').trim();
        if (!currentUid) return;

        const localCollection = readCollection();
        const localMasterSets = readMasterSets();
        const localOwnerUid = readDexOwnerUid();
        const localRevision = readDexCloudRevision();
        const localUpdatedAt = readDexStateUpdatedAt();
        let mergedPayload = null;
        dexCloudSyncHydrating = true;

        Promise.resolve(authApi.loadDexState())
            .then((cloudState) => {
                const cloudCollection = Array.isArray(cloudState?.collection) ? cloudState.collection : [];
                const cloudMasterSets = (cloudState?.masterSets && typeof cloudState.masterSets === 'object')
                    ? cloudState.masterSets
                    : {};
                const cloudRevision = Math.max(0, Math.floor(Number(cloudState?.revision) || 0));
                const cloudUpdatedAt = getDexUpdatedAt(cloudState?.updatedAt);
                const canPushLocalState = localOwnerUid === currentUid
                    && localRevision === cloudRevision
                    && localUpdatedAt > cloudUpdatedAt;

                const resolvedCollection = canPushLocalState ? localCollection : cloudCollection;
                const resolvedMasterSets = canPushLocalState ? localMasterSets : cloudMasterSets;

                if (canPushLocalState) {
                    mergedPayload = {
                        collection: resolvedCollection,
                        masterSets: resolvedMasterSets,
                        revision: cloudRevision,
                        updatedAt: localUpdatedAt,
                    };
                }

                writeCollection(resolvedCollection, { skipCloudSync: true, preserveUpdatedAt: true });
                writeMasterSets(resolvedMasterSets, { skipCloudSync: true, preserveUpdatedAt: true });
                writeDexCloudRevision(cloudRevision);
                writeDexStateUpdatedAt(canPushLocalState ? localUpdatedAt : cloudUpdatedAt);
                writeDexOwnerUid(currentUid);
                renderActivePage();
            })
            .catch(() => {
                // ignore
            })
            .finally(() => {
                dexCloudSyncHydrating = false;

                if (mergedPayload && authApi?.saveDexState) {
                    dexCloudSyncPromise = dexCloudSyncPromise
                        .catch(() => {
                            // keep the restore save ordered after any earlier sync
                        })
                        .then(() => authApi.saveDexState(mergedPayload))
                        .then((result) => handleDexCloudSaveResult(result, currentUid, mergedPayload.updatedAt))
                        .catch(() => {
                            // ignore
                        });
                }
            });
    }

    function updateCollectionConditionQuantity(cardId, conditionCode, delta) {
        const id = safeString(cardId, '');
        const code = normalizeDexConditionCode(conditionCode);
        const activeCollectionId = getActiveCollectionId();
        const qtyDelta = Math.floor(Number(delta));
        if (!id || !code || !Number.isFinite(qtyDelta) || qtyDelta === 0) {
            return { changed: false, removeCard: false, storageWriteFailed: false };
        }

        const collection = readCollection();
        let found = false;
        let changed = false;
        let removeCard = false;

        const nextCollection = collection.map((entry) => {
            if (!isCardCollectionItem(entry) || safeString(entry?.id, '') !== id) return entry;
            if (normalizeCollectionId(entry?.collectionId, DEX_DEFAULT_COLLECTION_ID) !== activeCollectionId) {
                return entry;
            }

            found = true;
            const map = normalizeConditionQuantities(entry?.conditionQuantities, entry?.selectedCondition);
            const currentQty = Math.floor(Number(map[code] || 0));
            const nextQty = Math.max(0, currentQty + qtyDelta);

            if (nextQty === currentQty) return entry;

            changed = true;
            if (nextQty > 0) {
                map[code] = nextQty;
            } else {
                delete map[code];
            }

            if (getTotalCopiesFromConditionMap(map, '') <= 0) {
                removeCard = true;
                return entry;
            }

            return {
                ...entry,
                conditionQuantities: map,
                selectedCondition: getPrimaryConditionCode(map),
                updatedAt: Date.now(),
            };
        });

        if (!found || !changed) {
            return { changed: false, removeCard: false, storageWriteFailed: false };
        }

        if (!removeCard) {
            if (!writeCollection(nextCollection, { immediateCloudSync: true })) {
                return { changed: false, removeCard: false, storageWriteFailed: true };
            }
        }

        return { changed: true, removeCard, storageWriteFailed: false };
    }

    function removeCardFromTrackers(cardId) {
        const id = safeString(cardId, '');
        if (!id) return false;
        const activeCollectionId = getActiveCollectionId();

        const collection = readCollection();
        const nextCollection = collection.filter((x) => {
            if (!isCardCollectionItem(x) || safeString(x?.id, '') !== id) return true;
            const entryCollectionId = normalizeCollectionId(x?.collectionId, DEX_DEFAULT_COLLECTION_ID);
            return entryCollectionId !== activeCollectionId;
        });
        const removedCollection = nextCollection.length !== collection.length;
        if (removedCollection) {
            if (!writeCollection(nextCollection, { immediateCloudSync: true })) {
                return false;
            }
        }

        if (activeCollectionId !== DEX_DEFAULT_COLLECTION_ID) {
            return removedCollection;
        }

        const master = readMasterSets();
        let removedMaster = false;
        for (const key of Object.keys(master)) {
            const entry = master[key];
            if (!entry || typeof entry !== 'object') continue;

            const cardIds = Array.isArray(entry.cardIds)
                ? entry.cardIds.map((x) => safeString(x, '')).filter(Boolean)
                : [];
            if (!cardIds.includes(id)) continue;

            removedMaster = true;
            const nextIds = cardIds.filter((x) => x !== id);
            if (!nextIds.length) {
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

        if (removedMaster) {
            if (!writeMasterSets(master, { immediateCloudSync: true })) {
                return false;
            }
        }

        return removedCollection || removedMaster;
    }

    function updateSealedCollectionQuantity(productId, delta) {
        const id = safeString(productId, '');
        const activeCollectionId = getActiveCollectionId();
        const qtyDelta = Math.floor(Number(delta));
        if (!id || !Number.isFinite(qtyDelta) || qtyDelta === 0) {
            return { changed: false, removeProduct: false, quantity: 0, storageWriteFailed: false };
        }

        const collection = readCollection();
        let found = false;
        let changed = false;
        let removeProduct = false;
        let nextQuantity = 0;

        const nextCollection = collection.map((entry) => {
            if (!(isSealedCollectionItem(entry) && safeString(entry?.id, '') === id)) {
                return entry;
            }

            if (normalizeCollectionId(entry?.collectionId, DEX_DEFAULT_COLLECTION_ID) !== activeCollectionId) {
                return entry;
            }

            found = true;
            const currentQty = getSealedCollectionQuantity(entry);
            const qty = Math.max(0, currentQty + qtyDelta);
            nextQuantity = qty;

            if (qty === currentQty) {
                return entry;
            }

            changed = true;
            if (qty <= 0) {
                removeProduct = true;
                return entry;
            }

            return {
                ...entry,
                quantity: qty,
                updatedAt: Date.now(),
            };
        });

        if (!found || !changed) {
            return { changed: false, removeProduct: false, quantity: nextQuantity, storageWriteFailed: false };
        }

        if (removeProduct) {
            const filtered = nextCollection.filter((entry) => {
                return !(isSealedCollectionItem(entry)
                    && safeString(entry?.id, '') === id
                    && normalizeCollectionId(entry?.collectionId, DEX_DEFAULT_COLLECTION_ID) === activeCollectionId);
            });
            if (!writeCollection(filtered, { immediateCloudSync: true })) {
                return { changed: false, removeProduct: false, quantity: nextQuantity, storageWriteFailed: true };
            }
            return { changed: true, removeProduct: true, quantity: 0, storageWriteFailed: false };
        }

        if (!writeCollection(nextCollection, { immediateCloudSync: true })) {
            return { changed: false, removeProduct: false, quantity: nextQuantity, storageWriteFailed: true };
        }
        return { changed: true, removeProduct: false, quantity: nextQuantity, storageWriteFailed: false };
    }

    function removeSealedProductFromCollection(productId) {
        const id = safeString(productId, '');
        if (!id) return false;
        const activeCollectionId = getActiveCollectionId();

        const collection = readCollection();
        const nextCollection = collection.filter((item) => {
            return !(isSealedCollectionItem(item)
                && safeString(item?.id, '') === id
                && normalizeCollectionId(item?.collectionId, DEX_DEFAULT_COLLECTION_ID) === activeCollectionId);
        });
        if (nextCollection.length === collection.length) {
            return false;
        }

        if (!writeCollection(nextCollection, { immediateCloudSync: true })) {
            return false;
        }
        return true;
    }

    function showDexStorageWriteFailureMessage() {
        const message = storageUtil?.getCollectionStorageWriteFailureMessage
            ? storageUtil.getCollectionStorageWriteFailureMessage()
            : 'Could not save this collection change. Local storage is full; please try again.';
        const summary = document.getElementById('pv-collection-summary');
        if (summary) {
            summary.hidden = false;
            summary.textContent = message;
            return;
        }

        try {
            window.alert(message);
        } catch {
            // ignore
        }
    }

    function buildMasterSetDetailUrl(expansionId, expansionName) {
        const id = safeString(expansionId, '').trim();
        const name = safeString(expansionName, '').trim();
        if (!id) return 'master-set.html';

        const params = new URLSearchParams();
        params.set('expansionId', id);
        if (name) params.set('expansionName', name);
        return `master-set.html?${params.toString()}`;
    }

    function buildCollectionIndexById(collection) {
        /** @type {Record<string, any>} */
        const out = {};
        for (const item of (Array.isArray(collection) ? collection : [])) {
            if (!isCardCollectionItem(item)) continue;
            if (normalizeCollectionId(item?.collectionId, DEX_DEFAULT_COLLECTION_ID) !== DEX_DEFAULT_COLLECTION_ID) continue;
            const id = safeString(item?.id, '');
            if (!id) continue;
            out[id] = item;
        }
        return out;
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

    function splitCardVariants(setCard, collectedCard) {
        const requiredVariants = getRequiredVariantNames(setCard);
        const requiredKeys = requiredVariants.map((v) => normalizeVariantNameForCompare(v));
        const defaultKey = normalizeVariantNameForCompare(MASTER_DEFAULT_VARIANT_NAME);
        const totalCopies = getTotalCopiesFromConditionMap(collectedCard?.conditionQuantities, collectedCard?.selectedCondition);

        if (requiredKeys.length === 1 && requiredKeys[0] === defaultKey) {
            return {
                requiredVariants,
                collectedVariants: totalCopies > 0 ? requiredVariants.slice() : [],
                missingVariants: totalCopies > 0 ? [] : requiredVariants.slice(),
            };
        }

        const ownedVariantKeys = new Set(
            getOwnedVariantNames(collectedCard).map((name) => normalizeVariantNameForCompare(name)).filter(Boolean)
        );

        /** @type {Array<string>} */
        const collectedVariants = [];
        /** @type {Array<string>} */
        const missingVariants = [];

        for (const required of requiredVariants) {
            const key = normalizeVariantNameForCompare(required);
            if (ownedVariantKeys.has(key)) {
                collectedVariants.push(required);
            } else {
                missingVariants.push(required);
            }
        }

        return { requiredVariants, collectedVariants, missingVariants };
    }

    function computeSetVariantProgress(setCards, cardsById) {
        /** @type {Array<any>} */
        const collectedCards = [];
        /** @type {Array<any>} */
        const missingCards = [];
        let collectedUnits = 0;
        let requiredUnits = 0;

        for (const setCard of (Array.isArray(setCards) ? setCards : [])) {
            const id = safeString(setCard?.id, '');
            if (!id) continue;

            const collectedCard = cardsById[id];
            const split = splitCardVariants(setCard, collectedCard);
            requiredUnits += split.requiredVariants.length;
            collectedUnits += split.collectedVariants.length;

            const item = {
                id,
                name: safeString(setCard?.name, 'Unknown'),
                number: getCardDisplayNumber(setCard),
                image: pickFrontMediumImage(setCard?.images),
                collectedVariants: split.collectedVariants,
                missingVariants: split.missingVariants,
                collectedVariantCount: split.collectedVariants.length,
                requiredVariantCount: split.requiredVariants.length,
            };

            if (split.collectedVariants.length) {
                collectedCards.push(item);
            }
            if (split.missingVariants.length) {
                missingCards.push(item);
            }
        }

        const ratio = requiredUnits > 0 ? Math.min(100, (collectedUnits / requiredUnits) * 100) : 0;
        return {
            collectedCards,
            missingCards,
            collectedUnits,
            requiredUnits,
            ratio,
            ratioLabel: ratio >= 10 ? `${Math.round(ratio)}%` : `${ratio.toFixed(1)}%`,
        };
    }

    function getSetImageFromData(entry, setCards, cardsById) {
        let image = safeString(entry?.setImage, '');
        if (image) return image;

        const firstSetCard = Array.isArray(setCards) && setCards.length ? setCards[0] : null;
        image = safeString(
            firstSetCard?.expansion?.logo
            || firstSetCard?.expansion?.symbol
            || firstSetCard?.set?.logo
            || firstSetCard?.set?.symbol,
            ''
        );
        if (image) return image;

        if (firstSetCard) {
            image = pickFrontMediumImage(firstSetCard?.images);
            if (image) return image;
        }

        const cardIds = Array.isArray(entry?.cardIds)
            ? entry.cardIds.map((x) => safeString(x, '')).filter(Boolean)
            : [];
        const firstCollected = cardIds.length ? cardsById[cardIds[0]] : null;
        return pickFrontMediumImage(firstCollected?.images);
    }

    async function hydrateMasterSetCardsWithVariantProgress(entries, cardsById, grid) {
        await Promise.all(entries.map(async (entry) => {
            const expansionId = safeString(entry?.expansionId, '').trim();
            if (!expansionId) return;

            const article = grid.querySelector(`[data-master-set-id="${CSS.escape(expansionId)}"]`);
            if (!(article instanceof HTMLElement)) return;

            try {
                const setCards = await fetchSetCardsByExpansion(expansionId);
                if (!setCards.length) return;

                const progress = computeSetVariantProgress(setCards, cardsById);
                const countEl = article.querySelector('[data-master-count]');
                const barEl = article.querySelector('[data-master-progressbar]');
                const fillEl = article.querySelector('[data-master-progress-fill]');
                const ratioEl = article.querySelector('[data-master-ratio]');
                const imageEl = article.querySelector('[data-master-image]');

                if (countEl) {
                    countEl.textContent = `Collected: ${progress.collectedUnits}/${progress.requiredUnits}`;
                }
                if (barEl instanceof HTMLElement) {
                    barEl.setAttribute('aria-valuenow', String(Math.round(progress.ratio)));
                }
                if (fillEl instanceof HTMLElement) {
                    fillEl.style.width = `${progress.ratio}%`;
                }
                if (ratioEl) {
                    ratioEl.textContent = `${progress.ratioLabel} complete`;
                }

                if (imageEl instanceof HTMLImageElement) {
                    const image = getSetImageFromData(entry, setCards, cardsById);
                    if (image) {
                        imageEl.src = image;
                        imageEl.alt = `${safeString(entry?.expansionName, 'Master set')} set image`;
                        imageEl.hidden = false;
                    }
                }
            } catch {
                // Keep fallback progress if fetch fails.
            }
        }));
    }

    function renderMasterSetDetailCards(list, mode) {
        if (!Array.isArray(list) || !list.length) {
            return `<div class="pv-emptyState">No ${mode} cards in this set.</div>`;
        }

        const rows = list.map((item) => {
            const name = escapeHtml(safeString(item?.name, 'Unknown'));
            const number = escapeHtml(safeString(item?.number, ''));
            const img = escapeAttr(safeString(item?.image, ''));
            const collectedCount = Math.max(0, Math.floor(Number(item?.collectedVariantCount || 0)));
            const requiredCount = Math.max(0, Math.floor(Number(item?.requiredVariantCount || 0)));
            const badge = `${collectedCount}/${requiredCount}`;
            const variants = mode === 'collected'
                ? (Array.isArray(item?.collectedVariants) ? item.collectedVariants : [])
                : (Array.isArray(item?.missingVariants) ? item.missingVariants : []);
            const heading = mode === 'collected' ? 'Collected variants' : 'Missing variants';
            const variantTags = variants.length
                ? variants.map((name) => `<span class="pv-variantTag ${mode === 'missing' ? 'pv-variantTag--missing' : ''}">${escapeHtml(name)}</span>`).join('')
                : '<span class="pv-masterSetDetailCard__meta">None</span>';

            return `
                <article class="pv-masterSetDetailCard">
                    ${img ? `<img class="pv-masterSetDetailCard__image" src="${img}" alt="${name} card image" loading="lazy"/>` : ''}
                    <div class="pv-masterSetDetailCard__content">
                        <div class="pv-masterSetDetailCard__titleRow">
                            <h3 class="pv-masterSetDetailCard__title">${name}${number ? ` <span class="pv-masterSetDetailCard__number">#${number}</span>` : ''}</h3>
                            <span class="pv-variantProgressBadge" aria-label="Collected variants ${badge}">${badge}</span>
                        </div>
                        <p class="pv-masterSetDetailCard__meta">${heading}</p>
                        <div class="pv-variantTagList">${variantTags}</div>
                    </div>
                </article>
            `;
        }).join('');

        return `<div class="pv-masterSetDetailGrid">${rows}</div>`;
    }

    function syncCollectionValuesFromCache(items) {
        for (const item of (Array.isArray(items) ? items : [])) {
            const entryKey = getCollectionEntryKey(item);

            if (isSealedCollectionItem(item)) {
                const id = safeString(item?.id, '');
                if (!id) continue;
                const cached = getCachedValue(buildSealedValueCacheKey(id));
                if (cached && Number.isFinite(cached.market) && cached.market > 0) {
                    collectionValueById[entryKey] = cached.market;
                }
                continue;
            }

            const id = safeString(item?.id, '');
            if (!id) continue;
            const selectedVariant = safeString(item?.selectedVariant, '');
            const conditionEntries = getConditionQuantityEntries(item?.conditionQuantities, item?.selectedCondition);
            const primaryCondition = normalizeDexConditionCode(item?.selectedCondition);
            let cardDisplayUnit = null;
            let primaryValue = null;

            for (const entry of conditionEntries) {
                const cacheKey = `${id}|${selectedVariant}|${entry.code}`;
                const cached = getCachedValue(cacheKey);
                if (!cached || !Number.isFinite(cached.market) || cached.market <= 0) continue;
                if (primaryCondition && entry.code === primaryCondition) {
                    primaryValue = cached.market;
                }
                if (cardDisplayUnit == null) {
                    cardDisplayUnit = cached.market;
                }
            }

            if (primaryValue != null) cardDisplayUnit = primaryValue;
            if (Number.isFinite(cardDisplayUnit) && cardDisplayUnit > 0) {
                collectionValueById[entryKey] = cardDisplayUnit;
            }
        }
    }

    function renderCollectionPage() {
        const grid = document.getElementById('pv-collection-grid');
        const summary = document.getElementById('pv-collection-summary');
        const totalEl = document.getElementById('pv-collection-total');
        const filterInput = document.getElementById('pv-collection-filter');
        const typeFilterSelect = document.getElementById('pv-collection-type-filter');
        const paginationEl = document.getElementById('pv-collection-pagination');
        if (!grid || !summary || !totalEl) return;

        bindCollectionTotalsVisibilityToggle();

        const activeCollectionId = getActiveCollectionId();
        const items = readCollection()
            .filter((item) => normalizeCollectionId(item?.collectionId, DEX_DEFAULT_COLLECTION_ID) === activeCollectionId)
            .slice()
            .sort((a, b) => Number(b?.addedAt || 0) - Number(a?.addedAt || 0));
        const cardItems = items.filter((item) => isCardCollectionItem(item));
        const sealedItems = items.filter((item) => isSealedCollectionItem(item));
        const totalCardCopies = cardItems.reduce((sum, item) => {
            return sum + getTotalCopiesFromConditionMap(item?.conditionQuantities, item?.selectedCondition);
        }, 0);

        let selectedType = loadCollectionTypeFilterPreference();
        if (typeFilterSelect instanceof HTMLSelectElement) {
            if (typeFilterSelect.getAttribute('data-bound') === '1') {
                selectedType = normalizeCollectionTypeFilter(typeFilterSelect.value);
            }
            typeFilterSelect.value = selectedType;
        }

        const typeFilteredItems = items.filter((item) => {
            if (selectedType === 'card') return isCardCollectionItem(item);
            if (selectedType === 'sealed') return isSealedCollectionItem(item);
            return true;
        });

        const filterQuery = (filterInput instanceof HTMLInputElement)
            ? safeString(filterInput.value, '').trim()
            : '';

        function getCollectionSearchFields(item) {
            if (isSealedCollectionItem(item)) {
                return [
                    safeString(item?.name, ''),
                    getCardSetName(item),
                    safeString(item?.type, ''),
                    safeString(item?.id, ''),
                ];
            }

            return [
                safeString(item?.name, ''),
                getCardSetName(item),
                getCardDisplayNumber(item),
                safeString(item?.id, ''),
            ];
        }

        syncCollectionValuesFromCache(typeFilteredItems);

        const filteredMatches = filterQuery
            ? typeFilteredItems.map((item) => {
                return {
                    item,
                    score: getTypoTolerantSearchScore(filterQuery, getCollectionSearchFields(item)),
                };
            }).filter((x) => x.score >= 0).sort((a, b) => {
                const diff = b.score - a.score;
                if (diff !== 0) return diff;
                return Number(b?.item?.addedAt || 0) - Number(a?.item?.addedAt || 0);
            })
            : typeFilteredItems.map((item) => ({ item, score: 0 }));

        const filteredItems = filteredMatches.map((x) => x.item);
        const sortedMatches = sortCollectionMatches(filteredMatches);
        const paginationSignature = [
            activeCollectionId,
            selectedType,
            normalizeSearchText(filterQuery),
        ].join('|');
        const pageSize = getCollectionPageSize();

        if (collectionPaginationState.signature !== paginationSignature) {
            collectionPaginationState.signature = paginationSignature;
            collectionPaginationState.page = 1;
        }

        if (collectionPaginationState.perPage !== pageSize) {
            const previousSize = collectionPaginationState.perPage || pageSize;
            const firstVisibleIndex = Math.max(0, (collectionPaginationState.page - 1) * previousSize);
            collectionPaginationState.page = Math.floor(firstVisibleIndex / pageSize) + 1;
            collectionPaginationState.perPage = pageSize;
        }

        const totalPages = Math.max(1, Math.ceil(sortedMatches.length / pageSize));
        collectionPaginationState.page = Math.min(Math.max(1, collectionPaginationState.page), totalPages);
        const pageStart = (collectionPaginationState.page - 1) * pageSize;
        const visibleMatches = sortedMatches.slice(pageStart, pageStart + pageSize);
        const filteredCardCopies = filteredItems.reduce((sum, item) => {
            if (!isCardCollectionItem(item)) return sum;
            return sum + getTotalCopiesFromConditionMap(item?.conditionQuantities, item?.selectedCondition);
        }, 0);
        const filteredCardCount = filteredItems.filter((item) => isCardCollectionItem(item)).length;
        const filteredSealedCount = filteredItems.filter((item) => isSealedCollectionItem(item)).length;
        let collectionSuggestion = '';

        const dexCardsStat = document.getElementById('pv-dex-stat-cards');
        const dexSealedStat = document.getElementById('pv-dex-stat-sealed');
        const dexCopiesStat = document.getElementById('pv-dex-stat-copies');
        if (dexCardsStat) dexCardsStat.textContent = String(cardItems.length);
        if (dexSealedStat) dexSealedStat.textContent = String(sealedItems.length);
        if (dexCopiesStat) dexCopiesStat.textContent = String(totalCardCopies);

        const itemLabel = items.length === 1 ? 'item' : 'items';
        const copyLabel = totalCardCopies === 1 ? 'copy' : 'copies';
        setCollectionTotalAmountText(`Amount: ${items.length} ${itemLabel} • ${totalCardCopies} card ${copyLabel}`);

        if (!items.length) {
            summary.textContent = '0 cards • 0 sealed products.';
        } else if (!typeFilteredItems.length) {
            summary.textContent = selectedType === 'sealed'
                ? '0 sealed products shown.'
                : '0 cards shown • 0 copies.';
        } else if (filterQuery) {
            if (selectedType === 'sealed') {
                summary.textContent = `${filteredItems.length} of ${typeFilteredItems.length} sealed product${typeFilteredItems.length === 1 ? '' : 's'} shown.`;
            } else if (selectedType === 'card') {
                summary.textContent = `${filteredItems.length} of ${typeFilteredItems.length} card${typeFilteredItems.length === 1 ? '' : 's'} shown • ${filteredCardCopies} copies.`;
            } else {
                summary.textContent = `${filteredItems.length} of ${typeFilteredItems.length} items shown • ${filteredCardCount} cards • ${filteredSealedCount} sealed • ${filteredCardCopies} card copies.`;
            }
        } else if (selectedType === 'sealed') {
            summary.textContent = `${sealedItems.length} sealed product${sealedItems.length === 1 ? '' : 's'}.`;
        } else if (selectedType === 'card') {
            summary.textContent = `${cardItems.length} card${cardItems.length === 1 ? '' : 's'} • ${totalCardCopies} cop${totalCardCopies === 1 ? 'y' : 'ies'}.`;
        } else {
            summary.textContent = `${items.length} items • ${cardItems.length} cards • ${sealedItems.length} sealed • ${totalCardCopies} card cop${totalCardCopies === 1 ? 'y' : 'ies'}.`;
        }

        const hideDuplicateSummary = !filterQuery && selectedType === 'all';
        summary.hidden = hideDuplicateSummary;
        if (hideDuplicateSummary) {
            summary.textContent = '';
        }

        bindCollectionSortControls();

        if (!items.length) {
            setCollectionTotalValueText('Value: $0.00');
            grid.innerHTML = '<div class="col-12"><div class="pv-emptyState">No items tracked yet. Add cards from Dex search or sealed products from Sealed.</div></div>';
        } else if (!typeFilteredItems.length) {
            grid.innerHTML = selectedType === 'sealed'
                ? '<div class="col-12"><div class="pv-emptyState">No sealed products tracked yet. Add sealed products from the Sealed page.</div></div>'
                : '<div class="col-12"><div class="pv-emptyState">No cards tracked yet. Use Search Dex to add cards.</div></div>';
        } else if (!filteredItems.length) {
            collectionSuggestion = getDidYouMeanSuggestion(filterQuery, typeFilteredItems.flatMap((item) => getCollectionSearchFields(item)));

            const suggestionHtml = collectionSuggestion
                ? `<p class="pv-searchSuggestionText">Did you mean <button class="pv-button pv-button--secondary btn pv-searchSuggestionBtn" type="button" data-collection-suggestion="${escapeAttr(collectionSuggestion)}">${escapeHtml(collectionSuggestion)}</button>?</p>`
                : '';
            const scopedLabel = selectedType === 'sealed'
                ? 'sealed products'
                : (selectedType === 'card' ? 'cards' : 'items');
            grid.innerHTML = `<div class="col-12"><div class="pv-emptyState">No ${scopedLabel} match that search.${suggestionHtml}</div></div>`;

            if (collectionSuggestion) {
                summary.textContent = `${summary.textContent} Did you mean "${collectionSuggestion}"?`;
            }
        } else {
            const rows = visibleMatches.map((match) => {
                const item = match.item;
                const id = safeString(item?.id, '');
                const entryKey = getCollectionEntryKey(item);
                const cardName = safeString(item?.name, 'Unknown');
                const namePlain = escapeHtml(cardName);
                const name = buildSearchHighlightHtml(cardName, filterQuery);
                const setName = buildSearchHighlightHtml(getCardSetName(item), filterQuery);
                const img = escapeHtml(pickFrontMediumImage(item?.images));
                const relevanceScore = Number(match.score || 0);

                if (isSealedCollectionItem(item)) {
                    const typeLabel = buildSearchHighlightHtml(safeString(item?.type, 'Sealed product'), filterQuery);
                    const valueElId = `pv-collection-value-${encodeURIComponent(entryKey)}`;
                    const quantity = getSealedCollectionQuantity(item);
                    const nameAttr = escapeAttr(cardName);

                    return `
                    <div class="col-6 col-sm-6 col-md-4 col-lg-3 pv-collectionCol" data-entry-key="${escapeAttr(entryKey)}" data-card-name="${escapeAttr(cardName)}" data-search-score="${relevanceScore}">
                        <article class="pv-card pv-dexCard pv-dexCard--sealed h-100" aria-label="${namePlain}">
                            <div class="pv-card__imgLink pv-card__imgLink--sealed" aria-hidden="true">
                                ${img ? `<img class="pv-card__img pv-card__img--sealed" src="${img}" alt="${namePlain} sealed product image"/>` : ''}
                            </div>
                            <div class="pv-card__body">
                                <h3 class="pv-card__title">${name}</h3>
                                <p class="pv-card__text pv-dexCard__setName">${setName}</p>
                                <p class="pv-card__text pv-dexCard__meta">Type: ${typeLabel}</p>
                                <p class="pv-card__text pv-dexCard__meta">Sealed product</p>
                                <p class="pv-card__text pv-dexCard__meta">Quantity: ${quantity}</p>
                                <p class="pv-collectionAmount" id="${escapeAttr(valueElId)}">...</p>
                                <details class="pv-dexCard__manage">
                                    <summary class="pv-dexCard__manageSummary">Manage quantity</summary>
                                    <div class="pv-dexCard__manageBody">
                                        <div class="pv-conditionQtyRow">
                                            <p class="pv-card__text pv-conditionQtyLabel">Collection Qty</p>
                                            <div class="pv-qtyStepper" role="group" aria-label="Adjust sealed quantity for ${nameAttr}">
                                                <button class="pv-button btn pv-qtyBtn" type="button" data-qty-dec-sealed-id="${escapeAttr(id)}" aria-label="Decrease sealed quantity for ${nameAttr}">-</button>
                                                <span class="pv-qtyValue">${quantity}</span>
                                                <button class="pv-button btn pv-qtyBtn" type="button" data-qty-inc-sealed-id="${escapeAttr(id)}" aria-label="Increase sealed quantity for ${nameAttr}">+</button>
                                            </div>
                                        </div>
                                        <button class="pv-button btn pv-removeCardBtn" type="button" data-remove-sealed-id="${escapeAttr(id)}">Remove Sealed</button>
                                    </div>
                                </details>
                            </div>
                        </article>
                    </div>
                `;
                }

                const rarity = escapeHtml(safeString(item?.rarity, 'n/a'));
                const valueElId = `pv-collection-value-${encodeURIComponent(entryKey)}`;
                const conditionEntries = getConditionQuantityEntries(item?.conditionQuantities, item?.selectedCondition);
                const copyCount = conditionEntries.reduce((sum, entry) => sum + entry.qty, 0);
                const addConditionSelectId = `pv-add-condition-${encodeURIComponent(id)}`;
                const addConditionOptions = buildConditionOptionsHtml('');
                const detailPath = buildCardDetailPath(item);
                const detailPathAttr = escapeAttr(detailPath);
                const nameAttr = escapeAttr(cardName);

                const conditionRows = conditionEntries.length
                    ? conditionEntries.map((entry) => {
                        const label = escapeHtml(getConditionLabel(entry.code));
                        const code = escapeAttr(entry.code);
                        return `
                                    <div class="pv-conditionQtyRow">
                                        <p class="pv-card__text pv-conditionQtyLabel">${label}</p>
                                        <div class="pv-qtyStepper" role="group" aria-label="Adjust ${code} quantity for ${nameAttr}">
                                            <button class="pv-button btn pv-qtyBtn" type="button" data-qty-dec-card-id="${escapeAttr(id)}" data-qty-condition="${code}" aria-label="Decrease ${code} quantity for ${nameAttr}">-</button>
                                            <span class="pv-qtyValue">${entry.qty}</span>
                                            <button class="pv-button btn pv-qtyBtn" type="button" data-qty-inc-card-id="${escapeAttr(id)}" data-qty-condition="${code}" aria-label="Increase ${code} quantity for ${nameAttr}">+</button>
                                        </div>
                                    </div>
                                `;
                    }).join('')
                    : '<p class="pv-card__text">No copies tracked.</p>';

                return `
                    <div class="col-6 col-sm-6 col-md-4 col-lg-3 pv-collectionCol" data-entry-key="${escapeAttr(entryKey)}" data-card-id="${escapeAttr(id)}" data-card-name="${escapeAttr(cardName)}" data-search-score="${relevanceScore}">
                        <article class="pv-card pv-dexCard pv-dexCard--card h-100" aria-label="${namePlain}">
                            ${img ? `<a class="pv-card__imgLink" href="${detailPathAttr}" aria-label="View ${nameAttr} details"><img class="pv-card__img" src="${img}" alt="${namePlain} card image"/></a>` : ''}
                            <div class="pv-card__body">
                                <h3 class="pv-card__title"><a class="pv-card__titleLink" href="${detailPathAttr}" aria-label="View ${nameAttr} details">${name}</a></h3>
                                <p class="pv-card__text pv-dexCard__setName">${setName}</p>
                                <p class="pv-card__text pv-dexCard__meta">${rarity}</p>
                                <p class="pv-card__text pv-dexCard__meta">Copies: ${copyCount}</p>
                                <p class="pv-collectionAmount" id="${escapeAttr(valueElId)}">${conditionEntries.length ? '...' : '--'}</p>
                                <details class="pv-dexCard__manage">
                                    <summary class="pv-dexCard__manageSummary">Manage copies</summary>
                                    <div class="pv-dexCard__manageBody">
                                        <div class="pv-conditionQtyList">
                                            ${conditionRows}
                                        </div>
                                        <div class="pv-conditionAddRow">
                                            <select id="${escapeAttr(addConditionSelectId)}" class="form-select pv-conditionSelect" aria-label="Select condition to add for ${nameAttr}">
                                                ${addConditionOptions}
                                            </select>
                                            <button class="pv-button btn pv-addConditionBtn" type="button" data-add-condition-card-id="${escapeAttr(id)}" data-add-condition-select-id="${escapeAttr(addConditionSelectId)}">Add Copy</button>
                                        </div>
                                        <button class="pv-button btn pv-removeCardBtn" type="button" data-remove-card-id="${escapeHtml(id)}">Remove Card</button>
                                    </div>
                                </details>
                            </div>
                        </article>
                    </div>
                `;
            }).join('');

            grid.innerHTML = rows;
            applyCollectionSortToGrid(grid);

            const removeButtons = Array.from(grid.querySelectorAll('[data-remove-card-id]'));
            for (const btn of removeButtons) {
                btn.addEventListener('click', () => {
                    const id = safeString(btn.getAttribute('data-remove-card-id'), '');
                    if (!id) return;
                    const ok = window.confirm('Remove this card from Collection?');
                    if (!ok) return;
                    const removed = removeCardFromTrackers(id);
                    if (!removed) {
                        showDexStorageWriteFailureMessage();
                        return;
                    }
                    renderActivePage();
                });
            }

            const removeSealedButtons = Array.from(grid.querySelectorAll('[data-remove-sealed-id]'));
            for (const btn of removeSealedButtons) {
                btn.addEventListener('click', () => {
                    const id = safeString(btn.getAttribute('data-remove-sealed-id'), '');
                    if (!id) return;
                    const ok = window.confirm('Remove this sealed product from Collection?');
                    if (!ok) return;
                    const removed = removeSealedProductFromCollection(id);
                    if (!removed) {
                        showDexStorageWriteFailureMessage();
                        return;
                    }
                    renderCollectionPage();
                });
            }

            const incrementSealedButtons = Array.from(grid.querySelectorAll('[data-qty-inc-sealed-id]'));
            for (const btn of incrementSealedButtons) {
                btn.addEventListener('click', () => {
                    const id = safeString(btn.getAttribute('data-qty-inc-sealed-id'), '');
                    if (!id) return;

                    const result = updateSealedCollectionQuantity(id, 1);
                    if (result.storageWriteFailed) {
                        showDexStorageWriteFailureMessage();
                        return;
                    }
                    if (!result.changed) return;
                    renderCollectionPage();
                });
            }

            const decrementSealedButtons = Array.from(grid.querySelectorAll('[data-qty-dec-sealed-id]'));
            for (const btn of decrementSealedButtons) {
                btn.addEventListener('click', () => {
                    const id = safeString(btn.getAttribute('data-qty-dec-sealed-id'), '');
                    if (!id) return;

                    const result = updateSealedCollectionQuantity(id, -1);
                    if (result.storageWriteFailed) {
                        showDexStorageWriteFailureMessage();
                        return;
                    }
                    if (!result.changed) return;
                    renderCollectionPage();
                });
            }

            const incrementButtons = Array.from(grid.querySelectorAll('[data-qty-inc-card-id]'));
            for (const btn of incrementButtons) {
                btn.addEventListener('click', () => {
                    const cardId = safeString(btn.getAttribute('data-qty-inc-card-id'), '');
                    const code = normalizeDexConditionCode(btn.getAttribute('data-qty-condition'));
                    if (!cardId || !code) return;

                    const result = updateCollectionConditionQuantity(cardId, code, 1);
                    if (result.storageWriteFailed) {
                        showDexStorageWriteFailureMessage();
                        return;
                    }
                    if (!result.changed) return;
                    renderCollectionPage();
                });
            }

            const decrementButtons = Array.from(grid.querySelectorAll('[data-qty-dec-card-id]'));
            for (const btn of decrementButtons) {
                btn.addEventListener('click', () => {
                    const cardId = safeString(btn.getAttribute('data-qty-dec-card-id'), '');
                    const code = normalizeDexConditionCode(btn.getAttribute('data-qty-condition'));
                    if (!cardId || !code) return;

                    const result = updateCollectionConditionQuantity(cardId, code, -1);
                    if (result.storageWriteFailed) {
                        showDexStorageWriteFailureMessage();
                        return;
                    }
                    if (!result.changed) return;

                    if (result.removeCard) {
                        const ok = window.confirm('No copies left. Remove this card from Collection?');
                        if (!ok) return;
                        const removed = removeCardFromTrackers(cardId);
                        if (!removed) {
                            showDexStorageWriteFailureMessage();
                            return;
                        }
                        renderActivePage();
                        return;
                    }

                    renderCollectionPage();
                });
            }

            const addConditionButtons = Array.from(grid.querySelectorAll('[data-add-condition-card-id]'));
            for (const btn of addConditionButtons) {
                btn.addEventListener('click', () => {
                    const cardId = safeString(btn.getAttribute('data-add-condition-card-id'), '');
                    const selectId = safeString(btn.getAttribute('data-add-condition-select-id'), '');
                    if (!cardId || !selectId) return;

                    const selectEl = document.getElementById(selectId);
                    if (!(selectEl instanceof HTMLSelectElement)) return;

                    const code = normalizeDexConditionCode(selectEl.value);
                    if (!code) {
                        selectEl.focus();
                        return;
                    }

                    const result = updateCollectionConditionQuantity(cardId, code, 1);
                    if (result.storageWriteFailed) {
                        showDexStorageWriteFailureMessage();
                        return;
                    }
                    if (!result.changed) return;
                    renderCollectionPage();
                });
            }
        }

        const suggestionButton = grid.querySelector('[data-collection-suggestion]');
        if (suggestionButton && filterInput instanceof HTMLInputElement) {
            suggestionButton.addEventListener('click', () => {
                filterInput.value = safeString(suggestionButton.getAttribute('data-collection-suggestion'), '');
                collectionPaginationState.page = 1;
                renderCollectionPage();
                filterInput.focus();
                filterInput.select();
            });
        }

        renderCollectionPagination(paginationEl, {
            totalItems: filteredItems.length,
            pageSize,
            currentPage: collectionPaginationState.page,
        });

        if (items.length) {
            const allowNetworkRefresh = shouldAllowCollectionNetworkRefresh(items);
            void refreshCollectionValues(items, totalEl, { allowNetwork: allowNetworkRefresh })
                .then((result) => {
                    if (!allowNetworkRefresh) return;
                    const pricedUnits = Number(result?.pricedUnits || 0);
                    if (pricedUnits > 0) {
                        setCollectionLastValueRefreshMs(getActiveCollectionId(), Date.now());
                        // Re-render so pagination boundaries use the freshly loaded prices.
                        renderCollectionPage();
                    }
                })
                .catch(() => {
                    // ignore
                });
        }

        void loadAndRenderCollectionValueSnapshot();

        if (filterInput instanceof HTMLInputElement && filterInput.getAttribute('data-bound') !== '1') {
            filterInput.setAttribute('data-bound', '1');
            filterInput.addEventListener('input', () => {
                collectionPaginationState.page = 1;
                renderCollectionPage();
            });
        }

        if (typeFilterSelect instanceof HTMLSelectElement && typeFilterSelect.getAttribute('data-bound') !== '1') {
            typeFilterSelect.setAttribute('data-bound', '1');
            typeFilterSelect.value = loadCollectionTypeFilterPreference();
            typeFilterSelect.addEventListener('change', () => {
                const next = normalizeCollectionTypeFilter(typeFilterSelect.value);
                typeFilterSelect.value = next;
                saveCollectionTypeFilterPreference(next);
                collectionPaginationState.page = 1;
                renderCollectionPage();
            });
        }

    }

    function renderMasterSetsPage() {
        const grid = document.getElementById('pv-master-sets-grid');
        const summary = document.getElementById('pv-master-sets-summary');
        const filterInput = document.getElementById('pv-master-sets-filter');
        if (!grid || !summary) return;

        const activeCollectionId = getActiveCollectionId();
        if (activeCollectionId !== DEX_DEFAULT_COLLECTION_ID) {
            summary.textContent = 'Master Sets are available on the Default Collection.';
            grid.innerHTML = '<div class="pv-emptyState">Switch back to Default Collection to view Master Sets progress.</div>';
            return;
        }

        const map = readMasterSets();
        const entries = Object.values(map)
            .filter((x) => x && typeof x === 'object')
            .sort((a, b) => {
                const aUpdated = Number(a?.updatedAt || 0);
                const bUpdated = Number(b?.updatedAt || 0);
                return bUpdated - aUpdated;
            });

        const filterQuery = (filterInput instanceof HTMLInputElement)
            ? safeString(filterInput.value, '').trim()
            : '';
        const filteredMatches = filterQuery
            ? entries.map((entry) => {
                const searchFields = [
                    safeString(entry?.expansionName, ''),
                    safeString(entry?.series, ''),
                    safeString(entry?.expansionId, ''),
                ];
                return {
                    entry,
                    score: getTypoTolerantSearchScore(filterQuery, searchFields),
                };
            }).filter((x) => x.score >= 0).sort((a, b) => {
                const diff = b.score - a.score;
                if (diff !== 0) return diff;
                return Number(b?.entry?.updatedAt || 0) - Number(a?.entry?.updatedAt || 0);
            })
            : entries.map((entry) => ({ entry, score: 0 }));
        const filteredEntries = filteredMatches.map((x) => x.entry);
        let masterSetSuggestion = '';

        if (!entries.length) {
            summary.textContent = '0 sets tracked.';
            grid.innerHTML = '<div class="pv-emptyState">No master sets tracked yet.</div>';
        } else {
            summary.textContent = filterQuery
                ? `${filteredEntries.length} of ${entries.length} set${entries.length === 1 ? '' : 's'} shown.`
                : `${entries.length} set${entries.length === 1 ? '' : 's'} tracked.`;

            if (!filteredEntries.length) {
                masterSetSuggestion = getDidYouMeanSuggestion(filterQuery, entries.flatMap((entry) => {
                    return [
                        safeString(entry?.expansionName, ''),
                        safeString(entry?.series, ''),
                        safeString(entry?.expansionId, ''),
                    ];
                }));

                const suggestionHtml = masterSetSuggestion
                    ? `<p class="pv-searchSuggestionText">Did you mean <button class="pv-button pv-button--secondary btn pv-searchSuggestionBtn" type="button" data-master-suggestion="${escapeAttr(masterSetSuggestion)}">${escapeHtml(masterSetSuggestion)}</button>?</p>`
                    : '';
                grid.innerHTML = `<div class="pv-emptyState">No master sets match that search.${suggestionHtml}</div>`;

                if (masterSetSuggestion) {
                    summary.textContent = `${filteredEntries.length} of ${entries.length} set${entries.length === 1 ? '' : 's'} shown. Did you mean "${masterSetSuggestion}"?`;
                }
            } else {
                const collection = readCollection();
                const cardsById = buildCollectionIndexById(collection);

                const rows = filteredMatches.map((match) => {
                    const entry = match.entry;
                    const setNameRaw = safeString(entry?.expansionName, 'Unknown Set');
                    const setNamePlain = escapeHtml(setNameRaw);
                    const setName = buildSearchHighlightHtml(setNameRaw, filterQuery);
                    const seriesRaw = safeString(entry?.series, '');
                    const series = buildSearchHighlightHtml(seriesRaw, filterQuery);
                    const count = Number(entry?.count || (Array.isArray(entry?.cardIds) ? entry.cardIds.length : 0) || 0);
                    const target = Number(entry?.targetCount || 0);
                    const ratio = target > 0 ? Math.min(100, (count / target) * 100) : 0;
                    const ratioLabel = ratio >= 10 ? `${Math.round(ratio)}%` : `${ratio.toFixed(1)}%`;
                    const countText = target > 0 ? `${count}/${target}` : `${count}`;
                    const cardIds = Array.isArray(entry?.cardIds)
                        ? entry.cardIds.map((x) => safeString(x, '')).filter(Boolean)
                        : [];
                    const expansionId = safeString(entry?.expansionId, '');
                    const detailUrl = escapeAttr(buildMasterSetDetailUrl(expansionId, setNameRaw));
                    const firstCard = cardIds.length ? cardsById[cardIds[0]] : null;
                    const imageSrc = safeString(entry?.setImage, '') || pickFrontMediumImage(firstCard?.images);
                    const imageHtml = imageSrc
                        ? `<img class="pv-masterSetCard__image" src="${escapeAttr(imageSrc)}" alt="${setNamePlain} set image" loading="lazy" data-master-image="1"/>`
                        : `<img class="pv-masterSetCard__image" alt="${setNamePlain} set image" hidden data-master-image="1"/>`;

                    return `
                    <article class="pv-masterSetCard" data-master-set-id="${escapeAttr(expansionId)}">
                        ${imageHtml}
                        <h3 class="pv-masterSetCard__title"><a class="pv-masterSetCard__titleLink" href="${detailUrl}">${setName}</a></h3>
                        <p class="pv-masterSetCard__meta">${series || 'Series n/a'}</p>
                        <p class="pv-masterSetCard__meta" data-master-count>Collected: ${escapeHtml(countText)}</p>
                        <div class="pv-masterSetProgress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(ratio)}" data-master-progressbar>
                            <span style="width:${ratio}%" data-master-progress-fill></span>
                        </div>
                        <p class="pv-masterSetCard__meta" data-master-ratio>${ratioLabel} complete</p>
                    </article>
                `;
                }).join('');

                grid.innerHTML = rows;
                void hydrateMasterSetCardsWithVariantProgress(filteredEntries, cardsById, grid);
            }
        }

        const masterSuggestionButton = grid.querySelector('[data-master-suggestion]');
        if (masterSuggestionButton && filterInput instanceof HTMLInputElement) {
            masterSuggestionButton.addEventListener('click', () => {
                filterInput.value = safeString(masterSuggestionButton.getAttribute('data-master-suggestion'), '');
                renderMasterSetsPage();
                filterInput.focus();
                filterInput.select();
            });
        }

        if (filterInput instanceof HTMLInputElement && filterInput.getAttribute('data-bound') !== '1') {
            filterInput.setAttribute('data-bound', '1');
            filterInput.addEventListener('input', () => {
                renderMasterSetsPage();
            });
        }

    }

    async function renderMasterSetDetailPage() {
        const titleEl = document.getElementById('pv-master-set-detail-title');
        const seriesEl = document.getElementById('pv-master-set-detail-series');
        const imageEl = document.getElementById('pv-master-set-detail-image');
        const countEl = document.getElementById('pv-master-set-detail-count');
        const ratioEl = document.getElementById('pv-master-set-detail-ratio');
        const progressBar = document.getElementById('pv-master-set-detail-progress');
        const progressFill = document.getElementById('pv-master-set-detail-progress-fill');
        const statusEl = document.getElementById('pv-master-set-detail-status');
        const collectedCountEl = document.getElementById('pv-master-set-collected-count');
        const missingCountEl = document.getElementById('pv-master-set-missing-count');
        const collectedListEl = document.getElementById('pv-master-set-collected-list');
        const missingListEl = document.getElementById('pv-master-set-missing-list');

        if (!titleEl || !seriesEl || !countEl || !ratioEl || !progressBar || !progressFill || !statusEl || !collectedCountEl || !missingCountEl || !collectedListEl || !missingListEl) {
            return;
        }

        const activeCollectionId = getActiveCollectionId();
        if (activeCollectionId !== DEX_DEFAULT_COLLECTION_ID) {
            titleEl.textContent = 'Master Set';
            seriesEl.textContent = 'Default Collection only';
            countEl.textContent = 'Collected: 0/0 variants';
            ratioEl.textContent = 'Progress: 0.0%';
            progressBar.setAttribute('aria-valuenow', '0');
            progressFill.style.width = '0%';
            collectedCountEl.textContent = '0 cards';
            missingCountEl.textContent = '0 cards';
            collectedListEl.innerHTML = '<div class="pv-emptyState">Master set details are only available for Default Collection.</div>';
            missingListEl.innerHTML = '<div class="pv-emptyState">Switch back to Default Collection to continue.</div>';
            statusEl.textContent = 'Master Sets are tied to Default Collection.';
            return;
        }

        const params = new URLSearchParams(window.location.search);
        const expansionId = safeString(params.get('expansionId'), '').trim();
        const expansionNameFromQuery = safeString(params.get('expansionName'), '').trim();

        if (!expansionId) {
            titleEl.textContent = expansionNameFromQuery || 'Master Set';
            statusEl.textContent = 'No set selected.';
            collectedListEl.innerHTML = '<div class="pv-emptyState">No set selected.</div>';
            missingListEl.innerHTML = '<div class="pv-emptyState">No set selected.</div>';
            return;
        }

        const masterMap = readMasterSets();
        const entry = masterMap[expansionId] && typeof masterMap[expansionId] === 'object'
            ? masterMap[expansionId]
            : null;

        const setName = safeString(entry?.expansionName, expansionNameFromQuery || 'Unknown Set');
        const series = safeString(entry?.series, '');
        titleEl.textContent = setName;
        seriesEl.textContent = series || 'Series n/a';
        statusEl.textContent = 'Loading cards...';

        const collection = readCollection();
        const cardsById = buildCollectionIndexById(collection);

        try {
            const setCards = await fetchSetCardsByExpansion(expansionId);
            if (!setCards.length) {
                countEl.textContent = 'Collected: 0/0 variants';
                ratioEl.textContent = 'Progress: 0.0%';
                progressBar.setAttribute('aria-valuenow', '0');
                progressFill.style.width = '0%';
                collectedCountEl.textContent = '0 cards';
                missingCountEl.textContent = '0 cards';
                collectedListEl.innerHTML = '<div class="pv-emptyState">No cards loaded.</div>';
                missingListEl.innerHTML = '<div class="pv-emptyState">No missing cards.</div>';
                statusEl.textContent = 'Set unavailable right now.';
                return;
            }

            const progress = computeSetVariantProgress(setCards, cardsById);
            countEl.textContent = `Collected: ${progress.collectedUnits}/${progress.requiredUnits} variants`;
            ratioEl.textContent = `Progress: ${progress.ratioLabel}`;
            progressBar.setAttribute('aria-valuenow', String(Math.round(progress.ratio)));
            progressFill.style.width = `${progress.ratio}%`;
            collectedCountEl.textContent = `${progress.collectedCards.length} cards`;
            missingCountEl.textContent = `${progress.missingCards.length} cards`;
            collectedListEl.innerHTML = renderMasterSetDetailCards(progress.collectedCards, 'collected');
            missingListEl.innerHTML = renderMasterSetDetailCards(progress.missingCards, 'missing');

            if (imageEl instanceof HTMLImageElement) {
                const setImage = getSetImageFromData(entry, setCards, cardsById);
                if (setImage) {
                    imageEl.src = setImage;
                    imageEl.alt = `${setName} set image`;
                    imageEl.hidden = false;
                }
            }

            statusEl.textContent = `${setCards.length} card${setCards.length === 1 ? '' : 's'} loaded.`;
        } catch {
            countEl.textContent = 'Collected: 0/0 variants';
            ratioEl.textContent = 'Progress: 0.0%';
            progressBar.setAttribute('aria-valuenow', '0');
            progressFill.style.width = '0%';
            collectedCountEl.textContent = '0 cards';
            missingCountEl.textContent = '0 cards';
            collectedListEl.innerHTML = '<div class="pv-emptyState">Unable to load collected cards.</div>';
            missingListEl.innerHTML = '<div class="pv-emptyState">Unable to load missing cards.</div>';
            statusEl.textContent = 'Unable to load this set.';
        }
    }

    function renderActivePage() {
        renderCollectionPage();
        renderMasterSetsPage();
        void renderMasterSetDetailPage();
    }

    document.addEventListener('DOMContentLoaded', () => {
        setCollectionTotalsHidden(loadCollectionTotalsHiddenPreference(), { persist: false });
        renderActivePage();

        try {
            if (!collectionPageSizeMediaBound && window?.matchMedia) {
                const mediaQuery = window.matchMedia(COLLECTION_PAGE_BREAKPOINT_QUERY);
                const handleBreakpointChange = () => {
                    renderCollectionPage();
                };

                if (typeof mediaQuery.addEventListener === 'function') {
                    mediaQuery.addEventListener('change', handleBreakpointChange);
                } else if (typeof mediaQuery.addListener === 'function') {
                    mediaQuery.addListener(handleBreakpointChange);
                }
                collectionPageSizeMediaBound = true;
            }
        } catch {
            // ignore
        }

        try {
            if (window?.PV_AUTH?.onAuthStateChanged && window?.PV_AUTH?.loadDexState) {
                window.PV_AUTH.onAuthStateChanged((user) => {
                    if (!user) {
                        collectionSnapshotState.byCollectionId = {};
                        collectionSnapshotState.inFlightByCollectionId = {};
                        collectionSnapshotState.errorUntilByCollectionId = {};
                        hideCollectionValueSnapshotTrend();
                        return;
                    }
                    syncDexStateFromCloudOnSignIn();
                    void loadAndRenderCollectionValueSnapshot({ forceRefresh: true });
                });
            }
        } catch {
            // ignore
        }

        window.addEventListener('storage', renderActivePage);
        window.addEventListener('pv:dex-state-changed', renderActivePage);
        window.addEventListener('pv:dex-collection-context-changed', () => {
            renderActivePage();
            void loadAndRenderCollectionValueSnapshot({ forceRefresh: true });
        });
    });
})();

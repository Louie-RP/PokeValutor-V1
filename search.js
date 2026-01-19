/* Scrydex-backed Search page behavior */
document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('pv-search-form');
    const input = /** @type {HTMLInputElement} */(document.getElementById('pv-search-query'));
    const numberInput = /** @type {HTMLInputElement} */(document.getElementById('pv-search-number'));
    const status = document.getElementById('pv-search-status');
    const grid = document.getElementById('pv-search-grid');
    const favoritesGrid = document.getElementById('pv-favorites-grid');
    const favoritesBody = document.getElementById('pv-favorites-body');
    const favoritesToggle = document.getElementById('pv-favorites-toggle');
    const favoritesClearBtn = document.getElementById('pv-favorites-clear');
    const favoritesTotalsEl = document.getElementById('pv-favorites-totals');
    const scrollTopBtn = document.getElementById('pv-scroll-top');
    const clearBtn = document.getElementById('pv-clear-results');

    const CACHE_PREFIX = 'pv:scrydex:';
    const SEARCH_TTL_MS = 12 * 60 * 60 * 1000;
    const CARD_TTL_MS = 24 * 60 * 60 * 1000;
    const MAX_CACHE_ENTRIES = 250;

    const DEFAULT_TRADE_PERCENT = 80;
    const TRADE_PERCENT_CHOICES = [100, 90, 80, 70, 60, 50];

    const LAST_RESULTS_KEY = `${CACHE_PREFIX}lastResults:v1`;
    const FAVORITES_KEY = `${CACHE_PREFIX}favorites:v1`;
    const FAVORITES_COLLAPSED_KEY = `${CACHE_PREFIX}favoritesCollapsed:v1`;
    const TRADE_PERCENT_MAP_KEY = `${CACHE_PREFIX}tradePercentById:v1`;

    /** @type {Array<any>} */
    let currentResultsCards = [];

    /** @type {'name' | 'number' | null} */
    let lastEditedSearchField = null;

    function clearSearchInputs() {
        if (input) input.value = '';
        if (numberInput) numberInput.value = '';
    }

    // Keep search modes mutually exclusive so one field never blocks the other.
    if (input) {
        input.addEventListener('input', () => {
            lastEditedSearchField = 'name';
            if (numberInput && numberInput.value) numberInput.value = '';
        });
    }

    if (numberInput) {
        numberInput.addEventListener('input', () => {
            lastEditedSearchField = 'number';
            if (input && input.value) input.value = '';
        });
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

    function normalizeFavoriteCard(card) {
        // Keep a minimal snapshot so Favorites can render without extra API calls.
        return {
            id: safeString(card?.id, ''),
            name: safeString(card?.name, 'Unknown'),
            rarity: safeString(card?.rarity, ''),
            images: Array.isArray(card?.images) ? card.images : [],
            variants: Array.isArray(card?.variants) ? card.variants : [],
            selectedVariant: safeString(card?.selectedVariant, ''),
            pricesText: safeString(card?.pricesText, ''),
        };
    }

    function loadFavorites() {
        try {
            const raw = localStorage.getItem(FAVORITES_KEY);
            if (!raw) return [];
            const parsed = safeParseJson(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter((c) => c && typeof c === 'object' && c.id != null)
                .map(normalizeFavoriteCard);
        } catch {
            return [];
        }
    }

    function saveFavorites(list) {
        try {
            localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.isArray(list) ? list : []));
        } catch {
            // ignore
        }
    }

    function clearFavorites() {
        favorites = [];
        try { localStorage.removeItem(FAVORITES_KEY); } catch {}
        const restoredState = loadLastResults();
        renderFavorites(restoredState || undefined);

        // Keep results stars in sync.
        renderCards(currentResultsCards, restoredState || undefined);
    }

    /** @type {Array<any>} */
    let favorites = loadFavorites();

    function loadFavoritesCollapsed() {
        try {
            const raw = localStorage.getItem(FAVORITES_COLLAPSED_KEY);
            return raw === '1' || raw === 'true';
        } catch {
            return false;
        }
    }

    function saveFavoritesCollapsed(isCollapsed) {
        try {
            localStorage.setItem(FAVORITES_COLLAPSED_KEY, isCollapsed ? '1' : '0');
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

            favorites = [...favorites, normalizeFavoriteCard({
                ...card,
                selectedVariant: pickedVariant,
                pricesText: pickedPricesText,
            })];
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
            empty.textContent = 'No favorites yet. Click ☆ on a result card to save it here.';
            favoritesGrid.appendChild(empty);
            updateFavoritesTotals(restoreState);
            return;
        }

        for (const fav of favorites) {
            const col = document.createElement('div');
            col.className = 'col-12 col-sm-6 col-md-4 col-lg-3';

            const id = safeString(fav?.id, '');
            const name = safeString(fav?.name, 'Unknown');
            const rarity = safeString(fav?.rarity, '');
            const imgUrl = sanitizeUrl(pickFrontMediumImage(fav?.images));
            const selectedVariant = safeString(restoreState?.selections?.[id]?.holoType ?? fav?.selectedVariant, '');
            const pct = getSavedTradePercentForId(id, restoreState);

            const restoredPricesText = safeString(restoreState?.selections?.[id]?.pricesText, '');

            const idAttr = escapeAttr(id);
            const nameHtml = escapeHtml(name);
            const nameAttr = escapeAttr(name);
            const rarityHtml = escapeHtml(rarity);
            const selectedVariantHtml = escapeHtml(selectedVariant);
            const imgUrlAttr = escapeAttr(imgUrl);

            const maybePrices = selectedVariant ? getPricesForVariant(fav, selectedVariant) : null;
            const pricesText = maybePrices
                ? formatPriceList(maybePrices, pct)
                : (restoredPricesText || safeString(fav?.pricesText, ''));

            const pricesTextHtml = escapeHtml(pricesText);

            col.innerHTML = `
                <div class="pv-card h-100">
                    ${imgUrl ? `<img class="pv-card__img" src="${imgUrlAttr}" alt="${nameAttr} card image"/>` : ''}
                    <div class="pv-card__body">
                        <div class="pv-card__header">
                            <div class="pv-card__title">${nameHtml}</div>
                            <button id="pv-fav-${idAttr}" class="pv-fav-btn" type="button" aria-label="Remove from favorites" aria-pressed="true" title="Unfavorite">★</button>
                        </div>
                        <p class="pv-card__text">${rarity ? `Rarity: ${rarityHtml}` : 'Rarity: n/a'}</p>
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

        const res = await fetch(url);
        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error(`Non-JSON response (${res.status})`);
        }
        if (!res.ok) {
            const msg = data?.error || data?.message || `API error ${res.status}`;
            throw new Error(String(msg));
        }

        // Some APIs return HTTP 200 with an { ok:false } payload.
        // Never cache those responses.
        if (data && typeof data === 'object' && data.ok === false) {
            const msg = data?.error || data?.message || 'API error';
            throw new Error(String(msg));
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

        const allowedConditions = new Set(['NM', 'LP', 'MP']);

        /** @type {string[]} */
        const preferredLines = [];
        /** @type {string[]} */
        const fallbackLines = [];
        for (const p of prices) {
            if (!p || typeof p !== 'object') continue;
            const condition = p?.condition != null ? String(p.condition) : '';
            const type = p?.type != null ? String(p.type) : '';
            const currency = p?.currency != null ? String(p.currency) : '';
            const market = (p?.market ?? p?.marketPrice ?? p?.market_price ?? null);
            // const low = p?.low ?? null; // intentionally hidden (market only)

            const conditionKey = normalizeConditionKey(condition);

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
                if (allowedConditions.has(conditionKey)) {
                    preferredLines.push(line);
                } else {
                    fallbackLines.push(line);
                }
                continue;
            }
            const entries = Object.entries(p)
                .filter(([k, v]) => v != null && typeof v !== 'object' && typeof v !== 'function')
                .slice(0, 6)
                .map(([k, v]) => `${k} ${v}`);
            if (entries.length) {
                const line = entries.join(' • ');
                if (allowedConditions.has(conditionKey)) {
                    preferredLines.push(line);
                } else {
                    fallbackLines.push(line);
                }
            }
        }
        if (preferredLines.length) return preferredLines.join('\n');
        if (fallbackLines.length) return fallbackLines.join('\n');
        return 'No prices available for this variant at this time';
    }

    function formatUsd(amount) {
        const n = typeof amount === 'number' ? amount : Number(amount);
        if (!Number.isFinite(n)) return '$0.00';
        return `$${n.toFixed(2)}`;
    }

    function normalizeConditionKeyForTotals(raw) {
        const s = String(raw || '').trim();
        if (!s) return '';
        const upper = s.toUpperCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (upper === 'NM' || upper === 'LP' || upper === 'MP') return upper;
        if (upper.startsWith('NM')) return 'NM';
        if (upper.startsWith('LP')) return 'LP';
        if (upper.startsWith('MP')) return 'MP';
        if (upper === 'NEAR MINT') return 'NM';
        if (upper === 'LIGHT PLAY' || upper === 'LIGHTLY PLAYED' || upper === 'LIGHT PLAYED') return 'LP';
        if (upper === 'MODERATE PLAY' || upper === 'MODERATELY PLAYED' || upper === 'MID PLAY') return 'MP';
        return upper;
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
        currentResultsCards = Array.isArray(cards) ? cards : [];
        grid.innerHTML = '';

        if (!Array.isArray(cards) || cards.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'col-12';
            empty.textContent = 'No results found.';
            grid.appendChild(empty);
            return;
        }

        for (const card of cards) {
            const col = document.createElement('div');
            col.className = 'col-12 col-sm-6 col-md-4 col-lg-3';

            const id = String(card?.id || '');
            const name = String(card?.name || 'Unknown');
            const rarity = String(card?.rarity || '');
            const imgUrl = sanitizeUrl(pickFrontMediumImage(card?.images));
            const variantsFull = Array.isArray(card?.variants) ? card.variants : [];
            const variants = variantsFull.map((v) => v?.name).filter(Boolean);
            const fav = isFavorite(id);
            const favSymbol = fav ? '★' : '☆';
            const favLabel = fav ? 'Remove from favorites' : 'Add to favorites';

            const variantOptions = variants.length
                ? ['<option value="">Select a holo type</option>', ...variants.map((v) => {
                    const vv = String(v);
                    return `<option value="${escapeAttr(vv)}">${escapeHtml(vv)}</option>`;
                })].join('')
                : '<option value="">No variants</option>';

            const restoredSelection = restoreState?.selections?.[id];
            const restoredTradePercent = getSavedTradePercentForId(id, restoreState);
            const tradePercentOptions = TRADE_PERCENT_CHOICES
                .map((p) => `<option value="${p}" ${p === restoredTradePercent ? 'selected' : ''}>${p}%</option>`)
                .join('');

            const idAttr = escapeAttr(id);
            const nameHtml = escapeHtml(name);
            const nameAttr = escapeAttr(name);
            const rarityHtml = escapeHtml(rarity);
            const favLabelAttr = escapeAttr(favLabel);
            const imgUrlAttr = escapeAttr(imgUrl);

            col.innerHTML = `
                <div class="pv-card h-100">
                    ${imgUrl ? `<img class="pv-card__img" src="${imgUrlAttr}" alt="${nameAttr} card image"/>` : ''}
                    <div class="pv-card__body">
                        <div class="pv-card__header">
                            <div class="pv-card__title">${nameHtml}</div>
                            <button id="pv-fav-${idAttr}" class="pv-fav-btn" type="button" aria-label="${favLabelAttr}" aria-pressed="${fav ? 'true' : 'false'}" title="${favLabelAttr}">${favSymbol}</button>
                        </div>
                        <p class="pv-card__text">${rarity ? `Rarity: ${rarityHtml}` : 'Rarity: n/a'}</p>
                        <div class="pv-form__field" style="margin-bottom:0.5rem">
                            <label class="form-label" for="pv-variant-${idAttr}">Variant</label>
                            <select class="form-select" id="pv-variant-${idAttr}" ${variants.length ? '' : 'disabled'}>
                                ${variantOptions}
                            </select>
                        </div>
                        <div class="pv-form__field" style="margin-bottom:0.5rem">
                            <label class="form-label" for="pv-trade-${idAttr}">Trade %</label>
                            <select class="form-select" id="pv-trade-${idAttr}">
                                ${tradePercentOptions}
                            </select>
                        </div>
                        <pre class="pv-card__text" id="pv-prices-${idAttr}" style="white-space:pre-wrap;margin:0"></pre>
                    </div>
                </div>
            `;

            // Declare these after col.innerHTML so the elements exist
            const selectEl = /** @type {HTMLSelectElement|null} */ (col.querySelector(`#pv-variant-${CSS.escape(id)}`));
            const tradeEl = /** @type {HTMLSelectElement|null} */ (col.querySelector(`#pv-trade-${CSS.escape(id)}`));
            const pricesEl = /** @type {HTMLElement|null} */ (col.querySelector(`#pv-prices-${CSS.escape(id)}`));
            const favBtn = /** @type {HTMLButtonElement|null} */ (col.querySelector(`#pv-fav-${CSS.escape(id)}`));
            if (favBtn) {
                favBtn.addEventListener('click', () => toggleFavorite(card));
            }

            let lastLoadedVariantName = '';
            /** @type {Array<any>|null} */
            let lastLoadedPrices = null;

            function getSelectedTradePercent() {
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
                    selections[id] = { holoType: variantName, pricesText: formatted, tradePercent: getSelectedTradePercent() };
                    saveLastResults({ ...prev, selections });
                }

                // Also persist trade percent independently so it survives lastResults clearing.
                persistTradePercent(id, getSelectedTradePercent());

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
                    if (restoredSelection.pricesText) {
                        pricesEl.textContent = String(restoredSelection.pricesText);
                        lastLoadedVariantName = String(restoredSelection.holoType);

                        // Keep the in-memory card snapshot aligned with restored state.
                        try {
                            card.selectedVariant = String(restoredSelection.holoType);
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
            // Limit to 5 results to reduce API usage.
            const url = `${base}/cards/search?name=${encodeURIComponent(q)}&page=1&pageSize=5&lang=en`;
            const data = await fetchJsonWithCache(url, SEARCH_TTL_MS);
            const cards = Array.isArray(data?.data) ? data.data : [];
            renderCards(cards);
            const guidance = 'If your card is not displayed, please search by card number (printed number) instead.';
            const limitNote = cards.length >= 5 ? ' Showing up to 5 matches.' : '';
            const statusText = `${cards.length} result${cards.length !== 1 ? 's' : ''} for "${q}".${limitNote} ${guidance}`;
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
        } catch (e) {
            console.warn('[PokeValutor] search error', e);
            renderCards([]);
            setStatus('Error retrieving results. Please try again later.');
        }
    }

    async function searchByPrintedNumber(printedNumber) {
        const pn = (printedNumber || '').trim();
        if (!pn) {
            setStatus('Please enter a printed card number (e.g., 87/160 or SWSH101).');
            renderCards([]);
            return;
        }
        const base = getWorkerBase();

        // Number searches are high-collision (many sets share the same number),
        // so show more results than name searches.
        const RESULT_LIMIT = 10;

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
            for (let i = 0; i < Math.min(RESULT_LIMIT, 10); i++) {
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
        } catch (e) {
            console.warn('[PokeValutor] printed number search error', e);
            renderCards([]);
            setStatus('Error retrieving results. Please try again later.');
        }
    }

    async function searchTopByExpansion(expansionId, expansionName) {
        const id = String(expansionId || '').trim();
        const name = String(expansionName || '').trim();
        if (!id) return;

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
            setStatus('Error retrieving expansion results. Please try again later.');
        }
    }

    if (form && input) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const byNumber = (numberInput?.value || '').trim();
            const byName = (input?.value || '').trim();
            if (!byNumber && !byName) {
                setStatus('Please enter a Pokémon name or a printed card number.');
                renderCards([]);
                return;
            }

            // Clear the inputs immediately after capturing the query.
            // This prevents a previous search from blocking the next.
            clearSearchInputs();

            // If both are somehow filled, choose the most recently edited field.
            if (byNumber && byName) {
                if (lastEditedSearchField === 'name') {
                    void searchByName(byName);
                } else {
                    void searchByPrintedNumber(byNumber);
                }
                return;
            }

            if (byNumber) void searchByPrintedNumber(byNumber);
            else void searchByName(byName);
        });
    }

    function clearResultsUI() {
        if (grid) grid.innerHTML = '';
        if (status) status.textContent = '';
        currentResultsCards = [];
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
        if (restored.mode === 'number' && numberInput) numberInput.value = String(restored.query || '');
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

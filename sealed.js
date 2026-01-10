/* Scrydex-backed Sealed page behavior */
document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('pv-sealed-form');
    const input = /** @type {HTMLInputElement} */(document.getElementById('pv-sealed-query'));
    const status = document.getElementById('pv-sealed-status');
    const grid = document.getElementById('pv-sealed-grid');
    const favoritesGrid = document.getElementById('pv-sealed-favorites-grid');
    const favoritesBody = document.getElementById('pv-sealed-favorites-body');
    const favoritesToggle = document.getElementById('pv-sealed-favorites-toggle');
    const favoritesClearBtn = document.getElementById('pv-sealed-favorites-clear');
    const scrollTopBtn = document.getElementById('pv-scroll-top');
    const clearBtn = document.getElementById('pv-sealed-clear');

    const CACHE_PREFIX = 'pv:scrydex:sealed:';
    const SEARCH_TTL_MS = 12 * 60 * 60 * 1000;
    const DEFAULT_TRADE_PERCENT = 80;
    const TRADE_PERCENT_CHOICES = [100, 90, 80, 70, 60, 50];

    const LAST_RESULTS_KEY = `${CACHE_PREFIX}lastResults:v1`;
    const FAVORITES_KEY = `${CACHE_PREFIX}favorites:v1`;
    const FAVORITES_COLLAPSED_KEY = `${CACHE_PREFIX}favoritesCollapsed:v1`;
    const TRADE_PERCENT_MAP_KEY = `${CACHE_PREFIX}tradePercentById:v1`;

    /** @type {Array<any>} */
    let currentResultsProducts = [];

    function setStatus(message) {
        if (status) status.textContent = message;
    }

    function safeString(value, fallback) {
        const s = String(value ?? '');
        return s ? s : (fallback || '');
    }

    function normalizeFavoriteProduct(product) {
        // Keep a minimal snapshot so Favorites can render without extra API calls.
        return {
            id: safeString(product?.id, ''),
            name: safeString(product?.name, 'Unknown'),
            type: safeString(product?.type, ''),
            images: Array.isArray(product?.images) ? product.images : [],
            expansion: (product?.expansion && typeof product.expansion === 'object') ? product.expansion : null,
            variants: Array.isArray(product?.variants) ? product.variants : [],
        };
    }

    function loadFavorites() {
        try {
            const raw = localStorage.getItem(FAVORITES_KEY);
            if (!raw) return [];
            const parsed = safeParseJson(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter((p) => p && typeof p === 'object' && p.id != null)
                .map(normalizeFavoriteProduct);
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

    function isFavorite(productId) {
        const id = String(productId || '');
        return favorites.some((p) => String(p?.id || '') === id);
    }

    function toggleFavorite(product) {
        const id = safeString(product?.id, '');
        if (!id) return;

        if (isFavorite(id)) {
            favorites = favorites.filter((p) => String(p?.id || '') !== id);
        } else {
            favorites = [...favorites, normalizeFavoriteProduct(product)];
        }
        saveFavorites(favorites);
        renderFavorites();

        // Keep results stars in sync.
        renderProducts(currentResultsProducts);
    }

    function clearFavorites() {
        favorites = [];
        try { localStorage.removeItem(FAVORITES_KEY); } catch {}
        renderFavorites();

        // Keep results stars in sync.
        renderProducts(currentResultsProducts);
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

        const res = await fetch(url);
        const text = await res.text();

        let data;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error('Invalid JSON response');
        }

        if (!res.ok) {
            const message = (data && typeof data === 'object' && (data.error || data.message)) ? (data.error || data.message) : `Request failed (${res.status})`;
            throw new Error(String(message));
        }

        cacheSet(cacheKey, data, ttlMs);
        return data;
    }

    function pickFrontSmallImage(images) {
        if (!Array.isArray(images)) return '';
        const front = images.find((img) => (img?.type || '').toLowerCase() === 'front');
        return front?.small || front?.medium || front?.large || images[0]?.small || images[0]?.medium || images[0]?.large || '';
    }

    function buildFieldQuery(fieldName, value) {
        const trimmed = String(value || '').trim();
        if (!trimmed) return '';
        const needsQuotes = /\s/.test(trimmed) || /[^A-Za-z0-9]/.test(trimmed);
        const term = needsQuotes ? `"${trimmed.replace(/"/g, '\\"')}"` : trimmed;
        return `${fieldName}:${term}`;
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

    function buildMarketLine(product, tradePercent) {
        const quote = getMarketQuote(product);
        if (!quote) return 'Market: N/A';

        const pct = normalizeTradePercent(tradePercent);
        const marketText = formatCurrency(quote.market, quote.currency);
        const tradeText = formatCurrency(quote.market * (pct / 100), quote.currency);
        return `Market: ${marketText} • @${pct}% ${tradeText}`;
    }

    function renderFavorites(restoreState) {
        if (!favoritesGrid) return;
        favoritesGrid.innerHTML = '';

        if (!Array.isArray(favorites) || favorites.length === 0) {
            favoritesGrid.innerHTML = '<div class="col-12"><p class="pv-section__text">No favorites yet.</p></div>';
            return;
        }

        for (const fav of favorites) {
            const col = document.createElement('div');
            col.className = 'col-12 col-sm-6 col-lg-4';

            const card = document.createElement('div');
            card.className = 'pv-card pv-card--sealed';

            const imgUrl = pickFrontSmallImage(fav?.images);
            if (imgUrl) {
                const img = document.createElement('img');
                img.className = 'pv-card__img pv-card__img--sealed';
                img.loading = 'lazy';
                img.alt = String(fav?.name || 'Sealed product');
                img.src = imgUrl;
                card.appendChild(img);
            }

            const body = document.createElement('div');
            body.className = 'pv-card__body';

            const header = document.createElement('div');
            header.className = 'pv-card__header';

            const title = document.createElement('h3');
            title.className = 'pv-card__title';
            title.textContent = String(fav?.name || 'Unknown');

            const favBtn = document.createElement('button');
            favBtn.className = 'pv-fav-btn';
            favBtn.type = 'button';
            favBtn.setAttribute('aria-label', 'Remove from favorites');
            favBtn.textContent = '★';
            favBtn.addEventListener('click', () => toggleFavorite(fav));

            header.appendChild(title);
            header.appendChild(favBtn);

            const expName = String(fav?.expansion?.name || '');
            const expSeries = String(fav?.expansion?.series || '');
            const expansionLine = document.createElement('p');
            expansionLine.className = 'pv-card__text';
            expansionLine.textContent = expName && expSeries
                ? `Expansion: ${expName} • ${expSeries}`
                : (expName ? `Expansion: ${expName}` : (expSeries ? `Series: ${expSeries}` : 'Expansion: N/A'));

            const productId = safeString(fav?.id, '');
            const tradeField = document.createElement('div');
            tradeField.className = 'pv-form__field';
            tradeField.style.marginBottom = '0.5rem';

            const tradeLabel = document.createElement('label');
            tradeLabel.className = 'form-label';
            tradeLabel.htmlFor = `pv-sealed-trade-${productId}`;
            tradeLabel.textContent = 'Trade %';

            const tradeSelect = document.createElement('select');
            tradeSelect.className = 'form-select';
            tradeSelect.id = `pv-sealed-trade-${productId}`;
            const pct = getSavedTradePercentForId(productId, restoreState);
            tradeSelect.innerHTML = TRADE_PERCENT_CHOICES
                .map((p) => `<option value="${p}" ${p === pct ? 'selected' : ''}>${p}%</option>`)
                .join('');

            tradeField.appendChild(tradeLabel);
            tradeField.appendChild(tradeSelect);

            const marketLine = document.createElement('p');
            marketLine.className = 'pv-card__text';
            marketLine.textContent = buildMarketLine(fav, pct);

            tradeSelect.addEventListener('change', () => {
                const nextPct = normalizeTradePercent(tradeSelect.value);
                marketLine.textContent = buildMarketLine(fav, nextPct);
                if (productId) persistTradePercent(productId, nextPct);
            });

            body.appendChild(header);
            body.appendChild(expansionLine);
            body.appendChild(tradeField);
            body.appendChild(marketLine);
            card.appendChild(body);
            col.appendChild(card);
            favoritesGrid.appendChild(col);
        }
    }

    function renderProducts(products, restoreState) {
        if (!grid) return;
        currentResultsProducts = Array.isArray(products) ? products : [];
        grid.innerHTML = '';

        if (!Array.isArray(products) || products.length === 0) {
            grid.innerHTML = '<div class="col-12"><p class="pv-section__text">No results found.</p></div>';
            return;
        }

        for (const p of products) {
            const col = document.createElement('div');
            col.className = 'col-12 col-sm-6 col-lg-4';

            const card = document.createElement('div');
            card.className = 'pv-card pv-card--sealed';

            const imgUrl = pickFrontSmallImage(p?.images);
            if (imgUrl) {
                const img = document.createElement('img');
                img.className = 'pv-card__img pv-card__img--sealed';
                img.loading = 'lazy';
                img.alt = String(p?.name || 'Sealed product');
                img.src = imgUrl;
                card.appendChild(img);
            }

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
            favBtn.setAttribute('aria-label', favored ? 'Remove from favorites' : 'Add to favorites');
            favBtn.textContent = favored ? '★' : '☆';
            favBtn.addEventListener('click', () => toggleFavorite(p));

            header.appendChild(title);
            header.appendChild(favBtn);

            const expName = String(p?.expansion?.name || '');
            const expSeries = String(p?.expansion?.series || '');
            const expansionLine = document.createElement('p');
            expansionLine.className = 'pv-card__text';
            expansionLine.textContent = expName && expSeries
                ? `Expansion: ${expName} • ${expSeries}`
                : (expName ? `Expansion: ${expName}` : (expSeries ? `Series: ${expSeries}` : 'Expansion: N/A'));

            const productId = safeString(p?.id, '');
            const tradeField = document.createElement('div');
            tradeField.className = 'pv-form__field';
            tradeField.style.marginBottom = '0.5rem';

            const tradeLabel = document.createElement('label');
            tradeLabel.className = 'form-label';
            tradeLabel.htmlFor = `pv-sealed-trade-${productId}`;
            tradeLabel.textContent = 'Trade %';

            const tradeSelect = document.createElement('select');
            tradeSelect.className = 'form-select';
            tradeSelect.id = `pv-sealed-trade-${productId}`;
            const pct = getSavedTradePercentForId(productId, restoreState);
            tradeSelect.innerHTML = TRADE_PERCENT_CHOICES
                .map((pp) => `<option value="${pp}" ${pp === pct ? 'selected' : ''}>${pp}%</option>`)
                .join('');

            tradeField.appendChild(tradeLabel);
            tradeField.appendChild(tradeSelect);

            const marketLine = document.createElement('p');
            marketLine.className = 'pv-card__text';
            marketLine.textContent = buildMarketLine(p, pct);

            tradeSelect.addEventListener('change', () => {
                const nextPct = normalizeTradePercent(tradeSelect.value);
                marketLine.textContent = buildMarketLine(p, nextPct);
                if (productId) persistTradePercent(productId, nextPct);
            });

            body.appendChild(header);
            body.appendChild(expansionLine);
            body.appendChild(tradeField);
            body.appendChild(marketLine);

            card.appendChild(body);
            col.appendChild(card);
            grid.appendChild(col);
        }
    }

    async function searchByName(name) {
        const q = (name || '').trim();
        if (!q) {
            setStatus('Enter a product name to search.');
            if (grid) grid.innerHTML = '';
            return;
        }

        const base = getWorkerBase();
        const query = buildFieldQuery('name', q);
        const url = `${base}/sealed/search?q=${encodeURIComponent(query)}&page=1&pageSize=10`;

        setStatus('Searching…');
        if (grid) grid.innerHTML = '';

        try {
            const data = await fetchJsonWithCache(url, SEARCH_TTL_MS);
            const list = Array.isArray(data?.data) ? data.data : [];
            renderProducts(list);
            setStatus(list.length ? `Found ${list.length} result(s). If your searched product is not displayed, include product type: Booster Pack, Booster Bundle, Elite Trainer box, etc.` : 'No results found. Search by Product name e.g., "Prismatic Evolutions" and include product type: Booster Pack, Booster Bundle, Elite Trainer box, etc.');

            const prev = loadLastResults();
            const preservedSelections = (prev?.selections && typeof prev.selections === 'object') ? prev.selections : {};

            saveLastResults({
                mode: 'name',
                query: q,
                products: list,
                statusText: list.length ? `Found ${list.length} result(s). If your searched product is not displayed, include product type: Booster Pack, Booster Bundle, Elite Trainer box, etc.` : 'No results found. Search by Product name e.g., "Prismatic Evolutions" and include product type: Booster Pack, Booster Bundle, Elite Trainer box, etc.',
                selections: preservedSelections,
                savedAt: Date.now(),
            });
        } catch (e) {
            setStatus(`Error: ${e?.message || 'Search failed.'}`);
            if (grid) grid.innerHTML = '';
        }
    }

    function clearResultsUI() {
        if (grid) grid.innerHTML = '';
        setStatus('');
        currentResultsProducts = [];
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
        favoritesClearBtn.addEventListener('click', () => clearFavorites());
    }

    // Restore last results after refresh.
    const restored = loadLastResults();
    if (restored && Array.isArray(restored.products) && restored.products.length) {
        if (restored.mode === 'name' && input) input.value = String(restored.query || '');
        renderProducts(restored.products, restored);
        renderFavorites(restored);
        if (restored.statusText) setStatus(String(restored.statusText));
    }

    if (scrollTopBtn) {
        scrollTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
});

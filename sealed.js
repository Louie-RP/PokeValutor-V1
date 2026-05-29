/* Scrydex-backed Sealed page behavior */
document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('pv-sealed-form');
    const input = /** @type {HTMLInputElement} */(document.getElementById('pv-sealed-query'));
    const PV_BUILD = '2026-01-29-1';
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

    const quotaBanner = document.getElementById('pv-quota-banner');
    const quotaMessageEl = document.getElementById('pv-quota-message');
    const quotaCtaEl = /** @type {HTMLAnchorElement|null} */ (document.getElementById('pv-quota-cta'));

    const CACHE_PREFIX = 'pv:scrydex:sealed:';
    const SEARCH_TTL_MS = 12 * 60 * 60 * 1000;
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
    const TRADE_PERCENT_MAP_KEY = `${CACHE_PREFIX}tradePercentById:v1`;

    /** @type {Array<any>} */
    let currentResultsProducts = [];

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
            name: safeString(product?.name, 'Unknown'),
            type: safeString(product?.type, ''),
            images: Array.isArray(product?.images) ? product.images : [],
            expansion: (product?.expansion && typeof product.expansion === 'object') ? product.expansion : null,
            variants: Array.isArray(product?.variants) ? product.variants : [],
        };
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

    function clearFavorites() {
        favorites = [];
        try { localStorage.removeItem(WATCHLIST_KEY); } catch {}
        try { localStorage.removeItem(LEGACY_FAVORITES_KEY); } catch {}
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

    function renderFavorites(restoreState) {
        if (!favoritesGrid) return;
        favoritesGrid.innerHTML = '';

        if (!Array.isArray(favorites) || favorites.length === 0) {
            favoritesGrid.innerHTML = '<div class="col-12"><p class="pv-section__text">No watchlist items yet.</p></div>';
            updateFavoritesTotals(restoreState);
            return;
        }

        for (const fav of favorites) {
            const col = document.createElement('div');
            col.className = 'col-6 col-sm-6 col-lg-4';

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
            favBtn.setAttribute('aria-label', 'Remove from watchlist');
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
                updateFavoritesTotals(loadLastResults() || restoreState);
            });

            body.appendChild(header);
            body.appendChild(expansionLine);
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
        currentResultsProducts = Array.isArray(products) ? products : [];
        grid.innerHTML = '';

        if (!Array.isArray(products) || products.length === 0) {
            grid.innerHTML = '<div class="col-12"><p class="pv-section__text">No results found.</p></div>';
            return;
        }

        for (const p of products) {
            const col = document.createElement('div');
            col.className = 'col-6 col-sm-6 col-lg-4';

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
            favBtn.setAttribute('aria-label', favored ? 'Remove from watchlist' : 'Add to watchlist');
            favBtn.textContent = favored ? '★' : '☆';
            favBtn.addEventListener('click', () => toggleFavorite(p));

            const actions = document.createElement('div');
            actions.className = 'pv-card__actions';
            actions.appendChild(favBtn);

            header.appendChild(title);
            header.appendChild(actions);

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
            if (isQuotaExceededError(e)) {
                setStatus('Daily guest allowance reached. Sign in to continue.');
            } else {
                setStatus(`Error: ${e?.message || 'Search failed.'}`);
            }
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

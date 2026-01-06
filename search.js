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
    const scrollTopBtn = document.getElementById('pv-scroll-top');
    const clearBtn = document.getElementById('pv-clear-results');

    const CACHE_PREFIX = 'pv:scrydex:';
    const SEARCH_TTL_MS = 12 * 60 * 60 * 1000;
    const CARD_TTL_MS = 24 * 60 * 60 * 1000;
    const MAX_CACHE_ENTRIES = 250;

    const LAST_RESULTS_KEY = `${CACHE_PREFIX}lastResults:v1`;
    const FAVORITES_KEY = `${CACHE_PREFIX}favorites:v1`;
    const FAVORITES_COLLAPSED_KEY = `${CACHE_PREFIX}favoritesCollapsed:v1`;

    /** @type {Array<any>} */
    let currentResultsCards = [];

    function safeString(value, fallback) {
        const s = String(value ?? '');
        return s ? s : (fallback || '');
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
            favorites = [...favorites, normalizeFavoriteCard({
                ...card,
                selectedVariant: selection?.holoType ?? card?.selectedVariant,
                pricesText: selection?.pricesText ?? card?.pricesText,
            })];
        }
        saveFavorites(favorites);
        renderFavorites();

        // Keep results stars in sync without losing variant selection.
        const restored = loadLastResults();
        renderCards(currentResultsCards, restored || undefined);
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

    function renderFavorites() {
        if (!favoritesGrid) return;
        favoritesGrid.innerHTML = '';

        if (!Array.isArray(favorites) || favorites.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'col-12';
            empty.textContent = 'No favorites yet. Click ☆ on a result card to save it here.';
            favoritesGrid.appendChild(empty);
            return;
        }

        for (const fav of favorites) {
            const col = document.createElement('div');
            col.className = 'col-12 col-sm-6 col-md-4 col-lg-3';

            const id = safeString(fav?.id, '');
            const name = safeString(fav?.name, 'Unknown');
            const rarity = safeString(fav?.rarity, '');
            const imgUrl = pickFrontMediumImage(fav?.images);
            const selectedVariant = safeString(fav?.selectedVariant, '');
            const pricesText = safeString(fav?.pricesText, '');

            col.innerHTML = `
                <div class="pv-card h-100">
                    ${imgUrl ? `<img class="pv-card__img" src="${imgUrl}" alt="${name} card image"/>` : ''}
                    <div class="pv-card__body">
                        <div class="pv-card__header">
                            <div class="pv-card__title">${name}</div>
                            <button id="pv-fav-${id}" class="pv-fav-btn" type="button" aria-label="Remove from favorites" aria-pressed="true" title="Unfavorite">★</button>
                        </div>
                        <p class="pv-card__text">${rarity ? `Rarity: ${rarity}` : 'Rarity: n/a'}</p>
                        ${selectedVariant ? `<p class="pv-card__text">Variant: ${selectedVariant}</p>` : ''}
                        <pre class="pv-card__text" style="white-space:pre-wrap;margin:0">${pricesText ? pricesText : 'No prices loaded yet. Load prices in Results to show them here.'}</pre>
                    </div>
                </div>
            `;

            const favBtn = /** @type {HTMLButtonElement|null} */ (col.querySelector(`#pv-fav-${CSS.escape(id)}`));
            if (favBtn) {
                favBtn.addEventListener('click', () => toggleFavorite(fav));
            }

            favoritesGrid.appendChild(col);
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
            throw new Error(`Non-JSON response (${res.status})`);
        }
        if (!res.ok) {
            const msg = data?.error || data?.message || `API error ${res.status}`;
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

    function formatPriceList(prices) {
        if (!Array.isArray(prices) || prices.length === 0) return 'No price data available.';

        function normalizeConditionKey(raw) {
            const s = String(raw || '').trim();
            if (!s) return '';
            const upper = s.toUpperCase();
            if (upper === 'NM' || upper === 'LP' || upper === 'MP') return upper;
            if (upper === 'NEAR MINT') return 'NM';
            if (upper === 'LIGHT PLAY' || upper === 'LIGHTLY PLAYED') return 'LP';
            if (upper === 'MODERATE PLAY' || upper === 'MODERATELY PLAYED' || upper === 'MID PLAY') return 'MP';
            if (upper === 'DM' || upper === 'DAMAGED') return 'DM';
            return upper;
        }

        const allowedConditions = new Set(['NM', 'LP', 'MP']);

        const lines = [];
        for (const p of prices) {
            if (!p || typeof p !== 'object') continue;
            const condition = p?.condition != null ? String(p.condition) : '';
            const type = p?.type != null ? String(p.type) : '';
            const currency = p?.currency != null ? String(p.currency) : '';
            const market = p?.market ?? null;
            // const low = p?.low ?? null; // intentionally hidden (market only)

            // Only show NM / LP / MP. This also hides DM (Damaged) and any other conditions.
            const conditionKey = normalizeConditionKey(condition);
            if (!allowedConditions.has(conditionKey)) continue;

            const moneySymbol = currency === 'USD' || currency === '' ? '$' : '';
            const bits = [
                market != null ? `market ${moneySymbol}${market}` : null,
                // low != null ? `low ${moneySymbol}${low}` : null,
            ].filter(Boolean);

            if (bits.length) {
                const prefix = conditionKey
                    ? (type ? `${conditionKey} (${type})` : conditionKey)
                    : (type ? `(${type})` : '');
                lines.push(prefix ? `${prefix}: ${bits.join(' • ')}` : bits.join(' • '));
                continue;
            }
            const entries = Object.entries(p)
                .filter(([k, v]) => v != null && typeof v !== 'object' && typeof v !== 'function')
                .slice(0, 6)
                .map(([k, v]) => `${k} ${v}`);
            if (entries.length) lines.push(entries.join(' • '));
        }
        return lines.length ? lines.join('\n') : 'No price data available.';
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
            const imgUrl = pickFrontMediumImage(card?.images);
            const variants = Array.isArray(card?.variants) ? card.variants.map((v) => v?.name).filter(Boolean) : [];
            const fav = isFavorite(id);
            const favSymbol = fav ? '★' : '☆';
            const favLabel = fav ? 'Remove from favorites' : 'Add to favorites';

            const variantOptions = variants.length
                ? ['<option value="">Select a holo type</option>', ...variants.map((v) => `<option value="${String(v)}">${String(v)}</option>`)].join('')
                : '<option value="">No variants</option>';

            col.innerHTML = `
                <div class="pv-card h-100">
                    ${imgUrl ? `<img class="pv-card__img" src="${imgUrl}" alt="${name} card image"/>` : ''}
                    <div class="pv-card__body">
                        <div class="pv-card__header">
                            <div class="pv-card__title">${name}</div>
                            <button id="pv-fav-${id}" class="pv-fav-btn" type="button" aria-label="${favLabel}" aria-pressed="${fav ? 'true' : 'false'}" title="${favLabel}">${favSymbol}</button>
                        </div>
                        <p class="pv-card__text">${rarity ? `Rarity: ${rarity}` : 'Rarity: n/a'}</p>
                        <div class="pv-form__field" style="margin-bottom:0.5rem">
                            <label class="form-label" for="pv-variant-${id}">Variant</label>
                            <select class="form-select" id="pv-variant-${id}" ${variants.length ? '' : 'disabled'}>
                                ${variantOptions}
                            </select>
                        </div>
                        <pre class="pv-card__text" id="pv-prices-${id}" style="white-space:pre-wrap;margin:0"></pre>
                    </div>
                </div>
            `;

            // Declare these after col.innerHTML so the elements exist
            const selectEl = /** @type {HTMLSelectElement|null} */ (col.querySelector(`#pv-variant-${CSS.escape(id)}`));
            const pricesEl = /** @type {HTMLElement|null} */ (col.querySelector(`#pv-prices-${CSS.escape(id)}`));
            const favBtn = /** @type {HTMLButtonElement|null} */ (col.querySelector(`#pv-fav-${CSS.escape(id)}`));
            if (favBtn) {
                favBtn.addEventListener('click', () => toggleFavorite(card));
            }

            // Now define the function, so selectEl/pricesEl are in scope
            async function showPricesForSelectedVariant() {
                if (!selectEl || !pricesEl) return;
                const variantName = selectEl.value;
                if (!variantName) {
                    pricesEl.textContent = variants.length ? 'Select a holo type to load prices.' : '';
                    return;
                }
                pricesEl.textContent = 'Loading prices…';
                try {
                    const base = getWorkerBase();
                    const url = `${base}/cards/${encodeURIComponent(id)}?includePrices=1&lang=en`;
                    const data = await fetchJsonWithCache(url, CARD_TTL_MS);
                    const cardObj = data?.data || data;
                    const allVariants = Array.isArray(cardObj?.variants) ? cardObj.variants : [];
                    const match = allVariants.find((v) => String(v?.name || '') === variantName);
                    const formatted = formatPriceList(match?.prices);
                    pricesEl.textContent = formatted;

                    // Persist user selection + rendered prices so refresh restores the same view.
                    const prev = loadLastResults();
                    if (prev && Array.isArray(prev.cards)) {
                        const selections = (prev.selections && typeof prev.selections === 'object') ? prev.selections : {};
                        selections[id] = { holoType: variantName, pricesText: formatted };
                        saveLastResults({ ...prev, selections });
                    }

                    // If this card is favorited, keep the Favorites price display in sync.
                    if (isFavorite(id)) {
                        favorites = favorites.map((f) => {
                            if (String(f?.id || '') !== id) return f;
                            return { ...f, selectedVariant: variantName, pricesText: formatted };
                        });
                        saveFavorites(favorites);
                        renderFavorites();
                    }
                } catch (e) {
                    pricesEl.textContent = 'Unable to load prices.';
                    console.warn('[PokeValutor] prices error', e);
                }
            }

            const restoredSelection = restoreState?.selections?.[id];
            if (selectEl && pricesEl) {
                // Restore previously selected holo type and prices if available
                if (restoredSelection?.holoType && variants.includes(restoredSelection.holoType)) {
                    selectEl.value = restoredSelection.holoType;
                    if (restoredSelection.pricesText) {
                        pricesEl.textContent = String(restoredSelection.pricesText);
                    } else {
                        // If pricesText is missing, trigger loading
                        selectEl.dispatchEvent(new Event('change'));
                    }
                } else {
                    // No previous selection, show default prompt
                    pricesEl.textContent = variants.length ? 'Select a holo type to load prices.' : '';
                }
                selectEl.addEventListener('change', showPricesForSelectedVariant);
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
                selections: {},
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

        setStatus('Searching…');
        if (grid) {
            grid.innerHTML = '';
            for (let i = 0; i < 4; i++) {
                const col = document.createElement('div');
                col.className = 'col-12 col-sm-6 col-md-4 col-lg-3';
                col.innerHTML = '<div class="pv-card" style="height:260px"><div class="pv-skeleton" style="height:100%"></div></div>';
                grid.appendChild(col);
            }
        }

        try {
            // Scrydex query: use printed_number:<value>
            const q = buildFieldQuery('printed_number', pn);
            const url = `${base}/cards/search?q=${encodeURIComponent(q)}&page=1&pageSize=5&lang=en`;
            const data = await fetchJsonWithCache(url, SEARCH_TTL_MS);
            const cards = Array.isArray(data?.data) ? data.data : [];
            renderCards(cards);
            const statusText = `${cards.length} result${cards.length !== 1 ? 's' : ''} for printed number "${pn}".`;
            setStatus(statusText);

            saveLastResults({
                savedAt: Date.now(),
                mode: 'number',
                query: pn,
                cards,
                statusText,
                selections: {},
            });
        } catch (e) {
            console.warn('[PokeValutor] printed number search error', e);
            renderCards([]);
            setStatus('Error retrieving results. Please try again later.');
        }
    }

    const connBtn = document.getElementById('pv-conn-test');
    const connStatus = document.getElementById('pv-conn-status');
    if (connBtn) {
        connBtn.addEventListener('click', async () => {
            const base = getWorkerBase();
            if (!base) {
                if (connStatus) connStatus.textContent = 'Missing PV_API_URL. Set your Worker URL in secrets.js.';
                return;
            }
            const name = input?.value?.trim() || 'pikachu';
            const url = `${base}/cards/search?name=${encodeURIComponent(name)}&page=1&pageSize=1&lang=en`;
            if (connStatus) connStatus.textContent = 'Testing connection…';
            try {
                const res = await fetch(url);
                const text = await res.text();
                const ctype = res.headers.get('content-type') || '';
                let count = 'n/a';
                try {
                    const parsed = JSON.parse(text);
                    count = Array.isArray(parsed?.data) ? String(parsed.data.length) : 'n/a';
                } catch {}
                if (connStatus) connStatus.textContent = `Status ${res.status} • ${ctype || 'no content-type'} • Count ${count}`;
            } catch (err) {
                if (connStatus) connStatus.textContent = `Test failed: ${err?.name || err}`;
            }
        });
    }

    const healthBtn = document.getElementById('pv-health-test');
    const healthStatus = document.getElementById('pv-health-status');
    if (healthBtn) {
        healthBtn.addEventListener('click', async () => {
            const base = getWorkerBase();
            if (!base) {
                if (healthStatus) healthStatus.textContent = 'Missing PV_API_URL. Set your Worker URL in secrets.js.';
                return;
            }
            const url = `${base}/health`;
            if (healthStatus) healthStatus.textContent = 'Checking worker health…';
            try {
                const res = await fetch(url);
                const text = await res.text();
                const ctype = res.headers.get('content-type') || '';
                let info = '';
                try {
                    const parsed = JSON.parse(text);
                    info = `ok=${String(!!parsed?.ok)} • path=${parsed?.pathname ?? 'n/a'}`;
                } catch {
                    info = 'non-JSON';
                }
                if (healthStatus) healthStatus.textContent = `Status ${res.status} • ${ctype || 'no content-type'} • ${info}`;
            } catch (err) {
                if (healthStatus) healthStatus.textContent = `Health check failed: ${err?.name || err}`;
            }
        });
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
            // Prefer printed-number search if provided.
            if (byNumber) {
                void searchByPrintedNumber(byNumber);
            } else {
                void searchByName(byName);
            }
        });
    }

    function clearResultsUI() {
        if (grid) grid.innerHTML = '';
        if (status) status.textContent = '';
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            clearResultsUI();
            clearLastResults();

            if (input) input.value = '';
            if (numberInput) numberInput.value = '';
        });
    }

    // Render Favorites immediately (persisted across refresh).
    renderFavorites();

    // Favorites collapsible behavior (persisted across refresh).
    if (favoritesToggle) {
        favoritesToggle.addEventListener('click', () => {
            const currentlyCollapsed = !!favoritesBody?.hidden;
            setFavoritesCollapsed(!currentlyCollapsed);
        });
    }
    setFavoritesCollapsed(loadFavoritesCollapsed());

    // Restore last results after refresh.
    const restored = loadLastResults();
    if (restored && Array.isArray(restored.cards) && restored.cards.length) {
        if (restored.mode === 'name' && input) input.value = String(restored.query || '');
        if (restored.mode === 'number' && numberInput) numberInput.value = String(restored.query || '');
        renderCards(restored.cards, restored);
        if (restored.statusText) setStatus(String(restored.statusText));
    }

    if (scrollTopBtn) {
        scrollTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
});

/* Scrydex-backed Search page behavior */
(function () {
    const form = document.getElementById('pv-search-form');
    const input = /** @type {HTMLInputElement} */(document.getElementById('pv-search-query'));
    const numberInput = /** @type {HTMLInputElement} */(document.getElementById('pv-search-number'));
    const status = document.getElementById('pv-search-status');
    const grid = document.getElementById('pv-search-grid');

    const CACHE_PREFIX = 'pv:scrydex:';
    const SEARCH_TTL_MS = 12 * 60 * 60 * 1000;
    const CARD_TTL_MS = 24 * 60 * 60 * 1000;
    const MAX_CACHE_ENTRIES = 250;

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
                if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
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
        const lines = [];
        for (const p of prices) {
            if (!p || typeof p !== 'object') continue;
            const condition = p?.condition != null ? String(p.condition) : '';
            const type = p?.type != null ? String(p.type) : '';
            const currency = p?.currency != null ? String(p.currency) : '';
            const market = p?.market ?? null;
            const low = p?.low ?? null;

            const moneySymbol = currency === 'USD' || currency === '' ? '$' : '';
            const bits = [
                market != null ? `market ${moneySymbol}${market}` : null,
                low != null ? `low ${moneySymbol}${low}` : null,
            ].filter(Boolean);

            if (bits.length) {
                const prefix = condition
                    ? (type ? `${condition} (${type})` : condition)
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

    function renderCards(cards) {
        if (!grid) return;
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

            const variantOptions = variants.length
                ? ['<option value="">Select a holo type</option>', ...variants.map((v) => `<option value="${String(v)}">${String(v)}</option>`)].join('')
                : '<option value="">No variants</option>';

            col.innerHTML = `
                <div class="pv-card h-100">
                    ${imgUrl ? `<img class="pv-card__img" src="${imgUrl}" alt="${name} card image"/>` : ''}
                    <div class="pv-card__body">
                        <div class="pv-card__title">${name}</div>
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

            const selectEl = /** @type {HTMLSelectElement|null} */ (col.querySelector(`#pv-variant-${CSS.escape(id)}`));
            const pricesEl = /** @type {HTMLElement|null} */ (col.querySelector(`#pv-prices-${CSS.escape(id)}`));

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
                    pricesEl.textContent = formatPriceList(match?.prices);
                } catch (e) {
                    pricesEl.textContent = 'Unable to load prices.';
                    console.warn('[PokeValutor] prices error', e);
                }
            }

            if (selectEl) {
                selectEl.addEventListener('change', showPricesForSelectedVariant);
                if (variants.length && pricesEl) pricesEl.textContent = 'Select a holo type to load prices.';
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
            setStatus(`${cards.length} result${cards.length !== 1 ? 's' : ''} for "${q}".${limitNote} ${guidance}`);
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
            setStatus(`${cards.length} result${cards.length !== 1 ? 's' : ''} for printed number "${pn}".`);
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
})();

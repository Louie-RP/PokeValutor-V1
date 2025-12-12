/* Search page behavior */
(function () {
    // Single-flight control: cancel previous search if a new one starts
    let currentSearchController = null;
    const form = document.getElementById('pv-search-form');
    const input = /** @type {HTMLInputElement} */(document.getElementById('pv-search-query'));
    const status = document.getElementById('pv-search-status');
    const grid = document.getElementById('pv-search-grid');

    function setStatus(message) {
        if (status) status.textContent = message;
    }

    // Render cards with image + price details
    function renderCards(cards) {
        if (!grid) return;
        grid.innerHTML = '';

        if (!cards || !cards.length) {
            const empty = document.createElement('div');
            empty.className = 'col-12';
            empty.textContent = 'No results found.';
            grid.appendChild(empty);
            return;
        }

        for (const card of cards) {
            const col = document.createElement('div');
            col.className = 'col-12 col-sm-6 col-md-4 col-lg-3';

            const imgUrl = card?.images?.small || card?.images?.large || '';
            const name = card?.name || 'Unknown';
            const number = card?.number || '';
            const setName = card?.set?.name || '';

            const prices = card?.tcgplayer?.prices || {};
            const normal = prices?.normal || prices?.holofoil || prices?.reverseHolofoil || prices?.firstEditionHolofoil || null;
            const market = normal?.market ?? null;
            const mid = normal?.mid ?? null;
            const low = normal?.low ?? null;
            const high = normal?.high ?? null;

            const priceText = (market || mid || low || high)
                ? `${[
                    market != null ? `market $${market}` : null,
                    mid != null ? `mid $${mid}` : null,
                    low != null ? `low $${low}` : null,
                    high != null ? `high $${high}` : null,
                ].filter(Boolean).join(' • ')}`
                : 'Price data not available';

            col.innerHTML = `
                <div class="pv-card h-100">
                    ${imgUrl ? `<img class="pv-card__img" src="${imgUrl}" alt="${name} card image"/>` : ''}
                    <div class="pv-card__body">
                        <div class="pv-card__title">${name} ${setName ? `• ${setName}` : ''} ${number ? `• #${number}` : ''}</div>
                        <p class="pv-card__text">${priceText}</p>
                    </div>
                </div>
            `;
            grid.appendChild(col);
        }
    }

    // Fetch by card number via the configured base URL (Cloudflare Worker recommended)
    async function fetchCardsByNumber(cardNumber) {
        // Prefer secrets.js, but fall back to a built-in public Worker URL so the site works without secrets
        const defaultWorker = 'https://pokevalutor.lreyperez18.workers.dev';
        const base = (window?.PV_SECRETS?.PV_API_URL || defaultWorker).replace(/\/$/, '');
        if (!base) {
            console.warn('[PokeValutor] PV_API_URL is not set in secrets.js');
        }

        const raw = cardNumber.trim();
        // Support inputs like "smp-SM114" (set id + number) or "4/102"
        let q;
        if (/^[A-Za-z0-9]+-[A-Za-z0-9]+$/.test(raw)) {
            const [setId, num] = raw.split('-');
            q = `set.id:${setId} number:${num}`; // AND search
        } else if (/^\d+\/\d+$/.test(raw)) {
            // Pattern like 4/102 → number 4 from a set with total 102
            const [num, total] = raw.split('/');
            const numTrim = String(num).replace(/^0+/, '') || '0';
            // Try both total and printedTotal to improve matching across data variations
            q = `number:${numTrim} (set.total:${total} OR set.printedTotal:${total})`;
        } else {
            q = `number:${raw}`;
        }
        const url = `${base}/v2/cards?q=${encodeURIComponent(q)}&orderBy=number&pageSize=25&page=1`;
        console.log('[PokeValutor] number URL', url);
        // Add a timeout so we fail fast on upstream stalls
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000000);
        let res;
        try {
            res = await fetch(url, { signal: controller.signal });
        } catch (e) {
            clearTimeout(timer);
            console.warn('[PokeValutor] number fetch failed', e?.name || e);
            throw e;
        }
        clearTimeout(timer);
        // Debug: log status and a few headers
        console.log('[PokeValutor] number status', res.status, res.statusText);
        console.log('[PokeValutor] number headers', {
            'content-type': res.headers.get('content-type'),
            'cf-ray': res.headers.get('cf-ray'),
            'server': res.headers.get('server')
        });
        const text = await res.text();
        // Debug: log a snippet of the raw body to understand 404 payloads
        console.log('[PokeValutor] number raw snippet', text.slice(0, 200));
        // Treat 404/5xx from number queries as "no results" to allow fallback
        if (res.status === 404 || res.status >= 500) {
            console.warn('[PokeValutor] 404 from number endpoint; treating as no results and falling back to name');
            return [];
        }
        let data;
        try { data = JSON.parse(text); } catch (e) {
            console.warn('[PokeValutor] Non-JSON response error code:', res.status);
            throw new Error(`API error ${res.status}: non-JSON response`);
        }
        if (!res.ok) {
            console.error('[PokeValutor] API error payload', data);
            // For other 4xx (e.g., invalid query), treat as no results so name fallback can proceed
            return [];
        }
        return Array.isArray(data?.data) ? data.data : [];
    }

    function isNumberLike(input) {
        const s = (input || '').trim();
        return (
            /^[A-Za-z0-9]+-[A-Za-z0-9]+$/.test(s) || // setId-number
            /^\d+\/\d+$/.test(s) ||                 // N/NN
            /^\d+$/.test(s)                           // pure number
        );
    }

    // Enhance existing search to try number-first (only if numeric-like), then name fallback
    async function doSearch(query) {
        // Cancel any in-flight search
        if (currentSearchController) {
            try { currentSearchController.abort(); } catch {}
            currentSearchController = null;
        }
        const q = (query || '').trim();
        if (!q) {
            setStatus('Please enter a card number or name.');
            renderCards([]);
            return;
        }

        setStatus('Searching…');
        // Show skeletons
        if (grid) {
            grid.innerHTML = '';
            for (let i = 0; i < 8; i++) {
                const col = document.createElement('div');
                col.className = 'col-12 col-sm-6 col-md-4 col-lg-3';
                col.innerHTML = '<div class="pv-card" style="height:220px"><div class="pv-skeleton" style="height:100%"></div></div>';
                grid.appendChild(col);
            }
        }
        try {
            // Try number/set-id search first only if the input is number-like
            if (isNumberLike(q)) {
                const cardsByNumber = await fetchCardsByNumber(q);
                if (cardsByNumber.length) {
                    renderCards(cardsByNumber);
                    setStatus(`${cardsByNumber.length} result${cardsByNumber.length !== 1 ? 's' : ''} for card number "${q}"`);
                    return;
                }
            }

            // Fallback: name search
            const defaultWorker = 'https://pokevalutor.lreyperez18.workers.dev';
            const base = (window?.PV_SECRETS?.PV_API_URL || defaultWorker).replace(/\/$/, '');
            const nameTerm = (/\s/.test(q) || /[^A-Za-z0-9]/.test(q)) ? `"${q}"` : q;
            const nameUrl = `${base}/v2/cards?q=${encodeURIComponent(`name:${nameTerm}`)}&orderBy=name&pageSize=25&page=1`;
            console.log('[PokeValutor] name URL', nameUrl);
            // Name search with timeout as well
            const controller = new AbortController();
            currentSearchController = controller;
            const timer = setTimeout(() => controller.abort(), 200000);
            let res;
            try {
                res = await fetch(nameUrl, { signal: controller.signal });
            } catch (e) {
                clearTimeout(timer);
                console.warn('[PokeValutor] name fetch failed', e?.name || e);
                // Retry alternate Worker route immediately on abort/timeouts
                try {
                    const alt = `${base}/?q=${encodeURIComponent(`name:${nameTerm}`)}&orderBy=name&pageSize=25&page=1`;
                    console.log('[PokeValutor] name URL (alt on abort)', alt);
                    const controllerAlt = new AbortController();
                    const timerAlt = setTimeout(() => controllerAlt.abort(), 12000);
                    const altRes = await fetch(alt, { signal: controllerAlt.signal });
                    clearTimeout(timerAlt);
                    res = altRes; // proceed to normal handling below
                } catch (e2) {
                    console.warn('[PokeValutor] name alt fetch failed', e2?.name || e2);
                    throw e; // rethrow original
                }
            }
            clearTimeout(timer);
            console.log('[PokeValutor] name search status', res.status, res.statusText);
            // Debug: headers and snippet
            console.log('[PokeValutor] name headers', {
                'content-type': res.headers.get('content-type'),
                'cf-ray': res.headers.get('cf-ray'),
                'server': res.headers.get('server')
            });
            const text = await res.text();
            console.log('[PokeValutor] name raw snippet', text.slice(0, 200));
            // Treat 404 on name path as no results for consistency
            if (res.status === 404) {
                // Retry alternate Worker route: root path with query (Worker rewrites '/' + q to /v2/cards)
                try {
                    const altUrl = `${base}/?q=${encodeURIComponent(`name:${q}`)}&orderBy=name&pageSize=50&page=1`;
                    console.log('[PokeValutor] name URL (alt)', altUrl);
                    const altRes = await fetch(altUrl);
                    const altText = await altRes.text();
                    if (altRes.status === 404) {
                        renderCards([]);
                        setStatus('No results found for name "' + q + '"');
                        return;
                    }
                    let altData;
                    try { altData = JSON.parse(altText); } catch {
                        throw new Error(`API error ${altRes.status}: non-JSON response`);
                    }
                    if (!altRes.ok) {
                        console.error('[PokeValutor] API error payload (name alt)', altData);
                        throw new Error(`API error ${altRes.status}`);
                    }
                    const cardsByNameAlt = Array.isArray(altData?.data) ? altData.data : [];
                    renderCards(cardsByNameAlt);
                    setStatus(`${cardsByNameAlt.length} result${cardsByNameAlt.length !== 1 ? 's' : ''} for name "${q}"`);
                    return;
                } catch (retryErr) {
                    console.warn('[PokeValutor] name 404 retry failed', retryErr);
                    renderCards([]);
                    setStatus('No results found for name "' + q + '"');
                    return;
                }
            }
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                console.warn('[PokeValutor] Non-JSON response (name)', text.slice(0, 200));
                throw new Error(`API error ${res.status}: non-JSON response`);
            }
            if (!res.ok) {
                console.error('[PokeValutor] API error payload (name)', data);
                throw new Error(`API error ${res.status}`);
            }
            const cardsByName = Array.isArray(data?.data) ? data.data : [];
            renderCards(cardsByName);
            setStatus(`${cardsByName.length} result${cardsByName.length !== 1 ? 's' : ''} for name "${q}"`);
        } catch (err) {
            console.error('[PokeValutor] Search error', err);
            const base = window?.PV_SECRETS?.PV_API_URL;
            if (!base) console.warn('[PokeValutor] Set PV_API_URL in secrets.js to your Cloudflare Worker URL.');
            renderCards([]);
            const msg = String(err);
            const matchCode = msg.match(/API error (\d+)/);
            const code = matchCode ? matchCode[1] : '';
                        const friendly = code === '504'
                            ? 'Upstream timed out. Please retry or search by name.'
                            : /5\d\d/.test(code)
                            ? 'Upstream error. Please retry in a moment.'
                            : msg.includes('AbortError')
                            ? 'Request timed out. Please retry or search by name.'
                            : 'Error retrieving results. Please try again later.';
            // Include base and path hint if 404 to diagnose Worker routing
            if (code === '404') {
                setStatus(`API 404 at base: ${base}. Ensure your Worker routes /v2/cards and returns JSON.`);
            } else {
                setStatus(base ? friendly : 'Missing PV_API_URL. Add it in secrets.js and retry.');
            }
            currentSearchController = null;
        }
    }
    // Optional: expose a quick connectivity test to the console
    // Usage: window.pvTest('pikachu')
    window.pvTest = async function pvTest(name = 'pikachu') {
        const defaultWorker = 'https://pokevalutor.lreyperez18.workers.dev';
        const base = (window?.PV_SECRETS?.PV_API_URL || defaultWorker).replace(/\/$/, '');
        const url = `${base}/v2/cards?q=${encodeURIComponent(`name:${name}`)}&orderBy=name&pageSize=50&page=1`;
        console.log('[PokeValutor] test URL', url);
        const res = await fetch(url);
        const text = await res.text();
        console.log('[PokeValutor] test status', res.status, res.statusText);
        console.log('[PokeValutor] test headers', {
            'content-type': res.headers.get('content-type'),
            'server': res.headers.get('server')
        });
        try {
            const data = JSON.parse(text);
            const count = Array.isArray(data?.data) ? data.data.length : 0;
            console.log('[PokeValutor] test parsed', { ok: res.ok, count, totalCount: data?.totalCount, page: data?.page, pageSize: data?.pageSize });
            return { ok: res.ok, count, status: res.status };
        } catch (e) {
            console.warn('[PokeValutor] test parse failed', e);
            return { ok: false, error: String(e) };
        }
    };

    if (form && input) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            doSearch(input.value || '');
        });
    }

    // Wire up Connection Test button to run pvTest and show inline status
    const connBtn = document.getElementById('pv-conn-test');
    const connStatus = document.getElementById('pv-conn-status');
    if (connBtn) {
        connBtn.addEventListener('click', async () => {
            const name = input?.value?.trim() || 'pikachu';
            const base = (window?.PV_SECRETS?.PV_API_URL || '').replace(/\/$/, '');
            if (!base) {
                if (connStatus) connStatus.textContent = 'Missing PV_API_URL. Add it in secrets.js.';
                return;
            }
            const nameTerm = (/\s/.test(name) || /[^A-Za-z0-9]/.test(name)) ? `"${name}"` : name;
            const url = `${base}/v2/cards?q=${encodeURIComponent(`name:${nameTerm}`)}&orderBy=name&pageSize=25&page=1`;
            if (connStatus) connStatus.textContent = 'Testing connection…';
            try {
                const res = await fetch(url);
                const text = await res.text();
                const ctype = res.headers.get('content-type') || '';
                let count = 'n/a';
                try {
                    const data = JSON.parse(text);
                    count = Array.isArray(data?.data) ? String(data.data.length) : 'n/a';
                } catch { }
                if (connStatus) connStatus.textContent = `Status ${res.status} • ${ctype || 'no content-type'} • Count ${count}`;
                console.log('[PokeValutor] Connection Test', { status: res.status, ctype, snippet: text.slice(0, 200) });
            } catch (e) {
                if (connStatus) connStatus.textContent = `Test failed: ${e?.name || e}`;
            }
        });
    }

    // Wire up Worker Health button to call /health and show inline status
    const healthBtn = document.getElementById('pv-health-test');
    const healthStatus = document.getElementById('pv-health-status');
    if (healthBtn) {
        healthBtn.addEventListener('click', async () => {
            const base = (window?.PV_SECRETS?.PV_API_URL || '').replace(/\/$/, '');
            if (!base) {
                if (healthStatus) healthStatus.textContent = 'Missing PV_API_URL. Add it in secrets.js.';
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
                    const data = JSON.parse(text);
                    info = `ok=${String(!!data?.ok)} • path=${data?.pathname ?? 'n/a'} ${data?.search ?? ''}`;
                } catch {
                    info = 'non-JSON';
                }
                if (healthStatus) healthStatus.textContent = `Status ${res.status} • ${ctype || 'no content-type'} • ${info}`;
                console.log('[PokeValutor] Worker Health', { status: res.status, ctype, snippet: text.slice(0, 200) });
            } catch (e) {
                if (healthStatus) healthStatus.textContent = `Health check failed: ${e?.name || e}`;
            }
        });
    }
})();

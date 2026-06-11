/* Reusable card-detail historical price helpers */
(function () {
    const HISTORY_TTL_MS = 12 * 60 * 60 * 1000;
    const CACHE_PREFIX = 'pv:tcggo:history:v3:';
    const DEFAULT_EUR_TO_USD_RATE = 1.1513;

    function safeParseJson(raw) {
        try { return JSON.parse(raw); } catch { return null; }
    }

    function safeString(value, fallback) {
        const s = String(value ?? '').trim();
        return s ? s : (fallback || '');
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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
            localStorage.setItem(key, JSON.stringify({
                value,
                expiresAt: Date.now() + ttlMs,
                savedAt: Date.now(),
            }));
        } catch {
            // ignore local cache failures
        }
    }

    function getWorkerBase() {
        const defaultWorker = 'https://pokevalutor-v1.lreyperez18.workers.dev';
        return (window?.PV_SECRETS?.PV_API_URL || defaultWorker).replace(/\/$/, '');
    }

    async function getAuthHeaders() {
        try {
            const tokenRaw = window?.PV_AUTH?.getIdToken ? await window.PV_AUTH.getIdToken(true) : null;
            const token = String(tokenRaw || '').trim();
            if (token && token.split('.').length === 3) {
                return { Authorization: `Bearer ${token}` };
            }
        } catch {
            // ignore
        }
        return undefined;
    }

    function urlWithParam(url, key, value) {
        const u = new URL(url);
        u.searchParams.set(key, value);
        return u.toString();
    }

    function shouldRefreshHistory(options) {
        if (options?.refresh === true) return true;
        const params = new URLSearchParams(window.location.search);
        return params.get('refreshHistory') === '1'
            || params.get('historyRefresh') === '1'
            || params.get('refreshEnrichment') === '1'
            || params.get('enrichmentRefresh') === '1';
    }

    async function fetchHistoryJson(url, ttlMs, options) {
        const opts = options && typeof options === 'object' ? options : {};
        const refresh = shouldRefreshHistory(opts);
        const requestUrl = refresh ? urlWithParam(url, 'refresh', '1') : url;
        const cacheKey = `${CACHE_PREFIX}${url}`;
        const cached = refresh ? null : cacheGet(cacheKey);
        if (cached) return cached;

        const headers = await getAuthHeaders();
        const init = headers ? { headers } : {};
        if (refresh) init.cache = 'no-store';

        const res = await fetch(requestUrl, init);
        const text = await res.text();
        const data = safeParseJson(text);

        if (!res.ok || !data) {
            const msg = data && typeof data === 'object' && (data.error || data.message)
                ? (data.error || data.message)
                : `Request failed (${res.status})`;
            const err = new Error(String(msg));
            err.status = res.status;
            throw err;
        }

        if (data && typeof data === 'object' && data.ok === false) {
            const err = new Error(String(data.error || data.message || 'History unavailable'));
            err.status = res.status;
            throw err;
        }

        if (!refresh && Array.isArray(data?.data?.history?.points) && data.data.history.points.length) {
            cacheSet(cacheKey, data, ttlMs);
        }
        return data;
    }

    function getEurToUsdRate() {
        const configured = Number(window.PV_EUR_TO_USD_RATE);
        return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_EUR_TO_USD_RATE;
    }

    function normalizeCurrency(value, fallback) {
        const code = safeString(value, fallback || 'USD').toUpperCase();
        return code || 'USD';
    }

    function convertPriceForDisplay(value, currency, sourceMarket) {
        if (value == null || value === '') return null;
        const n = Number(value);
        if (!Number.isFinite(n)) return null;

        const code = normalizeCurrency(currency, 'USD');
        const source = safeString(sourceMarket, '').toLowerCase();
        if (source === 'cardmarket' || code === 'EUR') return n * getEurToUsdRate();
        return n;
    }

    function formatMoney(value, currency, sourceMarket) {
        const displayValue = convertPriceForDisplay(value, currency, sourceMarket);
        if (!Number.isFinite(displayValue)) return 'n/a';
        try {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                maximumFractionDigits: 2,
            }).format(displayValue);
        } catch {
            return `$${Number(displayValue).toFixed(2)}`;
        }
    }

    function toUiDate(value) {
        const raw = safeString(value, '');
        if (!raw) return 'n/a';
        const date = new Date(raw);
        if (Number.isNaN(date.getTime())) return raw.slice(0, 10) || 'n/a';
        try {
            return new Intl.DateTimeFormat('en-US', {
                year: 'numeric',
                month: 'short',
                day: '2-digit',
            }).format(date);
        } catch {
            return raw.slice(0, 10);
        }
    }

    function getHistoryFromInput(input) {
        if (!input || typeof input !== 'object') return null;
        if (Array.isArray(input?.points)) return input;
        if (input?.history && typeof input.history === 'object') return input.history;
        if (input?.data?.history && typeof input.data.history === 'object') return input.data.history;
        return null;
    }

    function getHistoryStatsFromInput(input) {
        const history = getHistoryFromInput(input);
        if (history?.stats && typeof history.stats === 'object') return history.stats;
        return buildStatsFromHistory(history);
    }

    function isPositivePrice(value) {
        return Number.isFinite(value) && value > 0;
    }

    function getPointValue(point, valueKey, fallbackSource) {
        const rawDirect = point?.[valueKey];
        if (rawDirect != null && rawDirect !== '') {
            const direct = Number(rawDirect);
            if (fallbackSource === 'tcgplayer') return isPositivePrice(direct) ? direct : null;
            if (Number.isFinite(direct)) return direct;
        }

        const source = safeString(point?.sourceMarket, '').toLowerCase();
        const rawMarket = point?.marketPrice;
        if (source === fallbackSource && rawMarket != null && rawMarket !== '') {
            const market = Number(rawMarket);
            if (fallbackSource === 'tcgplayer') return isPositivePrice(market) ? market : null;
            if (Number.isFinite(market)) return market;
        }

        return null;
    }

    function getPointCurrency(point, history, source) {
        const sourceKey = safeString(source, '').toLowerCase();
        if (sourceKey === 'cardmarket') {
            return normalizeCurrency(point?.cardmarketCurrency || history?.cardmarketCurrency || point?.currency || history?.currency, 'EUR');
        }
        if (sourceKey === 'tcgplayer') {
            return normalizeCurrency(point?.tcgplayerCurrency || history?.tcgplayerCurrency || point?.currency || history?.currency, 'USD');
        }
        return normalizeCurrency(point?.currency || history?.currency, 'USD');
    }

    function normalizeHistoryPoints(history) {
        const points = Array.isArray(history?.points) ? history.points : [];
        return points
            .filter((point) => point && safeString(point?.date, ''))
            .map((point) => ({
                date: safeString(point.date, ''),
                tcgplayerMarket: getPointValue(point, 'tcgplayerMarket', 'tcgplayer'),
                cardmarketLow: getPointValue(point, 'cardmarketLow', 'cardmarket'),
                raw: point,
            }))
            .filter((point) => Number.isFinite(point.tcgplayerMarket) || Number.isFinite(point.cardmarketLow))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    }

    function sourceMarketLabel(value) {
        const key = safeString(value, '').toLowerCase();
        if (key === 'tcgplayer') return 'TCGplayer Market';
        if (key === 'cardmarket') return 'Cardmarket Low';
        return safeString(value, 'Market');
    }

    function dateMs(value) {
        const raw = safeString(value, '').slice(0, 10);
        const ms = Date.parse(`${raw}T00:00:00Z`);
        return Number.isFinite(ms) ? ms : null;
    }

    function latestFromPoints(points, key) {
        const sorted = [...points].sort((a, b) => (dateMs(b.date) || 0) - (dateMs(a.date) || 0));
        for (const point of sorted) {
            const value = Number(point?.[key]);
            if (Number.isFinite(value) && value > 0) return { value, date: point.date };
        }
        return { value: null, date: '' };
    }

    function averageFromPoints(points, key, endMs, days) {
        const startMs = endMs - ((days - 1) * 24 * 60 * 60 * 1000);
        const values = points
            .filter((point) => {
                const ms = dateMs(point.date);
                const value = Number(point?.[key]);
                return ms != null && ms >= startMs && ms <= endMs && Number.isFinite(value) && value > 0;
            })
            .map((point) => Number(point[key]));
        if (!values.length) return { average: null, sampleSize: 0 };
        const average = values.reduce((sum, value) => sum + value, 0) / values.length;
        return { average: Math.round(average * 100) / 100, sampleSize: values.length };
    }

    function buildMarketStatsFromPoints(points, key, sourceMarket, currency) {
        const usable = points.filter((point) => {
            const value = Number(point?.[key]);
            return dateMs(point?.date) != null && Number.isFinite(value) && value > 0;
        });
        if (!usable.length) return null;
        const endMs = Math.max(...usable.map((point) => dateMs(point.date) || 0));
        const latest = latestFromPoints(points, key);
        const avg7 = averageFromPoints(points, key, endMs, 7);
        const avg30 = averageFromPoints(points, key, endMs, 30);
        return {
            sourceMarket,
            label: sourceMarketLabel(sourceMarket),
            currency,
            latest: latest.value,
            latestDate: latest.date,
            average7Day: avg7.average,
            sample7Day: avg7.sampleSize,
            average30Day: avg30.average,
            sample30Day: avg30.sampleSize,
        };
    }

    function buildStatsFromHistory(history) {
        const points = normalizeHistoryPoints(history);
        if (!points.length) return null;
        const markets = [
            buildMarketStatsFromPoints(points, 'tcgplayerMarket', 'tcgplayer', 'USD'),
            buildMarketStatsFromPoints(points, 'cardmarketLow', 'cardmarket', 'EUR'),
        ].filter(Boolean);
        if (!markets.length) return null;
        return {
            provider: 'tcggo',
            latestDate: points.map((point) => point.date).filter(Boolean).sort().pop() || '',
            markets,
        };
    }

    function normalizeStatsMarkets(stats) {
        const markets = Array.isArray(stats?.markets) ? stats.markets : [];
        return markets
            .map((market) => {
                const sourceMarket = safeString(market?.sourceMarket, '');
                const currency = normalizeCurrency(market?.currency, sourceMarket === 'cardmarket' ? 'EUR' : 'USD');
                const latest = Number(market?.latest);
                const average7Day = Number(market?.average7Day);
                const average30Day = Number(market?.average30Day);
                const sample7Day = Number(market?.sample7Day);
                const sample30Day = Number(market?.sample30Day);
                return {
                    sourceMarket,
                    label: safeString(market?.label, sourceMarketLabel(sourceMarket)),
                    currency,
                    latest: Number.isFinite(latest) && latest > 0 ? latest : null,
                    latestDate: safeString(market?.latestDate, ''),
                    average7Day: Number.isFinite(average7Day) && average7Day > 0 ? average7Day : null,
                    sample7Day: Number.isFinite(sample7Day) ? sample7Day : 0,
                    average30Day: Number.isFinite(average30Day) && average30Day > 0 ? average30Day : null,
                    sample30Day: Number.isFinite(sample30Day) ? sample30Day : 0,
                };
            })
            .filter((market) => market.latest != null || market.average7Day != null || market.average30Day != null)
            .sort((a, b) => {
                const order = { tcgplayer: 1, cardmarket: 2 };
                return (order[a.sourceMarket] || 99) - (order[b.sourceMarket] || 99);
            });
    }

    function renderProviderHistoryStats(input, options) {
        const stats = getHistoryStatsFromInput(input);
        const markets = normalizeStatsMarkets(stats);
        const opts = options && typeof options === 'object' ? options : {};
        const section = opts.statsSection || document.getElementById('pv-card-history-stats-section');
        const body = opts.statsBody || document.getElementById('pv-card-history-stats-body');
        const note = opts.statsNote || document.getElementById('pv-card-history-stats-note');
        if (!section || !body) return false;

        if (!markets.length) {
            section.hidden = true;
            return false;
        }

        section.hidden = false;
        if (note) {
            const latestDate = safeString(stats?.latestDate, '');
            note.textContent = latestDate
                ? `Averages are calculated from available TCGGO history through ${toUiDate(latestDate)}. Cardmarket EUR values display as USD estimates.`
                : 'Averages are calculated from available TCGGO history. Cardmarket EUR values display as USD estimates.';
        }

        body.innerHTML = markets.map((market) => {
            const sampleText = `7d: ${Number(market.sample7Day || 0)} / 30d: ${Number(market.sample30Day || 0)}`;
            const latestText = market.latest != null
                ? `${formatMoney(market.latest, market.currency, market.sourceMarket)}${market.latestDate ? ` (${toUiDate(market.latestDate)})` : ''}`
                : 'n/a';
            return `
                <tr>
                    <td>${escapeHtml(market.label)}</td>
                    <td>${escapeHtml(latestText)}</td>
                    <td>${escapeHtml(formatMoney(market.average7Day, market.currency, market.sourceMarket))}</td>
                    <td>${escapeHtml(formatMoney(market.average30Day, market.currency, market.sourceMarket))}</td>
                    <td>${escapeHtml(sampleText)}</td>
                </tr>
            `;
        }).join('');

        return true;
    }

    function renderProviderHistory(input, options) {
        const history = getHistoryFromInput(input);
        const points = normalizeHistoryPoints(history).slice(0, 10);
        if (!history || !points.length) return false;

        const opts = options && typeof options === 'object' ? options : {};
        const body = opts.body || document.getElementById('pv-card-history-body');
        const headRow = opts.headRow || document.getElementById('pv-card-history-head-row');
        const note = opts.note || document.getElementById('pv-card-history-note');
        const controls = opts.controls || document.getElementById('pv-card-history-controls');
        if (!body) return false;

        if (opts.preserveExistingProvider && body.dataset.pvHistoryProvider === 'tcggo') {
            renderProviderHistoryStats(input, opts);
            return true;
        }

        if (note) {
            note.textContent = 'Historical market prices from TCGGO. Cardmarket EUR values display as USD estimates.';
        }

        if (controls) controls.hidden = true;

        const hasTcgplayer = points.some((point) => Number.isFinite(point.tcgplayerMarket));
        const hasCardmarket = points.some((point) => Number.isFinite(point.cardmarketLow));

        if (headRow) {
            const marketHeads = [
                hasTcgplayer ? '<th scope="col">TCGplayer Market</th>' : '',
                hasCardmarket ? '<th scope="col">Cardmarket Low</th>' : '',
            ].filter(Boolean).join('');
            headRow.innerHTML = `<th scope="col">Date</th>${marketHeads}`;
        }

        body.dataset.pvHistoryProvider = 'tcggo';
        body.innerHTML = points.map((point) => {
            const tcgCurrency = getPointCurrency(point.raw, history, 'tcgplayer');
            const cmCurrency = getPointCurrency(point.raw, history, 'cardmarket');
            const tcgCell = hasTcgplayer
                ? `<td>${escapeHtml(formatMoney(point.tcgplayerMarket, tcgCurrency, 'tcgplayer'))}</td>`
                : '';
            const cmCell = hasCardmarket
                ? `<td>${escapeHtml(formatMoney(point.cardmarketLow, cmCurrency, 'cardmarket'))}</td>`
                : '';
            return `
                <tr>
                    <td>${escapeHtml(toUiDate(point.date))}</td>
                    ${tcgCell}
                    ${cmCell}
                </tr>
            `;
        }).join('');

        renderProviderHistoryStats(input, opts);
        return true;
    }

    async function loadCardHistory(card, options) {
        const id = safeString(card?.id, '');
        if (!id) return null;

        const opts = options && typeof options === 'object' ? options : {};
        const base = safeString(opts.workerBase, '') || getWorkerBase();
        const ttlMs = Number(opts.ttlMs) > 0 ? Number(opts.ttlMs) : HISTORY_TTL_MS;
        const url = `${base}/cards/${encodeURIComponent(id)}/price-history?lang=en`;

        try {
            const response = await fetchHistoryJson(url, ttlMs, opts);
            const rendered = renderProviderHistory(response, opts);
            const renderedStats = renderProviderHistoryStats(response, opts);
            return rendered || renderedStats ? response?.data || response : null;
        } catch {
            // Keep the existing browser-observed history table as the fallback.
            return null;
        }
    }

    window.PV_CARD_HISTORY = {
        loadCardHistory,
        renderProviderHistory,
        renderProviderHistoryStats,
        formatMoney,
    };
})();

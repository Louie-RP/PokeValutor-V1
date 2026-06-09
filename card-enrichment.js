/* Reusable card-detail enrichment helpers */
(function () {
    const ENRICHMENT_TTL_MS = 12 * 60 * 60 * 1000;
    const CACHE_PREFIX = 'pv:tcggo:enrichment:v3:';

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

    function shouldRefreshEnrichment(options) {
        if (options?.refresh === true) return true;
        const params = new URLSearchParams(window.location.search);
        return params.get('refreshEnrichment') === '1' || params.get('enrichmentRefresh') === '1';
    }

    async function fetchEnrichmentJson(url, ttlMs, options) {
        const opts = options && typeof options === 'object' ? options : {};
        const refresh = shouldRefreshEnrichment(opts);
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
            const err = new Error(String(data.error || data.message || 'Enrichment unavailable'));
            err.status = res.status;
            throw err;
        }

        // Do not cache no-match responses; match quality can improve as provider parsing is tuned.
        if (!refresh && data?.data?.enabled !== false && data?.data?.matched) {
            cacheSet(cacheKey, data, ttlMs);
        }
        return data;
    }

    const DEFAULT_EUR_TO_USD_RATE = 1.1513;

    function getEurToUsdRate() {
        const configured = Number(window.PV_EUR_TO_USD_RATE);
        return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_EUR_TO_USD_RATE;
    }

    function convertCardmarketPriceToUsd(value, currency, sourceMarket) {
        const n = Number(value);
        if (!Number.isFinite(n)) return null;

        const source = safeString(sourceMarket, '').toLowerCase();
        const code = safeString(currency, '').toUpperCase();
        if (source !== 'cardmarket' && code !== 'EUR') return n;

        return n * getEurToUsdRate();
    }

    function formatMoney(value, currency, sourceMarket) {
        const n = Number(value);
        if (!Number.isFinite(n)) return 'n/a';
        const displayValue = convertCardmarketPriceToUsd(n, currency, sourceMarket);
        const code = 'USD';
        try {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: code,
                maximumFractionDigits: 2,
            }).format(displayValue);
        } catch {
            return `$${Number(displayValue).toFixed(2)}`;
        }
    }

    function confidenceFromSampleSize(sampleSize, fallback) {
        const n = Number(sampleSize);
        if (Number.isFinite(n)) {
            if (n >= 25) return 'High';
            if (n >= 8) return 'Medium';
            if (n >= 1) return 'Low';
        }
        return safeString(fallback, 'Low').replace(/^./, (c) => c.toUpperCase());
    }

    function sourceMarketLabel(value) {
        const key = safeString(value, 'unknown').toLowerCase();
        if (key === 'cardmarket') return 'Cardmarket';
        if (key === 'ebay') return 'eBay';
        if (key === 'tcgplayer') return 'TCGplayer';
        return 'Other Sources';
    }

    function sourceMarketSortValue(value) {
        const key = safeString(value, 'unknown').toLowerCase();
        if (key === 'cardmarket') return 1;
        if (key === 'ebay') return 2;
        if (key === 'tcgplayer') return 3;
        return 9;
    }

    function sourceMarketTone(value) {
        const key = safeString(value, 'unknown').toLowerCase();
        if (key === 'cardmarket') return 'cardmarket';
        if (key === 'ebay') return 'ebay';
        if (key === 'tcgplayer') return 'tcgplayer';
        return 'other';
    }

    function sourceMarketInitials(value) {
        const key = safeString(value, 'unknown').toLowerCase();
        if (key === 'cardmarket') return 'CM';
        if (key === 'ebay') return 'eB';
        if (key === 'tcgplayer') return 'TCG';
        return 'MKT';
    }

    function confidenceTone(value) {
        const key = safeString(value, 'Low').toLowerCase();
        if (key === 'high') return 'high';
        if (key === 'medium') return 'medium';
        return 'low';
    }

    function gradeSortValue(value) {
        const text = safeString(value, '').toLowerCase();
        const match = text.match(/(\d+(?:\.\d+)?)/);
        const n = match ? Number(match[1]) : -1;
        if (!Number.isFinite(n)) return -1;
        if (text.includes('black')) return n + 0.03;
        if (text.includes('pristine')) return n + 0.02;
        return n;
    }

    function groupRowsByCompany(rows) {
        return rows.reduce((acc, group) => {
            const company = safeString(group?.company, 'Unknown');
            const key = company.toLowerCase();
            if (!acc.has(key)) acc.set(key, { company, rows: [] });
            acc.get(key).rows.push(group);
            return acc;
        }, new Map());
    }

    function rowReliabilityValue(group) {
        const sample = Number(group?.sampleSize);
        if (Number.isFinite(sample)) return sample;
        return 0;
    }

    function rowMedianValue(group) {
        const median = Number(group?.medianPrice);
        return Number.isFinite(median) ? median : 0;
    }

    function collapseDuplicateGrades(rows) {
        const byGrade = rows.reduce((acc, group) => {
            const grade = safeString(group?.grade, 'n/a');
            const key = grade.toLowerCase();
            const prev = acc.get(key);
            const sample = rowReliabilityValue(group);
            const prevSample = rowReliabilityValue(prev);
            if (!prev || sample > prevSample || (sample === prevSample && rowMedianValue(group) > rowMedianValue(prev))) {
                acc.set(key, group);
            }
            return acc;
        }, new Map());

        return Array.from(byGrade.values());
    }

    function renderCompanyGradeCell(company, rows, source, rowIndex) {
        const sorted = collapseDuplicateGrades(rows).sort((a, b) => gradeSortValue(b?.grade) - gradeSortValue(a?.grade));
        const options = sorted.map((group, index) => {
            const sampleSize = Number(group?.sampleSize);
            const sampleText = Number.isFinite(sampleSize) ? String(sampleSize) : 'n/a';
            const confidence = confidenceFromSampleSize(sampleSize, group?.confidence);
            return `
                <option
                    value="${index}"
                    data-median="${escapeHtml(formatMoney(group?.medianPrice, group?.currency, group?.sourceMarket))}"
                    data-sample="${escapeHtml(sampleText)}"
                    data-confidence="${escapeHtml(confidence)}"
                >${escapeHtml(safeString(group?.grade, 'n/a'))}</option>
            `;
        }).join('');

        return `
            <div class="pv-cardEnrichment__companyGrade">
                <span class="pv-cardEnrichment__company">${escapeHtml(company)}</span>
                <label class="pv-srOnly" for="pv-grade-${escapeHtml(source)}-${rowIndex}">${escapeHtml(company)} grade</label>
                <select id="pv-grade-${escapeHtml(source)}-${rowIndex}" class="pv-cardEnrichment__gradeSelect">
                    ${options}
                </select>
            </div>
        `;
    }

    function updateGradeRow(select) {
        const option = select?.selectedOptions?.[0];
        const row = select?.closest('tr');
        if (!option || !row) return;
        const median = row.querySelector('[data-grade-field="median"]');
        const sample = row.querySelector('[data-grade-field="sample"]');
        const confidence = row.querySelector('[data-grade-field="confidence"]');
        if (median) median.textContent = option.dataset.median || 'n/a';
        if (sample) sample.textContent = option.dataset.sample || 'n/a';
        if (confidence) {
            const confidenceText = option.dataset.confidence || 'Low';
            confidence.textContent = confidenceText;
            confidence.className = `pv-cardEnrichment__confidence pv-cardEnrichment__confidence--${confidenceTone(confidenceText)}`;
        }
    }

    function renderGradedMarket(container, enrichment) {
        if (!container) return;
        const groups = Array.isArray(enrichment?.graded?.groups) ? enrichment.graded.groups : [];
        const rowsBySource = groups
            .filter((group) => Number.isFinite(Number(group?.medianPrice)))
            .reduce((acc, group) => {
                const source = safeString(group?.sourceMarket, 'unknown').toLowerCase();
                if (!acc.has(source)) acc.set(source, []);
                acc.get(source).push(group);
                return acc;
            }, new Map());

        const tables = Array.from(rowsBySource.entries())
            .sort(([a], [b]) => sourceMarketSortValue(a) - sourceMarketSortValue(b))
            .map(([source, sourceRows]) => {
                const tone = sourceMarketTone(source);
                const totalSales = sourceRows.reduce((total, group) => {
                    const n = Number(group?.sampleSize);
                    return total + (Number.isFinite(n) ? n : 0);
                }, 0);
                const uniqueGrades = new Set(sourceRows.map((group) => safeString(group?.grade, 'n/a').toLowerCase())).size;
                const topRow = sourceRows.reduce((best, group) => (
                    rowMedianValue(group) > rowMedianValue(best) ? group : best
                ), sourceRows[0]);
                const topMedian = topRow ? formatMoney(topRow?.medianPrice, topRow?.currency || enrichment?.graded?.currency, topRow?.sourceMarket) : 'n/a';
                const rows = Array.from(groupRowsByCompany(sourceRows).values())
                    .sort((a, b) => a.company.localeCompare(b.company))
                    .map((grouped, rowIndex) => {
                        const defaultRow = collapseDuplicateGrades(grouped.rows).sort((a, b) => gradeSortValue(b?.grade) - gradeSortValue(a?.grade))[0];
                        const sampleSize = Number(defaultRow?.sampleSize);
                        const sampleText = Number.isFinite(sampleSize) ? String(sampleSize) : 'n/a';
                        const confidence = confidenceFromSampleSize(sampleSize, defaultRow?.confidence);
                        return `
                            <tr>
                                <td>${renderCompanyGradeCell(grouped.company, grouped.rows, source, rowIndex)}</td>
                                <td class="pv-cardEnrichment__median" data-grade-field="median">${escapeHtml(formatMoney(defaultRow?.medianPrice, defaultRow?.currency || enrichment?.graded?.currency, defaultRow?.sourceMarket))}</td>
                                <td><span class="pv-cardEnrichment__sample" data-grade-field="sample">${escapeHtml(sampleText)}</span></td>
                                <td><span class="pv-cardEnrichment__confidence pv-cardEnrichment__confidence--${escapeHtml(confidenceTone(confidence))}" data-grade-field="confidence">${escapeHtml(confidence)}</span></td>
                            </tr>
                        `;
                }).join('');

                return `
                    <section class="pv-cardEnrichment__marketGroup pv-cardEnrichment__marketGroup--${escapeHtml(tone)}" aria-label="${escapeHtml(sourceMarketLabel(source))} graded market data">
                        <div class="pv-cardEnrichment__marketHeader">
                            <div class="pv-cardEnrichment__marketTitle">
                                <span class="pv-cardEnrichment__marketIcon" aria-hidden="true">${escapeHtml(sourceMarketInitials(source))}</span>
                                <div>
                                    <h3 class="pv-cardEnrichment__subhead">${escapeHtml(sourceMarketLabel(source))}</h3>
                                    <p class="pv-cardEnrichment__sourceType">Graded sold listings</p>
                                </div>
                            </div>
                            <dl class="pv-cardEnrichment__stats" aria-label="${escapeHtml(sourceMarketLabel(source))} summary">
                                <div>
                                    <dt>Sales</dt>
                                    <dd>${escapeHtml(totalSales ? String(totalSales) : 'n/a')}</dd>
                                </div>
                                <div>
                                    <dt>Grades</dt>
                                    <dd>${escapeHtml(String(uniqueGrades))}</dd>
                                </div>
                                <div>
                                    <dt>Top median</dt>
                                    <dd>${escapeHtml(topMedian)}</dd>
                                </div>
                            </dl>
                        </div>
                        <div class="pv-tableWrap pv-cardEnrichment__tableWrap">
                            <table class="pv-cardTable pv-cardEnrichment__table">
                                <thead>
                                    <tr>
                                        <th scope="col">Company / Grade</th>
                                        <th scope="col">Median Sold</th>
                                        <th scope="col">Sales Count</th>
                                        <th scope="col">Confidence</th>
                                    </tr>
                                </thead>
                                <tbody>${rows}</tbody>
                            </table>
                        </div>
                    </section>
                `;
            });

        if (!tables.length) {
            container.innerHTML = '<p class="pv-section__text pv-cardEnrichment__empty">No reliable graded sales rows are available yet.</p>';
            return;
        }

        container.innerHTML = tables.join('');
        container.querySelectorAll('.pv-cardEnrichment__gradeSelect').forEach((select) => {
            select.addEventListener('change', () => updateGradeRow(select));
        });
    }

    function renderHistory(container, enrichment) {
        if (!container) return;
        const points = Array.isArray(enrichment?.history?.points) ? enrichment.history.points : [];
        const rows = points
            .filter((point) => safeString(point?.date, '') && Number.isFinite(Number(point?.marketPrice)))
            .slice(-10)
            .reverse()
            .map((point) => `
                <tr>
                    <td>${escapeHtml(point.date)}</td>
                    <td>${escapeHtml(formatMoney(point.marketPrice, enrichment?.history?.currency, enrichment?.history?.sourceMarket))}</td>
                </tr>
            `);

        if (!rows.length) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = `
            <h3 class="pv-cardEnrichment__subhead">Market History</h3>
            <div class="pv-tableWrap">
                <table class="pv-cardTable">
                    <thead>
                        <tr>
                            <th scope="col">Date</th>
                            <th scope="col">Raw Market</th>
                        </tr>
                    </thead>
                    <tbody>${rows.join('')}</tbody>
                </table>
            </div>
        `;
    }

    function renderMatchMeta(container, enrichment) {
        if (!container) return;
        const matched = enrichment?.matched;
        if (!matched) {
            container.innerHTML = '';
            return;
        }
        const confidence = safeString(matched.confidence, 'high').replace(/^./, (c) => c.toUpperCase());
        const score = Number(matched.score);
        const scoreText = Number.isFinite(score) ? ` · Score ${score}` : '';
        container.innerHTML = `<p class="pv-cardEnrichment__meta">Match confidence: ${escapeHtml(confidence)}${escapeHtml(scoreText)}</p>`;
    }

    async function loadCardEnrichment(card, options) {
        const id = safeString(card?.id, '');
        if (!id) return null;

        const opts = options && typeof options === 'object' ? options : {};
        const section = opts.section || document.getElementById('pv-card-enrichment');
        const status = opts.status || document.getElementById('pv-card-enrichment-status');
        const meta = opts.meta || document.getElementById('pv-card-enrichment-meta');
        const graded = opts.graded || document.getElementById('pv-card-graded-market');
        const history = opts.history || document.getElementById('pv-card-provider-history');

        if (!section || !status || !graded) return null;

        section.hidden = false;
        status.textContent = 'Loading graded market data...';
        if (meta) meta.innerHTML = '';
        graded.innerHTML = '';
        if (history) history.innerHTML = '';

        try {
            const base = safeString(opts.workerBase, '') || getWorkerBase();
            const ttlMs = Number(opts.ttlMs) > 0 ? Number(opts.ttlMs) : ENRICHMENT_TTL_MS;
            const url = `${base}/cards/${encodeURIComponent(id)}/enrichment`;
            const response = await fetchEnrichmentJson(url, ttlMs, opts);
            const enrichment = response?.data;

            if (enrichment && enrichment.enabled === false) {
                section.hidden = true;
                return enrichment;
            }

            if (!enrichment?.matched) {
                status.textContent = safeString(enrichment?.message, 'No reliable graded market data found for this card yet.');
                return enrichment || null;
            }

            status.textContent = '';
            renderMatchMeta(meta, enrichment);
            renderGradedMarket(graded, enrichment);
            renderHistory(history, enrichment);
            return enrichment;
        } catch (err) {
            if (err && Number(err.status) === 403) {
                status.textContent = 'Graded market data is a Premium feature.';
            } else {
                status.textContent = 'Graded market data is temporarily unavailable.';
            }
            return null;
        }
    }

    window.PV_CARD_ENRICHMENT = {
        loadCardEnrichment,
        renderGradedMarket,
        renderHistory,
        formatMoney,
    };
})();

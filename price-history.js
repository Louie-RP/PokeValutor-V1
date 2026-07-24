/* PokeValuator NM Price History feature.
 * Isolated from card.js so the feature can be disabled or removed safely.
 */
(function () {
    'use strict';

    const FEATURE_NAME = 'priceHistory';
    const PREMIUM_ROLES = new Set(['premium', 'admin', 'tester']);
    const DEFAULT_WORKER = 'https://pokevalutor-v1.lreyperez18.workers.dev';
    const CONDITION = 'NM';
    const RANGE_DAYS = [7, 30, 90];

    let currentCard = null;
    let currentRole = 'basic';
    let authResolved = false;
    let requestInFlight = false;
    let loadedPayload = null;
    let selectedRange = 90;
    let initialized = false;

    function isFeatureEnabled() {
        // Explicit false disables the feature. Undefined defaults to enabled so
        // rollout can be controlled by the Worker kill switch as well.
        return window?.PV_FEATURES?.[FEATURE_NAME] !== false;
    }

    function getRoot() {
        return document.getElementById('pv-price-history-root');
    }

    function getSection() {
        return document.getElementById('pv-price-history');
    }

    function createElement(tagName, { className, text, attributes } = {}) {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = String(text);
        Object.entries(attributes || {}).forEach(([name, value]) => {
            if (value !== undefined && value !== null) {
                element.setAttribute(name, String(value));
            }
        });
        return element;
    }

    function createSvgElement(tagName, attributes = {}) {
        const element = document.createElementNS('http://www.w3.org/2000/svg', tagName);
        Object.entries(attributes).forEach(([name, value]) => {
            if (value !== undefined && value !== null) {
                element.setAttribute(name, String(value));
            }
        });
        return element;
    }

    function getWorkerBase() {
        return String(window?.PV_SECRETS?.PV_API_URL || DEFAULT_WORKER).replace(/\/$/, '');
    }

    function normalizeRoleFromClaims(claims) {
        const source = claims && typeof claims === 'object' ? claims : {};
        const role = String(source.role || source.userRole || source.user_role || '').trim().toLowerCase();
        if (role === 'admin' || role === 'tester' || role === 'premium' || role === 'basic' || role === 'free') {
            return role;
        }

        const tier = String(source.tier || source.plan || source.subscriptionTier || source.subscription_tier || '').trim().toLowerCase();
        if (tier === 'premium' || tier === 'pro') return 'premium';
        if (source.admin === true || String(source.admin).toLowerCase() === 'true') return 'admin';
        if (source.tester === true || String(source.tester).toLowerCase() === 'true') return 'tester';
        if (source.premium === true || String(source.premium).toLowerCase() === 'true') return 'premium';
        return 'basic';
    }

    async function resolveRole() {
        // Fail closed. Unknown or failed role resolution must never trigger a
        // history request.
        try {
            const user = window?.PV_AUTH?.getUser ? window.PV_AUTH.getUser() : null;
            if (!user) return 'basic';
            const tokenResult = window?.PV_AUTH?.getIdTokenResult
                ? await window.PV_AUTH.getIdTokenResult(false)
                : null;
            return normalizeRoleFromClaims(tokenResult?.claims || {});
        } catch (error) {
            console.warn('Price History role resolution failed:', error);
            return 'basic';
        }
    }

    function isPremiumRole(role) {
        return PREMIUM_ROLES.has(String(role || '').trim().toLowerCase());
    }

    function getCardVariants(card) {
        return (Array.isArray(card?.variants) ? card.variants : [])
            .map((variant) => String(variant?.name || '').trim().toLowerCase())
            .filter(Boolean);
    }

    function pickDefaultVariant(card) {
        const variants = getCardVariants(card);
        return variants.includes('holofoil') ? 'holofoil' : (variants[0] || 'holofoil');
    }

    function buildPreviewPoints() {
        // Decorative only. Never derived from Scrydex and never presented as
        // actual card data.
        return [68, 61, 64, 55, 58, 47, 51, 43, 46, 36, 40, 31];
    }

    function pointsToSvgPath(values, width, height, padding) {
        if (!Array.isArray(values) || values.length < 2) return '';
        const min = Math.min(...values);
        const max = Math.max(...values);
        const span = Math.max(1, max - min);
        return values.map((value, index) => {
            const x = padding + (index / (values.length - 1)) * (width - padding * 2);
            const y = padding + ((max - value) / span) * (height - padding * 2);
            return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
        }).join(' ');
    }

    function renderLocked() {
        const root = getRoot();
        if (!root) return;
        const path = pointsToSvgPath(buildPreviewPoints(), 720, 260, 28);
        const container = createElement('div', {
            className: 'pv-priceHistory pv-priceHistory--locked',
            attributes: { 'aria-label': 'Premium NM price history preview' },
        });
        const preview = createElement('div', {
            className: 'pv-priceHistory__preview',
            attributes: { 'aria-hidden': 'true' },
        });
        const toolbar = createElement('div', { className: 'pv-priceHistory__toolbar' });
        toolbar.append(createElement('span', {
            className: 'pv-priceHistory__fakePrice',
            text: '$000.00',
        }));
        const ranges = createElement('div', { className: 'pv-priceHistory__ranges' });
        RANGE_DAYS.forEach((days) => {
            const button = createElement('button', {
                text: `${days}D`,
                attributes: { type: 'button' },
            });
            button.disabled = true;
            ranges.append(button);
        });
        toolbar.append(ranges);

        const svg = createSvgElement('svg', {
            class: 'pv-priceHistory__chart',
            viewBox: '0 0 720 260',
            role: 'img',
        });
        svg.append(
            createSvgElement('path', {
                class: 'pv-priceHistory__grid',
                d: 'M28 54 H692 M28 104 H692 M28 154 H692 M28 204 H692',
            }),
            createSvgElement('path', {
                class: 'pv-priceHistory__line',
                d: path,
            })
        );
        preview.append(toolbar, svg);

        const overlay = createElement('div', { className: 'pv-priceHistory__lockOverlay' });
        overlay.append(
            createElement('span', {
                className: 'pv-priceHistory__lockIcon',
                text: '🔒',
                attributes: { 'aria-hidden': 'true' },
            }),
            createElement('h3', { text: 'Subscribe to view NM card trends' }),
            createElement('p', {
                text: 'Unlock the full 7-day, 30-day, and 90-day Near Mint price history.',
            }),
            createElement('a', {
                className: 'pv-button pv-button--primary btn',
                text: 'View plans',
                attributes: { href: 'pricing.html' },
            })
        );
        container.append(preview, overlay);
        root.replaceChildren(container);
    }

    function renderPremiumReady() {
        const root = getRoot();
        if (!root || !currentCard) return;
        const variants = getCardVariants(currentCard);
        const selected = pickDefaultVariant(currentCard);
        const container = createElement('div', {
            className: 'pv-priceHistory',
            attributes: { 'data-state': 'ready' },
        });
        const controls = createElement('div', { className: 'pv-priceHistory__controls' });
        const field = createElement('div', { className: 'pv-form__field' });
        const select = createElement('select', {
            className: 'form-select',
            attributes: { id: 'pv-price-history-variant' },
        });
        (variants.length ? variants : [selected]).forEach((variant) => {
            const option = createElement('option', { text: variant });
            option.value = variant;
            option.selected = variant === selected;
            select.append(option);
        });
        field.append(
            createElement('label', {
                className: 'form-label',
                text: 'Variant',
                attributes: { for: 'pv-price-history-variant' },
            }),
            select
        );

        const condition = createElement('div', {
            className: 'pv-priceHistory__condition',
            attributes: { 'aria-label': 'History condition' },
        });
        condition.append(
            createElement('span', { text: 'Condition' }),
            createElement('strong', { text: 'Near Mint (NM)' })
        );
        controls.append(field, condition);

        const loadButton = createElement('button', {
            className: 'pv-button pv-button--primary btn',
            text: 'View NM Price History',
            attributes: { id: 'pv-price-history-load', type: 'button' },
        });
        loadButton.addEventListener('click', loadHistory);
        container.append(
            controls,
            createElement('p', {
                className: 'pv-section__text',
                text: 'History is loaded only when requested to conserve API credits.',
            }),
            loadButton,
            createElement('p', {
                className: 'pv-section__text',
                attributes: {
                    id: 'pv-price-history-status',
                    role: 'status',
                    'aria-live': 'polite',
                },
            })
        );
        root.replaceChildren(container);
    }

    function renderLoading() {
        const button = document.getElementById('pv-price-history-load');
        const status = document.getElementById('pv-price-history-status');
        if (button instanceof HTMLButtonElement) {
            button.disabled = true;
            button.textContent = 'Loading NM Price History…';
        }
        if (status) status.textContent = 'Loading price history…';
    }

    function renderUnavailable(message) {
        const root = getRoot();
        if (!root) return;
        const container = createElement('div', {
            className: 'pv-priceHistory pv-priceHistory--error',
            attributes: { role: 'status' },
        });
        container.append(createElement('p', {
            text: message || 'NM price history is temporarily unavailable.',
        }));
        if (isPremiumRole(currentRole)) {
            const retryButton = createElement('button', {
                className: 'pv-button pv-button--secondary btn',
                text: 'Try again',
                attributes: { id: 'pv-price-history-retry', type: 'button' },
            });
            retryButton.addEventListener('click', () => {
                loadedPayload = null;
                renderPremiumReady();
            });
            container.append(retryButton);
        }
        root.replaceChildren(container);
    }

    function parseScrydexDate(value) {
        const match = String(value || '').match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
        if (!match) return null;
        const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function normalizeRows(payload) {
        return (Array.isArray(payload?.data) ? payload.data : [])
            .map((row) => {
                const date = parseScrydexDate(row?.date);
                const price = Array.isArray(row?.prices) ? row.prices[0] : null;
                const market = Number(price?.market);
                const low = Number(price?.low);
                return {
                    date,
                    dateLabel: String(row?.date || ''),
                    market: Number.isFinite(market) ? market : null,
                    low: Number.isFinite(low) ? low : null,
                };
            })
            .filter((row) => row.date && Number.isFinite(row.market))
            .sort((a, b) => a.date - b.date);
    }

    function filterRowsForRange(rows, days) {
        if (!rows.length) return [];
        const latest = rows[rows.length - 1].date.getTime();
        const threshold = latest - days * 24 * 60 * 60 * 1000;
        return rows.filter((row) => row.date.getTime() >= threshold);
    }

    function formatMoney(value) {
        const number = Number(value);
        return Number.isFinite(number)
            ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(number)
            : 'n/a';
    }

    function formatPercent(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return 'n/a';
        return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
    }

    function buildChartElement(rows) {
        const width = 720;
        const height = 300;
        const left = 64;
        const right = 20;
        const top = 24;
        const bottom = 44;
        if (rows.length < 2) {
            return createElement('p', { text: 'Not enough history points to draw a chart.' });
        }

        const values = rows.map((row) => row.market);
        const rawMin = Math.min(...values);
        const rawMax = Math.max(...values);
        const paddingValue = Math.max(1, (rawMax - rawMin) * 0.12);
        const min = Math.max(0, rawMin - paddingValue);
        const max = rawMax + paddingValue;
        const span = Math.max(1, max - min);

        const points = rows.map((row, index) => {
            const x = left + (index / (rows.length - 1)) * (width - left - right);
            const y = top + ((max - row.market) / span) * (height - top - bottom);
            return { ...row, x, y };
        });
        const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
        const area = `${path} L ${points[points.length - 1].x.toFixed(2)} ${(height - bottom).toFixed(2)} L ${points[0].x.toFixed(2)} ${(height - bottom).toFixed(2)} Z`;
        const svg = createSvgElement('svg', {
            class: 'pv-priceHistory__chart',
            viewBox: `0 0 ${width} ${height}`,
            role: 'img',
            'aria-label': 'Near Mint market price history',
        });
        [0, 0.25, 0.5, 0.75, 1].forEach((ratio) => {
            const y = top + ratio * (height - top - bottom);
            const value = max - ratio * span;
            const label = createSvgElement('text', {
                x: left - 8,
                y: y + 4,
                'text-anchor': 'end',
                class: 'pv-priceHistory__axisLabel',
            });
            label.textContent = formatMoney(value);
            svg.append(
                createSvgElement('line', {
                    x1: left,
                    y1: y,
                    x2: width - right,
                    y2: y,
                    class: 'pv-priceHistory__gridLine',
                }),
                label
            );
        });
        const startLabel = rows[0].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
        const endLabel = rows[rows.length - 1].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
        const startText = createSvgElement('text', {
            x: left,
            y: height - 12,
            class: 'pv-priceHistory__axisLabel',
        });
        startText.textContent = startLabel;
        const endText = createSvgElement('text', {
            x: width - right,
            y: height - 12,
            'text-anchor': 'end',
            class: 'pv-priceHistory__axisLabel',
        });
        endText.textContent = endLabel;
        svg.append(
            createSvgElement('path', { class: 'pv-priceHistory__area', d: area }),
            createSvgElement('path', { class: 'pv-priceHistory__line', d: path }),
            startText,
            endText
        );
        return svg;
    }

    function trendForRange(payload, days) {
        const trends = payload?.meta?.trends || {};
        return trends[`days_${days}`] || null;
    }

    function renderChart() {
        const root = getRoot();
        if (!root || !loadedPayload) return;
        const rows = filterRowsForRange(normalizeRows(loadedPayload), selectedRange);
        const latest = rows[rows.length - 1] || null;
        const trend = trendForRange(loadedPayload, selectedRange);
        const percent = Number(trend?.percent_change);
        const trendClass = Number.isFinite(percent) ? (percent > 0 ? 'is-positive' : percent < 0 ? 'is-negative' : '') : '';
        const variant = String(loadedPayload?.meta?.variant || pickDefaultVariant(currentCard));
        const container = createElement('div', {
            className: 'pv-priceHistory',
            attributes: { 'data-state': 'loaded' },
        });
        const toolbar = createElement('div', { className: 'pv-priceHistory__toolbar' });
        const summary = createElement('div');
        summary.append(
            createElement('span', {
                className: 'pv-priceHistory__eyebrow',
                text: `${variant} · Near Mint`,
            }),
            createElement('strong', {
                className: 'pv-priceHistory__currentPrice',
                text: formatMoney(latest?.market),
            }),
            createElement('span', {
                className: `pv-priceHistory__trend${trendClass ? ` ${trendClass}` : ''}`,
                text: `${formatPercent(percent)} over ${selectedRange} days`,
            })
        );
        const ranges = createElement('div', {
            className: 'pv-priceHistory__ranges',
            attributes: { role: 'group', 'aria-label': 'Price history range' },
        });
        RANGE_DAYS.forEach((days) => {
            ranges.append(createElement('button', {
                text: `${days}D`,
                attributes: {
                    type: 'button',
                    'data-range': days,
                    'aria-pressed': days === selectedRange ? 'true' : 'false',
                },
            }));
        });
        toolbar.append(summary, ranges);

        const chartWrap = createElement('div', { className: 'pv-priceHistory__chartWrap' });
        chartWrap.append(buildChartElement(rows));
        const footer = createElement('div', { className: 'pv-priceHistory__footer' });
        const changeButton = createElement('button', {
            className: 'pv-button pv-button--secondary btn',
            text: 'Change variant',
            attributes: { id: 'pv-price-history-change', type: 'button' },
        });
        footer.append(createElement('span', { text: 'Market price shown' }), changeButton);
        container.append(toolbar, chartWrap, footer);
        root.replaceChildren(container);

        ranges.querySelectorAll('[data-range]').forEach((button) => {
            button.addEventListener('click', () => {
                selectedRange = Number(button.getAttribute('data-range')) || 90;
                renderChart();
            });
        });
        changeButton.addEventListener('click', () => {
            loadedPayload = null;
            selectedRange = 90;
            renderPremiumReady();
        });
    }

    async function loadHistory() {
        if (requestInFlight || !currentCard || !authResolved || !isPremiumRole(currentRole)) return;
        requestInFlight = true;
        renderLoading();
        try {
            const token = window?.PV_AUTH?.getIdToken ? await window.PV_AUTH.getIdToken(false) : null;
            if (!token) throw new Error('Please sign in again to view price history.');
            const variantEl = document.getElementById('pv-price-history-variant');
            const variant = String(variantEl?.value || pickDefaultVariant(currentCard)).trim().toLowerCase();
            const cardId = String(currentCard?.id || '').trim();
            const url = `${getWorkerBase()}/cards/${encodeURIComponent(cardId)}/scrydex-price-history?variant=${encodeURIComponent(variant)}&condition=${CONDITION}`;
            const response = await fetch(url, {
                method: 'GET',
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            });
            const text = await response.text();
            let payload = null;
            try { payload = JSON.parse(text); } catch { /* handled below */ }
            if (!response.ok || !payload || payload.ok === false) {
                const message = payload?.error || payload?.message || `Price history request failed (${response.status}).`;
                throw new Error(String(message));
            }
            if (payload?.meta?.enabled === false) {
                renderUnavailable('NM price history is currently disabled.');
                return;
            }
            loadedPayload = payload;
            selectedRange = 90;
            renderChart();
        } catch (error) {
            console.error('Price History request failed:', error);
            renderUnavailable(error?.message || 'NM price history is temporarily unavailable.');
        } finally {
            requestInFlight = false;
        }
    }

    async function renderForCurrentState() {
        if (!isFeatureEnabled()) {
            const section = getSection();
            if (section) section.hidden = true;
            return;
        }
        if (!currentCard) return;
        authResolved = false;
        currentRole = 'basic';
        loadedPayload = null;
        renderLocked();
        currentRole = await resolveRole();
        authResolved = true;
        if (isPremiumRole(currentRole)) renderPremiumReady();
        else renderLocked();
    }

    function onCardLoaded(event) {
        const card = event?.detail?.card;
        const cardId = String(event?.detail?.cardId || card?.id || '').trim();
        if (!cardId) return;
        currentCard = card && typeof card === 'object' ? card : { id: cardId, variants: [] };
        renderForCurrentState().catch((error) => {
            console.error('Price History initialization failed:', error);
            renderUnavailable();
        });
    }

    function initialize() {
        if (initialized) return;
        initialized = true;
        const section = getSection();
        if (!section) return;
        if (!isFeatureEnabled()) {
            section.hidden = true;
            return;
        }
        renderLocked();
        window.addEventListener('pv:card-loaded', onCardLoaded);
        if (window?.PV_AUTH?.onAuthStateChanged) {
            window.PV_AUTH.onAuthStateChanged(() => {
                if (currentCard) renderForCurrentState().catch(() => renderLocked());
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
})();

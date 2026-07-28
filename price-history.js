/* PokeValuator NM Price History feature.
 * Isolated from card.js so the feature can be disabled or removed safely.
 */
(function () {
    'use strict';

    const FEATURE_NAME = 'priceHistory';
    const DEFAULT_WORKER = 'https://pokevalutor-v1.lreyperez18.workers.dev';
    const CONDITION = 'NM';
    const RANGE_DAYS = [7, 30, 90];
    const VARIANT_COLORS = [
        { color: '#9b5de5', soft: 'rgba(155, 93, 229, 0.24)' },
        { color: '#ff8c42', soft: 'rgba(255, 140, 66, 0.24)' },
        { color: '#ffd166', soft: 'rgba(255, 209, 102, 0.24)' },
        { color: '#3a86ff', soft: 'rgba(58, 134, 255, 0.24)' },
        { color: '#8ecae6', soft: 'rgba(142, 202, 230, 0.24)' },
        { color: '#c77dff', soft: 'rgba(199, 125, 255, 0.24)' },
    ];
    const SINGLE_SERIES_COLORS = {
        positive: { color: '#34d399', soft: 'rgba(52, 211, 153, 0.3)' },
        negative: { color: '#fb7185', soft: 'rgba(251, 113, 133, 0.3)' },
        neutral: { color: '#e5e7eb', soft: 'rgba(229, 231, 235, 0.24)' },
    };
    const createElement = window.PV_DOM?.createElement;
    const createSvgElement = window.PV_DOM?.createSvgElement;
    const renderLocalHistoryPanel = window.PV_PRICE_HISTORY_LOCAL?.render;
    const historyService = window.PV_PRICE_HISTORY_SERVICE;
    const historyChart = window.PV_PRICE_HISTORY_CHART;
    const {
        calculateMetrics,
        filterRowsForRange,
        finiteNumberOrNull,
        normalizeRows,
    } = window.PV_PRICE_HISTORY_DATA || {};
    if (
        typeof createElement !== 'function'
        || typeof createSvgElement !== 'function'
        || typeof normalizeRows !== 'function'
        || typeof renderLocalHistoryPanel !== 'function'
        || typeof historyService?.fetchHistory !== 'function'
        || typeof historyChart?.build !== 'function'
    ) {
        throw new Error('Price History dependencies are unavailable.');
    }

    let currentCard = null;
    let currentRole = 'basic';
    let authResolved = false;
    let requestInFlight = false;
    let loadedPayload = null;
    const loadedPayloads = new Map();
    const normalizedRowsByPayload = new WeakMap();
    const activeVariants = new Set();
    let selectedRange = 30;
    let selectedVariant = '';
    let comparisonMode = false;
    let initialized = false;
    let renderGeneration = 0;

    function getNormalizedRows(payload) {
        if (!payload || typeof payload !== 'object') return [];
        if (!normalizedRowsByPayload.has(payload)) {
            normalizedRowsByPayload.set(payload, normalizeRows(payload));
        }
        return normalizedRowsByPayload.get(payload);
    }

    function isFeatureEnabled() {
        // Fail closed when the configuration asset is missing or malformed.
        return window?.PV_FEATURES?.[FEATURE_NAME] === true;
    }

    function getRoot() {
        return document.getElementById('pv-price-history-root');
    }

    function getSection() {
        return document.getElementById('pv-price-history');
    }

    function getWorkerBase() {
        return String(window?.PV_SECRETS?.PV_API_URL || DEFAULT_WORKER).replace(/\/$/, '');
    }

    async function resolveRole() {
        return historyService.resolveRole(window.PV_AUTH);
    }

    function isPremiumRole(role) {
        return historyService.isPremiumRole(role);
    }

    function getCardVariants(card) {
        return [...new Set((Array.isArray(card?.variants) ? card.variants : [])
            .map((variant) => String(variant?.name || '').trim().toLowerCase())
            .filter(Boolean))];
    }

    function pickDefaultVariant(card) {
        const variants = getCardVariants(card);
        return variants.includes('holofoil') ? 'holofoil' : (variants[0] || 'holofoil');
    }

    function formatVariant(value) {
        return String(value || '')
            .trim()
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/[_-]+/g, ' ')
            .replace(/\b\w/g, (letter) => letter.toUpperCase())
            .replace(/\bFirst Edition\b/g, '1st Ed.')
            .replace(/\bHolofoil\b/g, 'Holo');
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
        const localHistory = renderLocalHistoryPanel({
            card: currentCard,
            variants: getCardVariants(currentCard),
            formatVariant,
            storage: window.localStorage,
        });
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
            createElement('h3', { text: 'See the full market trend with Premium' }),
            createElement('p', {
                text: 'Go beyond prices observed on this browser with continuous 7-day, 30-day, and 90-day Near Mint trends.',
            }),
            createElement('a', {
                className: 'pv-button pv-button--primary btn',
                text: 'View plans',
                attributes: { href: '/pricing.html' },
            })
        );
        container.append(preview, overlay);
        root.replaceChildren(localHistory, container);
    }

    function renderPremiumReady() {
        const root = getRoot();
        if (!root || !currentCard) return;
        const selected = selectedVariant || pickDefaultVariant(currentCard);
        selectedVariant = selected;
        const container = createElement('div', {
            className: 'pv-priceHistory pv-priceHistory--prompt',
            attributes: { 'data-state': 'ready' },
        });
        const promptCopy = createElement('div', { className: 'pv-priceHistory__promptCopy' });
        promptCopy.append(
            createElement('strong', { text: 'Near Mint price trends' }),
            createElement('span', { text: 'Load the interactive chart only when you need it.' })
        );
        const loadButton = createElement('button', {
            className: 'pv-button pv-button--primary btn',
            text: 'View NM Price History',
            attributes: { id: 'pv-price-history-load', type: 'button' },
        });
        loadButton.addEventListener('click', () => loadHistory());
        container.append(
            promptCopy,
            loadButton,
            createElement('p', {
                className: 'pv-priceHistory__promptStatus',
                attributes: {
                    id: 'pv-price-history-status',
                    role: 'status',
                    'aria-live': 'polite',
                },
            })
        );
        root.replaceChildren(container);
    }

    function renderResolvingAccess() {
        const root = getRoot();
        if (!root) return;
        root.replaceChildren(createElement('div', {
            className: 'pv-priceHistory pv-priceHistory--prompt',
            text: 'Loading price history access…',
            attributes: {
                role: 'status',
                'aria-live': 'polite',
                'aria-busy': 'true',
            },
        }));
    }

    function renderLoading() {
        const button = document.getElementById('pv-price-history-load');
        const status = document.getElementById('pv-price-history-status');
        if (button instanceof HTMLButtonElement) {
            button.disabled = true;
            button.textContent = 'Loading NM Price History…';
        }
        if (status) status.textContent = 'Loading price history…';
        const loadedContainer = getRoot()?.querySelector('.pv-priceHistory');
        if (loadedContainer) loadedContainer.setAttribute('aria-busy', 'true');
        const loadedSelect = document.getElementById('pv-price-history-active-variant');
        if (loadedSelect instanceof HTMLSelectElement) loadedSelect.disabled = true;
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

    function formatMoney(value) {
        const number = Number(value);
        return Number.isFinite(number)
            ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(number)
            : 'n/a';
    }

    function formatPercent(value) {
        const number = finiteNumberOrNull(value);
        if (!Number.isFinite(number)) return 'n/a';
        return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
    }

    function formatChartDate(date, long = false) {
        return historyChart.formatDate(date, long);
    }

    function trendForRange(payload, days) {
        const trends = payload?.meta?.trends || {};
        return trends[`days_${days}`] || null;
    }

    function getSingleSeriesPalette(rows) {
        const firstPrice = Number(rows?.[0]?.market);
        const lastPrice = Number(rows?.[Math.max(0, (rows?.length || 1) - 1)]?.market);
        if (!Number.isFinite(firstPrice) || !Number.isFinite(lastPrice) || lastPrice === firstPrice) {
            return SINGLE_SERIES_COLORS.neutral;
        }
        return lastPrice > firstPrice
            ? SINGLE_SERIES_COLORS.positive
            : SINGLE_SERIES_COLORS.negative;
    }

    function getVariantColor(variant) {
        const variants = getCardVariants(currentCard);
        const index = Math.max(0, variants.indexOf(String(variant || '').toLowerCase()));
        return VARIANT_COLORS[index % VARIANT_COLORS.length];
    }

    function buildVariantChips(activeVariant) {
        const variants = getCardVariants(currentCard);
        if (variants.length < 2) return null;
        const group = createElement('div', {
            className: 'pv-priceHistory__variantChips',
            attributes: {
                role: 'group',
                'aria-label': 'Choose price history variant',
            },
        });
        variants.forEach((variant) => {
            const isActive = comparisonMode && activeVariants.has(variant);
            const palette = getVariantColor(variant);
            const button = createElement('button', {
                className: `pv-priceHistory__variantChip${isActive ? ' is-active' : ''}`,
                attributes: {
                    type: 'button',
                    'aria-pressed': isActive ? 'true' : 'false',
                    'data-variant': variant,
                    title: loadedPayloads.has(variant)
                        ? `${formatVariant(variant)} history is ready`
                        : `Load ${formatVariant(variant)} history`,
                },
            });
            button.style.setProperty('--pv-chip-color', palette.color);
            button.style.setProperty('--pv-chip-soft', palette.soft);
            button.append(
                createElement('span', {
                    className: 'pv-priceHistory__variantChipDot',
                    attributes: { 'aria-hidden': 'true' },
                }),
                createElement('span', { text: formatVariant(variant) })
            );
            button.addEventListener('click', () => {
                if (requestInFlight) return;
                if (!comparisonMode) {
                    comparisonMode = true;
                    activeVariants.clear();
                    activeVariants.add(selectedVariant);
                    if (variant === selectedVariant) {
                        renderChart();
                        return;
                    }
                    void loadHistory(variant, { addToComparison: true });
                    return;
                }
                if (activeVariants.has(variant)) {
                    if (activeVariants.size === 1) return;
                    activeVariants.delete(variant);
                    renderChart();
                    return;
                }
                void loadHistory(variant, { addToComparison: true });
            });
            group.append(button);
        });
        return group;
    }

    function renderChart() {
        const root = getRoot();
        if (!root || !loadedPayload) return;
        const rows = filterRowsForRange(getNormalizedRows(loadedPayload), selectedRange);
        const latest = rows[rows.length - 1] || null;
        const trend = trendForRange(loadedPayload, selectedRange);
        const percent = finiteNumberOrNull(trend?.percent_change);
        const trendClass = Number.isFinite(percent) ? (percent > 0 ? 'is-positive' : percent < 0 ? 'is-negative' : '') : '';
        const variant = String(loadedPayload?.meta?.variant || selectedVariant || pickDefaultVariant(currentCard));
        selectedVariant = variant;
        const variants = getCardVariants(currentCard);
        const metrics = calculateMetrics(rows);
        const container = createElement('div', {
            className: `pv-priceHistory${trendClass ? ` ${trendClass}` : ''}`,
            attributes: { 'data-state': 'loaded' },
        });
        const activePalette = comparisonMode
            ? getVariantColor(variant)
            : getSingleSeriesPalette(rows);
        container.style.setProperty('--pv-history-trend', activePalette.color);
        container.style.setProperty('--pv-history-trend-soft', activePalette.soft);
        const toolbar = createElement('div', { className: 'pv-priceHistory__toolbar' });
        const marketSelector = createElement('div', { className: 'pv-priceHistory__marketSelector' });
        const selectorLabel = createElement('label', {
            className: 'pv-priceHistory__selectorLabel',
            text: 'Variant / condition',
            attributes: { for: 'pv-price-history-active-variant' },
        });
        const selectorRow = createElement('div', { className: 'pv-priceHistory__selectorRow' });
        const variantSelect = createElement('select', {
            className: 'pv-priceHistory__variantSelect',
            attributes: {
                id: 'pv-price-history-active-variant',
                'aria-label': 'Price history variant',
            },
        });
        (variants.length ? variants : [variant]).forEach((item) => {
            const option = createElement('option', { text: formatVariant(item) });
            option.value = item;
            option.selected = item === variant;
            variantSelect.append(option);
        });
        selectorRow.append(
            variantSelect,
            createElement('span', {
                className: 'pv-priceHistory__conditionPill',
                text: 'Near Mint',
                attributes: { title: 'Price history currently supports Near Mint only' },
            })
        );
        marketSelector.append(selectorLabel, selectorRow);

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
        toolbar.append(marketSelector, ranges);

        const summary = createElement('div', { className: 'pv-priceHistory__summary' });
        summary.append(
            createElement('strong', {
                className: 'pv-priceHistory__currentPrice',
                text: formatMoney(latest?.market),
            }),
            createElement('span', {
                className: `pv-priceHistory__trend${trendClass ? ` ${trendClass}` : ''}`,
                text: `${formatPercent(percent)} over ${selectedRange} days`,
            })
        );
        const metricRow = createElement('dl', { className: 'pv-priceHistory__metrics' });
        [
            [`${selectedRange}D High`, metrics.high],
            [`${selectedRange}D Low`, metrics.low],
            ['Avg Price', metrics.average],
        ].forEach(([label, value]) => {
            const metric = createElement('div', { className: 'pv-priceHistory__metric' });
            metric.append(
                createElement('dt', { text: label }),
                createElement('dd', { text: formatMoney(value) })
            );
            metricRow.append(metric);
        });

        const activeSeries = [...activeVariants]
            .map((item) => ({
                variant: item,
                rows: filterRowsForRange(getNormalizedRows(loadedPayloads.get(item)), selectedRange),
                palette: comparisonMode ? getVariantColor(item) : activePalette,
            }))
            .filter((item) => item.rows.length > 1);
        const chartWrap = createElement('div', { className: 'pv-priceHistory__chartWrap' });
        chartWrap.append(historyChart.build({
            rows,
            series: activeSeries,
            showArea: !comparisonMode,
            selectedVariant,
            getVariantColor,
        }));
        const footer = createElement('div', { className: 'pv-priceHistory__footer' });
        footer.append(createElement('span', {
            text: latest ? `Data through ${formatChartDate(latest.date)} · Market price shown` : 'Market price shown',
        }));
        const variantChips = buildVariantChips(variant);
        container.append(toolbar);
        if (variantChips) container.append(variantChips);
        container.append(summary, metricRow, chartWrap, footer);
        root.replaceChildren(container);

        ranges.querySelectorAll('[data-range]').forEach((button) => {
            button.addEventListener('click', () => {
                selectedRange = Number(button.getAttribute('data-range')) || 30;
                renderChart();
            });
        });
        variantSelect.addEventListener('change', () => {
            selectedVariant = String(variantSelect.value || pickDefaultVariant(currentCard));
            comparisonMode = false;
            activeVariants.clear();
            loadHistory(selectedVariant);
        });
    }

    async function loadHistory(requestedVariant, { addToComparison = false } = {}) {
        if (requestInFlight || !currentCard || !authResolved || !isPremiumRole(currentRole)) return;
        const requested = String(requestedVariant || '').trim().toLowerCase();
        if (requested && loadedPayloads.has(requested)) {
            if (!addToComparison) {
                selectedVariant = requested;
                loadedPayload = loadedPayloads.get(requested);
                activeVariants.clear();
                comparisonMode = false;
            }
            activeVariants.add(requested);
            renderChart();
            return;
        }
        requestInFlight = true;
        renderLoading();
        try {
            const variant = String(requestedVariant || selectedVariant || pickDefaultVariant(currentCard))
                .trim()
                .toLowerCase();
            const primaryVariant = selectedVariant;
            const primaryPayload = loadedPayload;
            if (!addToComparison) selectedVariant = variant;
            const cardId = String(currentCard?.id || '').trim();
            const payload = await historyService.fetchHistory({
                auth: window.PV_AUTH,
                fetchImpl: window.fetch.bind(window),
                workerBase: getWorkerBase(),
                cardId,
                variant,
                condition: CONDITION,
            });
            if (payload?.meta?.enabled === false) {
                renderUnavailable('NM price history is currently disabled.');
                return;
            }
            loadedPayloads.set(variant, payload);
            if (addToComparison) {
                comparisonMode = true;
                selectedVariant = primaryVariant;
                loadedPayload = primaryPayload;
            } else {
                comparisonMode = false;
                loadedPayload = payload;
                activeVariants.clear();
            }
            activeVariants.add(variant);
            if (!addToComparison) selectedRange = 30;
            renderChart();
        } catch (error) {
            console.error('Price History request failed:', error);
            renderUnavailable(error?.message || 'NM price history is temporarily unavailable.');
        } finally {
            requestInFlight = false;
        }
    }

    async function renderForCurrentState() {
        const generation = ++renderGeneration;
        if (!isFeatureEnabled()) {
            const section = getSection();
            if (section) section.hidden = true;
            return;
        }
        if (!currentCard) return;
        authResolved = false;
        currentRole = 'basic';
        loadedPayload = null;
        loadedPayloads.clear();
        activeVariants.clear();
        selectedVariant = pickDefaultVariant(currentCard);
        comparisonMode = false;
        renderResolvingAccess();
        const role = await resolveRole();
        if (generation !== renderGeneration) return;
        currentRole = role;
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
        renderResolvingAccess();
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

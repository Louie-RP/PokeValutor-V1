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
    const VARIANT_COLORS = [
        { color: '#c084fc', soft: 'rgba(192, 132, 252, 0.24)' },
        { color: '#34d399', soft: 'rgba(52, 211, 153, 0.24)' },
        { color: '#facc15', soft: 'rgba(250, 204, 21, 0.24)' },
        { color: '#60a5fa', soft: 'rgba(96, 165, 250, 0.24)' },
        { color: '#fb7185', soft: 'rgba(251, 113, 133, 0.24)' },
        { color: '#fb923c', soft: 'rgba(251, 146, 60, 0.24)' },
    ];

    let currentCard = null;
    let currentRole = 'basic';
    let authResolved = false;
    let requestInFlight = false;
    let loadedPayload = null;
    const loadedPayloads = new Map();
    const activeVariants = new Set();
    let selectedRange = 30;
    let selectedVariant = '';
    let initialized = false;
    let renderGeneration = 0;

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
        const role = String(
            source.role
            || source.userRole
            || source.user_role
            || source.tier
            || source.plan
            || source.subscriptionTier
            || source.subscription_tier
            || ''
        ).trim().toLowerCase();
        if (role === 'admin' || role === 'tester' || role === 'premium' || role === 'basic' || role === 'free') {
            return role;
        }
        if (role) return 'basic';

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
            createElement('h3', { text: 'Unlock Interactive Trend Charts with Premium' }),
            createElement('p', {
                text: 'Explore 7-day, 30-day, and 90-day Near Mint trends in an interactive chart.',
            }),
            createElement('a', {
                className: 'pv-button pv-button--primary btn',
                text: 'View plans',
                attributes: { href: '/pricing.html' },
            })
        );
        container.append(preview, overlay);
        root.replaceChildren(container);
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

    function parseScrydexDate(value) {
        const match = String(value || '').trim().match(/^(\d{4})([/-])(\d{2})\2(\d{2})$/);
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[3]);
        const day = Number(match[4]);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (
            date.getUTCFullYear() !== year
            || date.getUTCMonth() !== month - 1
            || date.getUTCDate() !== day
        ) {
            return null;
        }
        return date;
    }

    function finiteNumberOrNull(value) {
        if (value === null || value === undefined || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function normalizeRows(payload) {
        return (Array.isArray(payload?.data) ? payload.data : [])
            .map((row) => {
                const date = parseScrydexDate(row?.date);
                const price = Array.isArray(row?.prices) ? row.prices[0] : null;
                const market = finiteNumberOrNull(price?.market);
                const low = finiteNumberOrNull(price?.low);
                return {
                    date,
                    dateLabel: String(row?.date || ''),
                    market,
                    low,
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
        const number = finiteNumberOrNull(value);
        if (!Number.isFinite(number)) return 'n/a';
        return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
    }

    function calculateMetrics(rows) {
        const values = rows.map((row) => row.market).filter(Number.isFinite);
        if (!values.length) return { high: null, low: null, average: null };
        return {
            high: Math.max(...values),
            low: Math.min(...values),
            average: values.reduce((sum, value) => sum + value, 0) / values.length,
        };
    }

    function niceScale(rawMin, rawMax, tickCount = 5) {
        const range = Math.max(1, rawMax - rawMin);
        const roughStep = range / Math.max(1, tickCount - 1);
        const magnitude = 10 ** Math.floor(Math.log10(roughStep));
        const fraction = roughStep / magnitude;
        const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
        const step = niceFraction * magnitude;
        const min = Math.max(0, Math.floor(rawMin / step) * step);
        let max = Math.ceil(rawMax / step) * step;
        if (max === min) max = min + step;
        return { min, max, step };
    }

    function formatChartDate(date, long = false) {
        return date.toLocaleDateString('en-US', {
            month: long ? 'long' : 'short',
            day: 'numeric',
            year: long ? 'numeric' : undefined,
            timeZone: 'UTC',
        });
    }

    function buildChartElement(rows, series = []) {
        const width = 720;
        const height = 300;
        const left = 72;
        const right = 20;
        const top = 24;
        const bottom = 44;
        if (rows.length < 2) {
            return createElement('p', { text: 'Not enough history points to draw a chart.' });
        }

        const allRows = series.length
            ? series.flatMap((item) => item.rows)
            : rows;
        const values = allRows.map((row) => row.market);
        const rawMin = Math.min(...values);
        const rawMax = Math.max(...values);
        const { min, max, step } = niceScale(rawMin, rawMax);
        const span = Math.max(1, max - min);
        const startTime = Math.min(...allRows.map((row) => row.date.getTime()));
        const endTime = Math.max(...allRows.map((row) => row.date.getTime()));
        const timeSpan = Math.max(1, endTime - startTime);

        const points = rows.map((row, index) => {
            const x = left + ((row.date.getTime() - startTime) / timeSpan) * (width - left - right);
            const y = top + ((max - row.market) / span) * (height - top - bottom);
            const previous = rows[index - 1]?.market;
            const dailyPercent = Number.isFinite(previous) && previous !== 0
                ? ((row.market - previous) / previous) * 100
                : null;
            return { ...row, x, y, dailyPercent };
        });
        const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
        const area = `${path} L ${points[points.length - 1].x.toFixed(2)} ${(height - bottom).toFixed(2)} L ${points[0].x.toFixed(2)} ${(height - bottom).toFixed(2)} Z`;
        const svg = createSvgElement('svg', {
            class: 'pv-priceHistory__chart',
            viewBox: `0 0 ${width} ${height}`,
            role: 'img',
            'aria-label': 'Near Mint market price history',
        });
        const defs = createSvgElement('defs');
        const gradient = createSvgElement('linearGradient', {
            id: 'pv-price-history-area-gradient',
            x1: '0',
            y1: '0',
            x2: '0',
            y2: '1',
        });
        gradient.append(
            createSvgElement('stop', { offset: '0%', class: 'pv-priceHistory__areaStopTop' }),
            createSvgElement('stop', { offset: '100%', class: 'pv-priceHistory__areaStopBottom' })
        );
        defs.append(gradient);
        svg.append(defs);

        const gridValues = [];
        for (let value = min; value <= max + step / 2; value += step) gridValues.push(value);
        gridValues.reverse().forEach((value) => {
            const y = top + ((max - value) / span) * (height - top - bottom);
            const label = createSvgElement('text', {
                x: left - 12,
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
        svg.append(createSvgElement('path', { class: 'pv-priceHistory__area', d: area }));
        const chartSeries = series.length
            ? series
            : [{ variant: selectedVariant, rows, palette: getVariantColor(selectedVariant) }];
        chartSeries.forEach((item) => {
            if (item.rows.length < 2) return;
            const seriesPath = item.rows.map((row, index) => {
                const x = left + ((row.date.getTime() - startTime) / timeSpan) * (width - left - right);
                const y = top + ((max - row.market) / span) * (height - top - bottom);
                return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
            }).join(' ');
            const line = createSvgElement('path', {
                class: 'pv-priceHistory__line',
                d: seriesPath,
                'data-variant': item.variant,
            });
            line.style.stroke = item.palette.color;
            svg.append(line);
        });

        const tickCount = Math.min(5, rows.length);
        const usedTickIndexes = new Set();
        for (let tick = 0; tick < tickCount; tick += 1) {
            const targetTime = startTime + (tick / Math.max(1, tickCount - 1)) * timeSpan;
            let closestIndex = 0;
            rows.forEach((row, index) => {
                if (
                    Math.abs(row.date.getTime() - targetTime)
                    < Math.abs(rows[closestIndex].date.getTime() - targetTime)
                ) closestIndex = index;
            });
            if (usedTickIndexes.has(closestIndex)) continue;
            usedTickIndexes.add(closestIndex);
            const point = points[closestIndex];
            const text = createSvgElement('text', {
                x: point.x,
                y: height - 12,
                'text-anchor': tick === 0 ? 'start' : tick === tickCount - 1 ? 'end' : 'middle',
                class: 'pv-priceHistory__axisLabel',
            });
            text.textContent = formatChartDate(point.date);
            svg.append(text);
        }

        const crosshair = createSvgElement('line', {
            y1: top,
            y2: height - bottom,
            class: 'pv-priceHistory__crosshair is-hidden',
        });
        const marker = createSvgElement('circle', {
            r: 5,
            class: 'pv-priceHistory__marker is-hidden',
        });
        const hitArea = createSvgElement('rect', {
            x: left,
            y: top,
            width: width - left - right,
            height: height - top - bottom,
            class: 'pv-priceHistory__hitArea',
            tabindex: '0',
            role: 'slider',
            'aria-label': 'Explore price history points',
            'aria-valuemin': '1',
            'aria-valuemax': String(points.length),
        });
        svg.append(crosshair, marker, hitArea);

        const tooltip = createElement('div', {
            className: 'pv-priceHistory__tooltip',
            attributes: { role: 'status', 'aria-live': 'polite', hidden: '' },
        });
        const tooltipDate = createElement('strong');
        const tooltipPrice = createElement('span');
        const tooltipChange = createElement('span');
        tooltip.append(tooltipDate, tooltipPrice, tooltipChange);

        const positionTooltip = (point) => {
            const scrollContainer = tooltip.parentElement;
            const svgRect = svg.getBoundingClientRect();
            if (!scrollContainer || !svgRect.width) return;

            const containerRect = scrollContainer.getBoundingClientRect();
            const pointContentX = scrollContainer.scrollLeft
                + (svgRect.left - containerRect.left)
                + (point.x / width) * svgRect.width;
            const pointContentY = (svgRect.top - containerRect.top)
                + (point.y / height) * svgRect.height;
            const tooltipHalfWidth = Math.max(84, tooltip.offsetWidth / 2);
            const tooltipHeight = tooltip.offsetHeight;
            const edgePadding = 8;
            const visibleMin = scrollContainer.scrollLeft + tooltipHalfWidth + edgePadding;
            const visibleMax = scrollContainer.scrollLeft
                + scrollContainer.clientWidth
                - tooltipHalfWidth
                - edgePadding;
            const tooltipLeft = visibleMin <= visibleMax
                ? Math.max(visibleMin, Math.min(visibleMax, pointContentX))
                : scrollContainer.scrollLeft + scrollContainer.clientWidth / 2;

            tooltip.style.left = `${tooltipLeft}px`;
            tooltip.style.top = `${pointContentY}px`;
            tooltip.classList.toggle(
                'is-below',
                pointContentY < tooltipHeight + edgePadding + 4
            );
        };

        let activeIndex = points.length - 1;
        const showPoint = (index) => {
            activeIndex = Math.max(0, Math.min(points.length - 1, index));
            const point = points[activeIndex];
            crosshair.setAttribute('x1', point.x.toFixed(2));
            crosshair.setAttribute('x2', point.x.toFixed(2));
            marker.setAttribute('cx', point.x.toFixed(2));
            marker.setAttribute('cy', point.y.toFixed(2));
            crosshair.classList.remove('is-hidden');
            marker.classList.remove('is-hidden');
            tooltip.hidden = false;
            tooltipDate.textContent = formatChartDate(point.date, true);
            tooltipPrice.textContent = formatMoney(point.market);
            tooltipChange.textContent = Number.isFinite(point.dailyPercent)
                ? `${formatPercent(point.dailyPercent)} vs. prior day`
                : 'First point in range';
            tooltipChange.className = Number.isFinite(point.dailyPercent)
                ? (point.dailyPercent > 0 ? 'is-positive' : point.dailyPercent < 0 ? 'is-negative' : '')
                : '';
            hitArea.setAttribute('aria-valuenow', String(activeIndex + 1));
            hitArea.setAttribute(
                'aria-valuetext',
                `${formatChartDate(point.date, true)}, ${formatMoney(point.market)}, ${tooltipChange.textContent}`
            );
            positionTooltip(point);
        };
        const hidePoint = () => {
            crosshair.classList.add('is-hidden');
            marker.classList.add('is-hidden');
            tooltip.hidden = true;
        };
        const showNearestPointer = (event) => {
            const rect = svg.getBoundingClientRect();
            if (!rect.width) return;
            const svgX = ((event.clientX - rect.left) / rect.width) * width;
            let closestIndex = 0;
            points.forEach((point, index) => {
                if (Math.abs(point.x - svgX) < Math.abs(points[closestIndex].x - svgX)) {
                    closestIndex = index;
                }
            });
            showPoint(closestIndex);
        };
        hitArea.addEventListener('pointermove', showNearestPointer);
        hitArea.addEventListener('pointerdown', showNearestPointer);
        hitArea.addEventListener('pointerleave', (event) => {
            if (event.pointerType !== 'touch') hidePoint();
        });
        hitArea.addEventListener('focus', () => showPoint(activeIndex));
        hitArea.addEventListener('blur', hidePoint);
        hitArea.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            showPoint(activeIndex + (event.key === 'ArrowRight' ? 1 : -1));
        });

        const fragment = document.createDocumentFragment();
        fragment.append(svg, tooltip);
        return fragment;
    }

    function trendForRange(payload, days) {
        const trends = payload?.meta?.trends || {};
        return trends[`days_${days}`] || null;
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
            const isActive = activeVariants.has(variant);
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
                if (activeVariants.has(variant)) {
                    if (activeVariants.size === 1) return;
                    activeVariants.delete(variant);
                    if (variant === selectedVariant) {
                        selectedVariant = activeVariants.values().next().value;
                        loadedPayload = loadedPayloads.get(selectedVariant);
                    }
                    renderChart();
                    return;
                }
                selectedVariant = variant;
                void loadHistory(variant);
            });
            group.append(button);
        });
        return group;
    }

    function renderChart() {
        const root = getRoot();
        if (!root || !loadedPayload) return;
        const rows = filterRowsForRange(normalizeRows(loadedPayload), selectedRange);
        const latest = rows[rows.length - 1] || null;
        const trend = trendForRange(loadedPayload, selectedRange);
        const percent = finiteNumberOrNull(trend?.percent_change);
        const trendClass = Number.isFinite(percent) ? (percent > 0 ? 'is-positive' : percent < 0 ? 'is-negative' : '') : '';
        const variant = String(loadedPayload?.meta?.variant || selectedVariant || pickDefaultVariant(currentCard));
        selectedVariant = variant;
        const metrics = calculateMetrics(rows);
        const container = createElement('div', {
            className: `pv-priceHistory${trendClass ? ` ${trendClass}` : ''}`,
            attributes: { 'data-state': 'loaded' },
        });
        const activePalette = getVariantColor(variant);
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
        const variants = getCardVariants(currentCard);
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
                rows: filterRowsForRange(normalizeRows(loadedPayloads.get(item)), selectedRange),
                palette: getVariantColor(item),
            }))
            .filter((item) => item.rows.length > 1);
        const chartWrap = createElement('div', { className: 'pv-priceHistory__chartWrap' });
        chartWrap.append(buildChartElement(rows, activeSeries));
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
            loadHistory(selectedVariant);
        });
    }

    async function loadHistory(requestedVariant) {
        if (requestInFlight || !currentCard || !authResolved || !isPremiumRole(currentRole)) return;
        const requested = String(requestedVariant || '').trim().toLowerCase();
        if (requested && loadedPayloads.has(requested)) {
            selectedVariant = requested;
            loadedPayload = loadedPayloads.get(requested);
            activeVariants.add(requested);
            renderChart();
            return;
        }
        requestInFlight = true;
        renderLoading();
        try {
            const token = window?.PV_AUTH?.getIdToken ? await window.PV_AUTH.getIdToken(false) : null;
            if (!token) throw new Error('Please sign in again to view price history.');
            const variant = String(requestedVariant || selectedVariant || pickDefaultVariant(currentCard))
                .trim()
                .toLowerCase();
            selectedVariant = variant;
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
                let message = payload?.error || payload?.message || `Price history request failed (${response.status}).`;
                if (response.status === 401) message = 'Please sign in again to view price history.';
                if (response.status === 403) message = 'A Premium subscription is required to view NM price history.';
                if (response.status === 429) message = 'NM price history has reached its daily refresh limit. Please try again later.';
                throw new Error(String(message));
            }
            if (payload?.meta?.enabled === false) {
                renderUnavailable('NM price history is currently disabled.');
                return;
            }
            loadedPayload = payload;
            loadedPayloads.set(variant, payload);
            activeVariants.add(variant);
            selectedRange = 30;
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
        renderLocked();
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

(function (root, factory) {
    const api = factory(root?.PV_DOM, root?.document);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.PV_PRICE_HISTORY_CHART = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (dom, documentObject) {
    'use strict';

    const createElement = dom?.createElement;
    const createSvgElement = dom?.createSvgElement;

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

    function formatDate(date, long = false) {
        return date.toLocaleDateString('en-US', {
            month: long ? 'long' : 'short',
            day: 'numeric',
            year: long ? 'numeric' : undefined,
            timeZone: 'UTC',
        });
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

    function build({
        rows,
        series = [],
        showArea = true,
        selectedVariant,
        getVariantColor,
    }) {
        if (
            typeof createElement !== 'function'
            || typeof createSvgElement !== 'function'
            || !documentObject
        ) {
            throw new Error('Price History chart DOM utilities are unavailable.');
        }
        const width = 720;
        const height = 300;
        const left = 72;
        const right = 20;
        const top = 24;
        const bottom = 44;
        if (rows.length < 2) {
            return createElement('p', { text: 'Not enough history points to draw a chart.' });
        }

        const allRows = series.length ? series.flatMap((item) => item.rows) : rows;
        const values = allRows.map((row) => row.market);
        const { min, max, step } = niceScale(Math.min(...values), Math.max(...values));
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
        const path = points
            .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
            .join(' ');
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
        if (showArea) {
            svg.append(createSvgElement('path', { class: 'pv-priceHistory__area', d: area }));
        }
        const chartSeries = series.length
            ? series
            : [{
                variant: selectedVariant,
                rows,
                palette: getVariantColor(selectedVariant),
            }];
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
            text.textContent = formatDate(point.date);
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
                pointContentY < tooltip.offsetHeight + edgePadding + 4
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
            tooltipDate.textContent = formatDate(point.date, true);
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
                `${formatDate(point.date, true)}, ${formatMoney(point.market)}, ${tooltipChange.textContent}`
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

        const fragment = documentObject.createDocumentFragment();
        fragment.append(svg, tooltip);
        return fragment;
    }

    return {
        build,
        formatDate,
        niceScale,
    };
}));

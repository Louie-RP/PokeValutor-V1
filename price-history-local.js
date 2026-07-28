(function (root, factory) {
    const api = factory(root?.PV_DOM);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.PV_PRICE_HISTORY_LOCAL = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (dom) {
    'use strict';

    const LOCAL_HISTORY_PREFIX = 'pv:cardHistory:v1:';
    const createElement = dom?.createElement;

    function getRows(storage, cardId, variantName, conditionCode) {
        const key = `${LOCAL_HISTORY_PREFIX}${cardId}:${variantName}:${conditionCode}`;
        try {
            const rows = JSON.parse(storage?.getItem(key) || '[]');
            return (Array.isArray(rows) ? rows : [])
                .filter((row) => (
                    row
                    && Number.isFinite(Number(row.ts))
                    && Number.isFinite(Number(row.market))
                ))
                .sort((a, b) => Number(b.ts) - Number(a.ts))
                .slice(0, 10);
        } catch {
            return [];
        }
    }

    function render({ card, variants, formatVariant, storage }) {
        if (typeof createElement !== 'function') {
            throw new Error('Local Price History DOM utilities are unavailable.');
        }
        const panel = createElement('div', { className: 'pv-priceHistoryLocal' });
        panel.append(
            createElement('h3', { text: 'Observed on this browser' }),
            createElement('p', {
                className: 'pv-priceHistoryLocal__note',
                text: 'These snapshots are recorded when you visit this card. They stay on this device.',
            })
        );

        const controls = createElement('div', { className: 'pv-cardHistory__controls' });
        const variantField = createElement('div', { className: 'pv-form__field' });
        const variantSelect = createElement('select', {
            className: 'form-select',
            attributes: { 'aria-label': 'Locally observed price variant' },
        });
        (Array.isArray(variants) ? variants : []).forEach((variant) => {
            const option = createElement('option', { text: formatVariant(variant) });
            option.value = variant;
            variantSelect.append(option);
        });
        if (!variantSelect.options.length) {
            variantSelect.append(createElement('option', {
                text: 'No variants',
                attributes: { value: '' },
            }));
        }
        variantField.append(
            createElement('label', { className: 'form-label', text: 'Variant' }),
            variantSelect
        );

        const conditionField = createElement('div', { className: 'pv-form__field' });
        const conditionSelect = createElement('select', {
            className: 'form-select',
            attributes: { 'aria-label': 'Locally observed price condition' },
        });
        [
            ['NM', 'Near Mint (NM)'],
            ['LP', 'Lightly Played (LP)'],
            ['MP', 'Moderately Played (MP)'],
        ].forEach(([value, label]) => {
            const option = createElement('option', { text: label });
            option.value = value;
            conditionSelect.append(option);
        });
        conditionField.append(
            createElement('label', { className: 'form-label', text: 'Condition' }),
            conditionSelect
        );
        controls.append(variantField, conditionField);

        const tableWrap = createElement('div', { className: 'pv-tableWrap' });
        const table = createElement('table', { className: 'pv-cardTable' });
        const head = createElement('thead');
        const headRow = createElement('tr');
        headRow.append(
            createElement('th', { text: 'Observed', attributes: { scope: 'col' } }),
            createElement('th', { text: 'Market', attributes: { scope: 'col' } })
        );
        head.append(headRow);
        const body = createElement('tbody');
        table.append(head, body);
        tableWrap.append(table);

        const updateRows = () => {
            const rows = getRows(
                storage,
                String(card?.id || ''),
                String(variantSelect.value || ''),
                String(conditionSelect.value || 'NM')
            );
            if (!rows.length) {
                const row = createElement('tr');
                row.append(createElement('td', {
                    text: 'No observed history yet for this selection.',
                    attributes: { colspan: '2' },
                }));
                body.replaceChildren(row);
                return;
            }
            body.replaceChildren(...rows.map((item) => {
                const row = createElement('tr');
                row.append(
                    createElement('td', {
                        text: new Date(Number(item.ts)).toLocaleString(),
                    }),
                    createElement('td', {
                        text: Number(item.market).toLocaleString('en-US', {
                            style: 'currency',
                            currency: 'USD',
                        }),
                    })
                );
                return row;
            }));
        };
        variantSelect.addEventListener('change', updateRows);
        conditionSelect.addEventListener('change', updateRows);
        updateRows();
        panel.append(controls, tableWrap);
        return panel;
    }

    return { getRows, render };
}));

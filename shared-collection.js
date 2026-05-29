/* Shared read-only collection page */
(function () {
    const SHARE_TOKEN_REGEX = /^[A-Za-z0-9_-]{16,128}$/;
    const SHARED_SORT_MODES = ['value-desc', 'value-asc', 'name-asc', 'name-desc'];
    const SHARED_SORT_PREF_KEY = 'pv:sharedCollectionSortMode:v1';

    function safeString(value, fallback) {
        const text = String(value ?? '');
        return text || String(fallback || '');
    }

    function normalizeCollectionItemType(rawType) {
        const value = String(rawType || '').trim().toLowerCase();
        return value === 'sealed' ? 'sealed' : 'card';
    }

    function isSealedCollectionItem(item) {
        return normalizeCollectionItemType(item?.itemType) === 'sealed';
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizeDexConditionCode(raw) {
        const upper = String(raw || '')
            .trim()
            .toUpperCase()
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ');
        if (!upper) return '';
        if (upper === 'NM' || upper.startsWith('NEAR MINT')) return 'NM';
        if (upper === 'LP' || upper.startsWith('LIGHT PLAY')) return 'LP';
        if (upper === 'MP' || upper.startsWith('MODERATE PLAY') || upper.startsWith('MID PLAY')) return 'MP';
        if (upper === 'HP' || upper.startsWith('HEAVY PLAY')) return 'HP';
        if (upper === 'DM' || upper.startsWith('DAMAGE')) return 'DM';
        return '';
    }

    function getConditionLabel(code) {
        const key = normalizeDexConditionCode(code);
        if (key === 'NM') return 'Near Mint (NM)';
        if (key === 'LP') return 'Lightly Played (LP)';
        if (key === 'MP') return 'Moderately Played (MP)';
        if (key === 'HP') return 'Heavily Played (HP)';
        if (key === 'DM') return 'Damaged (DM)';
        return '';
    }

    function normalizeConditionQuantities(rawMap, fallbackCondition) {
        const out = {};
        if (rawMap && typeof rawMap === 'object') {
            for (const [rawCode, rawQty] of Object.entries(rawMap)) {
                const code = normalizeDexConditionCode(rawCode);
                const qty = Math.floor(Number(rawQty));
                if (!code || !Number.isFinite(qty) || qty <= 0) continue;
                out[code] = (out[code] || 0) + qty;
            }
        }

        if (!Object.keys(out).length) {
            const fallback = normalizeDexConditionCode(fallbackCondition);
            if (fallback) out[fallback] = 1;
        }

        return out;
    }

    function getConditionEntries(conditionQuantities, fallbackCondition) {
        const map = normalizeConditionQuantities(conditionQuantities, fallbackCondition);
        return Object.entries(map)
            .map(([code, qty]) => ({ code, qty: Math.max(0, Math.floor(Number(qty) || 0)) }))
            .filter((entry) => entry.code && entry.qty > 0);
    }

    function getTotalCopies(conditionQuantities, fallbackCondition) {
        const entries = getConditionEntries(conditionQuantities, fallbackCondition);
        return entries.reduce((sum, entry) => sum + entry.qty, 0);
    }

    function formatConditionSummary(conditionQuantities, fallbackCondition) {
        const entries = getConditionEntries(conditionQuantities, fallbackCondition);
        if (!entries.length) return 'Condition breakdown unavailable';
        return entries.map((entry) => `${getConditionLabel(entry.code)} x${entry.qty}`).join(', ');
    }

    function pickFrontMediumImage(images) {
        if (!Array.isArray(images)) return '';
        const front = images.find((img) => String(img?.type || '').toLowerCase() === 'front');
        return safeString(front?.medium || front?.large || front?.small || images[0]?.medium || images[0]?.large || images[0]?.small, '');
    }

    function getCardSetName(cardLike) {
        const expansionName = safeString(cardLike?.expansion?.name, '');
        const setName = safeString(cardLike?.set?.name, '');
        const directExpansionName = safeString(cardLike?.expansionName, '');
        const directSetName = safeString(cardLike?.setName, '');
        return expansionName || setName || directExpansionName || directSetName || 'n/a';
    }

    function extractCardNumberFromId(cardId) {
        const id = safeString(cardId, '').trim();
        if (!id) return '';
        const parts = id.split('-').map((part) => safeString(part, '').trim()).filter(Boolean);
        if (parts.length < 2) return '';
        return parts[parts.length - 1];
    }

    function getCardDisplayNumber(cardLike) {
        const cardNo = safeString(cardLike?.card_no ?? cardLike?.cardNo ?? cardLike?.cardNumber ?? cardLike?.collectorNumber, '').trim();
        if (cardNo) return cardNo;
        const number = safeString(cardLike?.number ?? cardLike?.card_number, '').trim();
        if (number) return number;
        return extractCardNumberFromId(cardLike?.id);
    }

    function getPrintedTotal(cardLike) {
        const raw = cardLike?.expansion?.printed_total
            ?? cardLike?.expansion?.printedTotal
            ?? cardLike?.set?.printed_total
            ?? cardLike?.set?.printedTotal
            ?? cardLike?.printed_total
            ?? cardLike?.printedTotal
            ?? cardLike?.expansion?.total
            ?? cardLike?.set?.total;

        const n = Math.floor(Number(raw));
        if (!Number.isFinite(n) || n <= 0) return 0;
        return n;
    }

    function formatPrintedCardNumber(cardLike) {
        const base = getCardDisplayNumber(cardLike);
        if (!base) return '';
        if (base.includes('/')) return base;

        const printedTotal = getPrintedTotal(cardLike);
        if (!printedTotal) return base;

        const denominator = String(printedTotal).padStart(3, '0');
        return `${base}/${denominator}`;
    }

    function slugifyForUrl(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .replace(/-{2,}/g, '-');
    }

    function buildCardDetailPath(cardLike) {
        const id = safeString(cardLike?.id, '');
        if (!id) return 'card.html';
        const name = safeString(cardLike?.name, 'card');
        const slug = slugifyForUrl(`${id}-${name}`);
        return `card.html?id=${encodeURIComponent(id)}&slug=${encodeURIComponent(slug)}`;
    }

    function normalizeCollectionEntry(raw) {
        const itemType = normalizeCollectionItemType(raw?.itemType);
        const conditionQuantities = normalizeConditionQuantities(raw?.conditionQuantities, raw?.selectedCondition);
        const sealedQuantity = Math.max(1, Math.floor(Number(raw?.quantity ?? raw?.sealedQuantity ?? 1) || 1));
        const cardCopies = getTotalCopies(conditionQuantities, raw?.selectedCondition);
        const copies = itemType === 'sealed' ? sealedQuantity : cardCopies;
        return {
            itemType,
            id: safeString(raw?.id, ''),
            name: safeString(raw?.name, 'Unknown'),
            rarity: safeString(raw?.rarity, ''),
            type: safeString(raw?.type, ''),
            setName: getCardSetName(raw),
            number: formatPrintedCardNumber(raw),
            image: pickFrontMediumImage(raw?.images),
            conditionQuantities,
            selectedCondition: normalizeDexConditionCode(raw?.selectedCondition),
            quantity: sealedQuantity,
            copies,
            raw,
        };
    }

    function normalizeCollectionList(raw) {
        if (!Array.isArray(raw)) return [];
        return raw
            .filter((item) => item && typeof item === 'object' && item.id)
            .map((item) => normalizeCollectionEntry(item));
    }

    function readShareTokenFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const token = String(params.get('share') || '').trim();
        return SHARE_TOKEN_REGEX.test(token) ? token : '';
    }

    function createCardHtml(item) {
        const name = escapeHtml(item.name);
        const setName = escapeHtml(item.setName);
        const rarity = escapeHtml(item.rarity || 'n/a');
        const number = escapeHtml(item.number || 'n/a');
        const copies = Math.max(0, Math.floor(Number(item.copies || 0)));
        const detailPath = buildCardDetailPath(item.raw);
        const detailPathAttr = escapeHtml(detailPath);
        const conditionText = escapeHtml(formatConditionSummary(item.conditionQuantities, item.selectedCondition));
        const imageHtml = item.image
            ? `<a class="pv-card__imgLink" href="${detailPathAttr}" aria-label="View ${name} details"><img class="pv-card__img" src="${escapeHtml(item.image)}" alt="${name} card image" /></a>`
            : '';

        return `
            <div class="col-6 col-sm-6 col-md-4 col-lg-3 pv-sharedCollectionCol" data-card-id="${escapeHtml(item.id)}" data-card-name="${name}" data-set-name="${setName}" data-card-number="${number}">
                <article class="pv-card h-100" aria-label="${name}">
                    ${imageHtml}
                    <div class="pv-card__body">
                        <h3 class="pv-card__title"><a class="pv-card__titleLink" href="${detailPathAttr}" aria-label="View ${name} details">${name}</a></h3>
                        <p class="pv-card__text">${setName}</p>
                        <p class="pv-card__text">${rarity}</p>
                        <p class="pv-card__text">Card number: ${number}</p>
                        <p class="pv-card__text">Copies: ${copies}</p>
                        <p class="pv-card__text pv-sharedConditionText">${conditionText}</p>
                    </div>
                </article>
            </div>
        `;
    }

    function createSealedHtml(item) {
        const name = escapeHtml(item.name);
        const setName = escapeHtml(item.setName);
        const type = escapeHtml(item.type || 'Sealed product');
        const quantity = Math.max(0, Math.floor(Number(item.quantity || item.copies || 0)));
        const imageHtml = item.image
            ? `<img class="pv-card__img pv-card__img--sealed" src="${escapeHtml(item.image)}" alt="${name} sealed product image" />`
            : '';

        return `
            <div class="col-6 col-sm-6 col-md-4 col-lg-3 pv-sharedCollectionCol" data-card-id="${escapeHtml(item.id)}" data-card-name="${name}" data-set-name="${setName}" data-card-number="">
                <article class="pv-card h-100" aria-label="${name}">
                    ${imageHtml}
                    <div class="pv-card__body">
                        <h3 class="pv-card__title">${name}</h3>
                        <p class="pv-card__text">${setName}</p>
                        <p class="pv-card__text">Type: ${type}</p>
                        <p class="pv-card__text">Sealed product</p>
                        <p class="pv-card__text">Quantity: ${quantity}</p>
                    </div>
                </article>
            </div>
        `;
    }

    function createCollectionItemHtml(item) {
        if (isSealedCollectionItem(item)) return createSealedHtml(item);
        return createCardHtml(item);
    }

    function applyCollectionFilter(items, queryRaw) {
        const query = String(queryRaw || '').trim().toLowerCase();
        if (!query) return items.slice();

        return items.filter((item) => {
            const haystack = [
                safeString(item.name, ''),
                safeString(item.setName, ''),
                safeString(item.type, ''),
                safeString(item.number, ''),
                safeString(item.id, ''),
            ].join(' ').toLowerCase();
            return haystack.includes(query);
        });
    }

    function loadSharedSortPreference() {
        try {
            const raw = localStorage.getItem(SHARED_SORT_PREF_KEY);
            if (!raw) return '';
            const mode = String(raw || '').trim();
            return SHARED_SORT_MODES.includes(mode) ? mode : '';
        } catch {
            return '';
        }
    }

    function saveSharedSortPreference(modeRaw) {
        const mode = SHARED_SORT_MODES.includes(modeRaw) ? modeRaw : 'value-desc';
        try {
            localStorage.setItem(SHARED_SORT_PREF_KEY, mode);
        } catch {
            // ignore
        }
    }

    function sortCollectionItems(items, modeRaw) {
        const mode = SHARED_SORT_MODES.includes(modeRaw) ? modeRaw : 'value-desc';
        const sorted = items.slice();

        sorted.sort((a, b) => {
            const nameA = safeString(a?.name, '').toLowerCase();
            const nameB = safeString(b?.name, '').toLowerCase();

            if (mode === 'name-asc' || mode === 'name-desc') {
                const dir = mode === 'name-asc' ? 1 : -1;
                return nameA.localeCompare(nameB) * dir;
            }

            const copiesA = Number(a?.copies);
            const copiesB = Number(b?.copies);
            const hasA = Number.isFinite(copiesA);
            const hasB = Number.isFinite(copiesB);

            if (!hasA && !hasB) return nameA.localeCompare(nameB);
            if (!hasA) return 1;
            if (!hasB) return -1;

            if (copiesA === copiesB) return nameA.localeCompare(nameB);

            const dir = mode === 'value-asc' ? 1 : -1;
            return (copiesA - copiesB) * dir;
        });

        return sorted;
    }

    function setText(el, value) {
        if (el) el.textContent = String(value || '');
    }

    document.addEventListener('DOMContentLoaded', async () => {
        const statusEl = document.getElementById('pv-shared-status');
        const totalEl = document.getElementById('pv-shared-total');
        const summaryEl = document.getElementById('pv-shared-summary');
        const gridEl = document.getElementById('pv-shared-grid');
        const filterEl = document.getElementById('pv-shared-filter');
        const sortEl = document.getElementById('pv-shared-sort-select');

        if (!summaryEl || !gridEl || !totalEl) return;

        const shareToken = readShareTokenFromUrl();
        if (!shareToken) {
            setText(statusEl, 'Invalid share link.');
            setText(summaryEl, 'This collection is not currently shared.');
            gridEl.innerHTML = '<div class="col-12"><div class="pv-emptyState">This collection is not currently shared.</div></div>';
            setText(totalEl, 'Total copies: 0');
            return;
        }

        if (!window?.PV_AUTH?.loadSharedDexCollection) {
            setText(statusEl, 'Sharing service unavailable right now.');
            setText(summaryEl, 'Shared collection data could not be loaded.');
            gridEl.innerHTML = '<div class="col-12"><div class="pv-emptyState">Shared collection data could not be loaded right now.</div></div>';
            setText(totalEl, 'Total copies: 0');
            return;
        }

        setText(statusEl, 'Loading shared collection...');

        let allItems = [];

        function render(query) {
            const filtered = applyCollectionFilter(allItems, query);
            const sortMode = sortEl instanceof HTMLSelectElement ? sortEl.value : 'value-desc';
            const sortedFiltered = sortCollectionItems(filtered, sortMode);
            const totalCopies = allItems.reduce((sum, item) => sum + Math.max(0, Number(item.copies || 0)), 0);
            const filteredCopies = sortedFiltered.reduce((sum, item) => sum + Math.max(0, Number(item.copies || 0)), 0);
            const itemLabel = allItems.length === 1 ? 'item' : 'items';
            const copyLabel = totalCopies === 1 ? 'copy' : 'copies';

            setText(totalEl, `Total copies: ${totalCopies}`);

            if (!allItems.length) {
                setText(summaryEl, '0 items shared.');
                gridEl.innerHTML = '<div class="col-12"><div class="pv-emptyState">This shared collection is empty.</div></div>';
                return;
            }

            if (!sortedFiltered.length) {
                setText(summaryEl, `0 of ${allItems.length} ${itemLabel} shown.`);
                gridEl.innerHTML = '<div class="col-12"><div class="pv-emptyState">No items match that search.</div></div>';
                return;
            }

            if (String(query || '').trim()) {
                setText(summaryEl, `${sortedFiltered.length} of ${allItems.length} ${itemLabel} shown. ${filteredCopies} ${copyLabel} visible.`);
            } else {
                setText(summaryEl, `${allItems.length} ${itemLabel} shared. ${totalCopies} ${copyLabel}.`);
            }

            gridEl.innerHTML = sortedFiltered.map((item) => createCollectionItemHtml(item)).join('');
        }

        try {
            const result = await window.PV_AUTH.loadSharedDexCollection(shareToken);
            const rawCollection = Array.isArray(result?.collection) ? result.collection : [];
            allItems = normalizeCollectionList(rawCollection);

            if (sortEl instanceof HTMLSelectElement) {
                const savedMode = loadSharedSortPreference();
                if (savedMode) {
                    sortEl.value = savedMode;
                }

                sortEl.addEventListener('change', () => {
                    saveSharedSortPreference(sortEl.value);
                    const filterValue = filterEl instanceof HTMLInputElement ? filterEl.value : '';
                    render(filterValue);
                });
            }

            setText(statusEl, 'Read-only shared view.');
            render('');

            if (filterEl instanceof HTMLInputElement) {
                filterEl.addEventListener('input', () => {
                    render(filterEl.value);
                });
            }
        } catch (error) {
            const message = safeString(error?.message, 'This collection is not currently shared.');
            setText(statusEl, message);
            setText(summaryEl, 'This collection is not currently shared.');
            gridEl.innerHTML = '<div class="col-12"><div class="pv-emptyState">This collection is not currently shared. The owner can re-enable sharing from their account page at any time.</div></div>';
            setText(totalEl, 'Total copies: 0');
        }
    });
})();

/* Shared read-only collection page */
(function () {
    const SHARE_TOKEN_REGEX = /^[A-Za-z0-9_-]{16,128}$/;
    const SHARED_SORT_MODES = ['value-desc', 'value-asc', 'name-asc', 'name-desc'];
    const SHARED_SORT_PREF_KEY = 'pv:sharedCollectionSortMode:v1';
    const DEX_DEFAULT_COLLECTION_ID = 'default';
    const DEX_DEFAULT_COLLECTION_NAME = 'Default Collection';

    function safeString(value, fallback) {
        const text = String(value ?? '');
        return text || String(fallback || '');
    }

    function formatUsd(amount) {
        const n = Number(amount);
        if (!Number.isFinite(n)) return '$0.00';
        return `$${n.toFixed(2)}`;
    }

    function normalizeCollectionItemType(rawType) {
        const value = String(rawType || '').trim().toLowerCase();
        return value === 'sealed' ? 'sealed' : 'card';
    }

    function normalizeCollectionId(rawId, fallbackId) {
        const normalized = safeString(rawId, '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '');

        if (!normalized) return safeString(fallbackId, DEX_DEFAULT_COLLECTION_ID);
        return normalized.slice(0, 40);
    }

    function normalizeCollectionName(rawName, collectionId) {
        const name = safeString(rawName, '').replace(/\s+/g, ' ').trim();
        if (name) return name.slice(0, 50);
        if (collectionId === DEX_DEFAULT_COLLECTION_ID) return DEX_DEFAULT_COLLECTION_NAME;
        return safeString(collectionId, 'Collection').replace(/[-_]+/g, ' ').trim() || 'Collection';
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

    function getPrimaryConditionCode(conditionQuantities, fallbackCondition) {
        const fallback = normalizeDexConditionCode(fallbackCondition);
        const entries = getConditionEntries(conditionQuantities, fallback);
        if (fallback && entries.some((entry) => entry.code === fallback)) return fallback;
        return entries.length ? entries[0].code : '';
    }

    function formatConditionSummary(conditionQuantities, fallbackCondition) {
        const entries = getConditionEntries(conditionQuantities, fallbackCondition);
        if (!entries.length) return 'Condition breakdown unavailable';
        return entries.map((entry) => `${getConditionLabel(entry.code)} x${entry.qty}`).join(', ');
    }

    function normalizeVariantNameForCompare(name) {
        return String(name ?? '').trim().toLowerCase();
    }

    function findVariantByName(variants, variantName) {
        if (!Array.isArray(variants)) return null;
        const wanted = normalizeVariantNameForCompare(variantName);
        if (!wanted) return null;
        return variants.find((v) => normalizeVariantNameForCompare(v?.name) === wanted) || null;
    }

    function getMarketForCondition(prices, conditionCode) {
        if (!Array.isArray(prices)) return null;
        const wanted = normalizeDexConditionCode(conditionCode);
        if (!wanted) return null;

        let best = null;
        for (const p of prices) {
            if (!p || typeof p !== 'object') continue;
            const got = normalizeDexConditionCode(p?.condition);
            if (got !== wanted) continue;

            const marketRaw = p?.market ?? p?.marketPrice ?? p?.market_price ?? null;
            const market = typeof marketRaw === 'number' ? marketRaw : Number(marketRaw);
            if (!Number.isFinite(market) || market <= 0) continue;
            if (best == null || market > best) best = market;
        }
        return best;
    }

    function getBestVariantMarket(variants, selectedVariant, conditionCode) {
        if (!Array.isArray(variants) || !variants.length) return null;

        const chosenName = safeString(selectedVariant, '').trim();
        if (chosenName) {
            const match = findVariantByName(variants, chosenName);
            const market = getMarketForCondition(match?.prices, conditionCode);
            if (market != null) {
                return {
                    market,
                    variantUsed: safeString(match?.name, chosenName),
                };
            }
        }

        let best = null;
        for (const variant of variants) {
            const market = getMarketForCondition(variant?.prices, conditionCode);
            if (market == null) continue;
            if (!best || market > best.market) {
                best = {
                    market,
                    variantUsed: safeString(variant?.name, ''),
                };
            }
        }
        return best;
    }

    function getBestSealedMarketFromVariants(variants) {
        if (!Array.isArray(variants) || !variants.length) return null;

        const markets = [];
        for (const variant of variants) {
            const prices = Array.isArray(variant?.prices) ? variant.prices : [];
            for (const price of prices) {
                const market = Number(price?.market ?? price?.marketPrice ?? price?.market_price ?? null);
                if (Number.isFinite(market) && market > 0) {
                    markets.push(market);
                }
            }
        }

        if (!markets.length) return null;
        markets.sort((a, b) => a - b);
        return markets[0];
    }

    function getFallbackMarket(item) {
        const candidates = [
            item?.market,
            item?.marketPrice,
            item?.market_price,
            item?.price,
            item?.value,
        ];

        for (const candidate of candidates) {
            const n = Number(candidate);
            if (Number.isFinite(n) && n > 0) return n;
        }
        return null;
    }

    function getCardValueInfo(rawItem, conditionQuantities, selectedCondition) {
        const conditionEntries = getConditionEntries(conditionQuantities, selectedCondition);
        const totalCopies = conditionEntries.reduce((sum, entry) => sum + entry.qty, 0);
        const primaryCondition = getPrimaryConditionCode(conditionQuantities, selectedCondition);
        const selectedVariant = safeString(rawItem?.selectedVariant, '').trim();
        const variants = Array.isArray(rawItem?.variants) ? rawItem.variants : [];

        let totalValue = 0;
        let pricedCopies = 0;
        let unitValue = null;

        for (const entry of conditionEntries) {
            const best = getBestVariantMarket(variants, selectedVariant, entry.code);
            const market = Number(best?.market);
            if (!Number.isFinite(market) || market <= 0) continue;

            totalValue += market * entry.qty;
            pricedCopies += entry.qty;

            if (entry.code === primaryCondition) {
                unitValue = market;
            } else if (unitValue == null) {
                unitValue = market;
            }
        }

        if (unitValue == null && totalCopies > 0) {
            const fallbackMarket = getFallbackMarket(rawItem);
            if (Number.isFinite(fallbackMarket) && fallbackMarket > 0) {
                unitValue = fallbackMarket;
                totalValue = fallbackMarket * totalCopies;
                pricedCopies = totalCopies;
            }
        }

        return {
            unitValue: Number.isFinite(unitValue) && unitValue > 0 ? Number(unitValue) : null,
            totalValue: Number.isFinite(totalValue) && totalValue > 0 ? Number(totalValue) : 0,
            totalUnits: totalCopies,
            pricedUnits: pricedCopies,
        };
    }

    function getSealedValueInfo(rawItem, quantity) {
        const marketFromVariants = getBestSealedMarketFromVariants(Array.isArray(rawItem?.variants) ? rawItem.variants : []);
        const fallbackMarket = getFallbackMarket(rawItem);
        const unitValue = Number.isFinite(marketFromVariants) ? marketFromVariants : fallbackMarket;
        const hasUnitValue = Number.isFinite(unitValue) && unitValue > 0;

        return {
            unitValue: hasUnitValue ? Number(unitValue) : null,
            totalValue: hasUnitValue ? Number(unitValue) * quantity : 0,
            totalUnits: quantity,
            pricedUnits: hasUnitValue ? quantity : 0,
        };
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
        const collectionId = normalizeCollectionId(raw?.collectionId, DEX_DEFAULT_COLLECTION_ID);
        const conditionQuantities = normalizeConditionQuantities(raw?.conditionQuantities, raw?.selectedCondition);
        const sealedQuantity = Math.max(1, Math.floor(Number(raw?.quantity ?? raw?.sealedQuantity ?? 1) || 1));
        const cardCopies = getTotalCopies(conditionQuantities, raw?.selectedCondition);

        const valueInfo = itemType === 'sealed'
            ? getSealedValueInfo(raw, sealedQuantity)
            : getCardValueInfo(raw, conditionQuantities, raw?.selectedCondition);

        const copies = itemType === 'sealed' ? sealedQuantity : cardCopies;

        return {
            itemType,
            collectionId,
            id: safeString(raw?.id, ''),
            name: safeString(raw?.name, 'Unknown'),
            rarity: safeString(raw?.rarity, ''),
            type: safeString(raw?.type, ''),
            setName: getCardSetName(raw),
            number: formatPrintedCardNumber(raw),
            image: pickFrontMediumImage(raw?.images),
            conditionQuantities,
            selectedCondition: normalizeDexConditionCode(raw?.selectedCondition),
            selectedVariant: safeString(raw?.selectedVariant, ''),
            quantity: sealedQuantity,
            copies,
            unitValue: valueInfo.unitValue,
            totalValue: valueInfo.totalValue,
            totalUnits: valueInfo.totalUnits,
            pricedUnits: valueInfo.pricedUnits,
            raw,
        };
    }

    function normalizeCollectionList(raw) {
        if (!Array.isArray(raw)) return [];
        return raw
            .filter((item) => item && typeof item === 'object' && item.id)
            .map((item) => normalizeCollectionEntry(item));
    }

    function normalizeCollectionsMeta(rawCollections) {
        if (!Array.isArray(rawCollections)) return [];

        const out = [];
        const seen = new Set();
        for (const entry of rawCollections) {
            const id = normalizeCollectionId(entry?.id, '');
            if (!id || seen.has(id)) continue;
            seen.add(id);
            out.push({
                id,
                name: normalizeCollectionName(entry?.name, id),
            });
        }

        if (!seen.has(DEX_DEFAULT_COLLECTION_ID)) {
            out.unshift({ id: DEX_DEFAULT_COLLECTION_ID, name: DEX_DEFAULT_COLLECTION_NAME });
        }

        return out;
    }

    function getCollectionPrefKey(shareToken) {
        return `pv:sharedCollectionSelected:${shareToken}:v1`;
    }

    function loadSelectedCollectionPreference(shareToken) {
        try {
            return normalizeCollectionId(localStorage.getItem(getCollectionPrefKey(shareToken)), '');
        } catch {
            return '';
        }
    }

    function saveSelectedCollectionPreference(shareToken, collectionId) {
        const id = normalizeCollectionId(collectionId, DEX_DEFAULT_COLLECTION_ID);
        try {
            localStorage.setItem(getCollectionPrefKey(shareToken), id);
        } catch {
            // ignore
        }
    }

    function resolveCollectionOptions(items, rawMetaCollections) {
        const byId = new Map();

        for (const meta of normalizeCollectionsMeta(rawMetaCollections)) {
            byId.set(meta.id, meta.name);
        }

        for (const item of items) {
            const id = normalizeCollectionId(item?.collectionId, DEX_DEFAULT_COLLECTION_ID);
            if (!byId.has(id)) {
                byId.set(id, normalizeCollectionName('', id));
            }
        }

        const options = Array.from(byId.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => {
                if (a.id === DEX_DEFAULT_COLLECTION_ID) return -1;
                if (b.id === DEX_DEFAULT_COLLECTION_ID) return 1;
                return a.name.localeCompare(b.name);
            });

        return options;
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
        const unitValueText = item.unitValue != null ? formatUsd(item.unitValue) : '--';
        const totalValueText = item.totalValue > 0 ? formatUsd(item.totalValue) : '--';
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
                        <p class="pv-card__text">Value per copy: ${escapeHtml(unitValueText)}</p>
                        <p class="pv-card__text">Item total: ${escapeHtml(totalValueText)}</p>
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
        const unitValueText = item.unitValue != null ? formatUsd(item.unitValue) : '--';
        const totalValueText = item.totalValue > 0 ? formatUsd(item.totalValue) : '--';
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
                        <p class="pv-card__text">Value per product: ${escapeHtml(unitValueText)}</p>
                        <p class="pv-card__text">Item total: ${escapeHtml(totalValueText)}</p>
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

            const totalA = Number(a?.totalValue);
            const totalB = Number(b?.totalValue);
            const hasA = Number.isFinite(totalA) && totalA > 0;
            const hasB = Number.isFinite(totalB) && totalB > 0;

            if (!hasA && !hasB) return nameA.localeCompare(nameB);
            if (!hasA) return 1;
            if (!hasB) return -1;
            if (totalA === totalB) return nameA.localeCompare(nameB);

            const dir = mode === 'value-asc' ? 1 : -1;
            return (totalA - totalB) * dir;
        });

        return sorted;
    }

    function setText(el, value) {
        if (el) el.textContent = String(value || '');
    }

    document.addEventListener('DOMContentLoaded', async () => {
        const statusEl = document.getElementById('pv-shared-status');
        const totalEl = document.getElementById('pv-shared-total');
        const valueTotalEl = document.getElementById('pv-shared-value-total');
        const summaryEl = document.getElementById('pv-shared-summary');
        const gridEl = document.getElementById('pv-shared-grid');
        const filterEl = document.getElementById('pv-shared-filter');
        const sortEl = document.getElementById('pv-shared-sort-select');
        const collectionSelectEl = document.getElementById('pv-shared-collection-select');

        if (!summaryEl || !gridEl || !totalEl || !valueTotalEl) return;

        const shareToken = readShareTokenFromUrl();
        if (!shareToken) {
            setText(statusEl, 'Invalid share link.');
            setText(summaryEl, 'This collection is not currently shared.');
            gridEl.innerHTML = '<div class="col-12"><div class="pv-emptyState">This collection is not currently shared.</div></div>';
            setText(totalEl, 'Total units: 0');
            setText(valueTotalEl, 'Collection value: $0.00');
            return;
        }

        if (!window?.PV_AUTH?.loadSharedDexCollection) {
            setText(statusEl, 'Sharing service unavailable right now.');
            setText(summaryEl, 'Shared collection data could not be loaded.');
            gridEl.innerHTML = '<div class="col-12"><div class="pv-emptyState">Shared collection data could not be loaded right now.</div></div>';
            setText(totalEl, 'Total units: 0');
            setText(valueTotalEl, 'Collection value: $0.00');
            return;
        }

        setText(statusEl, 'Loading shared collection...');

        let allItems = [];
        let collectionOptions = [];
        let selectedCollectionId = DEX_DEFAULT_COLLECTION_ID;

        function getSelectedCollectionItems() {
            return allItems.filter((item) => normalizeCollectionId(item?.collectionId, DEX_DEFAULT_COLLECTION_ID) === selectedCollectionId);
        }

        function getSelectedCollectionName() {
            const match = collectionOptions.find((option) => option.id === selectedCollectionId);
            return match ? match.name : DEX_DEFAULT_COLLECTION_NAME;
        }

        function syncCollectionPicker() {
            if (!(collectionSelectEl instanceof HTMLSelectElement)) return;
            collectionSelectEl.innerHTML = collectionOptions
                .map((option) => `<option value="${escapeHtml(option.id)}">${escapeHtml(option.name)}</option>`)
                .join('');
            collectionSelectEl.value = selectedCollectionId;
        }

        function render(query) {
            const selectedItems = getSelectedCollectionItems();
            const filtered = applyCollectionFilter(selectedItems, query);
            const sortMode = sortEl instanceof HTMLSelectElement ? sortEl.value : 'value-desc';
            const sortedFiltered = sortCollectionItems(filtered, sortMode);

            const totalUnits = selectedItems.reduce((sum, item) => sum + Math.max(0, Number(item.totalUnits || item.copies || 0)), 0);
            const filteredUnits = sortedFiltered.reduce((sum, item) => sum + Math.max(0, Number(item.totalUnits || item.copies || 0)), 0);
            const totalValue = selectedItems.reduce((sum, item) => sum + Math.max(0, Number(item.totalValue || 0)), 0);
            const pricedUnits = selectedItems.reduce((sum, item) => sum + Math.max(0, Number(item.pricedUnits || 0)), 0);
            const collectionName = getSelectedCollectionName();
            const itemLabel = selectedItems.length === 1 ? 'item' : 'items';
            const unitLabel = totalUnits === 1 ? 'unit' : 'units';
            const coverage = pricedUnits < totalUnits ? ` (${pricedUnits}/${totalUnits} priced)` : '';

            setText(totalEl, `Total units: ${totalUnits}`);
            setText(valueTotalEl, `Collection value: ${formatUsd(totalValue)}${coverage}`);

            if (!selectedItems.length) {
                setText(summaryEl, `${collectionName} has no shared items.`);
                gridEl.innerHTML = '<div class="col-12"><div class="pv-emptyState">This collection is empty.</div></div>';
                return;
            }

            if (!sortedFiltered.length) {
                setText(summaryEl, `0 of ${selectedItems.length} ${itemLabel} shown from ${collectionName}.`);
                gridEl.innerHTML = '<div class="col-12"><div class="pv-emptyState">No items match that search.</div></div>';
                return;
            }

            if (String(query || '').trim()) {
                setText(summaryEl, `${sortedFiltered.length} of ${selectedItems.length} ${itemLabel} shown from ${collectionName}. ${filteredUnits} ${unitLabel} visible.`);
            } else {
                setText(summaryEl, `${selectedItems.length} ${itemLabel} shared from ${collectionName}. ${totalUnits} ${unitLabel}.`);
            }

            gridEl.innerHTML = sortedFiltered.map((item) => createCollectionItemHtml(item)).join('');
        }

        try {
            const result = await window.PV_AUTH.loadSharedDexCollection(shareToken);
            const rawCollection = Array.isArray(result?.collection) ? result.collection : [];
            const rawCollectionsMeta = Array.isArray(result?.collections) ? result.collections : [];
            const activeCollectionId = normalizeCollectionId(result?.activeCollectionId, DEX_DEFAULT_COLLECTION_ID);
            allItems = normalizeCollectionList(rawCollection);
            collectionOptions = resolveCollectionOptions(allItems, rawCollectionsMeta);

            if (!collectionOptions.length) {
                collectionOptions = [{ id: DEX_DEFAULT_COLLECTION_ID, name: DEX_DEFAULT_COLLECTION_NAME }];
            }

            const itemCollectionIds = new Set(allItems.map((item) => normalizeCollectionId(item.collectionId, DEX_DEFAULT_COLLECTION_ID)));
            const savedCollectionId = loadSelectedCollectionPreference(shareToken);
            const preferred = [activeCollectionId, savedCollectionId, DEX_DEFAULT_COLLECTION_ID]
                .map((id) => normalizeCollectionId(id, ''))
                .find((id) => id && collectionOptions.some((option) => option.id === id));

            if (preferred && (itemCollectionIds.has(preferred) || !itemCollectionIds.size)) {
                selectedCollectionId = preferred;
            } else if (itemCollectionIds.size) {
                selectedCollectionId = Array.from(itemCollectionIds)[0];
            } else {
                selectedCollectionId = collectionOptions[0].id;
            }

            syncCollectionPicker();
            saveSelectedCollectionPreference(shareToken, selectedCollectionId);

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

            if (collectionSelectEl instanceof HTMLSelectElement) {
                collectionSelectEl.addEventListener('change', () => {
                    const nextId = normalizeCollectionId(collectionSelectEl.value, selectedCollectionId);
                    if (collectionOptions.some((option) => option.id === nextId)) {
                        selectedCollectionId = nextId;
                        saveSelectedCollectionPreference(shareToken, selectedCollectionId);
                    }
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
            setText(totalEl, 'Total units: 0');
            setText(valueTotalEl, 'Collection value: $0.00');
        }
    });
})();

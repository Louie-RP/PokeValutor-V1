/* Shared read-only collection page */
(function () {
    const SHARE_TOKEN_REGEX = /^[A-Za-z0-9_-]{16,128}$/;
    const SHARED_SORT_MODES = ['value-desc', 'value-asc', 'name-asc', 'name-desc'];
    const SHARED_SORT_PREF_KEY = 'pv:sharedCollectionSortMode:v1';
    const SHARED_TYPE_FILTER_PREF_KEY = 'pv:sharedCollectionTypeFilter:v1';
    const SHARED_VALUE_CACHE_KEY = 'pv:scrydex:collectionValueCache:v3';
    const SHARED_VALUE_CACHE_TTL_MS = 8 * 60 * 60 * 1000;
    const SHARED_SEALED_VALUE_CACHE_TTL_MS = 8 * 60 * 60 * 1000;
    const DEX_DEFAULT_COLLECTION_ID = 'default';
    const DEX_DEFAULT_COLLECTION_NAME = 'Default Collection';
    const CONDITION_CODE_ORDER = ['NM', 'LP', 'MP', 'HP', 'DM'];
    const COLLECTION_PAGE_BREAKPOINT_QUERY = '(max-width: 767.98px)';
    const collectionView = window.PV_COLLECTION_VIEW;
    const sealedPricing = window.PV_SEALED_PRICING;
    const sealedPriceRequestInFlightByBaseId = {};

    function safeString(value, fallback) {
        const text = String(value ?? '');
        return text || String(fallback || '');
    }

    function formatUsd(amount) {
        return collectionView.formatUsd(amount);
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

    function createElement(tagName, className, text) {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = String(text);
        return element;
    }

    function setEmptyState(container, message) {
        const column = createElement('div', 'col-12');
        column.appendChild(createElement('div', 'pv-emptyState', message));
        container.replaceChildren(column);
    }

    function getSafeImageUrl(rawUrl) {
        const value = safeString(rawUrl, '').trim();
        if (!value) return '';

        try {
            const url = new URL(value, window.location.href);
            return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
        } catch {
            return '';
        }
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

    function sortConditionEntries(entries) {
        return entries.slice().sort((a, b) => {
            const ai = CONDITION_CODE_ORDER.indexOf(a.code);
            const bi = CONDITION_CODE_ORDER.indexOf(b.code);
            const aRank = ai >= 0 ? ai : CONDITION_CODE_ORDER.length;
            const bRank = bi >= 0 ? bi : CONDITION_CODE_ORDER.length;
            if (aRank !== bRank) return aRank - bRank;
            return a.code.localeCompare(b.code);
        });
    }

    function getConditionValueBreakdown(item) {
        const source = item?.raw || item || {};
        const entries = sortConditionEntries(getConditionEntries(item?.conditionQuantities, item?.selectedCondition));
        const selectedVariant = safeString(source?.selectedVariant ?? item?.selectedVariant, '').trim();
        const variants = Array.isArray(source?.variants) ? source.variants : [];
        const fallbackMarket = getFallbackMarket(source);

        let pricedUnits = 0;
        let computedTotal = 0;

        const lines = entries.map((entry) => {
            const best = getBestVariantMarket(variants, selectedVariant, entry.code);
            const bestMarket = Number(best?.market);
            const unitValue = Number.isFinite(bestMarket) && bestMarket > 0
                ? bestMarket
                : (Number.isFinite(fallbackMarket) && fallbackMarket > 0 ? fallbackMarket : null);
            const totalValue = unitValue != null ? unitValue * entry.qty : null;
            const variantUsed = safeString(best?.variantUsed, '').trim();

            if (totalValue != null) {
                pricedUnits += entry.qty;
                computedTotal += totalValue;
            }

            return {
                code: entry.code,
                qty: entry.qty,
                unitValue,
                totalValue,
                variantUsed,
            };
        });

        const totalUnits = entries.reduce((sum, entry) => sum + entry.qty, 0);
        const itemTotalRaw = Number(item?.totalValue);
        const itemTotal = Number.isFinite(itemTotalRaw) && itemTotalRaw > 0 ? itemTotalRaw : null;
        const grandTotal = computedTotal > 0 ? computedTotal : itemTotal;
        const fallbackPricedUnits = Math.max(0, Math.floor(Number(item?.pricedUnits || 0)));
        const finalPricedUnits = pricedUnits > 0 ? pricedUnits : fallbackPricedUnits;

        return {
            lines,
            totalUnits,
            pricedUnits: Math.min(finalPricedUnits, totalUnits || finalPricedUnits),
            grandTotal,
        };
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
        return sealedPricing.getMarketFromTrackedSealedVariant(variants, {});
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
        const identity = sealedPricing.getSealedPricingIdentity(rawItem);
        const marketFromVariants = sealedPricing.getMarketFromTrackedSealedVariant(
            Array.isArray(rawItem?.variants) ? rawItem.variants : [],
            identity,
        );
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
            baseProductId: safeString(raw?.baseProductId, ''),
            variantName: safeString(raw?.variantName, ''),
            variantLabel: safeString(raw?.variantLabel, ''),
            hasMultipleVariants: raw?.hasMultipleVariants === true,
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

    function createCardElement(item, itemKey) {
        const name = safeString(item.name, 'Unknown');
        const setName = safeString(item.setName, 'n/a');
        const rarity = safeString(item.rarity, 'n/a');
        const number = safeString(item.number, '').trim();
        const copies = Math.max(0, Math.floor(Number(item.copies || 0)));
        const detailPath = buildCardDetailPath(item.raw);
        const unitValue = getSortUnitValue(item);
        const highestConditionValueText = unitValue != null
            ? formatUsd(unitValue)
            : '--';
        const conditionBreakdown = getConditionValueBreakdown(item);
        const preferredLine = conditionBreakdown.lines.find((line) => line.unitValue != null)
            || conditionBreakdown.lines[0]
            || null;
        const displayConditionCode = normalizeDexConditionCode(item?.displayConditionCode || item?.selectedCondition || preferredLine?.code);
        const displayConditionLabel = displayConditionCode ? getConditionLabel(displayConditionCode) : '';
        const displayVariant = safeString(item?.displayVariantUsed || preferredLine?.variantUsed, '').trim();
        const fallbackCode = safeString(preferredLine?.code, '').trim();

        let valueHint = 'Current unit value shown.';
        if (displayConditionLabel && displayVariant) {
            valueHint = `Value shown for ${displayConditionLabel} using ${displayVariant}.`;
        } else if (displayConditionLabel) {
            valueHint = `Value shown for ${displayConditionLabel}.`;
        } else if (displayVariant) {
            valueHint = `Value shown using ${displayVariant}.`;
        } else if (fallbackCode) {
            valueHint = `Highest-condition value shown (${fallbackCode}).`;
        }
        const copiesText = `${copies} ${copies === 1 ? 'copy' : 'copies'}`;

        const column = createElement('div', 'col-6 col-sm-6 col-md-4 col-lg-3 pv-sharedCollectionCol');
        column.dataset.cardId = safeString(item.id, '');
        column.dataset.cardName = name;
        column.dataset.setName = setName;
        column.dataset.cardNumber = number;

        const article = createElement('article', 'pv-card h-100');
        article.setAttribute('aria-label', name);
        const imageUrl = getSafeImageUrl(item.image);
        if (imageUrl) {
            const imageLink = createElement('a', 'pv-card__imgLink');
            imageLink.href = detailPath;
            imageLink.setAttribute('aria-label', `View ${name} details`);
            const image = createElement('img', 'pv-card__img');
            image.src = imageUrl;
            image.alt = `${name} card image`;
            imageLink.appendChild(image);
            article.appendChild(imageLink);
        }

        const body = createElement('div', 'pv-card__body');
        const title = createElement('h3', 'pv-card__title');
        const titleLink = createElement('a', 'pv-card__titleLink', name);
        titleLink.href = detailPath;
        titleLink.setAttribute('aria-label', `View ${name} details`);
        title.appendChild(titleLink);
        body.append(title, createElement('p', 'pv-card__text pv-sharedSetName', setName));

        const meta = createElement('p', 'pv-card__text pv-sharedMetaLine');
        meta.appendChild(createElement('span', 'pv-sharedRarity', rarity));
        if (number) {
            const divider = createElement('span', 'pv-sharedMetaDivider', '\u2022');
            divider.setAttribute('aria-hidden', 'true');
            meta.append(divider, createElement('span', 'pv-sharedCardNo', `#${number}`));
        }
        body.appendChild(meta);

        const valueLine = createElement('p', 'pv-card__text pv-sharedInfoLine');
        const valueWrap = createElement('span', 'pv-sharedInfoValueWrap');
        const valueHintButton = createElement('button', 'pv-sharedValueHintBtn', 'i');
        valueHintButton.type = 'button';
        valueHintButton.dataset.sharedValueHint = valueHint;
        valueHintButton.setAttribute('aria-label', valueHint);
        valueHintButton.title = valueHint;
        valueWrap.append(createElement('span', 'pv-sharedInfoValue pv-sharedInfoValue--price', highestConditionValueText), valueHintButton);
        valueLine.append(createElement('span', 'pv-sharedInfoLabel', 'Value'), valueWrap);

        const copiesLine = createElement('p', 'pv-card__text pv-sharedInfoLine');
        const copiesValue = createElement('span', 'pv-sharedInfoValue');
        const copiesButton = createElement('button', 'pv-sharedCopiesBtn', copiesText);
        copiesButton.type = 'button';
        copiesButton.dataset.sharedItemKey = itemKey;
        copiesButton.setAttribute('aria-label', `View condition breakdown for ${name}`);
        copiesValue.appendChild(copiesButton);
        copiesLine.append(createElement('span', 'pv-sharedInfoLabel', 'Copies'), copiesValue);
        body.append(valueLine, copiesLine);
        article.appendChild(body);
        column.appendChild(article);
        return column;
    }

    function createConditionDialog() {
        const dialog = document.createElement('dialog');
        dialog.className = 'pv-sharedConditionDialog';
        const panel = createElement('div', 'pv-sharedConditionDialog__panel');
        const titleEl = createElement('h3', 'pv-sharedConditionDialog__title', 'Conditions');
        titleEl.id = 'pv-shared-condition-title';
        const listEl = createElement('ul', 'pv-sharedConditionDialog__list');
        listEl.id = 'pv-shared-condition-list';
        const totalEl = createElement('p', 'pv-sharedConditionDialog__total');
        totalEl.id = 'pv-shared-condition-total';
        const actions = createElement('div', 'pv-sharedConditionDialog__actions');
        const closeBtn = createElement('button', 'pv-button pv-button--secondary btn', 'Close');
        closeBtn.type = 'button';
        closeBtn.dataset.sharedConditionClose = '';
        actions.appendChild(closeBtn);
        panel.append(titleEl, listEl, totalEl, actions);
        dialog.appendChild(panel);

        if (closeBtn instanceof HTMLButtonElement) {
            closeBtn.addEventListener('click', () => {
                if (typeof dialog.close === 'function') dialog.close();
            });
        }

        dialog.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement) || target !== dialog) return;
            if (typeof dialog.close === 'function') dialog.close();
        });

        document.body.appendChild(dialog);

        return {
            open(item) {
                const cleanName = safeString(item?.name, 'Card').trim() || 'Card';
                const breakdown = getConditionValueBreakdown(item);
                const coverage = breakdown.totalUnits > 0 && breakdown.pricedUnits < breakdown.totalUnits
                    ? ` (${breakdown.pricedUnits}/${breakdown.totalUnits} priced)`
                    : '';
                const totalText = breakdown.grandTotal != null ? formatUsd(breakdown.grandTotal) : '--';

                if (titleEl) titleEl.textContent = `${cleanName} conditions`;

                if (listEl instanceof HTMLUListElement) {
                    listEl.replaceChildren();

                    if (!breakdown.lines.length) {
                        const emptyEl = document.createElement('li');
                        emptyEl.className = 'pv-sharedConditionDialog__item pv-sharedConditionDialog__item--empty';
                        emptyEl.textContent = 'No conditions recorded';
                        listEl.appendChild(emptyEl);
                    } else {
                        for (const line of breakdown.lines) {
                            const itemEl = document.createElement('li');
                            itemEl.className = 'pv-sharedConditionDialog__item';

                            const labelEl = document.createElement('span');
                            labelEl.className = 'pv-sharedConditionDialog__itemLabel';
                            labelEl.textContent = `${line.qty} x ${line.code}`;

                            const valueEl = document.createElement('span');
                            valueEl.className = 'pv-sharedConditionDialog__itemValue';
                            if (line.unitValue != null && line.totalValue != null) {
                                valueEl.textContent = `${formatUsd(line.unitValue)} each | ${formatUsd(line.totalValue)}`;
                            } else {
                                valueEl.textContent = '-- each | --';
                            }

                            itemEl.appendChild(labelEl);
                            itemEl.appendChild(valueEl);
                            listEl.appendChild(itemEl);
                        }
                    }
                }

                if (totalEl) {
                    totalEl.textContent = `Total value: ${totalText}${coverage}`;
                }

                if (typeof dialog.showModal === 'function') {
                    dialog.showModal();
                    return;
                }

                const fallbackLine = breakdown.lines.length
                    ? breakdown.lines
                        .map((line) => {
                            const unitText = line.unitValue != null ? formatUsd(line.unitValue) : '--';
                            const lineTotalText = line.totalValue != null ? formatUsd(line.totalValue) : '--';
                            return `${line.qty} x ${line.code}: ${unitText} each = ${lineTotalText}`;
                        })
                        .join(', ')
                    : 'No conditions recorded';
                window.alert(`${cleanName} conditions: ${fallbackLine}. Total value: ${totalText}${coverage}`);
            },
        };
    }

    function createSealedElement(item, itemKey) {
        const name = safeString(item.name, 'Unknown');
        const setName = safeString(item.setName, 'n/a');
        const quantity = Math.max(0, Math.floor(Number(item.quantity || item.copies || 0)));
        const unitValueText = item.unitValue != null ? formatUsd(item.unitValue) : '--';
        const valueHint = 'Per sealed product value shown.';
        const quantityText = `${quantity} ${quantity === 1 ? 'unit' : 'units'}`;

        const column = createElement('div', 'col-6 col-sm-6 col-md-4 col-lg-3 pv-sharedCollectionCol');
        column.dataset.cardId = safeString(item.id, '');
        column.dataset.cardName = name;
        column.dataset.setName = setName;
        column.dataset.cardNumber = '';

        const article = createElement('article', 'pv-card h-100');
        article.setAttribute('aria-label', name);
        const imageLink = createElement('div', 'pv-card__imgLink pv-card__imgLink--sealed');
        imageLink.setAttribute('aria-hidden', 'true');
        const imageUrl = getSafeImageUrl(item.image);
        if (imageUrl) {
            const image = createElement('img', 'pv-card__img pv-card__img--sealed');
            image.src = imageUrl;
            image.alt = `${name} sealed product image`;
            imageLink.appendChild(image);
        }

        const body = createElement('div', 'pv-card__body');
        body.append(
            createElement('h3', 'pv-card__title pv-card__title--plain', name),
            createElement('p', 'pv-card__text pv-sharedSetName', setName)
        );
        const meta = createElement('p', 'pv-card__text pv-sharedMetaLine pv-sharedMetaLine--empty', 'Sealed product');
        meta.setAttribute('aria-hidden', 'true');
        body.appendChild(meta);

        const valueLine = createElement('p', 'pv-card__text pv-sharedInfoLine');
        const valueWrap = createElement('span', 'pv-sharedInfoValueWrap');
        const valueHintButton = createElement('button', 'pv-sharedValueHintBtn', 'i');
        valueHintButton.type = 'button';
        valueHintButton.dataset.sharedValueHint = valueHint;
        valueHintButton.setAttribute('aria-label', valueHint);
        valueHintButton.title = valueHint;
        valueWrap.append(createElement('span', 'pv-sharedInfoValue pv-sharedInfoValue--price', unitValueText), valueHintButton);
        valueLine.append(createElement('span', 'pv-sharedInfoLabel', 'Value'), valueWrap);

        const quantityLine = createElement('p', 'pv-card__text pv-sharedInfoLine');
        const quantityValue = createElement('span', 'pv-sharedInfoValue');
        const quantityButton = createElement('button', 'pv-sharedQtyBtn', quantityText);
        quantityButton.type = 'button';
        quantityButton.dataset.sharedItemKey = itemKey;
        quantityButton.setAttribute('aria-label', `View sealed details for ${name}`);
        quantityValue.appendChild(quantityButton);
        quantityLine.append(createElement('span', 'pv-sharedInfoLabel', 'Quantity'), quantityValue);
        body.append(valueLine, quantityLine);
        article.append(imageLink, body);
        column.appendChild(article);
        return column;
    }

    function createSealedDetailsDialog() {
        const dialog = document.createElement('dialog');
        dialog.className = 'pv-sharedConditionDialog pv-sharedConditionDialog--sealed';
        const panel = createElement('div', 'pv-sharedConditionDialog__panel');
        const titleEl = createElement('h3', 'pv-sharedConditionDialog__title', 'Sealed details');
        titleEl.id = 'pv-shared-sealed-title';
        const listEl = createElement('ul', 'pv-sharedConditionDialog__list');
        listEl.id = 'pv-shared-sealed-list';
        const actions = createElement('div', 'pv-sharedConditionDialog__actions');
        const closeBtn = createElement('button', 'pv-button pv-button--secondary btn', 'Close');
        closeBtn.type = 'button';
        closeBtn.dataset.sharedSealedClose = '';
        actions.appendChild(closeBtn);
        panel.append(titleEl, listEl, actions);
        dialog.appendChild(panel);

        if (closeBtn instanceof HTMLButtonElement) {
            closeBtn.addEventListener('click', () => {
                if (typeof dialog.close === 'function') dialog.close();
            });
        }

        dialog.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement) || target !== dialog) return;
            if (typeof dialog.close === 'function') dialog.close();
        });

        document.body.appendChild(dialog);

        function appendRow(list, label, value) {
            const rowEl = document.createElement('li');
            rowEl.className = 'pv-sharedConditionDialog__item';

            const labelEl = document.createElement('span');
            labelEl.className = 'pv-sharedConditionDialog__itemLabel';
            labelEl.textContent = label;

            const valueEl = document.createElement('span');
            valueEl.className = 'pv-sharedConditionDialog__itemValue';
            valueEl.textContent = value;

            rowEl.appendChild(labelEl);
            rowEl.appendChild(valueEl);
            list.appendChild(rowEl);
        }

        return {
            open(item) {
                const cleanName = safeString(item?.name, 'Sealed product').trim() || 'Sealed product';
                const quantity = Math.max(0, Math.floor(Number(item?.quantity || item?.copies || 0)));
                const unitValueText = item?.unitValue != null ? formatUsd(item.unitValue) : '--';
                const totalValueText = Number(item?.totalValue) > 0 ? formatUsd(item.totalValue) : '--';

                if (titleEl) titleEl.textContent = `${cleanName} details`;

                if (listEl instanceof HTMLUListElement) {
                    listEl.replaceChildren();
                    appendRow(listEl, 'Quantity', String(quantity));
                    appendRow(listEl, 'Value each', unitValueText);
                    appendRow(listEl, 'Total value', totalValueText);
                }

                if (typeof dialog.showModal === 'function') {
                    dialog.showModal();
                    return;
                }

                window.alert(`${cleanName} details: Quantity ${quantity}, Value each ${unitValueText}, Total value ${totalValueText}.`);
            },
        };
    }

    function createCollectionItemElement(item, itemKey) {
        if (isSealedCollectionItem(item)) return createSealedElement(item, itemKey);
        return createCardElement(item, itemKey);
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

    function loadSharedTypeFilterPreference() {
        try {
            return collectionView.normalizeTypeFilter(localStorage.getItem(SHARED_TYPE_FILTER_PREF_KEY));
        } catch {
            return 'all';
        }
    }

    function saveSharedTypeFilterPreference(value) {
        try {
            localStorage.setItem(SHARED_TYPE_FILTER_PREF_KEY, collectionView.normalizeTypeFilter(value));
        } catch {
            // ignore
        }
    }

    function getSortUnitValue(item) {
        const direct = Number(item?.unitValue);
        if (Number.isFinite(direct) && direct > 0) return direct;
        if (isSealedCollectionItem(item)) return null;

        const conditionBreakdown = getConditionValueBreakdown(item);
        const firstPriced = conditionBreakdown.lines.find((line) => line.unitValue != null) || null;
        const fallback = Number(firstPriced?.unitValue);
        if (!Number.isFinite(fallback) || fallback <= 0) return null;
        return fallback;
    }

    function getWorkerBase() {
        const defaultWorker = 'https://pokevalutor-v1.lreyperez18.workers.dev';
        return (window?.PV_SECRETS?.PV_API_URL || defaultWorker).replace(/\/$/, '');
    }

    function readValueCache() {
        try {
            const raw = localStorage.getItem(SHARED_VALUE_CACHE_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    function writeValueCache(next) {
        try {
            const safe = next && typeof next === 'object' ? next : {};
            localStorage.setItem(SHARED_VALUE_CACHE_KEY, JSON.stringify(safe));
        } catch {
            // ignore
        }
    }

    function getCachedValue(cacheKey) {
        const map = readValueCache();
        const hit = map?.[cacheKey];
        if (!hit || typeof hit !== 'object') return null;

        const savedAt = Number(hit?.savedAt || 0);
        const market = Number(hit?.market);
        if (!Number.isFinite(savedAt) || !Number.isFinite(market) || market <= 0) return null;
        const ttlMs = String(cacheKey || '').startsWith('sealed:')
            ? SHARED_SEALED_VALUE_CACHE_TTL_MS
            : SHARED_VALUE_CACHE_TTL_MS;
        if ((Date.now() - savedAt) > ttlMs) return null;

        return {
            market,
            variantUsed: safeString(hit?.variantUsed, ''),
        };
    }

    function setCachedValue(cacheKey, market, variantUsed) {
        const map = readValueCache();
        map[cacheKey] = {
            market: Number(market),
            variantUsed: safeString(variantUsed, ''),
            savedAt: Date.now(),
        };
        writeValueCache(map);
    }

    async function fetchJsonWithOptionalAuth(url) {
        try {
            let headers;
            try {
                const tokenRaw = window?.PV_AUTH?.getIdToken ? await window.PV_AUTH.getIdToken(false) : null;
                const token = safeString(tokenRaw, '').trim();
                if (token) headers = { Authorization: `Bearer ${token}` };
            } catch {
                // ignore
            }

            const requestInit = headers ? { headers, cache: 'no-store' } : { cache: 'no-store' };
            const res = await fetch(url, requestInit);
            if (!res.ok) return null;

            const parsed = await res.json().catch(() => null);
            if (!parsed || typeof parsed !== 'object') return null;
            return parsed?.data || parsed;
        } catch {
            return null;
        }
    }

    async function fetchCardWithPrices(cardId) {
        const id = safeString(cardId, '').trim();
        if (!id) return null;
        const url = `${getWorkerBase()}/cards/${encodeURIComponent(id)}?includePrices=1&lang=en`;
        return fetchJsonWithOptionalAuth(url);
    }

    async function fetchSealedWithPrices(sealedId) {
        const id = safeString(sealedId, '').trim();
        if (!id) return null;
        const url = `${getWorkerBase()}/sealed/${encodeURIComponent(id)}?includePrices=1`;
        return fetchJsonWithOptionalAuth(url);
    }

    async function fetchSealedFromSearchById(sealedId) {
        const id = safeString(sealedId, '').trim();
        if (!id) return null;

        const query = `id:${id}`;
        const url = `${getWorkerBase()}/sealed/search?q=${encodeURIComponent(query)}&page=1&pageSize=10`;
        const payload = await fetchJsonWithOptionalAuth(url);
        const rows = Array.isArray(payload)
            ? payload
            : (Array.isArray(payload?.data) ? payload.data : []);
        return rows.find((row) => safeString(row?.id, '').trim() === id) || null;
    }

    function getInFlightRequest(map, key, factory) {
        const existing = map[key];
        if (existing) return existing;

        const request = Promise.resolve()
            .then(factory)
            .finally(() => {
                delete map[key];
            });
        map[key] = request;
        return request;
    }

    async function fetchCurrentSealedProduct(baseProductId) {
        const id = safeString(baseProductId, '').trim();
        if (!id) return null;

        return getInFlightRequest(sealedPriceRequestInFlightByBaseId, id, async () => {
            const fetchedFromSearch = await fetchSealedFromSearchById(id);
            return fetchedFromSearch || fetchSealedWithPrices(id);
        });
    }

    async function getCurrentCardValue(item, variantsOverride) {
        const id = safeString(item?.id, '').trim();
        const conditionCode = normalizeDexConditionCode(item?.selectedCondition);
        if (!id || !conditionCode) return null;

        const selectedVariant = safeString(item?.selectedVariant, '').trim();
        const cacheKey = `${id}|${selectedVariant}|${conditionCode}`;
        const cached = getCachedValue(cacheKey);
        if (cached && Number.isFinite(cached.market)) {
            return cached;
        }

        let sourceVariants = Array.isArray(variantsOverride) ? variantsOverride : [];
        if (!sourceVariants.length) {
            const fetched = await fetchCardWithPrices(id);
            const fetchedVariants = Array.isArray(fetched?.variants) ? fetched.variants : [];
            const fallbackVariants = Array.isArray(item?.raw?.variants)
                ? item.raw.variants
                : (Array.isArray(item?.variants) ? item.variants : []);
            sourceVariants = fetchedVariants.length ? fetchedVariants : fallbackVariants;

            if (fetchedVariants.length && item?.raw && typeof item.raw === 'object') {
                item.raw.variants = fetchedVariants;
            }
        }

        const best = getBestVariantMarket(sourceVariants, selectedVariant, conditionCode);
        if (!best || !Number.isFinite(best.market) || best.market <= 0) return null;

        setCachedValue(cacheKey, best.market, best.variantUsed);
        return best;
    }

    async function getCurrentSealedValue(item) {
        const identity = sealedPricing.getSealedPricingIdentity(item);
        const { baseProductId } = identity;
        if (!identity.displayId || !baseProductId) return null;

        const cacheKey = sealedPricing.buildSealedValueCacheKey(identity);
        const cached = getCachedValue(cacheKey);
        const fallbackVariants = Array.isArray(item?.raw?.variants)
            ? item.raw.variants
            : (Array.isArray(item?.variants) ? item.variants : []);
        const fallbackMarket = sealedPricing.getMarketFromTrackedSealedVariant(fallbackVariants, identity);

        const fetched = await fetchCurrentSealedProduct(baseProductId);
        if (fetched) {
            const fetchedVariants = Array.isArray(fetched?.variants) ? fetched.variants : [];
            const market = sealedPricing.getMarketFromTrackedSealedVariant(fetchedVariants, identity);
            if (Number.isFinite(market) && market > 0) {
                if (item?.raw && typeof item.raw === 'object') item.raw.variants = fetchedVariants;
                setCachedValue(cacheKey, market, identity.variantName);
                return { market };
            }
            return null;
        }

        if (cached && Number.isFinite(cached.market)) return { market: cached.market };
        if (Number.isFinite(fallbackMarket) && fallbackMarket > 0) return { market: fallbackMarket };
        return null;
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

            const unitA = getSortUnitValue(a);
            const unitB = getSortUnitValue(b);
            const hasA = Number.isFinite(unitA) && unitA > 0;
            const hasB = Number.isFinite(unitB) && unitB > 0;

            if (!hasA && !hasB) return nameA.localeCompare(nameB);
            if (!hasA) return 1;
            if (!hasB) return -1;
            if (unitA === unitB) return nameA.localeCompare(nameB);

            const dir = mode === 'value-asc' ? 1 : -1;
            return (unitA - unitB) * dir;
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
        const typeFilterEl = document.getElementById('pv-shared-type-filter');
        const sortEl = document.getElementById('pv-shared-sort-select');
        const collectionSelectEl = document.getElementById('pv-shared-collection-select');
        const paginationEl = document.getElementById('pv-shared-pagination');

        if (!summaryEl || !gridEl || !totalEl || !valueTotalEl) return;

        const conditionDialog = createConditionDialog();
        const sealedDetailsDialog = createSealedDetailsDialog();
        const renderedItemByKey = new Map();
        let renderAnimationTimer = null;
        let liveRefreshRunId = 0;
        const paginationState = {
            page: 1,
            perPage: 0,
            signature: '',
        };

        function closeOpenValueHints(exceptEl) {
            const openHints = gridEl.querySelectorAll('.pv-sharedValueHintBtn.is-open');
            for (const node of openHints) {
                if (!(node instanceof HTMLButtonElement)) continue;
                if (exceptEl && node === exceptEl) continue;
                node.classList.remove('is-open');
            }
        }

        gridEl.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;

            const hintTrigger = target.closest('.pv-sharedValueHintBtn');
            if (hintTrigger instanceof HTMLButtonElement) {
                event.preventDefault();
                const shouldOpen = !hintTrigger.classList.contains('is-open');
                closeOpenValueHints(hintTrigger);
                hintTrigger.classList.toggle('is-open', shouldOpen);
                return;
            }

            closeOpenValueHints();

            const quantityTrigger = target.closest('.pv-sharedQtyBtn');
            if (quantityTrigger instanceof HTMLButtonElement) {
                const itemKey = safeString(quantityTrigger.dataset.sharedItemKey, '').trim();
                if (!itemKey) return;
                const item = renderedItemByKey.get(itemKey);
                if (!item || !isSealedCollectionItem(item)) return;

                sealedDetailsDialog.open(item);
                return;
            }

            const trigger = target.closest('.pv-sharedCopiesBtn');
            if (!(trigger instanceof HTMLButtonElement)) return;

            const itemKey = safeString(trigger.dataset.sharedItemKey, '').trim();
            if (!itemKey) return;
            const item = renderedItemByKey.get(itemKey);
            if (!item || isSealedCollectionItem(item)) return;

            conditionDialog.open(item);
        });

        const shareToken = readShareTokenFromUrl();
        if (!shareToken) {
            setText(statusEl, 'Invalid share link.');
            setText(summaryEl, 'This collection is not currently shared.');
            setEmptyState(gridEl, 'This collection is not currently shared.');
            setText(totalEl, 'Total units: 0');
            setText(valueTotalEl, 'Collection value: $0.00');
            return;
        }

        if (!window?.PV_AUTH?.loadSharedDexCollection) {
            setText(statusEl, 'Sharing service unavailable right now.');
            setText(summaryEl, 'Shared collection data could not be loaded.');
            setEmptyState(gridEl, 'Shared collection data could not be loaded right now.');
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
            const optionElements = collectionOptions.map((option) => {
                const optionElement = createElement('option', '', option.name);
                optionElement.value = option.id;
                return optionElement;
            });
            collectionSelectEl.replaceChildren(...optionElements);
            collectionSelectEl.value = selectedCollectionId;
        }

        function triggerGridAnimation() {
            gridEl.classList.remove('pv-sharedGrid--animating');
            void gridEl.offsetWidth;
            gridEl.classList.add('pv-sharedGrid--animating');

            if (renderAnimationTimer != null) {
                window.clearTimeout(renderAnimationTimer);
            }

            renderAnimationTimer = window.setTimeout(() => {
                gridEl.classList.remove('pv-sharedGrid--animating');
                renderAnimationTimer = null;
            }, 320);
        }

        function render(query, options) {
            const animate = options?.animate === true;
            const selectedItems = getSelectedCollectionItems();
            const selectedType = collectionView.normalizeTypeFilter(
                typeFilterEl instanceof HTMLSelectElement ? typeFilterEl.value : 'all'
            );
            const typeFilteredItems = selectedItems.filter((item) => {
                if (selectedType === 'sealed') return isSealedCollectionItem(item);
                if (selectedType === 'card') return !isSealedCollectionItem(item);
                return true;
            });
            const filtered = applyCollectionFilter(typeFilteredItems, query);
            const sortMode = sortEl instanceof HTMLSelectElement ? sortEl.value : 'value-desc';
            const sortedFiltered = sortCollectionItems(filtered, sortMode);
            const paginationSignature = [
                selectedCollectionId,
                selectedType,
                String(query || '').trim().toLowerCase(),
            ].join('|');
            const pageSize = collectionView.getResponsivePageSize(window, {
                breakpointQuery: COLLECTION_PAGE_BREAKPOINT_QUERY,
            });

            if (paginationState.signature !== paginationSignature) {
                paginationState.signature = paginationSignature;
                paginationState.page = 1;
            }

            if (paginationState.perPage !== pageSize) {
                const previousSize = paginationState.perPage || pageSize;
                const firstVisibleIndex = Math.max(0, (paginationState.page - 1) * previousSize);
                paginationState.page = Math.floor(firstVisibleIndex / pageSize) + 1;
                paginationState.perPage = pageSize;
            }

            const pagination = collectionView.getPagination(sortedFiltered.length, pageSize, paginationState.page);
            paginationState.page = pagination.currentPage;
            const visibleItems = sortedFiltered.slice(pagination.startIndex, pagination.endIndex);

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

            collectionView.renderPagination(paginationEl, {
                totalItems: sortedFiltered.length,
                pageSize,
                currentPage: paginationState.page,
                onPageChange(page) {
                    paginationState.page = page;
                    render(query, { animate: true });
                    const target = gridEl.querySelector('.pv-sharedCollectionCol') || gridEl;
                    const top = Math.max(0, Math.round(target.getBoundingClientRect().top + window.scrollY - 96));
                    window.scrollTo({ top, behavior: 'smooth' });
                },
            });

            if (!selectedItems.length) {
                renderedItemByKey.clear();
                gridEl.classList.remove('pv-sharedGrid--animating');
                setText(summaryEl, `${collectionName} has no shared items.`);
                setEmptyState(gridEl, 'This collection is empty.');
                return;
            }

            if (!sortedFiltered.length) {
                renderedItemByKey.clear();
                gridEl.classList.remove('pv-sharedGrid--animating');
                setText(summaryEl, `0 of ${selectedItems.length} ${itemLabel} shown from ${collectionName}.`);
                setEmptyState(gridEl, 'No items match the selected filters.');
                return;
            }

            if (String(query || '').trim() || selectedType !== 'all') {
                setText(summaryEl, `${sortedFiltered.length} of ${selectedItems.length} ${itemLabel} shown from ${collectionName}. ${filteredUnits} ${unitLabel} visible.`);
            } else {
                setText(summaryEl, `${selectedItems.length} ${itemLabel} shared from ${collectionName}. ${totalUnits} ${unitLabel}.`);
            }

            renderedItemByKey.clear();
            const gridItems = visibleItems.map((item, index) => {
                const itemKey = `${selectedCollectionId}:${safeString(item.id, 'item')}:${pagination.startIndex + index}`;
                renderedItemByKey.set(itemKey, item);
                return createCollectionItemElement(item, itemKey);
            });
            gridEl.replaceChildren(...gridItems);

            if (animate) {
                triggerGridAnimation();
            } else {
                gridEl.classList.remove('pv-sharedGrid--animating');
            }
        }

        async function refreshSelectedCollectionValues() {
            const refreshItems = getSelectedCollectionItems();
            if (!refreshItems.length) return;

            const runId = ++liveRefreshRunId;
            const collectionIdAtStart = selectedCollectionId;
            setText(statusEl, 'Refreshing live prices...');

            await Promise.all(refreshItems.map(async (item) => {
                try {
                    if (isSealedCollectionItem(item)) {
                        const quantity = Math.max(0, Math.floor(Number(item?.quantity ?? item?.copies ?? 0)));
                        if (quantity <= 0) return;

                        const valueInfo = await getCurrentSealedValue(item);
                        const market = Number(valueInfo?.market ?? null);
                        if (!Number.isFinite(market) || market <= 0) return;

                        item.unitValue = market;
                        item.totalValue = market * quantity;
                        item.totalUnits = quantity;
                        item.pricedUnits = quantity;
                        item.copies = quantity;
                        return;
                    }

                    const conditionEntries = getConditionEntries(item?.conditionQuantities, item?.selectedCondition);
                    const totalUnits = conditionEntries.reduce((sum, entry) => sum + entry.qty, 0);
                    if (!conditionEntries.length || totalUnits <= 0) return;

                    let cardTotal = 0;
                    let cardPricedCopies = 0;
                    let cardDisplayUnit = null;
                    let cardDisplayCondition = '';
                    let cardDisplayVariant = '';
                    const primaryCondition = normalizeDexConditionCode(item?.selectedCondition);

                    const fetchedCard = await fetchCardWithPrices(item?.id);
                    const fetchedCardVariants = Array.isArray(fetchedCard?.variants) ? fetchedCard.variants : [];
                    const fallbackCardVariants = Array.isArray(item?.raw?.variants)
                        ? item.raw.variants
                        : (Array.isArray(item?.variants) ? item.variants : []);
                    const sourceCardVariants = fetchedCardVariants.length ? fetchedCardVariants : fallbackCardVariants;

                    if (fetchedCardVariants.length && item?.raw && typeof item.raw === 'object') {
                        item.raw.variants = fetchedCardVariants;
                    }

                    await Promise.all(conditionEntries.map(async (entry) => {
                        const valueInfo = await getCurrentCardValue({
                            ...item,
                            selectedCondition: entry.code,
                        }, sourceCardVariants);
                        const market = Number(valueInfo?.market ?? null);
                        if (!Number.isFinite(market) || market <= 0) return;

                        cardTotal += market * entry.qty;
                        cardPricedCopies += entry.qty;

                        if (primaryCondition && entry.code === primaryCondition) {
                            cardDisplayUnit = market;
                            cardDisplayCondition = entry.code;
                            cardDisplayVariant = safeString(valueInfo?.variantUsed, '').trim();
                        }
                        if (cardDisplayUnit == null) {
                            cardDisplayUnit = market;
                            cardDisplayCondition = entry.code;
                            cardDisplayVariant = safeString(valueInfo?.variantUsed, '').trim();
                        }
                    }));

                    if (!Number.isFinite(cardTotal) || cardTotal <= 0 || !Number.isFinite(cardDisplayUnit) || cardDisplayUnit <= 0) {
                        return;
                    }

                    item.unitValue = Number(cardDisplayUnit);
                    item.totalValue = Number(cardTotal);
                    item.totalUnits = totalUnits;
                    item.pricedUnits = cardPricedCopies;
                    item.copies = totalUnits;
                    item.displayConditionCode = cardDisplayCondition;
                    item.displayVariantUsed = cardDisplayVariant;
                } catch {
                    // keep snapshot values for this item
                }
            }));

            if (runId !== liveRefreshRunId) return;
            if (collectionIdAtStart !== selectedCollectionId) return;

            setText(statusEl, 'Read-only shared view.');
            const currentQuery = filterEl instanceof HTMLInputElement ? filterEl.value : '';
            render(currentQuery, { animate: false });
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
                    render(filterValue, { animate: true });
                });
            }

            if (typeFilterEl instanceof HTMLSelectElement) {
                typeFilterEl.value = loadSharedTypeFilterPreference();
                typeFilterEl.addEventListener('change', () => {
                    typeFilterEl.value = collectionView.normalizeTypeFilter(typeFilterEl.value);
                    saveSharedTypeFilterPreference(typeFilterEl.value);
                    paginationState.page = 1;
                    const filterValue = filterEl instanceof HTMLInputElement ? filterEl.value : '';
                    render(filterValue, { animate: true });
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
                    render(filterValue, { animate: true });
                    void refreshSelectedCollectionValues();
                });
            }

            setText(statusEl, 'Read-only shared view.');
            render('', { animate: false });
            void refreshSelectedCollectionValues();

            if (filterEl instanceof HTMLInputElement) {
                filterEl.addEventListener('input', () => {
                    paginationState.page = 1;
                    render(filterEl.value, { animate: true });
                });
            }

            try {
                if (window?.matchMedia) {
                    const mediaQuery = window.matchMedia(COLLECTION_PAGE_BREAKPOINT_QUERY);
                    const handleBreakpointChange = () => render(
                        filterEl instanceof HTMLInputElement ? filterEl.value : '',
                        { animate: false }
                    );
                    if (typeof mediaQuery.addEventListener === 'function') {
                        mediaQuery.addEventListener('change', handleBreakpointChange);
                    } else if (typeof mediaQuery.addListener === 'function') {
                        mediaQuery.addListener(handleBreakpointChange);
                    }
                }
            } catch {
                // ignore
            }
        } catch (error) {
            const message = safeString(error?.message, 'This collection is not currently shared.');
            setText(statusEl, message);
            setText(summaryEl, 'This collection is not currently shared.');
            setEmptyState(gridEl, 'This collection is not currently shared. The owner can re-enable sharing from their account page at any time.');
            setText(totalEl, 'Total units: 0');
            setText(valueTotalEl, 'Collection value: $0.00');
        }
    });
})();

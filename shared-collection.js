/* Shared read-only collection page */
(function () {
    const SHARE_TOKEN_REGEX = /^[A-Za-z0-9_-]{16,128}$/;
    const SHARED_SORT_MODES = ['value-desc', 'value-asc', 'name-asc', 'name-desc'];
    const SHARED_SORT_PREF_KEY = 'pv:sharedCollectionSortMode:v1';
    const DEX_DEFAULT_COLLECTION_ID = 'default';
    const DEX_DEFAULT_COLLECTION_NAME = 'Default Collection';
    const CONDITION_CODE_ORDER = ['NM', 'LP', 'MP', 'HP', 'DM'];

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

            if (totalValue != null) {
                pricedUnits += entry.qty;
                computedTotal += totalValue;
            }

            return {
                code: entry.code,
                qty: entry.qty,
                unitValue,
                totalValue,
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

    function createCardHtml(item, itemKey) {
        const name = escapeHtml(item.name);
        const setName = escapeHtml(item.setName);
        const rarity = escapeHtml(item.rarity || 'n/a');
        const numberRaw = safeString(item.number, '').trim();
        const number = escapeHtml(numberRaw);
        const copies = Math.max(0, Math.floor(Number(item.copies || 0)));
        const detailPath = buildCardDetailPath(item.raw);
        const detailPathAttr = escapeHtml(detailPath);
        const conditionBreakdown = getConditionValueBreakdown(item);
        const highestConditionLine = conditionBreakdown.lines.find((line) => line.unitValue != null)
            || conditionBreakdown.lines[0]
            || null;
        const highestConditionValueText = highestConditionLine?.unitValue != null
            ? formatUsd(highestConditionLine.unitValue)
            : '--';
        const highestConditionCode = safeString(highestConditionLine?.code, '');
        const valueHint = highestConditionCode
            ? `Highest-condition value shown (${highestConditionCode}).`
            : 'Highest-condition value shown.';
        const valueHintAttr = escapeHtml(valueHint);
        const rarityMetaHtml = number
            ? `<p class="pv-card__text pv-sharedMetaLine"><span class="pv-sharedRarity">${rarity}</span><span class="pv-sharedMetaDivider" aria-hidden="true">&#8226;</span><span class="pv-sharedCardNo">#${number}</span></p>`
            : `<p class="pv-card__text pv-sharedMetaLine"><span class="pv-sharedRarity">${rarity}</span></p>`;
        const copiesText = `${copies} ${copies === 1 ? 'copy' : 'copies'}`;
        const copiesHtml = `<button type="button" class="pv-sharedCopiesBtn" data-shared-item-key="${escapeHtml(itemKey)}" aria-label="View condition breakdown for ${name}">${escapeHtml(copiesText)}</button>`;
        const imageHtml = item.image
            ? `<a class="pv-card__imgLink" href="${detailPathAttr}" aria-label="View ${name} details"><img class="pv-card__img" src="${escapeHtml(item.image)}" alt="${name} card image" /></a>`
            : '';

        return `
            <div class="col-6 col-sm-6 col-md-4 col-lg-3 pv-sharedCollectionCol" data-card-id="${escapeHtml(item.id)}" data-card-name="${name}" data-set-name="${setName}" data-card-number="${number}">
                <article class="pv-card h-100" aria-label="${name}">
                    ${imageHtml}
                    <div class="pv-card__body">
                        <h3 class="pv-card__title"><a class="pv-card__titleLink" href="${detailPathAttr}" aria-label="View ${name} details">${name}</a></h3>
                        <p class="pv-card__text pv-sharedSetName">${setName}</p>
                        ${rarityMetaHtml}
                        <p class="pv-card__text pv-sharedInfoLine"><span class="pv-sharedInfoLabel">Value</span><span class="pv-sharedInfoValueWrap"><span class="pv-sharedInfoValue">${escapeHtml(highestConditionValueText)}</span><button type="button" class="pv-sharedValueHintBtn" data-shared-value-hint="${valueHintAttr}" aria-label="${valueHintAttr}" title="${valueHintAttr}">i</button></span></p>
                        <p class="pv-card__text pv-sharedInfoLine"><span class="pv-sharedInfoLabel">Copies</span><span class="pv-sharedInfoValue">${copiesHtml}</span></p>
                    </div>
                </article>
            </div>
        `;
    }

    function createConditionDialog() {
        const dialog = document.createElement('dialog');
        dialog.className = 'pv-sharedConditionDialog';
        dialog.innerHTML = `
            <div class="pv-sharedConditionDialog__panel">
                <h3 class="pv-sharedConditionDialog__title" id="pv-shared-condition-title">Conditions</h3>
                <ul class="pv-sharedConditionDialog__list" id="pv-shared-condition-list"></ul>
                <p class="pv-sharedConditionDialog__total" id="pv-shared-condition-total"></p>
                <div class="pv-sharedConditionDialog__actions">
                    <button type="button" class="pv-button pv-button--secondary btn" data-shared-condition-close>Close</button>
                </div>
            </div>
        `;

        const titleEl = dialog.querySelector('#pv-shared-condition-title');
        const listEl = dialog.querySelector('#pv-shared-condition-list');
        const totalEl = dialog.querySelector('#pv-shared-condition-total');
        const closeBtn = dialog.querySelector('[data-shared-condition-close]');

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
                    listEl.innerHTML = '';

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

    function createSealedHtml(item, itemKey) {
        const name = escapeHtml(item.name);
        const setName = escapeHtml(item.setName);
        const quantity = Math.max(0, Math.floor(Number(item.quantity || item.copies || 0)));
        const unitValueText = item.unitValue != null ? formatUsd(item.unitValue) : '--';
        const valueHint = 'Per sealed product value shown.';
        const valueHintAttr = escapeHtml(valueHint);
        const quantityText = `${quantity} ${quantity === 1 ? 'unit' : 'units'}`;
        const quantityHtml = `<button type="button" class="pv-sharedQtyBtn" data-shared-item-key="${escapeHtml(itemKey)}" aria-label="View sealed details for ${name}">${escapeHtml(quantityText)}</button>`;
        const imageHtml = `
            <div class="pv-card__imgLink pv-card__imgLink--sealed" aria-hidden="true">
                ${item.image ? `<img class="pv-card__img pv-card__img--sealed" src="${escapeHtml(item.image)}" alt="${name} sealed product image" />` : ''}
            </div>
        `;

        return `
            <div class="col-6 col-sm-6 col-md-4 col-lg-3 pv-sharedCollectionCol" data-card-id="${escapeHtml(item.id)}" data-card-name="${name}" data-set-name="${setName}" data-card-number="">
                <article class="pv-card h-100" aria-label="${name}">
                    ${imageHtml}
                    <div class="pv-card__body">
                        <h3 class="pv-card__title pv-card__title--plain">${name}</h3>
                        <p class="pv-card__text pv-sharedSetName">${setName}</p>
                        <p class="pv-card__text pv-sharedMetaLine pv-sharedMetaLine--empty" aria-hidden="true">Sealed product</p>
                        <p class="pv-card__text pv-sharedInfoLine"><span class="pv-sharedInfoLabel">Value</span><span class="pv-sharedInfoValueWrap"><span class="pv-sharedInfoValue">${escapeHtml(unitValueText)}</span><button type="button" class="pv-sharedValueHintBtn" data-shared-value-hint="${valueHintAttr}" aria-label="${valueHintAttr}" title="${valueHintAttr}">i</button></span></p>
                        <p class="pv-card__text pv-sharedInfoLine"><span class="pv-sharedInfoLabel">Quantity</span><span class="pv-sharedInfoValue">${quantityHtml}</span></p>
                    </div>
                </article>
            </div>
        `;
    }

    function createSealedDetailsDialog() {
        const dialog = document.createElement('dialog');
        dialog.className = 'pv-sharedConditionDialog pv-sharedConditionDialog--sealed';
        dialog.innerHTML = `
            <div class="pv-sharedConditionDialog__panel">
                <h3 class="pv-sharedConditionDialog__title" id="pv-shared-sealed-title">Sealed details</h3>
                <ul class="pv-sharedConditionDialog__list" id="pv-shared-sealed-list"></ul>
                <div class="pv-sharedConditionDialog__actions">
                    <button type="button" class="pv-button pv-button--secondary btn" data-shared-sealed-close>Close</button>
                </div>
            </div>
        `;

        const titleEl = dialog.querySelector('#pv-shared-sealed-title');
        const listEl = dialog.querySelector('#pv-shared-sealed-list');
        const closeBtn = dialog.querySelector('[data-shared-sealed-close]');

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
                    listEl.innerHTML = '';
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

    function createCollectionItemHtml(item, itemKey) {
        if (isSealedCollectionItem(item)) return createSealedHtml(item, itemKey);
        return createCardHtml(item, itemKey);
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

        const conditionDialog = createConditionDialog();
        const sealedDetailsDialog = createSealedDetailsDialog();
        const renderedItemByKey = new Map();
        let renderAnimationTimer = null;

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
                renderedItemByKey.clear();
                gridEl.classList.remove('pv-sharedGrid--animating');
                setText(summaryEl, `${collectionName} has no shared items.`);
                gridEl.innerHTML = '<div class="col-12"><div class="pv-emptyState">This collection is empty.</div></div>';
                return;
            }

            if (!sortedFiltered.length) {
                renderedItemByKey.clear();
                gridEl.classList.remove('pv-sharedGrid--animating');
                setText(summaryEl, `0 of ${selectedItems.length} ${itemLabel} shown from ${collectionName}.`);
                gridEl.innerHTML = '<div class="col-12"><div class="pv-emptyState">No items match that search.</div></div>';
                return;
            }

            if (String(query || '').trim()) {
                setText(summaryEl, `${sortedFiltered.length} of ${selectedItems.length} ${itemLabel} shown from ${collectionName}. ${filteredUnits} ${unitLabel} visible.`);
            } else {
                setText(summaryEl, `${selectedItems.length} ${itemLabel} shared from ${collectionName}. ${totalUnits} ${unitLabel}.`);
            }

            renderedItemByKey.clear();
            gridEl.innerHTML = sortedFiltered
                .map((item, index) => {
                    const itemKey = `${selectedCollectionId}:${safeString(item.id, 'item')}:${index}`;
                    renderedItemByKey.set(itemKey, item);
                    return createCollectionItemHtml(item, itemKey);
                })
                .join('');

            if (animate) {
                triggerGridAnimation();
            } else {
                gridEl.classList.remove('pv-sharedGrid--animating');
            }
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

            if (collectionSelectEl instanceof HTMLSelectElement) {
                collectionSelectEl.addEventListener('change', () => {
                    const nextId = normalizeCollectionId(collectionSelectEl.value, selectedCollectionId);
                    if (collectionOptions.some((option) => option.id === nextId)) {
                        selectedCollectionId = nextId;
                        saveSelectedCollectionPreference(shareToken, selectedCollectionId);
                    }
                    const filterValue = filterEl instanceof HTMLInputElement ? filterEl.value : '';
                    render(filterValue, { animate: true });
                });
            }

            setText(statusEl, 'Read-only shared view.');
            render('', { animate: false });

            if (filterEl instanceof HTMLInputElement) {
                filterEl.addEventListener('input', () => {
                    render(filterEl.value, { animate: true });
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

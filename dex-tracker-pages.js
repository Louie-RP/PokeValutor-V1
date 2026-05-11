/* Dex Collection + Master Sets pages */
(function () {
    const CACHE_PREFIX = 'pv:scrydex:';
    const DEX_COLLECTION_KEY = `${CACHE_PREFIX}collection:v1`;
    const DEX_MASTER_SETS_KEY = `${CACHE_PREFIX}masterSets:v1`;
    const VALUE_CACHE_KEY = `${CACHE_PREFIX}collectionValueCache:v1`;
    const SET_CARDS_CACHE_KEY = `${CACHE_PREFIX}setCardsCache:v1`;
    const VALUE_CACHE_TTL_MS = 20 * 60 * 1000;
    const SET_CARDS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const SET_SEARCH_PAGE_SIZE = 100;
    const SET_SEARCH_MAX_PAGES = 12;
    const DEX_CONDITION_CODES = ['NM', 'LP', 'MP', 'HP', 'DM'];
    const MASTER_DEFAULT_VARIANT_NAME = 'Standard';
    const collectionSortState = {
        active: 'value',
        nameDir: 'asc',
        valueDir: 'desc',
    };
    /** @type {Record<string, number>} */
    const collectionValueById = {};

    function safeParseJson(raw) {
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    function safeString(value, fallback) {
        const s = String(value ?? '');
        return s ? s : (fallback || '');
    }

    function escapeHtml(value) {
        const s = String(value ?? '');
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttr(value) {
        return escapeHtml(value);
    }

    function formatUsd(amount) {
        const n = Number(amount);
        if (!Number.isFinite(n)) return '$0.00';
        return `$${n.toFixed(2)}`;
    }

    function getNameSortLabel() {
        return collectionSortState.nameDir === 'asc' ? 'Name: A-Z' : 'Name: Z-A';
    }

    function getValueSortLabel() {
        return collectionSortState.valueDir === 'desc' ? 'Value: High-Low' : 'Value: Low-High';
    }

    function updateCollectionSortUi() {
        const nameBtn = document.getElementById('pv-sort-name');
        const valueBtn = document.getElementById('pv-sort-value');
        if (nameBtn) {
            nameBtn.textContent = getNameSortLabel();
            const active = collectionSortState.active === 'name';
            nameBtn.classList.toggle('is-active', active);
            nameBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
        }
        if (valueBtn) {
            valueBtn.textContent = getValueSortLabel();
            const active = collectionSortState.active === 'value';
            valueBtn.classList.toggle('is-active', active);
            valueBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
        }
    }

    function applyCollectionSortToGrid(gridEl) {
        if (!gridEl) return;
        if (collectionSortState.active !== 'name' && collectionSortState.active !== 'value') return;

        const cols = Array.from(gridEl.querySelectorAll('.pv-collectionCol'));
        if (cols.length <= 1) return;

        cols.sort((a, b) => {
            const nameA = safeString(a.getAttribute('data-card-name'), '').toLowerCase();
            const nameB = safeString(b.getAttribute('data-card-name'), '').toLowerCase();

            if (collectionSortState.active === 'name') {
                const dir = collectionSortState.nameDir === 'asc' ? 1 : -1;
                const cmp = nameA.localeCompare(nameB);
                return cmp * dir;
            }

            const idA = safeString(a.getAttribute('data-card-id'), '');
            const idB = safeString(b.getAttribute('data-card-id'), '');
            const va = Number(collectionValueById[idA]);
            const vb = Number(collectionValueById[idB]);
            const hasA = Number.isFinite(va);
            const hasB = Number.isFinite(vb);

            if (!hasA && !hasB) {
                return nameA.localeCompare(nameB);
            }
            if (!hasA) return 1;
            if (!hasB) return -1;

            const dir = collectionSortState.valueDir === 'asc' ? 1 : -1;
            if (va === vb) return nameA.localeCompare(nameB);
            return (va - vb) * dir;
        });

        for (const col of cols) {
            gridEl.appendChild(col);
        }
    }

    function bindCollectionSortControls() {
        const nameBtn = document.getElementById('pv-sort-name');
        const valueBtn = document.getElementById('pv-sort-value');

        if (nameBtn && nameBtn.getAttribute('data-bound') !== '1') {
            nameBtn.setAttribute('data-bound', '1');
            nameBtn.addEventListener('click', () => {
                if (collectionSortState.active === 'name') {
                    collectionSortState.nameDir = collectionSortState.nameDir === 'asc' ? 'desc' : 'asc';
                } else {
                    collectionSortState.active = 'name';
                }

                updateCollectionSortUi();
                const grid = document.getElementById('pv-collection-grid');
                applyCollectionSortToGrid(grid);
            });
        }

        if (valueBtn && valueBtn.getAttribute('data-bound') !== '1') {
            valueBtn.setAttribute('data-bound', '1');
            valueBtn.addEventListener('click', () => {
                if (collectionSortState.active === 'value') {
                    collectionSortState.valueDir = collectionSortState.valueDir === 'desc' ? 'asc' : 'desc';
                } else {
                    collectionSortState.active = 'value';
                }

                updateCollectionSortUi();
                const grid = document.getElementById('pv-collection-grid');
                applyCollectionSortToGrid(grid);
            });
        }

        updateCollectionSortUi();
    }

    function getWorkerBase() {
        const defaultWorker = 'https://pokevalutor-v1.lreyperez18.workers.dev';
        return (window?.PV_SECRETS?.PV_API_URL || defaultWorker).replace(/\/$/, '');
    }

    function normalizeVariantNameForCompare(name) {
        return String(name ?? '').trim().toLowerCase();
    }

    function getDefaultVariantNameForCard(cardLike) {
        const selected = safeString(cardLike?.selectedVariant, '').trim();
        if (selected) return selected;

        const variantNames = Array.isArray(cardLike?.variants)
            ? cardLike.variants.map((v) => safeString(v?.name, '').trim()).filter(Boolean)
            : [];
        if (variantNames.length) return '';
        return MASTER_DEFAULT_VARIANT_NAME;
    }

    function normalizeVariantQuantities(rawMap, fallbackVariant, fallbackCopies) {
        /** @type {Record<string, number>} */
        const out = {};

        if (rawMap && typeof rawMap === 'object') {
            for (const [rawName, rawQty] of Object.entries(rawMap)) {
                const name = safeString(rawName, '').trim();
                const qty = Math.floor(Number(rawQty));
                if (!name || !Number.isFinite(qty) || qty <= 0) continue;
                out[name] = (out[name] || 0) + qty;
            }
        }

        if (Object.keys(out).length === 0) {
            const fallbackName = safeString(fallbackVariant, '').trim();
            const copies = Math.max(1, Math.floor(Number(fallbackCopies) || 0));
            if (fallbackName) {
                out[fallbackName] = copies;
            }
        }

        return out;
    }

    function getPrimaryVariantName(variantQuantities, fallbackVariant) {
        const map = normalizeVariantQuantities(variantQuantities, fallbackVariant, 1);
        const keys = Object.keys(map);
        if (!keys.length) return safeString(fallbackVariant, '');
        return keys[0];
    }

    function getOwnedVariantNames(cardLike) {
        const fallbackVariant = getDefaultVariantNameForCard(cardLike);
        const totalCopies = getTotalCopiesFromConditionMap(cardLike?.conditionQuantities, cardLike?.selectedCondition);
        const map = normalizeVariantQuantities(cardLike?.variantQuantities, fallbackVariant, totalCopies);
        return Object.entries(map)
            .filter(([, qty]) => Math.floor(Number(qty)) > 0)
            .map(([name]) => safeString(name, '').trim())
            .filter(Boolean);
    }

    function getRequiredVariantNames(cardLike) {
        const variantNames = Array.isArray(cardLike?.variants)
            ? cardLike.variants
                .map((v) => safeString(v?.name, '').trim())
                .filter(Boolean)
            : [];

        if (variantNames.length) {
            return Array.from(new Set(variantNames));
        }
        return [MASTER_DEFAULT_VARIANT_NAME];
    }

    function findVariantByName(variants, variantName) {
        if (!Array.isArray(variants)) return null;
        const want = normalizeVariantNameForCompare(variantName);
        if (!want) return null;
        return variants.find((v) => normalizeVariantNameForCompare(v?.name) === want) || null;
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
        return DEX_CONDITION_CODES.includes(upper) ? upper : '';
    }

    function getConditionLabel(code) {
        const key = normalizeDexConditionCode(code);
        if (key === 'NM') return 'Near Mint (NM)';
        if (key === 'LP') return 'Lightly Played (LP)';
        if (key === 'MP') return 'Moderately Played (MP)';
        if (key === 'HP') return 'Heavily Played (HP)';
        if (key === 'DM') return 'Damaged (DM)';
        return 'n/a';
    }

    function buildConditionOptionsHtml(selectedCondition) {
        const selected = normalizeDexConditionCode(selectedCondition);
        const options = ['<option value="">Select condition</option>'];
        for (const code of DEX_CONDITION_CODES) {
            const label = getConditionLabel(code);
            const isSelected = selected === code ? 'selected' : '';
            options.push(`<option value="${code}" ${isSelected}>${escapeHtml(label)}</option>`);
        }
        return options.join('');
    }

    function normalizeConditionQuantities(rawMap, fallbackCondition) {
        /** @type {Record<string, number>} */
        const out = {};

        if (rawMap && typeof rawMap === 'object') {
            for (const [rawCode, rawQty] of Object.entries(rawMap)) {
                const code = normalizeDexConditionCode(rawCode);
                if (!code) continue;

                const qty = Math.floor(Number(rawQty));
                if (!Number.isFinite(qty) || qty <= 0) continue;

                out[code] = (out[code] || 0) + qty;
            }
        }

        if (Object.keys(out).length === 0) {
            const fallback = normalizeDexConditionCode(fallbackCondition);
            if (fallback) out[fallback] = 1;
        }

        return out;
    }

    function getPrimaryConditionCode(conditionQuantities) {
        const map = normalizeConditionQuantities(conditionQuantities, '');
        for (const code of DEX_CONDITION_CODES) {
            const qty = Math.floor(Number(map[code] || 0));
            if (qty > 0) return code;
        }
        return '';
    }

    function getConditionQuantityEntries(conditionQuantities, fallbackCondition) {
        const map = normalizeConditionQuantities(conditionQuantities, fallbackCondition);
        /** @type {Array<{ code: string, qty: number }>} */
        const out = [];
        for (const code of DEX_CONDITION_CODES) {
            const qty = Math.floor(Number(map[code] || 0));
            if (!Number.isFinite(qty) || qty <= 0) continue;
            out.push({ code, qty });
        }
        return out;
    }

    function getTotalCopiesFromConditionMap(conditionQuantities, fallbackCondition) {
        const entries = getConditionQuantityEntries(conditionQuantities, fallbackCondition);
        let total = 0;
        for (const entry of entries) {
            total += entry.qty;
        }
        return total;
    }

    function formatConditionSummary(conditionQuantities, fallbackCondition) {
        const entries = getConditionQuantityEntries(conditionQuantities, fallbackCondition);
        if (!entries.length) return 'n/a';
        return entries.map((x) => `${getConditionLabel(x.code)} x${x.qty}`).join(', ');
    }

    function readValueCache() {
        try {
            const raw = localStorage.getItem(VALUE_CACHE_KEY);
            if (!raw) return {};
            const parsed = safeParseJson(raw);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch {
            return {};
        }
    }

    function writeValueCache(next) {
        try {
            const safe = (next && typeof next === 'object') ? next : {};
            localStorage.setItem(VALUE_CACHE_KEY, JSON.stringify(safe));
        } catch {
            // ignore
        }
    }

    function getCachedValue(cacheKey) {
        const map = readValueCache();
        const hit = map[cacheKey];
        if (!hit || typeof hit !== 'object') return null;

        const savedAt = Number(hit.savedAt || 0);
        const market = Number(hit.market);
        if (!Number.isFinite(savedAt) || !Number.isFinite(market)) return null;
        if ((Date.now() - savedAt) > VALUE_CACHE_TTL_MS) return null;

        return {
            market,
            variantUsed: safeString(hit.variantUsed, ''),
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

    function readSetCardsCache() {
        try {
            const raw = localStorage.getItem(SET_CARDS_CACHE_KEY);
            if (!raw) return {};
            const parsed = safeParseJson(raw);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch {
            return {};
        }
    }

    function writeSetCardsCache(next) {
        try {
            const safe = (next && typeof next === 'object') ? next : {};
            localStorage.setItem(SET_CARDS_CACHE_KEY, JSON.stringify(safe));
        } catch {
            // ignore
        }
    }

    function getCachedSetCards(expansionId) {
        const id = safeString(expansionId, '').trim();
        if (!id) return null;

        const map = readSetCardsCache();
        const hit = map[id];
        if (!hit || typeof hit !== 'object') return null;

        const savedAt = Number(hit.savedAt || 0);
        const cards = Array.isArray(hit.cards) ? hit.cards : [];
        if (!Number.isFinite(savedAt) || savedAt <= 0) return null;
        if ((Date.now() - savedAt) > SET_CARDS_CACHE_TTL_MS) return null;
        return cards;
    }

    function setCachedSetCards(expansionId, cards) {
        const id = safeString(expansionId, '').trim();
        if (!id) return;

        const map = readSetCardsCache();
        map[id] = {
            savedAt: Date.now(),
            cards: Array.isArray(cards) ? cards : [],
        };
        writeSetCardsCache(map);
    }

    async function fetchJsonWithAuth(url) {
        let headers;
        try {
            const tokenRaw = window?.PV_AUTH?.getIdToken ? await window.PV_AUTH.getIdToken(true) : null;
            const token = typeof tokenRaw === 'string' ? tokenRaw.trim() : '';
            if (token && token.split('.').length === 3) {
                headers = { Authorization: `Bearer ${token}` };
            }
        } catch {
            // ignore
        }

        const res = await fetch(url, headers ? { headers } : undefined);
        const text = await res.text();

        let data;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error(`Non-JSON response (${res.status})`);
        }

        if (!res.ok || (data && typeof data === 'object' && data.ok === false)) {
            const msg = data?.error || data?.message || `API error ${res.status}`;
            throw new Error(String(msg));
        }

        return data;
    }

    function mergeUniqueCardsById(target, next) {
        const out = Array.isArray(target) ? target.slice() : [];
        const seen = new Set(out.map((c) => safeString(c?.id, '')));
        for (const card of (Array.isArray(next) ? next : [])) {
            const id = safeString(card?.id, '');
            if (!id || seen.has(id)) continue;
            seen.add(id);
            out.push(card);
        }
        return out;
    }

    async function fetchCardsSearchPage(base, query, page, pageSize) {
        const url = `${base}/cards/search?q=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}&lang=en`;
        const data = await fetchJsonWithAuth(url);
        const cards = Array.isArray(data?.data) ? data.data : [];
        const totalCount = Number(data?.totalCount || cards.length);
        const pageNum = Number(data?.page || page);
        const pageSizeNum = Number(data?.pageSize || pageSize);
        const hasMore = Number.isFinite(totalCount)
            ? (pageNum * pageSizeNum) < totalCount
            : cards.length >= pageSize;

        return { cards, hasMore };
    }

    async function fetchSetCardsByExpansion(expansionId) {
        const id = safeString(expansionId, '').trim();
        if (!id) return [];

        const cached = getCachedSetCards(id);
        if (cached) return cached;

        const base = getWorkerBase();
        const queryCandidates = [
            `expansion.id:${id}`,
            `expansion_id:${id}`,
            `expansion:${id}`,
        ];

        let merged = [];
        for (const query of queryCandidates) {
            let page = 1;
            let hasMore = true;
            let hitForQuery = false;

            while (hasMore && page <= SET_SEARCH_MAX_PAGES) {
                const pageData = await fetchCardsSearchPage(base, query, page, SET_SEARCH_PAGE_SIZE);
                if (pageData.cards.length) {
                    hitForQuery = true;
                    merged = mergeUniqueCardsById(merged, pageData.cards);
                }
                hasMore = pageData.hasMore;
                page += 1;
            }

            if (hitForQuery) break;
        }

        setCachedSetCards(id, merged);
        return merged;
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

            const marketRaw = (p?.market ?? p?.marketPrice ?? p?.market_price ?? null);
            const market = typeof marketRaw === 'number' ? marketRaw : Number(marketRaw);
            if (!Number.isFinite(market)) continue;
            if (best == null || market > best) best = market;
        }
        return best;
    }

    function getBestVariantMarket(variants, selectedVariant, conditionCode) {
        if (!Array.isArray(variants) || !variants.length) return null;

        const chosenName = safeString(selectedVariant, '');
        if (chosenName) {
            const match = findVariantByName(variants, chosenName);
            const market = getMarketForCondition(match?.prices, conditionCode);
            if (market != null) {
                return { market, variantUsed: safeString(match?.name, chosenName) };
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

    async function fetchCardWithPrices(cardId) {
        const id = safeString(cardId, '');
        if (!id) return null;

        try {
            let headers;
            try {
                const tokenRaw = window?.PV_AUTH?.getIdToken ? await window.PV_AUTH.getIdToken(false) : null;
                const token = String(tokenRaw || '').trim();
                if (token) headers = { Authorization: `Bearer ${token}` };
            } catch {
                // ignore
            }

            const url = `${getWorkerBase()}/cards/${encodeURIComponent(id)}?includePrices=1&lang=en`;
            const res = await fetch(url, headers ? { headers } : undefined);
            if (!res.ok) return null;

            const text = await res.text();
            const parsed = safeParseJson(text);
            if (!parsed || typeof parsed !== 'object') return null;
            return parsed?.data || parsed;
        } catch {
            return null;
        }
    }

    async function getCurrentCardValue(item) {
        const id = safeString(item?.id, '');
        const conditionCode = normalizeDexConditionCode(item?.selectedCondition);
        if (!id || !conditionCode) return null;

        const selectedVariant = safeString(item?.selectedVariant, '');
        const cacheKey = `${id}|${selectedVariant}|${conditionCode}`;
        const cached = getCachedValue(cacheKey);
        if (cached && Number.isFinite(cached.market)) {
            return cached;
        }

        const fetched = await fetchCardWithPrices(id);
        const fetchedVariants = Array.isArray(fetched?.variants) ? fetched.variants : [];
        const fallbackVariants = Array.isArray(item?.variants) ? item.variants : [];
        const sourceVariants = fetchedVariants.length ? fetchedVariants : fallbackVariants;

        const best = getBestVariantMarket(sourceVariants, selectedVariant, conditionCode);
        if (!best || !Number.isFinite(best.market)) return null;

        setCachedValue(cacheKey, best.market, best.variantUsed);
        return best;
    }

    async function refreshCollectionValues(items, totalEl) {
        if (!totalEl) return;

        const list = Array.isArray(items) ? items : [];
        for (const key of Object.keys(collectionValueById)) {
            delete collectionValueById[key];
        }

        if (!list.length) {
            totalEl.textContent = 'Collection Value: $0.00';
            return;
        }

        totalEl.textContent = 'Collection Value: Loading...';

        let total = 0;
        let totalCopies = 0;
        let pricedCopies = 0;

        await Promise.all(list.map(async (item) => {
            const id = safeString(item?.id, '');
            if (!id) return;

            const valueElId = `pv-collection-value-${encodeURIComponent(id)}`;
            const valueEl = document.getElementById(valueElId);
            const conditionEntries = getConditionQuantityEntries(item?.conditionQuantities, item?.selectedCondition);
            const copiesForCard = conditionEntries.reduce((sum, entry) => sum + entry.qty, 0);
            totalCopies += copiesForCard;

            if (valueEl) {
                valueEl.textContent = conditionEntries.length ? '...' : '--';
            }

            if (!conditionEntries.length) {
                delete collectionValueById[id];
                return;
            }

            let cardTotal = 0;
            let cardPricedCopies = 0;
            let cardDisplayUnit = null;
            const primaryCondition = normalizeDexConditionCode(item?.selectedCondition);

            await Promise.all(conditionEntries.map(async (entry) => {
                const valueInfo = await getCurrentCardValue({
                    ...item,
                    selectedCondition: entry.code,
                });
                if (!valueInfo || !Number.isFinite(valueInfo.market)) return;

                cardTotal += valueInfo.market * entry.qty;
                cardPricedCopies += entry.qty;

                if (primaryCondition && entry.code === primaryCondition) {
                    cardDisplayUnit = valueInfo.market;
                }
                if (cardDisplayUnit == null) {
                    cardDisplayUnit = valueInfo.market;
                }
            }));

            if (cardTotal <= 0) {
                delete collectionValueById[id];
                if (valueEl) valueEl.textContent = '--';
                return;
            }

            pricedCopies += cardPricedCopies;
            total += cardTotal;
            collectionValueById[id] = Number.isFinite(cardDisplayUnit) ? Number(cardDisplayUnit) : 0;
            if (valueEl) {
                valueEl.textContent = Number.isFinite(cardDisplayUnit) ? formatUsd(cardDisplayUnit) : '--';
            }
        }));

        const coverage = pricedCopies < totalCopies ? ` (${pricedCopies}/${totalCopies} priced)` : '';
        totalEl.textContent = `Collection Value: ${formatUsd(total)}${coverage}`;

        const grid = document.getElementById('pv-collection-grid');
        applyCollectionSortToGrid(grid);
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

    function normalizeCollectionEntry(raw) {
        const conditionQuantities = normalizeConditionQuantities(raw?.conditionQuantities, raw?.selectedCondition);
        const selectedCondition = getPrimaryConditionCode(conditionQuantities);
        const totalCopies = getTotalCopiesFromConditionMap(conditionQuantities, selectedCondition);
        const fallbackVariant = getDefaultVariantNameForCard(raw);
        const variantQuantities = normalizeVariantQuantities(raw?.variantQuantities, fallbackVariant, totalCopies);
        const selectedVariant = getPrimaryVariantName(variantQuantities, fallbackVariant);
        const addedAt = Number(raw?.addedAt || 0);
        const updatedAt = Number(raw?.updatedAt || 0);

        return {
            id: safeString(raw?.id, ''),
            name: safeString(raw?.name, 'Unknown'),
            rarity: safeString(raw?.rarity, ''),
            expansion: (raw?.expansion && typeof raw.expansion === 'object') ? raw.expansion : null,
            set: (raw?.set && typeof raw.set === 'object') ? raw.set : null,
            images: Array.isArray(raw?.images) ? raw.images : [],
            variants: Array.isArray(raw?.variants) ? raw.variants : [],
            selectedVariant,
            variantQuantities,
            selectedCondition,
            conditionQuantities,
            pricesText: safeString(raw?.pricesText, ''),
            addedAt: Number.isFinite(addedAt) && addedAt > 0 ? addedAt : Date.now(),
            updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
        };
    }

    function readCollection() {
        try {
            const raw = localStorage.getItem(DEX_COLLECTION_KEY);
            if (!raw) return [];
            const parsed = safeParseJson(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .filter((x) => x && typeof x === 'object' && x.id)
                .map((x) => normalizeCollectionEntry(x));
        } catch {
            return [];
        }
    }

    function writeCollection(next, options) {
        try {
            localStorage.setItem(DEX_COLLECTION_KEY, JSON.stringify(Array.isArray(next) ? next : []));
        } catch {
            // ignore
        }

        if (!options?.skipCloudSync) {
            queueDexCloudStateSync(false);
        }
    }

    function normalizeMasterSetEntry(entry, fallbackExpansionId) {
        if (!entry || typeof entry !== 'object') return null;

        const expansionId = safeString(entry?.expansionId ?? fallbackExpansionId, '').trim();
        if (!expansionId) return null;

        const ids = Array.isArray(entry?.cardIds)
            ? entry.cardIds.map((x) => safeString(x, '').trim()).filter(Boolean)
            : [];
        const cardIds = Array.from(new Set(ids));
        const updatedAt = getDexUpdatedAt(entry?.updatedAt) || Date.now();

        return {
            expansionId,
            expansionName: safeString(entry?.expansionName, 'Unknown Set'),
            series: safeString(entry?.series, ''),
            setImage: safeString(entry?.setImage, ''),
            targetCount: Number(entry?.targetCount || 0) || null,
            cardIds,
            count: cardIds.length,
            updatedAt,
        };
    }

    function normalizeMasterSetsMap(mapLike) {
        /** @type {Record<string, any>} */
        const out = {};
        if (!mapLike || typeof mapLike !== 'object') return out;

        for (const [key, value] of Object.entries(mapLike)) {
            const normalized = normalizeMasterSetEntry(value, key);
            if (!normalized) continue;
            out[normalized.expansionId] = normalized;
        }

        return out;
    }

    function readMasterSets() {
        try {
            const raw = localStorage.getItem(DEX_MASTER_SETS_KEY);
            if (!raw) return {};
            const parsed = safeParseJson(raw);
            if (!parsed || typeof parsed !== 'object') return {};
            return normalizeMasterSetsMap(parsed);
        } catch {
            return {};
        }
    }

    function writeMasterSets(next, options) {
        try {
            const safe = (next && typeof next === 'object') ? next : {};
            localStorage.setItem(DEX_MASTER_SETS_KEY, JSON.stringify(safe));
        } catch {
            // ignore
        }

        if (!options?.skipCloudSync) {
            queueDexCloudStateSync(false);
        }
    }

    const DEX_CLOUD_SYNC_DEBOUNCE_MS = 450;
    let dexCloudSyncTimer = 0;
    let dexCloudSyncHydrating = false;

    function getDexUpdatedAt(value) {
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function queueDexCloudStateSync(immediate) {
        if (dexCloudSyncHydrating) return;
        const authApi = window?.PV_AUTH;
        const user = authApi?.getUser ? authApi.getUser() : null;
        if (!user || !authApi?.saveDexState) return;

        const run = () => {
            const payload = {
                collection: readCollection(),
                masterSets: readMasterSets(),
            };

            Promise.resolve(authApi.saveDexState(payload)).catch(() => {
                // ignore
            });
        };

        if (immediate) {
            if (dexCloudSyncTimer) {
                window.clearTimeout(dexCloudSyncTimer);
                dexCloudSyncTimer = 0;
            }
            run();
            return;
        }

        if (dexCloudSyncTimer) {
            window.clearTimeout(dexCloudSyncTimer);
        }
        dexCloudSyncTimer = window.setTimeout(run, DEX_CLOUD_SYNC_DEBOUNCE_MS);
    }

    function mergeCollectionState(localList, cloudList) {
        /** @type {Map<string, any>} */
        const byId = new Map();

        function addCard(raw) {
            const normalized = normalizeCollectionEntry(raw);
            const id = safeString(normalized?.id, '').trim();
            if (!id) return;

            const existing = byId.get(id);
            if (!existing) {
                byId.set(id, normalized);
                return;
            }

            const existingUpdatedAt = getDexUpdatedAt(existing?.updatedAt);
            const nextUpdatedAt = getDexUpdatedAt(normalized?.updatedAt);
            if (nextUpdatedAt >= existingUpdatedAt) {
                byId.set(id, normalized);
            }
        }

        if (Array.isArray(localList)) {
            for (const item of localList) addCard(item);
        }
        if (Array.isArray(cloudList)) {
            for (const item of cloudList) addCard(item);
        }

        return Array.from(byId.values())
            .sort((a, b) => Number(b?.addedAt || 0) - Number(a?.addedAt || 0));
    }

    function mergeMasterSetsState(localMap, cloudMap, mergedCollection) {
        const local = normalizeMasterSetsMap(localMap);
        const cloud = normalizeMasterSetsMap(cloudMap);
        /** @type {Record<string, any>} */
        const seedByExpansionId = {};
        const seedKeys = Array.from(new Set([...Object.keys(local), ...Object.keys(cloud)]));

        for (const key of seedKeys) {
            const localEntry = local[key] || null;
            const cloudEntry = cloud[key] || null;

            if (!localEntry && !cloudEntry) continue;
            if (!localEntry) {
                seedByExpansionId[key] = cloudEntry;
                continue;
            }
            if (!cloudEntry) {
                seedByExpansionId[key] = localEntry;
                continue;
            }

            const localUpdatedAt = getDexUpdatedAt(localEntry?.updatedAt);
            const cloudUpdatedAt = getDexUpdatedAt(cloudEntry?.updatedAt);
            seedByExpansionId[key] = cloudUpdatedAt >= localUpdatedAt ? cloudEntry : localEntry;
        }

        /** @type {Record<string, any>} */
        const merged = {};

        for (const card of (Array.isArray(mergedCollection) ? mergedCollection : [])) {
            const cardId = safeString(card?.id, '').trim();
            if (!cardId) continue;

            const ex = (card?.expansion && typeof card.expansion === 'object')
                ? card.expansion
                : ((card?.set && typeof card.set === 'object') ? card.set : null);
            const expansionId = safeString(ex?.id, '').trim();
            if (!expansionId) continue;

            const seed = seedByExpansionId[expansionId] || null;
            const existing = merged[expansionId] || null;
            const existingIds = Array.isArray(existing?.cardIds) ? existing.cardIds : [];
            const nextIds = existingIds.includes(cardId) ? existingIds : [...existingIds, cardId];
            const seedUpdatedAt = getDexUpdatedAt(seed?.updatedAt);
            const cardUpdatedAt = getDexUpdatedAt(card?.updatedAt);
            const expansionName = safeString(ex?.name, safeString(card?.expansionName ?? card?.setName, 'Unknown Set'));
            const expansionSeries = safeString(ex?.series, '');
            const expansionImage = safeString(ex?.logo ?? ex?.symbol ?? ex?.image ?? ex?.images?.logo ?? ex?.images?.symbol, '');
            const targetCount = Number(ex?.printed_total ?? ex?.printedTotal ?? ex?.total ?? 0) || null;

            merged[expansionId] = {
                expansionId,
                expansionName: safeString(seed?.expansionName, expansionName),
                series: safeString(seed?.series, expansionSeries),
                setImage: safeString(seed?.setImage, expansionImage),
                targetCount: Number(seed?.targetCount || targetCount || 0) || null,
                cardIds: nextIds,
                count: nextIds.length,
                updatedAt: Math.max(seedUpdatedAt, cardUpdatedAt, Date.now()),
            };
        }

        return merged;
    }

    function syncDexStateFromCloudOnSignIn() {
        if (!window?.PV_AUTH?.loadDexState) return;

        const localCollection = readCollection();
        const localMasterSets = readMasterSets();
        let mergedPayload = null;
        dexCloudSyncHydrating = true;

        Promise.resolve(window.PV_AUTH.loadDexState())
            .then((cloudState) => {
                const cloudCollection = Array.isArray(cloudState?.collection) ? cloudState.collection : [];
                const cloudMasterSets = (cloudState?.masterSets && typeof cloudState.masterSets === 'object')
                    ? cloudState.masterSets
                    : {};

                const mergedCollection = mergeCollectionState(localCollection, cloudCollection);
                const mergedMasterSets = mergeMasterSetsState(localMasterSets, cloudMasterSets, mergedCollection);

                writeCollection(mergedCollection, { skipCloudSync: true });
                writeMasterSets(mergedMasterSets, { skipCloudSync: true });
                mergedPayload = {
                    collection: mergedCollection,
                    masterSets: mergedMasterSets,
                };
                renderActivePage();
            })
            .catch(() => {
                // ignore
            })
            .finally(() => {
                dexCloudSyncHydrating = false;

                if (mergedPayload && window?.PV_AUTH?.saveDexState) {
                    Promise.resolve(window.PV_AUTH.saveDexState(mergedPayload)).catch(() => {
                        // ignore
                    });
                }
            });
    }

    function updateCollectionConditionQuantity(cardId, conditionCode, delta) {
        const id = safeString(cardId, '');
        const code = normalizeDexConditionCode(conditionCode);
        const qtyDelta = Math.floor(Number(delta));
        if (!id || !code || !Number.isFinite(qtyDelta) || qtyDelta === 0) {
            return { changed: false, removeCard: false };
        }

        const collection = readCollection();
        let found = false;
        let changed = false;
        let removeCard = false;

        const nextCollection = collection.map((entry) => {
            if (safeString(entry?.id, '') !== id) return entry;

            found = true;
            const map = normalizeConditionQuantities(entry?.conditionQuantities, entry?.selectedCondition);
            const currentQty = Math.floor(Number(map[code] || 0));
            const nextQty = Math.max(0, currentQty + qtyDelta);

            if (nextQty === currentQty) return entry;

            changed = true;
            if (nextQty > 0) {
                map[code] = nextQty;
            } else {
                delete map[code];
            }

            if (getTotalCopiesFromConditionMap(map, '') <= 0) {
                removeCard = true;
                return entry;
            }

            return {
                ...entry,
                conditionQuantities: map,
                selectedCondition: getPrimaryConditionCode(map),
                updatedAt: Date.now(),
            };
        });

        if (!found || !changed) {
            return { changed: false, removeCard: false };
        }

        if (!removeCard) {
            writeCollection(nextCollection);
        }

        return { changed: true, removeCard };
    }

    function removeCardFromTrackers(cardId) {
        const id = safeString(cardId, '');
        if (!id) return false;

        const collection = readCollection();
        const nextCollection = collection.filter((x) => safeString(x?.id, '') !== id);
        const removedCollection = nextCollection.length !== collection.length;
        if (removedCollection) {
            writeCollection(nextCollection);
        }

        const master = readMasterSets();
        let removedMaster = false;
        for (const key of Object.keys(master)) {
            const entry = master[key];
            if (!entry || typeof entry !== 'object') continue;

            const cardIds = Array.isArray(entry.cardIds)
                ? entry.cardIds.map((x) => safeString(x, '')).filter(Boolean)
                : [];
            if (!cardIds.includes(id)) continue;

            removedMaster = true;
            const nextIds = cardIds.filter((x) => x !== id);
            if (!nextIds.length) {
                delete master[key];
            } else {
                master[key] = {
                    ...entry,
                    cardIds: nextIds,
                    count: nextIds.length,
                    updatedAt: Date.now(),
                };
            }
        }

        if (removedMaster) {
            writeMasterSets(master);
        }

        return removedCollection || removedMaster;
    }

    function buildMasterSetDetailUrl(expansionId, expansionName) {
        const id = safeString(expansionId, '').trim();
        const name = safeString(expansionName, '').trim();
        if (!id) return 'master-set.html';

        const params = new URLSearchParams();
        params.set('expansionId', id);
        if (name) params.set('expansionName', name);
        return `master-set.html?${params.toString()}`;
    }

    function buildCollectionIndexById(collection) {
        /** @type {Record<string, any>} */
        const out = {};
        for (const item of (Array.isArray(collection) ? collection : [])) {
            const id = safeString(item?.id, '');
            if (!id) continue;
            out[id] = item;
        }
        return out;
    }

    function getCardDisplayNumber(cardLike) {
        const cardNo = safeString(cardLike?.card_no, '');
        if (cardNo) return cardNo;
        const number = safeString(cardLike?.number, '');
        return number;
    }

    function splitCardVariants(setCard, collectedCard) {
        const requiredVariants = getRequiredVariantNames(setCard);
        const requiredKeys = requiredVariants.map((v) => normalizeVariantNameForCompare(v));
        const defaultKey = normalizeVariantNameForCompare(MASTER_DEFAULT_VARIANT_NAME);
        const totalCopies = getTotalCopiesFromConditionMap(collectedCard?.conditionQuantities, collectedCard?.selectedCondition);

        if (requiredKeys.length === 1 && requiredKeys[0] === defaultKey) {
            return {
                requiredVariants,
                collectedVariants: totalCopies > 0 ? requiredVariants.slice() : [],
                missingVariants: totalCopies > 0 ? [] : requiredVariants.slice(),
            };
        }

        const ownedVariantKeys = new Set(
            getOwnedVariantNames(collectedCard).map((name) => normalizeVariantNameForCompare(name)).filter(Boolean)
        );

        /** @type {Array<string>} */
        const collectedVariants = [];
        /** @type {Array<string>} */
        const missingVariants = [];

        for (const required of requiredVariants) {
            const key = normalizeVariantNameForCompare(required);
            if (ownedVariantKeys.has(key)) {
                collectedVariants.push(required);
            } else {
                missingVariants.push(required);
            }
        }

        return { requiredVariants, collectedVariants, missingVariants };
    }

    function computeSetVariantProgress(setCards, cardsById) {
        /** @type {Array<any>} */
        const collectedCards = [];
        /** @type {Array<any>} */
        const missingCards = [];
        let collectedUnits = 0;
        let requiredUnits = 0;

        for (const setCard of (Array.isArray(setCards) ? setCards : [])) {
            const id = safeString(setCard?.id, '');
            if (!id) continue;

            const collectedCard = cardsById[id];
            const split = splitCardVariants(setCard, collectedCard);
            requiredUnits += split.requiredVariants.length;
            collectedUnits += split.collectedVariants.length;

            const item = {
                id,
                name: safeString(setCard?.name, 'Unknown'),
                number: getCardDisplayNumber(setCard),
                image: pickFrontMediumImage(setCard?.images),
                collectedVariants: split.collectedVariants,
                missingVariants: split.missingVariants,
                collectedVariantCount: split.collectedVariants.length,
                requiredVariantCount: split.requiredVariants.length,
            };

            if (split.collectedVariants.length) {
                collectedCards.push(item);
            }
            if (split.missingVariants.length) {
                missingCards.push(item);
            }
        }

        const ratio = requiredUnits > 0 ? Math.min(100, (collectedUnits / requiredUnits) * 100) : 0;
        return {
            collectedCards,
            missingCards,
            collectedUnits,
            requiredUnits,
            ratio,
            ratioLabel: ratio >= 10 ? `${Math.round(ratio)}%` : `${ratio.toFixed(1)}%`,
        };
    }

    function getSetImageFromData(entry, setCards, cardsById) {
        let image = safeString(entry?.setImage, '');
        if (image) return image;

        const firstSetCard = Array.isArray(setCards) && setCards.length ? setCards[0] : null;
        image = safeString(
            firstSetCard?.expansion?.logo
            || firstSetCard?.expansion?.symbol
            || firstSetCard?.set?.logo
            || firstSetCard?.set?.symbol,
            ''
        );
        if (image) return image;

        if (firstSetCard) {
            image = pickFrontMediumImage(firstSetCard?.images);
            if (image) return image;
        }

        const cardIds = Array.isArray(entry?.cardIds)
            ? entry.cardIds.map((x) => safeString(x, '')).filter(Boolean)
            : [];
        const firstCollected = cardIds.length ? cardsById[cardIds[0]] : null;
        return pickFrontMediumImage(firstCollected?.images);
    }

    async function hydrateMasterSetCardsWithVariantProgress(entries, cardsById, grid) {
        await Promise.all(entries.map(async (entry) => {
            const expansionId = safeString(entry?.expansionId, '').trim();
            if (!expansionId) return;

            const article = grid.querySelector(`[data-master-set-id="${CSS.escape(expansionId)}"]`);
            if (!(article instanceof HTMLElement)) return;

            try {
                const setCards = await fetchSetCardsByExpansion(expansionId);
                if (!setCards.length) return;

                const progress = computeSetVariantProgress(setCards, cardsById);
                const countEl = article.querySelector('[data-master-count]');
                const barEl = article.querySelector('[data-master-progressbar]');
                const fillEl = article.querySelector('[data-master-progress-fill]');
                const ratioEl = article.querySelector('[data-master-ratio]');
                const imageEl = article.querySelector('[data-master-image]');

                if (countEl) {
                    countEl.textContent = `Collected: ${progress.collectedUnits}/${progress.requiredUnits} master variants`;
                }
                if (barEl instanceof HTMLElement) {
                    barEl.setAttribute('aria-valuenow', String(Math.round(progress.ratio)));
                }
                if (fillEl instanceof HTMLElement) {
                    fillEl.style.width = `${progress.ratio}%`;
                }
                if (ratioEl) {
                    ratioEl.textContent = `Progress: ${progress.ratioLabel}`;
                }

                if (imageEl instanceof HTMLImageElement) {
                    const image = getSetImageFromData(entry, setCards, cardsById);
                    if (image) {
                        imageEl.src = image;
                        imageEl.hidden = false;
                    }
                }
            } catch {
                // Keep fallback progress if fetch fails.
            }
        }));
    }

    function renderMasterSetDetailCards(list, mode) {
        if (!Array.isArray(list) || !list.length) {
            return `<div class="pv-emptyState">No ${mode} cards in this set.</div>`;
        }

        const rows = list.map((item) => {
            const name = escapeHtml(safeString(item?.name, 'Unknown'));
            const number = escapeHtml(safeString(item?.number, ''));
            const img = escapeAttr(safeString(item?.image, ''));
            const collectedCount = Math.max(0, Math.floor(Number(item?.collectedVariantCount || 0)));
            const requiredCount = Math.max(0, Math.floor(Number(item?.requiredVariantCount || 0)));
            const badge = `${collectedCount}/${requiredCount}`;
            const variants = mode === 'collected'
                ? (Array.isArray(item?.collectedVariants) ? item.collectedVariants : [])
                : (Array.isArray(item?.missingVariants) ? item.missingVariants : []);
            const heading = mode === 'collected' ? 'Collected variants' : 'Missing variants';
            const variantTags = variants.length
                ? variants.map((name) => `<span class="pv-variantTag ${mode === 'missing' ? 'pv-variantTag--missing' : ''}">${escapeHtml(name)}</span>`).join('')
                : '<span class="pv-masterSetDetailCard__meta">None</span>';

            return `
                <article class="pv-masterSetDetailCard">
                    ${img ? `<img class="pv-masterSetDetailCard__image" src="${img}" alt="${name} card image" loading="lazy"/>` : ''}
                    <div class="pv-masterSetDetailCard__content">
                        <div class="pv-masterSetDetailCard__titleRow">
                            <h3 class="pv-masterSetDetailCard__title">${name}${number ? ` <span class="pv-masterSetDetailCard__number">#${number}</span>` : ''}</h3>
                            <span class="pv-variantProgressBadge" aria-label="Collected variants ${badge}">${badge}</span>
                        </div>
                        <p class="pv-masterSetDetailCard__meta">${heading}</p>
                        <div class="pv-variantTagList">${variantTags}</div>
                    </div>
                </article>
            `;
        }).join('');

        return `<div class="pv-masterSetDetailGrid">${rows}</div>`;
    }

    function renderCollectionPage() {
        const grid = document.getElementById('pv-collection-grid');
        const summary = document.getElementById('pv-collection-summary');
        const totalEl = document.getElementById('pv-collection-total');
        const clearBtn = document.getElementById('pv-collection-clear');
        if (!grid || !summary || !totalEl) return;

        const items = readCollection().slice().sort((a, b) => Number(b?.addedAt || 0) - Number(a?.addedAt || 0));
        const totalCopies = items.reduce((sum, item) => {
            return sum + getTotalCopiesFromConditionMap(item?.conditionQuantities, item?.selectedCondition);
        }, 0);
        summary.textContent = `${items.length} unique card${items.length === 1 ? '' : 's'} • ${totalCopies} total cop${totalCopies === 1 ? 'y' : 'ies'}.`;

        bindCollectionSortControls();

        if (!items.length) {
            totalEl.textContent = 'Collection Value: $0.00';
            grid.innerHTML = '<div class="col-12"><div class="pv-emptyState">No cards tracked yet. Open Dex, browse a set, and press + on cards you own.</div></div>';
        } else {
            const rows = items.map((item) => {
                const id = safeString(item?.id, '');
                const cardName = safeString(item?.name, 'Unknown');
                const name = escapeHtml(cardName);
                const setName = escapeHtml(getCardSetName(item));
                const rarity = escapeHtml(safeString(item?.rarity, 'n/a'));
                const img = escapeHtml(pickFrontMediumImage(item?.images));
                const valueElId = `pv-collection-value-${encodeURIComponent(id)}`;
                const conditionEntries = getConditionQuantityEntries(item?.conditionQuantities, item?.selectedCondition);
                const copyCount = conditionEntries.reduce((sum, entry) => sum + entry.qty, 0);
                const addConditionSelectId = `pv-add-condition-${encodeURIComponent(id)}`;
                const addConditionOptions = buildConditionOptionsHtml('');

                const conditionRows = conditionEntries.length
                    ? conditionEntries.map((entry) => {
                        const label = escapeHtml(getConditionLabel(entry.code));
                        const code = escapeAttr(entry.code);
                        return `
                                    <div class="pv-conditionQtyRow">
                                        <p class="pv-card__text pv-conditionQtyLabel">${label}</p>
                                        <div class="pv-qtyStepper" role="group" aria-label="Adjust ${code} quantity for ${name}">
                                            <button class="pv-button btn pv-qtyBtn" type="button" data-qty-dec-card-id="${escapeAttr(id)}" data-qty-condition="${code}" aria-label="Decrease ${code} quantity for ${name}">-</button>
                                            <span class="pv-qtyValue">${entry.qty}</span>
                                            <button class="pv-button btn pv-qtyBtn" type="button" data-qty-inc-card-id="${escapeAttr(id)}" data-qty-condition="${code}" aria-label="Increase ${code} quantity for ${name}">+</button>
                                        </div>
                                    </div>
                                `;
                    }).join('')
                    : '<p class="pv-card__text">No condition copies tracked yet.</p>';

                return `
                    <div class="col-12 col-sm-6 col-md-4 col-lg-3 pv-collectionCol" data-card-id="${escapeAttr(id)}" data-card-name="${escapeAttr(cardName)}">
                        <article class="pv-card h-100" aria-label="${name}">
                            ${img ? `<img class="pv-card__img" src="${img}" alt="${name} card image"/>` : ''}
                            <div class="pv-card__body">
                                <h3 class="pv-card__title">${name}</h3>
                                <p class="pv-card__text">${setName}</p>
                                <p class="pv-card__text">${rarity}</p>
                                <p class="pv-card__text">Copies tracked: ${copyCount}</p>
                                <p class="pv-collectionAmount" id="${escapeAttr(valueElId)}">${conditionEntries.length ? '...' : '--'}</p>
                                <div class="pv-conditionQtyList">
                                    ${conditionRows}
                                </div>
                                <div class="pv-conditionAddRow">
                                    <select id="${escapeAttr(addConditionSelectId)}" class="form-select pv-conditionSelect" aria-label="Select condition to add for ${name}">
                                        ${addConditionOptions}
                                    </select>
                                    <button class="pv-button btn pv-addConditionBtn" type="button" data-add-condition-card-id="${escapeAttr(id)}" data-add-condition-select-id="${escapeAttr(addConditionSelectId)}">+ Add Copy</button>
                                </div>
                                <button class="pv-button btn pv-removeCardBtn" type="button" data-remove-card-id="${escapeHtml(id)}">Remove Card</button>
                            </div>
                        </article>
                    </div>
                `;
            }).join('');

            grid.innerHTML = rows;
            applyCollectionSortToGrid(grid);

            const removeButtons = Array.from(grid.querySelectorAll('[data-remove-card-id]'));
            for (const btn of removeButtons) {
                btn.addEventListener('click', () => {
                    const id = safeString(btn.getAttribute('data-remove-card-id'), '');
                    if (!id) return;
                    const ok = window.confirm('Remove this card from Collection and Master Sets?');
                    if (!ok) return;
                    removeCardFromTrackers(id);
                    renderActivePage();
                });
            }

            const incrementButtons = Array.from(grid.querySelectorAll('[data-qty-inc-card-id]'));
            for (const btn of incrementButtons) {
                btn.addEventListener('click', () => {
                    const cardId = safeString(btn.getAttribute('data-qty-inc-card-id'), '');
                    const code = normalizeDexConditionCode(btn.getAttribute('data-qty-condition'));
                    if (!cardId || !code) return;

                    const result = updateCollectionConditionQuantity(cardId, code, 1);
                    if (!result.changed) return;
                    renderCollectionPage();
                });
            }

            const decrementButtons = Array.from(grid.querySelectorAll('[data-qty-dec-card-id]'));
            for (const btn of decrementButtons) {
                btn.addEventListener('click', () => {
                    const cardId = safeString(btn.getAttribute('data-qty-dec-card-id'), '');
                    const code = normalizeDexConditionCode(btn.getAttribute('data-qty-condition'));
                    if (!cardId || !code) return;

                    const result = updateCollectionConditionQuantity(cardId, code, -1);
                    if (!result.changed) return;

                    if (result.removeCard) {
                        const ok = window.confirm('No copies remain. Remove this card from Collection and Master Sets?');
                        if (!ok) return;
                        removeCardFromTrackers(cardId);
                        renderActivePage();
                        return;
                    }

                    renderCollectionPage();
                });
            }

            const addConditionButtons = Array.from(grid.querySelectorAll('[data-add-condition-card-id]'));
            for (const btn of addConditionButtons) {
                btn.addEventListener('click', () => {
                    const cardId = safeString(btn.getAttribute('data-add-condition-card-id'), '');
                    const selectId = safeString(btn.getAttribute('data-add-condition-select-id'), '');
                    if (!cardId || !selectId) return;

                    const selectEl = document.getElementById(selectId);
                    if (!(selectEl instanceof HTMLSelectElement)) return;

                    const code = normalizeDexConditionCode(selectEl.value);
                    if (!code) {
                        selectEl.focus();
                        return;
                    }

                    const result = updateCollectionConditionQuantity(cardId, code, 1);
                    if (!result.changed) return;
                    renderCollectionPage();
                });
            }

            void refreshCollectionValues(items, totalEl);
        }

        if (clearBtn) {
            clearBtn.onclick = () => {
                const ok = window.confirm('Clear your entire collection list?');
                if (!ok) return;
                writeCollection([]);
                renderCollectionPage();
            };
        }
    }

    function renderMasterSetsPage() {
        const grid = document.getElementById('pv-master-sets-grid');
        const summary = document.getElementById('pv-master-sets-summary');
        const clearBtn = document.getElementById('pv-master-sets-clear');
        if (!grid || !summary) return;

        const map = readMasterSets();
        const entries = Object.values(map)
            .filter((x) => x && typeof x === 'object')
            .sort((a, b) => {
                const aUpdated = Number(a?.updatedAt || 0);
                const bUpdated = Number(b?.updatedAt || 0);
                return bUpdated - aUpdated;
            });

        summary.textContent = `${entries.length} set${entries.length === 1 ? '' : 's'} in your master tracker.`;

        if (!entries.length) {
            grid.innerHTML = '<div class="pv-emptyState">No master set progress yet. Add cards from Dex to start tracking.</div>';
        } else {
            const collection = readCollection();
            const cardsById = buildCollectionIndexById(collection);

            const rows = entries.map((entry) => {
                const setName = escapeHtml(safeString(entry?.expansionName, 'Unknown Set'));
                const setNameRaw = safeString(entry?.expansionName, 'Unknown Set');
                const series = escapeHtml(safeString(entry?.series, ''));
                const count = Number(entry?.count || (Array.isArray(entry?.cardIds) ? entry.cardIds.length : 0) || 0);
                const target = Number(entry?.targetCount || 0);
                const ratio = target > 0 ? Math.min(100, (count / target) * 100) : 0;
                const ratioLabel = ratio >= 10 ? `${Math.round(ratio)}%` : `${ratio.toFixed(1)}%`;
                const countText = target > 0 ? `${count}/${target}` : `${count}`;
                const cardIds = Array.isArray(entry?.cardIds)
                    ? entry.cardIds.map((x) => safeString(x, '')).filter(Boolean)
                    : [];
                const expansionId = safeString(entry?.expansionId, '');
                const detailUrl = escapeAttr(buildMasterSetDetailUrl(expansionId, setNameRaw));
                const firstCard = cardIds.length ? cardsById[cardIds[0]] : null;
                const imageSrc = safeString(entry?.setImage, '') || pickFrontMediumImage(firstCard?.images);
                const imageHtml = imageSrc
                    ? `<img class="pv-masterSetCard__image" src="${escapeAttr(imageSrc)}" alt="${setName} set image" loading="lazy" data-master-image="1"/>`
                    : '<img class="pv-masterSetCard__image" alt="" hidden data-master-image="1"/>';

                return `
                    <article class="pv-masterSetCard" data-master-set-id="${escapeAttr(expansionId)}">
                        ${imageHtml}
                        <h3 class="pv-masterSetCard__title"><a class="pv-masterSetCard__titleLink" href="${detailUrl}">${setName}</a></h3>
                        <p class="pv-masterSetCard__meta">${series || 'Series n/a'}</p>
                        <p class="pv-masterSetCard__meta" data-master-count>Collected: ${escapeHtml(countText)} cards</p>
                        <div class="pv-masterSetProgress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(ratio)}" data-master-progressbar>
                            <span style="width:${ratio}%" data-master-progress-fill></span>
                        </div>
                        <p class="pv-masterSetCard__meta" data-master-ratio>Progress: ${ratioLabel}</p>
                    </article>
                `;
            }).join('');

            grid.innerHTML = rows;
            void hydrateMasterSetCardsWithVariantProgress(entries, cardsById, grid);
        }

        if (clearBtn) {
            clearBtn.onclick = () => {
                const ok = window.confirm('Clear all master set progress?');
                if (!ok) return;
                writeMasterSets({});
                renderMasterSetsPage();
            };
        }
    }

    async function renderMasterSetDetailPage() {
        const titleEl = document.getElementById('pv-master-set-detail-title');
        const seriesEl = document.getElementById('pv-master-set-detail-series');
        const imageEl = document.getElementById('pv-master-set-detail-image');
        const countEl = document.getElementById('pv-master-set-detail-count');
        const ratioEl = document.getElementById('pv-master-set-detail-ratio');
        const progressBar = document.getElementById('pv-master-set-detail-progress');
        const progressFill = document.getElementById('pv-master-set-detail-progress-fill');
        const statusEl = document.getElementById('pv-master-set-detail-status');
        const collectedCountEl = document.getElementById('pv-master-set-collected-count');
        const missingCountEl = document.getElementById('pv-master-set-missing-count');
        const collectedListEl = document.getElementById('pv-master-set-collected-list');
        const missingListEl = document.getElementById('pv-master-set-missing-list');

        if (!titleEl || !seriesEl || !countEl || !ratioEl || !progressBar || !progressFill || !statusEl || !collectedCountEl || !missingCountEl || !collectedListEl || !missingListEl) {
            return;
        }

        const params = new URLSearchParams(window.location.search);
        const expansionId = safeString(params.get('expansionId'), '').trim();
        const expansionNameFromQuery = safeString(params.get('expansionName'), '').trim();

        if (!expansionId) {
            titleEl.textContent = expansionNameFromQuery || 'Master Set';
            statusEl.textContent = 'No set selected. Return to Master Sets and pick a set.';
            collectedListEl.innerHTML = '<div class="pv-emptyState">No set selected.</div>';
            missingListEl.innerHTML = '<div class="pv-emptyState">No set selected.</div>';
            return;
        }

        const masterMap = readMasterSets();
        const entry = masterMap[expansionId] && typeof masterMap[expansionId] === 'object'
            ? masterMap[expansionId]
            : null;

        const setName = safeString(entry?.expansionName, expansionNameFromQuery || 'Unknown Set');
        const series = safeString(entry?.series, '');
        titleEl.textContent = setName;
        seriesEl.textContent = series || 'Series n/a';
        statusEl.textContent = 'Loading set cards...';

        const collection = readCollection();
        const cardsById = buildCollectionIndexById(collection);

        try {
            const setCards = await fetchSetCardsByExpansion(expansionId);
            if (!setCards.length) {
                countEl.textContent = 'Collected: 0/0 master variants';
                ratioEl.textContent = 'Progress: 0.0%';
                progressBar.setAttribute('aria-valuenow', '0');
                progressFill.style.width = '0%';
                collectedCountEl.textContent = '0 cards';
                missingCountEl.textContent = '0 cards';
                collectedListEl.innerHTML = '<div class="pv-emptyState">No cards loaded for this set yet.</div>';
                missingListEl.innerHTML = '<div class="pv-emptyState">No missing cards to show.</div>';
                statusEl.textContent = 'Unable to load this set right now. Try again in a moment.';
                return;
            }

            const progress = computeSetVariantProgress(setCards, cardsById);
            countEl.textContent = `Collected: ${progress.collectedUnits}/${progress.requiredUnits} master variants`;
            ratioEl.textContent = `Progress: ${progress.ratioLabel}`;
            progressBar.setAttribute('aria-valuenow', String(Math.round(progress.ratio)));
            progressFill.style.width = `${progress.ratio}%`;
            collectedCountEl.textContent = `${progress.collectedCards.length} cards`;
            missingCountEl.textContent = `${progress.missingCards.length} cards`;
            collectedListEl.innerHTML = renderMasterSetDetailCards(progress.collectedCards, 'collected');
            missingListEl.innerHTML = renderMasterSetDetailCards(progress.missingCards, 'missing');

            if (imageEl instanceof HTMLImageElement) {
                const setImage = getSetImageFromData(entry, setCards, cardsById);
                if (setImage) {
                    imageEl.src = setImage;
                    imageEl.alt = `${escapeHtml(setName)} set image`;
                    imageEl.hidden = false;
                }
            }

            statusEl.textContent = `${setCards.length} card${setCards.length === 1 ? '' : 's'} loaded for this set.`;
        } catch {
            countEl.textContent = 'Collected: 0/0 master variants';
            ratioEl.textContent = 'Progress: 0.0%';
            progressBar.setAttribute('aria-valuenow', '0');
            progressFill.style.width = '0%';
            collectedCountEl.textContent = '0 cards';
            missingCountEl.textContent = '0 cards';
            collectedListEl.innerHTML = '<div class="pv-emptyState">Unable to load collected cards right now.</div>';
            missingListEl.innerHTML = '<div class="pv-emptyState">Unable to load missing cards right now.</div>';
            statusEl.textContent = 'Error loading this set. Please refresh and try again.';
        }
    }

    function renderActivePage() {
        renderCollectionPage();
        renderMasterSetsPage();
        void renderMasterSetDetailPage();
    }

    document.addEventListener('DOMContentLoaded', () => {
        renderActivePage();

        try {
            if (window?.PV_AUTH?.onAuthStateChanged && window?.PV_AUTH?.loadDexState) {
                window.PV_AUTH.onAuthStateChanged((user) => {
                    if (!user) return;
                    syncDexStateFromCloudOnSignIn();
                });
            }
        } catch {
            // ignore
        }

        window.addEventListener('storage', renderActivePage);
    });
})();

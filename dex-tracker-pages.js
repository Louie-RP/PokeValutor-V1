/* Dex Collection + Master Sets pages */
(function () {
    const CACHE_PREFIX = 'pv:scrydex:';
    const DEX_COLLECTION_KEY = `${CACHE_PREFIX}collection:v1`;
    const DEX_MASTER_SETS_KEY = `${CACHE_PREFIX}masterSets:v1`;
    const VALUE_CACHE_KEY = `${CACHE_PREFIX}collectionValueCache:v1`;
    const VALUE_CACHE_TTL_MS = 20 * 60 * 1000;
    const DEX_CONDITION_CODES = ['NM', 'LP', 'MP', 'HP', 'DM'];

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

    function getWorkerBase() {
        const defaultWorker = 'https://pokevalutor-v1.lreyperez18.workers.dev';
        return (window?.PV_SECRETS?.PV_API_URL || defaultWorker).replace(/\/$/, '');
    }

    function normalizeVariantNameForCompare(name) {
        return String(name ?? '').trim().toLowerCase();
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
        if (!list.length) {
            totalEl.textContent = 'Collection Value: $0.00';
            return;
        }

        totalEl.textContent = 'Collection Value: Loading...';

        let total = 0;
        let pricedCount = 0;

        await Promise.all(list.map(async (item) => {
            const id = safeString(item?.id, '');
            if (!id) return;

            const valueElId = `pv-collection-value-${encodeURIComponent(id)}`;
            const valueEl = document.getElementById(valueElId);
            const conditionCode = normalizeDexConditionCode(item?.selectedCondition);

            if (valueEl) {
                valueEl.textContent = conditionCode ? '...' : '--';
            }

            if (!conditionCode) return;

            const valueInfo = await getCurrentCardValue(item);
            if (!valueInfo || !Number.isFinite(valueInfo.market)) {
                if (valueEl) valueEl.textContent = '--';
                return;
            }

            pricedCount++;
            total += valueInfo.market;
            if (valueEl) {
                valueEl.textContent = formatUsd(valueInfo.market);
            }
        }));

        const coverage = pricedCount < list.length ? ` (${pricedCount}/${list.length} priced)` : '';
        totalEl.textContent = `Collection Value: ${formatUsd(total)}${coverage}`;
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

    function readCollection() {
        try {
            const raw = localStorage.getItem(DEX_COLLECTION_KEY);
            if (!raw) return [];
            const parsed = safeParseJson(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    function writeCollection(next) {
        try {
            localStorage.setItem(DEX_COLLECTION_KEY, JSON.stringify(Array.isArray(next) ? next : []));
        } catch {
            // ignore
        }
    }

    function readMasterSets() {
        try {
            const raw = localStorage.getItem(DEX_MASTER_SETS_KEY);
            if (!raw) return {};
            const parsed = safeParseJson(raw);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch {
            return {};
        }
    }

    function writeMasterSets(next) {
        try {
            const safe = (next && typeof next === 'object') ? next : {};
            localStorage.setItem(DEX_MASTER_SETS_KEY, JSON.stringify(safe));
        } catch {
            // ignore
        }
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

    function formatDate(ts) {
        const n = Number(ts);
        if (!Number.isFinite(n) || n <= 0) return '';
        try {
            return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: '2-digit' }).format(new Date(n));
        } catch {
            return '';
        }
    }

    function renderCollectionPage() {
        const grid = document.getElementById('pv-collection-grid');
        const summary = document.getElementById('pv-collection-summary');
        const totalEl = document.getElementById('pv-collection-total');
        const clearBtn = document.getElementById('pv-collection-clear');
        if (!grid || !summary || !totalEl) return;

        const items = readCollection().slice().sort((a, b) => Number(b?.addedAt || 0) - Number(a?.addedAt || 0));
        summary.textContent = `${items.length} card${items.length === 1 ? '' : 's'} tracked in your collection.`;

        if (!items.length) {
            totalEl.textContent = 'Collection Value: $0.00';
            grid.innerHTML = '<div class="col-12"><div class="pv-emptyState">No cards tracked yet. Open Dex, browse a set, and press + on cards you own.</div></div>';
        } else {
            const rows = items.map((item) => {
                const id = safeString(item?.id, '');
                const name = escapeHtml(safeString(item?.name, 'Unknown'));
                const setName = escapeHtml(getCardSetName(item));
                const rarity = escapeHtml(safeString(item?.rarity, 'n/a'));
                const conditionCode = normalizeDexConditionCode(item?.selectedCondition);
                const img = escapeHtml(pickFrontMediumImage(item?.images));
                const valueElId = `pv-collection-value-${encodeURIComponent(id)}`;
                const conditionOptions = buildConditionOptionsHtml(conditionCode);

                return `
                    <div class="col-12 col-sm-6 col-md-4 col-lg-3">
                        <article class="pv-card h-100" aria-label="${name}">
                            ${img ? `<img class="pv-card__img" src="${img}" alt="${name} card image"/>` : ''}
                            <div class="pv-card__body">
                                <h3 class="pv-card__title">${name}</h3>
                                <p class="pv-card__text">${setName}</p>
                                <p class="pv-card__text">${rarity}</p>
                                <p class="pv-collectionAmount" id="${escapeAttr(valueElId)}">${conditionCode ? '...' : '--'}</p>
                                <select class="form-select pv-conditionSelect" data-condition-card-id="${escapeAttr(id)}" aria-label="Update condition for ${name}">
                                    ${conditionOptions}
                                </select>
                                <button class="pv-button btn pv-removeCardBtn" type="button" data-remove-card-id="${escapeHtml(id)}">Remove Card</button>
                            </div>
                        </article>
                    </div>
                `;
            }).join('');

            grid.innerHTML = rows;

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

            const conditionSelects = Array.from(grid.querySelectorAll('[data-condition-card-id]'));
            for (const sel of conditionSelects) {
                sel.addEventListener('change', () => {
                    const cardId = safeString(sel.getAttribute('data-condition-card-id'), '');
                    if (!cardId) return;

                    const nextCondition = normalizeDexConditionCode(sel.value);
                    const current = readCollection();
                    const updated = current.map((entry) => {
                        if (safeString(entry?.id, '') !== cardId) return entry;
                        return {
                            ...entry,
                            selectedCondition: nextCondition,
                            updatedAt: Date.now(),
                        };
                    });
                    writeCollection(updated);

                    for (const item of items) {
                        if (safeString(item?.id, '') !== cardId) continue;
                        item.selectedCondition = nextCondition;
                        item.updatedAt = Date.now();
                        break;
                    }

                    void refreshCollectionValues(items, totalEl);
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
            /** @type {Record<string, any>} */
            const cardsById = {};
            for (const item of collection) {
                const id = safeString(item?.id, '');
                if (!id) continue;
                cardsById[id] = item;
            }

            const rows = entries.map((entry) => {
                const setName = escapeHtml(safeString(entry?.expansionName, 'Unknown Set'));
                const series = escapeHtml(safeString(entry?.series, ''));
                const count = Number(entry?.count || (Array.isArray(entry?.cardIds) ? entry.cardIds.length : 0) || 0);
                const target = Number(entry?.targetCount || 0);
                const ratio = target > 0 ? Math.min(100, (count / target) * 100) : 0;
                const ratioLabel = ratio >= 10 ? `${Math.round(ratio)}%` : `${ratio.toFixed(1)}%`;
                const updated = escapeHtml(formatDate(entry?.updatedAt));
                const countText = target > 0 ? `${count}/${target}` : `${count}`;
                const cardIds = Array.isArray(entry?.cardIds)
                    ? entry.cardIds.map((x) => safeString(x, '')).filter(Boolean)
                    : [];

                const cardListHtml = cardIds.length
                    ? `<ul class="pv-masterSetCardList">${cardIds.map((id) => {
                        const card = cardsById[id];
                        const label = card
                            ? `${safeString(card?.name, 'Unknown')} • ${safeString(card?.selectedVariant, 'Type n/a')} • ${getConditionLabel(card?.selectedCondition)} (${getCardSetName(card)})`
                            : id;
                        return `<li class="pv-masterSetCardList__item"><span>${escapeHtml(label)}</span><button class="pv-button btn pv-removeCardBtn pv-removeCardBtn--small" type="button" data-remove-card-id="${escapeHtml(id)}">Remove</button></li>`;
                    }).join('')}</ul>`
                    : '<p class="pv-masterSetCard__meta">No tracked cards in this set.</p>';

                return `
                    <article class="pv-masterSetCard">
                        <h3 class="pv-masterSetCard__title">${setName}</h3>
                        <p class="pv-masterSetCard__meta">${series || 'Series n/a'}</p>
                        <p class="pv-masterSetCard__meta">Collected: ${escapeHtml(countText)} cards</p>
                        <div class="pv-masterSetProgress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(ratio)}">
                            <span style="width:${ratio}%"></span>
                        </div>
                        <p class="pv-masterSetCard__meta">Progress: ${ratioLabel}</p>
                        <p class="pv-masterSetCard__meta">Updated: ${updated || 'n/a'}</p>
                        ${cardListHtml}
                    </article>
                `;
            }).join('');

            grid.innerHTML = rows;

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

    function renderActivePage() {
        renderCollectionPage();
        renderMasterSetsPage();
    }

    document.addEventListener('DOMContentLoaded', () => {
        renderActivePage();
        window.addEventListener('storage', renderActivePage);
    });
})();

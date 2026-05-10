/* Dex Collection + Master Sets pages */
(function () {
    const CACHE_PREFIX = 'pv:scrydex:';
    const DEX_COLLECTION_KEY = `${CACHE_PREFIX}collection:v1`;
    const DEX_MASTER_SETS_KEY = `${CACHE_PREFIX}masterSets:v1`;

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
        const clearBtn = document.getElementById('pv-collection-clear');
        if (!grid || !summary) return;

        const items = readCollection().slice().sort((a, b) => Number(b?.addedAt || 0) - Number(a?.addedAt || 0));
        summary.textContent = `${items.length} card${items.length === 1 ? '' : 's'} tracked in your collection.`;

        if (!items.length) {
            grid.innerHTML = '<div class="col-12"><div class="pv-emptyState">No cards tracked yet. Open Dex, browse a set, and press + on cards you own.</div></div>';
        } else {
            const rows = items.map((item) => {
                const id = safeString(item?.id, '');
                const name = escapeHtml(safeString(item?.name, 'Unknown'));
                const rarity = escapeHtml(safeString(item?.rarity, 'n/a'));
                const setName = escapeHtml(getCardSetName(item));
                const addedAt = escapeHtml(formatDate(item?.addedAt));
                const img = escapeHtml(pickFrontMediumImage(item?.images));

                return `
                    <div class="col-12 col-sm-6 col-md-4 col-lg-3">
                        <article class="pv-card h-100" aria-label="${name}">
                            ${img ? `<img class="pv-card__img" src="${img}" alt="${name} card image"/>` : ''}
                            <div class="pv-card__body">
                                <h3 class="pv-card__title">${name}</h3>
                                <p class="pv-card__text">Set: ${setName}</p>
                                <p class="pv-card__text">Rarity: ${rarity}</p>
                                <p class="pv-card__text">Card ID: ${escapeHtml(id || 'n/a')}</p>
                                <p class="pv-card__text">Added: ${addedAt || 'n/a'}</p>
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
                            ? `${safeString(card?.name, 'Unknown')} (${getCardSetName(card)})`
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

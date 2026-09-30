import { buildGuideOwnershipIndex } from './master-set-guide-model.mjs';
import { initBinderExport } from './master-set-guide-export.mjs?v=2026-09-29-pdf-3';

(function () {
    const COLLECTION_KEY = 'pv:scrydex:collection:v1';
    const PREFERENCES_KEY = 'pv:masterSetGuide:preferences:v1';
    const LAYOUTS = Object.freeze({
        '3x3': { columns: 3, pageSize: 9 },
        '4x3': { columns: 4, pageSize: 12 },
        '4x4': { columns: 4, pageSize: 16 },
    });
    const ALLOWED_VARIANTS = Object.freeze([
        'normal',
        'reverseHolofoil',
        'energyReverseHolofoil',
        'pokeBallReverseHolofoil',
        'rocketReverseHolofoil',
        'quickBallReverseHolofoil',
        'duskBallReverseHolofoil',
        'loveBallReverseHolofoil',
        'friendBallReverseHolofoil',
        'cosmosHolofoil',
        'holofoil',
    ]);

    const elements = {
        title: document.getElementById('pv-guide-title'),
        subtitle: document.getElementById('pv-guide-subtitle'),
        backLink: document.getElementById('pv-guide-back-link'),
        layout: document.getElementById('pv-guide-layout'),
        search: document.getElementById('pv-guide-search'),
        ownedFilter: document.getElementById('pv-guide-owned-filter'),
        status: document.getElementById('pv-guide-status'),
        summary: document.getElementById('pv-guide-page-summary'),
        grid: document.getElementById('pv-guide-grid'),
        first: document.getElementById('pv-guide-first'),
        previous: document.getElementById('pv-guide-previous'),
        pagerLabel: document.getElementById('pv-guide-pager-label'),
        next: document.getElementById('pv-guide-next'),
        last: document.getElementById('pv-guide-last'),
        dialog: document.getElementById('pv-guide-card-dialog'),
        dialogClose: document.getElementById('pv-guide-dialog-close'),
        dialogImage: document.getElementById('pv-guide-dialog-image'),
        dialogVariant: document.getElementById('pv-guide-dialog-variant'),
        dialogTitle: document.getElementById('pv-guide-dialog-title'),
        dialogNumber: document.getElementById('pv-guide-dialog-number'),
        dialogRarity: document.getElementById('pv-guide-dialog-rarity'),
        dialogOwned: document.getElementById('pv-guide-dialog-owned'),
        catalog: document.getElementById('pv-guide-catalog'),
        catalogFilter: document.getElementById('pv-guide-catalog-filter'),
        catalogStatus: document.getElementById('pv-guide-catalog-status'),
        catalogGrid: document.getElementById('pv-guide-catalog-grid'),
        builderControls: document.getElementById('pv-guide-builder-controls'),
        builderView: document.getElementById('pv-guide-builder-view'),
    };
    const variantInputs = Array.from(document.querySelectorAll('[data-guide-variant]'))
        .filter((input) => input instanceof HTMLInputElement);
    const state = {
        manifest: null,
        cardsById: new Map(),
        ownedVariantsByCardId: new Map(),
        filteredSlots: [],
        guideEntries: [],
        page: 1,
        dialogImageRequestId: 0,
    };

    function safeString(value) {
        return String(value ?? '').trim();
    }

    function parseJson(value, fallback) {
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    }

    function normalizeVariant(value) {
        const normalized = safeString(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
        return normalized === 'standard' ? 'normal' : normalized;
    }

    function normalizeSearch(value) {
        return safeString(value)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    function getSafeImageUrl(value) {
        const raw = safeString(value);
        if (!raw) return '';
        try {
            const url = new URL(raw, window.location.href);
            if (url.protocol === 'https:') return url.href;
            if (url.origin === window.location.origin && url.protocol === window.location.protocol) return url.href;
        } catch {
            return '';
        }
        return '';
    }

    function setImage(image, rawUrl, alt) {
        if (!(image instanceof HTMLImageElement)) return false;
        const safeUrl = getSafeImageUrl(rawUrl);
        if (!safeUrl) {
            image.removeAttribute('src');
            image.alt = '';
            image.hidden = true;
            return false;
        }
        image.src = safeUrl;
        image.alt = safeString(alt);
        image.hidden = false;
        return true;
    }

    function readPreferences() {
        try {
            const raw = localStorage.getItem(PREFERENCES_KEY);
            const parsed = parseJson(raw, {});
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }

    function savePreferences() {
        try {
            const enabledVariants = variantInputs.filter((input) => input.checked).map((input) => input.value);
            const layout = LAYOUTS[elements.layout?.value] ? elements.layout.value : '3x3';
            localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ layout, enabledVariants }));
        } catch {
            // Preferences are optional; the guide remains usable if storage is unavailable.
        }
    }

    function applyPreferences() {
        const preferences = readPreferences();
        if (elements.layout instanceof HTMLSelectElement && LAYOUTS[preferences.layout]) {
            elements.layout.value = preferences.layout;
        }
        if (Array.isArray(preferences.enabledVariants)) {
            const enabled = new Set(preferences.enabledVariants.map(normalizeVariant));
            variantInputs.forEach((input) => {
                input.checked = enabled.has(normalizeVariant(input.value));
            });
        }
        updateVariantDisclosureState();
    }

    function updateVariantDisclosureState() {
        document.querySelectorAll('[data-guide-variant-disclosure]').forEach((disclosure) => {
            const inputs = Array.from(disclosure.querySelectorAll('[data-guide-variant]'))
                .filter((input) => input instanceof HTMLInputElement);
            const checkedCount = inputs.filter((input) => input.checked).length;
            const state = checkedCount === 0
                ? 'empty'
                : checkedCount === inputs.length
                    ? 'selected'
                    : 'partial';
            disclosure.dataset.variantState = state;
            const stateElement = disclosure.querySelector('[data-guide-variant-state]');
            if (stateElement) stateElement.textContent = state === 'selected' ? '✓' : state === 'partial' ? '−' : '';
        });
    }

    function getOwnedVariantIndex() {
        return getCollectionSnapshot().ownedIndex;
    }

    function getCollectionSnapshot() {
        let ownershipKnown = false;
        let ownedIndex = new Map();
        try {
            const raw = localStorage.getItem(COLLECTION_KEY);
            const parsed = raw === null ? null : parseJson(raw, null);
            const ownerId = safeString(localStorage.getItem('pv:scrydex:dexOwnerUid:v1'));
            const userId = safeString(window.PV_AUTH?.getUser?.()?.uid);
            ownershipKnown = Array.isArray(parsed) && (ownerId ? ownerId === userId : !userId);
            if (ownershipKnown) ownedIndex = buildGuideOwnershipIndex(parsed);
        } catch { /* Full-plan export still works when collection storage is unavailable. */ }
        return { ownershipKnown, ownedIndex };
    }

    function getExportSnapshot() {
        const { ownershipKnown, ownedIndex } = getCollectionSnapshot();
        const ownershipChanged = ownedIndex.size !== state.ownedVariantsByCardId.size
            || Array.from(ownedIndex).some(([id, variants]) => {
                const previous = state.ownedVariantsByCardId.get(id);
                return !previous || variants.size !== previous.size || Array.from(variants).some(variant => !previous.has(variant));
            });
        state.ownedVariantsByCardId = ownedIndex;
        if (ownershipChanged) render();
        return {
            manifest: state.manifest,
            ownedIndex,
            ownershipKnown,
            layout: LAYOUTS[elements.layout?.value] ? elements.layout.value : '3x3',
            enabledVariants: variantInputs.filter(input => input.checked).map(input => input.value),
        };
    }

    function isSlotOwned(slot) {
        const variants = state.ownedVariantsByCardId.get(safeString(slot?.cardId));
        return variants instanceof Set && variants.has(normalizeVariant(slot?.variant));
    }

    function getCard(slot) {
        return state.cardsById.get(safeString(slot?.cardId)) || null;
    }

    function getEnabledVariants() {
        return new Set(
            variantInputs
                .filter((input) => input.checked)
                .map((input) => normalizeVariant(input.value)),
        );
    }

    function getFilteredSlots() {
        const slots = Array.isArray(state.manifest?.slots) ? state.manifest.slots : [];
        const enabledVariants = getEnabledVariants();
        const query = normalizeSearch(elements.search?.value);
        const ownedFilter = safeString(elements.ownedFilter?.value) || 'all';

        return slots.filter((slot) => {
            if (!enabledVariants.has(normalizeVariant(slot?.variant))) return false;
            const owned = isSlotOwned(slot);
            if (ownedFilter === 'owned' && !owned) return false;
            if (ownedFilter === 'missing' && owned) return false;
            if (!query) return true;

            const card = getCard(slot);
            const haystack = normalizeSearch([
                card?.name,
                card?.number,
                card?.printedNumber,
                card?.rarity,
                slot?.label,
            ].map(safeString).join(' '));
            return haystack.includes(query);
        });
    }

    function getLayout() {
        const key = safeString(elements.layout?.value);
        return LAYOUTS[key] || LAYOUTS['3x3'];
    }

    function createTextElement(tagName, className, text) {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        element.textContent = safeString(text);
        return element;
    }

    function parseGuideReleaseDate(value) {
        const raw = safeString(value);
        if (!raw) return 0;
        const normalized = raw.replace(/^(\d{4})\/(\d{2})\/(\d{2})$/, '$1-$2-$3');
        const timestamp = Date.parse(`${normalized}T00:00:00Z`);
        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    function normalizeGuideEntry(entry) {
        const expansionId = safeString(entry?.expansionId);
        const name = safeString(entry?.name);
        if (!/^[a-zA-Z0-9._-]+$/.test(expansionId) || !name) return null;
        const cardRecords = Number(entry?.cardRecords);
        const binderSlots = Number(entry?.binderSlots);
        return {
            expansionId,
            name,
            series: safeString(entry?.series) || 'Other',
            logo: safeString(entry?.logo),
            releaseDate: safeString(entry?.releaseDate),
            releaseTimestamp: parseGuideReleaseDate(entry?.releaseDate),
            cardRecords: Number.isFinite(cardRecords) && cardRecords > 0 ? Math.floor(cardRecords) : 0,
            binderSlots: Number.isFinite(binderSlots) && binderSlots > 0 ? Math.floor(binderSlots) : 0,
        };
    }

    function sortGuideEntries(entries) {
        return entries.slice().sort((left, right) => {
            const releaseDiff = right.releaseTimestamp - left.releaseTimestamp;
            if (releaseDiff !== 0) return releaseDiff;
            const seriesDiff = left.series.localeCompare(right.series);
            return seriesDiff || left.name.localeCompare(right.name);
        });
    }

    function buildGuideUrl(entry) {
        const params = new URLSearchParams();
        params.set('expansionId', entry.expansionId);
        params.set('expansionName', entry.name);
        return `master-set-guide.html?${params.toString()}`;
    }

    function createGuideCatalogCard(entry) {
        const link = document.createElement('a');
        link.className = 'pv-guideCatalog__card';
        link.href = buildGuideUrl(entry);
        link.setAttribute('aria-label', `Build a binder for ${entry.name}`);
        const logoWrap = document.createElement('div');
        logoWrap.className = 'pv-guideCatalog__logo';
        const logo = document.createElement('img');
        logo.loading = 'lazy';
        logo.decoding = 'async';
        setImage(logo, entry.logo, `${entry.name} logo`);
        logoWrap.append(logo);
        link.append(
            logoWrap,
            createTextElement('h3', 'pv-guideCatalog__name', entry.name),
            createTextElement('p', 'pv-guideCatalog__meta', entry.binderSlots ? `${entry.binderSlots} binder slots` : 'Binder guide ready'),
            createTextElement('p', 'pv-guideCatalog__date', entry.releaseDate || 'Release date unavailable'),
            createTextElement('span', 'pv-guideCatalog__action', 'Open binder builder'),
        );
        return link;
    }

    function renderGuideCatalog() {
        if (!(elements.catalogGrid instanceof HTMLElement)) return;
        const query = normalizeSearch(elements.catalogFilter?.value);
        const filtered = state.guideEntries.filter((entry) => !query
            || normalizeSearch(`${entry.name} ${entry.series}`).includes(query));
        const groups = new Map();
        filtered.forEach((entry) => {
            const group = groups.get(entry.series) || [];
            group.push(entry);
            groups.set(entry.series, group);
        });

        const sections = [...groups.entries()].map(([series, entries]) => {
            const section = document.createElement('details');
            section.className = 'pv-guideCatalog__series';
            section.open = true;
            const heading = createTextElement('summary', 'pv-guideCatalog__seriesTitle', series);
            const grid = document.createElement('div');
            grid.className = 'pv-guideCatalog__grid';
            entries.forEach((entry) => grid.append(createGuideCatalogCard(entry)));
            section.append(heading, grid);
            return section;
        });

        elements.catalogGrid.replaceChildren(...sections);
        if (!sections.length) elements.catalogGrid.append(createTextElement('p', 'pv-guideEmpty', 'No binder guides match your search.'));
        if (elements.catalogStatus) {
            elements.catalogStatus.textContent = `${filtered.length} binder guide${filtered.length === 1 ? '' : 's'} available.`;
        }
    }

    function setGuideViewMode(showBuilder) {
        if (elements.catalog) elements.catalog.hidden = showBuilder;
        if (elements.builderControls) elements.builderControls.hidden = !showBuilder;
        if (elements.builderView) elements.builderView.hidden = !showBuilder;
    }

    async function loadGuideCatalog() {
        setGuideViewMode(false);
        if (elements.title) elements.title.textContent = 'Binder Builder';
        if (elements.subtitle) elements.subtitle.textContent = 'Choose a set to plan its binder layout.';
        document.title = 'Binder Builder | PokeValutor';
        if (elements.backLink instanceof HTMLAnchorElement) {
            elements.backLink.href = 'master-set-guide.html';
            elements.backLink.textContent = '← Back to Master Set Guide';
        }
        if (elements.catalogStatus) elements.catalogStatus.textContent = 'Loading available binder guides...';
        try {
            const response = await fetch('data/master-set-guides/index.json');
            if (!response.ok) throw new Error('Binder guide catalog unavailable.');
            const index = await response.json();
            state.guideEntries = sortGuideEntries(
                (Array.isArray(index?.guides) ? index.guides : [])
                    .map(normalizeGuideEntry)
                    .filter(Boolean),
            );
            if (elements.catalogFilter instanceof HTMLInputElement
                && elements.catalogFilter.getAttribute('data-bound') !== '1') {
                elements.catalogFilter.setAttribute('data-bound', '1');
                elements.catalogFilter.addEventListener('input', renderGuideCatalog);
            }
            renderGuideCatalog();
        } catch {
            state.guideEntries = [];
            if (elements.catalogStatus) elements.catalogStatus.textContent = 'Binder guides are temporarily unavailable.';
            if (elements.catalogGrid) elements.catalogGrid.replaceChildren(createTextElement('p', 'pv-guideEmpty', 'Try again later.'));
        }
    }

    function openCardDialog(slot, card) {
        if (!(elements.dialog instanceof HTMLDialogElement)) return;
        const requestId = ++state.dialogImageRequestId;
        const cardName = safeString(card?.name) || 'Unknown Card';
        const imageAlt = `${cardName} ${safeString(slot?.label)} card image`;
        const largeImageUrl = slot?.images?.large
            || card?.images?.large;
        const previewImageUrl = slot?.images?.medium
            || slot?.images?.small
            || card?.images?.medium
            || card?.images?.small
            || largeImageUrl;
        const safeLargeImageUrl = getSafeImageUrl(largeImageUrl);
        const safePreviewImageUrl = getSafeImageUrl(previewImageUrl);
        setImage(elements.dialogImage, safePreviewImageUrl || safeLargeImageUrl, imageAlt);
        elements.dialogVariant.textContent = safeString(slot?.label) || safeString(slot?.variant);
        elements.dialogTitle.textContent = cardName;
        elements.dialogNumber.textContent = safeString(card?.printedNumber || card?.number)
            ? `Card ${safeString(card?.printedNumber || card?.number)}`
            : 'Card number unavailable';
        elements.dialogRarity.textContent = safeString(card?.rarity) || 'Rarity unavailable';
        elements.dialogOwned.textContent = isSlotOwned(slot) ? 'Owned in Default Collection' : 'Missing from Default Collection';
        if (!elements.dialog.open) elements.dialog.showModal();

        if (safeLargeImageUrl && safeLargeImageUrl !== safePreviewImageUrl) {
            const preload = document.createElement('img');
            preload.decoding = 'async';
            preload.onload = () => {
                if (requestId === state.dialogImageRequestId) setImage(elements.dialogImage, safeLargeImageUrl, imageAlt);
            };
            preload.src = safeLargeImageUrl;
        }
    }

    function createSlot(slot) {
        const card = getCard(slot);
        const cardName = safeString(card?.name) || 'Unknown Card';
        const owned = isSlotOwned(slot);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pv-guideSlot';
        button.setAttribute('aria-label', `${cardName}, ${safeString(slot?.label)}, ${owned ? 'owned' : 'missing'}`);

        const imageWrap = document.createElement('span');
        imageWrap.className = 'pv-guideSlot__imageWrap';
        const image = document.createElement('img');
        image.className = 'pv-guideSlot__image';
        image.loading = 'lazy';
        image.decoding = 'async';
        const imageUrl = slot?.images?.medium
            || slot?.images?.large
            || slot?.images?.small
            || card?.images?.medium
            || card?.images?.large
            || card?.images?.small;
        if (setImage(image, imageUrl, `${cardName} ${safeString(slot?.label)} card image`)) {
            imageWrap.append(image);
        } else {
            imageWrap.append(createTextElement('span', 'pv-guideSlot__placeholder', 'Image unavailable'));
        }

        if (owned) imageWrap.append(createTextElement('span', 'pv-guideSlot__owned', 'Owned'));
        button.append(imageWrap);
        button.append(createTextElement('span', 'pv-guideSlot__name', cardName));
        button.append(createTextElement('span', 'pv-guideSlot__variant', safeString(slot?.label) || safeString(slot?.variant)));
        button.addEventListener('click', () => openCardDialog(slot, card));
        return button;
    }

    function render() {
        if (!state.manifest || !(elements.grid instanceof HTMLElement)) return;
        state.filteredSlots = getFilteredSlots();
        const layout = getLayout();
        const totalPages = Math.max(1, Math.ceil(state.filteredSlots.length / layout.pageSize));
        state.page = Math.min(Math.max(1, state.page), totalPages);
        const start = (state.page - 1) * layout.pageSize;
        const visibleSlots = state.filteredSlots.slice(start, start + layout.pageSize);
        elements.grid.dataset.columns = String(layout.columns);

        const nodes = visibleSlots.map(createSlot);
        if (nodes.length === 0) {
            nodes.push(createTextElement('p', 'pv-guideEmpty', 'No binder slots match the selected filters.'));
        }
        elements.grid.replaceChildren(...nodes);

        const ownedCount = state.filteredSlots.filter(isSlotOwned).length;
        if (elements.summary) {
            elements.summary.textContent = `${state.filteredSlots.length} slots • ${ownedCount} owned`;
        }
        if (elements.pagerLabel) {
            elements.pagerLabel.textContent = `Page ${state.page} of ${totalPages}`;
        }
        if (elements.status) {
            elements.status.textContent = `${state.manifest.stats?.binderSlots || state.manifest.slots.length} total binder slots loaded.`;
        }

        [elements.first, elements.previous].forEach((button) => {
            if (button instanceof HTMLButtonElement) button.disabled = state.page <= 1;
        });
        [elements.next, elements.last].forEach((button) => {
            if (button instanceof HTMLButtonElement) button.disabled = state.page >= totalPages;
        });
    }

    function handleFilterChange() {
        state.page = 1;
        updateVariantDisclosureState();
        savePreferences();
        render();
    }

    function bindControls() {
        elements.layout?.addEventListener('change', handleFilterChange);
        elements.search?.addEventListener('input', handleFilterChange);
        elements.ownedFilter?.addEventListener('change', handleFilterChange);
        variantInputs.forEach((input) => input.addEventListener('change', handleFilterChange));
        elements.first?.addEventListener('click', () => {
            state.page = 1;
            render();
        });
        elements.previous?.addEventListener('click', () => {
            state.page -= 1;
            render();
        });
        elements.next?.addEventListener('click', () => {
            state.page += 1;
            render();
        });
        elements.last?.addEventListener('click', () => {
            state.page = Math.max(1, Math.ceil(state.filteredSlots.length / getLayout().pageSize));
            render();
        });
        elements.dialogClose?.addEventListener('click', () => elements.dialog?.close());
        elements.dialog?.addEventListener('click', (event) => {
            if (event.target === elements.dialog) elements.dialog.close();
        });
        window.addEventListener('storage', (event) => {
            if (event.key !== COLLECTION_KEY && event.key !== null && event.key !== 'pv:scrydex:dexOwnerUid:v1') return;
            state.ownedVariantsByCardId = getOwnedVariantIndex();
            render();
        });
        const refreshOwnership = () => {
            state.ownedVariantsByCardId = getOwnedVariantIndex();
            render();
        };
        window.addEventListener('pv:dex-state-changed', refreshOwnership);
        window.PV_AUTH?.onAuthStateChanged?.(refreshOwnership);
    }

    function validateManifest(manifest, requestedExpansionId) {
        if (!manifest || typeof manifest !== 'object') return false;
        if (Number(manifest.schemaVersion) !== 1) return false;
        if (safeString(manifest?.expansion?.id) !== requestedExpansionId) return false;
        if (!Array.isArray(manifest.cards) || !Array.isArray(manifest.slots)) return false;
        return manifest.slots.every((slot) => ALLOWED_VARIANTS.includes(safeString(slot?.variant)));
    }

    async function loadGuide() {
        applyPreferences();
        bindControls();

        const params = new URLSearchParams(window.location.search);
        const expansionId = safeString(params.get('expansionId'));
        const expansionName = safeString(params.get('expansionName'));
        if (!/^[a-zA-Z0-9._-]+$/.test(expansionId)) {
            await loadGuideCatalog();
            return;
        }

        setGuideViewMode(true);

        if (elements.backLink instanceof HTMLAnchorElement) {
            elements.backLink.href = 'master-set-guide.html';
            elements.backLink.textContent = '← Back to Master Set Guide';
        }

        const response = await fetch(`data/master-set-guides/${encodeURIComponent(expansionId)}.json`);
        if (!response.ok) throw new Error('This binder guide has not been generated yet.');
        const manifest = await response.json();
        if (!validateManifest(manifest, expansionId)) throw new Error('The binder guide data is invalid or unsupported.');

        state.manifest = manifest;
        state.cardsById = new Map(manifest.cards.map((card) => [safeString(card?.id), card]));
        state.ownedVariantsByCardId = getOwnedVariantIndex();
        const setName = safeString(manifest?.expansion?.name) || expansionName || expansionId;
        if (elements.title) elements.title.textContent = `${setName} Binder Guide`;
        if (elements.subtitle) elements.subtitle.textContent = '';
        document.title = `${setName} Binder Guide | PokeValutor`;
        render();
        initBinderExport({ getSnapshot: getExportSnapshot });
    }

    loadGuide().catch((error) => {
        const message = error instanceof Error ? error.message : 'Unable to load this binder guide.';
        if (elements.status) elements.status.textContent = message;
        if (elements.subtitle) elements.subtitle.textContent = 'Guide unavailable';
        if (elements.grid) {
            elements.grid.replaceChildren(createTextElement('p', 'pv-guideEmpty', message));
        }
    });
})();

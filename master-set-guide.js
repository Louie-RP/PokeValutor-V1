(function () {
    const COLLECTION_KEY = 'pv:scrydex:collection:v1';
    const PREFERENCES_KEY = 'pv:masterSetGuide:preferences:v1';
    const DEFAULT_COLLECTION_ID = 'default';
    const LAYOUTS = Object.freeze({
        '3x3': { columns: 3, pageSize: 9 },
        '4x3': { columns: 4, pageSize: 12 },
        '4x4': { columns: 4, pageSize: 16 },
    });
<<<<<<< HEAD
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
=======
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
>>>>>>> 04338dd901de0badef95db87874d087048c7de6d

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
    };
    const variantInputs = Array.from(document.querySelectorAll('[data-guide-variant]'))
        .filter((input) => input instanceof HTMLInputElement);
    const state = {
        manifest: null,
        cardsById: new Map(),
        ownedVariantsByCardId: new Map(),
        filteredSlots: [],
        page: 1,
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
    }

    function getOwnedVariantIndex() {
        const index = new Map();
        let collection = [];
        try {
            collection = parseJson(localStorage.getItem(COLLECTION_KEY), []);
        } catch {
            collection = [];
        }
        if (!Array.isArray(collection)) return index;

        for (const item of collection) {
            if (!item || typeof item !== 'object') continue;
            const itemType = safeString(item.itemType).toLowerCase();
            const collectionId = safeString(item.collectionId) || DEFAULT_COLLECTION_ID;
            const cardId = safeString(item.id);
            if ((itemType && itemType !== 'card') || collectionId !== DEFAULT_COLLECTION_ID || !cardId) continue;

            const variants = index.get(cardId) || new Set();
            const variantQuantities = item.variantQuantities && typeof item.variantQuantities === 'object'
                ? item.variantQuantities
                : {};
            for (const [variant, quantity] of Object.entries(variantQuantities)) {
                if (Math.floor(Number(quantity)) <= 0) continue;
                const normalized = normalizeVariant(variant);
                if (normalized) variants.add(normalized);
            }

            if (variants.size === 0 && safeString(item.selectedVariant)) {
                variants.add(normalizeVariant(item.selectedVariant));
            }
            index.set(cardId, variants);
        }

        return index;
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

    function openCardDialog(slot, card) {
        if (!(elements.dialog instanceof HTMLDialogElement)) return;
        const cardName = safeString(card?.name) || 'Unknown Card';
<<<<<<< HEAD
        const imageUrl = slot?.images?.large || slot?.images?.medium || slot?.images?.small
            || card?.images?.large || card?.images?.medium || card?.images?.small;
=======
        const imageUrl = slot?.images?.large
            || slot?.images?.medium
            || slot?.images?.small
            || card?.images?.large
            || card?.images?.medium
            || card?.images?.small;
>>>>>>> 04338dd901de0badef95db87874d087048c7de6d
        setImage(elements.dialogImage, imageUrl, `${cardName} ${safeString(slot?.label)} card image`);
        elements.dialogVariant.textContent = safeString(slot?.label) || safeString(slot?.variant);
        elements.dialogTitle.textContent = cardName;
        elements.dialogNumber.textContent = safeString(card?.printedNumber || card?.number)
            ? `Card ${safeString(card?.printedNumber || card?.number)}`
            : 'Card number unavailable';
        elements.dialogRarity.textContent = safeString(card?.rarity) || 'Rarity unavailable';
        elements.dialogOwned.textContent = isSlotOwned(slot) ? 'Owned in Default Collection' : 'Missing from Default Collection';
        if (!elements.dialog.open) elements.dialog.showModal();
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
<<<<<<< HEAD
        const imageUrl = slot?.images?.medium || slot?.images?.large || slot?.images?.small
            || card?.images?.medium || card?.images?.large || card?.images?.small;
=======
        const imageUrl = slot?.images?.medium
            || slot?.images?.large
            || slot?.images?.small
            || card?.images?.medium
            || card?.images?.large
            || card?.images?.small;
>>>>>>> 04338dd901de0badef95db87874d087048c7de6d
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
            elements.summary.textContent = `${state.filteredSlots.length} slots • ${ownedCount} owned • Page ${state.page} of ${totalPages}`;
        }
        if (elements.status) {
            elements.status.textContent = `${state.manifest.stats?.binderSlots || state.manifest.slots.length} total binder slots loaded. Pricing is not included.`;
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
            if (event.key !== COLLECTION_KEY) return;
            state.ownedVariantsByCardId = getOwnedVariantIndex();
            render();
        });
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
            throw new Error('Choose a supported set from the Master Sets page.');
        }

        if (elements.backLink instanceof HTMLAnchorElement) {
            const backParams = new URLSearchParams();
            backParams.set('expansionId', expansionId);
            if (expansionName) backParams.set('expansionName', expansionName);
            elements.backLink.href = `master-set.html?${backParams.toString()}`;
            elements.backLink.textContent = '← Back to Master Set';
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
        if (elements.subtitle) {
            const series = safeString(manifest?.expansion?.series);
            elements.subtitle.textContent = series
                ? `${series} • Organize every supported card variant.`
                : 'Organize every supported card variant.';
        }
        document.title = `${setName} Binder Guide | PokeValutor`;
        render();
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

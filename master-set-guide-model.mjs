import { isGuideVariant, getGuideVariantOptions } from './master-set-guide-variants.mjs?v=2026-09-30-variants-1';
export { isGuideVariant, getGuideVariantOptions };

export { GUIDE_VARIANTS } from './master-set-guide-variants.mjs?v=2026-09-30-variants-1';

export const BINDER_LAYOUTS = Object.freeze({
    '3x3': Object.freeze({ columns: 3, rows: 3, pageSize: 9 }),
    '4x3': Object.freeze({ columns: 4, rows: 3, pageSize: 12 }),
    '4x4': Object.freeze({ columns: 4, rows: 4, pageSize: 16 }),
});

export const PAPER_PRESETS = Object.freeze({
    letter9: Object.freeze({ width: 612, height: 792, columns: 3, rows: 3, capacity: 9 }),
    letter6: Object.freeze({ width: 612, height: 792, columns: 3, rows: 2, capacity: 6 }),
});
export const INSERT_WIDTH = 180;
export const INSERT_HEIGHT = 252;

export function cleanText(value, maxLength = 160) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

export function normalizeGuideVariant(value) {
    const key = cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
    return key === 'standard' ? 'normal' : key;
}

export function normalizeGuideSearch(value) {
    return cleanText(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ').trim();
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getGuideVariantSelection(manifest, preferences = {}) {
    const options = getGuideVariantOptions(manifest);
    const saved = isRecord(preferences?.variantSelections) ? preferences.variantSelections[manifest?.expansion?.id] : null;
    if (!isRecord(saved) || !Array.isArray(saved.availableVariants) || !Array.isArray(saved.enabledVariants)) {
        return options.map(option => option.value);
    }
    const known = new Set(saved.availableVariants.filter(isGuideVariant));
    const enabled = new Set(saved.enabledVariants.filter(isGuideVariant));
    // New catalog variants start included; explicit exclusions for this set survive.
    return options.filter(option => !known.has(option.value) || enabled.has(option.value)).map(option => option.value);
}

function positiveQuantity(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return false;
    const quantity = Math.floor(Number(value));
    return Number.isFinite(quantity) && quantity > 0;
}

export function buildGuideOwnershipIndex(collection) {
    const index = new Map();
    for (const item of (Array.isArray(collection) ? collection : [])) {
        if (!isRecord(item)) continue;
        if (cleanText(item.itemType) && cleanText(item.itemType).toLowerCase() !== 'card') continue;
        if ((cleanText(item.collectionId) || 'default') !== 'default') continue;
        const cardId = cleanText(item.id);
        if (!cardId) continue;
        const owned = index.get(cardId) || new Set();
        const quantities = isRecord(item.variantQuantities) ? item.variantQuantities : null;
        const entries = quantities ? Object.entries(quantities) : [];
        for (const [variant, quantity] of entries) {
            if (positiveQuantity(quantity)) owned.add(normalizeGuideVariant(variant));
        }
        // A legacy collection record itself represents one owned card. Explicit
        // zero/malformed variant quantities must not resurrect selectedVariant.
        if (entries.length === 0 && cleanText(item.selectedVariant)) {
            const conditions = isRecord(item.conditionQuantities) ? Object.values(item.conditionQuantities) : [];
            const copiesExist = conditions.length > 0 ? conditions.some(positiveQuantity)
                : item.quantity == null || positiveQuantity(item.quantity);
            if (copiesExist) owned.add(normalizeGuideVariant(item.selectedVariant));
        }
        if (owned.size > 0) index.set(cardId, owned);
    }
    return index;
}

export function isGuideSlotOwned(slot, ownedIndex) {
    return ownedIndex?.get(cleanText(slot?.cardId))?.has(normalizeGuideVariant(slot?.variant)) === true;
}

export function validateExportManifest(manifest) {
    if (!isRecord(manifest) || manifest.schemaVersion !== 1
        || !/^[a-zA-Z0-9._-]+$/.test(cleanText(manifest.expansion?.id))
        || !Array.isArray(manifest.cards) || !Array.isArray(manifest.slots)
        || manifest.slots.length > 10000) throw new Error('The binder guide data is invalid or unsupported.');
    const cards = new Map();
    for (const card of manifest.cards) {
        const id = cleanText(card?.id);
        if (!id || cards.has(id)) throw new Error('The binder guide contains invalid or duplicate cards.');
        cards.set(id, card);
    }
    const seen = new Set();
    for (const slot of manifest.slots) {
        const id = cleanText(slot?.slotId);
        if (!id || seen.has(id) || !cards.has(cleanText(slot?.cardId)) || !isGuideVariant(slot?.variant)) {
            throw new Error('The binder guide contains invalid or duplicate slots.');
        }
        seen.add(id);
    }
    return cards;
}

export function buildBinderPlan(manifest, ownedIndex = new Map(), options = {}) {
    const cards = validateExportManifest(manifest);
    const layout = BINDER_LAYOUTS[options.layout || '3x3'];
    if (!layout) throw new Error('Choose a supported binder layout.');
    const variants = new Set((options.enabledVariants ?? getGuideVariantOptions(manifest).map(option => option.value)).map(normalizeGuideVariant));
    const excluded = options.excludedSlotIds instanceof Set ? options.excludedSlotIds : new Set();
    return manifest.slots.filter(slot => variants.has(normalizeGuideVariant(slot.variant)) && !excluded.has(slot.slotId))
        .map((slot, planIndex) => {
            const card = cards.get(slot.cardId);
            const pocketIndex = planIndex % layout.pageSize;
            return {
                slotId: slot.slotId, cardId: slot.cardId, variant: slot.variant,
                variantLabel: cleanText(slot.label || slot.variant),
                name: cleanText(card.name) || 'Unknown Card',
                number: cleanText(card.number, 60), printedNumber: cleanText(card.printedNumber || card.number, 60),
                images: slot.images || card.images || null, imageSource: cleanText(slot.imageSource),
                owned: isGuideSlotOwned(slot, ownedIndex), planIndex,
                binderPage: Math.floor(planIndex / layout.pageSize) + 1,
                pocket: pocketIndex + 1,
                row: Math.floor(pocketIndex / layout.columns) + 1,
                column: (pocketIndex % layout.columns) + 1,
            };
        });
}

export function selectPrintableInserts(plan, options = {}) {
    const scope = options.scope || 'missing';
    if (!['missing', 'all'].includes(scope)) throw new Error('Choose missing inserts or the entire planned binder.');
    const skipped = options.skippedSlotIds instanceof Set ? options.skippedSlotIds : new Set();
    return plan.filter(row => (scope === 'all' || !row.owned) && !skipped.has(row.slotId));
}

export function packPrintSheets(inserts, presetKey = 'letter9') {
    const preset = PAPER_PRESETS[presetKey];
    if (!preset) throw new Error('Choose a supported paper layout.');
    const left = (preset.width - preset.columns * INSERT_WIDTH) / 2;
    const top = (preset.height - preset.rows * INSERT_HEIGHT) / 2;
    const sheets = [];
    for (let start = 0; start < inserts.length; start += preset.capacity) {
        sheets.push(inserts.slice(start, start + preset.capacity).map((insert, index) => ({
            insert, x: left + (index % preset.columns) * INSERT_WIDTH,
            y: preset.height - top - (Math.floor(index / preset.columns) + 1) * INSERT_HEIGHT,
            width: INSERT_WIDTH, height: INSERT_HEIGHT,
        })));
    }
    return { preset, sheets };
}

export function sanitizeBinderFilename(setName, layout, scope, style) {
    const slug = normalizeGuideSearch(setName).replace(/ +/g, '-').slice(0, 70) || 'master-set';
    const safeLayout = BINDER_LAYOUTS[layout] ? layout : '3x3';
    return `pokevaluator-${slug}-${safeLayout}-${scope === 'all' ? 'all' : 'missing'}-${style === 'ink' ? 'ink-saving' : 'artwork'}-binder-inserts.pdf`;
}

export function hasBinderPdfAccess(user, claims = {}) {
    if (!user) return false;
    const role = cleanText(claims.role || claims.tier).toLowerCase();
    if (role) return ['premium', 'tester', 'admin'].includes(role);
    return claims.admin === true || claims.tester === true || claims.premium === true;
}

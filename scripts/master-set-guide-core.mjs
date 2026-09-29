export const MASTER_SET_GUIDE_SCHEMA_VERSION = 1;

export const MASTER_SET_VARIANTS = Object.freeze([
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

export const MASTER_SET_VARIANT_LABELS = Object.freeze({
    normal: 'Normal',
    reverseHolofoil: 'Reverse Holofoil',
    energyReverseHolofoil: 'Energy Reverse Holofoil',
    pokeBallReverseHolofoil: 'Poké Ball Reverse Holofoil',
    rocketReverseHolofoil: 'Rocket Reverse Holofoil',
    quickBallReverseHolofoil: 'Quick Ball Reverse Holofoil',
    duskBallReverseHolofoil: 'Dusk Ball Reverse Holofoil',
    loveBallReverseHolofoil: 'Love Ball Reverse Holofoil',
    friendBallReverseHolofoil: 'Friend Ball Reverse Holofoil',
    cosmosHolofoil: 'Cosmos Holofoil',
    holofoil: 'Holofoil',
});

const FORBIDDEN_CARD_FIELDS = new Set([
    'prices',
    'pop_reports',
    'popReports',
    'marketplaces',
]);

function safeString(value) {
    return String(value ?? '').trim();
}

function safePositiveInteger(value, fallback = 0) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function clonePublicImage(imageLike) {
    if (!imageLike || typeof imageLike !== 'object') return null;

    const small = safeString(imageLike.small);
    const medium = safeString(imageLike.medium);
    const large = safeString(imageLike.large);
    if (!small && !medium && !large) return null;

    return {
        small: small || medium || large,
        medium: medium || large || small,
        large: large || medium || small,
    };
}

export function getFrontImage(images) {
    if (!Array.isArray(images)) return null;
    const front = images.find((image) => safeString(image?.type).toLowerCase() === 'front');
    return clonePublicImage(front || images[0]);
}

function readImageOverride(overrides, slotId) {
    const map = overrides?.variantImageOverrides;
    if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
    return clonePublicImage(map[slotId]);
}

export function resolveVariantImage(card, variant, overrides = {}) {
    const cardId = safeString(card?.id);
    const variantName = getAllowedVariantName(variant?.name) || safeString(variant?.name);
    const slotId = `${cardId}:${variantName}`;
    const override = readImageOverride(overrides, slotId);
    if (override) return { images: override, source: 'override' };

    // Scrydex variant renders for gold Hyper Rare cards can wash out the
    // etched artwork. The base card image matches the clean card scan used by
    // the normal card page while preserving variant images for other rarities.
    const rarity = safeString(card?.rarity).toLowerCase();
    if (variantName === 'holofoil' && rarity.endsWith('hyper rare')) {
        const goldCardBaseImage = getFrontImage(card?.images);
        if (goldCardBaseImage) return { images: goldCardBaseImage, source: 'baseGoldRarity' };
    }

    const variantImage = getFrontImage(variant?.images);
    if (variantImage) return { images: variantImage, source: 'variant' };

    const baseImage = getFrontImage(card?.images);
    if (baseImage) return { images: baseImage, source: 'base' };

    return { images: null, source: 'missing' };
}

function normalizeVariantKey(value) {
    return safeString(value).toLowerCase();
}

function getAllowedVariantName(rawName) {
    const wanted = normalizeVariantKey(rawName);
    return MASTER_SET_VARIANTS.find((name) => normalizeVariantKey(name) === wanted) || '';
}

function compareCards(left, right) {
    const orderDiff = safePositiveInteger(left?.expansion_sort_order, Number.MAX_SAFE_INTEGER)
        - safePositiveInteger(right?.expansion_sort_order, Number.MAX_SAFE_INTEGER);
    if (orderDiff !== 0) return orderDiff;

    const numberDiff = Number.parseInt(safeString(left?.number), 10)
        - Number.parseInt(safeString(right?.number), 10);
    if (Number.isFinite(numberDiff) && numberDiff !== 0) return numberDiff;

    return safeString(left?.id).localeCompare(safeString(right?.id));
}

function createCardRecord(card) {
    return {
        id: safeString(card?.id),
        name: safeString(card?.name) || 'Unknown Card',
        number: safeString(card?.number),
        printedNumber: safeString(card?.printed_number ?? card?.printedNumber),
        rarity: safeString(card?.rarity),
        supertype: safeString(card?.supertype),
        sortOrder: safePositiveInteger(card?.expansion_sort_order ?? card?.expansionSortOrder),
        images: getFrontImage(card?.images),
    };
}

function normalizeExcludedSlots(overrides) {
    const values = Array.isArray(overrides?.excludedSlots) ? overrides.excludedSlots : [];
    return new Set(values.map(safeString).filter(Boolean));
}

function assertNoForbiddenFields(value, path = 'manifest') {
    if (!value || typeof value !== 'object') return;

    if (Array.isArray(value)) {
        value.forEach((entry, index) => assertNoForbiddenFields(entry, `${path}[${index}]`));
        return;
    }

    for (const [key, entry] of Object.entries(value)) {
        if (FORBIDDEN_CARD_FIELDS.has(key)) {
            throw new Error(`Forbidden field "${key}" found at ${path}.${key}`);
        }
        assertNoForbiddenFields(entry, `${path}.${key}`);
    }
}

export function validateManifest(manifest) {
    const errors = [];
    const warnings = [];
    const seenSlots = new Set();
    const cardIds = new Set((Array.isArray(manifest?.cards) ? manifest.cards : []).map((card) => safeString(card?.id)));

    if (manifest?.schemaVersion !== MASTER_SET_GUIDE_SCHEMA_VERSION) {
        errors.push(`schemaVersion must be ${MASTER_SET_GUIDE_SCHEMA_VERSION}.`);
    }
    if (!safeString(manifest?.expansion?.id)) errors.push('Expansion ID is required.');
    if (!Array.isArray(manifest?.slots) || manifest.slots.length === 0) errors.push('At least one binder slot is required.');

    for (const slot of (Array.isArray(manifest?.slots) ? manifest.slots : [])) {
        const slotId = safeString(slot?.slotId);
        const cardId = safeString(slot?.cardId);
        const variant = safeString(slot?.variant);
        if (!slotId || !cardId || !variant) {
            errors.push('Every slot requires slotId, cardId, and variant.');
            continue;
        }
        if (seenSlots.has(slotId)) errors.push(`Duplicate slot: ${slotId}`);
        seenSlots.add(slotId);
        if (!cardIds.has(cardId)) errors.push(`Slot ${slotId} references missing card ${cardId}.`);
        if (!MASTER_SET_VARIANTS.includes(variant)) errors.push(`Unsupported variant ${variant} in ${slotId}.`);
        if (!slot?.images?.small && !slot?.images?.medium) warnings.push(`No usable image for ${slotId}.`);
        if (slot?.imageSource === 'base') warnings.push(`Variant image unavailable; base image used for ${slotId}.`);
    }

    try {
        assertNoForbiddenFields(manifest);
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
    }

    return { errors, warnings };
}

export function buildMasterSetGuideManifest(rawCards, options = {}) {
    const cards = Array.isArray(rawCards)
        ? rawCards.filter((card) => card && typeof card === 'object' && safeString(card.id)).slice().sort(compareCards)
        : [];
    if (cards.length === 0) throw new Error('No Scrydex cards were provided.');

    const expectedExpansionId = safeString(options.expansionId);
    const firstExpansion = cards[0]?.expansion && typeof cards[0].expansion === 'object'
        ? cards[0].expansion
        : {};
    const expansionId = expectedExpansionId || safeString(firstExpansion.id);
    if (!expansionId) throw new Error('An expansion ID is required.');

    const mismatchedCards = cards.filter((card) => safeString(card?.expansion?.id) && safeString(card.expansion.id) !== expansionId);
    if (mismatchedCards.length > 0) {
        throw new Error(`Received ${mismatchedCards.length} card(s) outside expansion ${expansionId}.`);
    }

    const overrides = options.overrides && typeof options.overrides === 'object' ? options.overrides : {};
    const excludedSlots = normalizeExcludedSlots(overrides);
    const manifestCards = [];
    const slots = [];
    const generationWarnings = [];
    const countsByVariant = Object.fromEntries(MASTER_SET_VARIANTS.map((name) => [name, 0]));
    let variantImageCount = 0;
    let baseImageFallbackCount = 0;
    let overrideImageCount = 0;
    let missingImageCount = 0;

    for (const card of cards) {
        const cardRecord = createCardRecord(card);
        manifestCards.push(cardRecord);

        const sourceVariants = Array.isArray(card?.variants) && card.variants.length > 0
            ? card.variants.slice().sort((left, right) => {
                const leftIndex = MASTER_SET_VARIANTS.indexOf(getAllowedVariantName(left?.name));
                const rightIndex = MASTER_SET_VARIANTS.indexOf(getAllowedVariantName(right?.name));
                const safeLeftIndex = leftIndex >= 0 ? leftIndex : Number.MAX_SAFE_INTEGER;
                const safeRightIndex = rightIndex >= 0 ? rightIndex : Number.MAX_SAFE_INTEGER;
                return safeLeftIndex - safeRightIndex;
            })
            : [{ name: 'normal', images: [] }];
        const seenVariants = new Set();

        for (const rawVariant of sourceVariants) {
            const variant = getAllowedVariantName(rawVariant?.name);
            if (!variant) {
                const unknown = safeString(rawVariant?.name) || '(blank)';
                generationWarnings.push(`Skipped unknown variant ${unknown} on ${cardRecord.id}.`);
                continue;
            }

            const normalized = normalizeVariantKey(variant);
            if (seenVariants.has(normalized)) {
                generationWarnings.push(`Skipped duplicate variant ${variant} on ${cardRecord.id}.`);
                continue;
            }
            seenVariants.add(normalized);

            const slotId = `${cardRecord.id}:${variant}`;
            if (excludedSlots.has(slotId)) continue;

            const resolvedImage = resolveVariantImage(card, rawVariant, overrides);
            if (resolvedImage.source === 'variant') variantImageCount += 1;
            if (resolvedImage.source === 'base') baseImageFallbackCount += 1;
            if (resolvedImage.source === 'override') overrideImageCount += 1;
            if (resolvedImage.source === 'missing') missingImageCount += 1;
            countsByVariant[variant] += 1;

            slots.push({
                slotId,
                cardId: cardRecord.id,
                variant,
                label: MASTER_SET_VARIANT_LABELS[variant],
                images: resolvedImage.images,
                imageSource: resolvedImage.source,
            });
        }
    }

    const manifest = {
        schemaVersion: MASTER_SET_GUIDE_SCHEMA_VERSION,
        generatedAt: safeString(options.generatedAt) || new Date().toISOString(),
        source: {
            provider: 'Scrydex',
            includesPricing: false,
            includesPopulationReports: false,
        },
        expansion: {
            id: expansionId,
            name: safeString(firstExpansion.name) || safeString(options.expansionName) || expansionId,
            series: safeString(firstExpansion.series),
            code: safeString(firstExpansion.code),
            total: safePositiveInteger(firstExpansion.total, manifestCards.length),
            printedTotal: safePositiveInteger(firstExpansion.printed_total ?? firstExpansion.printedTotal),
            releaseDate: safeString(firstExpansion.release_date ?? firstExpansion.releaseDate),
            logo: safeString(firstExpansion.logo),
            symbol: safeString(firstExpansion.symbol),
        },
        variantOrder: MASTER_SET_VARIANTS.slice(),
        cards: manifestCards,
        slots,
        stats: {
            cardRecords: manifestCards.length,
            binderSlots: slots.length,
            countsByVariant,
            variantImages: variantImageCount,
            baseImageFallbacks: baseImageFallbackCount,
            overrideImages: overrideImageCount,
            missingImages: missingImageCount,
        },
        generationWarnings,
    };

    const validation = validateManifest(manifest);
    if (validation.errors.length > 0) {
        throw new Error(`Generated manifest is invalid:\n- ${validation.errors.join('\n- ')}`);
    }

    return { manifest, validation };
}

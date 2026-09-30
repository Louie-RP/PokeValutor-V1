// Preferred display order, not an allowlist: every valid catalog variant is included.
export const GUIDE_VARIANT_LABELS = Object.freeze({
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
    whatsYourFavoriteStamp: "What's Your Favorite Stamp",
    ebGamesStamp: 'EB Games Stamp',
    gamestopStamp: 'GameStop Stamp',
    expansionStamp: 'Expansion Stamp',
    playPokemonStamp: 'Play! Pokémon Stamp',
    playPokemonStampHolofoil: 'Play! Pokémon Stamp Holofoil',
    playPokemonStampReverseHolofoil: 'Play! Pokémon Stamp Reverse Holofoil',
    pumpkinPikachuStamp: 'Pumpkin Pikachu Stamp',
    regionalChampionshipsStamp: 'Regional Championships Stamp',
});

export const GUIDE_VARIANTS = Object.freeze(Object.keys(GUIDE_VARIANT_LABELS));

export function isGuideVariant(value) {
    return typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9]{0,79}$/.test(value);
}

export function canonicalGuideVariant(value) {
    const name = String(value ?? '').trim();
    if (!isGuideVariant(name)) return '';
    return GUIDE_VARIANTS.find(variant => variant.toLowerCase() === name.toLowerCase()) || name;
}

export function getGuideVariantLabel(value) {
    const variant = canonicalGuideVariant(value);
    if (!variant) return '';
    return Object.hasOwn(GUIDE_VARIANT_LABELS, variant) ? GUIDE_VARIANT_LABELS[variant] : variant
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
        .replace(/^./, first => first.toUpperCase());
}

export function compareGuideVariants(left, right) {
    const priority = variant => {
        const index = GUIDE_VARIANTS.indexOf(variant);
        return index < 0 ? GUIDE_VARIANTS.length : index;
    };
    return priority(left) - priority(right) || left.localeCompare(right);
}

export function getGuideVariantOptions(manifest) {
    const variants = new Set((Array.isArray(manifest?.slots) ? manifest.slots : [])
        .map(slot => slot?.variant).filter(isGuideVariant));
    return [...variants].sort(compareGuideVariants).map(value => ({ value, label: getGuideVariantLabel(value) }));
}

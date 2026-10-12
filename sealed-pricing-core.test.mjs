import assert from 'node:assert/strict';
import sealedPricing from './functions/lib/sealed-pricing-core.js';

const ascendedHeroesVariants = [
    { name: 'Normal', prices: [{ market: 146.55 }] },
    { name: 'PokemonCenter', prices: [{ market: 364.18 }] },
];

const phantasmalFlamesVariants = [
    { name: 'Normal', prices: [{ market: 150.82 }] },
    { name: 'Pokemon Center', prices: [{ market: 287.37 }] },
];

const pokemonCenterIdentity = sealedPricing.getSealedPricingIdentity({
    id: 'me2pt5-s3::pokemoncenter',
    baseProductId: 'me2pt5-s3',
    variantName: 'PokemonCenter',
});

assert.deepEqual(pokemonCenterIdentity, {
    displayId: 'me2pt5-s3::pokemoncenter',
    baseProductId: 'me2pt5-s3',
    variantName: 'PokemonCenter',
    variantKey: 'pokemoncenter',
});

for (const name of ['PokemonCenter', 'Pokemon Center', 'pokemon-center', 'pokemon_center']) {
    assert.equal(sealedPricing.normalizeSealedVariantKey(name), 'pokemoncenter');
}

assert.equal(
    sealedPricing.getMarketFromTrackedSealedVariant(ascendedHeroesVariants, pokemonCenterIdentity),
    364.18,
    'Ascended Heroes Pokemon Center must not use the Normal variant price.',
);
assert.equal(
    sealedPricing.getMarketFromTrackedSealedVariant(
        ascendedHeroesVariants,
        sealedPricing.getSealedPricingIdentity({ id: 'me2pt5-s3' }),
    ),
    146.55,
    'Ascended Heroes Standard should use the lowest positive market when no variant is requested.',
);

const phantasmalPokemonCenterIdentity = sealedPricing.getSealedPricingIdentity({
    id: 'me2-s5::pokemoncenter',
});
assert.equal(phantasmalPokemonCenterIdentity.baseProductId, 'me2-s5');
assert.equal(phantasmalPokemonCenterIdentity.variantKey, 'pokemoncenter');
assert.equal(
    sealedPricing.getMarketFromTrackedSealedVariant(phantasmalFlamesVariants, phantasmalPokemonCenterIdentity),
    287.37,
);
assert.equal(
    sealedPricing.getMarketFromTrackedSealedVariant(
        phantasmalFlamesVariants,
        sealedPricing.getSealedPricingIdentity({ id: 'me2-s5' }),
    ),
    150.82,
);

const missingVariantIdentity = sealedPricing.getSealedPricingIdentity({
    id: 'me2pt5-s3::staff',
    variantName: 'Staff',
});
assert.equal(
    sealedPricing.findTrackedSealedVariant(ascendedHeroesVariants, missingVariantIdentity),
    null,
);
assert.equal(
    sealedPricing.getMarketFromTrackedSealedVariant(ascendedHeroesVariants, missingVariantIdentity),
    null,
    'A requested missing variant must remain unpriced.',
);

assert.notEqual(
    sealedPricing.buildSealedValueCacheKey(sealedPricing.getSealedPricingIdentity({ id: 'me2pt5-s3' })),
    sealedPricing.buildSealedValueCacheKey(pokemonCenterIdentity),
    'Standard and Pokemon Center variants must never share a cache entry.',
);

console.log('Shared sealed-pricing core behavior checks passed.');
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    MASTER_SET_VARIANTS,
    buildMasterSetGuideManifest,
    resolveVariantImage,
    validateManifest,
} from '../scripts/master-set-guide-core.mjs';

function createCard() {
    return {
        id: 'me2pt5-7',
        name: "Erika's Tangela",
        supertype: 'Pokémon',
        number: '7',
        printed_number: '007/217',
        rarity: 'Common',
        expansion_sort_order: 7,
        images: [{
            type: 'front',
            small: 'https://images.scrydex.com/pokemon/me2pt5-7/small',
            medium: 'https://images.scrydex.com/pokemon/me2pt5-7/medium',
            large: 'https://images.scrydex.com/pokemon/me2pt5-7/large',
        }],
        expansion: {
            id: 'me2pt5',
            name: 'Ascended Heroes',
            series: 'Mega Evolution',
            code: 'ASC',
            total: 295,
            printed_total: 217,
            release_date: '2026/01/30',
        },
        variants: [
            {
                name: 'normal',
                images: [{
                    type: 'front',
                    small: 'https://images.scrydex.com/pokemon/me2pt5-7n/small',
                    medium: 'https://images.scrydex.com/pokemon/me2pt5-7n/medium',
                    large: 'https://images.scrydex.com/pokemon/me2pt5-7n/large',
                }],
                prices: [{ market: 0.12 }],
                pop_reports: [{ company: 'PSA' }],
            },
            { name: 'cosmosHolofoil', images: [], prices: [{ market: 0.23 }] },
            {
                name: 'energyReverseHolofoil',
                images: [{
                    type: 'front',
                    small: 'https://images.scrydex.com/pokemon/me2pt5-7erh/small',
                    medium: 'https://images.scrydex.com/pokemon/me2pt5-7erh/medium',
                }],
            },
            {
                name: 'pokeBallReverseHolofoil',
                images: [{
                    type: 'front',
                    small: 'https://images.scrydex.com/pokemon/me2pt5-7pb/small',
                    medium: 'https://images.scrydex.com/pokemon/me2pt5-7pb/medium',
                }],
            },
            { name: 'rocketReverseHolofoil', images: [] },
            { name: 'quickBallReverseHolofoil', images: [] },
            { name: 'duskBallReverseHolofoil', images: [] },
            { name: 'loveBallReverseHolofoil', images: [] },
            { name: 'friendBallReverseHolofoil', images: [] },
            { name: 'unexpectedStampedVariant', images: [] },
        ],
    };
}

test('builds only the eleven approved variant types and strips price resources', () => {
    const { manifest } = buildMasterSetGuideManifest([createCard()], {
        expansionId: 'me2pt5',
        generatedAt: '2026-09-29T00:00:00.000Z',
    });

    assert.deepEqual(manifest.variantOrder, MASTER_SET_VARIANTS);
    assert.deepEqual(manifest.slots.map((slot) => slot.variant), [
        'normal',
        'energyReverseHolofoil',
        'pokeBallReverseHolofoil',
        'rocketReverseHolofoil',
        'quickBallReverseHolofoil',
        'duskBallReverseHolofoil',
        'loveBallReverseHolofoil',
        'friendBallReverseHolofoil',
        'cosmosHolofoil',
    ]);
    assert.equal(manifest.source.includesPricing, false);
    assert.equal(manifest.source.includesPopulationReports, false);
    assert.doesNotMatch(JSON.stringify(manifest), /"prices"|"pop_reports"|"marketplaces"/);
    for (const variant of [
        'rocketReverseHolofoil',
        'quickBallReverseHolofoil',
        'duskBallReverseHolofoil',
        'loveBallReverseHolofoil',
        'friendBallReverseHolofoil',
    ]) {
        assert.equal(manifest.slots.find((slot) => slot.variant === variant)?.imageSource, 'base');
        assert.ok(!manifest.generationWarnings.some((warning) => warning.includes(variant)));
    }
    assert.ok(manifest.generationWarnings.some((warning) => warning.includes('unexpectedStampedVariant')));
});

test('prefers variant images and falls back to the base card image', () => {
    const card = createCard();
    const normal = resolveVariantImage(card, card.variants[0]);
    const cosmos = resolveVariantImage(card, card.variants[1]);

    assert.equal(normal.source, 'variant');
    assert.equal(normal.images.medium, 'https://images.scrydex.com/pokemon/me2pt5-7n/medium');
    assert.equal(normal.images.large, 'https://images.scrydex.com/pokemon/me2pt5-7n/large');
    assert.equal(cosmos.source, 'base');
    assert.equal(cosmos.images.medium, 'https://images.scrydex.com/pokemon/me2pt5-7/medium');
    assert.equal(cosmos.images.large, 'https://images.scrydex.com/pokemon/me2pt5-7/large');
});

test('a reviewed image override takes priority over Scrydex and base images', () => {
    const card = createCard();
    const resolved = resolveVariantImage(card, card.variants[1], {
        variantImageOverrides: {
            'me2pt5-7:cosmosHolofoil': {
                small: 'https://verified.example/tangela-cosmos-small',
                medium: 'https://verified.example/tangela-cosmos-medium',
                large: 'https://verified.example/tangela-cosmos-large',
            },
        },
    });

    assert.equal(resolved.source, 'override');
    assert.equal(resolved.images.medium, 'https://verified.example/tangela-cosmos-medium');
    assert.equal(resolved.images.large, 'https://verified.example/tangela-cosmos-large');
});

test('gold Hyper Rare holofoil slots use the clean base card image', () => {
    for (const rarity of ['Hyper Rare', 'Mega Hyper Rare']) {
        const card = createCard();
        card.rarity = rarity;
        const holofoil = {
            name: 'holofoil',
            images: [{
                type: 'front',
                small: 'https://images.scrydex.com/pokemon/me2pt5-294-holofoil/small',
                medium: 'https://images.scrydex.com/pokemon/me2pt5-294-holofoil/medium',
                large: 'https://images.scrydex.com/pokemon/me2pt5-294-holofoil/large',
            }],
        };

        const resolved = resolveVariantImage(card, holofoil);
        assert.equal(resolved.source, 'baseGoldRarity');
        assert.equal(resolved.images.large, 'https://images.scrydex.com/pokemon/me2pt5-7/large');
    }
});

test('non-gold holofoil slots keep their variant-specific image', () => {
    const card = createCard();
    card.rarity = 'Special Illustration Rare';
    const holofoil = {
        name: 'holofoil',
        images: [{
            type: 'front',
            small: 'https://images.scrydex.com/pokemon/me2pt5-281-holofoil/small',
            medium: 'https://images.scrydex.com/pokemon/me2pt5-281-holofoil/medium',
            large: 'https://images.scrydex.com/pokemon/me2pt5-281-holofoil/large',
        }],
    };

    const resolved = resolveVariantImage(card, holofoil);
    assert.equal(resolved.source, 'variant');
    assert.equal(resolved.images.large, 'https://images.scrydex.com/pokemon/me2pt5-281-holofoil/large');
});

test('image sizes fall back safely when Scrydex omits a size', () => {
    const card = createCard();
    card.images = [{
        type: 'front',
        large: 'https://images.scrydex.com/pokemon/me2pt5-7/large',
    }];

    const resolved = resolveVariantImage(card, card.variants[1]);
    assert.equal(resolved.images.small, 'https://images.scrydex.com/pokemon/me2pt5-7/large');
    assert.equal(resolved.images.medium, 'https://images.scrydex.com/pokemon/me2pt5-7/large');
    assert.equal(resolved.images.large, 'https://images.scrydex.com/pokemon/me2pt5-7/large');
});

test('validation catches duplicate slots and missing card references', () => {
    const { manifest } = buildMasterSetGuideManifest([createCard()], { expansionId: 'me2pt5' });
    const duplicate = { ...manifest.slots[0] };
    manifest.slots.push(duplicate, {
        ...duplicate,
        slotId: 'missing-card:normal',
        cardId: 'missing-card',
    });

    const validation = validateManifest(manifest);
    assert.ok(validation.errors.some((error) => error.includes('Duplicate slot')));
    assert.ok(validation.errors.some((error) => error.includes('references missing card')));
});

test('rejects cards from an unexpected expansion', () => {
    const card = createCard();
    card.expansion.id = 'me5';
    assert.throws(
        () => buildMasterSetGuideManifest([card], { expansionId: 'me2pt5' }),
        /outside expansion me2pt5/,
    );
});

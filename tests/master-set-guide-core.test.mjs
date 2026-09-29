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
                    large: 'https://images.scrydex.com/pokemon/me2pt5-7erh/large',
                }],
            },
            {
                name: 'pokeBallReverseHolofoil',
                images: [{
                    type: 'front',
                    small: 'https://images.scrydex.com/pokemon/me2pt5-7pb/small',
                    medium: 'https://images.scrydex.com/pokemon/me2pt5-7pb/medium',
                    large: 'https://images.scrydex.com/pokemon/me2pt5-7pb/large',
                }],
            },
            { name: 'rocketReverseHolofoil', images: [] },
            { name: 'loveBallReverseHolofoil', images: [] },
            { name: 'friendBallReverseHolofoil', images: [] },
            { name: 'unexpectedStampedVariant', images: [] },
        ],
    };
}

test('builds only the nine approved variant types and strips price resources', () => {
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
        'loveBallReverseHolofoil',
        'friendBallReverseHolofoil',
        'cosmosHolofoil',
    ]);
    assert.equal(manifest.source.includesPricing, false);
    assert.equal(manifest.source.includesPopulationReports, false);
    assert.doesNotMatch(JSON.stringify(manifest), /"prices"|"pop_reports"|"marketplaces"/);
    assert.deepEqual(manifest.cards[0].images, {
        small: 'https://images.scrydex.com/pokemon/me2pt5-7/small',
        medium: 'https://images.scrydex.com/pokemon/me2pt5-7/medium',
        large: 'https://images.scrydex.com/pokemon/me2pt5-7/large',
    });
    assert.deepEqual(manifest.slots.find((slot) => slot.variant === 'normal')?.images, {
        small: 'https://images.scrydex.com/pokemon/me2pt5-7n/small',
        medium: 'https://images.scrydex.com/pokemon/me2pt5-7n/medium',
        large: 'https://images.scrydex.com/pokemon/me2pt5-7n/large',
    });
    for (const variant of ['rocketReverseHolofoil', 'loveBallReverseHolofoil', 'friendBallReverseHolofoil']) {
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
    assert.equal(cosmos.source, 'base');
    assert.equal(cosmos.images.medium, 'https://images.scrydex.com/pokemon/me2pt5-7/medium');
});

test('preserves available sizes and safely fills missing image sizes', () => {
    const card = createCard();
    card.images = [{ type: 'front', large: 'https://images.example/large-only' }];
    card.variants = [{ name: 'normal', images: [] }];

    const resolved = resolveVariantImage(card, card.variants[0]);

    assert.equal(resolved.source, 'base');
    assert.deepEqual(resolved.images, {
        small: 'https://images.example/large-only',
        medium: 'https://images.example/large-only',
        large: 'https://images.example/large-only',
    });

    card.images = [{ type: 'front', small: 'https://images.example/small-only' }];
    const smallOnly = resolveVariantImage(card, card.variants[0]);
    assert.deepEqual(smallOnly.images, {
        small: 'https://images.example/small-only',
        medium: 'https://images.example/small-only',
        large: 'https://images.example/small-only',
    });
});

test('a reviewed image override takes priority over Scrydex and base images', () => {
    const card = createCard();
    const resolved = resolveVariantImage(card, card.variants[1], {
        variantImageOverrides: {
            'me2pt5-7:cosmosHolofoil': {
                small: 'https://verified.example/tangela-cosmos-small',
                medium: 'https://verified.example/tangela-cosmos-medium',
            },
        },
    });

    assert.equal(resolved.source, 'override');
    assert.equal(resolved.images.medium, 'https://verified.example/tangela-cosmos-medium');
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

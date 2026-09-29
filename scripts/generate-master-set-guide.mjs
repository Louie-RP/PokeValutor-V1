#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildMasterSetGuideManifest } from './master-set-guide-core.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_OUTPUT_DIR = path.join(REPOSITORY_ROOT, 'data', 'master-set-guides');
const DEFAULT_BASE_URL = 'https://api.scrydex.com/pokemon/v1';
const PAGE_SIZE = 100;
const MAX_PAGES = 25;
const SELECT_FIELDS = [
    'id',
    'name',
    'number',
    'printed_number',
    'rarity',
    'supertype',
    'images',
    'expansion',
    'expansion_sort_order',
    'variants',
].join(',');

function parseArguments(argv) {
    const args = { expansionId: '', outputDir: DEFAULT_OUTPUT_DIR, dryRun: false };
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === '--set' || value === '--expansion') {
            args.expansionId = String(argv[index + 1] || '').trim();
            index += 1;
        } else if (value === '--output') {
            args.outputDir = path.resolve(String(argv[index + 1] || ''));
            index += 1;
        } else if (value === '--dry-run') {
            args.dryRun = true;
        } else if (!value.startsWith('-') && !args.expansionId) {
            args.expansionId = value.trim();
        } else {
            throw new Error(`Unknown argument: ${value}`);
        }
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(args.expansionId)) {
        throw new Error('Provide a valid expansion ID with --set, for example: --set me2pt5');
    }
    return args;
}

async function readJsonIfPresent(filePath, fallback) {
    try {
        return JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') return fallback;
        throw error;
    }
}

async function fetchExpansionCards({ expansionId, apiKey, teamId, baseUrl }) {
    const cards = [];
    let requestCount = 0;
    let totalCount = null;

    for (let page = 1; page <= MAX_PAGES; page += 1) {
        const url = new URL(`${baseUrl.replace(/\/$/, '')}/expansions/${encodeURIComponent(expansionId)}/cards`);
        url.searchParams.set('page', String(page));
        url.searchParams.set('pageSize', String(PAGE_SIZE));
        url.searchParams.set('orderBy', 'expansion_sort_order');
        url.searchParams.set('select', SELECT_FIELDS);

        const response = await fetch(url, {
            headers: {
                'X-Api-Key': apiKey,
                'X-Team-ID': teamId,
                Accept: 'application/json',
            },
        });
        requestCount += 1;

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`Scrydex request failed (${response.status}): ${body.slice(0, 300)}`);
        }

        const payload = await response.json();
        const pageCards = Array.isArray(payload?.data) ? payload.data : [];
        totalCount = Number.isFinite(Number(payload?.totalCount)) ? Number(payload.totalCount) : totalCount;
        cards.push(...pageCards);

        const hasMore = Number.isFinite(totalCount)
            ? cards.length < totalCount
            : pageCards.length === PAGE_SIZE;
        if (!hasMore) break;
        if (page === MAX_PAGES) throw new Error(`Exceeded the ${MAX_PAGES}-page safety limit.`);
    }

    return { cards, requestCount, totalCount };
}

async function writeJsonAtomically(filePath, value) {
    const temporaryPath = `${filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, filePath);
}

function buildIndexEntry(manifest, fileName) {
    return {
        expansionId: manifest.expansion.id,
        name: manifest.expansion.name,
        series: manifest.expansion.series,
        releaseDate: manifest.expansion.releaseDate,
        path: `data/master-set-guides/${fileName}`,
        cardRecords: manifest.stats.cardRecords,
        binderSlots: manifest.stats.binderSlots,
        generatedAt: manifest.generatedAt,
    };
}

async function updateGuideIndex(outputDir, manifest, fileName) {
    const indexPath = path.join(outputDir, 'index.json');
    const current = await readJsonIfPresent(indexPath, { schemaVersion: 1, guides: [] });
    const currentGuides = Array.isArray(current?.guides) ? current.guides : [];
    const nextEntry = buildIndexEntry(manifest, fileName);
    const guides = currentGuides
        .filter((entry) => String(entry?.expansionId || '') !== manifest.expansion.id)
        .concat(nextEntry)
        .sort((left, right) => String(right?.releaseDate || '').localeCompare(String(left?.releaseDate || '')));

    await writeJsonAtomically(indexPath, { schemaVersion: 1, guides });
}

function printSummary(manifest, validation, requestCount, dryRun) {
    const rows = [
        ['Expansion', `${manifest.expansion.name} (${manifest.expansion.id})`],
        ['Card records', manifest.stats.cardRecords],
        ['Binder slots', manifest.stats.binderSlots],
        ['Variant images', manifest.stats.variantImages],
        ['Base-image fallbacks', manifest.stats.baseImageFallbacks],
        ['Override images', manifest.stats.overrideImages],
        ['Missing images', manifest.stats.missingImages],
        ['Scrydex requests', requestCount],
        ['Mode', dryRun ? 'dry run (no files written)' : 'files written'],
    ];

    for (const [label, value] of rows) {
        process.stdout.write(`${String(label).padEnd(22)} ${value}\n`);
    }
    for (const variant of manifest.variantOrder) {
        process.stdout.write(`  ${variant.padEnd(28)} ${manifest.stats.countsByVariant[variant] || 0}\n`);
    }

    const warnings = [...manifest.generationWarnings, ...validation.warnings];
    if (warnings.length > 0) {
        process.stdout.write(`Warnings (${warnings.length}):\n`);
        warnings.slice(0, 50).forEach((warning) => process.stdout.write(`- ${warning}\n`));
        if (warnings.length > 50) process.stdout.write(`- ${warnings.length - 50} additional warning(s) omitted\n`);
    }
}

async function main() {
    const args = parseArguments(process.argv.slice(2));
    const apiKey = String(process.env.SCRYDEX_API_KEY || '').trim();
    const teamId = String(process.env.SCRYDEX_TEAM_ID || '').trim();
    const baseUrl = String(process.env.SCRYDEX_BASE_URL || DEFAULT_BASE_URL).trim();
    if (!apiKey || !teamId) {
        throw new Error('SCRYDEX_API_KEY and SCRYDEX_TEAM_ID must be set in the environment.');
    }

    const overridePath = path.join(args.outputDir, 'overrides', `${args.expansionId}.json`);
    const overrides = await readJsonIfPresent(overridePath, {});
    const fetched = await fetchExpansionCards({
        expansionId: args.expansionId,
        apiKey,
        teamId,
        baseUrl,
    });
    const { manifest, validation } = buildMasterSetGuideManifest(fetched.cards, {
        expansionId: args.expansionId,
        overrides,
    });

    if (!args.dryRun) {
        await mkdir(args.outputDir, { recursive: true });
        const fileName = `${args.expansionId}.json`;
        await writeJsonAtomically(path.join(args.outputDir, fileName), manifest);
        await updateGuideIndex(args.outputDir, manifest, fileName);
    }

    printSummary(manifest, validation, fetched.requestCount, args.dryRun);
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});

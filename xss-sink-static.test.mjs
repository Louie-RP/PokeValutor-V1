import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const forbiddenSink = /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/;
const productionPath = /\.(?:html|js)$/i;
const testPath = /(?:^|[\\/])(?:[^\\/]*\.test\.[^\\/]+|test-[^\\/]+)$/i;

function getAddedProductionLines() {
    const refs = [
        ['main...HEAD'],
        ['HEAD^'],
    ];

    for (const [range] of refs) {
        try {
            const diff = execFileSync(
                'git',
                ['diff', '--unified=0', range, '--', '*.html', '*.js'],
                { encoding: 'utf8' },
            );
            const addedLines = [];
            let currentPath = '';
            for (const line of diff.split(/\r?\n/)) {
                if (line.startsWith('+++ b/')) currentPath = line.slice(6);
                if (!line.startsWith('+') || line.startsWith('+++')) continue;
                if (!productionPath.test(currentPath) || testPath.test(currentPath)) continue;
                addedLines.push(line.slice(1));
            }
            return addedLines;
        } catch {
            // Try the fallback range when the checkout does not contain main.
        }
    }

    return [];
}

const unsafeAddedLines = getAddedProductionLines().filter((line) => forbiddenSink.test(line));
assert.deepEqual(
    unsafeAddedLines,
    [],
    'New production code must build DOM nodes instead of writing HTML strings.',
);

console.log('No forbidden HTML sinks were added to production code.');

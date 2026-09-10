import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile('search.js', 'utf8');

assert.match(source, /function formatVariantDisplayName\(value\)/);
assert.match(source, /replace\(\/\^firstEdition\(\?=\[A-Z\]\|\$\)\/i, '1st Ed\. '\)/);
assert.match(source, /replace\(\/\(\[a-z0-9\]\)\(\[A-Z\]\)\/g, '\$1 \$2'\)/);
assert.match(source, /createSelectOption\(String\(variant\), formatVariantDisplayName\(variant\), false\)/);
assert.match(source, /createSelectOption\(variant, formatVariantDisplayName\(variant\), variant === item\.selectedVariant\)/);

const cardOptionLine = source.match(/createSelectOption\(String\(variant\), formatVariantDisplayName\(variant\), false\)/)?.[0] || '';
assert.doesNotMatch(cardOptionLine, /value\s*=\s*formatVariantDisplayName/, 'Variant values must remain raw identifiers');

console.log('Variant display label checks passed.');
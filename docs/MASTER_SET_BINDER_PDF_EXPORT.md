# Master Set Binder PDF Export

The Binder Guide has an **Export Binder PDF** button. Users can generate and
download card-sized inserts with artwork or an ink-saving labels-only style.
Generation happens in the browser from the existing guide manifest.

## Available guides

| Set | Expansion ID | Card records | Binder inserts |
| --- | --- | ---: | ---: |
| 30th Celebration | me55 | 161 | 161 |
| 30th Celebration: Classic Collection | me55c | 30 | 30 |
| Pitch Black | me5 | 120 | 199 |
| Chaos Rising | me4 | 122 | 202 |
| Perfect Order | me3 | 124 | 203 |
| Ascended Heroes | me2pt5 | 295 | 620 |
| Phantasmal Flames | me2 | 130 | 220 |
| Mega Evolution | me1 | 188 | 318 |

Both 30th Celebration snapshots currently contain one Holofoil slot per card.
They preserve Scrydex's expansion order and exact printed numbers, including
the R/RGB, G/RGB, and B/RGB Mew cards and Classic's historical card numbers.
Classic cards with repeated numbers remain separate records with distinct IDs.

The new manifests were generated through `buildMasterSetGuideManifest` using
Scrydex's publicly embedded card JSON. Their source metadata records the
catalog URL and retrieval method. No paid API credentials were used, and pricing
and population data are excluded. Both 30th Celebration guides use the published
front scans because their records have no separate variant images.

The five additional Mega Evolution snapshots preserve all 684 card records,
including secret rares, and produce 1,142 supported binder inserts. Variant counts
from the public catalogs were checked against each card's embedded JSON:

| Expansion | Normal | Reverse Holofoil | Cosmos Holofoil | Holofoil | Excluded stamp variants |
| --- | ---: | ---: | ---: | ---: | ---: |
| me5 | 68 | 74 | 0 | 57 | 3 |
| me4 | 68 | 76 | 0 | 58 | 4 |
| me3 | 68 | 79 | 0 | 56 | 2 |
| me2 | 76 | 84 | 4 | 56 | 1 |
| me1 | 113 | 122 | 5 | 78 | 35 |

Retailer, event, and promotional stamp variants remain outside the existing
eleven-variant allowlist. They are recorded in `generationWarnings`; their parent
cards and supported variants remain included. Scrydex currently omits separate
images for many variants in these sets. The existing resolver uses the base scan
and retains the variant label when an image is absent, and the clean base scan
for Hyper Rares. Published Cosmos variant scans are preserved when available.
No image URLs are inferred or invented.

The guide index enables **Plan Binder Layout** on each supported Master Set
detail page and includes all eight guides in the searchable **Build a Binder**
catalog at `master-set-guide.html`, with logos and release-date ordering. Direct
guide URLs use `master-set-guide.html?expansionId=<id>`. Each supports the existing
layouts, card/variant selection, missing-card filtering, and both PDF styles.

## User options

- Binder layouts: 3 × 3, 4 × 3, and 4 × 4. Positions fill left to right, row by row.
- Export the entire planned binder by default, or only missing variants in the
  Default Collection.
- Choose **With images** or **No images**.
- Letter paper layout defaults to nine inserts per sheet; six is also available.
- Open **Additional settings** to include or exclude variant families,
  individual cards, or individual variants, or skip selected inserts while
  retaining their binder page/pocket positions.
- Download the PDF, or share it through the device's file share menu when supported.

The default dialog shows four dropdowns: Binder layout, Print style, Cards to
print, and Card layout. Additional settings is collapsed on every open.
The entire planned binder and nine-per-sheet defaults also reset on every open.
The modal has no calibration option, print instructions, or sheet preview.

Every insert has rounded corners and occupies **180 × 252 PDF points
(2.5 × 3.5 inches)**. Printer sheets
are independent of binder pages: a 12- or 16-pocket binder page spans multiple
Letter sheets. Print at **100% / Actual Size**, with Fit to Page disabled.

The ink-saving style contains only a white background, thin black outline, black
card name, printed number, variant, binder page/pocket, and PokeValuator.com. Row
and column abbreviations are omitted because the pocket number identifies the
position. It fetches and embeds no artwork. The artwork style uses the manifest's resolved
slot image; unavailable images retain the identifying labels and are reported
after generation.

Composition exclusions change binder positions. Print-only skips and the
missing-only filter run after positions are assigned, so surviving inserts retain
their planned locations. Export settings are staged separately from guide
preferences and never write to the collection.

## Collection and access

Missing status uses finite positive quantities for card variants in the locally
saved Default Collection. Sealed products and custom collections are excluded.
Legacy selectedVariant records are supported when explicit quantity data does
not say zero. Cached data must belong to the current account; if the cache is
absent, invalid, or belongs to another account, the dialog offers the entire
planned binder and instructs the user to sync Dex for missing-only exports.
Generation takes a fresh ownership snapshot.

Premium, Tester, and Admin accounts can generate PDFs. The dialog checks the
existing Firebase claims when opened and refreshes them before generation.
This is a frontend entitlement check, consistent with a browser-only generator;
it is not server enforcement. Account changes cancel jobs and discard downloads.

## Implementation

- `master-set-guide-model.mjs`: manifest validation, ownership, selection,
  binder positions, filenames, entitlement decisions, and physical sheet geometry.
- `master-set-guide-export.mjs`: accessible native dialog, paginated selectors,
  snapshot handling, generation/cancellation, downloads, and optional file sharing.
- `master-set-guide-pdf.mjs`: lazy PDF/font loading, label layout, image fetching,
  encoding, embedding, and fallback labels.
- `vendor/` and `fonts/binder/`: pinned local distributions and license notices.

PDF dependencies and fonts load only after Generate PDF. Artwork fetches use
anonymous CORS requests, bounded byte sizes, timeouts, and at most three
concurrent loads. Repeated URLs are embedded once. Completed Blob URLs are
revoked when settings change, the dialog closes, or the account changes.

The existing CSP is unchanged. External display values are rendered with DOM
nodes/textContent; image schemes and credentials are validated. No API proxy,
catalog/pricing changes, persistence migration, email delivery, or build step is
required. Email delivery would be a separate authenticated backend feature;
supported devices can already share the downloaded PDF to their mail app.

## Validation and pull-test checklist

Run the focused regression checks with Node:

```sh
node --test tests/master-set-guide-export-model.test.mjs tests/master-set-guide-pdf.test.mjs tests/master-set-guide-core.test.mjs tests/master-set-guide-ui-static.test.mjs
```

Behavioral checks cover the real 620-slot manifest, all three binder layouts,
ownership variants and malformed quantities, exclusions versus skips, exact
sheet geometry, Unicode labels, full-set PDFs, duplicate/failed artwork,
cancellation, URL validation, safe DOM rendering, and lazy dependencies/CSP.

Browser verification exercises the compact default view, Additional settings,
selection, artwork and ink-saving downloads, fresh ownership, mobile sizing,
focus return, cancellation, and sign-out. A
21-insert sample produced three artwork sheets with all 21 images embedded, or
three ink-saving sheets with no new artwork requests. The full
620-slot ink-saving set produced 69 Letter sheets. Rendered PDF pages were
visually inspected. Browser tests used an authenticated fixture; verify real
Firebase claims and collection sync on the running app.

The five additional Mega Evolution guides passed browser checks for catalog
search, logos, supported Master Set links, all three binder layouts, exact secret
rare numbers, missing-only counts, individual selections, and mobile dialogs.
Full No images exports produced 23, 23, 23, 25, and 36 sheets respectively for
me5 through me1. Artwork samples included normal/reverse pairs, Cosmos variants,
and Hyper Rares on six-per-sheet paper. All ten PDFs were checked for every
printed number, insert count, embedded-image count, and exact 180 × 252-point
rounded outlines; rendered sample pages were visually inspected. Ink exports
requested no new artwork. No runtime catalog API or Firestore requests occurred.

1. Pull this branch and serve the app over HTTP(S); open the Ascended Heroes
   Binder Guide as a Premium, Tester, or Admin account.
2. Export a small selection in both styles. Confirm images match each variant,
   names/labels are readable, and the downloaded file opens in a PDF reader.
3. Test all binder layouts, missing-only versus entire binder, and card/variant
   exclusions. Check that a print-only skip does not renumber other pockets.
4. Close and reopen the modal. Confirm All Cards, nine inserts per
   sheet, and collapsed Additional settings reset, even with an owned collection.
5. Test cancellation, account switching, collection changes, and a Basic account.
   Check file sharing on a supporting mobile device.

The full root suite (`node --test *.test.mjs tests/*.test.mjs`, with `functions/`
dependencies installed) has five existing failures at the current branch base
`d55f8db3bd961478ca31f8309ab69573b88f64e4`, reproduced before adding these sets:

- `dex-sealed-price-refresh-static.test.mjs`: unchanged Sealed cache assertion.
- `social-share-logo-static.test.mjs`: unchanged home-preview Open Graph assertion.
- `top-card-variant-static.test.mjs`: ignored/missing scrydex-worker.js fixture.
- `tests/watchlist-cache-static.test.mjs`: ignored/missing scrydex-worker.js fixture.
- `trade-workspace.test.mjs`: unchanged search page CSS-version assertion.

All other root test files pass, including the export and Binder Guide tests.
Those unrelated failures are outside this change.

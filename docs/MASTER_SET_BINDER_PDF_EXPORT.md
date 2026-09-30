# Master Set Binder PDF Export

The Binder Guide has an **Export Binder PDF** button. Users can generate and
download card-sized inserts with artwork or an ink-saving labels-only style.
Generation happens in the browser from the existing guide manifest.

## User options

- Binder layouts: 3 × 3, 4 × 3, and 4 × 4. Positions fill left to right, row by row.
- Print all planned inserts or only missing variants in the Default Collection.
- Include or exclude variant families, individual cards, or individual variants.
- Skip selected print inserts while retaining their binder page/pocket positions.
- US Letter sheets with nine inserts, or six inserts for more vertical margin.
- Optional separate print calibration sheet.
- Download the PDF, or share it through the device's file share menu when supported.

Every insert occupies **180 × 252 PDF points (2.5 × 3.5 inches)**. Printer sheets
are independent of binder pages: a 12- or 16-pocket binder page spans multiple
Letter sheets. Print at **100% / Actual Size**, with Fit to Page disabled.

The ink-saving style contains only a white background, thin black outline, black
card name, printed number, variant, binder position, and PokeValuator.com. It
fetches and embeds no artwork. The artwork style uses the manifest's resolved
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
  encoding, embedding, fallback labels, and calibration page.
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

Browser verification exercised selection, artwork and ink-saving downloads,
fresh ownership, mobile sizing, focus return, cancellation, and sign-out. A
21-insert sample produced three artwork sheets with all 21 images embedded, or
three ink-saving sheets plus calibration with no new artwork requests. The full
620-slot ink-saving set produced 69 Letter sheets. Rendered PDF pages were
visually inspected. Browser tests used an authenticated fixture; verify real
Firebase claims and collection sync on the running app.

1. Pull this branch and serve the app over HTTP(S); open the Ascended Heroes
   Binder Guide as a Premium, Tester, or Admin account.
2. Export a small selection in both styles. Confirm images match each variant,
   names/labels are readable, and the downloaded file opens in a PDF reader.
3. Test all binder layouts, missing-only versus entire binder, and card/variant
   exclusions. Check that a print-only skip does not renumber other pockets.
4. Generate calibration and print one sheet at Actual Size. Measure the
   one-inch line and a 2.5 × 3.5-inch insert, then cut and test the binder fit.
5. Test cancellation, account switching, collection changes, and a Basic account.
   Check file sharing on a supporting mobile device.

The full root suite (`node --test *.test.mjs tests/*.test.mjs`, after installing
`functions/` dependencies) has four existing failures reproduced at the original
branch commit `04b8040602e67e6bd4bb5496b2f5a85ea31d3886`:

- `dex-sealed-price-refresh-static.test.mjs`: unchanged Sealed cache assertion.
- `social-share-logo-static.test.mjs`: unchanged home-preview Open Graph assertion.
- `top-card-variant-static.test.mjs`: ignored/missing scrydex-worker.js fixture.
- `trade-workspace.test.mjs`: unchanged search page CSS-version assertion.

All other root test files pass, including both new export test files and the
existing Binder Guide tests. Those unrelated files are outside this change.

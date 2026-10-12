# PokéValuator UI refresh: design system and page migration spec

**Status:** Implementation guide for Copilot; no site code changed by this document  
**Reviewed:** 2026-09-26  
**Repository:** `Louie-RP/PokeValutor-V1`  
**Main snapshot:** `388d256810746e64c84aed932951be732a1cc73f`  
**Update snapshot:** `444a189a45b9a796455e516ba9bd6ac303094f76` (`card-search-home-style`)

## 1. Goal and scope

Carry the visual language of the updated homepage preview and Card Search page through Dex, Sealed, and the remaining public and account pages. Design for narrow phones first, then adapt the same information hierarchy to tablet and desktop. Work one page at a time, starting with **Dex**, then **Sealed**.

This is a **frontend presentation project**. Preserve the current API, Firebase, Firestore, Stripe, price selection, search, cache, collection, quota, and authentication behavior. Preserve user data, URL contracts, form semantics, IDs used by scripts, and externally visible results. Any behavior defect found during the restyle belongs in a separately reviewed fix. Do not import the older homepage redesign spec's proposed backend or pricing changes into this task.

### Source of truth and important branch distinction

| Source | What it actually contains |
| --- | --- |
| `main/index.html` and `main/search.html` | Existing homepage and older Card Search presentation. The live site currently exposes the older homepage at `/`. |
| `card-search-home-style/home-preview.html`, `.css`, `.js` | The new homepage **preview** and its behavior. The update branch's `index.html` is still the old homepage with a CSS version change and `auth-menu.js` include; it has not been replaced by the preview. |
| `card-search-home-style/search.html`, `search-refresh.css` | The actual Card Search refresh. `search.html` includes `styles.css`, `scanner.css`, and then the page scoped override stylesheet. |
| `card-search-home-style/styles.css` | Existing large shared stylesheet plus auth menu styles and some layout adjustments; it is **not** a complete sitewide adoption of the new theme. |
| `docs/PokeValuator_Homepage_Redesign_Spec.md` | An earlier intended design. Use the current preview implementation for visual facts. The older spec's backend instructions are outside this migration. |

Pinned visual references: [home preview HTML](https://github.com/Louie-RP/PokeValutor-V1/blob/444a189a45b9a796455e516ba9bd6ac303094f76/home-preview.html), [home CSS](https://github.com/Louie-RP/PokeValutor-V1/blob/444a189a45b9a796455e516ba9bd6ac303094f76/home-preview.css), [Card Search HTML](https://github.com/Louie-RP/PokeValutor-V1/blob/444a189a45b9a796455e516ba9bd6ac303094f76/search.html), [Card Search CSS](https://github.com/Louie-RP/PokeValutor-V1/blob/444a189a45b9a796455e516ba9bd6ac303094f76/search-refresh.css). The PNGs in `docs/assets/` on that branch are earlier homepage design references, while the CSS/HTML capture the implemented state.

**Branch integration note:** These branches have diverged in commit history (22 update commits versus 19 main commits since their merge base), even though the reverse content diff is small. `main/index.html` contains an Impact verification meta tag absent from the update branch, and `main/sets.html` contains a CSP meta tag absent from the update branch. Carry both forward. Recompare the latest heads before implementing; do not replace whole files from the older snapshot or blindly overwrite `<head>` content.

## 2. What changed compared with the earlier UI

| Area | Earlier presentation | Current update branch reference | Rule for the next pages |
| --- | --- | --- | --- |
| Entry hierarchy | Old `index.html` has a broad hero, daily snapshot, audiences, latest sets, trending sections. Old Search has a separate tall hero with chips. | Preview has a concise value proposition, Cards/Sealed mode switch, dominant search, three quick actions, compact results, new-set sections. Search removes its tall hero and starts with a Search / Trade / Watchlist jump control and a functional search panel. | On tool pages, put the primary task above supplementary explanation. Keep useful controls visible and avoid repetitive hero copy. |
| Color and depth | Shared `styles.css` has true black `#000000` and yellow brand accents. | New pages use near-black `#080809`, layered charcoal panels, subtle strokes, a faint yellow radial glow, and controlled yellow actions. | Use the new layered surfaces within the page scope; do not repaint all of `styles.css` at once. |
| Typography | Existing pages commonly load Playfair Display and Space Grotesk. | Headings use Playfair Display; the new UI body uses DM Sans. Search retains Space Grotesk as a fallback. | Load DM Sans on each migrated page. Use Playfair for major headings and DM Sans for forms, cards, labels, and body. |
| Header | Text wordmark and shared responsive navigation. | Preview and refreshed Search use the `PokeValuator_Logo.png` image, compact dark sticky header, circular account/menu controls, subdued links, and yellow active state. | Reuse the visual pattern while keeping the page's existing navigation/auth hooks and links. |
| Content | Older panels, rows, and long descriptions use varied sizing. | 72rem centered content width; about 1rem mobile gutters; dark rounded panels and inset result surfaces; short headings; restrained metadata. | Establish one clear page title, then section panels with compact labels and readable result cards. |
| Actions | Shared primary/secondary buttons with assorted page overrides. | Yellow primary (`#ffcb05`), charcoal secondary, distinct clear/destructive action, visible focus. Search currently adds a red Clear override at its CSS end. | Use semantic priority consistently. Preserve each action's event hook, confirmation, disabled state, and accessible name. |
| Mobile | Many pages already have responsive rules, but dense controls can compete. | Search stacks fields, keeps jump navigation compact, arranges section actions deliberately, and shrinks outer gutters at <=420px. Home uses one-column reading flow, swipeable set navigation, and desktop expansion. | Design each page at 320–430px first. No clipped values, horizontal page overflow, or hidden functions. |

### Facts versus choices

- The preview shows **up to three** card or sealed matches. Home cards are labeled `NM market`; sealed uses `Market value`. The full Card Search retains condition filters and Trade. These are existing behaviors; this visual migration must not change price rules.
- `home-preview.js` sends card preview queries to `search.html?query=...&source=home-preview`; `search.js` now accepts that `query` deep link. In contrast, the preview's sealed row and “Open sealed search” link currently go to plain `sealed.html`, and `sealed.js` does not implement matching query prefill. Do **not** claim that sealed query carryover already works or quietly add it as styling work.
- `search.js` changes in the update branch include the query deep link and Trade jump link. `sealed.js` also changes its cache version and filters sealed results by English language. `auth-menu.js` adds sign-in UI on many pages. Treat these as existing behavior in that branch, not as generic CSS that can be discarded or automatically introduced elsewhere.
- The preview contains Trending Cards and an account CTA whose initial markup is hidden and whose visibility depends on runtime state. Build shared visuals from the rendered UI, not by assuming every hidden section always appears.
- The Search refresh includes some CSS for a removed `.pv-searchHero`; those selectors are not proof that a large hero belongs on new pages. It also has late, high-specificity 38px button sizing overrides. Use its colors and hierarchy as reference, but verify touch targets and avoid copying the entire stylesheet or its `!important` overrides wholesale.

## 3. Visual system to carry forward

### Colors and use

| Token | Value | Use |
| --- | --- | --- |
| Page background | `#080809` | Primary canvas; optional subtle radial yellow glow at upper right, `rgba(255,203,5,.08)`. |
| Main surface | `#111114` | Outer search, collection, watchlist, and information panels. |
| Inset surface | `#0b0b0e` | Nested results, summaries, tabs, dropdowns. Search also uses input fill `#0c0c0f`. |
| Raised surface | `#18181d` | Secondary controls and lightweight selected/hover surfaces. |
| Primary text | `#f7f7f8` | Headlines, card names, values. |
| Muted text | `#aaaab4` | Description, hint, label, secondary metadata. Use a more readable value for tiny text if contrast testing requires it. |
| Hairline | `#2d2d37` | Panel boundaries and separators. Strong boundary `#4a4a56`; field outline about `#3b3b46`. |
| Brand yellow | `#ffcb05` | Main CTA, active tab, emphasized number/label, focus outline. Hover about `#ffda3d`; dark ink on yellow `#171300`. |
| Destructive | Existing Search ends with red `#dc2626` on Clear and `#ef4444` border; earlier Search rules use a muted rust treatment. | Resolve to one accessible destructive style in the shared migration component after visual review; do not infer that all red buttons on other pages should change without checking intent. |
| Search-only semantic detail | Set name `#8ed8ff`, rarity light gray, yellow variant marker | Helpful on card result cards; apply only where these meanings exist. |

Use dark-on-yellow text for primary actions. Keep yellow scarce enough that prices, active states, and the primary action remain easy to find. Color must never be the only indicator of a selected filter, price availability, or error.

### Type, geometry, and spacing

- **Display:** `"Playfair Display", Georgia, serif`; homepage H1 currently `clamp(2.2rem, 8vw, 4.2rem)` with tight ~1 line-height. Search section titles are `clamp(1.55rem, 3vw, 2rem)` and yellow. Use smaller page titles on dense tool pages than the home hero; preserve one semantic H1 per page.
- **Interface/body:** `"DM Sans", "Space Grotesk", system-ui, sans-serif`. Body line height is about 1.5. Labels are around `.78rem`, secondary copy around `.92rem`, small uppercase eyebrow/kicker around `.72–.78rem` with letter spacing `.10–.12em`. Treat these as reference scales, not a mandate to shrink essential mobile text.
- **Width:** `width: min(100% - 2rem, 72rem)` for the common content rail; Search reduces outer width to `100% - 1.5rem` below 420px. Keep long legal text to a narrower reading measure inside this rail.
- **Panels:** about `1–1.2rem` corner radius, `1rem` mobile inner padding and up to `1.6rem` desktop, 1px borders, very little outer shadow. Inner result surfaces can be about `.85–.95rem` radius.
- **Controls:** dark rounded inputs around `.8rem` radius and roughly `3.35rem` high on Search; the homepage search input is `3.7rem`. Primary and secondary controls about `.7rem` radius. Aim for **at least 44x44 CSS px** practical touch area, especially for icon, Hide, Clear, modal, pagination, and filter controls. Check Search's existing fixed 38px controls when choosing the final shared rule.
- **Spacing:** mobile page side gutters around 12–16px; panel gaps about `.9–2rem`; major section separation `clamp(4rem, 8vw, 7rem)` on the homepage. Dense tool pages can be closer while retaining an obvious section boundary.
- **Image treatment:** contained artwork on a dark near-black bed, stable aspect ratio, meaningful alt text, no stretching. Set logos can sit in a bounded tile. The homepage quick actions use simple yellow CSS icons; avoid introducing a competing icon style.
- **Motion:** hover lift is subtle (Search cards use `translateY(-2px)`). Respect `prefers-reduced-motion` and preserve keyboard visible focus with a yellow 3px outline and offset.

### Responsive behavior

| Width to check | Intended behavior |
| --- | --- |
| 320, 360, 390, 430px | Single reading column, compact header, clear first task. Forms stack. Long card/product names wrap without covering price/actions. Horizontal rails are deliberately scrollable; the whole page is not. Controls remain usable with large text and the on-screen keyboard. |
| 576–767px | Permit two-up cards only when values and actions remain legible. Maintain a compact mobile navigation pattern. |
| 768–991px | Widen panels; Search currently moves from single-field rows to a two-column form at 768px. Preserve comfortable card widths. |
| >=992px | Search form can use a three-track layout; wider content stays centered. Homepage shifts to a desktop hero and set panels. Do not merely stretch phone cards across 72rem. |
| >=1024px | Three newest-set panels may appear side by side in the preview. Other pages may use two or three columns only where their data density permits. |

## 4. Reusable interaction patterns

1. **Header/footer:** Maintain skip link, logo link, existing primary route names, account menu, keyboard menu toggle, active link (`aria-current="page"`), and current privacy/terms/contact routes. Keep sticky header content from covering anchor targets (`scroll-margin-top`). Do not duplicate the preview's private nav handler on pages already managed by `script.js`/`auth-menu.js`.
2. **Page intro:** Short eyebrow if it improves context, one clear H1, one short supportive line. Dex and Sealed should reach the working controls quickly; do not replicate the old Sealed hero chips just to fill space.
3. **Panel and nested results:** Outer task panel contains fields and status; inner results area has a slightly darker surface, heading/sort, quota banner, cards, then Load More. Keep loading/empty/error/status copy visible and stable.
4. **Field and action grouping:** Visible labels, large inputs, coherent Search/Clear pair, contextual selectors alongside their data at tablet/desktop, thoughtful stacking on phones. Never hide controls to make the screenshot cleaner.
5. **Result cards:** Artwork, name, set/product metadata, market/condition labels, price, and actions each retain their semantic grouping. Reflow existing renderer output with CSS first. If a JS renderer needs markup hooks, add neutral classes/wrappers without changing its calculations or event handlers.
6. **Summary tiles and value panels:** Use the home/Search dark panels, clear labels, high-contrast numbers, and distinct tap affordance for breakdown. Preserve hidden-value state and accessibly named show/hide controls.
7. **Horizontal discovery:** Use overflow rails for set tabs/logos only if the control naturally browses peers; provide a visible cue that more items exist and keep keyboard navigation. Do not turn a collection grid, table, or pagination into a swipe-only control.
8. **Dangerous actions:** Clear/remove/delete retain their exact meanings and existing confirmation. Red styling can make them distinct; do not promote them to primary yellow.
9. **Modal/dialog:** Dark panel, readable price breakdown, obvious close button, trapped/returned focus as implemented, mobile viewport fit, and no background scroll problems. Preserve native `<dialog>` behavior where used.

## 5. Page-by-page implementation backlog

The table names concrete hooks to keep. Other IDs, names, data attributes, ARIA relationships, script order, and URL parameters on each page are also part of the contract. **Never rename a hook without checking every referencing script and test.**

| Order | Page / files | Visual work | Must still work |
| --- | --- | --- | --- |
| 1 | **Dex** `dex.html`, scoped `dex-refresh.css`; existing `dex-tracker-pages.js`, `search.js` only if markup demands | Compact Dex intro; bring `Cards Tracked`, `Total Copies`, `Sealed Tracked` into small responsive stats; restyle the `Search Dex` `<details>` as a clear optional tool; dark search/result panels; highlight Collection value, count and filter controls; responsive collection cards and pagination. On phones, prioritize Collection and its value, while leaving the expand-to-add search discoverable. | `#pv-dex-search-panel`, `#pv-search-form`, condition selector, result sort/grid/load more/quota, `#pv-search-collection-select`, `#pv-collection-total-value`, `#pv-collection-total-toggle`, `#pv-collection-value-dialog`, `#pv-collection-filter`, `#pv-collection-type-filter`, `#pv-collection-grid`, `#pv-collection-pagination`, Master Sets link. Preserve add/remove/quantity, cloud/local sync, shared pricing and value breakdown semantics. |
| 2 | **Sealed** `sealed.html`, scoped `sealed-refresh.css`; keep `sealed.js` | Match refreshed Card Search header and panel language. Lead with Product search; make collection selector contextual, results/sort/quota/Load More obvious; restyle watchlist and product cards. Use `Market value` for sealed, never `NM`. Distinguish Trade %, quantity, add-to-collection, and watchlist actions where the existing cards expose them. On phones, place status under the form and let filters/actions wrap cleanly. | `#pv-sealed-form`, `#pv-sealed-query`, `#pv-sealed-collection-select`, `#pv-sealed-results`, `#pv-sealed-sort-select`, `#pv-sealed-grid`, `#pv-sealed-load-more`, `#pv-sealed-favorites`, watchlist sort/toggle/clear/grid, quota banner. Preserve English product filtering, search cache/version, search quota, pricing and watchlist persistence. |
| 3 | **Sets** `sets.html`, `sets.js` | Short intro, set/series filter, grouped series cards/accordion, responsive logo treatment, focused active/hover states. | Filter, `Collapse All`, status, all set links and their destination expansion parameters; keep main's CSP meta tag. |
| 4 | **Master Sets** `master-sets.html` and **Master Set detail** `master-set.html`, `dex-tracker-pages.js` | Progress tiles/cards with readable fraction and value; compact set filter; detail overview and distinct Collected/Missing disclosure panels; stable card art and progress on mobile. | Existing set identification, progress and completion math, collected/missing counts, navigation and collection updates. |
| 5 | **Card detail** `card.html`, `card.js`, existing `price-history.css` | Dark art/detail panel, clearly grouped variant prices, responsive table with a readable small-screen alternative or contained horizontal scroll, chart and related cards. | Watchlist/Trade/share, full-size image dialog, variant table contents, price history chart, deep links, related cards. Do not change price history processing. |
| 6 | **Shared Collection** `shared-collection.html`, `shared-collection.js` | Read-only collection hero/value summary matching Dex, filter/sort row and responsive card grid; prominent value breakdown dialog. | Share token access, selector, card/sealed display, owner privacy, total/value/trend, filters, pagination, dialog, existing sealed price handling. Never expose owner-only actions. |
| 7 | **Account** `account.html`, `account.js` | Clean sign-in panel, session and premium areas; group destructive local/cloud data controls separately; mobile forms with full labels; readable admin tools without drawing attention for normal users. | Email/Google sign-in, sign-out, subscribe/manage billing, export, collection management, sharing link, delete/clear confirmations, admin role and refresh actions. |
| 8 | **Pricing** `pricing.html`, `pricing.js` | Short hero, legible Free/Premium cards, one strong CTA per context, mobile stacked benefits and restrained yellow. | Existing plan copy/prices, trial language, auth-aware CTA and Stripe flow. |
| 9 | **Contact**, **Thanks**, **Policies** `contact.html`, `thanks.html`, `policies.html` | Consistent header/typography/panels; comfortable form and confirmation view; narrow policy reading column with clear anchors. | Formspree `action` and field names, required/validation/thanks flow; every existing policy text and fragment ID (`#pv-privacyPolicy`, `#pv-termsOfUse`, `#pv-accessibility`, etc.). |
| 10 | **Home promotion** `index.html` only if separately authorized as part of a later implementation | Move the preview look into the real home route after comparing its runtime dependencies. | Existing canonical/SEO tags and main's verification meta tag, analytics, auth, home search, set links and pricing. The preview's current status is **not** equivalent to live `index.html`. |

### First implementation: Dex layout sketch in words

At 390px: sticky compact header; `Dex Explorer` plus one short line; small three-stat grid (adapt to one or two columns if values wrap); the current, discoverable `Search Dex` disclosure with its full condition and result controls; then a prominent Collection panel showing current value, amount, privacy toggle, breakdown action and selected collection; filter/sort controls; collection cards; pagination. Preserve the existing DOM and focus order through the visual update. At desktop: centered content, compact intro/stats, optional add/search panel and collection panel at comfortable widths; no empty side columns.

### Second implementation: Sealed layout sketch in words

At 390px: same site header; concise `Sealed` title; a dark search panel with labeled product input, Search/Clear, and collection context when present; results status, sort, product cards and Load More; then watchlist total and its sort/show/clear controls. At desktop: search can widen, results cards become a sensible grid, and Watchlist stays its own panel. Respect every current action and price label.

## 6. Implementation boundaries for Copilot

### File strategy

1. Read `AGENTS.md` before modifying the repository. It prohibits `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, and dynamic source execution; external strings must render with safe DOM APIs. If a new renderer touches external data, include an XSS focused check at that downstream renderer.
2. Implement one page per small change. Add a body scope, such as `.pv-dexRefresh` or `.pv-sealedRefresh`, and a page stylesheet **after** `styles.css` (and any existing component CSS). Do not import `search-refresh.css` unmodified into other pages: it is specifically scoped to `#pv-search-body.pv-searchRefresh` and contains selectors tied to Search's DOM.
3. Consolidate truly shared color/type/button/panel rules into a small scoped shared layer only after Dex and Sealed establish the reusable pattern. Keep page specific layout selectors beside each page. Do not refactor the entire ~200KB `styles.css` in the same PR.
4. Prefer CSS reflow of existing markup and dynamic cards. If a presentational wrapper/class is essential, keep all current IDs, inputs, `name`s, `data-*`, `hidden` semantics, ARIA links, and button `type`s. Avoid changes to API paths, request parameters, fetch/auth, caches, Firebase persistence, pricing helpers, item counts, sorting algorithms, pagination logic, or worker source.
5. Keep deployed CSS/JS cache-busting query versions current when the file changes. Preserve SEO, CSP, verification, ads, analytics, and canonical tags while editing HTML. Verify `auth-menu.js` and `script.js` continue to initialize once and in the current order.
6. Capture before/after screenshots of **the same branch and seeded UI state** at 320, 390, 768 and 1280px. Compare guest and signed-in UI where applicable; compare empty, loading, populated and error/quota states. If remote data is unavailable, record that limitation instead of claiming the visual state passed.

### Functional invariants and regression checks

- **Dex:** Search by name/number/set; expand/collapse; NM/LP/MP/Other selection; add/remove cards and sealed; quantities, active collections, totals and privacy toggle; breakdown dialog; filter/sort; pagination; cloud/local persistence; share link remains consistent with shared view. Never replace the existing collection value with the homepage's display-only NM rule.
- **Sealed:** Search and sort, English filtering currently in branch, correct market label and price, pagination/load more, quota banner, collection selection, watchlist persistence and value, and any rendered trade/quantity controls. Do not alter sealed pricing core or silently introduce a new search/deep-link contract.
- **Cards:** Existing Search condition choices, variant values, Trade percentage and target, watchlist, scanner, sorting, collection context and query/card/set links remain. A redesign of unrelated pages must not affect `#pv-search-body` styles.
- **Account/payment:** Guest and signed-in account menu states, sign-in, Stripe buttons, premium gates, exports and dangerous actions behave identically.
- **Shared/public routes:** A shared collection is viewable with its existing token; no editing controls leak. Card detail, set links, footer policy anchors and contact submission still resolve.
- **Security/accessibility:** No new unsafe HTML sinks; XSS text and URL probes remain inert. Check labels, heading order, focus visibility, keyboard disclosure/menu/dialog operation, `aria-live` statuses, 200% zoom, reduced motion, contrast, and no horizontal body overflow at 320px. A deliberate inner rail/table may scroll.

### Suggested sequence and definition of done per page

1. Rebase or merge the latest target branch carefully; inspect the current diff and all page scripts for DOM hooks. Save a screenshot and a list of existing interactions.
2. Add the page body scope and stylesheet with only presentational changes. Start with 390px, inspect 320px and 430px, then tablet/desktop. Test long names, absent images, empty lists, prices with many digits, validation messages, and open menus/dialogs.
3. Compare the affected HTML IDs and `name`/`data-*` hooks before and after. Any changes require a justified script review. Confirm no changed backend, worker, Firebase, pricing, or storage files in the UI-only diff.
4. Run the repository's relevant existing tests and focused static checks. Manually exercise the page's core journey in guest and signed-in states as available. An XSS-focused check is required by `AGENTS.md` if rendering external data changes.
5. Report before/after screenshots, files changed, commands/results, which states were exercised, and known unverified states. Ship that page for review before starting the next.

## 7. Acceptance checklist for the full rollout

- [ ] Dex and Sealed visually match the current home preview/Card Search direction at phone, tablet, and desktop widths.
- [ ] Each remaining page follows the same color, font, header, panel, button, focus, and spacing rules without erasing its purpose.
- [ ] No page exceeds the viewport width at 320px; deliberate rails/tables are contained and keyboard reachable.
- [ ] Every control and route listed in the page matrix works with the same data, prices, sort/filter results, saved state, and authorization as before.
- [ ] The update branch's behavioral differences are recognized and preserved or handled in a separate reviewed change; no worker or backend code is changed for this styling project.
- [ ] The live home route is represented accurately: `home-preview.html` is the current new-design reference until a separate promotion to `index.html` is completed.
- [ ] Main's verification tag and Sets CSP, plus other SEO/security/analytics metadata, survive branch integration.
- [ ] Visual, keyboard, accessibility, security, and existing regression checks have recorded results for each page.

## 8. Copy/paste prompt for Copilot: Dex first

```text
Implement only the Dex page UI refresh described in
PokeValuator_UI_Refresh_Migration_Spec.md. Compare the latest main and
card-search-home-style branches first. Read AGENTS.md, dex.html,
dex-tracker-pages.js, search.js, styles.css, home-preview.html/css, and
search.html/search-refresh.css. Treat home-preview.html as the implemented
new-home visual reference; index.html is still the older home page.

Start with 320-430px mobile layouts. Add page-scoped presentation CSS after
styles.css. Preserve Dex's DOM hooks, search/condition behavior, collection
and sealed values, quantity, cloud sync, breakdown, privacy toggle, filters,
pagination, auth, quota and all existing backend calls. Avoid backend,
pricing, Firebase, storage, and worker edits. If a renderer must change,
construct untrusted content safely and include an XSS-focused check.

Verify at 320, 390, 430, 440 768 and 1280px and exercise Dex guest/signed-in,
empty/populated, search, collection, dialog, and pagination states.
Run relevant existing tests. Report changed files, before/after screenshots,
test commands/results, and any state you could not verify. Stop after Dex
for visual review; do not restyle Sealed in the same change.
```

After Dex is reviewed, use the same process for Sealed, substituting its page specific controls and invariants from section 5. Keep the two changes separate for easier regression review.

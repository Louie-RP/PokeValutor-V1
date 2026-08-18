# PokeValuator Multi-Card Search — Implementation Specification

**Status:** Ready for controlled implementation  
**Feature scope:** Card Search page (`search.html` / `search.js`) + existing Cloudflare Worker `/cards/search` route  
**Primary input format:** Comma-separated card names, printed numbers, collector numbers, or card IDs  
**Primary constraint:** One user multi-search should produce at most one Scrydex search request on a cold cache and zero Scrydex requests on a shared-cache hit  
**Regression rule:** A one-term search must continue using the current single-search behavior unchanged

## 1. Goal

Allow a user to search for several Pokémon cards in one action, for example:

```text
Charizard, Pikachu, SWSH101, 94/165, base1-4
```

The implementation must make multi-search substantially more convenient **without multiplying Scrydex API credits**, user quota consumption, page latency, or per-card price lookups.

The safest V1 is a batch-oriented extension of the current search flow:

1. Parse and normalize comma-separated terms in the browser.
2. Build one canonical Lucene-style `OR` query.
3. Send one request to the existing Worker `/cards/search` route.
4. For multi-search only, ask the Worker to include prices in that same upstream Scrydex request.
5. Group and rank the returned cards against the user's original terms in the browser.
6. Do not automatically issue one `/cards/{id}?includePrices=1` request per result.

This keeps the new feature compatible with the existing browser cache, Upstash shared cache, Worker quota system, Scrydex dirty-token strategy, search result cards, watchlist, Dex controls, and card-detail navigation.

---

## 2. Confirmed repository findings

### Current Search page

`search.html` currently has:

- one search input: `#pv-search-query`
- optional Series / Set filters
- one Search submit button
- a results grid: `#pv-search-grid`
- a Load More button
- a Watchlist section below the search workspace

The current placeholder is a single-value example (`Pikachu or SWSH101`). V1 should update the help text/placeholder so users know commas are supported without changing the existing form structure.

### Current browser caching

`search.js` already defines:

```text
CACHE_PREFIX = pv:scrydex:
SEARCH_TTL_MS = 12 hours
CARD_TTL_MS = 24 hours
MAX_CACHE_ENTRIES = 250
```

`fetchJsonWithCache(url, ttlMs)` caches by full request URL. The multi-search implementation must continue using this function so repeated identical multi-searches can be served without contacting the Worker.

### Current number-search behavior can fan out

The existing single-number flow intentionally tries several fallbacks, including combinations of:

- promo query
- `printed_number:<value>`
- `number:<value>`
- `id:<value>`

Those fallbacks are useful for a **single** number search, but they must not be called independently for every comma-separated term. Calling the existing single-number routine N times would turn a 5-card request into many quota-consuming Worker requests.

### Current Worker `/cards/search` behavior

The Worker currently:

- accepts `q`, `page`, `pageSize`, and `lang`
- appends global `tcgp` exclusions
- selects `id,name,number,rarity,images,expansion,variants`
- applies a query-aware cache policy
- uses Upstash when configured
- hashes the canonical upstream URL into the Redis cache key
- returns `x-pv-cache: HIT|MISS|BYPASS`
- contacts Scrydex only after an Upstash miss

The existing route does **not** currently add `include=prices` for a normal card search.

### Current price hydration

`search.js` can later request:

```text
GET /cards/{id}?includePrices=1&lang=en
```

for individual cards when prices are needed. This is acceptable for the current single-search experience because those requests are cached, but it is the wrong default for a batch search because a large batch could trigger many card-detail price lookups.

### Current Worker quota behavior

Only explicit search requests with:

```text
consumeQuota=1
```

consume the normal user search allowance. Passive card-detail/watchlist/collection reads do not consume the search quota.

Therefore the new multi-search must issue **one** quota-consuming search request for one submit, not one quota request per term.

---

## 3. Scrydex behavior the design relies on

Scrydex card searches support:

- a Lucene-like `q` syntax
- `OR` groupings
- `page_size` up to 100
- `select` to limit returned fields
- `include=prices` to include variant prices

A general `/cards` request consumes one API credit under the current Scrydex credit model. The entire point of this design is to combine multiple user terms into a single general request instead of issuing separate general/card requests for each card.

---

## 4. V1 user experience

### Single search — unchanged

Input:

```text
Charizard
```

Behavior:

- use the existing single-search path
- preserve the current result ranking, pagination, number fallbacks, price-loading behavior, and URL/cache behavior

This is a hard regression boundary.

### Multi-search

Input:

```text
Charizard, Pikachu, SWSH101, 94/165
```

Behavior:

1. The form detects more than one non-empty comma-separated term.
2. The page switches to `multi` search mode.
3. Duplicate terms are removed case-insensitively.
4. A maximum of **10 unique terms** is accepted in V1.
5. One batched Worker request is made.
6. Results are grouped back under the user's original terms.
7. Exact number/card-ID matches rank ahead of broad name matches.
8. Broad name groups show a bounded number of candidates rather than automatically fetching another page.
9. The normal Search results sort control may sort cards **within each term group**, but the term groups stay in the order the user typed them.
10. The normal Load More button is hidden/disabled in multi mode. A user who wants every result for one broad term can click/use a **Search only this term** action, which returns to the existing single-search flow.

### Empty / duplicate input examples

```text
Pikachu, , Pikachu, CHARIZARD
```

becomes:

```text
Pikachu
CHARIZARD
```

The user sees two groups and only one batch request is sent.

---

## 5. Input parsing contract

Add a small, testable parser to `search.js` or an isolated helper file.

Suggested contract:

```js
parseMultiSearchInput(rawInput) -> {
    isMulti: boolean,
    originalTerms: string[],
    uniqueTerms: Array<{
        raw: string,
        normalizedKey: string,
        kind: 'name' | 'printedNumber' | 'cardId'
    }>,
    errors: string[]
}
```

### Parsing rules

- Split on commas.
- Trim leading/trailing whitespace.
- Collapse internal repeated whitespace.
- Remove empty terms.
- De-duplicate using a normalized case-insensitive key.
- Preserve the first user's spelling/casing for display.
- Limit each term to 120 characters.
- Limit V1 to 10 unique terms.
- Reject the entire multi-search if no valid terms remain.
- If only one valid term remains, route to the existing single-search path.
- Escape quotes/backslashes before inserting values into the Scrydex query.
- Do not interpret raw user text as HTML.

### V1 delimiter limitation

A comma is a delimiter in V1. Card names containing a literal comma are not specially quoted/escaped by the UI in the first release. This can be expanded later with newline/semicolon support or a tokenized input control without changing the API design.

---

## 6. Term classification

The browser should classify each term only to build a compact query. Final matching/ranking still happens against returned data.

### Card ID

Examples:

```text
base1-4
sv3-125
```

Likely shape:

```text
letters/digits/etc + hyphen + collector portion
```

Query clause:

```text
id:"base1-4"
```

### Printed / collector number

Examples:

```text
94/165
094/165
SWSH101
TG05/TG30
```

For slash values, query both the printed representation and the number component where useful:

```text
(printed_number:"94/165" OR number:"94")
```

For promo-like alphanumeric numbers:

```text
(printed_number:"SWSH101" OR number:"SWSH101")
```

### Name

Examples:

```text
Charizard
Pikachu ex
Mewtwo VSTAR
```

Query clause:

```text
name:"Pikachu ex"
```

Do not require exact-name syntax in V1 because the existing product experience intentionally supports broader name matching and multiple printings.

---

## 7. Canonical batch query

For:

```text
Pikachu, 94/165, base1-4
```

construct one logical query such as:

```text
(
  name:"Pikachu"
  OR (printed_number:"94/165" OR number:"94")
  OR id:"base1-4"
)
```

The actual string sent to the Worker should be single-line and URL-encoded.

### Optional selected Set

If the user has selected a set, reuse the existing expansion filter and apply it to the whole group:

```text
expansion.id:sv3 (
  name:"Charizard"
  OR printed_number:"125/197"
)
```

Do not create one API request per term just because a set is selected.

### Series filter

Preserve the existing Series → Set UI behavior. If the Series selection currently resolves into a set/expansion query through existing code, reuse that code rather than inventing a second series-query implementation.

### Canonicalization for shared cache reuse

Two users entering:

```text
Pikachu, Charizard
```

and:

```text
Charizard, Pikachu
```

should ideally produce the same Worker URL/cache key.

Implementation rule:

- preserve original term order for UI groups
- separately create a canonical list sorted by normalized term key for the request query
- build the Worker URL from the canonical list

That increases browser/Upstash cache reuse while preserving the user's display order.

---

## 8. Worker changes

Do **not** add a second proxy service or one endpoint per card.

Extend the existing:

```text
GET /cards/search
```

with two optional frontend-controlled flags:

```text
batch=1
includePrices=1
```

Suggested multi-search URL:

```text
/cards/search?q=<canonical-q>&page=1&pageSize=100&lang=en&batch=1&includePrices=1&consumeQuota=1
```

### `batch=1`

Purpose:

- identifies the new controlled multi-search mode
- enables stricter page-size/query validation if desired
- allows a batch-specific cache TTL/telemetry path without affecting single search

It does not need to be forwarded to Scrydex.

### `includePrices=1`

When `batch=1` and `includePrices=1`:

```js
upstream.searchParams.set('include', 'prices');
```

Also expand the selected fields to include the number fields needed for client-side grouping:

```text
id,name,number,printed_number,rarity,images,expansion,variants
```

Keep `casing=camel` so `printed_number` is consumed by the frontend consistently as `printedNumber` if Scrydex applies casing conversion.

### Important: do not change normal search pricing yet

Normal/single `/cards/search` requests should keep their current response shape and behavior in the initial PR.

Only batch mode requests include prices. This isolates the larger response payload to the use case where it prevents many follow-up requests.

### Cache policy

Add an optional environment variable:

```text
CACHE_TTL_MULTI_SEARCH_SECONDS=86400
```

Recommended default: 24 hours.

Reasoning:

- this is a new route mode, so it does not change current single-search freshness
- batch results contain pricing and are more expensive to reconstruct with per-card calls
- a shared cache is the strongest protection against repeated popular multi-searches

If 24-hour freshness is not acceptable during canary testing, start with the current `CACHE_TTL_SEARCH_SECONDS` and promote the batch TTL later. Do not shorten existing cache TTLs as part of this feature.

### Cache key

The current Worker hashes the upstream URL. Because `include=prices`, `select`, query, page, and page size are part of the upstream URL, the batch response naturally gets a distinct cache key from a metadata-only single search.

Recommended scope name:

```text
pv:scrydex:search:batch:v1:<hash>
```

or keep the existing default search scope if no extra telemetry is required.

### Dirty-token behavior

Continue including the current dirty token in the cache seed. For global multi-searches with no expansion ID in the query, optionally include the global dirty token for `batch=1` so webhook/manual refresh invalidation can invalidate price-containing batch caches before TTL expiry.

### Cache-hit contract

- Upstash HIT: zero Scrydex call
- Cloudflare edge HIT on the upstream request: no origin work at Scrydex if Cloudflare can satisfy it
- cold shared-cache miss: one Scrydex `/cards` search request

---

## 9. Hard API-credit guardrails

These rules are requirements, not optimizations.

### One request per submit

A multi-search submit may make:

```text
1 x /cards/search?...batch=1&includePrices=1&consumeQuota=1
```

It must **not** do this:

```text
/cards/search?term=A
/cards/search?term=B
/cards/search?term=C
/cards/A?includePrices=1
/cards/B?includePrices=1
/cards/C?includePrices=1
```

### No automatic per-result price hydration in multi mode

Add a guard to the result-card pricing path:

```text
if multi mode AND batch response already contains usable variant prices:
    render those prices
    do not fetch /cards/{id}?includePrices=1
```

If a specific returned card unexpectedly has no usable price data in the batch payload:

- render `Price unavailable` / existing unavailable state
- do **not** silently issue a per-card price request in multi mode

An explicit user action can later open that card's detail page, where the existing card-detail cache behavior remains available.

### No automatic page 2+

V1 multi-search does not auto-fetch additional result pages.

If the batch result is broad/truncated:

- show a message such as `More matches may exist. Search this term by itself to view all results.`
- let the user explicitly switch that term to the existing single-search flow

### No retries that multiply credits

The browser may retry only for transport-level failures if the existing fetch layer already has a bounded retry policy. Do not add term-by-term fallback retries in multi mode.

### De-duplicate before the request

Ten repeated `Pikachu` entries must remain one query term.

---

## 10. Result grouping and ranking

Scrydex returns one flat array. The browser maps cards back to user terms without another network call.

Suggested structure:

```js
{
  mode: 'multi',
  terms: [
    {
      raw: '94/165',
      kind: 'printedNumber',
      cards: [...],
      exactCount: 2,
      truncated: false
    }
  ]
}
```

### Matching rules

#### Card ID term

Rank:

1. exact normalized `card.id`
2. no fuzzy ID fallback

#### Printed number term

Rank:

1. exact normalized `printedNumber`
2. exact normalized `number`
3. equivalent zero-padded printed-number form
4. other candidates only if returned by the batch query and clearly related

Reuse the existing number-normalization logic where possible so `94/165` and `094/165` behave consistently with today's single search.

#### Name term

Rank:

1. normalized exact name
2. name starts with term
3. name contains term
4. remaining query matches

Do not introduce an expensive fuzzy-search library in V1.

### Duplicate returned cards

One card may match two user terms. It may appear under both groups for clarity, but the internal card object should be reused by ID rather than storing duplicate large payloads.

---

## 11. UI changes

### Search input

Update placeholder/help copy to something like:

```text
e.g., Pikachu, Charizard, SWSH101
```

Add a small hint:

```text
Search up to 10 cards at once — separate names or card numbers with commas.
```

### Results title

Examples:

```text
Results for 4 searches
```

or:

```text
Multi-card results
```

### Term groups

Each term group should have:

- requested term heading
- match count shown from the loaded batch
- existing card result cards
- empty-state message if no card matched that term
- optional `Search only this term` button/link for broad or unresolved searches

Build all group DOM using `createElement`, `textContent`, and validated attributes. Do not use `innerHTML` with API/user values.

### Load More

- single mode: unchanged
- multi mode: hidden/disabled

### Clear Results

Clearing results returns the page to normal single-search mode but must not clear Watchlist or the future Trade workspace.

---

## 12. Interaction with Watchlist, Dex, and Trade workspace

### Watchlist

No storage schema change is required.

Adding a batch result to Watchlist should use the already-loaded card snapshot. Do not fetch the card again just to save it.

### Dex controls on Search page

Preserve the current Search/Dex shared code and existing collection controls. Multi-search is a Search-page mode, not a Dex-state migration.

### Trade workspace

The Trade Section spec adds a persistent local trade workspace. When a batch result is later added to Trade, reuse its already-loaded price/variant data. Do not fetch again.

---

## 13. Performance requirements

- One multi submit produces at most one Worker card-search request.
- Cold Worker shared-cache miss produces at most one Scrydex card-search request.
- Shared-cache hit produces zero Scrydex requests.
- Browser-cache hit produces zero Worker requests.
- No automatic per-card price hydration in multi mode.
- No automatic page 2+ in multi mode.
- Maximum 10 unique terms.
- Maximum page size 100.
- Result rendering should reuse the existing card components/helpers rather than duplicate a second full result-card renderer.
- Avoid adding a new third-party library.
- Keep single-search first-render behavior unchanged.

---

## 14. Error and edge-case behavior

### More than 10 terms

Reject before network activity with a clear message:

```text
You can search up to 10 cards at once. Remove a few entries and try again.
```

Do not silently discard terms.

### All terms empty

No request. Show the existing required-query message.

### One unique term after de-duplication

Use the normal single-search path.

### Broad number like `25`

Allow it, but group/rank exact number matches and warn that numbers can exist in many sets. A selected Set filter should narrow the same batch query.

### Broad names

If 100 total results are reached, mark the batch as potentially truncated and offer `Search only this term` instead of automatically requesting another page.

### Scrydex / Worker error

Display one multi-search-level error. Do not fall back to N separate requests.

### Partial term matches

A failed group does not hide successful groups. Show `No matches in this batch` for the unmatched term.

### Price missing

Show unavailable pricing for that card. No hidden per-card network fallback in multi mode.

---

## 15. Security requirements

Follow repository `AGENTS.md` guardrails:

- no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, or `document.write` for user/API/storage values
- use `createElement` / `PV_DOM` helpers and `textContent`
- treat the comma input, API card names, API image URLs, localStorage values, and Firebase values as untrusted
- validate image/link protocols with existing URL helpers
- escape Scrydex query values before constructing `q`
- add an XSS-focused static or behavior test for multi-result headings and card data

The Worker must continue to keep Scrydex API credentials server-side.

---

## 16. Feature flag and rollback

Add a frontend flag without replacing the existing object:

```js
window.PV_FEATURES = Object.assign({}, window.PV_FEATURES, {
    multiCardSearch: false,
});
```

### Rollout

1. Implement with flag `false`.
2. Test locally/staging with mocked Worker responses.
3. Enable for admin/tester traffic first if the app has an existing role-aware flag mechanism; otherwise enable only after manual canary verification.
4. Monitor Worker `x-pv-cache` behavior and Scrydex usage.
5. Enable publicly.

### Emergency rollback

1. Set `multiCardSearch: false`.
2. Existing one-term search remains untouched.
3. Worker support for ignored optional `batch/includePrices` parameters can remain deployed safely or be removed later.

---

## 17. Recommended implementation sequence

### Phase 0 — tests before behavior change

Add parser/query-builder unit/static tests covering:

- one term
- multiple names
- mixed name + printed number + card ID
- duplicates
- empty terms
- quote/backslash escaping
- max-term rejection
- set filter composition

### Phase 1 — isolated parsing/query builder

In `search.js` or a small `multi-card-search.js` module:

- parse comma input
- classify terms
- create canonical request terms
- create display-order terms
- build the single OR query

No Worker change is required to test this logic.

### Phase 2 — Worker batch price support

Update `/cards/search`:

- recognize `batch=1`
- recognize `includePrices=1` only in the controlled search path
- set Scrydex `include=prices`
- add `printed_number` to `select`
- keep existing exclusions
- keep current auth/quota behavior
- reuse Upstash
- optionally add batch-specific 24h TTL
- include global dirty token for price-containing global batch queries if desired

### Phase 3 — multi-search execution

When parser returns `isMulti=true`:

- send one page-1 request with pageSize 100
- set `consumeQuota=1` exactly once
- set `batch=1&includePrices=1`
- persist the result through the existing URL cache
- group cards locally

### Phase 4 — multi-result renderer

- reuse existing card rendering primitives
- add group wrappers/headings safely
- hide Load More in multi mode
- prevent automatic individual price hydration
- preserve single-mode renderer exactly

### Phase 5 — cache/credit verification

Using browser Network + Worker diagnostics:

1. Cold multi-search: exactly one `/cards/search` request from browser.
2. Verify no automatic `/cards/{id}?includePrices=1` calls.
3. Repeat same search: browser cache should avoid Worker if still fresh.
4. Clear browser cache but keep Upstash: Worker should report `x-pv-cache: HIT`.
5. Reverse term order: canonicalized URL should hit the same cache entry.
6. Check Scrydex usage before/after a cold batch to confirm expected credit behavior.

### Phase 6 — production canary

Enable for a small test path, verify latency and payload size, then enable broadly.

---

## 18. Tests and acceptance criteria

### Functional

- [ ] `Pikachu` still follows the existing single-search behavior.
- [ ] `Pikachu, Charizard` runs in multi mode.
- [ ] Name + number + card-ID mixes work in one submit.
- [ ] Duplicate terms are de-duplicated.
- [ ] Results are grouped in the user's original term order.
- [ ] Exact printed-number/card-ID matches rank first.
- [ ] Set filter applies to the whole batch.
- [ ] No-match terms show an independent empty state.
- [ ] `Search only this term` switches to normal single search.
- [ ] Clear Results exits multi mode.

### API / credits

- [ ] One multi submit creates exactly one `/cards/search` browser request.
- [ ] That request has exactly one `consumeQuota=1`.
- [ ] Worker makes at most one Scrydex `/cards` request on cold cache.
- [ ] Multi batch asks Scrydex for prices in the same request.
- [ ] Multi renderer does not issue automatic `/cards/{id}?includePrices=1` requests.
- [ ] Upstash HIT makes zero Scrydex calls.
- [ ] Reordered equivalent terms reuse the same canonical cache URL/key.
- [ ] No automatic page 2 request occurs.

### Regression

- [ ] Existing name search unchanged.
- [ ] Existing number/promo fallback unchanged for one term.
- [ ] Existing Load More unchanged for single search.
- [ ] Search sorting unchanged for single search.
- [ ] Watchlist add/remove still works.
- [ ] Watchlist totals still work.
- [ ] Search-to-card navigation still works.
- [ ] Dex controls on Search page still work.
- [ ] Scanner-assisted search still works.
- [ ] Auth/quota banners still work.
- [ ] Mobile layout remains usable.

### Security

- [ ] Malicious input such as `<img src=x onerror=alert(1)>, Pikachu` renders as text only.
- [ ] Malicious API card name/storage values render as text only.
- [ ] No new unsafe HTML sink is introduced.
- [ ] Worker API credentials remain server-side.

---

## 19. Observability

Do not add a second analytics service just for this feature.

Useful existing signals:

- `x-pv-cache`
- `x-pv-quota-tier`
- `x-pv-quota-used`
- `x-pv-quota-remaining`
- Scrydex account usage
- browser Network request count

Optional lightweight Worker log fields for `batch=1`:

```text
mode=batch
termCount=<N>
pageSize=100
cache=HIT|MISS|BYPASS
upstreamCalled=true|false
```

Never log Firebase tokens, API keys, or raw client IPs.

---

## 20. Files expected to change during implementation

```text
search.html
search.js
styles.css
feature-flags.js
Cloudflare Worker source/deployment
new multi-search tests
```

Optional isolated helper:

```text
multi-card-search.js
```

If an isolated helper is added, load it before `search.js` and expose only a small namespaced API such as `window.PV_MULTI_SEARCH`.

---

## 21. Out of scope for V1

- unlimited comma terms
- automatic multi-page retrieval
- fuzzy/AI card-name correction for every term
- one API request per term
- background price refresh for every returned card
- bulk grading/PSA valuation
- sharing a multi-search URL between users
- saving named multi-search presets

These can be added later without changing the one-batch-request foundation.

---

## 22. Final implementation rule

**Never implement multi-card search by looping over the existing single-card search function and awaiting it once per comma term.**

The defining architecture of this feature is:

```text
many user terms
      ↓
one canonical OR query
      ↓
one Worker /cards/search request
      ↓
one cached Scrydex search containing prices
      ↓
client-side grouping and totals/rendering
```

That is the version that adds useful functionality while protecting Scrydex credits and keeping the Search page responsive.
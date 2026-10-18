# Shared priced set cache implementation plan

## Scope and acceptance criteria

- Scarlet & Violet and Mega Evolution are separate series. Cache each eligible
  English expansion independently; never fetch an entire series on a search.
- Populate on known-set searches, individual-card requests, and top-by-expansion
  requests. Broad name/number searches without a set remain unchanged.
- Request all pages with `page_size=100` and `include=prices`. Ascended Heroes
  currently has 295 card records, so a successful cold load needs three general
  requests, not 295 individual-card requests.
- Share one complete snapshot across users and the three routes. Return only
  the requested results and preserve pagination, auth, quota, CORS, exclusions,
  name matching, variants, and existing downstream safe DOM rendering.
- Require Redis and an explicit feature flag. Disabled, unsupported queries,
  other series, other languages, and explicit `cache=no-store` retain the
  existing paths. Do not bulk prewarm all sets.

## Implementation sequence

1. Run existing search/pagination/cache regression checks.
2. Add a feature-gated snapshot loader. Check candidate set IDs, then validate
   authoritative expansion series/language metadata on every returned card.
   Require consistent totals and unique IDs; publish only complete snapshots.
3. Use a distributed Redis lease to prevent concurrent cold requests from
   multiplying upstream calls. Bound upstream pagination and request time.
   Report upstream, incomplete-data, Redis, and busy errors explicitly instead
   of silently issuing individual-card fallback requests.
4. Integrate conservative, fully parsed set/name queries, individual-card
   lookups, and top-card ranking. Unsupported Lucene expressions retain their
   existing upstream semantics rather than being approximated locally.
5. Add direct-module mocked behavior tests, including three-page/295-card
   economics, cross-route reuse, independent sets, pagination and filtering,
   both series, eligibility checks, no-store/disabled behavior, concurrency,
   failure recovery, expiry, and dirty-version invalidation.
6. Run related static regressions, downstream XSS structural checks, and syntax
   checks. No paid API calls or production deployment during local validation.

## Freshness and rollout

- Snapshot freshness defaults to 20 hours. Long-lived metadata cache policies
  must not be applied to priced snapshots.
- Include the existing expansion dirty version in snapshot keys. Browser
  response max-age is the snapshot's remaining lifetime, not a new 20 hours on
  every hit. Existing browser-local caches can still delay observing webhooks;
  this change does not promise immediate client invalidation.
- Enable `SET_PRICE_CACHE_ENABLED=1` only after deploying the updated Worker
  with working Upstash credentials. Leave unset/0 for rollback.
- Existing ignored local Worker source is deployed separately from GitHub
  Pages. Do not accidentally publish credentials or change repository ignore
  policy as part of this feature.
- Verify a cold eligible set, a second card, a second user, selected-set name
  search, pagination, and top cards. Inspect `x-pv-cache` and actual upstream
  request counts. Scrydex usage reporting may lag 20-30 minutes.
- This cache covers current prices, not historical-price endpoints or sealed
  products. Redis/storage operations still have their own costs.

## Separate follow-up: popularity tracking (not implemented here)

Design an opt-in aggregate counter for explicit user searches by set ID and
card ID, with daily buckets, bounded retention, and top-N reporting. Separate
user searches from passive card loads, retries, pagination, and cache warming.
Do not store raw search strings, IP addresses, tokens, or user identifiers.
Decide retention, admin reporting, and write-cost limits before implementation.
Use those aggregates to evaluate which older series/sets merit shared caching.

## Local verification

Implemented in the local Worker, with opt-in rollout documented in the README.
The direct-import `set-price-cache-worker.test.mjs` suite covers the acceptance
criteria using mocked Scrydex and Redis, without evaluating copied source text.
Related search, Dex, home handoff, scanner, watchlist, and price-history
regressions are also checked. Tests verify safe downstream rendering in
`search.js` and `card.js`; no frontend HTML rendering changes are needed.

Live Cloudflare/Upstash sizing, latency, and account billing still require a
controlled production canary. No mock test establishes those production
properties. Popularity data collection is not enabled by this change.

## Sources

- [Credits](https://scrydex.com/docs/getting-started/api-credits)
- [Card search and pagination](https://scrydex.com/docs/pokemon/cards#search-cards)
- [Pricing opt-in](https://scrydex.com/docs/getting-started/prices)
- [Caching](https://scrydex.com/docs/getting-started/best-practices#caching)
- [Images](https://scrydex.com/docs/getting-started/best-practices#images)
- [Rate limits and delayed usage](https://scrydex.com/docs/getting-started/rate-limits)
- [Price webhooks](https://scrydex.com/docs/pokemon/webhooks#prices)

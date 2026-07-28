# Implementation Steps

## Phase 1 — Create a safe branch

1. Create a new branch from the current `dev` branch, for example:

   ```text
   feature/nm-price-history
   ```

2. Do not work directly on `main`.
3. Save a copy of the currently deployed Worker before replacing it.

## Phase 2 — Add the isolated frontend files

1. Add `price-history.js` to the same public directory as `card.js`.
2. Add `price-history.css` beside `styles.css`.
3. Add or merge `feature-flags.js`.
4. Initially set:

   ```js
   priceHistory: false
   ```

5. Apply `card.js.patch`.
6. Apply `card.html.patch`.
7. Confirm the normal card page still loads while the frontend flag is false.

## Phase 3 — Deploy the Worker disabled

1. Replace the Worker source with `worker.js`, or apply `worker.patch` carefully.
2. Confirm the existing Worker secrets remain configured:

   ```text
   SCRYDEX_API_KEY
   SCRYDEX_TEAM_ID
   UPSTASH_REDIS_REST_URL
   UPSTASH_REDIS_REST_TOKEN
   FIREBASE_PROJECT_ID
   ```

3. Add the recommended history variables:

   ```text
   SCRYDEX_PRICE_HISTORY_ENABLED=0
   CACHE_TTL_SCRYDEX_PRICE_HISTORY_SECONDS=86400
   CACHE_RETENTION_SCRYDEX_PRICE_HISTORY_SECONDS=259200
   SCRYDEX_PRICE_HISTORY_MAX_UPSTREAM_REQUESTS_PER_DAY=25
   SCRYDEX_PRICE_HISTORY_LOCK_SECONDS=20
   SCRYDEX_PRICE_HISTORY_FAIL_OPEN=0
   SCRYDEX_PRICE_HISTORY_ALLOW_NO_REDIS=0
   ```

4. Deploy.
5. Smoke-test existing card, search, Dex, current pricing, and TCGGO routes.

## Phase 4 — Test the entitlement boundary

With the Worker history flag still disabled, verify:

1. Anonymous requests cannot retrieve history.
2. Basic/free requests cannot retrieve history.
3. Premium/admin/tester tokens are recognized.
4. Non-NM requests are rejected.
5. No existing route changed behavior.

## Phase 5 — Canary enablement

1. Set:

   ```text
   SCRYDEX_PRICE_HISTORY_ENABLED=1
   ```

2. Keep the frontend `priceHistory` flag false.
3. Test the endpoint directly using an admin or tester token.
4. Use one known card and confirm:
   - first call is `MISS`
   - second call is `HIT`
   - another variant is served without another Scrydex call
   - response contains only NM rows
5. Review Worker logs and daily budget counter.

## Phase 6 — Enable the frontend for internal testing

1. Set frontend:

   ```js
   priceHistory: true
   ```

2. Test as anonymous, basic, premium, tester, and admin.
3. For anonymous/basic users, confirm there is no history request in the Network panel.
4. For premium roles, confirm no history request occurs until **View NM Price History** is clicked.
5. Test 7D/30D/90D without additional requests.
6. Test desktop and mobile.

## Phase 7 — Release

1. Open a PR from the feature branch to `dev`.
2. Run regression testing in the dev environment.
3. Merge dev to main only after acceptance criteria pass.
4. Monitor:
   - Worker `403`, `429`, and `5xx` responses
   - Scrydex credit usage
   - Upstash cache hits/misses
   - card-page errors

## Rollback

1. Set `SCRYDEX_PRICE_HISTORY_ENABLED=0`.
2. Set frontend `priceHistory=false`.
3. If needed, remove the `price-history.css`, `feature-flags.js`, and `price-history.js` references from `card.html`.
4. Leave the harmless `pv:card-loaded` event in place or revert `card.js.patch`.

## Later cleanup — separate PR

After a stable release, remove the old localStorage browser-observed history code from `card.js`. Do not perform this cleanup in the first feature PR.

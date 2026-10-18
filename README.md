# PokeValutor-V1

Overview
- Project website scaffold for GitHub Pages with accessible HTML, CSS, and JS.

Files
- [index.html](index.html): Semantic layout with header, main, footer, unique ids/classes, skip link, ARIA.
- [styles.css](styles.css): Responsive design, strong contrast, focus styles, reduced-motion support.
- [script.js](script.js): Nav toggle with ARIA sync, footer year, basic form handling.

Local Preview
1. Open index.html in a browser, or use a simple server:

```bash
# Python 3
python -m http.server 8080
# Then visit http://localhost:8080
```

### Home search handoff

Home card and sealed searches pass the original search text to their full search
pages using the `query` URL parameter. Sealed product links carry the product name.
Restored home previews rebuild these links from the saved query, including previews
saved before query links were supported. Card Search (including Dex search) and
Sealed Search prefill URL text queries instead of automatically spending search
credits. The user selects **Search** to run them; unrelated saved results are not
restored over the supplied query. Direct card and set links retain their existing
behavior. Clearing results removes the saved search and recognized search handoff
parameters, preserving unrelated query parameters and the URL hash. Without a text
query, the pages continue restoring saved results where supported.

Run `node --test home-search-handoff-static.test.mjs` for handoff and safe-rendering checks.

### Card Search pagination

[Card Search](search.html) uses the same responsive page sizes as the Dex:
36 cards below 768px and 60 cards on desktop. First, Previous, Next, and Last
controls appear above and below nonempty results, including "Page 1 of 1" with
disabled navigation when the loaded cards fit on one page.
Sorting applies to all loaded cards before pagination; changing the sort returns
to page 1. Crossing the mobile breakpoint keeps the first visible card's position
within the new page size.

Pages browse already-loaded results without consuming search quota. **Load More**
keeps the existing API batch sizes, merges additional matches, and returns to
page 1 and the top of Results so newly loaded high-priced cards are not missed.
Search pagination resets for a new search or cleared results.

Run `node --test search-pagination-static.test.mjs dex-pagination-static.test.mjs shared-collection-pagination-static.test.mjs`
for the responsive-size, boundary, sorting-wiring, and safe-rendering checks.

### Sealed Search pagination

[Sealed Search](sealed.html) uses the same pagination and page sizes as Card Search:
36 result tiles on mobile and 60 on desktop. Product variants become separate
tiles before sorting and pagination, so every variant remains reachable. Controls
appear above and below nonempty results, including single-page results. Sorting
returns to page 1; resizing retains the first visible position within the new size.

Page navigation browses loaded products without additional API requests.
**Load More** keeps the existing 10-product API batches, re-sorts all loaded
variants, returns to page 1, and scrolls/focuses the Results heading below the
sticky header. Reduced-motion preferences are respected. A failed load preserves
the current page for retry, and a new search or Clear discards stale responses.

Run `node --test sealed-pagination-static.test.mjs search-pagination-static.test.mjs`
for the pagination wiring and downstream safe-rendering checks.

### Shared Pricing navigation button

The gold Pricing navigation button is styled in [styles.css](styles.css).
Page-specific navigation appearance rules must exclude
`.pv-nav__link--pricing` using `:not(.pv-nav__link--pricing)` so they cannot
replace its dark text or gold background, including hover, focus, and current-page states.
Run `node --test pricing-nav-contrast-static.test.mjs` to check all page themes
and their stylesheet cache versions.

Deploy to GitHub Pages
1. Commit and push to main.
2. In GitHub, Settings → Pages → Source: **GitHub Actions**.
3. Add the Firebase secrets listed below.
4. Push again and open the provided Pages URL.

## Google Search Console setup

Search Console submission is a manual Google action, but this repo is prepared for it:
- [sitemap.xml](sitemap.xml) exists at `https://www.pokevaluator.com/sitemap.xml`
- [robots.txt](robots.txt) references that sitemap

Recommended steps:
1. Open Google Search Console and add your property (`https://www.pokevaluator.com`).
2. Verify ownership (DNS TXT verification is preferred for long-term stability).
3. In Search Console, go to **Sitemaps** and submit `https://www.pokevaluator.com/sitemap.xml`.
4. Use **URL Inspection** on key pages (home/search/card/dex/sealed) and request indexing if needed.
5. Re-submit sitemap after major URL structure changes.

## Security / secrets (read this)

- Anything committed to this repo can be viewed on GitHub, and may be downloadable from the GitHub Pages site if someone guesses the filename (for example, `/README.md`).
- Firebase web apps do have a *public* config, but committing a real Google API key to a public repo is still a bad idea: GitHub is scanned and keys get harvested/abused.
- If a key is ever committed (even briefly), rotate/revoke it immediately because git history can preserve it.
- Always restrict any Google API key in Google Cloud Console (HTTP referrers + API restrictions).
- Never commit credentials or secret values such as:
	- Service account JSON keys (e.g. `serviceAccountKey.json` / `firebase-adminsdk-*.json`)
	- `.env*` files, Cloudflare Worker `.dev.vars`, or any API keys/tokens
	- Private key/cert files like `*.pem`, `*.key`, `*.p12`, `*.pfx`

If a real secret is ever committed (even briefly), rotate it immediately because git history can preserve it.

### GitHub Pages: deploy without committing Firebase keys
This repo includes a GitHub Actions workflow that deploys Pages and **generates** `firebase-config.js` from GitHub Secrets at deploy time:
- Workflow: [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml)
- GitHub repo settings: Settings → Pages → Source: **GitHub Actions**

Create these GitHub Secrets (Settings → Secrets and variables → Actions):
- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_APP_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID` (optional)

## Firebase Accounts (Auth + Firestore)

This repo now includes a simple Firebase Auth + Firestore integration designed to work on GitHub Pages (no build step).

### 1) Create a Firebase project
1. Firebase Console → Add project.
2. Build → Authentication → Get started.
3. Enable providers:
	 - Email/Password
	 - Google

### 2) Create a Web App + paste config
1. Firebase Console → Project settings → Your apps → Add app → Web.
2. Copy the config values.
3. Put them in GitHub Secrets (recommended) so they are injected at deploy time.

For local development, copy [firebase-config.local.example.js](firebase-config.local.example.js) to `firebase-config.local.js` and paste values there.

### Local test login autofill (dev only)

For easier account-page testing, add test credentials in your local, git-ignored [secrets.js](secrets.js):

```js
window.PV_SECRETS = {
	PV_API_URL: "https://your-worker-url",
	PV_TEST_AUTH_EMAIL: "your-test-email@example.com",
	PV_TEST_AUTH_PASSWORD: "your-test-password"
};
```

Notes:
- This only auto-fills on `localhost` / `127.0.0.1`.
- The credentials are never committed because `secrets.js` is in `.gitignore`.
- Avoid using a production admin account for local autofill.

### 3) Set up Firestore
1. Firebase Console → Build → Firestore Database → Create database.
2. Start in "production" mode.

Suggested rules (users can only access their own data):

```rules
rules_version = '2';
service cloud.firestore {
	match /databases/{database}/documents {
		match /users/{userId}/{document=**} {
			allow read, write: if request.auth != null && request.auth.uid == userId;
		}
	}
}
```

### 4) Use the Account page
- Visit [account.html](account.html)
- Sign up/sign in
- When signed in, your Watchlist on Cards/Sealed will sync to Firestore (and still keep local storage as a fallback).
- Dex Collection + Master Sets now sync to Firestore as account data too, so tracker progress follows the signed-in user across devices.

Firestore subcollections used:
- `users/{uid}/cardWatchlist`
- `users/{uid}/sealedWatchlist`
- `users/{uid}/dex/state` (document containing `collection` + `masterSets`)

Legacy (migration only): older accounts may still have data in these collections:
- `users/{uid}/cardFavorites`
- `users/{uid}/sealedFavorites`

## Cloudflare Worker: Auth-gated quotas

The Worker is designed to enforce quotas server-side using a Firebase ID token.

### Required Worker env vars
- `SCRYDEX_API_KEY`
- `SCRYDEX_TEAM_ID`

### Auth + quota vars
- `REQUIRE_AUTH` (set to `1` to require sign-in for all non-`/health` requests)
- `ALLOW_ANON` (default `1` when `REQUIRE_AUTH=0`; allows anonymous access)
- `ANON_DAILY_LIMIT` (default `10` when `ALLOW_ANON=1`)
- `ANON_QUOTA_SALT` (optional secret; improves privacy for anonymous quota keys)
- `FIREBASE_PROJECT_ID` (your Firebase project id)
- `FREE_DAILY_LIMIT` (default `60`)
- `PREMIUM_DAILY_LIMIT` (default `600`)

### Strongly recommended for real quota enforcement
Configure Upstash Redis so quota counters persist across Worker instances:
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

### Price freshness invalidation (webhook-driven)
The Worker now supports cache invalidation versions driven by Scrydex price webhooks.

Worker uses these optional vars:
- `CACHE_TTL_CARD_PRICES_SECONDS` (default `21600` / 6h)
- `CACHE_TTL_SEALED_PRICES_SECONDS` (default `21600` / 6h)

Firebase Functions webhook config:
- `SCRYDEX_WEBHOOK_SECRET` (required to verify `X-Scrydex-Signature`)
- `SCRYDEX_DIRTY_TTL_SECONDS` (optional, default `1209600` / 14d)

Set these as Functions environment variables (not `functions.config()`, which is deprecated).

Functions endpoint:
- `https://<region>-<project>.cloudfunctions.net/scrydexWebhook`

What happens on webhook receipt:
1. Signature is verified.
2. Event id is deduped in Firestore (`scrydexWebhookEvents/{eventId}`).
3. For `pokemon.expansions.prices.raw_updated` and `pokemon.expansions.prices.graded_updated`, dirty version keys are bumped in Upstash:
	- `pv:scrydex:dirty:expansion:{expansionId}:v1`
	- `pv:scrydex:dirty:global:v1`

Worker cache keys for price-bearing routes now include these versions, so updated expansions bypass stale cached payloads without fully disabling caching.

### Shared current-price cache for recent-series sets

See the [implementation plan](docs/SHARED_SET_CACHE_IMPLEMENTATION.md) for scope,
rollout, tests, and the separate popularity-tracking follow-up.

The local `scrydex-worker.js` supports optional, demand-driven **per-set**
snapshots for the English **Scarlet & Violet** and **Mega Evolution** series.
These are two series containing multiple sets; a lookup loads only the requested
set, not an entire series. Candidate IDs use the `sv`/`me` naming families; the
returned expansion's series and English language metadata must also qualify.

Worker variables:
- `SET_PRICE_CACHE_ENABLED=1` enables the feature; unset/`0` keeps legacy behavior.
- Upstash credentials above are required; without them the legacy paths remain.
- `CACHE_TTL_SET_PRICES_SECONDS` defaults to `72000` (20 hours); shorter positive
  values are supported for canary testing, and values above 20 hours are capped.

Known-set searches, individual-card lookups, and top-by-expansion requests share
complete snapshots fetched with prices and 100 cards per page. A 295-card set
uses three upstream requests on a successful cold refresh. Later covered
lookups require no Scrydex requests until expiration or expansion webhook
invalidation. Broad searches, unsupported Lucene expressions, older series,
other languages, sealed products, history, and explicit `cache=no-store` keep
their existing paths. Search quotas still count explicit user searches, even
when the data comes from Redis.

Refreshes are limited to ten pages, with an eight-second timeout per upstream
request and a 120-second distributed lease. Concurrent requests wait up to five
seconds for a completed snapshot before receiving a retryable 503. A failed
refresh never publishes partial data or silently falls back to more paid
requests; its lease expires within 120 seconds. Redis failures surface as errors
while the feature is enabled. Roll back by setting the flag to `0`.

`x-pv-cache` reports `MISS` for a newly populated snapshot and `HIT` for reuse.
`/health` reports `setPriceCacheEnabled`. Response freshness is the snapshot's
remaining lifetime; existing browser-local caches still have their own lifetimes
and do not observe webhooks immediately.

The Worker source is intentionally git-ignored in this repository and must be
deployed separately to Cloudflare; deploying GitHub Pages does not deploy it.
No production deployment or paid canary fetch is performed by these tests.

Run the behavior suite with a direct module import (Node 20):

```powershell
node --experimental-default-type=module --test set-price-cache-worker.test.mjs
```

### Card and set popularity (admin reports)

The local Worker supports aggregate popularity collection, separately from
Scrydex caching. Enable `POPULARITY_TRACKING_ENABLED=1` as a Cloudflare Worker
**Text** variable after deploying the updated Worker and the site scripts.
Upstash credentials are required. Leave the flag unset/`0` to disable collection.
`/health` reports `popularityTrackingEnabled`; this indicates configuration,
not storage connectivity. No Scrydex requests or credits are used by popularity.

Admins can open **Account -> Admin -> Card and set popularity**, choose **30,
60, or 90 days**, and load the top 20 items in each of four categories:

- Card search-result appearances: each distinct card in the first loaded batch
  counts once per successful explicit search action.
- Sets represented in searches: each distinct represented set counts once;
  a selected set also counts if the successful search has no matches.
- Card-detail views: once per successful card-page load, including local-cache hits.
- Sets' card-detail views: one per card-detail page view, not a unique visitor
  count and not deduplicated across different cards from the same set.

Home card search, Card Search, and Dex search are instrumented. Home counts the
three displayed matches; full search counts its first loaded batch (up to 100).
Internal query fallbacks are combined into one event. Load More, client-side
pagination, restored results, passive top-card widgets, price/variant refreshes,
and set-cache warming do not emit events. Automatic deep-link searches are not
classified as explicit searches; opening the actual card-detail page counts as
a view. Sealed products are not included.

The separate, uncached event POST means searches and views still count when
their data comes from browser or shared caches. Delivery is best-effort,
nonblocking, and never retries the underlying search. Failures are logged to the
browser console without preventing card use. No backfill or activity before
deployment is available.

API:
- `POST /popularity/events`: existing Worker origin/auth policy applies; no
  search quota is consumed. Accepts a random UUID-v4 `eventId`, `type` (`search`
  or `view`), and up to 100 distinct card records (`id`, `setId`, display `name`,
  `setName`); search events may also supply a selected `set` (`id`, `name`).
  Views must contain exactly one card. Unknown fields, including raw query or
  identity fields, are rejected. JSON bodies are limited to 32 KB.
- `GET /popularity/report?days=30&limit=20`: **verified Firebase admin claim
  required**, including when `REQUIRE_AUTH=0`. Valid windows are 30/60/90; limit
  is 1..50. All responses use `Cache-Control: no-store`.

Retention and operating costs:
- Daily Redis sorted sets retain up to 90 UTC days, including today. Reports sum
  all members across the requested window before taking top-N, not daily top-N.
- Random per-action delivery IDs expire after 24 hours; duplicate completed
  deliveries do not count again. Pending/failed deliveries return an explicit
  error rather than being retried into duplicate increments.
- Display labels expire within 90 days of their last update. No user IDs,
  browser IDs, IP addresses, auth tokens, or raw search text are persisted by
  this feature. DNT/GPC browsers suppress popularity delivery.
- A global 10,000-delivery-attempt/day cap bounds accepted aggregation work;
  rejected attempts still require budget-counter commands. Each accepted
  event uses Redis transactions and per-entity increments/label writes, so this
  is not free in Redis operations. Reports use temporary union keys expiring
  after 60 seconds. Review Upstash usage before increasing traffic.
- Metrics are client-reported, potentially biased or fabricated, not a billing
  ledger or verified unique-user analytics. No per-person identifiers are
  collected for abuse detection. Set `ALLOWED_ORIGINS` for your site origins and
  retain existing Cloudflare abuse protections.

The dashboard hides and clears data on account switches and signout; the API
independently checks admin access. External labels render only via safe DOM
text APIs. The updated [privacy disclosure](policies.html#pv-privacyPolicy)
describes aggregate collection and retention.

Validation (no live services or API credits):

```powershell
node --experimental-default-type=module --test popularity-worker.test.mjs popularity-ui.test.mjs set-price-cache-worker.test.mjs
```

### Roles + limits
The Worker supports custom-claim roles (from the Firebase ID token):
- `role=basic`: uses `FREE_DAILY_LIMIT`
- `role=premium`: uses `PREMIUM_DAILY_LIMIT`
- `role=tester`: unlimited (no quota enforcement)
- `role=admin`: unlimited (no quota enforcement)

Backward compatibility:
- If `role` is missing, the Worker falls back to `premium=true` or `tier=premium|pro` to treat the user as premium.

The Worker also returns quota metadata headers to the frontend:
- `x-pv-quota-tier`, `x-pv-quota-limit`, `x-pv-quota-used`, `x-pv-quota-remaining`

Quota counters are only incremented for:
- `GET /cards/search?...&consumeQuota=1`
- `GET /sealed/search?...&consumeQuota=1`

This keeps passive browsing (home page loads, watchlist/collection rendering, card detail fetches) from using daily credits.

Cards/Sealed pages display this as a small “daily allowance” banner.

## Assigning roles (Firebase Functions)

Client-side JS cannot securely assign roles. This repo includes a minimal Firebase Callable Function (admins only):
- Source: [functions/index.js](functions/index.js)
- Function name: `setUserRole`

### Deploy
1. Install the Firebase CLI and initialize Functions (once):
	- `firebase init functions`
	- Choose the same Firebase project you use for Auth.
2. Install dependencies and deploy:
	- `cd functions`
	- `npm install`
	- `firebase deploy --only functions`

### Seed your first admin (one-time)
You must seed an initial admin using a service account (or other Admin SDK environment), because the callable function is admin-only.

Use the helper script:
- [functions/scripts/set-initial-admin.js](functions/scripts/set-initial-admin.js)

After seeding, sign out/in on [account.html](account.html) so your token refreshes and your admin tools appear.

## CSP note
Pages use a strict CSP. Firebase requires loading scripts from `https://www.gstatic.com` and connecting to Google APIs; those are now allowed in the CSP meta tags.

Accessibility Notes
- Keyboard navigation supported; visible focus states.
- Skip link to jump to main content.
- Landmarks: banner, main, contentinfo; labels and ARIA used thoughtfully.

## Stripe subscriptions (monthly premium)

This repo now includes a Firebase Functions + Stripe flow for monthly premium subscriptions:
- Callable function: `createStripeCheckoutSession`
- Callable function: `createStripePortalSession`
- Callable function: `getStripeSubscriptionStatus`
- Webhook endpoint: `stripeWebhook`

When Stripe reports subscription changes, Functions sync Firebase custom claims to:
- `role=premium` for active premium subscriptions
- `role=basic` for canceled/inactive subscriptions

Important:
- Existing `admin` and `tester` roles are preserved and not overwritten by Stripe sync.

### 1) Create Stripe product + monthly price

In Stripe Dashboard:
1. Create a Product (example: `PokeValutor Premium`).
2. Add a recurring monthly Price.
3. Copy the Price ID (`price_...`).

### 2) Configure Stripe secrets for Firebase Functions

Use Functions environment variables:

```bash
STRIPE_SECRET_KEY="sk_live_or_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_PRICE_ID_MONTHLY_PREMIUM="price_..."
STRIPE_APP_BASE_URL="https://www.pokevaluator.com"
STRIPE_ALLOWED_RETURN_ORIGINS="https://www.pokevaluator.com,http://localhost:8080"
```

Optional (if you use a custom Stripe Billing Portal configuration):

```bash
STRIPE_BILLING_PORTAL_CONFIGURATION_ID="bpc_..."
```

Recommended setup options:
- Production: set env vars in Firebase Console for the `scrydexWebhook`, `stripeWebhook`, and Stripe callable functions.
- Local emulation: create `functions/.env.local` with the same variable names.

### 3) Deploy Functions

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

### 4) Add Stripe webhook endpoint

In Stripe Dashboard -> Developers -> Webhooks, add endpoint:

```text
https://us-central1-YOUR_FIREBASE_PROJECT.cloudfunctions.net/stripeWebhook
```

Subscribe the endpoint to these events:
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Copy the webhook signing secret (`whsec_...`) into:
- `STRIPE_WEBHOOK_SECRET`

Then redeploy Functions if you changed config.

### 5) Test locally with Stripe CLI (optional but recommended)

```bash
stripe listen --forward-to http://127.0.0.1:5001/YOUR_FIREBASE_PROJECT/us-central1/stripeWebhook
```

Use the printed webhook secret from Stripe CLI as `stripe.webhook_secret` for local testing.

### Fast local test (no cloud deploy required)

If you want to validate checkout + webhook quickly before touching production config:

1. Create `functions/.env.local` with Stripe **test mode** values (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_MONTHLY_PREMIUM`, `STRIPE_APP_BASE_URL`, and optional `STRIPE_ALLOWED_RETURN_ORIGINS`).
2. Start emulators from repo root:

```bash
firebase emulators:start --only functions
```

3. In another terminal, serve static files from repo root:

```bash
py -3 -m http.server 8080
```

4. Open:

```text
http://localhost:8080/account.html?pv_functions_emulator=1
```

The `pv_functions_emulator=1` flag tells `firebase.js` to route callable functions to the local Functions emulator.

5. Forward Stripe webhooks to emulator:

```bash
stripe listen --forward-to http://127.0.0.1:5001/pokevaluator-v1/us-central1/stripeWebhook
```

6. Use test card `4242 4242 4242 4242` in Stripe Checkout.

### 6) Frontend behavior

On [account.html](account.html), signed-in users now have:
- `Subscribe monthly` button -> redirects to Stripe Checkout
- `Manage billing` button -> opens Stripe Billing Portal
- Live subscription status message from `getStripeSubscriptionStatus`

After checkout or webhook events, custom claims are synced so existing premium gating can continue using `role/tier/premium` as before.
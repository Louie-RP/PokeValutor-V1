# PokeValuator TCGGO / Pokémon API Enrichment Integration Plan

**Project:** PokeValuator  
**Goal:** Add graded prices, eBay sold graded data, and real price history without causing regressions in the current Scrydex-backed search, Dex, Watchlist, Sealed, Firebase, Stripe, Upstash, and Cloudflare Worker setup.  
**Recommended approach:** Keep the current API as the primary provider and add TCGGO / Pokémon API as a secondary enrichment provider first.

---

## 1. Executive recommendation

Do **not** fully replace the current API yet.

Use the TCGGO / Pokémon API as an **enrichment provider** for:

- Graded prices
- eBay sold graded data
- PSA / BGS / CGC values
- Price history
- Raw vs graded comparison insights
- Future premium-only valuation features

Keep the current API as the **primary provider** for now for:

- Card search
- Set / expansion catalog
- Dex tracking
- Watchlist snapshots
- Sealed search
- Existing card detail shape
- Existing frontend compatibility
- Existing quota and cache behavior

The safest architecture is:

```txt
Frontend
  ↓
PokeValuator Cloudflare Worker
  ↓
Primary provider: current Scrydex-shaped API
Secondary provider: TCGGO / Pokémon API enrichment
  ↓
Upstash Redis cache + mapping layer
  ↓
Firebase Auth / Stripe role gating
```

This avoids a risky rewrite and lets you test graded/history features in isolation.

---

## 2. Why not fully replace the API right now?

Your current frontend is already built around a specific data shape and route structure.

Current integration points include:

- `search.js` is labeled as Scrydex-backed and uses `pv:scrydex:*` cache keys.
- `card.js` loads card details through the Worker using `/cards/:id?includePrices=1&lang=en`.
- `sealed.js` is also Scrydex-backed and expects sealed products with `variants` and `prices`.
- The README documents Cloudflare Worker auth-gated quotas, Scrydex API env vars, Upstash Redis quota persistence, Firebase Auth, Firestore sync, Stripe roles, and Scrydex webhook cache invalidation.

A full replacement would likely require changing:

- Card IDs
- Set IDs
- Expansion names / codes
- Card number format
- Price shape
- Variant names
- Sealed product shape
- Watchlist saved snapshots
- Dex saved collection objects
- Firestore state
- Existing localStorage cache keys
- Search and sort behavior

That is too much risk for one change.

The correct move is to add the new API behind the Worker, normalize its response, and only surface it in a new card-detail section first.

---

## 3. Current PokeValuator architecture snapshot

Based on the current repo:

### Frontend

Static frontend files include:

- `index.html`
- `search.html`
- `search.js`
- `card.html`
- `card.js`
- `sealed.html`
- `sealed.js`
- `account.html`
- CSS files

The frontend calls the Worker through `PV_API_URL`, falling back to the deployed Worker URL when no local secret is available.

Example current Worker-style routes used by the frontend:

```txt
GET /cards/search
GET /cards/:id?includePrices=1&lang=en
GET /sealed/search
GET /expansions/search
```

### Auth and user data

The repo already has:

- Firebase Auth
- Firestore user data
- Watchlist sync
- Dex Collection sync
- Master Sets sync
- Stripe subscription role syncing
- Firebase custom claims for roles

Current roles:

```txt
admin   → unlimited
tester  → unlimited
premium → premium daily limit
basic   → free daily limit
```

### Caching and quotas

The current README says quota counters are intended to persist through Upstash Redis, and the Worker returns quota metadata headers such as:

```txt
x-pv-quota-tier
x-pv-quota-limit
x-pv-quota-used
x-pv-quota-remaining
```

Current quota-consuming routes are documented as:

```txt
GET /cards/search?...&consumeQuota=1
GET /sealed/search?...&consumeQuota=1
```

Keep this design. Do not make passive card detail loads unexpectedly consume the same search quota unless you intentionally create a premium enrichment quota.

---

## 4. New provider role

Use TCGGO / Pokémon API as a second provider.

### Provider responsibilities

The new provider should only answer:

```txt
Can this current card be enriched with graded and history data?
```

It should not own core search yet.

### New routes to add

Recommended route design:

```txt
GET /cards/:scrydexCardId/enrichment
GET /cards/:scrydexCardId/graded-prices
GET /cards/:scrydexCardId/price-history
```

Alternative route design:

```txt
GET /cards/:scrydexCardId?includePrices=1&includeGraded=1&includeHistory=1
```

The first design is safer because it isolates the new feature. I recommend starting with:

```txt
GET /cards/:id/enrichment
```

Then the card detail page can load normal card data first and enrichment second.

### Why separate routes are safer

A separate enrichment route means:

- Existing card detail still works if TCGGO is down.
- Existing search does not change.
- Existing Dex and Watchlist data does not change.
- You can feature-flag the enrichment UI.
- You can test the new API without rewriting the whole Worker.
- You can later turn enrichment into a premium feature.

---

## 5. Target enrichment response shape

Normalize the new provider into your own PokeValuator shape. Do not expose raw TCGGO response directly to the frontend.

Recommended response:

```json
{
  "ok": true,
  "data": {
    "provider": "tcggo",
    "source": "pokemon-api",
    "scrydexCardId": "base1-4",
    "matched": {
      "tcggoCardId": "3852",
      "confidence": "high",
      "score": 96,
      "matchedBy": [
        "card_number",
        "set_code",
        "name"
      ],
      "warnings": []
    },
    "raw": {
      "currency": "USD",
      "marketPrice": 146.69,
      "midPrice": 163.71,
      "lastUpdated": "2026-06-03T00:00:00Z"
    },
    "graded": {
      "currency": "USD",
      "groups": [
        {
          "company": "PSA",
          "grade": "10",
          "medianPrice": 2941,
          "sampleSize": 5,
          "confidence": "low"
        },
        {
          "company": "PSA",
          "grade": "9",
          "medianPrice": 1200,
          "sampleSize": 4,
          "confidence": "low"
        }
      ]
    },
    "history": {
      "currency": "USD",
      "points": [
        {
          "date": "2026-06-01",
          "marketPrice": 145.22
        }
      ]
    },
    "updatedAt": 1780000000000
  }
}
```

If no match is found:

```json
{
  "ok": true,
  "data": {
    "provider": "tcggo",
    "scrydexCardId": "base1-4",
    "matched": null,
    "graded": null,
    "history": null,
    "message": "No reliable enrichment match found."
  }
}
```

If the provider fails:

```json
{
  "ok": false,
  "error": "TCGGO enrichment is temporarily unavailable."
}
```

Do not throw a frontend-breaking error for enrichment failures.

---

## 6. Matching strategy

This is the most important part.

Do **not** assume Scrydex card IDs and TCGGO card IDs match.

Create a matching layer.

### Input from current card

From the current card object, collect:

```txt
scrydex card id
card name
card number
collector number
set / expansion name
set / expansion code
series
rarity
release date if available
image URL if needed for manual debugging
```

### Candidate search

Search TCGGO using increasingly broad queries:

1. Exact card number + set code + card name
2. Exact card number + set name + card name
3. Card name + set name
4. Card name + card number
5. Card name only as a last resort

### Match scoring

Suggested scoring:

```txt
+40 card number exact match
+25 set code exact match
+20 set/episode name exact match
+10 normalized card name exact match
+5 rarity match
-30 card number mismatch
-25 set mismatch
-20 name mismatch
```

Suggested confidence:

```txt
90–100 = high
70–89  = medium
0–69   = low / do not auto-use
```

Only display graded/history data automatically for `high` confidence matches at first.

For `medium` confidence, consider showing:

```txt
Graded data match needs review.
```

For `low` confidence, do not show data.

### Normalize card numbers

Important examples:

```txt
4
004
4/102
GG69
SVP001
TG05
RC29
```

Normalize card numbers by:

- Uppercasing
- Trimming spaces
- Removing `/total` when comparing the printed number
- Preserving letter prefixes like `GG`, `TG`, `SVP`
- Comparing both raw and normalized forms

### Mapping cache

Once a high-confidence match is found, cache it.

Suggested Upstash key:

```txt
pv:tcggo:map:scrydex:{scrydexCardId}:v1
```

Suggested value:

```json
{
  "scrydexCardId": "base1-4",
  "tcggoCardId": "3852",
  "confidence": "high",
  "score": 96,
  "matchedBy": ["card_number", "set_code", "name"],
  "createdAt": 1780000000000,
  "updatedAt": 1780000000000
}
```

Suggested TTL:

```txt
30 days
```

Why 30 days? Card identity mapping should not change often, but you still want to recover if the provider fixes IDs or metadata.

---

## 7. Cache plan

Use Upstash Redis for provider data, not localStorage alone.

### Recommended keys

```txt
pv:tcggo:map:scrydex:{scrydexCardId}:v1
pv:tcggo:enrich:{tcggoCardId}:v1
pv:tcggo:graded:{tcggoCardId}:v1
pv:tcggo:history:{tcggoCardId}:v1
pv:tcggo:provider-health:v1
```

### Recommended TTLs

```txt
ID mapping: 30 days
Raw enrichment: 6–12 hours
Graded eBay sold data: 12–24 hours
History data: 24 hours
Provider health failure: 2–5 minutes
```

### Why cache heavily?

The new API has request limits by plan. The Pokémon API site currently lists the Basic plan as 100 requests/day, Pro as 3,000 requests/day, Ultra as 15,000 requests/day, and Mega as 50,000 requests/day. It also advertises graded prices, eBay sold graded prices, history prices, images, episodes, artists, and sealed product support.

Because of that, cache aggressively so one popular card does not burn your quota every time someone opens it.

---

## 8. Cloudflare Worker setup

### Required Worker secrets

Add these as Cloudflare Worker secrets:

```txt
TCGGO_RAPIDAPI_KEY
TCGGO_API_BASE_URL
TCGGO_API_HOST
TCGGO_ENRICHMENT_ENABLED
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

Suggested values:

```txt
TCGGO_API_BASE_URL=https://pokemon-tcg-api.p.rapidapi.com
TCGGO_API_HOST=pokemon-tcg-api.p.rapidapi.com
TCGGO_ENRICHMENT_ENABLED=0
```

Confirm the exact RapidAPI host and base URL from the RapidAPI playground before deploying. RapidAPI hostnames can vary by API.

### Add secrets with Wrangler

```bash
npx wrangler secret put TCGGO_RAPIDAPI_KEY
npx wrangler secret put TCGGO_API_BASE_URL
npx wrangler secret put TCGGO_API_HOST
npx wrangler secret put UPSTASH_REDIS_REST_URL
npx wrangler secret put UPSTASH_REDIS_REST_TOKEN
```

Cloudflare recommends secrets for sensitive values like API keys and auth tokens. Secrets are accessed through the Worker `env` object at runtime.

### Local development

Create a local `.dev.vars` file beside `wrangler.toml`:

```txt
TCGGO_RAPIDAPI_KEY="your-local-key"
TCGGO_API_BASE_URL="https://pokemon-tcg-api.p.rapidapi.com"
TCGGO_API_HOST="pokemon-tcg-api.p.rapidapi.com"
TCGGO_ENRICHMENT_ENABLED="1"
UPSTASH_REDIS_REST_URL="your-upstash-rest-url"
UPSTASH_REDIS_REST_TOKEN="your-upstash-rest-token"
```

Never commit `.dev.vars`, `.dev.vars.*`, `.env`, or `.env.*`.

Make sure `.gitignore` includes:

```txt
.dev.vars
.dev.vars.*
.env
.env.*
```

### Worker provider helper

Add a provider file or section similar to:

```js
async function tcggoFetch(env, path, params = {}) {
  if (String(env.TCGGO_ENRICHMENT_ENABLED || '0') !== '1') {
    return null;
  }

  const base = String(env.TCGGO_API_BASE_URL || '').replace(/\/$/, '');
  const key = String(env.TCGGO_RAPIDAPI_KEY || '').trim();
  const host = String(env.TCGGO_API_HOST || '').trim();

  if (!base || !key) {
    throw new Error('TCGGO provider is not configured.');
  }

  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v != null && String(v).trim()) {
      url.searchParams.set(k, String(v));
    }
  }

  // The provider docs show passing the RapidAPI key as rapidapi-key.
  // RapidAPI playground may also show x-rapidapi-key / x-rapidapi-host headers.
  // Use the exact auth format confirmed in the playground.
  url.searchParams.set('rapidapi-key', key);

  const headers = {};
  if (host) {
    headers['x-rapidapi-host'] = host;
  }

  const res = await fetch(url.toString(), { headers });
  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`TCGGO returned invalid JSON (${res.status}).`);
  }

  if (!res.ok) {
    throw new Error(`TCGGO request failed (${res.status}): ${data?.message || data?.error || 'unknown error'}`);
  }

  return data;
}
```

### Important auth warning

Do **not** call TCGGO directly from frontend JavaScript.

Bad:

```js
fetch('https://provider-url/cards?rapidapi-key=...')
```

Good:

```js
fetch(`${workerBase}/cards/${cardId}/enrichment`)
```

The API key must only live in Cloudflare Worker secrets.

---

## 9. Upstash Redis setup

You already use Upstash-style environment variables in the project.

Required values:

```txt
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

Upstash provides these in the database details tab. Upstash’s Redis client is HTTP/REST based and is designed for serverless environments including Cloudflare Workers.

You can use either:

1. The `@upstash/redis` package, or
2. Direct REST calls with `fetch`.

Because your current Functions code already has direct Upstash REST-style helpers, direct REST calls are fine for the Worker too.

### Simple REST helpers

```js
function getUpstashBase(env) {
  return String(env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
}

function getUpstashToken(env) {
  return String(env.UPSTASH_REDIS_REST_TOKEN || '');
}

async function redisGetJson(env, key) {
  const base = getUpstashBase(env);
  const token = getUpstashToken(env);
  if (!base || !token) return null;

  const res = await fetch(`${base}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return null;

  const body = await res.json().catch(() => null);
  const raw = body?.result;
  if (!raw) return null;

  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

async function redisSetJson(env, key, value, ttlSeconds) {
  const base = getUpstashBase(env);
  const token = getUpstashToken(env);
  if (!base || !token) return false;

  const encodedValue = encodeURIComponent(JSON.stringify(value));
  const encodedKey = encodeURIComponent(key);

  const path = ttlSeconds
    ? `/set/${encodedKey}/${encodedValue}/EX/${encodeURIComponent(String(ttlSeconds))}`
    : `/set/${encodedKey}/${encodedValue}`;

  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  return res.ok;
}
```

### Cache wrapper

```js
async function getOrSetJsonCache(env, key, ttlSeconds, loader) {
  const cached = await redisGetJson(env, key);
  if (cached) {
    return { value: cached, cache: 'hit' };
  }

  const value = await loader();

  if (value) {
    await redisSetJson(env, key, value, ttlSeconds);
  }

  return { value, cache: 'miss' };
}
```

### Upstash gotcha

Do not store sensitive user data in cache keys or values.

Good cache key:

```txt
pv:tcggo:enrich:3852:v1
```

Bad cache key:

```txt
pv:tcggo:enrich:lreyperez18@gmail.com:3852:v1
```

---

## 10. Firebase and premium role setup

You already have Firebase Auth, Firestore, Stripe subscriptions, and custom-claim roles.

Keep enrichment access controlled by the Worker, not by frontend-only checks.

### Suggested access rules

For first rollout:

```txt
admin/tester: enrichment enabled
premium: enrichment enabled
basic/free/signed-out: enrichment disabled or limited preview
```

### Token flow

Your existing frontend already attempts to send a Firebase ID token in the `Authorization` header for Worker calls.

Continue this pattern:

```txt
Authorization: Bearer <firebase-id-token>
```

The Worker should:

1. Verify/parse the token the same way your current quota system does.
2. Read role claims.
3. Allow enrichment based on role.
4. Return a graceful `403` or limited payload for non-premium users.

### Important custom claims warning

Use custom claims only for access control, such as:

```json
{
  "role": "premium"
}
```

Do not store profile data, collection data, preferences, or price data in custom claims. Firebase custom claims are limited and are included in ID tokens.

### Firestore data

Do not store enrichment response data in Firestore per user.

Use Upstash for shared provider cache.

Use Firestore only for user-owned data, such as:

```txt
users/{uid}/cardWatchlist
users/{uid}/sealedWatchlist
users/{uid}/dex/state
stripeCustomers/{uid}
billing/{uid}
```

Optional future Firestore collections:

```txt
providerDiagnostics/{providerName}
adminProviderOverrides/{scrydexCardId}
```

The second one could help if a card maps incorrectly and you want to manually override it.

---

## 11. Frontend implementation plan

### Files likely touched

Start with:

```txt
card.html
card.js
styles.css or the relevant CSS file
```

Avoid touching search, Dex, sealed, Stripe, or account pages in the first PR unless needed.

### Add card detail section

Add a section under existing pricing:

```html
<section id="pv-card-enrichment" class="pv-card-section" hidden>
  <h2>Graded Market</h2>
  <div id="pv-card-enrichment-status"></div>
  <div id="pv-card-graded-market"></div>
  <div id="pv-card-history"></div>
</section>
```

### Load enrichment after normal card render

In `card.js`, after `renderCard(card)` succeeds:

```js
void loadCardEnrichment(card);
```

Pseudo-code:

```js
async function loadCardEnrichment(card) {
  const id = safeString(card?.id, '').trim();
  if (!id) return;

  const section = document.getElementById('pv-card-enrichment');
  const status = document.getElementById('pv-card-enrichment-status');
  const graded = document.getElementById('pv-card-graded-market');

  if (!section || !status || !graded) return;

  section.hidden = false;
  status.textContent = 'Loading graded market data...';

  try {
    const base = getWorkerBase();
    const url = `${base}/cards/${encodeURIComponent(id)}/enrichment`;
    const data = await fetchJsonWithCache(url, 12 * 60 * 60 * 1000);

    if (!data?.ok || !data?.data?.matched) {
      status.textContent = 'No reliable graded market data found for this card yet.';
      return;
    }

    renderGradedMarket(data.data);
    status.textContent = '';
  } catch (err) {
    status.textContent = 'Graded market data is temporarily unavailable.';
  }
}
```

### Render confidence clearly

For each graded row:

```txt
PSA 10 — $294.00 median — 5 sold — Low confidence
```

Suggested confidence label logic:

```txt
25+ sample size = High confidence
8–24 sample size = Medium confidence
1–7 sample size = Low confidence
0 or missing = Do not show as a reliable value
```

### Do not overstate prices

Use wording like:

```txt
Estimated market value based on recent sold data.
```

Avoid:

```txt
This card is worth exactly $294.
```

### No chart library in first version

For the first release, use a table or simple list.

Do not add Chart.js, D3, or another large dependency in the first PR. Your site is currently static and lightweight. Add charts later after the data shape is proven.

---

## 12. Worker route design

### Route

```txt
GET /cards/:id/enrichment
```

### Flow

```txt
1. Parse card ID.
2. Check feature flag.
3. Check auth role if premium-gated.
4. Load original card from existing provider or require a card snapshot from existing card route.
5. Check Upstash mapping cache.
6. If no mapping, search TCGGO candidates.
7. Score candidates.
8. If high-confidence match, cache mapping.
9. Fetch TCGGO card detail / graded / history data.
10. Normalize response.
11. Cache normalized enrichment.
12. Return normalized payload.
```

### Example route pseudo-code

```js
async function handleCardEnrichment(request, env, cardId) {
  if (String(env.TCGGO_ENRICHMENT_ENABLED || '0') !== '1') {
    return json({ ok: true, data: { enabled: false } });
  }

  const auth = await getAuthContextFromRequest(request, env);
  if (!canUseEnrichment(auth)) {
    return json({ ok: false, error: 'Premium required for graded market data.' }, 403);
  }

  const cacheKey = `pv:tcggo:enrich:scrydex:${cardId}:v1`;

  const result = await getOrSetJsonCache(env, cacheKey, 12 * 60 * 60, async () => {
    const currentCard = await fetchCurrentCardFromPrimaryProvider(env, cardId);
    const mapping = await getOrCreateTcggoMapping(env, currentCard);

    if (!mapping || mapping.confidence !== 'high') {
      return {
        provider: 'tcggo',
        scrydexCardId: cardId,
        matched: null,
        message: 'No reliable enrichment match found.',
      };
    }

    const tcggoCard = await fetchTcggoCard(env, mapping.tcggoCardId);
    return normalizeTcggoEnrichment(currentCard, mapping, tcggoCard);
  });

  return json({ ok: true, data: result.value }, 200, {
    'x-pv-cache': result.cache,
    'x-pv-provider': 'tcggo',
  });
}
```

---

## 13. API provider notes

The Pokémon API marketing page shows these relevant features:

- Multi-market data from Cardmarket and TCGPlayer
- eBay sold graded prices
- PSA, Beckett/BGS, and CGC data
- Median prices
- Sample sizes
- Grade-level breakdowns
- Historical trends
- Sealed products
- Complete expansion data
- High-resolution images

Example docs show endpoints such as:

```txt
GET /cards?search=charizard+ex+199&sort=price_highest
GET /episodes
GET /episodes/search?search=evolving%20skies
GET /episodes/21/cards?sort=price_highest
GET /episodes/21/products?sort=price_highest
GET /pokemon/cards/3852
```

Important: confirm the exact base URL and auth format in the RapidAPI playground before coding. The public site says to pass the key in the `rapidapi-key` query parameter, while RapidAPI often also uses `x-rapidapi-key` and `x-rapidapi-host` headers.

Build the provider helper so auth can be changed in one place.

---

## 14. Testing plan

This needs careful testing because the risk is not only API failure. The bigger risk is breaking existing site flows.

### A. Provider smoke tests

Test with the API directly from the Worker or local provider script.

Use a small card set:

```txt
Base Set Charizard
Base Set Blastoise
Base Set Venusaur
Crown Zenith Giratina VSTAR GG69
Evolving Skies Moonbreon
Modern promo Pikachu
A low-value common card
A card with no graded sales
A card with weird numbering
A sealed product
```

Confirm:

- Search works.
- Detail endpoint works.
- Graded data exists where expected.
- Missing graded data is handled gracefully.
- Sample sizes are included.
- Prices include currency.
- Dates / history points are understandable.
- API errors are catchable.

### B. Matching tests

Create unit tests or a simple script for:

```txt
set code exact match
set name exact match
card number exact match
card number with zero padding
card number with /total
gallery cards like GG69
trainer gallery cards like TG05
promo cards like SVP001
same card name across multiple sets
same card number across multiple sets
same Pokémon across multiple eras
```

Acceptance:

```txt
High-confidence match only when number + set + name line up.
Medium-confidence match should not automatically display prices.
Low-confidence match should return no enrichment.
```

### C. Normalizer tests

Use saved API fixture JSON files.

Test:

```txt
PSA 10 with sample size
PSA 9 with sample size
BGS 10
BGS 9.5 if supported
CGC 10
missing median price
missing sample size
currency EUR vs USD
history points missing
history points out of order
null prices
unexpected provider fields
```

Acceptance:

```txt
Frontend receives stable PokeValuator shape every time.
No raw provider error leaks to user.
No undefined/null crashes.
```

### D. Worker route tests

Test:

```txt
GET /cards/:id/enrichment with feature flag off
GET /cards/:id/enrichment with feature flag on
unauthenticated request
basic user request
premium user request
admin/tester request
bad card id
valid card with no enrichment
valid card with enrichment
Upstash down
TCGGO down
TCGGO quota exceeded
TCGGO slow response
```

Acceptance:

```txt
Current /cards/:id route still works.
Enrichment failure does not break card detail.
Worker returns useful status codes.
Worker caches successful responses.
Worker does not cache broken provider responses for too long.
```

### E. Frontend regression checklist

Before merging:

```txt
Home page loads.
Search page loads.
Search by card name works.
Search by card number works.
Search with set filter works.
Series/set dropdown still loads.
Load More still works.
Sort by value still works.
Sort by name still works.
Card detail page still loads without enrichment.
Card detail page still loads with enrichment.
Card detail page handles enrichment failure.
Watchlist add/remove still works.
Watchlist cloud sync still works.
Dex add/remove still works.
Dex Master Sets still update.
Multiple collections still work for premium users.
Sealed search still works.
Sealed Watchlist still works.
Trade percentage feature still works.
Quota banner still works.
Stripe checkout still works.
Stripe portal still works.
Account page still shows correct role.
Signed-out user experience still works.
Mobile layout still works.
No console errors on normal pages.
```

### F. Manual browser test cases

Test these pages:

```txt
/
search.html
card.html?id=<known-card-id>
sealed.html
dex.html
account.html
```

Test in:

```txt
Chrome desktop
Safari or iPhone if available
Mobile responsive mode
Signed out
Signed in basic
Signed in premium/tester/admin
```

### G. Performance tests

Measure:

```txt
card detail load time without enrichment
card detail load time with enrichment cache miss
card detail load time with enrichment cache hit
Worker response time
Upstash response time
TCGGO response time
```

Target:

```txt
Existing card detail should render before enrichment finishes.
Cached enrichment should feel instant.
Uncached enrichment should not block the main card detail render.
```

---

## 15. Rollout plan

### Phase 0 — Planning

- Create a new branch from `dev`.
- Add this markdown file to `/docs`.
- Do not touch production yet.

Suggested branch:

```bash
git checkout dev
git pull
git checkout -b feature/tcggo-enrichment-plan
```

### Phase 1 — Provider proof of concept

Add Worker-only provider logic.

No frontend UI yet.

Build:

```txt
tcggoFetch()
normalizeTcggoCard()
normalizeTcggoGradedPrices()
normalizeTcggoHistory()
matchScrydexToTcggo()
```

Add hidden/manual route:

```txt
GET /debug/tcggo/card-match?id=<scrydexCardId>
```

Restrict debug route to admin/tester only or remove before production.

### Phase 2 — Enrichment route

Add:

```txt
GET /cards/:id/enrichment
```

Feature flag:

```txt
TCGGO_ENRICHMENT_ENABLED=0
```

Test locally with:

```txt
TCGGO_ENRICHMENT_ENABLED=1
```

### Phase 3 — Frontend card detail panel

Add the UI to `card.html` and `card.js`.

Keep it defensive:

```txt
If loading: show loading message.
If no match: show no reliable data message.
If provider failure: show temporarily unavailable.
If premium required: show upgrade CTA later.
```

Do not alter existing pricing table yet.

### Phase 4 — Premium gating

Once the feature works, decide access:

```txt
Free/basic: hide, preview, or limited one lookup/day
Premium: full graded/history
Tester/admin: full access
```

Because you already have Stripe syncing roles, this can become part of your premium value.

### Phase 5 — Real price history UI

Replace the current local observed history table with provider history, but only after the provider data is stable.

For first version, use a table.

Later version can add a chart.

### Phase 6 — Sealed enrichment

Only after card enrichment is stable, test sealed product enrichment.

Do not do sealed in the first PR.

---

## 16. Deployment plan

### Local

```bash
npm install
npx wrangler dev
```

Use `.dev.vars`.

Test:

```txt
/cards/:id/enrichment
```

### Staging / dev Worker

Set secrets:

```bash
npx wrangler secret put TCGGO_RAPIDAPI_KEY
npx wrangler secret put TCGGO_API_BASE_URL
npx wrangler secret put TCGGO_API_HOST
npx wrangler secret put UPSTASH_REDIS_REST_URL
npx wrangler secret put UPSTASH_REDIS_REST_TOKEN
```

Set feature flag off first:

```txt
TCGGO_ENRICHMENT_ENABLED=0
```

Deploy Worker.

Then turn it on only in staging/dev:

```txt
TCGGO_ENRICHMENT_ENABLED=1
```

### Production

Production should happen only after:

- Regression checklist passes.
- Provider quota behavior is understood.
- Cache hit rate is acceptable.
- Card detail remains stable if provider fails.
- No API key is exposed in frontend source or browser devtools.
- No uncached API storm occurs on popular cards.

---

## 17. Rollback plan

Make rollback easy.

### Feature flag rollback

Set:

```txt
TCGGO_ENRICHMENT_ENABLED=0
```

Expected behavior:

```txt
Card detail still works.
Graded panel is hidden or shows unavailable.
No TCGGO calls happen.
```

### Frontend rollback

If the UI causes issues:

- Hide the enrichment section.
- Stop calling `loadCardEnrichment(card)`.
- Leave Worker route deployed but disabled.

### Worker rollback

If Worker route causes issues:

- Remove route handling for `/cards/:id/enrichment`.
- Keep existing `/cards/:id`, `/cards/search`, `/sealed/search`, `/expansions/search` unchanged.

### Data rollback

No user data migration should be needed because:

- Enrichment cache lives in Upstash.
- User Firestore collection data should not change.
- Existing Dex/Watchlist snapshots should not change.
- Existing Scrydex cache keys should not be renamed.

This is another reason not to replace the whole provider first.

---

## 18. Gotchas and risks

### 1. ID mismatch

The new provider likely uses different card IDs.

Mitigation:

```txt
Build a mapping layer.
Cache high-confidence mappings.
Do not display low-confidence matches.
```

### 2. Set naming mismatch

One provider may say:

```txt
Expansion
Set
Episode
Series
```

Mitigation:

```txt
Normalize all provider set fields into one PokeValuator object.
```

### 3. Card number mismatch

Examples:

```txt
4
004
4/102
GG69
TG05
SVP001
```

Mitigation:

```txt
Normalize carefully and test heavily.
```

### 4. Variants and conditions

Scrydex-style variants may not match TCGGO-style pricing.

Mitigation:

```txt
Do not try to merge every raw variant immediately.
Start with graded panel as its own section.
```

### 5. Sample size problems

A graded value based on 2 sold listings is weak.

Mitigation:

```txt
Always display sample size.
Show confidence labels.
Avoid exact-value language.
```

### 6. Outlier sales

One weird eBay sale can skew values.

Mitigation:

```txt
Use median when available.
Show sample size.
Consider min/max later.
```

### 7. Quota burn

Card detail pages can become expensive if every view calls TCGGO.

Mitigation:

```txt
Cache aggressively in Upstash.
Load enrichment only on card detail.
Do not call enrichment from search result cards.
Use premium gating.
```

### 8. Secret leakage

RapidAPI key must never appear in frontend JS or GitHub.

Mitigation:

```txt
Use Cloudflare Worker secrets.
Call provider only from Worker.
Check browser Network tab before launch.
```

### 9. Provider downtime

The enrichment provider may fail or rate-limit.

Mitigation:

```txt
Do not block core card detail.
Return graceful unavailable messages.
Cache provider-health failures briefly.
```

### 10. Regressions in current app

Most risk comes from touching too many files.

Mitigation:

```txt
First PR should touch only Worker provider route and card detail UI.
Do not rewrite search.
Do not rewrite sealed.
Do not rename cache keys.
Do not change Firestore shape.
```

---

## 19. Suggested file changes by PR

### PR 1 — Planning doc only

```txt
docs/tcggo-enrichment-integration-plan.md
```

### PR 2 — Worker provider behind flag

```txt
worker file or Worker source file
provider/tcggo.js if your Worker has modules
normalizers/tcggo.js if your Worker has modules
```

No frontend UI.

### PR 3 — Card detail UI

```txt
card.html
card.js
styles.css
```

No search changes.

### PR 4 — Premium gating and polish

```txt
Worker auth/role check
account page copy if needed
upgrade CTA if needed
```

### PR 5 — Real history

```txt
card.js
card.html
styles.css
possibly a tiny chart/table helper
```

### PR 6 — Sealed enrichment

Only after card enrichment is stable.

---

## 20. Acceptance criteria

The feature is ready when all of this is true:

```txt
No current route breaks.
Search still works.
Card detail still works without enrichment.
Card detail still works with enrichment.
Enrichment is cached.
Provider API key is not exposed.
Low-confidence matches do not display prices.
Sample size is shown for graded values.
Provider failures are graceful.
Upstash failure is graceful.
Basic/premium role behavior is correct.
Stripe role sync still works.
Dex/Watchlist data is unchanged.
Sealed search is unchanged.
Production can be disabled with one feature flag.
```

---

## 21. Recommended first feature copy

Use plain language:

```txt
Graded Market

Recent sold data can vary. Values are estimates based on available market data and may not reflect the exact value of your specific card, grade, centering, condition, or certification label.
```

For low sample size:

```txt
Low confidence — limited recent sales.
```

For no data:

```txt
No reliable graded market data found for this card yet.
```

For premium gating:

```txt
Graded market data is a Premium feature.
```

---

## 22. Suggested UI layout

```txt
Card Detail
------------------------------------------------
Current raw pricing table

Graded Market
------------------------------------------------
Match confidence: High

Company | Grade | Median Sold | Sales Count | Confidence
PSA     | 10    | $294.00     | 27          | High
PSA     | 9     | $120.00     | 14          | Medium
CGC     | 10    | $260.00     | 4           | Low

Price History
------------------------------------------------
Date       | Raw Market | PSA 10
2026-06-01 | $146.69   | $294.00
```

Do not over-design the first version. Make sure the data is correct first.

---

## 23. Tech needed

### Required

```txt
Cloudflare Worker
Cloudflare Wrangler
Cloudflare Worker secrets
Upstash Redis REST URL/token
Firebase Auth
Firebase Firestore
Firebase Functions
Stripe role syncing
RapidAPI subscription/key for TCGGO / Pokémon API
Existing static frontend
```

### Optional later

```txt
Chart.js or lightweight SVG chart
Admin override screen for bad matches
Provider diagnostics dashboard
Sentry or other error logging
Analytics event tracking for enrichment usage
```

Do not add optional tools until the enrichment data is proven.

---

## 24. Setup checklist

### RapidAPI / TCGGO

```txt
[ ] Subscribe to free/basic plan.
[ ] Open RapidAPI playground.
[ ] Confirm base URL.
[ ] Confirm auth method.
[ ] Confirm card search endpoint.
[ ] Confirm card detail endpoint.
[ ] Confirm graded price fields.
[ ] Confirm history fields.
[ ] Save 5 sample responses as fixtures.
```

### Cloudflare

```txt
[ ] Add Worker secrets.
[ ] Add local .dev.vars.
[ ] Confirm .dev.vars is ignored by git.
[ ] Add feature flag.
[ ] Add provider helper.
[ ] Add route.
[ ] Test route locally.
[ ] Deploy to dev/staging.
[ ] Keep production flag off until tested.
```

### Upstash

```txt
[ ] Confirm Redis REST URL/token.
[ ] Confirm Worker can read/write test key.
[ ] Add mapping cache keys.
[ ] Add enrichment cache keys.
[ ] Add TTLs.
[ ] Test cache hit.
[ ] Test cache miss.
[ ] Test Upstash failure path.
```

### Firebase

```txt
[ ] Confirm auth token is sent to Worker.
[ ] Confirm Worker can read role from token.
[ ] Confirm premium/tester/admin access.
[ ] Confirm basic/signed-out behavior.
[ ] Do not store enrichment data in user Firestore docs.
[ ] Do not add enrichment data to custom claims.
```

### Frontend

```txt
[ ] Add hidden Graded Market section.
[ ] Load enrichment after card render.
[ ] Display loading state.
[ ] Display no-match state.
[ ] Display unavailable state.
[ ] Display premium-required state if applicable.
[ ] Display sample size and confidence.
[ ] Test mobile layout.
```

### Regression

```txt
[ ] Run card search.
[ ] Run sealed search.
[ ] Add/remove Watchlist.
[ ] Add/remove Dex card.
[ ] Check account role.
[ ] Check Stripe premium role.
[ ] Check quota banner.
[ ] Check browser console.
[ ] Check Network tab for leaked API key.
```

---

## 25. References

### API

- TCGGO API docs: https://www.tcggo.com/api-docs/v1/
- Pokémon API marketing/docs page: https://www.pokemon-api.com/
- RapidAPI listing: https://rapidapi.com/tcggopro/api/pokemon-tcg-api

### Cloudflare

- Worker secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Worker Fetch API: https://developers.cloudflare.com/workers/runtime-apis/fetch/
- Wrangler commands: https://developers.cloudflare.com/workers/wrangler/commands/

### Upstash

- Connect with Upstash Redis: https://upstash.com/docs/redis/howto/connect-with-upstash-redis

### Firebase

- Firebase custom claims: https://firebase.google.com/docs/auth/admin/custom-claims
- Firebase Functions environment config: https://firebase.google.com/docs/functions/config-env
- Firestore security rules conditions: https://firebase.google.com/docs/firestore/security/rules-conditions

### Current repo

- Repo: https://github.com/Louie-RP/PokeValutor-V1
- Live site: https://www.pokevaluator.com/

---

## 26. Final recommendation

Build this as a careful enrichment layer, not a replacement.

The first successful version should prove:

```txt
We can match cards safely.
We can fetch graded/history data safely.
We can cache it safely.
We can show it without breaking existing features.
We can turn it off instantly.
```

Once that is true, you can decide whether TCGGO should take over more of the app later.

For now, the winning move is:

```txt
Current API = primary app data
TCGGO / Pokémon API = graded/history enrichment
Upstash = shared cache + ID mapping
Firebase/Stripe = user role gating
Cloudflare Worker = secure provider gateway
```

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

Deploy to GitHub Pages
1. Commit and push to main.
2. In GitHub, Settings → Pages → Source: **GitHub Actions**.
3. Add the Firebase secrets listed below.
4. Push again and open the provided Pages URL.

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
# Spec: Scanner Mobile Readiness + UI Cleanup v1

## Goal

Prepare the scanner feature for safe phone testing and eventual merge to `main` without breaking the live site.

This spec focuses on:

- mobile camera testing
- production safety toggles
- UI cleanup
- scanner performance
- Scrydex API credit protection
- regression prevention

## Current Status

The scanner feature is functionally close.

Implemented pieces:

- Scanner UI is loaded on `search.html`.
- Tesseract OCR is loaded from CDN.
- Camera capture uses `getUserMedia` with environment-facing camera preference.
- Name correction is wired into scanner.js.
- Catalog candidate lookup is wired into scanner.js.
- Firebase functions include card catalog hydration, scanner candidates, and scanner name suggestions.
- Worker includes `/scanner/candidates` and `/scanner/name-suggestions` routes.
- Worker routes are placed before the Scrydex API key guard, so they do not require Scrydex secrets.
- Worker cache is used for scanner candidate and name suggestion responses.

### Known Issue: Premium Full-Art/Holo Collector Number OCR

Current scanner behavior can reliably detect the card name for many premium full-art/holo cards,
but collector number OCR can still fail (blank number) under glare, foil reflection, or stylized text.

Decision for this phase:

- Keep conservative number extraction (prefer blank over wrong number).
- Continue mobile-readiness work and broader regression testing.
- Revisit collector-number tuning after structured mobile test runs.

Temporary tester guidance:

- If name is correct and number is blank, tap **Find Possible Matches** and select the best card.
- Confirm the selected card number before searching/submitting.

Track during mobile testing:

- card type (full-art, holo, standard)
- browser/device
- glare conditions
- detected name
- detected number (blank or value)
- whether candidate selection recovered the correct number

## Merge Risk Summary

Do not merge directly to `main` yet.

Reasons:

1. Branch is behind `main` and should be updated first.
2. Scanner.js enables name correction by default.
3. The scanner feature has not been tested on actual mobile Safari/Chrome yet.
4. Name suggestion lookup may be too chatty on weak mobile connections.
5. Worker code is separate from the repo, so Worker and frontend can drift.
6. UI is still beta-level and needs mobile cleanup.

## Required Fixes Before Merge

### 1. Update branch from main

Before opening/merging a PR:

```bash
git checkout scan-card-feature-implementation
git fetch origin
git merge origin/main
```

Resolve conflicts, then retest the full search page.

Do not merge this feature branch into `main` while it is still behind.

### 2. Add a safe rollout flag

Current scanner.js has name correction enabled by default.

Recommended before merge:

```js
const PV_SCANNER_ENABLE_NAME_CORRECTION = false;
```

Then enable it through a controlled flag after Worker + Firebase are confirmed live.

Alternative: keep it true only if Worker and Firebase routes are already deployed and verified.

### 3. Reduce name-correction fan-out

Current scanner.js may collect up to 6 candidate names from OCR and call the name-suggestion endpoint for each candidate.

Recommended mobile-safe limit:

```js
return candidates.slice(0, 3);
```

This reduces backend calls, improves phone responsiveness, and avoids unnecessary Firestore reads.

### 4. Reduce broad Firestore name lookups

Current Firebase name suggestions can query broad groups such as `firstLetter` with a limit of 200.

Recommended change:

- Remove the broad `firstLetter` query, or
- Only use it when the OCR input is very short, and cap it at 50.

Preferred:

```js
if (firstLetter && compact.length <= 4) {
    tasks.push(collection.where('firstLetter', '==', firstLetter).limit(50).get());
}
```

### 5. Add explicit Firestore rule for scannerNameIndex

Admin SDK can still write to it, but the rule makes intent clear:

```txt
match /scannerNameIndex/{nameId} {
  allow read, write: if false;
}
```

The Worker/Firebase function should remain the only read path.

### 6. Version the Worker in the repo

Add the Worker code to the repo in one of these paths:

```txt
workers/scrydex-proxy-worker.js
```

or

```txt
docs/current-worker-code.md
```

Preferred: real source file under `workers/`.

This prevents frontend/Worker drift.

## Mobile Testing Plan

### Safe phone testing options

Do not test mobile by merging to live `main` first.

Use one of these instead:

1. **Local HTTPS tunnel**
   - Run the site locally.
   - Expose it with Cloudflare Tunnel, ngrok, or similar.
   - Open the tunnel URL on your phone.

2. **Temporary staging domain**
   - Example: `staging.pokevaluator.com`
   - Point it to the dev branch or preview deploy.

3. **Firebase Hosting preview channel**
   - Deploy the static site to a preview URL.
   - Test phone camera there.

4. **Cloudflare Pages preview**
   - Good long-term option if the project moves from GitHub Pages.

### Mobile devices/browsers to test

Minimum:

- iPhone Safari
- iPhone Chrome
- Android Chrome, if available
- Desktop Chrome webcam, already tested

### Mobile test cards

Use 10–20 cards:

- One vintage card
- One modern ex card
- One full-art card
- One trainer card
- One energy card
- One card with a long name
- One card with glare/foil
- One card where OCR currently fails

## UI Cleanup Recommendations

### 1. Make scanner collapsed by default

Add a simple header/card:

```txt
Scan a Card beta
[Open Scanner]
```

This keeps the search page clean for users who only want manual search.

### 2. Improve mobile button order

Recommended order:

```txt
Start Camera
Capture
Retake
Find Possible Matches
Search Selected/Detected Card
Clear
```

Hide buttons that are not relevant to the current state.

### 3. Hide Raw OCR behind details

Raw OCR is useful for debugging but noisy for normal users.

Change to:

```html
<details>
  <summary>Show raw OCR text</summary>
  <textarea ...></textarea>
</details>
```

### 4. Rename confusing labels

Current:

```txt
Detected Card Name
Detected Card Number
```

Recommended:

```txt
Card Name
Card Number
```

Then use helper text:

```txt
Review and edit before searching.
```

### 5. Update status messages

Make them shorter on mobile:

```txt
Reading card text...
Name corrected to Charizard.
Pick a possible match.
No strong match found. Try retaking the photo.
```

### 6. Improve candidate cards

Candidate card should show:

```txt
Image
Name
Set name
Number
Top Match badge
Use This Card button/action
```

Hide debug scores by default.

Debug score details can go behind:

```txt
Show match details
```

### 7. Add a mobile scan guide

Small helper text:

```txt
For best results, place the card flat, avoid glare, and fill the yellow frame.
```

### 8. Add a selected-card state

After clicking a candidate:

```txt
Selected: Charizard · Base Set · 4/102
[Search Selected Card]
```

This is clearer than leaving the user to infer that the input fields changed.

## Backend Performance Recommendations

### Name correction

Keep:

- Worker cache
- Firebase limit
- short timeout
- no Scrydex calls
- no client Firestore reads

Update:

- reduce candidate correction requests from 6 to 3
- reduce broad Firestore first-letter query
- keep empty results uncached while index is still growing

### Candidate lookup

Keep:

- `/scanner/candidates` before Scrydex guard
- fallback to `/cards/search`
- `candidatesConsumeQuota = false`

Update later:

- precompute image hash in catalog to avoid fetching official images during ranking
- add scanner feedback after UI cleanup

## Scrydex Credit Protection

Scanner name correction should always use zero Scrydex credits.

Scanner candidate fallback can still call `/cards/search` when catalog results are low.

Keep this behavior:

```txt
Firestore catalog candidates first
/cards/search fallback only when needed
candidate lookups do not consume quota
```

## Pre-Merge Checklist

### Code checks

- [ ] `node --check scanner.js`
- [ ] `node --check functions/index.js`
- [ ] `node --check worker.js`
- [ ] Firebase deploy succeeds
- [ ] Worker deploy succeeds

### Endpoint checks

- [ ] `/health`
- [ ] `/scanner/name-suggestions?text=Charizrd&limit=5`
- [ ] `/scanner/candidates?name=Charizard&number=4/102&limit=12`
- [ ] `/cards/search?name=Charizard&page=1&pageSize=10&lang=en`

### App regression checks

- [ ] Manual search still works
- [ ] Search by card number still works
- [ ] Search by set still works
- [ ] Watchlist/favorites still work
- [ ] Account/subscription page still works
- [ ] Dex page still works
- [ ] Scanner disabled state fails gracefully
- [ ] Scanner endpoint failure does not break search

### Mobile checks

- [ ] iPhone Safari camera opens
- [ ] iPhone Safari capture works
- [ ] iPhone Chrome camera opens
- [ ] Capture preview fits screen
- [ ] Buttons are easy to tap
- [ ] Scanner does not cause page layout jump
- [ ] OCR failure message is understandable
- [ ] Candidate cards are readable

## Recommended Implementation Order

1. Merge/rebase latest `main` into the scanner branch.
2. Run syntax checks locally.
3. Reduce name-correction fan-out from 6 to 3.
4. Reduce/remove broad first-letter Firestore query.
5. Add explicit `scannerNameIndex` Firestore rule.
6. Commit Worker source into repo under `workers/`.
7. Create a phone-accessible staging URL.
8. Test scanner on phone.
9. Clean scanner UI.
10. Test full search regression.
11. Open PR from `scan-card-feature-implementation` to `main`.
12. Merge only after mobile + regression checks pass.

## Not In This Scope

Do not add Upstash Vector yet.

Do not add scanner feedback yet.

Do not auto-add scanned cards to a collection.

Do not remove the manual search fallback.

# TrustCheck — Project Handoff Notes

Give this file to Claude at the start of a new session (paste its contents, or just say
"read HANDOFF.md in TrustCheck-Mobile") after a laptop reset or on a new machine, so there's
no need to re-derive any of this from scratch.

Last updated: 2026-09-21.

## The two codebases — don't confuse them

- **`TrustCheck-Mobile`** — React Native/Expo app. **This is the current, live app**, used on both
  Android and iPhone. GitHub: `https://github.com/muhammadmateenwork/TrustCheck-Mobile` (branch
  `master`). Fully committed and pushed as of this writing.
- **`AA`** (folder, sits alongside `TrustCheck-Mobile` on Desktop) — an older, **Android-only**
  native Java app that TrustCheck-Mobile replaced. The client no longer uses this app directly,
  **but** it also contains `functions/` — the Firebase Cloud Functions backend that
  TrustCheck-Mobile actively depends on (sending report emails, admin operator management, Test
  Analytics counts). That backend code is very much live.
  - Status as of 2026-09-21: just committed locally (`git init -b main`, first commit
    `a42aa4d`) but **not yet pushed to GitHub** — waiting on the user to create an empty repo and
    share its URL. If you're reading this after a reset and that never happened, treat re-doing
    that backup as the first priority.

## Accounts you'll need to sign back into (nothing to install, just re-login)

| Account | Used for | Notes |
|---|---|---|
| GitHub — `muhammadmateenwork` | Cloning/pushing both repos | Git's cached credentials are wiped by a reset; re-authenticate on first push |
| Expo/EAS — `mateen543` (expo.dev) | Building the app (`eas build`) | **Android signing keystore lives on Expo's servers**, not the laptop — safe across resets as long as you can log into this account |
| Firebase project `trustcheck123` (console.firebase.google.com) | Firestore, Cloud Functions, Storage, Auth | Tied to whichever Google account was used to create it |

No Apple Developer account has been set up yet — only Android builds have been made via EAS so
far. You'll need one ($99/year) the first time an iOS build is actually produced.

## First-time setup after cloning fresh

```bash
git clone https://github.com/muhammadmateenwork/TrustCheck-Mobile.git
cd TrustCheck-Mobile
npm install
npx eas-cli login
```

Then copy back the `test-photos/` folder from USB into the project root — it's gitignored
(real cassette/QR reference photos used to tune the scanner, not reproducible from code).

For the backend:
```bash
git clone <AA repo URL once it exists>
cd AA/functions
npm install
npx firebase-tools login
```

## Secrets — where they actually live (never in a file on this laptop)

- SMTP email credentials: Firebase Secret Manager, under project `trustcheck123`. Not visible in
  any source file. To view/rotate: `npx firebase-tools functions:secrets:access SMTP_USER
  --project trustcheck123` (or `:set` to change it). Only needed if migrating to a brand-new
  Firebase project — a laptop reset alone doesn't touch these.
- Firebase web config (`apiKey` etc.) in `src/services/firebase.ts` — this is **not** a secret
  (Google's own guidance: these keys are meant to be public; access is controlled by Firestore/
  Storage security rules, not by hiding this value). Safe as committed in git.

## Commands used regularly on this project

Deploy backend changes (run from `AA/`, after `firebase login`):
```bash
npx firebase-tools deploy --only functions --project trustcheck123
npx firebase-tools deploy --only firestore:indexes --project trustcheck123
npx firebase-tools deploy --only firestore:rules --project trustcheck123
```

Build the app (run from `TrustCheck-Mobile/`, after `eas login`):
```bash
CI=1 npx eas-cli build --profile preview --platform android --non-interactive --no-wait
```
Check a build's status: `npx eas-cli build:view <build-id> --json`

Type-check before considering any change done:
```bash
npx tsc --noEmit
```

## Architecture facts worth knowing before touching anything

- Firestore security: a non-admin operator can only read their own `testRecords` (enforced in
  `firestore.rules`); Admin bypasses via a Firebase Auth custom claim (`role: "admin"`), not a
  Firestore field (so a client can never grant itself admin by writing to its own doc).
- The `getTestSummary` Cloud Function is the one place that computes Test Analytics counts for
  BOTH the operator's and Admin's screens — it does a single `syncedAt`-range Firestore query and
  filters everything else (operator, reason(s), drug/alcohol result) in memory, specifically to
  avoid needing a new Firestore composite index for every filter combination. If you ever see a
  "this query requires an index" error again, the fix is almost always to move more filtering into
  that function rather than adding another `where()` clause to a client-side query.
- Guest/anonymous test sessions never sync to Firestore at all, by design — they're invisible to
  Admin and excluded from every count automatically, with no extra filtering needed anywhere.
- Report file names are always forced to start with `D&A-Test-`, even if the operator edits the
  name field; the field also becomes read-only once Save is pressed.

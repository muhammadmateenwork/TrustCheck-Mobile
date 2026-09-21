# TrustCheck-Mobile — Project Recovery Notes

Give this file to Claude at the start of a new session after a reset/new machine — paste its
contents, or say "read HANDOFF.md in TrustCheck-Mobile" once it's cloned back.

Last updated: 2026-09-21.

## What this project is

React Native/Expo app, runs on Android and iPhone — this is the current, live app.
- GitHub: `https://github.com/muhammadmateenwork/TrustCheck-Mobile` (branch `master`)
- Depends on a separate Firebase Cloud Functions backend (see "Backend" below) for sending report
  emails, admin operator management, and Test Analytics counts. That backend is already deployed
  and live in production — a laptop reset does not affect it.

## Recover the app itself

```bash
git clone https://github.com/muhammadmateenwork/TrustCheck-Mobile.git
cd TrustCheck-Mobile
npm install
```

Restore `test-photos/` into the project root from wherever it was saved (USB/cloud/zip) — it's
gitignored, contains real cassette/QR reference photos used to tune the scanner, and isn't
reproducible from code.

Sign back into these before building or deploying (wiped by a reset, but don't affect the code):
- `npx eas-cli login` — Expo account `mateen543`. **The Android signing keystore lives on Expo's
  servers**, not the laptop, so it's unaffected by any of this.
- `npx firebase-tools login` — the Google account tied to Firebase project `trustcheck123`.

Build a new APK:
```bash
CI=1 npx eas-cli build --profile preview --platform android --non-interactive --no-wait
```
Check status: `npx eas-cli build:view <build-id> --json`

No iOS build has been made yet — that needs an Apple Developer account ($99/yr) when it happens.

Before calling any code change done: `npx tsc --noEmit` must exit clean.

## Backend (separate project, not part of this repo)

Firebase project `trustcheck123` — Cloud Functions (`getTestSummary`, `sendReportEmail`, admin
operator management), Firestore, Storage, Auth. Source lives in a different local folder (`AA/`,
next to this one on Desktop), which is actually a **separate, older native Android app** the
client no longer uses directly — kept only because its `functions/` folder is this app's real,
live backend.
- As of 2026-09-21, `AA` is committed locally but **not yet pushed to GitHub** — still pending an
  empty repo + URL from the user. If that never happened, redo it before relying on it being safe.
- SMTP email credentials live in Firebase Secret Manager under this project — never in a file, so
  a laptop reset doesn't touch them either way.

## Two non-obvious things, so they aren't mistaken for bugs

- `getTestSummary` computes Test Analytics counts for both the operator's and Admin's screens by
  running ONE `syncedAt`-range Firestore query and filtering everything else (operator, reason(s),
  drug/alcohol result) in memory — not one Firestore `where()` per filter. That's deliberate: it
  avoids needing a new Firestore composite index every time a filter is added. Don't reintroduce
  per-filter `where()` clauses without remembering why this exists.
- Report file names are always forced to start with `D&A-Test-`, and the field becomes read-only
  once Save is pressed — both intentional.

## Not part of this project

There's a `DA` folder on the Desktop — decompiled output of an unrelated third-party app
(`com.draeger.add.apk`, via apktool/jadx). Confirmed nothing in this codebase references it.
Ignore it; it's not needed for recovery.

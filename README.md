# TrustCheck Mobile

React Native + Expo (TypeScript) rewrite of the native Android TrustCheck app. Shares the same
Firebase backend (project `trustcheck123`) as the native app — same Auth users, Firestore data,
and Cloud Storage bucket.

## Prerequisites

- **Node.js 20 or newer** (this project is developed on Node 22).
- An **Expo account** with access to this project (owner: `mateen543`, EAS project id in
  `app.json`). If you're a different person/laptop, ask to be added as a collaborator at
  [expo.dev](https://expo.dev) → this project → Project settings → Collaborators — you don't need
  your own separate Expo/EAS project, just access to this one, so Android/iOS signing credentials
  (already stored on Expo's servers) carry over automatically.

No other secrets are required to develop or build this app: the Firebase client config
(`src/services/firebase.ts`) is committed as-is — Firebase's web API key is not sensitive, access
is controlled by Firestore/Storage security rules, not by hiding this value.

## Setup on a new machine

```bash
git clone https://github.com/muhammadmateenwork/TrustCheck-Mobile.git
cd TrustCheck-Mobile
npm install
npx eas-cli login
```

`eas login` connects the local CLI to the Expo account above — required before any `eas build`,
and needed once per machine.

## Running for development

```bash
npx expo start
```

This app uses custom native modules (`react-native-vision-camera`,
`react-native-worklets-core`, `react-native-view-shot`, `react-native-background-actions`) that
are **not** part of Expo Go. Scan the QR code with a custom dev-client build instead of the plain
Expo Go app (see `eas.json`'s `development` profile — `eas build --profile development` builds
one). Expo Go will load the app but the camera-scan, signature-capture, and background-download
screens will fail with a "native module not found" error.

## Building

```bash
# Android APK, installable via a direct link — no store submission needed
eas build --profile preview --platform android

# iOS (needs an Apple Developer Program account linked to this Expo project,
# or a free-tier signing setup such as Codemagic — see project notes)
eas build --profile preview --platform ios
```

## Backend (Cloud Functions, Firestore rules)

The Cloud Functions backend (`sendReportEmail`, `createOperator`, password reset, etc.) and
Firestore/Storage security rules live in the **native Android app's own repository**, not this
one — this app calls the same deployed Cloud Functions the native app does, and neither app's
code needs to change for backend behavior to change. Deploying backend changes requires access to
that separate project and `firebase login` with an account that has access to the `trustcheck123`
Firebase project.

## Notes for AI coding assistants

See `AGENTS.md` — Expo's SDK has changed significantly across versions; always check the
versioned docs for the SDK version actually in `package.json` before assuming API behavior.

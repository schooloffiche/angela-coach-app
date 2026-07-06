# Coach — Angela: setup guide

## What this is

An installable app (PWA) with:
- **Firebase Auth** (email/password) so your data is tied to your account, not your device.
- **Firestore** for check-ins, weights, streaks, and settings — synced live, works offline, catches up when back online.
- **Cloud Functions + Cloud Scheduler** sending real push notifications at 6:00, 9:00, 12:30, 3:00, 5:00, 8:00, and 9:30 daily, personalized against your actual check-in state.
- **GitHub Pages** hosting the static frontend.

One-time setup below. After that, it just runs.

## 1. Create your Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** → name it (e.g. `angela-coach`) → finish the wizard.
2. In the project, click the **web icon (`</>`)** to register a web app → name it anything → **do not** check "Firebase Hosting" (you're using GitHub Pages) → **Register app**.
3. Copy the `firebaseConfig` object it shows you into `docs/firebase-config.js`, replacing the `REPLACE_ME` values.
4. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**
5. **Build → Firestore Database → Create database** → production mode → pick a location close to you (e.g. `nam5 (us-central)`) → Enable.
6. **Project settings → Cloud Messaging tab → Web configuration → Web Push certificates → Generate key pair.** Copy the key string into `VAPID_KEY` in `docs/firebase-config.js`.
7. **Project settings → Usage and billing → Modify plan → Blaze (pay as you go).** Cloud Scheduler (needed for the 7 fixed-time pushes) requires Blaze. At this scale (7 sends/day, one user) you'll stay inside the free tier — realistically $0/month, but Google requires a card on file for Blaze.

## 2. Set your timezone

Open `functions/index.js` and check the top:

```js
const TIMEZONE = 'America/New_York';
```

Change this to your local [IANA timezone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) if you're not in US Eastern (e.g. `America/Chicago`, `America/Los_Angeles`). This is what makes "6:00 AM" actually mean 6:00 AM where you are.

## 3. Deploy Firestore rules + the push-notification functions

From your computer, in the `angela-coach-app` folder:

```bash
npm install -g firebase-tools
firebase login
firebase use --add          # pick your project, alias it "default"
cd functions && npm install && cd ..
firebase deploy --only firestore:rules,functions
```

That deploys the security rules (so only you can read/write your own data) and the 7 scheduled functions. You can re-run `firebase deploy --only functions` any time you edit the reminder copy in `functions/index.js`.

## 4. Host the frontend on GitHub Pages

1. Push the whole repo to GitHub (it must be a **public** repo for Pages to work on the free plan).
2. The deployable site lives in the **`docs/`** folder (`index.html`, `manifest.json`, `sw.js`, `firebase-config.js`, `icons/`) — GitHub Pages' "deploy from a branch" option can only serve from the repo root or a `/docs` folder, so that's why it's named that instead of `public/`.
3. In the repo: **Settings → Pages → Source → Deploy from a branch → branch `main`, folder `/docs`** → Save.
4. Give it a minute, then GitHub shows a URL like `https://<username>.github.io/<repo>/`. That's your app's address.

## 5. Install it on your iPhone

1. Open the GitHub Pages URL in **Safari** (not Chrome — iOS only allows installable web apps from Safari).
2. Tap **Share → Add to Home Screen**.
3. Close Safari, open the app from the **Home Screen icon** (this matters — push notifications only work from the installed icon, not a Safari tab).
4. First launch: tap **Create Account**, set an email + password.
5. Tap **Enable** on the notification banner and allow notifications when iOS asks.

Requires iOS 16.4 or later. If you ever use a second device (iPad, laptop), just sign in there with the same email/password — same data, same streaks, live sync.

## 6. Test it

- In the Firebase Console → Functions, you can manually trigger a run of any `push____` function to confirm delivery without waiting.
- Or temporarily edit one function's `schedule` cron to a couple minutes out, `firebase deploy --only functions`, confirm the push lands, then set it back.

## Starting a new sprint

After your cruise (or anytime), open **Goals → Start a New Sprint**, set your goal weight, and tap 14-day or 30-day. Your check-in history and streak math stay intact — only the sprint start/end dates reset.

## Notes on reliability

- Foreground and background push both work once installed as described above — this is real APNs-backed web push, not a best-effort local alarm.
- If the app goes untouched for a very long stretch, iOS can occasionally deprioritize background web push for rarely-opened installed apps — opening the app periodically (which you'll be doing anyway, since it's your daily check-in tool) keeps it in good standing.
- If a push doesn't show, check Settings → Notifications → the app's Home Screen name → Allow Notifications is on.

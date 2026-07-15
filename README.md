# Coach: setup guide

## What this is

An installable app (PWA) built so anyone can use it — not tied to one person's stats. Includes:
- **Firebase Auth** (email/password) so your data is tied to your account, not your device.
- **Firestore** for check-ins, weights, measurements, streaks, and settings — synced live, works offline, catches up when back online.
- **Cloud Functions + Cloud Scheduler** sending real push notifications at up to 7 times a day, each fully customizable (time + message type) per person under Profile → Preferences, personalized with your first name, your check-in state, and your chosen food/workout apps. Times follow your phone's detected timezone automatically, so nothing needs adjusting when you travel.
- **GitHub Pages** hosting the static frontend.
- A built-in **nutrition/macro calculator**, a **flexible-length sprint goal setter** with backdating, a **body measurements tracker**, and a **craving button** split between alcohol and sweet-tooth cravings.

One-time setup below. After that, it just runs.

## 1. Create your Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** → name it (e.g. `angela-coach`) → finish the wizard.
2. In the project, click the **web icon (`</>`)** to register a web app → name it anything → **do not** check "Firebase Hosting" (you're using GitHub Pages) → **Register app**.
3. Copy the `firebaseConfig` object it shows you into `docs/firebase-config.js`, replacing the `REPLACE_ME` values.
4. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**
5. **Build → Firestore Database → Create database** → production mode → pick a location close to you (e.g. `nam5 (us-central)`) → Enable.
6. **Project settings → Cloud Messaging tab → Web configuration → Web Push certificates → Generate key pair.** Copy the key string into `VAPID_KEY` in `docs/firebase-config.js`.
7. **Project settings → Usage and billing → Modify plan → Blaze (pay as you go).** Cloud Scheduler (needed for the notification checks) requires Blaze. At this scale (a handful of users, checked every 15 minutes) you'll stay inside the free tier — realistically $0/month, but Google requires a card on file for Blaze.

## 2. Timezones — nothing to configure

Unlike earlier versions of this app, there's no timezone constant to edit in `functions/index.js` anymore. Each person's phone timezone is auto-detected by the app and stored per-account, so notification times are always computed in *their* local time — including automatically adjusting when someone travels.

## 3. Deploy Firestore rules + the push-notification function

From your computer, in the `angela-coach-app` folder:

```bash
npm install -g firebase-tools
firebase login
firebase use --add          # pick your project, alias it "default"
cd functions && npm install && cd ..
firebase deploy --only firestore:rules,functions
```

That deploys the security rules (so only you can read/write your own data) and the single scheduled function that checks everyone's custom notification times every 15 minutes. Re-run `firebase deploy --only functions` any time you edit the reminder copy in `functions/index.js`.

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

- In the Firebase Console → Functions, you can manually trigger a run of `checkNotifications` to confirm delivery without waiting a full 15-minute cycle.
- Or just add a reminder in the app for a few minutes from now (Profile → Preferences → Notification Schedule) and wait for the next 15-minute check.

## Starting a new sprint

After your cruise (or anytime), open **Goals**. There you'll set sprint length in days (7, 14, 30, 45 — whatever you want), a start date (including a past date if you technically started before you set this up), your goal weight, and which goals count this sprint (see below). Then tap either **Continue Current Sprint** (fixes dates only — everything else, including your goals and history, stays exactly as it is) or **Start Completely Over** (fresh dates, with an optional prompt to zero out your lifetime slip counter). Either way, your check-in history is never touched — that's your permanent record.

## Configurable sprint goals

Under Goals → **Sprint Goals**, toggle which of the 7 tracked goals (alcohol, sugar, mobility, workout, steps, meal logging, water) actually count toward your score this sprint. A 30-day sprint can be alcohol-only; the next one can shift focus to workouts — whatever's on gets full weight, so the score always comes out of a clean /10 no matter how many goals are active. Mobility also supports a weekly target (e.g. 5x/week instead of daily) instead of requiring it every single day.

Whatever's toggled off also disappears from the daily Check-In form and from the coach's nudges for that sprint — no dead fields, no reminders about something you're not tracking right now.

## Notification schedule

Under Profile → Preferences → **Notification Schedule**, add up to 7 reminders, each with its own time and message type (Mobility, Breakfast, Lunch, Danger Zone, Workout, Dinner, Wind Down) — pick as many or as few as you want, in any order. Times are checked against your phone's detected timezone, so travel is automatic. A reminder tied to a goal you've turned off this sprint (e.g. Danger Zone when alcohol tracking is off) simply stays quiet without needing to be removed.

## First-time setup inside the app

1. **Create Account** with your first name, email, and password — the app uses your first name throughout (nav, coach messages, push notifications).
2. On the **Profile** tab, fill in your Nutrition Profile (sex, age, height, activity, goal) to get calorie/macro targets, and your Preferences (daily step goal, workout days per week, which food-logging app and workout-logging app you use — MyFitnessPal/Caliber are just defaults, not requirements).
3. On the **Weight** tab you can also log body measurements (waist, chest, thigh/calf/bicep — left and right separately) in inches or centimeters.
4. On **Check-In**, use the date picker at the top to log or edit any past day — handy for backdating or fixing a day you forgot.

## Alcohol accountability

A logged drink does three things automatically: it doesn't silently reset your streak counter without consequence — it extends your current sprint by one day, adds to a lifetime slip counter shown next to your best-ever streak on Today, and resets the current streak. The sprint clock never gets shorter because of a slip, only longer.

## Logging through the day without a bad score at 7am

Check-In has two buttons once you're editing today: **Save Progress** (log as you go, no score shown, no judgment) and **Close Out Day** (finalizes today and calculates your real /10 score). Today's card shows "X of N logged so far" while the day is open (N matches however many goals are active this sprint), and only shows a number once you close out — usually in the evening, or via your wind-down reminder. Past days you edit through History are always treated as closed since they're already over.

## Mindful goal tracking

Optional and separate from your score. Turn on any of Prayer, Bible reading, Journaling, or Meditation (or add your own custom practice) under Profile → Preferences, and they'll show as checkboxes on Check-In and build their own streak on Today — purely personal, no scoring impact.

## Theme

Tap the 🌙/☀️ icon in the top-right of the nav (or the auth screen before logging in) to switch between light (cream, blue, pink) and dark (deep green/blue) themes. The choice is saved per account and syncs across devices.

## Notes on reliability

- Foreground and background push both work once installed as described above — this is real APNs-backed web push, not a best-effort local alarm.
- If the app goes untouched for a very long stretch, iOS can occasionally deprioritize background web push for rarely-opened installed apps — opening the app periodically (which you'll be doing anyway, since it's your daily check-in tool) keeps it in good standing.
- If a push doesn't show, check Settings → Notifications → the app's Home Screen name → Allow Notifications is on.

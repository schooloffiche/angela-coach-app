/**
 * Coach — scheduled push notifications.
 *
 * A single Cloud Scheduler-backed function runs every 15 minutes and checks
 * every user's own custom notification schedule (up to 7 reminders, any time,
 * any type) against their own current local time — computed from the
 * timezone the app auto-detects from their phone. That's what makes this
 * travel-safe: nobody has to touch a setting when they change timezones.
 *
 * Each reminder is personalized against that day's Firestore check-in state
 * (so nobody's nagged about something they've already done) and skipped
 * entirely if the underlying goal is turned off for the user's current sprint
 * (e.g. no alcohol nudges if this sprint isn't tracking alcohol).
 *
 * Requires the Blaze (pay-as-you-go) plan — Cloud Scheduler + the always-on
 * scheduler infra isn't available on the free Spark plan. At this volume
 * (a handful of users, checked every 15 min) the actual cost is effectively
 * $0/month.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// Fallback only used if a user's timezone hasn't been detected yet (e.g.
// brand new account that hasn't opened the app in a browser/PWA context).
const DEFAULT_TIMEZONE = 'America/New_York';

setGlobalOptions({ region: 'us-central1', maxInstances: 3 });

// ── HELPERS ──────────────────────────────────────────────────────────────
function todayStrInTZ(tz) {
  // en-CA locale formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

// Current local time in tz, quantized down to the nearest 15 minutes as
// "HH:MM" — the frontend's time picker only allows 15-minute increments, so
// an exact string match here is reliable without any fuzzy window math.
function nowHHMMInTZ(tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  let hour = parts.find((p) => p.type === 'hour').value;
  if (hour === '24') hour = '00';
  const minute = parseInt(parts.find((p) => p.type === 'minute').value, 10);
  const quantMinute = Math.floor(minute / 15) * 15;
  return `${hour}:${String(quantMinute).padStart(2, '0')}`;
}

// Keeps the sent-log from growing forever — only today's and yesterday's
// entries (in the user's local date) are worth keeping around.
function pruneLog(log, todayLocal) {
  const [y, m, d] = todayLocal.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yesterday = dt.toISOString().slice(0, 10);
  const pruned = {};
  Object.keys(log).forEach((k) => {
    if (k.startsWith(todayLocal) || k.startsWith(yesterday)) pruned[k] = log[k];
  });
  return pruned;
}

async function getRecentCheckins(uid, limit = 21) {
  const snap = await db.collection('users').doc(uid).collection('checkins')
    .orderBy(admin.firestore.FieldPath.documentId(), 'desc')
    .limit(limit)
    .get();
  const map = {};
  snap.forEach((d) => { map[d.id] = d.data(); });
  return map;
}

function streakFromMap(map, matchFn) {
  const dates = Object.keys(map).sort().reverse();
  let streak = 0;
  for (const d of dates) {
    if (matchFn(map[d])) streak++; else break;
  }
  return streak;
}

// Simplified scorer used only for the wind-down recap line — a lightweight
// approximation of the app's dynamic per-goal-weighted score. It may read a
// touch differently from the in-app score when a sprint has custom goals
// turned off, but it's close enough for a one-line evening nudge.
function calcScore(data, stepGoal) {
  if (!data) return 0;
  let pts = 0;
  if (data.mobility === 'yes') pts += 1.5; else if (data.mobility === 'partial') pts += 0.75;
  if (data.alcohol === 'no') pts += 2;
  if (data.sugar === 'no') pts += 1;
  if (data.workout === 'full') pts += 2; else if (data.workout === 'partial') pts += 1; else if (data.workout === 'rest') pts += 0.5;
  const steps = parseInt(data.stepsFinal) || 0;
  const goal = stepGoal || 10000;
  if (steps >= goal) pts += 1.5; else if (steps >= goal * 0.75) pts += 0.75;
  if (data.breakfast === 'yes') pts += 0.5;
  if (data.lunch === 'yes') pts += 0.5;
  if (data.dinner === 'yes') pts += 0.5;
  const water = parseInt(data.waterOz) || 0;
  if (water >= 90) pts += 0.5;
  return Math.min(10, Math.round(pts * 10) / 10);
}

function firstNameOf(settings) {
  return (settings && settings.firstName) || 'there';
}
function foodAppOf(settings) {
  if (!settings) return 'MyFitnessPal';
  return (settings.foodApp === 'other' ? settings.foodAppOther : settings.foodApp) || 'MyFitnessPal';
}
function stepGoalOf(settings) {
  return (settings && parseInt(settings.stepGoal)) || 10000;
}
function activeGoalsOf(settings) {
  return Object.assign({
    alcohol: true, sugar: true, mobility: true, mobilityPerWeek: 7,
    workout: true, steps: true, meals: true, water: true
  }, (settings && settings.activeGoals) || {});
}

// ── MESSAGE LIBRARY (one builder per reminder type) ─────────────────────
// GOAL_GATE maps a reminder type to the activeGoals key that must be on for
// it to fire — so turning off alcohol tracking this sprint also quiets the
// danger-zone reminder, without the user having to remove it from their
// schedule by hand. windDown has no gate — it's a general recap, always on.
const GOAL_GATE = { mobility: 'mobility', breakfast: 'meals', lunch: 'meals', dinner: 'meals', danger: 'alcohol', workout: 'workout', windDown: null };

const MESSAGE_BUILDERS = {
  mobility: ({ alcoholStreak, name }) => {
    const streakLine = alcoholStreak > 0 ? ` Day ${alcoholStreak + 1} clean starts right now.` : '';
    return { title: '🌅 Coach — Mobility', body: `${name}, get your mobility in and drink 16 oz of water. No snooze, no excuses.${streakLine}` };
  },
  breakfast: ({ checkin, name, foodApp }) => {
    if (checkin.breakfast === 'yes') return { title: '✅ Coach', body: `Breakfast logged already, ${name} — that's exactly how you stay ahead today. Keep it up.` };
    return { title: '🍳 Coach — Breakfast', body: `Breakfast is non-negotiable, ${name}. Skipping it spikes cortisol and makes cravings later 10x harder. Eat protein and log it in ${foodApp} — now.` };
  },
  lunch: ({ checkin, name, foodApp }) => {
    if (checkin.lunch === 'yes') return { title: '✅ Coach', body: `Lunch logged, ${name}. Now check your steps — where are you at? Keep moving through the afternoon.` };
    return { title: '🥗 Coach — Lunch', body: `Lunch time, ${name}. Don't skip it — an empty gut this afternoon is your biggest enemy. Protein first, log it in ${foodApp}, then check your step count.` };
  },
  danger: ({ checkin, alcoholStreak, name }) => {
    if (checkin.alcohol === 'yes') return { title: '😤 Coach', body: `${name}, today already had a slip — that's done. Don't let it turn into two. Reset right now: hot tea, no exceptions.` };
    const streakLine = alcoholStreak >= 3 ? ` You're ${alcoholStreak} days clean — don't hand it away now.` : '';
    return { title: '⚠️ Coach — Danger Zone', body: `Danger zone, ${name}. This is when cravings hit hardest and willpower is lowest. Hot tea, right now. Feeling tempted? Open the app and hit the craving button.${streakLine}` };
  },
  workout: ({ checkin, name }) => {
    if (checkin.workout === 'full' || checkin.workout === 'partial') return { title: '💪 Coach', body: `Workout's in the books, ${name}. Proud of you — now finish the day just as strong.` };
    if (checkin.workout === 'rest') return { title: '😴 Coach', body: `Planned rest day, ${name} — good. Recovery is part of the plan, not an excuse. Still hit your steps and water.` };
    return { title: '💪 Coach — Workout', body: `Workout time, ${name}. No excuse not to go. You don't have to feel like it — you just have to start. Shoes on, everything else follows.` };
  },
  dinner: ({ checkin, name, foodApp }) => {
    if (checkin.dinner === 'yes') return { title: '✅ Coach', body: `Dinner logged, ${name}. Check your final step count and water total, then start winding down.` };
    return { title: '🍽️ Coach — Dinner', body: `Log dinner in ${foodApp} before you close the day, ${name}. No skipping — incomplete logging is incomplete accountability. Then check your steps.` };
  },
  windDown: ({ checkin, name, stepGoal }) => {
    const hasData = checkin && Object.keys(checkin).length > 2;
    const score = hasData ? calcScore(checkin, stepGoal) : null;
    const scoreLine = score !== null ? ` Today's score: ${score}/10.` : '';
    return { title: '🌙 Coach — Wind Down', body: `Screens off, ${name}. Sleep is when you actually change.${scoreLine} Tomorrow, go again.` };
  },
};

// ── MAIN SCHEDULED CHECK ─────────────────────────────────────────────────
// NOTE: the app never writes to the top-level users/{uid} document itself —
// only to its subcollections (meta/settings, checkins/*, etc). Firestore
// won't return a document via collection('users').get() unless that exact
// document has actual field data, so that query silently found nobody, ever.
// A collectionGroup query on 'meta' finds the real settings docs directly.
exports.checkNotifications = onSchedule({ schedule: 'every 15 minutes', timeZone: 'Etc/UTC' }, async () => {
  const settingsSnap = await db.collectionGroup('meta').get();
  if (settingsSnap.empty) {
    logger.info('[notif] no users yet — nothing to check');
    return;
  }

  for (const settingsDoc of settingsSnap.docs) {
    if (settingsDoc.id !== 'settings') continue; // meta/{docId} — only care about the settings doc
    const uid = settingsDoc.ref.parent.parent.id; // users/{uid}/meta/settings
    try {
      const settingsRef = settingsDoc.ref;
      if (!settingsDoc.exists) continue;
      const settings = settingsDoc.data();

      const schedule = Array.isArray(settings.notifSchedule) ? settings.notifSchedule : [];
      if (schedule.length === 0) continue;

      const tz = settings.notifTimezone || DEFAULT_TIMEZONE;
      const nowHHMM = nowHHMMInTZ(tz);
      const todayLocal = todayStrInTZ(tz);

      const due = schedule.filter((s) => s && s.time === nowHHMM && MESSAGE_BUILDERS[s.type]);
      if (due.length === 0) continue;

      const sentLog = settings.notifSentLog || {};
      const toSend = due.filter((s) => !sentLog[`${todayLocal}_${s.time}_${s.type}`]);
      if (toSend.length === 0) continue;

      const ag = activeGoalsOf(settings);
      const activeToSend = toSend.filter((s) => {
        const gate = GOAL_GATE[s.type];
        return !gate || ag[gate];
      });

      // Mark everything in toSend as handled regardless of whether it was
      // gated off — otherwise a goal-disabled slot would get re-evaluated
      // (and logged as "not sent") every 15 minutes all day for nothing.
      const newLog = Object.assign({}, sentLog);
      toSend.forEach((s) => { newLog[`${todayLocal}_${s.time}_${s.type}`] = true; });

      if (activeToSend.length === 0) {
        await settingsRef.set({ notifSentLog: pruneLog(newLog, todayLocal) }, { merge: true });
        continue;
      }

      const [recentMap, tokensSnap] = await Promise.all([
        getRecentCheckins(uid),
        db.collection('users').doc(uid).collection('tokens').get(),
      ]);
      const tokens = tokensSnap.docs.map((d) => d.id);

      if (tokens.length === 0) {
        logger.info(`[notif] ${uid}: no registered devices, marking as handled`);
        await settingsRef.set({ notifSentLog: pruneLog(newLog, todayLocal) }, { merge: true });
        continue;
      }

      const checkin = recentMap[todayLocal] || {};
      const alcoholStreak = streakFromMap(recentMap, (c) => c.alcohol === 'no');
      const sugarStreak = streakFromMap(recentMap, (c) => c.sugar === 'no');
      const ctx = {
        checkin, alcoholStreak, sugarStreak, today: todayLocal,
        name: firstNameOf(settings), foodApp: foodAppOf(settings), stepGoal: stepGoalOf(settings), settings,
      };

      for (const slot of activeToSend) {
        const built = MESSAGE_BUILDERS[slot.type](ctx);
        if (!built) continue;
        const resp = await admin.messaging().sendEachForMulticast({
          notification: { title: built.title, body: built.body },
          tokens,
        });
        resp.responses.forEach((r, i) => {
          if (!r.success) {
            const code = r.error && r.error.code;
            if (code === 'messaging/invalid-registration-token' || code === 'messaging/registration-token-not-registered') {
              db.collection('users').doc(uid).collection('tokens').doc(tokens[i]).delete().catch(() => {});
            } else {
              logger.warn(`[notif] ${uid}: send failed for ${slot.type}`, r.error);
            }
          }
        });
        logger.info(`[notif] ${uid}: sent ${slot.type} @ ${slot.time} to ${resp.successCount}/${tokens.length} device(s)`);
      }

      await settingsRef.set({ notifSentLog: pruneLog(newLog, todayLocal) }, { merge: true });
    } catch (e) {
      logger.error(`[notif] ${uid}: error`, e);
    }
  }
});

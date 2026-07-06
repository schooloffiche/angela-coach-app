/**
 * Coach — Angela: scheduled push notifications.
 *
 * 7 Cloud Scheduler-backed functions fire at fixed local times every day and
 * send a personalized, tough-love push notification via FCM based on that
 * day's Firestore check-in state (so she's not nagged about things she's
 * already done).
 *
 * Requires the Blaze (pay-as-you-go) plan — Cloud Scheduler + the always-on
 * scheduler infra isn't available on the free Spark plan. At this volume
 * (7 sends/day for one user) the actual cost is effectively $0/month.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// ⚠️ Set this to Angela's local IANA timezone. Defaults to US Eastern.
// Full list: https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
const TIMEZONE = 'America/New_York';

setGlobalOptions({ region: 'us-central1', maxInstances: 3 });

// ── HELPERS ──────────────────────────────────────────────────────────────
function todayStrInTZ(tz) {
  // en-CA locale formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
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

function calcScore(data) {
  if (!data) return 0;
  let pts = 0;
  if (data.mobility === 'yes') pts += 1.5; else if (data.mobility === 'partial') pts += 0.75;
  if (data.alcohol === 'no') pts += 2;
  if (data.sugar === 'no') pts += 1;
  if (data.workout === 'full') pts += 2; else if (data.workout === 'partial') pts += 1; else if (data.workout === 'rest') pts += 0.5;
  const steps = parseInt(data.stepsFinal) || 0;
  if (steps >= 10000) pts += 1.5; else if (steps >= 7500) pts += 0.75;
  if (data.breakfast === 'yes') pts += 0.5;
  if (data.lunch === 'yes') pts += 0.5;
  if (data.dinner === 'yes') pts += 0.5;
  const water = parseInt(data.waterOz) || 0;
  if (water >= 90) pts += 0.5;
  return Math.min(10, Math.round(pts * 10) / 10);
}

async function sendToAllUsers(label, buildMessage) {
  const today = todayStrInTZ(TIMEZONE);
  const usersSnap = await db.collection('users').get();

  if (usersSnap.empty) {
    logger.info(`[${label}] no users yet — nothing to send`);
    return;
  }

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    try {
      const [recentMap, tokensSnap] = await Promise.all([
        getRecentCheckins(uid),
        db.collection('users').doc(uid).collection('tokens').get(),
      ]);
      const tokens = tokensSnap.docs.map((d) => d.id);
      if (tokens.length === 0) {
        logger.info(`[${label}] ${uid}: no registered devices, skipping`);
        continue;
      }

      const checkin = recentMap[today] || {};
      const alcoholStreak = streakFromMap(recentMap, (c) => c.alcohol === 'no');
      const sugarStreak = streakFromMap(recentMap, (c) => c.sugar === 'no');

      const built = buildMessage({ checkin, alcoholStreak, sugarStreak, today });
      if (!built || built.skip) {
        logger.info(`[${label}] ${uid}: skipped (${built && built.reason})`);
        continue;
      }

      const resp = await admin.messaging().sendEachForMulticast({
        notification: { title: built.title, body: built.body },
        tokens,
      });

      resp.responses.forEach((r, i) => {
        if (!r.success) {
          const code = r.error && r.error.code;
          if (
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/registration-token-not-registered'
          ) {
            db.collection('users').doc(uid).collection('tokens').doc(tokens[i]).delete().catch(() => {});
          } else {
            logger.warn(`[${label}] ${uid}: send failed`, r.error);
          }
        }
      });
      logger.info(`[${label}] ${uid}: sent to ${resp.successCount}/${tokens.length} device(s)`);
    } catch (e) {
      logger.error(`[${label}] ${uid}: error`, e);
    }
  }
}

// ── 6:00 AM — MOBILITY + WATER ──────────────────────────────────────────────
exports.push0600 = onSchedule({ schedule: '0 6 * * *', timeZone: TIMEZONE }, async () => {
  await sendToAllUsers('06:00', ({ alcoholStreak }) => {
    const streakLine = alcoholStreak > 0 ? ` Day ${alcoholStreak + 1} clean starts right now.` : '';
    return {
      title: '🌅 Coach Angela — 6:00 AM',
      body: `Before your feet hit the kitchen floor: 20 minutes of mobility, then 16 oz of water. No snooze, no excuses.${streakLine}`,
    };
  });
});

// ── 9:00 AM — BREAKFAST ─────────────────────────────────────────────────────
exports.push0900 = onSchedule({ schedule: '0 9 * * *', timeZone: TIMEZONE }, async () => {
  await sendToAllUsers('09:00', ({ checkin }) => {
    if (checkin.breakfast === 'yes') {
      return { title: '✅ Coach Angela', body: 'Breakfast logged already — that\'s exactly how you stay ahead today. Keep it up.' };
    }
    return {
      title: '🍳 Coach Angela — 9:00 AM',
      body: 'Breakfast is non-negotiable. Skipping it spikes cortisol and makes 3pm cravings 10x harder. Eat protein and log it in MFP — now.',
    };
  });
});

// ── 12:30 PM — LUNCH + STEPS ─────────────────────────────────────────────────
exports.push1230 = onSchedule({ schedule: '30 12 * * *', timeZone: TIMEZONE }, async () => {
  await sendToAllUsers('12:30', ({ checkin }) => {
    if (checkin.lunch === 'yes') {
      return { title: '✅ Coach Angela', body: 'Lunch logged. Now check your steps — where are you at? Keep moving through the afternoon.' };
    }
    return {
      title: '🥗 Coach Angela — 12:30 PM',
      body: 'Lunch time. Don\'t skip it — an empty gut this afternoon is your biggest enemy. Protein first, log it in MFP, then check your step count.',
    };
  });
});

// ── 3:00 PM — DANGER ZONE ────────────────────────────────────────────────────
exports.push1500 = onSchedule({ schedule: '0 15 * * *', timeZone: TIMEZONE }, async () => {
  await sendToAllUsers('15:00', ({ checkin, alcoholStreak }) => {
    if (checkin.alcohol === 'yes') {
      return { title: '😤 Coach Angela', body: 'Today already had a slip — that\'s done. Don\'t let it turn into two. Reset right now: hot tea, no exceptions.' };
    }
    const streakLine = alcoholStreak >= 3 ? ` You're ${alcoholStreak} days clean — don't hand it away now.` : '';
    return {
      title: '⚠️ Coach Angela — 3:00 PM',
      body: `Danger zone. This is when cravings hit hardest and willpower is lowest. Hot tea, right now. Feeling tempted? Open the app and hit the craving button.${streakLine}`,
    };
  });
});

// ── 5:00 PM — WORKOUT ────────────────────────────────────────────────────────
exports.push1700 = onSchedule({ schedule: '0 17 * * *', timeZone: TIMEZONE }, async () => {
  await sendToAllUsers('17:00', ({ checkin }) => {
    if (checkin.workout === 'full' || checkin.workout === 'partial') {
      return { title: '💪 Coach Angela', body: 'Workout\'s in the books. Proud of you — now finish the day just as strong.' };
    }
    if (checkin.workout === 'rest') {
      return { title: '😴 Coach Angela', body: 'Planned rest day — good. Recovery is part of the plan, not an excuse. Still hit your steps and water.' };
    }
    return {
      title: '💪 Coach Angela — 5:00 PM',
      body: 'Workout time. No excuse not to go. You don\'t have to feel like it — you just have to start. Shoes on, everything else follows.',
    };
  });
});

// ── 8:00 PM — DINNER + CLOSE DAY ─────────────────────────────────────────────
exports.push2000 = onSchedule({ schedule: '0 20 * * *', timeZone: TIMEZONE }, async () => {
  await sendToAllUsers('20:00', ({ checkin }) => {
    if (checkin.dinner === 'yes') {
      return { title: '✅ Coach Angela', body: 'Dinner logged. Check your final step count and water total, then start winding down.' };
    }
    return {
      title: '🍽️ Coach Angela — 8:00 PM',
      body: 'Log dinner in MFP before you close the day. No skipping — incomplete logging is incomplete accountability. Then check your steps.',
    };
  });
});

// ── 9:30 PM — SCREENS OFF / DAILY RECAP ──────────────────────────────────────
exports.push2130 = onSchedule({ schedule: '30 21 * * *', timeZone: TIMEZONE }, async () => {
  await sendToAllUsers('21:30', ({ checkin }) => {
    const hasData = checkin && Object.keys(checkin).length > 2;
    const score = hasData ? calcScore(checkin) : null;
    const scoreLine = score !== null ? ` Today's score: ${score}/10.` : '';
    return {
      title: '🌙 Coach Angela — 9:30 PM',
      body: `Screens off. Sleep by 10 — that's when you actually change.${scoreLine} Tomorrow, go again.`,
    };
  });
});

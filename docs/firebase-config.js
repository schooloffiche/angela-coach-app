// ── FIREBASE CONFIG ────────────────────────────────────────────────────────
// Fill this in with YOUR project's values from:
// Firebase Console → Project Settings → General → "Your apps" → Web app
//
// This file is loaded both by the page (index.html) and by the service
// worker (sw.js), so keep it plain ES5 `var` — no `export`, no `import`.

var firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME"
};

// Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
// → generate a key pair → paste the "Key pair" string here.
var VAPID_KEY = "REPLACE_ME";

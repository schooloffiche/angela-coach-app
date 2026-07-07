// ── FIREBASE CONFIG ────────────────────────────────────────────────────────
// Fill this in with YOUR project's values from:
// Firebase Console → Project Settings → General → "Your apps" → Web app
//
// This file is loaded both by the page (index.html) and by the service
// worker (sw.js), so keep it plain ES5 `var` — no `export`, no `import`.

var firebaseConfig = {
  apiKey: "AIzaSyAU5NImE2Ab-ljHPbWo7w_jbqqaejBPP1A",
  authDomain: "health-coach-2ab07.firebaseapp.com",
  projectId: "health-coach-2ab07",
  storageBucket: "health-coach-2ab07.firebasestorage.app",
  messagingSenderId: "689648890138",
  appId: "1:689648890138:web:efe8282061f21e0cbebca3",
  measurementId: "G-H9B8ZXKMD4"
};

// Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
// → generate a key pair → paste the "Key pair" string here.
var VAPID_KEY = "BLC20P3apApHlSuGLGG8G-RJvrP6oyG5v0_bwoGt7qZIlhyZ4jafxalbmRLO_1GszsLknSW6mgtMvN3RjuU6jVc";

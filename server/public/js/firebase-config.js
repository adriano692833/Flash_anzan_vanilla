// firebase-config.js
// =====================================================================
// UZUPEŁNIJ danymi z konsoli Firebase (projekt z bazą anzan-db):
//   Firebase Console → Project settings → General → Your apps → Web app.
// apiKey jest publiczny (bezpieczny we froncie). Po włączeniu w konsoli
// Authentication → Sign-in method → Email/Password logowanie ruszy.
// =====================================================================

window.FIREBASE_CONFIG = {
    apiKey: "TODO_WKLEJ_API_KEY",
    authDomain: "TODO_WKLEJ_AUTH_DOMAIN",   // np. anzan-web.firebaseapp.com
    projectId: "TODO_WKLEJ_PROJECT_ID"
};

// Domena syntetycznych e-maili dla logowania „na nazwę" (uczeń nie musi mieć e-maila).
window.ANZAN_USER_EMAIL_DOMAIN = "students.anzan.local";

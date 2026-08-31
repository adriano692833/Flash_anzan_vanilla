// auth.js
// =====================================================================
// Warstwa logowania (Firebase Authentication, SDK compat z CDN).
// Uczeń rejestruje się sam „na nazwę + hasło" (mapowane na syntetyczny e-mail).
// Nauczyciel podaje dodatkowo kod dostępu (weryfikowany po stronie serwera).
// Po zalogowaniu udostępnia ID token, którym serwer potwierdza tożsamość.
// =====================================================================

(function () {
    if (typeof window === 'undefined') return;

    const app = window.app || (window.app = {});
    const ROLE_INTENT_KEY = 'anzan_role_intent';
    const auth = {
        user: null,          // { uid, name, role }
        _fbUser: null,
        ready: false,

        // Zamiana nazwy użytkownika na poprawny format e-mail dla Firebase.
        _emailFor: function (username) {
            const u = String(username || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
            return u + '@' + (window.ANZAN_USER_EMAIL_DOMAIN || 'students.anzan.local');
        },

        // Nazwa konta: displayName, a gdy go brak — czesc lokalna syntetycznego e-maila
        // (czyli nazwa uzytkownika podana przy rejestracji).
        _nameOf: function (fbUser) {
            if (!fbUser) return 'Uczeń';
            return fbUser.displayName || String(fbUser.email || '').split('@')[0] || 'Uczeń';
        },

        init: function () {
            if (!window.firebase || !window.FIREBASE_CONFIG) {
                console.error('Firebase SDK/config niezaładowany.');
                return;
            }
            if (String(window.FIREBASE_CONFIG.apiKey || '').startsWith('TODO')) {
                app.ui && app.ui.toast && app.ui.toast('Skonfiguruj Firebase (js/firebase-config.js).', 'error');
            }
            try { firebase.initializeApp(window.FIREBASE_CONFIG); } catch (e) { /* już init */ }

            firebase.auth().onAuthStateChanged((fbUser) => {
                this._fbUser = fbUser;
                this.ready = true;
                if (fbUser) {
                    this.user = { uid: fbUser.uid, name: this._nameOf(fbUser) };
                    // Podczas rejestracji displayName jeszcze nie istnieje — rejestracje na
                    // serwerze odpalamy dopiero po updateProfile(), inaczej do Firestore
                    // trafialaby nazwa zastepcza ("Uczen") dla kazdego konta.
                    if (this._suppressAutoRegister) return;
                    this._onLoggedIn();
                } else {
                    this.user = null;
                    this._showAuthScreen(true);
                }
            });
        },

        // Zwraca świeży ID token (do wysłania serwerowi).
        getIdToken: async function () {
            if (!this._fbUser) return null;
            try { return await this._fbUser.getIdToken(); } catch (e) { return null; }
        },

        register: async function (username, password, role, teacherCode) {
            const email = this._emailFor(username);
            this._suppressAutoRegister = true;
            try {
                const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
                await cred.user.updateProfile({ displayName: username });
                this._fbUser = cred.user;
                this.user = { uid: cred.user.uid, name: username };
                this._pendingRole = role;
                this._pendingTeacherCode = teacherCode;
                this._rememberRole(role);
                app.ui && app.ui.toast && app.ui.toast('Konto utworzone!', 'success');
                this._suppressAutoRegister = false;
                this._onLoggedIn();
            } catch (e) {
                this._suppressAutoRegister = false;
                app.ui && app.ui.toast && app.ui.toast('Rejestracja: ' + this._friendly(e), 'error');
                throw e;
            }
        },

        login: async function (username, password, role, teacherCode) {
            const email = this._emailFor(username);
            try {
                await firebase.auth().signInWithEmailAndPassword(email, password);
                this._pendingRole = role;
                this._pendingTeacherCode = teacherCode;
                this._rememberRole(role);
            } catch (e) {
                app.ui && app.ui.toast && app.ui.toast('Logowanie: ' + this._friendly(e), 'error');
                throw e;
            }
        },

        logout: async function () {
            try { localStorage.removeItem(ROLE_INTENT_KEY); } catch (e) { /* ignore */ }
            try { await firebase.auth().signOut(); } catch (e) { /* ignore */ }
            if (app.multi && app.multi.socket) app.multi.leaveRoom && app.multi.leaveRoom();
            location.reload();
        },

        _friendly: function (e) {
            const c = e && e.code || '';
            if (c.includes('email-already-in-use')) return 'nazwa jest już zajęta.';
            if (c.includes('weak-password')) return 'hasło za krótkie (min. 6 znaków).';
            if (c.includes('wrong-password') || c.includes('invalid-credential')) return 'błędna nazwa lub hasło.';
            if (c.includes('user-not-found')) return 'nie ma takiego konta.';
            if (c.includes('network')) return 'brak połączenia.';
            return (e && e.message) || 'nieznany błąd.';
        },

        _onLoggedIn: function () {
            this._toggleAuthUI(true);
            const badge = document.getElementById('auth-user-badge');
            if (badge) badge.innerText = '👤 ' + (this.user.name || '');
            // Po przeladowaniu strony _pendingRole jest pusty — bez tego nauczyciel
            // prosilby o role 'student'. Kod nauczyciela NIE jest zapamietywany.
            const role = this._pendingRole || this._recallRole();
            // Połącz i zarejestruj się na serwerze gier z tokenem + rolą.
            if (app.multi && typeof app.multi.authenticate === 'function') {
                app.multi.authenticate(role, this._pendingTeacherCode);
            }
        },

        _rememberRole: function (role) {
            try { localStorage.setItem(ROLE_INTENT_KEY, role === 'teacher' ? 'teacher' : 'student'); }
            catch (e) { /* ignore */ }
        },
        _recallRole: function () {
            try { return localStorage.getItem(ROLE_INTENT_KEY) || 'student'; }
            catch (e) { return 'student'; }
        },

        // Logowanie NIE blokuje całej aplikacji — dotyczy tylko sekcji multiplayer/ranking.
        // Tryby solo (Flash/Arkusz/Survival) działają bez konta.
        _showAuthScreen: function (show) { this._toggleAuthUI(!show); },

        _toggleAuthUI: function (loggedIn) {
            const login = document.getElementById('mp-login');
            const authed = document.getElementById('mp-authed');
            if (login) login.style.display = loggedIn ? 'none' : 'block';
            if (authed) authed.style.display = loggedIn ? 'block' : 'none';
        }
    };

    app.auth = auth;

    // Obsługa formularza logowania/rejestracji
    window.authSubmit = function (mode) {
        const username = document.getElementById('auth-username').value.trim();
        const password = document.getElementById('auth-password').value;
        const role = document.getElementById('auth-role').value;
        const teacherCode = document.getElementById('auth-teacher-code').value;
        if (!username || !password) {
            app.ui && app.ui.toast && app.ui.toast('Podaj nazwę i hasło.', 'warning');
            return;
        }
        if (mode === 'register') auth.register(username, password, role, teacherCode).catch(() => { });
        else auth.login(username, password, role, teacherCode).catch(() => { });
    };

    window.authToggleRole = function () {
        const role = document.getElementById('auth-role').value;
        const tc = document.getElementById('auth-teacher-code-row');
        if (tc) tc.style.display = role === 'teacher' ? 'block' : 'none';
    };
})();

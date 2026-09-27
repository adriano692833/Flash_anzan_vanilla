// auth.js
// =====================================================================
// Warstwa logowania (Firebase Authentication, SDK compat z CDN).
// Każde nowe konto wymaga jednorazowego zaproszenia weryfikowanego przez serwer.
// Konto z kontaktem e-mail używa go w Firebase; uczeń bez e-maila dostaje
// techniczny adres utworzony z nazwy użytkownika.
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
            const raw = String(username || '').trim().toLowerCase();
            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return raw;
            const u = raw.replace(/[^a-z0-9._-]/g, '');
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

        register: async function (username, password, inviteCode, contactEmail, contactPhone) {
            const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(contactEmail || '').trim())
                ? String(contactEmail).trim().toLowerCase()
                : this._emailFor(username);
            this._suppressAutoRegister = true;
            try {
                const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
                await cred.user.updateProfile({ displayName: username });
                this._fbUser = cred.user;
                this.user = { uid: cred.user.uid, name: username };
                this._pendingRole = '';
                this._pendingTeacherCode = inviteCode;
                this._pendingContactEmail = contactEmail;
                this._pendingContactPhone = contactPhone;
                this._createdForRegistration = true;
                app.ui && app.ui.toast && app.ui.toast('Weryfikuję uprawnienia konta…', 'info');
                this._suppressAutoRegister = false;
                this._onLoggedIn();
            } catch (e) {
                this._suppressAutoRegister = false;
                app.ui && app.ui.toast && app.ui.toast('Rejestracja: ' + this._friendly(e), 'error');
                throw e;
            }
        },

        login: async function (username, password) {
            const email = this._emailFor(username);
            // Rola nie jest wybierana podczas logowania. Serwer odczytuje ją z
            // istniejącego profilu w Firestore i traktuje jako autorytatywną.
            this._pendingRole = '';
            this._pendingTeacherCode = '';
            this._pendingContactEmail = '';
            this._pendingContactPhone = '';
            try {
                await firebase.auth().signInWithEmailAndPassword(email, password);
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

        confirmRegistration: function () {
            if (this._createdForRegistration && app.ui && app.ui.toast) {
                app.ui.toast('Konto utworzone i aktywowane!', 'success');
                const email = String(this._fbUser && this._fbUser.email || '');
                if (email && !email.endsWith('.anzan.local') && !this._fbUser.emailVerified) {
                    this._fbUser.sendEmailVerification().then(() => {
                        app.ui.toast('Wysłaliśmy też wiadomość potwierdzającą e-mail.', 'info');
                    }).catch(() => { /* odzyskiwanie hasła nadal pozostaje dostępne */ });
                }
            }
            this._createdForRegistration = false;
        },

        rollbackRegistration: async function () {
            if (!this._createdForRegistration || !this._fbUser) return;
            this._createdForRegistration = false;
            try { await this._fbUser.delete(); } catch (e) { /* świeże konto może być już usunięte */ }
            this._fbUser = null;
            this.user = null;
            this._showAuthScreen(true);
        },

        _friendly: function (e) {
            const c = e && e.code || '';
            if (c.includes('email-already-in-use')) return 'nazwa lub e-mail są już zajęte.';
            if (c.includes('invalid-email')) return 'adres e-mail jest nieprawidłowy.';
            if (c.includes('weak-password')) return 'hasło za krótkie (min. 6 znaków).';
            if (c.includes('wrong-password') || c.includes('invalid-credential')) return 'błędna nazwa lub hasło.';
            if (c.includes('user-not-found')) return 'nie ma takiego konta.';
            if (c.includes('network')) return 'brak połączenia.';
            return (e && e.message) || 'nieznany błąd.';
        },

        _onLoggedIn: function () {
            this._toggleAuthUI(true);
            const name = this.user.name || '';
            const badge = document.getElementById('auth-user-badge');
            if (badge) badge.innerText = '👤 ' + name;
            const side = document.getElementById('side-user-name');
            if (side) side.innerText = name;
            // Po przeladowaniu strony _pendingRole jest pusty — bez tego nauczyciel
            // prosilby o role 'student'. Kod nauczyciela NIE jest zapamietywany.
            const role = this._pendingRole || this._recallRole();
            // Połącz i zarejestruj się na serwerze gier z tokenem + rolą.
            if (app.multi && typeof app.multi.authenticate === 'function') {
                app.multi.authenticate(role, this._pendingTeacherCode, {
                    contactEmail: this._pendingContactEmail || '',
                    contactPhone: this._pendingContactPhone || ''
                });
            }
        },

        _rememberRole: function (role) {
            const safeRole = ['student', 'teacher', 'school_admin', 'guardian'].includes(role) ? role : 'student';
            try { localStorage.setItem(ROLE_INTENT_KEY, safeRole); }
            catch (e) { /* ignore */ }
        },
        _recallRole: function () {
            try { return localStorage.getItem(ROLE_INTENT_KEY) || 'student'; }
            catch (e) { return 'student'; }
        },

        // Konto jest wymagane od startu: bez zalogowania nie ma dostepu do zadnego
        // trybu. Dzieki temu XP, seria i historia naleza do ucznia, a nie do
        // przegladarki — postep chodzi za nim miedzy komputerami.
        _showAuthScreen: function (show) { this._toggleAuthUI(!show); },

        _toggleAuthUI: function (loggedIn) {
            const gate = document.getElementById('login-gate');
            const shell = document.querySelector('.app-container');
            // Pusty display przywraca układ CSS: grid na desktopie i block na telefonie.
            if (gate) gate.style.display = loggedIn ? 'none' : '';
            if (shell) shell.classList.toggle('is-locked', !loggedIn);

            const nameEl = document.getElementById('side-user-name');
            if (nameEl) nameEl.innerText = loggedIn ? (this.user && this.user.name) || '—' : '—';
            if (!loggedIn) {
                const roleEl = document.getElementById('side-role-badge');
                if (roleEl) roleEl.style.display = 'none';
            }
        }
    };

    app.auth = auth;

    // Obsługa formularza logowania/rejestracji
    window.authSubmit = function (mode) {
        const username = document.getElementById('auth-username').value.trim();
        const password = document.getElementById('auth-password').value;
        if (!username || !password) {
            app.ui && app.ui.toast && app.ui.toast('Podaj nazwę i hasło.', 'warning');
            return;
        }
        if (mode === 'register') {
            const inviteCode = document.getElementById('auth-teacher-code').value.trim();
            const contactEmail = document.getElementById('auth-contact-email').value.trim();
            const contactPhone = document.getElementById('auth-contact-phone').value.trim();
            if (!inviteCode) {
                app.ui && app.ui.toast && app.ui.toast('Podaj kod zaproszenia.', 'warning');
                return;
            }
            auth.register(username, password, inviteCode, contactEmail, contactPhone).catch(() => { });
        } else {
            auth.login(username, password).catch(() => { });
        }
    };

    window.authResetPassword = function () {
        const identifier = document.getElementById('auth-username').value.trim();
        if (!identifier) return app.ui.toast('Podaj e-mail konta.', 'warning');
        if (!identifier.includes('@')) return app.ui.toast('Konto bez e-maila resetuje nauczyciel lub administrator szkoły.', 'info');
        firebase.auth().sendPasswordResetEmail(auth._emailFor(identifier))
            .then(() => app.ui.toast('Jeśli konto istnieje, wiadomość do zmiany hasła została wysłana.', 'success'))
            .catch((error) => {
                if (String(error && error.code || '').includes('network')) app.ui.toast('Brak połączenia. Spróbuj ponownie.', 'error');
                else app.ui.toast('Jeśli konto istnieje, wiadomość do zmiany hasła została wysłana.', 'success');
            });
    };

    window.authSetMode = function (mode) {
        const registering = mode === 'register';
        auth._formMode = registering ? 'register' : 'login';
        const fields = document.getElementById('auth-registration-fields');
        const loginActions = document.getElementById('auth-login-actions');
        const registerActions = document.getElementById('auth-register-actions');
        const kicker = document.getElementById('auth-heading-kicker');
        const title = document.getElementById('auth-heading-title');
        const subtitle = document.getElementById('auth-heading-subtitle');
        const password = document.getElementById('auth-password');
        const reset = document.getElementById('auth-reset-action');
        if (fields) fields.style.display = registering ? 'block' : 'none';
        if (loginActions) loginActions.style.display = registering ? 'none' : 'grid';
        if (registerActions) registerActions.style.display = registering ? 'grid' : 'none';
        if (kicker) kicker.innerText = registering ? 'NOWE KONTO' : 'WITAJ PONOWNIE';
        if (title) title.innerText = registering ? 'Dołącz do swojej szkoły' : 'Wejdź do swojej szkoły';
        if (subtitle) subtitle.innerText = registering
            ? 'Wpisz jednorazowy kod — rola, szkoła i klasa zostaną przypisane automatycznie.'
            : 'Podaj nazwę użytkownika i hasło.';
        if (password) password.autocomplete = registering ? 'new-password' : 'current-password';
        if (reset) reset.style.display = registering ? 'none' : 'block';
        if (!registering) {
            const code = document.getElementById('auth-teacher-code');
            if (code) code.value = '';
        }
    };

    ['auth-username', 'auth-password', 'auth-teacher-code', 'auth-contact-email', 'auth-contact-phone'].forEach((id) => {
        const element = document.getElementById(id);
        if (element) element.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') window.authSubmit(auth._formMode || 'login');
        });
    });

    // Stabilny link do formularza rejestracji. Przyda się również jako punkt
    // docelowy przyszłych, jednorazowych zaproszeń właściciela szkoły.
    try {
        if (new URLSearchParams(window.location.search).get('auth') === 'register') {
            window.authSetMode('register');
            const invite = new URLSearchParams(window.location.search).get('invite');
            const input = document.getElementById('auth-teacher-code');
            if (invite && input) input.value = invite;
        }
    } catch (e) { /* starsza przeglądarka — pozostaje ekran logowania */ }
})();

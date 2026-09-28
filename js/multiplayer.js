(function () {
    if (typeof window === 'undefined' || !window.app) return;
    const app = window.app;
    const SOCKET_URL = window.ANZAN_SOCKET_URL || 'https://anzan-web.ew.r.appspot.com';

    function he(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // --- Multiplayer module ---

    app.multi = {
        socket: null,
        roomCode: '',
        role: '',
        isHost: false,
        roomLocked: false, // Stan lokalny blokady
        answeredTaskIndexes: new Set(),

        init: function () {
            // Socket juz istnieje: nigdy nie gubimy referencji (to zostawialo zombie
            // polaczenie i tworzylo drugie). Jesli jest rozlaczony, budzimy go i czekamy
            // na asynchroniczne 'connect'.
            if (this.socket) {
                if (!this.socket.connected) {
                    this.setStatus('connecting');
                    try { this.socket.connect(); } catch (e) { /* ignore */ }
                }
                return;
            }

            try {
                this.setStatus('connecting');
                // App Engine standard nie obsługuje WebSocketów. Używamy wyłącznie
                // long-pollingu, aby przeglądarka nie wykonywała nieudanego upgrade'u.
                this.socket = io(SOCKET_URL, {
                    transports: ['polling'],
                    upgrade: false,
                    reconnection: true,
                    // Instancja App Engine spi (min_instances: 0). 10 prob co 0.5 s konczylo
                    // sie poddaniem, zanim serwer zdazyl wstac — stad "cichy" pusty ekran.
                    reconnectionAttempts: Infinity,
                    reconnectionDelay: 500,
                    reconnectionDelayMax: 5000,
                    timeout: 20000
                });
                this.setupHandlers();
            } catch (e) {
                this.setStatus('error', 'Nie udało się połączyć z serwerem gier.');
                app.ui.toast('Błąd połączenia z serwerem gier.', 'error');
            }
        },

        // Połącz i zarejestruj się na serwerze tokenem Firebase. Wołane po zalogowaniu.
        // Rejestracja jest ponawiana przy każdym (re)connect, więc uid jest zawsze ustawiony
        // zanim gracz utworzy/dołączy do pokoju.
        authenticate: function (role, teacherCode, contacts) {
            this.pendingRole = role || 'student';
            this.pendingTeacherCode = teacherCode || '';
            this.pendingContacts = contacts || {};
            this.init();
            if (this.socket && this.socket.connected) this._sendRegister();
        },

        _sendRegister: async function () {
            if (!this.socket || !app.auth) return;
            const token = await app.auth.getIdToken();
            if (!token) return;
            this.socket.emit('register', {
                idToken: token,
                name: app.auth.user && app.auth.user.name,
                avatar: 'default',
                requestedRole: this.pendingRole,
                inviteCode: this.pendingTeacherCode,
                contactEmail: this.pendingContacts && this.pendingContacts.contactEmail,
                contactPhone: this.pendingContacts && this.pendingContacts.contactPhone
            });
        },

        setupHandlers: function () {
            const s = this.socket;
            if (!s) return;

            // Unikaj wielokrotnego bindowania na tym samym sockecie
            if (this._socketBound === s) return;
            this._socketBound = s;
            if (app.schoolOps && typeof app.schoolOps.bindSocket === 'function') app.schoolOps.bindSocket(s);

            s.on('connect', () => {
                console.log('Connected to server');
                this._connectErrors = 0;
                this.setStatus('connecting', 'Łączenie… (uwierzytelnianie)');
                // Zawsze (re)rejestruj tożsamość po połączeniu.
                this._sendRegister();
            });

            s.on('connect_error', (err) => {
                const msg = err && err.message ? err.message : String(err);
                console.warn('Connect error:', msg);
                this._connectErrors = (this._connectErrors || 0) + 1;
                // Instancja App Engine usypia (min_instances: 0), wiec pierwsze proby po
                // przerwie sa normalne — nie straszymy uzytkownika od razu.
                if (this._connectErrors === 3) {
                    this.setStatus('error', 'Serwer się wybudza — chwilę to potrwa…');
                    app.ui.toast('Serwer się wybudza, poczekaj chwilę…', 'info');
                } else if (this._connectErrors > 3) {
                    this.setStatus('error', 'Brak połączenia z serwerem (' + msg + ')');
                }
            });

            s.on('registered', (d) => {
                this.myRole = d.role;
                this.pendingRole = d.role;
                if (app.auth && typeof app.auth._rememberRole === 'function') app.auth._rememberRole(d.role);
                this.myUid = d.uid;
                this.schoolId = d.schoolId || '';
                if (this._resumeRoomCode) {
                    s.emit('resume_room', { code: this._resumeRoomCode });
                    this._resumeRoomCode = '';
                }
                this.schoolRole = d.schoolRole || '';
                this.canTeach = !!d.canTeach;
                this.pendingTeacherCode = '';
                this.pendingContacts = {};
                this._connectErrors = 0;
                // Odśwież listę klas nauczyciela / widok po zalogowaniu.
                if (d.role === 'teacher') {
                    this.loadClasses();
                    this.requestSchool();
                } else if (d.role === 'school_admin') {
                    if (this.canTeach) this.loadClasses();
                    this.requestSchool();
                    if (typeof window.nav === 'function') window.nav('multiplayer');
                } else if (d.role === 'guardian') {
                    this.requestSchool();
                }
                if (app.auth && app.auth.confirmRegistration) app.auth.confirmRegistration();
                this.updateAuthUI(d.role);
                this.setStatus('online');
                // Pasek boczny ma pokazywac dorobek konta od razu po zalogowaniu.
                this.requestProfile();
            });

            s.on('auth_error', (d) => {
                const m = (d && d.message) || 'Błąd logowania.';
                this.setStatus('error', m);
                app.ui.toast(m, 'error');
                if (d && d.rollback && app.auth && app.auth.rollbackRegistration) {
                    app.auth.rollbackRegistration();
                }
            });

            // --- KLASY I RANKING ---
            s.on('class_created', (d) => {
                app.ui.modal('Klasa utworzona', `Klasa „${he(d.name)}" jest gotowa. Uczniów dodaj przez jednorazowe zaproszenia w sekcji „Plan szkoły”.`);
                this.loadClasses();
            });
            s.on('school_data', (d) => this.renderSchool(d));
            s.on('school_dashboard', (d) => this.renderSchoolDashboard(d));
            s.on('classes_list', (d) => this.renderClasses(d.classes || []));
            s.on('class_joined', (d) => {
                this.studentClassId = d.classId;
                app.ui.toast(`Dołączono do klasy „${d.name}"`, 'success');
                this.requestClassLeaderboard(d.classId);
            });
            s.on('class_leaderboard', (d) => {
                if (this.myRole === 'school_admin') this.renderAdminClassLeaderboard(d.classId, d.board || []);
                else this.renderLeaderboard('class', d.board || []);
            });
            s.on('global_leaderboard', (d) => this.renderLeaderboard('global', d.board || []));
            s.on('profile_data', (d) => {
                this.studentClassId = (d && d.classId) || '';
                app.renderProfile(d);
            });
            s.on('training_presets_saved', (d) => {
                if (!d || !Array.isArray(d.presets)) return;
                app.customPresets = app._sanitizeCustomPresets(d.presets);
                app.save();
                app.renderKyuSelects();
            });
            s.on('class_members', (d) => this.renderClassMembers(d.classId, d.members || []));
            s.on('class_report', (d) => this.renderClassReport(d.classId, d.sessions || []));
            s.on('member_password_reset', (d) => {
                app.ui.modal('Hasło zresetowane', `Nowe tymczasowe hasło ucznia:<br><b style="font-size:1.4rem; color:var(--accent)">${he(d.tempPassword)}</b><br><span style="font-size:0.85rem">Przekaż je uczniowi — po zalogowaniu może grać dalej.</span>`);
            });
            s.on('info_msg', (m) => app.ui.toast(m, 'info'));

            s.on('disconnect', (reason) => {
                console.warn('Disconnected:', reason);
                if (reason !== 'io client disconnect') {
                    // Zerwanie laczy != wyjscie z pokoju. leaveRoom() zerowalo this.socket,
                    // co na stale wylaczalo automatyczne ponawianie Socket.IO — po pierwszym
                    // uspieniu instancji ekran zostawal pusty i cichy az do przeladowania.
                    this._handleDisconnect(reason);
                }
            });

            s.on('room_closed', (d) => {
                this._resetRoomState();
                app.ui.toast('Pokój został zamknięty' + (d && d.reason ? ` (${d.reason})` : '') + '.', 'info');
            });
            s.on('server_shutdown', () => {
                app.ui.toast('Serwer jest restartowany. Połączenie zostanie wznowione automatycznie.', 'warning');
            });
            s.on('score_save_failed', (d) => app.ui.toast((d && d.message) || 'Nie zapisano wyniku.', 'warning'));

            // --- LOBBY & JOINING ---

            s.on('room_created', (d) => {
                this.roomCode = d.code;
                this.role = 'host';
                this.isHost = true;
                this.roomLocked = false;
                if (!d.resumed) this.answeredTaskIndexes = new Set();
                const livePoints = document.getElementById('live-task-points');
                if (livePoints && Number.isInteger(d.pointsPerTask)) livePoints.value = d.pointsPerTask;
                this.showLobby();
                this.updateLobbyHeader();

                // Ustawiamy adapter multiplayer
                app.adapter = app.adapters.multiplayer;
            });

            s.on('joined_success', (d) => {
                this.roomCode = d.code;
                this.role = 'player';
                this.isHost = false;
                this.roomLocked = false; // Stan początkowy, zaktualizuje się przy lobby_update
                this.showLobby();
                this.updateLobbyHeader();
                app.multi.renderPlayers(d.players);

                // Ustawiamy adapter multiplayer
                app.adapter = app.adapters.multiplayer;
            });

            s.on('join_accepted', (d) => {
                this.roomCode = d.roomCode;
                this.role = 'player';
                this.isHost = false;
                this.showLobby();
                this.updateLobbyHeader();
                app.ui.toast(d.resumed ? 'Wróciłeś do trwających zajęć.' : "Nauczyciel Cię wpuścił! Powodzenia.", 'success');

                // Ustawiamy adapter multiplayer
                app.adapter = app.adapters.multiplayer;
            });

            s.on('join_rejected', (d) => {
                app.ui.modal("Nie udało się dołączyć", d.reason);
            });
            s.on('resume_failed', (d) => {
                this._resetRoomState();
                app.ui.toast((d && d.reason) || 'Nie udało się wrócić do pokoju.', 'warning');
            });

            s.on('join_error', (d) => {
                if (d.reason === 'GAME_IN_PROGRESS') {
                    // Zamiast confirm, używamy modala (lepsze UX)
                    app.ui.modal("Gra w toku", "Gra już trwa. Czy chcesz poprosić o dołączenie?", [
                        { label: "Anuluj", onClick: () => { } },
                        {
                            label: "Poproś",
                            primary: true,
                            onClick: () => {
                                // Tożsamość bierze serwer z konta; wysyłamy sam kod pokoju.
                                s.emit('request_join', {
                                    code: app.multi.roomCode || d.code
                                });
                                app.ui.toast("Wysłano prośbę...", 'info');
                            }
                        }
                    ]);
                } else if (d.reason === 'ROOM_LOCKED') {
                    app.ui.modal("Pokój zablokowany", "Nauczyciel zablokował możliwość dołączania do tego pokoju.");
                } else {
                    app.ui.toast("Błąd dołączania: " + d.reason, 'error');
                }
            });

            s.on('player_joined', (d) => {
                app.multi.renderPlayers(d.players);
            });

            // --- LOBBY UPDATES (Status, Lock, etc.) ---

            s.on('lobby_update', (d) => {
                this.roomLocked = !!d.locked;
                this.roomState = d.state || 'lobby';
                this.rankingHidden = !!d.hideLeaderboard;
                this.updateLobbyHeader(); // Odśwież kłódkę i przyciski
                this.renderPlayers(d.players);
                const me = (d.players || []).find(player => player.uid === this.myUid);
                const readyBtn = document.getElementById('lobby-ready-btn');
                if (readyBtn && me && !this.isHost) {
                    readyBtn.innerText = me.status === 'ready' ? 'COFNIJ GOTOWOŚĆ' : 'JESTEM GOTOWY';
                    readyBtn.className = me.status === 'ready' ? 'btn btn-primary' : 'btn btn-secondary';
                }

                if (this.isHost) {
                    this.updateLiveDashboard(d.players);
                }
            });

            s.on('room_locked', () => {
                this.roomLocked = true;
                this.updateLobbyHeader();
                app.ui.toast('Pokój został zablokowany.', 'info');
            });

            s.on('room_unlocked', () => {
                this.roomLocked = false;
                this.updateLobbyHeader();
                app.ui.toast('Pokój został odblokowany.', 'info');
            });

            s.on('player_kicked', (d) => {
                // Jeśli to my zostaliśmy wyrzuceni
                if (app.user && app.user.name && d.playerName === app.user.name) {
                    app.ui.modal('Zostałeś wyrzucony', 'Nauczyciel usunął Cię z pokoju.', [
                        {
                            label: 'OK',
                            primary: true,
                            // Wyrzucony z pokoju != wylogowany — socket zostaje, zeby
                            // uczen mogl od razu dolaczyc ponownie.
                            onClick: () => { this._resetRoomState(); }
                        }
                    ]);
                } else {
                    app.ui.toast(`Gracz ${d.playerName} został wyrzucony.`, 'info');
                }
            });

            // --- PLAYER REQUESTS (Host side) ---

            s.on('player_request', (d) => {
                // Custom Toast z akcjami
                const toast = document.createElement('div');
                toast.className = 'glass-card';
                toast.style.position = 'fixed';
                toast.style.top = '20px';
                toast.style.right = '20px';
                toast.style.padding = '1rem';
                toast.style.zIndex = '9999';
                toast.style.border = '1px solid var(--accent)';
                toast.style.background = 'rgba(15, 23, 42, 0.95)';
                toast.style.boxShadow = '0 8px 32px rgba(0,0,0,0.5)';
                toast.innerHTML = `
                    <div style="font-weight:bold; margin-bottom:0.5rem; color:var(--accent)">Prośba o dołączenie</div>
                    <div style="margin-bottom:0.5rem">${he(d.name)} chce dołączyć.</div>
                    <div style="display:flex; gap:0.5rem">
                        <button id="btn-acc-${d.pendingId}" class="btn btn-primary" style="padding:0.3rem 0.6rem; font-size:0.8rem">Wpuść</button>
                        <button id="btn-rej-${d.pendingId}" class="btn btn-danger" style="padding:0.3rem 0.6rem; font-size:0.8rem">Odrzuć</button>
                    </div>
                `;
                document.body.appendChild(toast);

                document.getElementById(`btn-acc-${d.pendingId}`).onclick = () => {
                    s.emit('accept_player', { roomCode: this.roomCode, pendingId: d.pendingId });
                    toast.remove();
                };
                document.getElementById(`btn-rej-${d.pendingId}`).onclick = () => {
                    s.emit('reject_player', { roomCode: this.roomCode, pendingId: d.pendingId });
                    toast.remove();
                };

                setTimeout(() => { if (toast.parentNode) toast.remove(); }, 30000);
            });

            // --- GAME EVENTS ---

            s.on('game_started', (d) => {
                // Rejestrujemy tylko config/tryb gry sieciowej. Gry NIE startujemy tutaj —
                // serwer wysyła tuż po tym 'task_update' z właściwymi liczbami, i to on
                // wywołuje app.startGame(). Uruchomienie gry również tutaj powodowało
                // podwójne odliczanie i wygenerowanie liczb lokalnie (zanim przyjdą z serwera).
                const tId = 'multi_temp';
                this.roundMode = d.mode === 'auto' ? 'auto' : 'manual';
                this.rankingHidden = !!d.hideLeaderboard;
                const ranking = document.getElementById('ranking-panel');
                if (ranking && !this.isHost) ranking.style.display = this.rankingHidden ? 'none' : 'block';
                app.kyu[tId] = d.config;
                // Dodaj tymczasową opcję do selecta, jeśli nie istnieje
                let opt = document.querySelector(`#game-kyu option[value="${tId}"]`);
                if (!opt) {
                    opt = document.createElement('option');
                    opt.value = tId;
                    opt.text = "Gra Sieciowa";
                    document.getElementById('game-kyu').add(opt);
                }
                document.getElementById('game-kyu').value = tId;
            });

            s.on('task_update', (d) => {
                if (!d?.data?.numbers?.length) {
                    console.error('[task_update] Malformed task data from server', d);
                    return;
                }
                // Wymuś tryb Multiplayer w UI. Prędkość wyświetlania bierzemy z serwera
                // (z konfiguracji poziomu nauczyciela), a nie ze sztucznej wartości.
                const tId = 'multi_temp';
                app.kyu[tId] = {
                    d: 1, // dummy (liczby i tak pochodzą z serwera)
                    o: d.data.numbers.length,
                    t: (typeof d.data.t === 'number' && d.data.t > 0) ? d.data.t : 2.0,
                    m: d.data.operation || 'add',
                    max: 0
                };

                // Hack: upewnij się, że opcja istnieje i jest wybrana
                let opt = document.querySelector(`#game-kyu option[value="${tId}"]`);
                if (!opt) {
                    opt = document.createElement('option');
                    opt.value = tId;
                    opt.text = "Gra Sieciowa";
                    document.getElementById('game-kyu').add(opt);
                }
                document.getElementById('game-kyu').value = tId;
                this.currentTaskIndex = Number.isInteger(d.index) ? d.index : null;
                app.state.answerLocked = d.canAnswer === false;
                app.state.taskPoints = Number.isInteger(d.data.points) ? d.data.points : null;

                // Nadpisz sekwencję liczb danymi z serwera
                app.state.nums = d.data.numbers;
                if (d.data.operation === 'mul') app.state.sum = d.data.numbers[0] * d.data.numbers[1];
                else if (d.data.operation === 'div') app.state.sum = d.data.numbers[0] / d.data.numbers[1];
                else app.state.sum = d.data.numbers.reduce((a, b) => a + b, 0);
                app.state.mode = 'flash';

                const waitMs = Math.max(0, Number(d.data.startsAt) - Number(d.data.serverNow));
                setTimeout(() => {
                    if (this.currentTaskIndex !== d.index) return;
                    app.startGame();
                    this.startRoundTimer(d.data);
                }, Math.min(waitMs, 5000));
            });

            s.on('validation_result', (d) => this._handleValidationResult(d));
            s.on('answer_rejected', (d) => {
                if (d && d.reason === 'ALREADY_ANSWERED') {
                    app.state.answerLocked = true;
                    app.state.checked = true;
                }
                if (this._pendingValidation) {
                    const pending = this._pendingValidation;
                    this._pendingValidation = null;
                    if (this._pendingValidationTimeout) clearTimeout(this._pendingValidationTimeout);
                    this._pendingValidationTimeout = null;
                    const reasons = { ALREADY_ANSWERED: 'Odpowiedź na to zadanie została już zapisana.', TOO_EARLY: 'Poczekaj do końca serii liczb.', ROUND_CLOSED: 'Runda jest już zamknięta.', STALE_TASK: 'Runda już się zmieniła.' };
                    pending.reject(new Error(reasons[d && d.reason] || 'Odpowiedź została odrzucona.'));
                }
            });
            s.on('task_points_updated', (d) => {
                const input = document.getElementById('live-task-points');
                if (input) input.value = d.points;
                app.ui.toast(`Następne zadanie: ${d.points} pkt.`, 'success');
            });
            s.on('session_completed', (d) => {
                if (this.timerInterval) clearInterval(this.timerInterval);
                this.roomState = 'completed';
                this.renderPlayers(d.players || []);
                app.ui.toast(`Sesja zakończona po ${d.taskCount} zadaniach.`, 'success');
                nav('multiplayer');
                this.showLobby();
                this.updateLobbyHeader();
            });

            s.on('round_ended', (d) => {
                if (this.timerInterval) clearInterval(this.timerInterval);
                if ((d.reason === 'TIMEOUT' || d.reason === 'AUTO') && !this.isHost && !app.state.checked) {
                    app.state.checked = true;
                    app.state.lastOk = false;
                    app.showResultScreenLocal(false, 0, NaN, false);
                    const answer = document.getElementById('res-correct');
                    if (answer) answer.innerText = app.state.sum;
                    app.ui.toast("Czas na odpowiedź minął.", 'info');
                }
            });

            s.on('leaderboard_update', (d) => this.renderPlayers(d.players));
            s.on('error_msg', (m) => app.ui.toast(m, 'error'));
        },

        // --- HOST ACTIONS (tylko nauczyciel) ---

        createRoom: function () {
            const k = document.getElementById('host-kyu').value;
            const trainingConfig = app.getTrainingConfig(k);
            const mode = document.getElementById('host-mode').value;
            const classSel = document.getElementById('host-class');
            const classId = classSel ? classSel.value : '';
            const pointsPerTask = Number(document.getElementById('host-task-points')?.value);
            const answerTimeSeconds = Number(document.getElementById('host-answer-time')?.value);
            const taskLimit = Number(document.getElementById('host-task-limit')?.value);
            const hideLeaderboard = document.getElementById('host-ranking-visibility')?.value === 'hidden';

            if (!this.canTeach) return app.ui.toast('Brak uprawnienia do prowadzenia zajęć.', 'warning');
            if (!classId) return app.ui.toast('Wybierz klasę dla pokoju.', 'warning');
            if (!trainingConfig) return app.ui.toast('Wybierz poziom lub zapisaną konfigurację.', 'warning');
            if (!Number.isInteger(pointsPerTask) || pointsPerTask < 0 || pointsPerTask > 100) return app.ui.toast('Punkty ustaw w zakresie 0–100.', 'warning');
            if (!Number.isInteger(answerTimeSeconds) || answerTimeSeconds < 5 || answerTimeSeconds > 120) return app.ui.toast('Czas odpowiedzi ustaw w zakresie 5–120 sekund.', 'warning');
            if (!Number.isInteger(taskLimit) || taskLimit < 0 || taskLimit > 100) return app.ui.toast('Liczbę zadań ustaw w zakresie 0–100.', 'warning');

            this.init();
            // Tożsamość/rola już zarejestrowane przez authenticate(); wysyłamy sam pokój.
            this.socket.emit('create_room', { config: trainingConfig, mode, classId, pointsPerTask, answerTimeSeconds, taskLimit, hideLeaderboard });
        },

        createSchool: function () {
            if (this.myRole !== 'school_admin') return app.ui.toast('Tylko administrator może utworzyć szkołę.', 'warning');
            const name = ((document.getElementById('school-name') || {}).value || '').trim();
            if (!name) return app.ui.toast('Podaj nazwę szkoły.', 'warning');
            this.init();
            this.socket.emit('create_school', { name });
        },
        requestSchool: function () {
            this.init();
            this.socket.emit('request_school');
        },
        renderSchool: function (school) {
            const onboarding = document.getElementById('school-onboarding');
            const info = document.getElementById('school-info');
            const teacherSummary = document.getElementById('teacher-school-summary');
            if (!school) {
                if (onboarding) onboarding.style.display = this.myRole === 'school_admin' ? 'block' : 'none';
                if (info) info.style.display = 'none';
                if (teacherSummary) teacherSummary.innerText = 'Konto nie jest jeszcze przypisane do szkoły — zaloguj się ponownie z kodem zaproszenia administratora.';
                const dashboard = document.getElementById('admin-dashboard');
                if (dashboard) dashboard.style.display = 'none';
                return;
            }
            this.schoolId = school.id;
            this.schoolRole = school.schoolRole || this.schoolRole || 'teacher';
            if (teacherSummary) teacherSummary.innerText = `${school.name || 'Szkoła'} · ${school.status === 'active' ? 'aktywna' : 'nieaktywna'}`;
            if (!onboarding || !info) return;
            onboarding.style.display = 'none';
            info.style.display = 'block';
            const isOwner = this.schoolRole === 'owner';
            info.innerHTML = `
                <div class="report-header">
                    <div><h2 style="margin:0;">${he(school.name || 'Szkoła')}</h2>
                    <div class="stat-label">Plan: ${he(school.plan || 'trial')} · ${isOwner ? 'Administrator szkoły' : 'Nauczyciel'}</div></div>
                    <span class="school-status ${school.status === 'active' ? '' : 'is-inactive'}">${school.status === 'active' ? 'Aktywna' : 'Nieaktywna'}</span>
                </div>
                ${isOwner ? `<div class="school-invite"><div><span class="stat-label">Bezpieczne zaproszenia</span><strong>Jednorazowe kody</strong></div><button class="btn btn-secondary" onclick="nav('school-operations')">Zarządzaj</button></div>` : ''}`;
            if (this.myRole === 'teacher') this.loadClasses();
            if (this.myRole === 'school_admin') this.requestSchoolDashboard();
        },

        requestSchoolDashboard: function () {
            if (this.myRole !== 'school_admin' || !this.schoolId) return;
            this.init();
            this.socket.emit('request_school_dashboard');
        },

        renderSchoolDashboard: function (data) {
            const panel = document.getElementById('admin-dashboard');
            const summary = document.getElementById('admin-summary');
            const teachersBox = document.getElementById('admin-teachers-list');
            const classesBox = document.getElementById('admin-classes-list');
            const status = document.getElementById('admin-dashboard-status');
            if (!panel || !summary || !teachersBox || !classesBox) return;
            panel.style.display = 'block';
            const totals = data.totals || {};
            summary.innerHTML = `
                <div><b>${Number(totals.teachers) || 0}</b><span>Nauczyciele</span></div>
                <div><b>${Number(totals.activeClasses) || 0}/${Number(totals.classes) || 0}</b><span>Aktywne klasy</span></div>
                <div><b>${Number(totals.students) || 0}</b><span>Uczniowie</span></div>
                <div><b>${Number(totals.sessions) || 0}</b><span>Zakończone zajęcia</span></div>`;
            teachersBox.innerHTML = (data.teachers || []).length
                ? data.teachers.map(teacher => `<div class="admin-staff-card"><b>${he(teacher.name || 'Nauczyciel')}</b><div class="stat-label">Konto nauczyciela</div></div>`).join('')
                : '<div style="color:var(--text-muted)">Brak nauczycieli. Użyj kodu zaproszenia widocznego powyżej.</div>';
            classesBox.innerHTML = (data.classes || []).length
                ? data.classes.map(item => `
                    <div class="admin-class-card">
                        <div class="report-header" style="margin-bottom:0.6rem;">
                            <div><b>${he(item.name)}</b> <span style="color:var(--text-muted)">${he(item.schoolYear || '')}</span>
                            <div class="stat-label">Nauczyciel: ${he(item.teacherName || '—')}</div></div>
                            <span class="school-status ${item.active ? '' : 'is-inactive'}">${item.active ? 'Aktywna' : 'Zamknięta'}</span>
                        </div>
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:0.6rem; flex-wrap:wrap;">
                            <span class="stat-label">${Number(item.studentCount) || 0} uczniów · ${Number(item.sessionCount) || 0} zajęć</span>
                            <span style="display:flex; gap:0.35rem; flex-wrap:wrap;">
                                <button class="btn btn-secondary" style="font-size:0.75rem" onclick="app.multi.listClassMembers('${he(item.id)}')">Uczniowie</button>
                                <button class="btn btn-secondary" style="font-size:0.75rem" onclick="app.multi.requestClassLeaderboard('${he(item.id)}')">Ranking</button>
                                <button class="btn btn-secondary" style="font-size:0.75rem" onclick="app.multi.requestClassReport('${he(item.id)}')">Historia zajęć</button>
                            </span>
                        </div>
                        <div id="members-${he(item.id)}" style="margin-top:0.5rem;"></div>
                        <div id="admin-ranking-${he(item.id)}" style="margin-top:0.5rem;"></div>
                        <div id="report-${he(item.id)}" style="margin-top:0.5rem;"></div>
                    </div>`).join('')
                : '<div style="color:var(--text-muted)">Brak klas. Nauczyciele mogą utworzyć pierwszą klasę po zalogowaniu.</div>';
            if (status) status.innerText = `Zaktualizowano ${new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`;
        },

        renderAdminClassLeaderboard: function (classId, board) {
            const box = document.getElementById('admin-ranking-' + classId);
            if (!box) return;
            box.innerHTML = `<div class="report-panel"><b>Ranking klasy</b>${(board || []).length
                ? board.map((row, index) => `<div style="display:flex; justify-content:space-between; padding:0.4rem 0; border-bottom:1px solid var(--glass-border);"><span>${index + 1}. ${he(row.name || 'Uczeń')}</span><b>${Number(row.points) || 0} pkt</b></div>`).join('')
                : '<div style="color:var(--text-muted); margin-top:0.5rem;">Brak wyników.</div>'}</div>`;
        },

        // --- ZARZĄDZANIE KLASAMI (nauczyciel) ---
        createClass: function () {
            const name = (document.getElementById('class-name') || {}).value || '';
            const year = (document.getElementById('class-year') || {}).value || '';
            if (!name.trim()) return app.ui.toast('Podaj nazwę klasy.', 'warning');
            this.init();
            this.socket.emit('create_class', { name: name.trim(), schoolYear: year.trim() });
        },
        loadClasses: function () {
            if (this.socket) this.socket.emit('list_classes');
        },
        renderClasses: function (classes) {
            this.myClasses = classes || [];
            // Wypełnij selecty klas (formularz pokoju + panel klas).
            const sel = document.getElementById('host-class');
            if (sel) {
                const activeClasses = this.myClasses.filter(c => c.active !== false);
                sel.innerHTML = activeClasses.length
                    ? activeClasses.map(c => `<option value="${he(c.id)}">${he(c.name)} (${he(c.schoolYear || '')})</option>`).join('')
                    : '<option value="">— brak klas, utwórz klasę —</option>';
            }
            const list = document.getElementById('teacher-classes-list');
            if (list) {
                list.innerHTML = this.myClasses.length
                    ? this.myClasses.map(c => `
                        <div class="glass-card" style="padding:0.6rem; margin-bottom:0.5rem;">
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
                                <div><b>${he(c.name)}</b> <span style="color:var(--text-muted)">${he(c.schoolYear || '')}${c.active === false ? ' (zamknięta)' : ''}</span><br>
                                <span style="font-size:0.85rem">Uczniowie dołączają przez jednorazowe zaproszenia.</span></div>
                                <div style="display:flex; gap:0.3rem; flex-wrap:wrap;">
                                    <button class="btn btn-secondary" style="font-size:0.75rem" onclick="app.multi.requestClassLeaderboard('${he(c.id)}')">Ranking</button>
                                    <button class="btn btn-secondary" style="font-size:0.75rem" onclick="app.multi.listClassMembers('${he(c.id)}')">Uczniowie</button>
                                    <button class="btn btn-secondary" style="font-size:0.75rem" onclick="app.multi.requestClassReport('${he(c.id)}')">Raport</button>
                                    <button class="btn btn-danger" style="font-size:0.75rem" onclick="app.multi.closeClass('${he(c.id)}')">Zamknij</button>
                                </div>
                            </div>
                            <div id="members-${he(c.id)}" style="margin-top:0.5rem;"></div>
                            <div id="report-${he(c.id)}" style="margin-top:0.5rem;"></div>
                        </div>`).join('')
                    : '<div style="color:var(--text-muted)">Brak klas. Utwórz pierwszą klasę powyżej.</div>';
            }
        },
        listClassMembers: function (classId) {
            this.init();
            this.socket.emit('list_class_members', { classId });
        },
        renderClassMembers: function (classId, members) {
            const box = document.getElementById('members-' + classId);
            if (!box) return;
            const canManage = this.canTeach && (this.myClasses || []).some(item => item.id === classId);
            box.innerHTML = (members && members.length)
                ? members.map(m => `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:0.3rem 0.4rem; border-top:1px solid var(--glass-border);">
                        <span>${he(m.name || 'Uczeń')} <span style="color:var(--accent)">${m.points || 0} pkt</span></span>
                        ${canManage ? `<span style="display:flex; gap:0.3rem;">
                            <button class="btn btn-secondary" style="font-size:0.7rem" onclick="app.multi.resetMemberPassword('${he(classId)}','${he(m.uid)}')">Reset hasła</button>
                            <button class="btn btn-danger" style="font-size:0.7rem" onclick="app.multi.removeMember('${he(classId)}','${he(m.uid)}')">Usuń</button>
                        </span>` : ''}
                    </div>`).join('')
                : '<div style="color:var(--text-muted); font-size:0.85rem; padding:0.3rem;">Brak uczniów w klasie.</div>';
        },
        requestClassReport: function (classId) {
            this.init();
            this.socket.emit('request_class_report', { classId });
        },
        _aggregateReport: function (sessions) {
            const students = new Map();
            let attempts = 0;
            let correct = 0;
            for (const session of sessions || []) {
                for (const row of session.students || []) {
                    const key = row.uid || row.name;
                    const stat = students.get(key) || { name: row.name || 'Uczeń', sessions: 0, attempts: 0, correct: 0, xp: 0, totalTime: 0 };
                    stat.sessions += 1;
                    stat.attempts += Number(row.attempts) || 0;
                    stat.correct += Number(row.correct) || 0;
                    stat.xp += Number(row.xp) || 0;
                    stat.totalTime += Number(row.totalTime) || 0;
                    attempts += Number(row.attempts) || 0;
                    correct += Number(row.correct) || 0;
                    students.set(key, stat);
                }
            }
            return { students: Array.from(students.values()).sort((a, b) => b.correct - a.correct), attempts, correct };
        },
        renderClassReport: function (classId, sessions) {
            const box = document.getElementById('report-' + classId);
            if (!box) return;
            this._reports = this._reports || {};
            this._reports[classId] = sessions;
            if (!sessions.length) {
                box.innerHTML = '<div class="report-panel">Brak zakończonych zajęć. Raport pojawi się po zamknięciu pierwszego pokoju.</div>';
                return;
            }
            const summary = this._aggregateReport(sessions);
            const accuracy = summary.attempts ? Math.round(summary.correct / summary.attempts * 100) : 0;
            const studentRows = summary.students.map(row => {
                const rowAccuracy = row.attempts ? Math.round(row.correct / row.attempts * 100) : 0;
                const avg = row.attempts ? (row.totalTime / row.attempts / 1000).toFixed(1) : '—';
                return `<tr><td>${he(row.name)}</td><td>${row.sessions}</td><td>${row.correct}/${row.attempts}</td><td>${rowAccuracy}%</td><td>${avg}s</td><td>${row.xp}</td></tr>`;
            }).join('');
            const recentRows = sessions.slice(0, 10).map(session => {
                const date = new Date(Number(session.startedAt) || Date.now()).toLocaleString('pl-PL');
                const training = session.trainingName || (session.kyuId ? session.kyuId + ' Kyū' : '—');
                return `<tr><td>${he(date)}</td><td>${he(training)}</td><td>${Number(session.taskCount) || 0}</td><td>${Number(session.studentCount) || 0}</td></tr>`;
            }).join('');
            box.innerHTML = `
                <div class="report-panel">
                    <div class="report-header"><div><b>Raport klasy</b><div class="stat-label">Ostatnie ${sessions.length} zajęć</div></div>
                    <button class="btn btn-secondary" onclick="app.multi.exportClassReport('${he(classId)}')">Eksport CSV</button></div>
                    <div class="report-kpis"><div><b>${sessions.length}</b><span>Zajęcia</span></div><div><b>${summary.students.length}</b><span>Aktywni uczniowie</span></div><div><b>${summary.correct}</b><span>Poprawne</span></div><div><b>${accuracy}%</b><span>Skuteczność</span></div></div>
                    <h4>Postęp uczniów</h4><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Uczeń</th><th>Zajęcia</th><th>Wynik</th><th>Skuteczność</th><th>Śr. czas</th><th>XP</th></tr></thead><tbody>${studentRows}</tbody></table></div>
                    <h4>Ostatnie zajęcia</h4><div class="report-table-wrap"><table class="report-table"><thead><tr><th>Data</th><th>Poziom</th><th>Zadania</th><th>Uczniowie</th></tr></thead><tbody>${recentRows}</tbody></table></div>
                </div>`;
        },
        exportClassReport: function (classId) {
            const sessions = (this._reports && this._reports[classId]) || [];
            const summary = this._aggregateReport(sessions);
            const quote = value => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
            const rows = [['Uczeń', 'Liczba zajęć', 'Próby', 'Poprawne', 'Skuteczność %', 'Średni czas s', 'XP']];
            summary.students.forEach(row => rows.push([
                row.name,
                row.sessions,
                row.attempts,
                row.correct,
                row.attempts ? Math.round(row.correct / row.attempts * 100) : 0,
                row.attempts ? (row.totalTime / row.attempts / 1000).toFixed(1) : '',
                row.xp
            ]));
            const blob = new Blob(['\uFEFF' + rows.map(row => row.map(quote).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `anzan-raport-${classId}-${new Date().toISOString().slice(0, 10)}.csv`;
            link.click();
            URL.revokeObjectURL(url);
        },
        removeMember: function (classId, uid) {
            if (!confirm('Usunąć tego ucznia z klasy?')) return;
            this.init();
            this.socket.emit('remove_class_member', { classId, uid });
        },
        resetMemberPassword: function (classId, uid) {
            if (!confirm('Zresetować hasło ucznia? Otrzymasz nowe tymczasowe hasło do przekazania.')) return;
            this.init();
            this.socket.emit('reset_member_password', { classId, uid });
        },
        closeClass: function (classId) {
            if (!confirm('Zamknąć klasę (zakończyć rok)? Uczniowie nie dołączą już tym kodem.')) return;
            this.init();
            this.socket.emit('close_class', { classId });
        },

        // --- KLASA / RANKING (uczeń i nauczyciel) ---
        requestClassLeaderboard: function (classId) {
            const id = classId || this.studentClassId;
            if (!id) return app.ui.toast('Najpierw dołącz do klasy.', 'warning');
            this.init();
            this.socket.emit('request_class_leaderboard', { classId: id });
        },
        requestGlobalLeaderboard: function () {
            this.init();
            this.socket.emit('request_global_leaderboard');
        },
        requestProfile: function () {
            this.init();
            this.socket.emit('request_profile');
        },
        renderLeaderboard: function (scope, board) {
            const el = document.getElementById('leaderboard-body');
            const title = document.getElementById('leaderboard-title');
            const titles = {
                class: 'Ranking klasy',
                global: 'Ranking całej szkoły'
            };
            if (title) title.innerText = titles[scope] || titles.global;
            if (!el) return;
            const pts = (p) => {
                if (scope === 'class') return p.points || 0;
                return p.totalXp || 0;
            };
            const rows = (board || []).slice(0, 50);
            el.innerHTML = rows.length
                ? rows.map((p, i) => `
                    <div style="display:flex; justify-content:space-between; padding:0.4rem 0.6rem; border-bottom:1px solid var(--glass-border); ${i < 3 ? 'font-weight:bold;' : ''}">
                        <span>${i + 1}. ${he(p.name || 'Uczeń')}</span>
                        <span style="color:var(--accent)">${pts(p)} pkt</span>
                    </div>`).join('')
                : '<div style="color:var(--text-muted); padding:0.6rem">Brak wyników.</div>';
        },
        updateAuthUI: function (role) {
            const a = document.getElementById('admin-panel');
            const t = document.getElementById('teacher-panel');
            const s = document.getElementById('student-panel');
            const ranking = document.getElementById('ranking-panel');
            if (a) a.style.display = role === 'school_admin' ? 'block' : 'none';
            if (t) t.style.display = role === 'teacher' || this.canTeach ? 'block' : 'none';
            if (s) s.style.display = role === 'student' ? 'block' : 'none';
            if (ranking) ranking.style.display = ['school_admin', 'guardian'].includes(role) ? 'none' : 'block';

            const label = role === 'school_admin' ? 'Właściciel szkoły'
                : role === 'teacher' ? 'Nauczyciel'
                    : role === 'guardian' ? 'Opiekun' : 'Uczeń';
            ['auth-role-badge', 'side-role-badge'].forEach((id) => {
                const badge = document.getElementById(id);
                if (!badge) return;
                badge.innerText = label;
                badge.style.display = 'inline-block';
                badge.style.borderColor = role === 'student' ? 'var(--glass-border)' : 'var(--accent)';
            });
        },

        // Stan polaczenia z serwerem gier — widoczny na ekranie, zeby cicha awaria
        // (uspiona instancja, wygasly token) nie wygladala jak pusty ekran.
        setStatus: function (state, text) {
            const els = ['mp-conn-status', 'side-conn-status']
                .map((id) => document.getElementById(id))
                .filter(Boolean);
            if (!els.length) return;
            const map = {
                idle:       ['var(--text-muted)', 'Nie połączono'],
                connecting: ['#f59e0b', 'Łączenie z serwerem…'],
                online:     ['#22c55e', 'Połączono'],
                offline:    ['#f59e0b', 'Brak połączenia — ponawiam…'],
                error:      ['#ef4444', 'Błąd połączenia']
            };
            const [color, deflt] = map[state] || map.idle;
            const html = '<span style="font-size:0.7em; vertical-align:middle">●</span> ' + he(text || deflt);
            els.forEach((el) => { el.style.color = color; el.innerHTML = html; });
        },

        startGame: function () {
            if (this.socket && this.isHost) {
                this.socket.emit('host_start_game', { code: this.roomCode });
            }
        },

        toggleReady: function () {
            if (this.socket && this.roomCode && !this.isHost) this.socket.emit('toggle_ready', { code: this.roomCode });
        },

        repeatTask: function () {
            if (this.socket && this.roomCode && this.isHost) this.socket.emit('repeat_task', { code: this.roomCode });
        },

        setTaskPoints: function () {
            if (!this.socket || !this.roomCode || !this.isHost) return;
            const points = Number(document.getElementById('live-task-points')?.value);
            if (!Number.isInteger(points) || points < 0 || points > 100) return app.ui.toast('Punkty ustaw w zakresie 0–100.', 'warning');
            this.socket.emit('set_task_points', { code: this.roomCode, points });
        },

        endSession: function () {
            if (!this.socket || !this.isHost || !this.roomCode) return;
            if (!confirm('Zakończyć zajęcia i zapisać raport klasy?')) return;
            this.socket.emit('close_room', { code: this.roomCode });
        },

        forceEndRound: function () {
            if (this.isHost && this.socket) {
                this.socket.emit('force_end_round', { code: this.roomCode });
            }
        },

        toggleLockRoom: function () {
            if (!this.isHost || !this.socket) return;
            // Optimistic UI update
            const newState = !this.roomLocked;
            this.socket.emit('toggle_lock_room', { code: this.roomCode, lock: newState });
        },

        kickPlayer: function (playerId) {
            if (!this.isHost || !this.socket) return;
            if (confirm("Czy na pewno chcesz wyrzucić tego gracza?")) {
                this.socket.emit('kick_player', { code: this.roomCode, playerId: playerId });
            }
        },

        // --- PLAYER ACTIONS ---

        joinRoom: function () {
            const c = document.getElementById('join-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (!c || c.length < 4) return app.ui.toast('Podaj poprawny kod pokoju!', 'warning');

            // Tożsamość (nazwa/uid) pochodzi z zalogowanego konta — zarejestrowana przez authenticate().
            this.init();
            this.socket.emit('request_join', { code: c });
        },

        // Sprzatanie stanu pokoju — WSPOLNE dla swiadomego wyjscia i dla zerwania laczy.
        // Nie dotyka this.socket.
        _resetRoomState: function () {
            if (this.timerInterval) {
                clearInterval(this.timerInterval);
                this.timerInterval = null;
            }
            this.timeLeft = 0;
            const timerDisplay = document.getElementById('lobby-timer');
            if (timerDisplay) timerDisplay.innerText = "⏳ --";

            this.roomCode = '';
            this.role = '';
            this.isHost = false;
            this.roomLocked = false;
            this.roomState = 'lobby';
            this.currentTaskIndex = null;
            this.answeredTaskIndexes = new Set();
            app.state.answerLocked = false;
            app.state.taskPoints = null;
            const ranking = document.getElementById('ranking-panel');
            if (ranking) ranking.style.display = 'block';

            // Przywróć lokalny adapter
            app.adapter = app.adapters.local;

            // Ukryj widok nauczyciela
            if (app.ui.showTeacherLiveView) app.ui.showTeacherLiveView(false);

            this.showSelection();
        },

        // Zerwanie polaczenia (sie padla, instancja usnela). Socket zostaje przy zyciu,
        // zeby Socket.IO samo sie wpielo z powrotem i ponowilo rejestracje w 'connect'.
        _handleDisconnect: function (reason) {
            const wasInRoom = !!this.roomCode;
            if (wasInRoom) this._resumeRoomCode = this.roomCode;
            this._resetRoomState();
            this.setStatus('offline');
            if (wasInRoom) app.ui.toast('Utracono połączenie — wracam do serwera…', 'warning');
        },

        // Swiadome wyjscie uzytkownika (przycisk „Opuść Pokój" / wylogowanie).
        leaveRoom: function () {
            const code = this.roomCode;
            const wasHost = this.isHost;
            if (this.socket && code) this.socket.emit(wasHost ? 'close_room' : 'leave_room', { code });
            this._resetRoomState();
            if (this.socket) {
                this.socket.disconnect();
                this.socket = null;
            }
            this._socketBound = null;
            this.setStatus('idle');
        },

        // --- UI UPDATES ---

        updateLobbyHeader: function () {
            const codeEl = document.getElementById('lobby-room-code');
            const lockBtn = document.getElementById('lobby-lock-btn');
            const startBtn = document.getElementById('lobby-start-btn');
            const endBtn = document.getElementById('lobby-end-btn');
            const readyBtn = document.getElementById('lobby-ready-btn');

            if (codeEl) {
                const lockIcon = this.roomLocked ? 'ZABLOKOWANY' : '';
                codeEl.innerText = `Pokój: ${this.roomCode} ${lockIcon}`;
            }

            if (lockBtn) {
                // Pokazuj tylko hostowi
                lockBtn.style.display = this.isHost ? 'inline-block' : 'none';
                lockBtn.innerText = this.roomLocked ? 'Odblokuj' : 'Zablokuj';
                lockBtn.className = this.roomLocked ? 'btn btn-primary' : 'btn btn-secondary';
            }

            if (startBtn) {
                startBtn.style.display = this.isHost && this.roomState !== 'playing' ? 'block' : 'none';
            }
            if (endBtn) {
                endBtn.style.display = this.isHost ? 'block' : 'none';
            }
            if (readyBtn) readyBtn.style.display = !this.isHost && this.roomState === 'lobby' ? 'block' : 'none';
        },

        renderPlayers: function (l) {
            const el = document.getElementById('lobby-players');
            const countEl = document.getElementById('lobby-count');
            if (el) {
                if (countEl) countEl.innerText = l.length;

                el.innerHTML = l.map((p, i) => {
                    let icon = '⏳';
                    if (p.status === 'thinking') icon = '…';
                    if (p.status === 'done') icon = 'OK';
                    if (p.role === 'host') icon = 'H';

                    let kickHtml = '';
                    if (this.isHost && p.role !== 'host') {
                        const safeId = he(p.id);
                        kickHtml = `<button class="btn btn-danger" style="font-size:0.7rem; padding: 0.3rem 0.6rem; margin-left:0.5rem;" onclick="app.multi.kickPlayer('${safeId}')">Usuń</button>`;
                    }

                    return `
                        <div class="glass-card" style="padding: 0.5rem; display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem; border-left: 4px solid ${i === 0 ? 'gold' : 'transparent'}">
                            <div style="display:flex; gap:1rem; align-items:center;">
                                <span style="font-weight:bold; color: #888; width: 20px;">#${i + 1}</span>
                                <div>
                                    <span style="font-weight:600">${he(p.name)}</span>
                                    <span style="margin-left:0.5rem; font-size:1.1rem" title="Status">${icon}</span>
                                </div>
                            </div>
                            <div style="text-align:right; display:flex; align-items:center; gap:1rem;">
                                <div>
                                    <div style="font-weight:bold; color:var(--accent)">${p.xp == null ? '—' : p.xp} XP</div>
                                    <div style="font-size:0.8rem; color:#aaa">⏱️ ${p.totalTime == null ? '—' : (p.totalTime / 1000).toFixed(1) + 's'}</div>
                                </div>
                                ${kickHtml}
                            </div>
                        </div>`;
                }).join('');
            }

            // Update Mini Board if in Result Screen
            if (this.lastMiniBoard) {
                this.updateMiniBoard(l);
            }
            this.lastLeaderboardData = l;
        },

        startRoundTimer: function (taskData) {
            if (this.timerInterval) clearInterval(this.timerInterval);
            const durationMs = Number(taskData && taskData.roundDurationMs);
            this.timeLeft = Math.max(1, Math.ceil((Number.isFinite(durationMs) ? durationMs : 60000) / 1000));
            const timerDisplay = document.getElementById('lobby-timer');
            if (timerDisplay) {
                timerDisplay.style.display = 'block';
                timerDisplay.innerText = this.timeLeft + " s";
            }

            this.timerInterval = setInterval(() => {
                this.timeLeft--;
                if (timerDisplay) timerDisplay.innerText = this.timeLeft + " s";

                if (this.timeLeft <= 0) {
                    clearInterval(this.timerInterval);
                    if (this.isHost && this.roundMode !== 'auto') {
                        this.forceEndRound();
                    }
                }
            }, 1000);
        },

        updateMiniBoard: function (players) {
            if (this.rankingHidden && !this.isHost) {
                this.lastMiniBoard.innerHTML = '<div style="color:var(--text-muted)">Ranking zostanie pokazany po zakończeniu sesji.</div>';
                return;
            }
            this.lastMiniBoard.innerHTML = players.slice(0, 5).map((p, i) => `
                <div style="display:flex; justify-content:space-between; margin-bottom: 2px; font-size: 0.8rem;">
                    <span>#${i + 1} ${he(p.name)}</span>
                    <span>${p.xp == null ? '—' : p.xp + 'xp'} (${p.totalTime == null ? '—' : ((p.totalTime || 0) / 1000).toFixed(1) + 's'})</span>
                </div>
            `).join('');
        },

        updateLiveDashboard: function (players) {
            const grid = document.getElementById('live-players-grid');
            if (!grid) return;
            grid.innerHTML = players.map(p => {
                let statusIcon = '⏳';
                let statusColor = '#888';
                if (p.status === 'thinking') { statusIcon = '…'; statusColor = 'var(--warning)'; }
                if (p.status === 'done') { statusIcon = 'OK'; statusColor = 'var(--success)'; }
                if (p.role === 'host') { statusIcon = 'H'; statusColor = 'var(--secondary)'; }

                return `
                        <div class="glass-card" style="padding:0.5rem; text-align:center; border:1px solid ${statusColor}; min-width: 80px;">
                            <div style="font-size:1.5rem; margin-bottom:0.2rem">${statusIcon}</div>
                            <div style="font-weight:bold; font-size:0.8rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${he(p.name)}</div>
                            <div style="font-size:0.7rem; color:#aaa">${p.xp} XP</div>
                        </div>`;
            }).join('');
        },

        _show: function (view) {
            const home = document.getElementById('mp-home');
            const lobby = document.getElementById('multi-lobby');
            if (home) home.style.display = view === 'home' ? 'block' : 'none';
            if (lobby) lobby.style.display = view === 'lobby' ? 'block' : 'none';
        },
        showSelection: function () { this._show('home'); },
        showLobby: function () { this._show('lobby'); },

        _handleValidationResult: function (d) {
            if (Number.isInteger(this.currentTaskIndex)) this.answeredTaskIndexes.add(this.currentTaskIndex);
            // Jeśli czekamy na Promise (submitAnswer)
            if (this._pendingValidation) {
                if (this._pendingValidationTimeout) {
                    clearTimeout(this._pendingValidationTimeout);
                    this._pendingValidationTimeout = null;
                }
                const pending = this._pendingValidation;
                this._pendingValidation = null;
                try {
                    pending.resolve({ correct: !!d.correct, xp: Math.max(0, Math.floor(d.xp || 0)), corAnswer: d.corAnswer });
                } catch (e) { console.error(e); }
                return;
            }
            // Fallback (jeśli UI nie czekało)
            app.ui.showResult({ ok: !!d.correct, xp: d.xp || 0, userAnswer: parseInt(document.getElementById('game-answer').value), isWaiting: false });
        }
    };

    // --- ADAPTER ---
    app.adapters = app.adapters || {};
    app.adapters.multiplayer = {
        submitAnswer: function (ctx, appRef) {
            const m = appRef.multi;
            if (!m || !m.socket || !m.roomCode) return Promise.reject(new Error('Multiplayer error'));
            if (m._pendingValidation) return Promise.reject(new Error('Busy'));

            return new Promise((resolve, reject) => {
                m._pendingValidation = { resolve, reject };
                try {
                    m.socket.emit('submit_answer', {
                        code: m.roomCode,
                        taskIndex: m.currentTaskIndex,
                        answer: ctx.answer,
                        time: ctx.time
                    });
                } catch (e) {
                    m._pendingValidation = null;
                    reject(e);
                }
                // Timeout na wypadek braku odpowiedzi serwera
                m._pendingValidationTimeout = setTimeout(() => {
                    if (m._pendingValidation) {
                        m._pendingValidation.reject(new Error("Timeout serwera"));
                        m._pendingValidation = null;
                    }
                }, 5000);
            });
        },
        nextTask: function (appRef) {
            const m = appRef.multi;
            if (!m || !m.roomCode) return false; // Nie obsłużono
            if (m.isHost) {
                m.socket.emit('next_task', { code: m.roomCode });
            }
            return true; // Obsłużono (nie rób nic lokalnie)
        }
    };

    // --- HOOKS ---
    // Pokaż widok nauczyciela gdy zaczyna się runda
    if (app.events && typeof app.events.on === 'function') {
        app.events.on('round:begin', () => {
            if (app.multi && app.multi.roomCode && app.multi.isHost) {
                app.ui.showTeacherLiveView(true);
                // Wymuś odświeżenie listy (statusy)
                if (app.multi.lastLeaderboardData) app.multi.updateLiveDashboard(app.multi.lastLeaderboardData);
            }
        });
    }

})();

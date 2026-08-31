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
                // Long-polling jako transport startowy — App Engine standard nie
                // obsluguje WebSocketow. Socket.IO sprobuje upgrade'u do WS samo,
                // a gdy sie nie uda, po prostu zostaje przy pollingu (zamiast padac).
                this.socket = io(SOCKET_URL, {
                    transports: ['polling', 'websocket'],
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
        authenticate: function (role, teacherCode) {
            this.pendingRole = role || 'student';
            this.pendingTeacherCode = teacherCode || '';
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
                teacherCode: this.pendingTeacherCode
            });
        },

        setupHandlers: function () {
            const s = this.socket;
            if (!s) return;

            // Unikaj wielokrotnego bindowania na tym samym sockecie
            if (this._socketBound === s) return;
            this._socketBound = s;

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
                this.myUid = d.uid;
                this._connectErrors = 0;
                // Odśwież listę klas nauczyciela / widok po zalogowaniu.
                if (d.role === 'teacher') this.loadClasses();
                this.updateAuthUI(d.role);
                this.setStatus('online');
            });

            s.on('auth_error', (d) => {
                const m = (d && d.message) || 'Błąd logowania.';
                this.setStatus('error', m);
                app.ui.toast(m, 'error');
            });

            // --- KLASY I RANKING ---
            s.on('class_created', (d) => {
                app.ui.modal('Klasa utworzona', `Klasa „${he(d.name)}" gotowa.<br>Kod dołączenia dla uczniów: <b style="font-size:1.3rem; color:var(--accent)">${he(d.joinCode)}</b>`);
                this.loadClasses();
            });
            s.on('classes_list', (d) => this.renderClasses(d.classes || []));
            s.on('class_joined', (d) => {
                this.studentClassId = d.classId;
                app.ui.toast(`Dołączono do klasy „${d.name}"`, 'success');
                this.requestClassLeaderboard(d.classId);
            });
            s.on('class_leaderboard', (d) => this.renderLeaderboard('class', d.board || []));
            s.on('global_leaderboard', (d) => this.renderLeaderboard('global', d.board || []));
            s.on('class_members', (d) => this.renderClassMembers(d.classId, d.members || []));
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

            // --- LOBBY & JOINING ---

            s.on('room_created', (d) => {
                this.roomCode = d.code;
                this.role = 'host';
                this.isHost = true;
                this.roomLocked = false;
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
                app.ui.toast("Nauczyciel Cię wpuścił! Powodzenia.", 'success');

                // Ustawiamy adapter multiplayer
                app.adapter = app.adapters.multiplayer;
            });

            s.on('join_rejected', (d) => {
                app.ui.modal("Nie udało się dołączyć", d.reason);
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
                this.updateLobbyHeader(); // Odśwież kłódkę i przyciski
                this.renderPlayers(d.players);

                if (this.isHost) {
                    this.updateLiveDashboard(d.players);
                }
            });

            s.on('room_locked', () => {
                this.roomLocked = true;
                this.updateLobbyHeader();
                app.ui.toast('Pokój został zablokowany 🔒', 'info');
            });

            s.on('room_unlocked', () => {
                this.roomLocked = false;
                this.updateLobbyHeader();
                app.ui.toast('Pokój został odblokowany 🔓', 'info');
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
                    <div style="font-weight:bold; margin-bottom:0.5rem; color:var(--accent)">🚪 Ktoś puka!</div>
                    <div style="margin-bottom:0.5rem">${d.name} chce dołączyć.</div>
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

                // Nadpisz sekwencję liczb danymi z serwera
                app.state.nums = d.data.numbers;
                app.state.sum = d.data.numbers.reduce((a, b) => a + b, 0); // Proste sumowanie do walidacji lokalnej (fallback)
                app.state.mode = 'flash';

                app.startGame();
                this.startRoundTimer();
            });

            s.on('validation_result', (d) => this._handleValidationResult(d));

            s.on('round_ended', (d) => {
                if (d.reason === 'TIMEOUT') {
                    if (!app.state.checked) {
                        // Czas minął, a gracz nie odpowiedział -> Auto fail
                        const inp = document.getElementById('game-answer');
                        if (inp) inp.value = '0';
                        app.checkGame();
                        app.ui.toast("Czas minął! ⏰", 'info');
                    }
                }
            });

            s.on('leaderboard_update', (d) => this.renderPlayers(d.players));
            s.on('error_msg', (m) => app.ui.toast(m, 'error'));
        },

        // --- HOST ACTIONS (tylko nauczyciel) ---

        createRoom: function () {
            const k = document.getElementById('host-kyu').value;
            const mode = document.getElementById('host-mode').value;
            const classSel = document.getElementById('host-class');
            const classId = classSel ? classSel.value : '';

            if (this.myRole !== 'teacher') return app.ui.toast('Tylko nauczyciel może utworzyć pokój.', 'warning');
            if (!classId) return app.ui.toast('Wybierz klasę dla pokoju.', 'warning');

            this.init();
            // Tożsamość/rola już zarejestrowane przez authenticate(); wysyłamy sam pokój.
            this.socket.emit('create_room', { config: app.kyu[k], mode, classId });
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
                sel.innerHTML = this.myClasses.length
                    ? this.myClasses.map(c => `<option value="${he(c.id)}">${he(c.name)} (${he(c.schoolYear || '')})</option>`).join('')
                    : '<option value="">— brak klas, utwórz klasę —</option>';
            }
            const list = document.getElementById('teacher-classes-list');
            if (list) {
                list.innerHTML = this.myClasses.length
                    ? this.myClasses.map(c => `
                        <div class="glass-card" style="padding:0.6rem; margin-bottom:0.5rem;">
                            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
                                <div><b>${he(c.name)}</b> <span style="color:var(--text-muted)">${he(c.schoolYear || '')}${c.active === false ? ' (zamknięta)' : ''}</span><br>
                                <span style="font-size:0.85rem">Kod: <b style="color:var(--accent)">${he(c.joinCode)}</b></span></div>
                                <div style="display:flex; gap:0.3rem; flex-wrap:wrap;">
                                    <button class="btn btn-secondary" style="font-size:0.75rem" onclick="app.multi.requestClassLeaderboard('${he(c.id)}')">🏆 Ranking</button>
                                    <button class="btn btn-secondary" style="font-size:0.75rem" onclick="app.multi.listClassMembers('${he(c.id)}')">👥 Uczniowie</button>
                                    <button class="btn btn-danger" style="font-size:0.75rem" onclick="app.multi.closeClass('${he(c.id)}')">Zamknij</button>
                                </div>
                            </div>
                            <div id="members-${he(c.id)}" style="margin-top:0.5rem;"></div>
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
            box.innerHTML = (members && members.length)
                ? members.map(m => `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:0.3rem 0.4rem; border-top:1px solid var(--glass-border);">
                        <span>${he(m.name || 'Uczeń')} <span style="color:var(--accent)">${m.points || 0} pkt</span></span>
                        <span style="display:flex; gap:0.3rem;">
                            <button class="btn btn-secondary" style="font-size:0.7rem" onclick="app.multi.resetMemberPassword('${he(classId)}','${he(m.uid)}')">Reset hasła</button>
                            <button class="btn btn-danger" style="font-size:0.7rem" onclick="app.multi.removeMember('${he(classId)}','${he(m.uid)}')">Usuń</button>
                        </span>
                    </div>`).join('')
                : '<div style="color:var(--text-muted); font-size:0.85rem; padding:0.3rem;">Brak uczniów w klasie.</div>';
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
        joinClass: function () {
            const code = ((document.getElementById('join-class-code') || {}).value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (!code) return app.ui.toast('Podaj kod klasy.', 'warning');
            this.init();
            this.socket.emit('join_class', { joinCode: code });
        },
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
        renderLeaderboard: function (scope, board) {
            const el = document.getElementById('leaderboard-body');
            const title = document.getElementById('leaderboard-title');
            if (title) title.innerText = scope === 'class' ? '🏆 Ranking klasy' : '🌍 Ranking globalny';
            if (!el) return;
            const pts = (p) => scope === 'class' ? (p.points || 0) : (p.totalXp || 0);
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
            const t = document.getElementById('teacher-panel');
            const s = document.getElementById('student-panel');
            if (t) t.style.display = role === 'teacher' ? 'block' : 'none';
            if (s) s.style.display = role === 'teacher' ? 'none' : 'block';

            const badge = document.getElementById('auth-role-badge');
            if (badge) {
                badge.innerText = role === 'teacher' ? '👨‍🏫 Nauczyciel' : '🎓 Uczeń';
                badge.style.display = 'inline-block';
                badge.style.borderColor = role === 'teacher' ? 'var(--accent)' : 'var(--glass-border)';
            }
        },

        // Stan polaczenia z serwerem gier — widoczny na ekranie, zeby cicha awaria
        // (uspiona instancja, wygasly token) nie wygladala jak pusty ekran.
        setStatus: function (state, text) {
            const el = document.getElementById('mp-conn-status');
            if (!el) return;
            const map = {
                idle:       ['var(--text-muted)', 'Nie połączono'],
                connecting: ['#f59e0b', 'Łączenie z serwerem…'],
                online:     ['#22c55e', 'Połączono'],
                offline:    ['#f59e0b', 'Brak połączenia — ponawiam…'],
                error:      ['#ef4444', 'Błąd połączenia']
            };
            const [color, deflt] = map[state] || map.idle;
            el.style.color = color;
            el.innerHTML = '<span style="font-size:0.7em; vertical-align:middle">●</span> ' + he(text || deflt);
        },

        startGame: function () {
            if (this.socket && this.isHost) {
                this.socket.emit('host_start_game', { code: this.roomCode });
            }
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
            this.socket.emit('join_room', { code: c });
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
            this._resetRoomState();
            this.setStatus('offline');
            if (wasInRoom) app.ui.toast('Utracono połączenie — wracam do serwera…', 'warning');
        },

        // Swiadome wyjscie uzytkownika (przycisk „Opuść Pokój" / wylogowanie).
        leaveRoom: function () {
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

            if (codeEl) {
                const lockIcon = this.roomLocked ? '🔒' : '';
                codeEl.innerText = `Pokój: ${this.roomCode} ${lockIcon}`;
            }

            if (lockBtn) {
                // Pokazuj tylko hostowi
                lockBtn.style.display = this.isHost ? 'inline-block' : 'none';
                lockBtn.innerText = this.roomLocked ? '🔓 Odblokuj' : '🔒 Zablokuj';
                lockBtn.className = this.roomLocked ? 'btn btn-primary' : 'btn btn-secondary';
            }

            if (startBtn) {
                startBtn.style.display = this.isHost ? 'block' : 'none';
            }
        },

        renderPlayers: function (l) {
            const el = document.getElementById('lobby-players');
            const countEl = document.getElementById('lobby-count');
            if (el) {
                if (countEl) countEl.innerText = l.length;

                el.innerHTML = l.map((p, i) => {
                    let icon = '⏳';
                    if (p.status === 'thinking') icon = '💭';
                    if (p.status === 'done') icon = '✅';
                    if (p.role === 'host') icon = '👑';

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
                                    <div style="font-weight:bold; color:var(--accent)">${p.xp || 0} XP</div>
                                    <div style="font-size:0.8rem; color:#aaa">⏱️ ${((p.totalTime || 0) / 1000).toFixed(1)}s</div>
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

        startRoundTimer: function () {
            if (this.timerInterval) clearInterval(this.timerInterval);
            this.timeLeft = 60;
            const timerDisplay = document.getElementById('lobby-timer');
            if (timerDisplay) {
                timerDisplay.style.display = 'block';
                timerDisplay.innerText = "⏳ 60s";
            }

            this.timerInterval = setInterval(() => {
                this.timeLeft--;
                if (timerDisplay) timerDisplay.innerText = "⏳ " + this.timeLeft + "s";

                if (this.timeLeft <= 0) {
                    clearInterval(this.timerInterval);
                    if (this.isHost) {
                        this.forceEndRound();
                    }
                }
            }, 1000);
        },

        updateMiniBoard: function (players) {
            this.lastMiniBoard.innerHTML = players.slice(0, 5).map((p, i) => `
                <div style="display:flex; justify-content:space-between; margin-bottom: 2px; font-size: 0.8rem;">
                    <span>#${i + 1} ${p.name}</span>
                    <span>${p.xp}xp (${((p.totalTime || 0) / 1000).toFixed(1)}s)</span>
                </div>
            `).join('');
        },

        updateLiveDashboard: function (players) {
            const grid = document.getElementById('live-players-grid');
            if (!grid) return;
            grid.innerHTML = players.map(p => {
                let statusIcon = '⏳';
                let statusColor = '#888';
                if (p.status === 'thinking') { statusIcon = '💭'; statusColor = 'var(--warning)'; }
                if (p.status === 'done') { statusIcon = '✅'; statusColor = 'var(--success)'; }
                if (p.role === 'host') { statusIcon = '👑'; statusColor = 'gold'; }

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
                    m.socket.emit('submit_answer', { code: m.roomCode, answer: ctx.answer, time: ctx.time });
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
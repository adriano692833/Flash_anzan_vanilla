// --- AUDIO ---
const audio = {
    ctx: null, enabled: true, voices: [],
    init: function () {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        if (!this.voices.length) {
            this.voices = window.speechSynthesis.getVoices();
            window.speechSynthesis.onvoiceschanged = () => this.voices = window.speechSynthesis.getVoices();
        }
    },
    playTone: function (f, t, d) {
        if (!this.enabled || !this.ctx) return;
        this.init();
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = t; o.frequency.setValueAtTime(f, this.ctx.currentTime);
        g.gain.setValueAtTime(0.1, this.ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + d);
        o.connect(g); g.connect(this.ctx.destination);
        o.start(); o.stop(this.ctx.currentTime + d);
    },
    beep: function () { this.playTone(800, 'sine', 0.1); },
    startBeep: function () { this.playTone(1200, 'square', 0.3); },
    success: function () {
        this.playTone(523, 'sine', 0.1); setTimeout(() => this.playTone(659, 'sine', 0.1), 100);
        setTimeout(() => this.playTone(784, 'sine', 0.2), 200);
    },
    error: function () { this.playTone(150, 'sawtooth', 0.3); setTimeout(() => this.playTone(100, 'sawtooth', 0.3), 150); },
    speak: function (txt) {
        if (!this.enabled) return;
        if (!this.hasVoiceSupport()) return;
        this.init(); window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(txt);
        u.lang = 'pl-PL';
        const v = this.voices.find(x => x.lang && x.lang.toLowerCase().includes('pl'));
        if (v) u.voice = v;
        window.speechSynthesis.speak(u);
    },
    hasVoiceSupport: function () {
        return typeof window !== 'undefined' && 'speechSynthesis' in window;
    },
    hasPolishVoice: function () {
        this.init();
        return !!(this.voices || []).find(x => x.lang && x.lang.toLowerCase().includes('pl'));
    }
};

// --- DEFAULT CONFIG ---
const DEFAULT_KYU = {
    // tier = poziom techniki sorobanu dopuszczony przez generator:
    //   direct   (bezpośrednie), friend5 (przyjaciele 5, bez przeniesienia),
    //   friend10 (przyjaciele 10, z przeniesieniem), full (wielocyfrowe mitori-zan).
    // Na poziomach jednorzędowych (direct/friend5) suma ≤ 9, więc 'o' jest mniejsze.
    20: { id: 20, name: "20 Kyu", category: "basic_introduction", tier: "direct", d: 1, o: { min: 3, max: 5 }, t: 8.0, m: 'add', max: 0, ops: { add: true }, range: { min: 1, max: 4 }, techniques: ["basic_counting"] },
    19: { id: 19, name: "19 Kyu", category: "basic", tier: "direct", d: 1, o: { min: 3, max: 5 }, t: 7.0, m: 'add', max: 0, ops: { add: true }, range: { min: 1, max: 4 }, techniques: ["basic_counting"] },
    18: { id: 18, name: "18 Kyu", category: "number_5_intro", tier: "direct", d: 1, o: { min: 3, max: 6 }, t: 6.0, m: 'add', max: 0, ops: { add: true }, range: { min: 1, max: 5 }, techniques: ["basic_counting", "number_5"] },
    17: { id: 17, name: "17 Kyu", category: "rule_5_basic", tier: "friend5", d: 1, o: { min: 4, max: 6 }, t: 5.0, m: 'mixed', max: 0, ops: { add: true, sub: true }, range: { min: 1, max: 9 }, techniques: ["rule_of_5_basic"] },
    16: { id: 16, name: "16 Kyu", category: "rule_5_consolidation", tier: "friend5", d: 1, o: { min: 4, max: 6 }, t: 4.5, m: 'add', max: 0, ops: { add: true }, range: { min: 1, max: 9 }, techniques: ["rule_of_5"] },
    15: { id: 15, name: "15 Kyu", category: "single_digit_full", tier: "friend5", d: 1, o: { min: 4, max: 7 }, t: 4.0, m: 'add', max: 0, ops: { add: true }, range: { min: 1, max: 9 }, techniques: ["rule_of_5"] },
    14: { id: 14, name: "14 Kyu", category: "rule_5_master", tier: "friend5", d: 1, o: { min: 5, max: 7 }, t: 3.5, m: 'add', max: 0, ops: { add: true }, range: { min: 1, max: 9 }, techniques: ["rule_of_5_advanced"] },
    13: { id: 13, name: "13 Kyu", category: "rule_10_intro_1", tier: "friend10", d: 1, o: { min: 5, max: 10 }, t: 3.0, m: 'add', max: 0, ops: { add: true }, range: { min: 1, max: 9 }, techniques: ["rule_of_5", "rule_of_10_basic"] },
    12: { id: 12, name: "12 Kyu", category: "rule_10_intro_2", tier: "friend10", d: 1, o: { min: 5, max: 10 }, t: 2.5, m: 'add', max: 0, ops: { add: true }, range: { min: 1, max: 9 }, techniques: ["rule_of_5", "rule_of_10_basic"] },
    11: { id: 11, name: "11 Kyu", category: "single_digit_mixed", tier: "friend10", d: 1, o: { min: 10, max: 15 }, t: 2.0, m: 'mixed', max: 0, ops: { add: true, sub: true }, range: { min: 1, max: 9 }, techniques: ["rule_of_10"] },
    10: { id: 10, name: "10 Kyu", category: "two_digit_1", tier: "full", d: 2, o: { min: 5, max: 10 }, t: 1.8, m: 'add', max: 0, ops: { add: true }, range: { min: 10, max: 99 }, techniques: ["rule_of_10"] },
    9: { id: 9, name: "9 Kyu", category: "two_digit_2", tier: "full", d: 2, o: { min: 5, max: 5 }, t: 1.6, m: 'mixed', max: 0, ops: { add: true, sub: true }, range: { min: 10, max: 99 }, techniques: ["rule_of_10"], mul: { a: { min: 10, max: 99 }, b: { min: 2, max: 9 } }, div: { divisor: { min: 2, max: 9 }, quotient: { min: 1, max: 9 } } },
    8: { id: 8, name: "8 Kyu", category: "three_digit_1", tier: "full", d: 3, o: { min: 5, max: 10 }, t: 1.4, m: 'add', max: 0, ops: { add: true }, range: { min: 100, max: 999 }, techniques: ["rule_of_10"] },
    7: { id: 7, name: "7 Kyu", category: "three_digit_2", tier: "full", d: 3, o: { min: 5, max: 10 }, t: 1.2, m: 'add', max: 0, ops: { add: true }, range: { min: 100, max: 999 }, techniques: ["rule_of_10"] },
    6: { id: 6, name: "6 Kyu", category: "four_digit", tier: "full", d: 4, o: { min: 5, max: 10 }, t: 1.0, m: 'add', max: 0, ops: { add: true }, range: { min: 1000, max: 9999 }, techniques: ["rule_of_10"] },
    5: { id: 5, name: "5 Kyu", category: "five_digit", tier: "full", d: 5, o: { min: 3, max: 7 }, t: 0.9, m: 'add', max: 0, ops: { add: true }, range: { min: 10000, max: 99999 }, techniques: ["rule_of_10"] },
    4: { id: 4, name: "4 Kyu", category: "six_digit", tier: "full", d: 6, o: { min: 3, max: 7 }, t: 0.8, m: 'add', max: 0, ops: { add: true }, range: { min: 100000, max: 999999 }, techniques: ["rule_of_10"] },
    3: { id: 3, name: "3 Kyu", category: "eight_digit", tier: "full", d: 8, o: { min: 3, max: 5 }, t: 0.7, m: 'add', max: 0, ops: { add: true }, range: { min: 10000000, max: 99999999 }, techniques: ["rule_of_10"] },
    2: { id: 2, name: "2 Kyu", category: "eight_digit_long", tier: "full", d: 8, o: { min: 5, max: 8 }, t: 0.5, m: 'add', max: 0, ops: { add: true }, range: { min: 10000000, max: 99999999 }, techniques: ["rule_of_10"] },
    1: { id: 1, name: "1 Kyu", category: "master", tier: "full", d: 8, o: { min: 8, max: 12 }, t: 0.3, m: 'add', max: 0, ops: { add: true }, range: { min: 10000000, max: 99999999 }, techniques: ["rule_of_10"] }
};

// Wersja drabinki kyū. Podbij przy zmianie DEFAULT_KYU, aby istniejący
// użytkownicy (z configiem w localStorage) dostali nową drabinkę.
const KYU_VERSION = 4;

// Wersja całej aplikacji + data i godzina ostatnich zmian. Podbij przy każdej
// istotnej zmianie — trafia do stopki PDF, więc łatwo śledzić, z której wersji
// aplikacji pochodzi wydrukowany arkusz.
const APP_VERSION = '4.2 Pro';
const APP_UPDATED = '2026-08-31';

// Lista dostępnych prędkości flash (sekundy) — jak w soroban-schule.
const FLASH_SPEEDS = [8.0, 6.0, 5.0, 4.0, 3.0, 2.0, 1.5, 1.0, 0.7, 0.5, 0.3];

// --- APP LOGIC ---
// Adres serwera gier: jedno źródło w js/config.js (window.ANZAN_SOCKET_URL).
const SOCKET_URL = window.ANZAN_SOCKET_URL || 'https://anzan-web.ew.r.appspot.com';
function createEmitter() {
    const listeners = new Map();
    return {
        on(event, fn) {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(fn);
            return () => this.off(event, fn);
        },
        off(event, fn) {
            const set = listeners.get(event);
            if (set) set.delete(fn);
        },
        emit(event, payload) {
            const set = listeners.get(event);
            if (!set) return;
            for (const fn of Array.from(set)) {
                try { fn(payload); } catch (e) { console.error('Event handler error:', event, e); }
            }
        }
    };
}

const app = {
    kyu: null,
    user: { xp: 0, level: 1, streak: 0, settings: { sound: true, wsTime: 5 } },
    state: { mode: '', nums: [], sum: null, idx: 0, timer: null, wsExp: [], checked: false },

    multi: null,

    adapter: null,
    adapters: {
        local: {
            /**
             * @param {{answer:number, expected:number, time:number}} ctx
             * @param {any} appRef
             * @returns {Promise<{correct:boolean, xp:number, corAnswer?:number}>}
             */
            submitAnswer: function (ctx, appRef) {
                const ok = (ctx.answer === ctx.expected);
                return Promise.resolve({ correct: ok, xp: ok ? 20 : 0 });
            },
            /**
             * @param {any} appRef
             * @returns {boolean} true => handled
             */
            nextTask: function (appRef) { return false; }
        }
    },
    events: createEmitter(),
    ui: null,

    init: function () {
        const s = localStorage.getItem('anzan_v3_user');
        if (s) {
            const d = JSON.parse(s);
            this.user = d.user;
            this.kyu = d.kyu || JSON.parse(JSON.stringify(DEFAULT_KYU));

            // Migracja: sprawdź czy mamy nowy system (np. czy istnieje poziom 20)
            // lub czy drabinka jest nieaktualna (KYU_VERSION). Reset configu poziomów,
            // zachowujemy postępy user.xp itp.
            if (!this.kyu['20'] || d.kyuVersion !== KYU_VERSION) {
                console.log("Migrating Kyu ladder to version", KYU_VERSION);
                this.kyu = JSON.parse(JSON.stringify(DEFAULT_KYU));
            }

            // Migracja: dodaj historię i osiągnięcia jeśli brak
            if (!this.user.history) this.user.history = {};
            if (!this.user.achievements) this.user.achievements = [];
        } else {
            this.kyu = JSON.parse(JSON.stringify(DEFAULT_KYU));
            this.user.history = {};
            this.user.achievements = [];
        }

        document.body.addEventListener('click', () => audio.init(), { once: true });
        document.body.addEventListener('touchstart', () => audio.init(), { once: true });

        this.renderKyuSelects();
        this.updateUI();
        this.updateSettingsUI();

        // FIX: Init editor with default view
        if (!document.getElementById('edit-kyu-select').value) {
            document.getElementById('edit-kyu-select').value = "10";
        }
        this.loadKyuEditor();

        // Obsługa Enter w polu wyniku
        document.getElementById('game-answer').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.checkGame();
        });

        nav('dashboard');
        // Init Chart
        this.renderChart();
        this.updateAchievementsUI();

        document.getElementById('game-kyu').addEventListener('change', () => this.updateGameInfo());
        document.getElementById('game-speed').addEventListener('change', () => this.updateSpeedInfo());
        this.updateGameInfo();

        // --- MOBILE NAV GESTURES ---
        const sb = document.querySelector('.sidebar');
        if (sb) {
            sb.classList.add('visible'); // Show by default
            let startY = 0;

            document.body.addEventListener('touchstart', (e) => {
                startY = e.touches[0].clientY;
            }, { passive: true });

            document.body.addEventListener('touchmove', (e) => {
                // Optional: track continuous movement
            }, { passive: true });

            document.body.addEventListener('touchend', (e) => {
                const endY = e.changedTouches[0].clientY;
                const diff = startY - endY;

                // Swipe UP (diff > 50) -> SHOW sidebar
                if (diff > 50) {
                    sb.classList.add('visible');
                }
                // Swipe DOWN (diff < -50) -> HIDE sidebar
                else if (diff < -50) {
                    sb.classList.remove('visible');
                }
            }, { passive: true });
        }
    },

    save: function () {
        // Zapisz historię XP (data -> xp)
        const today = new Date().toISOString().split('T')[0];
        this.user.history[today] = this.user.xp;

        const d = { user: this.user, kyu: this.kyu, kyuVersion: KYU_VERSION };
        localStorage.setItem('anzan_v3_user', JSON.stringify(d));
        this.updateUI();
        this.updateAchievementsUI(); // Sprawdź odznaki przy zapisie
    },

    exportData: function () {
        const data = JSON.stringify({ user: this.user, kyu: this.kyu });
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'anzan_backup_' + new Date().toISOString().split('T')[0] + '.json';
        a.click();
    },
    importData: function (input) {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const d = JSON.parse(e.target.result);
                if (d.user && d.kyu) {
                    this.user = d.user; this.kyu = d.kyu;
                    this.save();
                    app.ui.toast('Dane zaimportowane pomyślnie!', 'success');
                    location.reload();
                } else app.ui.toast('Nieprawidłowy format pliku.', 'error');
            } catch (err) { app.ui.toast('Błąd pliku: ' + err, 'error'); }
        };
        reader.readAsText(file);
    },

    multiHostSetup: function () {
        document.getElementById('multi-host-ui').style.display = 'block';
        document.getElementById('multi-join-ui').style.display = 'none';
    },
    multiJoinSetup: function () {
        document.getElementById('multi-host-ui').style.display = 'none';
        document.getElementById('multi-join-ui').style.display = 'block';
    },

    // --- GENERATOR ---
    // Delegujemy do wspólnego modułu SorobanGen (js/soroban-generator.js) —
    // jedno źródło prawdy współdzielone z serwerem. Moduł generuje ciągi
    // add/sub sprawdzane technikami sorobanu per kolumna oraz mnożenie/dzielenie.
    generateValidSequence: function (kyuConfig) {
        if (!window.SorobanGen) {
            console.error('SorobanGen niezaładowany — sprawdź kolejność <script> w index.html');
            return [];
        }
        return window.SorobanGen.generateSequence(kyuConfig);
    },

    // --- GAME ---

    startGame: function () {
        let kId = document.getElementById('game-kyu').value;

        // Tryb głosowy wymaga syntezatora mowy. Ostrzeż raz, gdy brak wsparcia lub
        // brak polskiego głosu (typowe na iOS Safari / części Androida).
        if (this.state.mode === 'spoken' && !this._voiceWarned) {
            this._voiceWarned = true;
            if (!audio.hasVoiceSupport()) {
                app.ui.toast('Ta przeglądarka nie obsługuje syntezatora mowy — użyj trybu Flash.', 'error');
            } else if (!audio.hasPolishVoice()) {
                app.ui.toast('Brak polskiego głosu w systemie — liczby mogą brzmieć nienaturalnie.', 'warning');
            }
        }

        // FORCE NEW NUMBERS if starting from Local Setup Screen (user might have changed config)
        const setupEl = document.getElementById('game-setup');
        const fromLocalSetup = setupEl && setupEl.style.display !== 'none';
        if (fromLocalSetup) {
            this.state.nums = [];
        }

        // Survival Logic override
        if (this.state.mode === 'survival') {
            kId = this.state.survivalLevel || 20; // Default to 20 Kyu
        }

        const cfg = this.kyu[kId];
        // const noNeg = cfg.noNeg === undefined ? true : cfg.noNeg; // Handled internally now

        // Prędkość flash — osobna oś, sterowana suwakiem tylko przy starcie z lokalnego
        // ekranu treningu. Survival i multiplayer używają domyślnej prędkości poziomu
        // (survival przyspiesza wraz z poziomem; MP bierze cfg.t z konfiguracji serwera).
        if (fromLocalSetup && this.state.mode !== 'survival') {
            const spEl = document.getElementById('game-speed');
            this.state.flashSpeed = spEl ? (parseFloat(spEl.value) || cfg.t) : cfg.t;
        } else {
            this.state.flashSpeed = cfg.t;
        }

        try {
            // Only generate new numbers if we don't have them from server (multiplayer)
            if (!this.state.nums || this.state.nums.length === 0) {
                // Nowe wywołanie generatora
                this.state.nums = this.generateValidSequence(cfg);
            }

            // Calc result based on mode (only if not already set)
            if (this.state.sum === undefined || this.state.sum === null) {
                // Proste sumowanie (nowy generator zwraca już liczby ze znakiem)
                this.state.sum = this.state.nums.reduce((a, b) => a + b, 0);
            }

            this.state.checked = false; // Reset flagi
        } catch (e) { console.error(e); return; }

        if (this.events) {
            this.events.emit('round:prepared', { cfgId: kId, cfg: cfg, nums: (this.state.nums || []).slice(), sum: this.state.sum, mode: this.state.mode });
        }


        // FIX: Ukryj ekran wyników, pokaż grę
        document.querySelectorAll('.screen').forEach(s => { s.style.display = 'none'; s.classList.remove('active'); });
        const gc = document.getElementById('game-container');
        gc.style.display = 'block';
        gc.classList.add('active');

        document.getElementById('game-setup').style.display = 'none';
        document.getElementById('game-run').style.display = 'block';
        document.getElementById('game-input').style.display = 'none';
        document.getElementById('visual-display').style.display = 'none';
        document.getElementById('audio-display').style.display = 'none';

        let c = 3;
        const el = document.getElementById('game-countdown');
        el.style.display = 'block'; el.innerText = c;
        const inv = setInterval(() => {
            audio.beep(); c--;
            if (c > 0) el.innerText = c;
            else {
                clearInterval(inv); audio.startBeep();
                el.style.display = 'none';



                if (this.events) {
                    this.events.emit('round:begin', { cfgId: kId, cfg: cfg, nums: (this.state.nums || []).slice(), sum: this.state.sum, mode: this.state.mode });
                }

                // Always run sequence
                this.state.idx = 0;
                this.runSequence(cfg);
            }
        }, 1000);
    },

    // --- EXTRAS ---
    startSurvival: function () {
        this.state.mode = 'survival';
        this.state.survivalLevel = 10;
        this.state.survivalStreak = 0;
        app.ui.modal("Tryb Survival", "Grasz do pierwszego błędu. Poziom rośnie co 3 wygrane. Powodzenia!");
        this.startGame();
    },

    renderChart: function () {
        const ctx = document.getElementById('xp-chart');
        if (!ctx) return;
        // Mock data if empty
        if (Object.keys(this.user.history || {}).length === 0) {
            this.user.history = { [new Date().toISOString().split('T')[0]]: this.user.xp };
        }

        const labels = Object.keys(this.user.history).sort().slice(-7);
        const data = labels.map(l => this.user.history[l]);

        if (this.chart) this.chart.destroy();
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Total XP',
                    data: data,
                    borderColor: '#8b5cf6',
                    backgroundColor: 'rgba(139, 92, 246, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' } }, x: { grid: { display: false } } },
                plugins: { legend: { display: false } }
            }
        });
    },

    updateAchievementsUI: function () {
        const list = document.getElementById('achievements-list');
        if (!list) return;
        list.innerHTML = '';
        const badges = [
            { id: 'novice', name: 'Start', icon: '👶', cond: u => u.xp > 50 },
            { id: 'pro', name: 'Pro', icon: '😎', cond: u => u.xp > 1000 },
            { id: 'master', name: 'Mistrz', icon: '🏆', cond: u => u.xp > 5000 },
            { id: 'streak5', name: 'Seria 5', icon: '🔥', cond: u => u.streak >= 5 },
            { id: 'survivor', name: 'Ocalały', icon: '🛡️', cond: u => this.state.survivalLevel < 9 }
        ];
        badges.forEach(b => {
            const unlocked = b.cond(this.user);
            const d = document.createElement('div');
            d.className = 'glass-card';
            d.style.padding = '0.5rem 0.8rem';
            d.style.opacity = unlocked ? 1 : 0.3;
            d.style.fontSize = '0.9rem';
            d.innerHTML = `${b.icon} ${b.name}`;
            if (unlocked) { d.style.border = '1px solid var(--accent)'; d.style.background = 'rgba(6, 182, 212, 0.2)'; }
            list.appendChild(d);
        });
    },

    runSequence: function (cfg) {
        if (this.state.idx >= this.state.nums.length) {
            // Capture start time (use global app reference for safety)
            app.state.startTime = Date.now();

            document.getElementById('visual-display').style.display = 'none';
            document.getElementById('audio-display').style.display = 'none';
            document.getElementById('game-input').style.display = 'block'; // FIX: Pokaż input
            document.getElementById('game-answer').value = '';
            document.getElementById('game-answer').focus();
            return;
        }
        const n = this.state.nums[this.state.idx];
        // document.getElementById('game-counter').innerText = `${this.state.idx + 1}/${this.state.nums.length}`;

        if (this.state.mode === 'flash') {
            const v = document.getElementById('visual-display');
            v.style.display = 'flex'; v.innerText = n;
            v.classList.remove('flash-anim'); void v.offsetWidth; v.classList.add('flash-anim');
            setTimeout(() => {
                v.innerText = ''; this.state.idx++;
                setTimeout(() => this.runSequence(cfg), 150);
            }, (this.state.flashSpeed || cfg.t) * 1000);
        } else {
            const a = document.getElementById('audio-display');
            a.style.display = 'block';
            audio.speak(n.toString());
            this.state.idx++;
            setTimeout(() => this.runSequence(cfg), 1000 + (n.toString().length * 300));
        }
    },

    checkGame: function () {
        if (this.state.checked) return;
        this.state.checked = true;

        const u = parseInt(document.getElementById('game-answer').value);
        const expected = this.state.sum;
        const timeTaken = Date.now() - (this.state.startTime || Date.now());

        const adapter = this.adapter || (this.adapters ? this.adapters.local : null);

        // Show immediate "waiting" UI for async adapters (e.g., multiplayer)
        const isAsync = adapter && adapter !== this.adapters.local;

        if (isAsync) {
            this.showResultScreenLocal(false, 0, u, true);
        }

        const ctx = { answer: u, expected: expected, time: timeTaken };

        try {
            const p = adapter && typeof adapter.submitAnswer === 'function'
                ? adapter.submitAnswer(ctx, this)
                : Promise.resolve({ correct: (u === expected), xp: (u === expected) ? 20 : 0 });

            Promise.resolve(p).then((res) => {
                // If waiting UI is already shown, this call will "finalize" the same screen.
                const ok = !!(res && res.correct);
                const xp = Math.max(0, Math.floor((res && res.xp) || 0));
                const corAnswer = (res && (res.corAnswer ?? res.cor_answer ?? res.expected)) ?? undefined;

                this.state.lastOk = ok;

                if (ok) audio.success(); else audio.error();

                if (!isNaN(xp) && xp > 0) this.user.xp += xp;

                this.save();
                if (typeof this.updateUI === 'function') this.updateUI();

                this.showResultScreenLocal(ok, xp, u, false);

                if (corAnswer !== undefined && corAnswer !== null) {
                    const el = document.getElementById('res-correct');
                    if (el) el.innerText = corAnswer;
                }
            }).catch((err) => {
                console.error('Validation error:', err);
                this.state.checked = false;
                app.ui.toast('Błąd walidacji odpowiedzi.', 'error');
            });
        } catch (e) {
            console.error(e);
            this.state.checked = false;
            app.ui.toast('Błąd walidacji odpowiedzi.', 'error');
        }
    },

    // Helper to show result screen (refactored)
    showResultScreenLocal: function (ok, xp, u, isWaiting) {
        if (this.ui && typeof this.ui.showResult === 'function') {
            this.ui.showResult({ ok: !!ok, xp: xp || 0, userAnswer: u, isWaiting: !!isWaiting });
            return;
        }

        // Fallback (should not happen if ui.js is loaded)
        // toast handled by UI now, or redundant
    },

    nextTask: function () {
        const adapter = this.adapter || (this.adapters ? this.adapters.local : null);
        if (adapter && typeof adapter.nextTask === 'function') {
            const handled = adapter.nextTask(this);
            if (handled === true) return;
        }

        // 2. Existing Survival/Worksheet Logic
        if (this.state.mode === 'worksheet') {
            // Regeneration of the worksheet
            this.startWorksheet();
            return;
        } else if (this.state.mode === 'survival') {
            if (!this.state.lastOk) {
                // GAME OVER MODAL
                const m = document.getElementById('survival-modal');
                document.getElementById('surv-msg').innerText = "Przetrwałeś " + this.state.survivalStreak + " rund.";
                m.style.display = 'block';
            } else {
                // Zwiększ trudność
                this.state.survivalStreak++;
                if (this.state.survivalStreak % 3 === 0 && this.state.survivalLevel > 1) {
                    this.state.survivalLevel--;
                    // TOAST notification for Level UP
                    const toast = document.createElement('div');
                    toast.className = 'glass-card';
                    toast.style.position = 'fixed'; toast.style.top = '20px'; toast.style.right = '20px';
                    toast.style.padding = '1rem'; toast.style.background = 'rgba(16, 185, 129, 0.9)';
                    toast.innerHTML = `🚀 <b>Poziom w górę!</b> Teraz: ${this.state.survivalLevel} Kyu`;
                    document.body.appendChild(toast);
                    setTimeout(() => toast.remove(), 3000);
                }
                this.startGame();
            }
        } else {
            // 3. Standard Single Player
            // 3. Standard Single Player
            this.state.nums = [];
            this.startGame();
        }
    },

    // --- WORKSHEET ---
    // Dynamiczna konfiguracja arkusza: poziom + wybrana operacja (nadpisuje cfg.m
    // w KOPII configu, nie psując zapisanego poziomu). Pusta operacja = wg poziomu.
    _wsConfig: function () {
        const kId = document.getElementById('ws-kyu').value;
        const base = this.kyu[kId];
        const opEl = document.getElementById('ws-op');
        const op = opEl ? opEl.value : '';
        const cfg = op ? Object.assign({}, base, { m: op }) : base;
        return { kId: kId, cfg: cfg };
    },
    startWorksheet: function () {
        const { kId, cfg } = this._wsConfig();
        const noNeg = cfg.noNeg === undefined ? true : cfg.noNeg;

        // FIX: Ukryj inne ekrany, pokaż worksheet
        document.querySelectorAll('.screen').forEach(s => { s.style.display = 'none'; s.classList.remove('active'); });
        const ws = document.getElementById('worksheet');
        ws.style.display = 'block';
        ws.classList.add('active');

        document.getElementById('ws-start-overlay').style.display = 'none';
        document.getElementById('ws-content').style.display = 'block';
        const g = document.getElementById('ws-grid'); g.innerHTML = '';

        this.state.wsExp = [];
        this.state.checked = false; // Reset flagi
        for (let i = 0; i < 10; i++) {
            try {
                const nums = this.generateValidSequence(cfg);

                let s;
                let htmlContent = '';

                // --- RENDER LOGIC SWITCH ---
                if (cfg.m === 'mul') {
                    // Mnożenie: Poziomo (A x B)
                    // generateMulSequence zwraca [A, B]
                    s = nums[0] * nums[1];
                    htmlContent = `
                    <div style="font-family:monospace; font-size:1.4rem; line-height: 1.5; text-align: center; margin-bottom: 1rem; padding-bottom: 0.5rem;">
                        ${nums[0]} &times; ${nums[1]} = 
                    </div>`;
                } else if (cfg.m === 'div') {
                    // Dzielenie: Poziomo (A ÷ B)
                    // generateDivSequence zwraca [A, B] (gdzie A to Dzielna, B to Dzielnik)
                    s = nums[0] / nums[1];
                    htmlContent = `
                    <div style="font-family:monospace; font-size:1.4rem; line-height: 1.5; text-align: center; margin-bottom: 1rem; padding-bottom: 0.5rem;">
                        ${nums[0]} &divide; ${nums[1]} = 
                    </div>`;
                } else {
                    // Dodawanie/Odejmowanie: Pionowo (Słupek)
                    s = nums.reduce((a, b) => a + b, 0);
                    htmlContent = `
                    <div style="font-family:monospace; font-size:1.4rem; line-height: 1.5; text-align: right; margin-right: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.3); margin-bottom: 1rem; padding-bottom: 0.5rem;">
                        ${nums.map(n => `<div>${n}</div>`).join('')}
                    </div>`;
                }

                this.state.wsExp.push(s);

                const d = document.createElement('div');
                d.className = 'glass-card';
                d.style.display = 'flex';
                d.style.flexDirection = 'column';
                d.innerHTML = `<div style="color:#888; font-size:0.8rem; margin-bottom: 0.5rem">#${i + 1}</div>
                ${htmlContent}
                <input class="input-lg ws-inp" type="number" inputmode="numeric" placeholder="=" style="text-align: right;">`;
                g.appendChild(d);
            } catch (e) { break; }
        }

        let t = this.user.settings.wsTime * 60;
        const te = document.getElementById('ws-timer');
        if (this.state.timer) clearInterval(this.state.timer);
        this.state.timer = setInterval(() => {
            t--; let m = Math.floor(t / 60), s = t % 60;
            te.innerText = `${m}:${s < 10 ? '0' : ''}${s}`;
            if (t <= 0) this.finishWorksheet();
        }, 1000);
    },

    finishWorksheet: function () {
        if (this.state.checked) return;
        this.state.checked = true;

        clearInterval(this.state.timer);
        const inps = document.querySelectorAll('.ws-inp');
        let corr = 0;
        inps.forEach((el, i) => {
            if (parseInt(el.value) === this.state.wsExp[i]) { corr++; el.style.borderColor = 'lime'; }
            else el.style.borderColor = 'red';
        });
        audio.success();
        const xp = corr * 10; this.user.xp += xp; this.save();

        document.querySelectorAll('.screen').forEach(s => { s.style.display = 'none'; s.classList.remove('active'); });
        const rs = document.getElementById('result-screen');
        rs.style.display = 'block';
        rs.classList.add('active');

        document.getElementById('res-icon').innerText = corr >= 5 ? '🏆' : '👍';
        document.getElementById('res-msg').innerText = `Wynik: ${corr}/${this.state.wsExp.length}`;
        document.getElementById('res-xp-txt').innerText = `+${xp} XP`;

        document.getElementById('res-details').style.display = 'none';
        document.getElementById('res-worksheet-msg').style.display = 'block';

        document.getElementById('ws-content').style.display = 'none';
        document.getElementById('ws-start-overlay').style.display = 'block';
    },

    // --- PDF GENERATOR ---
    generatePDF: function () {
        if (!window.jspdf) {
            app.ui.toast('Biblioteka PDF niezaładowana.', 'error');
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        const { kId, cfg } = this._wsConfig();
        const count = parseInt(document.getElementById('pdf-count').value) || 1;

        app.ui.toast(`Generowanie ${count} stron PDF...`, 'info');

        const allAnswers = [];

        for (let p = 0; p < count; p++) {
            if (p > 0) doc.addPage();

            doc.setFontSize(18);
            doc.text(`Arkusz ${p + 1} - Trening ${kId} Kyu`, 105, 15, { align: 'center' });
            doc.setFontSize(10);
            doc.text(`Data: ....................   Imie: ........................................   Wynik: ........ / 20`, 105, 25, { align: 'center' });

            // Generate 20 tasks for A4 page (2 columns x 10 rows)
            const tasks = [];
            const pageAnswers = [];
            for (let i = 0; i < 20; i++) {
                const nums = this.generateValidSequence(cfg);
                let taskStr = "";
                let ansVal = 0;

                if (cfg.m === 'mul') {
                    taskStr = `${nums[0]} x ${nums[1]} =`;
                    ansVal = nums[0] * nums[1];
                } else if (cfg.m === 'div') {
                    taskStr = `${nums[0]} ÷ ${nums[1]} =`;
                    ansVal = nums[0] / nums[1];
                } else {
                    taskStr = nums.join('\n') + '\n=';
                    ansVal = nums.reduce((a, b) => a + b, 0);
                }
                tasks.push(taskStr);
                pageAnswers.push(ansVal);
            }
            allAnswers.push(pageAnswers);

            // Prepare table body (2 columns). Numeracja czytana lewo→prawo:
            // wiersz r -> [2r+1, 2r+2], czyli 1,2 / 3,4 / ... / 19,20.
            const body = [];
            for (let r = 0; r < 10; r++) {
                const n1 = 2 * r + 1;
                const n2 = 2 * r + 2;
                body.push([`${n1}.`, tasks[n1 - 1], `${n2}.`, tasks[n2 - 1]]);
            }

            doc.autoTable({
                startY: 35,
                head: [['Nr', 'Zadanie', 'Nr', 'Zadanie']],
                body: body,
                theme: 'plain',
                styles: {
                    fontSize: 13,
                    cellPadding: 4,
                    valign: 'top',
                    lineColor: 200,
                    lineWidth: 0.1,
                    textColor: 0
                },
                headStyles: {
                    fillColor: 240,
                    textColor: 0,
                    fontStyle: 'bold',
                    lineWidth: 0.1,
                    lineColor: 200
                },
                columnStyles: {
                    0: { cellWidth: 15, fontStyle: 'bold' },
                    1: { cellWidth: 70, halign: (cfg.m === 'mul' || cfg.m === 'div') ? 'center' : 'right' },
                    2: { cellWidth: 15, fontStyle: 'bold' },
                    3: { cellWidth: 70, halign: (cfg.m === 'mul' || cfg.m === 'div') ? 'center' : 'right' }
                },
                rowPageBreak: 'avoid',
                margin: { bottom: 20 }
            });
        }

        // --- ADD ANSWERS PAGE ---
        doc.addPage();
        doc.setFontSize(18);
        doc.text("Klucz Odpowiedzi (Answer Key)", 105, 15, { align: 'center' });
        doc.setFontSize(10);
        doc.text(`Poziom: ${kId} Kyu`, 105, 22, { align: 'center' });

        let currentY = 30;
        for (let p = 0; p < count; p++) {
            if (currentY + 70 > 280) {
                doc.addPage();
                currentY = 20;
            }

            doc.setFontSize(12);
            doc.setFont(undefined, 'bold');
            doc.text(`Arkusz ${p + 1}`, 15, currentY);
            doc.setFont(undefined, 'normal');

            const pageAnswers = allAnswers[p];
            const answerBody = [];
            for (let r = 0; r < 10; r++) {
                const n1 = 2 * r + 1;
                const n2 = 2 * r + 2;
                answerBody.push([
                    `${n1}.`,
                    pageAnswers[n1 - 1].toString(),
                    `${n2}.`,
                    pageAnswers[n2 - 1].toString()
                ]);
            }

            doc.autoTable({
                startY: currentY + 3,
                head: [['Nr', 'Wynik', 'Nr', 'Wynik']],
                body: answerBody,
                theme: 'plain',
                styles: {
                    fontSize: 11,
                    cellPadding: 3,
                    valign: 'middle',
                    lineColor: 200,
                    lineWidth: 0.1,
                    textColor: 0
                },
                headStyles: {
                    fillColor: 240,
                    textColor: 0,
                    fontStyle: 'bold',
                    lineWidth: 0.1,
                    lineColor: 200
                },
                columnStyles: {
                    0: { cellWidth: 15, fontStyle: 'bold', halign: 'center' },
                    1: { cellWidth: 70, halign: 'center' },
                    2: { cellWidth: 15, fontStyle: 'bold', halign: 'center' },
                    3: { cellWidth: 70, halign: 'center' }
                },
                margin: { left: 15, right: 15 }
            });

            currentY = doc.lastAutoTable.finalY + 10;
        }

        // --- PAGE NUMBERING AND FOOTERS ---
        const pageCount = doc.getNumberOfPages();
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(100);
            // Wersja całej aplikacji u góry, pod spodem data i godzina zmian + numer strony.
            doc.text(`Anzan Web ${APP_VERSION}  ·  Strona ${i} z ${pageCount}`, 105, 286, { align: 'center' });
            doc.text(`Ostatnie zmiany: ${APP_UPDATED}  ·  Wygenerowano: ${dateStr}`, 105, 291, { align: 'center' });
            doc.setTextColor(0);
        }

        doc.save(`anzan_arkusz_${kId}kyu_${new Date().toISOString().slice(0, 10)}.pdf`);
        app.ui.toast('Pobrano plik PDF!', 'success');
    },

    // --- UTILS ---
    renderKyuSelects: function () {
        const h = Object.keys(this.kyu).sort((a, b) => b - a).map(k => `<option value="${k}">${k} Kyū</option>`).join('');
        document.getElementById('game-kyu').innerHTML = h;
        document.getElementById('ws-kyu').innerHTML = h;
        document.getElementById('edit-kyu-select').innerHTML = h;

        // Prędkość flash — osobna oś, niezależna od poziomu (jak w soroban-schule)
        const sp = document.getElementById('game-speed');
        if (sp) sp.innerHTML = FLASH_SPEEDS.map(v => `<option value="${v.toFixed(1)}">${v.toFixed(1)} s</option>`).join('');
    },
    // Najbliższa dostępna prędkość z FLASH_SPEEDS do zadanej wartości
    _closestSpeed: function (t) {
        return FLASH_SPEEDS.reduce((best, v) => Math.abs(v - t) < Math.abs(best - t) ? v : best, FLASH_SPEEDS[0]);
    },
    updateGameInfo: function () {
        const c = this.kyu[document.getElementById('game-kyu').value];
        const dStr = (typeof c.d === 'object') ? `${c.d.min}-${c.d.max}` : c.d;
        const oStr = (typeof c.o === 'object') ? `${c.o.min}-${c.o.max}` : c.o;

        // Domyślna prędkość poziomu (najbliższa z listy) — gracz może zmienić suwakiem
        const sp = document.getElementById('game-speed');
        if (sp) sp.value = this._closestSpeed(c.t).toFixed(1);

        document.getElementById('info-d').innerText = dStr;
        document.getElementById('info-o').innerText = oStr;
        // Jednostka "s" jest w znaczniku HTML — tu tylko wartość
        document.getElementById('info-t').innerText = sp ? parseFloat(sp.value) : c.t;
    },
    // Odśwież pole "Czas" po ręcznej zmianie suwaka prędkości
    updateSpeedInfo: function () {
        const sp = document.getElementById('game-speed');
        if (sp) document.getElementById('info-t').innerText = parseFloat(sp.value);
    },
    updateUI: function () {
        document.getElementById('user-level').innerText = Math.floor(Math.sqrt(this.user.xp / 100)) + 1;
        document.getElementById('user-xp').innerText = Math.floor(this.user.xp);
        document.getElementById('dash-xp').innerText = Math.floor(this.user.xp);
        document.getElementById('dash-streak').innerText = this.user.streak;

        const lvl = Math.floor(Math.sqrt(this.user.xp / 100)) + 1;
        const base = Math.pow(lvl - 1, 2) * 100;
        const next = Math.pow(lvl, 2) * 100;
        const w = Math.min(100, Math.max(0, ((this.user.xp - base) / (next - base)) * 100));
        document.getElementById('xp-bar').style.width = w + '%';
    },

    // --- SETTINGS ---
    updateSettingsUI: function () {
        document.getElementById('sett-sound').checked = this.user.settings.sound;
        document.getElementById('sett-ws-time').value = this.user.settings.wsTime;
        audio.enabled = this.user.settings.sound;
    },
    loadKyuEditor: function () {
        const c = this.kyu[document.getElementById('edit-kyu-select').value];

        // Handle complex types for display
        const dVal = (typeof c.d === 'object') ? c.d.max : c.d;
        const oVal = (typeof c.o === 'object') ? c.o.max : c.o;

        document.getElementById('edit-digits').value = dVal;
        document.getElementById('edit-ops').value = oVal;
        document.getElementById('edit-time').value = c.t;
        document.getElementById('edit-mode').value = c.m || 'add';

        // Zakresy mnożenia/dzielenia. Fallback jak w generatorach (_generateMulSequence /
        // _generateDivSequence), gdy poziom nie ma jeszcze zdefiniowanego mul/div.
        const dFb = (typeof c.d === 'object') ? c.d.max : (c.d || 1);
        const mulAFb = { min: Math.pow(10, dFb - 1), max: Math.pow(10, dFb) - 1 };
        const mul = c.mul || {};
        const div = c.div || {};
        const setVal = (id, v) => { document.getElementById(id).value = v; };

        setVal('edit-mul-a-min', (mul.a && mul.a.min != null) ? mul.a.min : mulAFb.min);
        setVal('edit-mul-a-max', (mul.a && mul.a.max != null) ? mul.a.max : mulAFb.max);
        setVal('edit-mul-b-min', (mul.b && mul.b.min != null) ? mul.b.min : 2);
        setVal('edit-mul-b-max', (mul.b && mul.b.max != null) ? mul.b.max : 9);

        setVal('edit-div-d-min', (div.divisor && div.divisor.min != null) ? div.divisor.min : 2);
        setVal('edit-div-d-max', (div.divisor && div.divisor.max != null) ? div.divisor.max : 9);
        setVal('edit-div-q-min', (div.quotient && div.quotient.min != null) ? div.quotient.min : 2);
        setVal('edit-div-q-max', (div.quotient && div.quotient.max != null) ? div.quotient.max : 9);
    },
    saveKyuConfig: function () {
        const id = document.getElementById('edit-kyu-select').value;
        let t = parseFloat(document.getElementById('edit-time').value);

        // WALIDACJA CZASU (domyślna prędkość poziomu — do 60 s, jak walidacja serwera)
        if (t > 60) { t = 60; app.ui.toast('Maksymalny czas to 60s! Skorygowano.', 'warning'); }
        if (t < 0.1) t = 0.1;

        // PARTIAL UPDATE ONLY for new system
        const existing = this.kyu[id];
        existing.t = t;

        // Legacy support update if user insists on changing other params (only simple overrides)
        const dVal = parseInt(document.getElementById('edit-digits').value);
        if (!isNaN(dVal) && dVal > 0) {
            existing.d = dVal;
            // Remove static range so generator uses 'd' directly
            delete existing.range;
        }

        const oVal = parseInt(document.getElementById('edit-ops').value);
        if (!isNaN(oVal) && oVal > 0) existing.o = oVal;

        const modeVal = document.getElementById('edit-mode').value;
        if (modeVal) existing.m = modeVal;

        // Zakresy mnożenia/dzielenia. Czytamy parę min/max; zapisujemy tylko gdy komplet
        // jest poprawny (liczby, min >= 1, max >= min), inaczej pomijamy daną metodę i
        // zachowujemy poprzednią wartość.
        const readRange = (idMin, idMax) => {
            const mn = parseInt(document.getElementById(idMin).value);
            const mx = parseInt(document.getElementById(idMax).value);
            if (isNaN(mn) || isNaN(mx) || mn < 1 || mx < mn) return null;
            return { min: mn, max: mx };
        };

        const mulA = readRange('edit-mul-a-min', 'edit-mul-a-max');
        const mulB = readRange('edit-mul-b-min', 'edit-mul-b-max');
        if (mulA && mulB) existing.mul = { a: mulA, b: mulB };
        else if (modeVal === 'mul') app.ui.toast('Niepoprawny zakres mnożenia — pominięto.', 'warning');

        const divD = readRange('edit-div-d-min', 'edit-div-d-max');
        const divQ = readRange('edit-div-q-min', 'edit-div-q-max');
        if (divD && divQ) existing.div = { divisor: divD, quotient: divQ };
        else if (modeVal === 'div') app.ui.toast('Niepoprawny zakres dzielenia — pominięto.', 'warning');

        // We only save Time for now to avoid breaking complex techniques
        this.kyu[id] = existing;

        document.getElementById('edit-time').value = t;
        this.save();
        app.ui.toast('Zapisano ustawienia!', 'success');
        this.updateGameInfo();
    },
    saveSettings: function () {
        this.user.settings.wsTime = parseInt(document.getElementById('sett-ws-time').value);
        this.save();
    },
    toggleSound: function (v) {
        this.user.settings.sound = v; audio.enabled = v; this.save();
    },
    resetKyu: function () {
        this.kyu = JSON.parse(JSON.stringify(DEFAULT_KYU));
        this.save(); this.loadKyuEditor(); this.updateGameInfo();
        app.ui.toast('Domyślne przywrócone.', 'info');
    }
};
window.app = app;

function nav(id) {
    // Reset wszystkich ekranów (ukrycie)
    document.querySelectorAll('.screen').forEach(s => {
        s.style.display = 'none'; // Wymuszenie inline
        s.classList.remove('active');
    });
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    // Logika wyboru
    let targetId = id;
    if (id === 'flash' || id === 'spoken') {
        targetId = 'game-container';
        app.state.mode = id;
        document.getElementById('game-title').innerText = id === 'flash' ? 'Flash Anzan' : 'Głosowy';
        // Reset setupu
        document.getElementById('game-setup').style.display = 'block';
        document.getElementById('game-run').style.display = 'none';
    } else if (id === 'worksheet') {
        app.state.mode = 'worksheet'; // FIX: Set mode explicitly so nextTask knows what to do
        // Reset worksheet state
        document.getElementById('ws-start-overlay').style.display = 'block';
        document.getElementById('ws-content').style.display = 'none';
        if (app.state.timer) clearInterval(app.state.timer);
    }

    // Pokazanie ekranu
    const el = document.getElementById(targetId);
    if (el) {
        el.style.display = 'block'; // Wymuszenie inline
        el.classList.add('active');
    } else {
        alert('Błąd: Nie znaleziono ekranu o ID: ' + targetId);
    }
}

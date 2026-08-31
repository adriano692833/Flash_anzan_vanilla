// server/server.js
// Anzan Multiplayer Server (Socket.IO + Express + Firestore)
// ==========================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const {
    registerUser,
    getUser,
    updateUserScore,
    createClass,
    getClass,
    findClassByJoinCode,
    listClassesByTeacher,
    addClassMember,
    addPointsToClassMember,
    getClassLeaderboard,
    removeClassMember,
    setClassActive,
    createRoom,
    updateRoom,
    deleteRoom,
    getGlobalLeaderboard,
    healthCheck
} = require('./firestore');

// Wspólny generator zadań (to samo źródło co frontend) — gwarantuje, że gra
// sieciowa produkuje zadania merytorycznie poprawne, identyczne jak w trybie solo.
const SorobanGen = require('./soroban-generator');

// Firebase Admin — weryfikacja tokenów logowania. Na App Engine działa na
// domyślnym koncie serwisowym (bez sekretów w repo).
const admin = require('firebase-admin');
try { admin.initializeApp(); } catch (e) { /* już zainicjalizowane */ }

// Kod dostępu dla roli nauczyciela (żeby uczeń nie awansował się sam).
const TEACHER_ACCESS_CODE = process.env.TEACHER_ACCESS_CODE || 'ANZAN-TEACHER';

async function verifyIdToken(idToken) {
    if (!idToken || typeof idToken !== 'string') return null;
    try {
        return await admin.auth().verifyIdToken(idToken);
    } catch (e) {
        console.warn('[auth] verifyIdToken failed:', e.message);
        return null;
    }
}

const app = express();

// --- Configuration ---
const PORT = process.env.PORT || 8080;
const MAX_ROOM_CAPACITY = Number.parseInt(process.env.ROOM_CAPACITY || '50', 10);
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : ['https://anzan-web.ew.r.appspot.com', 'https://anzan-game.vercel.app'];

app.use(cors());
app.use(express.static('public'));

// Placeholder so rooms is accessible to health endpoint below
const rooms = Object.create(null);

// Health-check endpoint with Firestore connectivity
app.get('/', (req, res) => res.send('Anzan Server is running!'));
app.get('/health', async (req, res) => {
    try {
        const fsOk = await healthCheck();
        res.json({
            status: fsOk ? 'ok' : 'degraded',
            rooms: Object.keys(rooms).length,
            uptime: Math.floor(process.uptime())
        });
    } catch (e) {
        res.status(503).json({ status: 'error', message: 'Firestore unavailable' });
    }
});

const server = http.createServer(app);

// Socket.IO — WebSocket preferred, polling as fallback
const io = new Server(server, {
    cors: {
        origin: (origin, callback) => {
            if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
            console.warn('[CORS] Rejected origin:', origin);
            callback(new Error('CORS not allowed'));
        },
        methods: ['GET', 'POST'],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

// --- Rate limiting (in-memory, per socket+event) ---
const rateLimits = new Map();

function checkRateLimit(socketId, event, maxPerWindow, windowMs) {
    const key = `${socketId}:${event}`;
    const now = Date.now();
    let entry = rateLimits.get(key);
    if (!entry || now > entry.resetAt) {
        rateLimits.set(key, { count: 1, resetAt: now + windowMs });
        return true;
    }
    entry.count++;
    return entry.count <= maxPerWindow;
}

// Cleanup stale rate-limit entries every 30s
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of rateLimits.entries()) {
        if (now > val.resetAt + 10000) rateLimits.delete(key);
    }
}, 30000);

// --- Config validation ---
const ALLOWED_MODES = new Set(['add', 'sub', 'mixed', 'manual', 'auto']);
const ALLOWED_TECHNIQUES = new Set([
    'basic_counting', 'number_5', 'rule_of_5_basic', 'rule_of_5',
    'rule_of_5_advanced', 'rule_of_10_basic', 'rule_of_10'
]);
const ALLOWED_CATEGORIES = new Set([
    'basic_introduction', 'basic', 'number_5_intro', 'rule_5_basic',
    'rule_5_consolidation', 'single_digit_full', 'rule_5_master',
    'rule_10_intro_1', 'rule_10_intro_2', 'single_digit_mixed',
    'two_digit_1', 'two_digit_2', 'two_digit_3', 'two_digit_master',
    'mixed_2_3_digits', 'three_digit_1', 'three_digit_2', 'four_digit',
    'five_digit', 'six_digit', 'six_seven_digit', 'eight_digit',
    'eight_digit_long', 'master', ''
]);
const ALLOWED_TIERS = new Set(['direct', 'friend5', 'friend10', 'full']);

function clampInt(val, min, max, fallback) {
    const n = Math.floor(Number(val));
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function validateConfig(config) {
    if (!config || typeof config !== 'object') return {};
    const safe = {};

    // d: digits — number 1–9 or {min,max}
    if (typeof config.d === 'number') {
        safe.d = clampInt(config.d, 1, 9, 1);
    } else if (config.d && typeof config.d === 'object') {
        const dMin = clampInt(config.d.min, 1, 9, 1);
        const dMax = clampInt(config.d.max, 1, 9, 1);
        safe.d = { min: dMin, max: Math.max(dMin, dMax) };
    }

    // o: operations — number 2–50 or {min,max}
    if (typeof config.o === 'number') {
        safe.o = clampInt(config.o, 2, 50, 5);
    } else if (config.o && typeof config.o === 'object') {
        const oMin = clampInt(config.o.min, 2, 50, 5);
        const oMax = clampInt(config.o.max, 2, 50, 10);
        safe.o = { min: oMin, max: Math.max(oMin, oMax) };
    } else {
        safe.o = { min: 5, max: 10 };
    }

    // t: display time — 0.1–60 seconds
    if (typeof config.t === 'number' && Number.isFinite(config.t)) {
        safe.t = Math.max(0.1, Math.min(60, config.t));
    }

    // m: mode — whitelist
    safe.m = ALLOWED_MODES.has(config.m) ? config.m : 'add';

    // max: max score — 0 to 9 999 999
    safe.max = typeof config.max === 'number' ? clampInt(config.max, 0, 9999999, 0) : 0;

    // ops
    if (config.ops && typeof config.ops === 'object') {
        safe.ops = { add: !!config.ops.add, sub: !!config.ops.sub };
    }

    // range
    if (config.range && typeof config.range === 'object') {
        const rMin = clampInt(config.range.min, 1, 99999999, 1);
        const rMax = clampInt(config.range.max, 1, 99999999, 9);
        safe.range = { min: rMin, max: Math.max(rMin, rMax) };
    }

    // techniques — whitelist array
    if (Array.isArray(config.techniques)) {
        safe.techniques = config.techniques.filter(t => ALLOWED_TECHNIQUES.has(t)).slice(0, 10);
    }

    // category — whitelist
    if (ALLOWED_CATEGORIES.has(config.category)) {
        safe.category = config.category;
    }

    // tier — poziom techniki sorobanu (steruje generatorem)
    if (ALLOWED_TIERS.has(config.tier)) {
        safe.tier = config.tier;
    }

    return safe;
}

// --- Helper functions ---

function generateRoomCodeRaw() {
    // 6 chars from 31-char alphabet = 887M combinations (vs 923k for 4-char)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return code;
}

function generateRoomCodeUnique() {
    for (let i = 0; i < 25; i++) {
        const c = generateRoomCodeRaw();
        if (!rooms[c]) return c;
    }
    return generateRoomCodeRaw() + Math.floor(Math.random() * 100);
}

function sanitizeRoomCode(code) {
    return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function sanitizeName(name) {
    return (String(name || '').trim()
        .replace(/[\x00-\x1f\x7f]/g, '')
        .replace(/[<>]/g, '')
        .slice(0, 24)) || 'Anonim';
}

function sanitizeAvatar(avatar) {
    if (!avatar) return 'default';
    return String(avatar).trim().replace(/[<>"'`]/g, '').slice(0, 32) || 'default';
}

function makePlayer({ id, uid, name, avatar, role }) {
    return {
        id,          // socket.id — adresowanie połączenia w pokoju
        uid,         // trwały uid z Firebase — tożsamość do scoringu/rankingu
        name: sanitizeName(name),
        avatar: sanitizeAvatar(avatar),
        role: role || 'player',
        xp: 0,
        totalTime: 0,
        status: role === 'host' ? 'host' : 'ready',
        joinedAt: Date.now()
    };
}

// Unikalny kod dołączenia do klasy (wśród aktywnych klas).
async function generateClassJoinCode() {
    for (let i = 0; i < 10; i++) {
        const c = generateRoomCodeRaw();
        const existing = await findClassByJoinCode(c);
        if (!existing) return c;
    }
    return generateRoomCodeRaw() + Math.floor(Math.random() * 100);
}

function sortPlayersForLobby(room) {
    return Object.values(room.players).sort((a, b) => {
        const aHost = a.role === 'host' ? 1 : 0;
        const bHost = b.role === 'host' ? 1 : 0;
        if (aHost !== bHost) return bHost - aHost;
        if ((b.xp || 0) !== (a.xp || 0)) return (b.xp || 0) - (a.xp || 0);
        return (a.totalTime || 0) - (b.totalTime || 0);
    });
}

function emitLobbyUpdate(code) {
    const room = rooms[code];
    if (!room) return;
    io.to(code).emit('lobby_update', {
        code,
        state: room.state,
        locked: !!room.locked,
        players: sortPlayersForLobby(room)
    });
}

function closeRoom(code, reason) {
    const room = rooms[code];
    if (!room) return;
    io.to(code).emit('room_closed', { reason: reason || 'CLOSED' });
    delete rooms[code];
    // Sprzątnij dokument pokoju w Firestore (dotąd rosły w nieskończoność).
    deleteRoom(code).catch(e => console.warn('[closeRoom] deleteRoom error:', e.message));
    console.log(`[CLOSE] Room ${code} closed (${reason || 'CLOSED'})`);
}

function removePlayerFromRoom(code, socketId, reason) {
    const room = rooms[code];
    if (!room) return;
    if (room.pending) {
        for (const pid of Object.keys(room.pending)) {
            if (room.pending[pid]?.socketId === socketId) delete room.pending[pid];
        }
    }
    if (room.host === socketId) {
        closeRoom(code, reason || 'HOST_LEFT');
        return;
    }
    if (room.players?.[socketId]) {
        delete room.players[socketId];
        emitLobbyUpdate(code);
        console.log(`[LEAVE] ${socketId} left ${code} (${reason || 'LEFT'})`);
    }
}

// Cleanup stale pending requests older than 5 minutes
setInterval(() => {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const code of Object.keys(rooms)) {
        const room = rooms[code];
        if (!room?.pending) continue;
        for (const pid of Object.keys(room.pending)) {
            if ((room.pending[pid]?.requestedAt || 0) < cutoff) {
                delete room.pending[pid];
            }
        }
    }
}, 60 * 1000);

// --- Task generator ---
// Zadanie generuje wspólny moduł SorobanGen (świadomy technik sorobanu).
// history — tablica per pokój (izolacja deduplikacji przy równoległych zajęciach).
function generateTask(config, history) {
    const mode0 = (config && config.m) || 'add';
    const nums = SorobanGen.generateSequence(config, { history });

    if (mode0 === 'mul') return { numbers: nums, operation: 'mul', answer: nums[0] * nums[1] };
    if (mode0 === 'div') return { numbers: nums, operation: 'div', answer: nums[0] / nums[1] };

    // dodawanie/odejmowanie: liczby są już ze znakiem
    const operation = nums.some(n => n < 0) ? 'mixed' : mode0;
    const answer = nums.reduce((a, b) => a + b, 0);
    return { numbers: nums, operation, answer };
}

// Prędkość wyświetlania (sekundy) dla klienta — z konfiguracji poziomu.
function taskDisplayTime(config) {
    const t = config && Number(config.t);
    return (Number.isFinite(t) && t >= 0.1 && t <= 60) ? t : 2.0;
}

// Punkty za poprawną odpowiedź skalowane trudnością poziomu (więcej cyfr /
// wyższa technika / większa prędkość = więcej punktów). Zakres ~5–30.
function pointsForConfig(config) {
    const c = config || {};
    const digits = (typeof c.d === 'number') ? c.d
        : (c.d && typeof c.d === 'object' ? (c.d.max || 1) : 1);
    const tierRank = { direct: 0, friend5: 1, friend10: 2, full: 3 }[c.tier] || 0;
    let pts = 5 + (Math.max(1, digits) - 1) * 3 + tierRank;
    if (Number.isFinite(Number(c.t)) && Number(c.t) <= 1.0) pts += 3; // bonus za tempo
    return Math.max(5, Math.min(40, pts));
}

// --- Socket.IO logic ---

io.on('connection', (socket) => {
    console.log(`[CONN] ${socket.id} connected`);

    // 1. Registration — wymaga zweryfikowanego tokenu Firebase.
    socket.on('register', async ({ idToken, name, avatar, requestedRole, teacherCode }) => {
        if (!checkRateLimit(socket.id, 'register', 5, 10000)) return;

        const decoded = await verifyIdToken(idToken);
        if (!decoded) {
            socket.emit('auth_error', { message: 'Sesja wygasła — zaloguj się ponownie.' });
            return;
        }

        const uid = decoded.uid;
        // Fallback nazwy: displayName z klienta -> claim z tokenu -> czesc lokalna
        // syntetycznego e-maila (nazwa uzytkownika). "Uczen" to ostatnia deska ratunku.
        const safeName = sanitizeName(
            name || decoded.name || String(decoded.email || '').split('@')[0] || 'Uczeń'
        );
        const safeAvatar = sanitizeAvatar(avatar);

        // Rola nauczyciela tylko z poprawnym kodem dostępu.
        let role = 'student';
        if (requestedRole === 'teacher') {
            if (teacherCode === TEACHER_ACCESS_CODE) role = 'teacher';
            else { socket.emit('auth_error', { message: 'Błędny kod nauczyciela.' }); return; }
        }

        let effectiveRole = role;
        try {
            await registerUser(uid, { name: safeName, avatar: safeAvatar, role });
            // Rola autorytatywna pochodzi z Firestore (np. nauczyciel pozostaje nauczycielem).
            const stored = await getUser(uid);
            if (stored && stored.role) effectiveRole = stored.role;
        } catch (e) {
            // Bez profilu z Firestore nie znamy autorytatywnej roli — cicha degradacja
            // do 'student' pokazywala nauczycielowi panel ucznia. Lepiej powiedziec wprost.
            console.error('[register] Firestore error:', e.message);
            socket.emit('auth_error', { message: 'Serwer nie odczytał Twojego profilu — odśwież stronę.' });
            return;
        }

        socket.uid = uid;
        socket.data.name = safeName;
        socket.data.avatar = safeAvatar;
        socket.data.role = effectiveRole;
        socket.emit('registered', { uid, name: safeName, avatar: safeAvatar, role: effectiveRole });
    });

    // Gwarancja uwierzytelnienia dla akcji wymagających konta.
    function requireAuth() {
        if (!socket.uid) { socket.emit('auth_error', { message: 'Zaloguj się.' }); return false; }
        return true;
    }

    // 1b. Klasy (grupy / rok szkolny)
    socket.on('create_class', async ({ name, schoolYear }) => {
        if (!checkRateLimit(socket.id, 'create_class', 5, 10000)) return;
        if (!requireAuth()) return;
        if (socket.data.role !== 'teacher') return socket.emit('error_msg', 'Tylko nauczyciel może tworzyć klasy.');
        try {
            const classId = 'C' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1000);
            const joinCode = await generateClassJoinCode();
            await createClass(classId, {
                name: sanitizeName(name),
                teacherUid: socket.uid,
                teacherName: socket.data.name,
                schoolYear: String(schoolYear || '').slice(0, 16),
                joinCode
            });
            socket.emit('class_created', { classId, joinCode, name: sanitizeName(name), schoolYear });
        } catch (e) {
            console.error('[create_class] error:', e.message);
            socket.emit('error_msg', 'Nie udało się utworzyć klasy.');
        }
    });

    socket.on('list_classes', async () => {
        if (!checkRateLimit(socket.id, 'list_classes', 10, 10000)) return;
        if (!requireAuth()) return;
        try {
            const classes = socket.data.role === 'teacher'
                ? await listClassesByTeacher(socket.uid)
                : [];
            socket.emit('classes_list', { classes });
        } catch (e) {
            socket.emit('classes_list', { classes: [] });
        }
    });

    socket.on('join_class', async ({ joinCode }) => {
        if (!checkRateLimit(socket.id, 'join_class', 5, 10000)) return;
        if (!requireAuth()) return;
        try {
            const cls = await findClassByJoinCode(sanitizeRoomCode(joinCode));
            if (!cls) return socket.emit('error_msg', 'Nie znaleziono klasy o tym kodzie.');
            await addClassMember(cls.id, socket.uid, socket.data.name);
            socket.emit('class_joined', { classId: cls.id, name: cls.name, schoolYear: cls.schoolYear });
        } catch (e) {
            console.error('[join_class] error:', e.message);
            socket.emit('error_msg', 'Nie udało się dołączyć do klasy.');
        }
    });

    socket.on('request_class_leaderboard', async ({ classId }) => {
        if (!checkRateLimit(socket.id, 'request_class_leaderboard', 5, 10000)) return;
        try {
            const board = await getClassLeaderboard(String(classId || ''), 50);
            socket.emit('class_leaderboard', { classId, board });
        } catch (e) {
            socket.emit('class_leaderboard', { classId, board: [] });
        }
    });

    // Weryfikacja: zalogowany nauczyciel będący właścicielem klasy.
    async function ownsClass(classId) {
        if (!socket.uid || socket.data.role !== 'teacher') return null;
        try {
            const cls = await getClass(String(classId || ''));
            return (cls && cls.teacherUid === socket.uid) ? cls : null;
        } catch (e) { return null; }
    }

    // Roster klasy (dla nauczyciela) — lista uczniów z punktami.
    socket.on('list_class_members', async ({ classId }) => {
        if (!checkRateLimit(socket.id, 'list_class_members', 10, 10000)) return;
        if (!requireAuth()) return;
        if (!await ownsClass(classId)) return socket.emit('error_msg', 'Brak dostępu do tej klasy.');
        try {
            const members = await getClassLeaderboard(String(classId), 100);
            socket.emit('class_members', { classId, members });
        } catch (e) {
            socket.emit('class_members', { classId, members: [] });
        }
    });

    socket.on('remove_class_member', async ({ classId, uid }) => {
        if (!checkRateLimit(socket.id, 'remove_class_member', 20, 10000)) return;
        if (!requireAuth()) return;
        if (!await ownsClass(classId)) return socket.emit('error_msg', 'Brak dostępu do tej klasy.');
        try {
            await removeClassMember(String(classId), String(uid || ''));
            const members = await getClassLeaderboard(String(classId), 100);
            socket.emit('class_members', { classId, members });
        } catch (e) {
            socket.emit('error_msg', 'Nie udało się usunąć ucznia.');
        }
    });

    // Reset hasła ucznia przez nauczyciela (dla logowania „na nazwę" bez e-maila).
    socket.on('reset_member_password', async ({ classId, uid }) => {
        if (!checkRateLimit(socket.id, 'reset_member_password', 10, 10000)) return;
        if (!requireAuth()) return;
        if (!await ownsClass(classId)) return socket.emit('error_msg', 'Brak dostępu do tej klasy.');
        try {
            // Tymczasowe hasło do przekazania uczniowi.
            const temp = 'anzan' + Math.floor(1000 + Math.random() * 9000);
            await admin.auth().updateUser(String(uid), { password: temp });
            socket.emit('member_password_reset', { uid, tempPassword: temp });
        } catch (e) {
            console.error('[reset_member_password] error:', e.message);
            socket.emit('error_msg', 'Nie udało się zresetować hasła.');
        }
    });

    socket.on('close_class', async ({ classId }) => {
        if (!checkRateLimit(socket.id, 'close_class', 10, 10000)) return;
        if (!requireAuth()) return;
        if (!await ownsClass(classId)) return socket.emit('error_msg', 'Brak dostępu do tej klasy.');
        try {
            await setClassActive(String(classId), false);
            const classes = await listClassesByTeacher(socket.uid);
            socket.emit('classes_list', { classes });
            socket.emit('info_msg', 'Klasa zamknięta (rok zakończony).');
        } catch (e) {
            socket.emit('error_msg', 'Nie udało się zamknąć klasy.');
        }
    });

    // 2. Create room (Host) — tylko nauczyciel; pokój powiązany z klasą.
    socket.on('create_room', async ({ config, mode, classId }) => {
        if (!checkRateLimit(socket.id, 'create_room', 3, 10000)) return;
        if (!requireAuth()) return;
        if (socket.data.role !== 'teacher') return socket.emit('error_msg', 'Tylko nauczyciel może tworzyć pokój.');

        // Zweryfikuj, że klasa istnieje i należy do tego nauczyciela.
        let cls = null;
        if (classId) {
            try { cls = await getClass(String(classId)); } catch (e) { /* ignore */ }
            if (!cls || cls.teacherUid !== socket.uid) {
                return socket.emit('error_msg', 'Nieprawidłowa klasa.');
            }
        }

        const code = generateRoomCodeUnique();
        const safeHostName = socket.data.name;
        const safeConfig = validateConfig(config);

        rooms[code] = {
            code,
            host: socket.id,
            hostUid: socket.uid,
            hostName: safeHostName,
            classId: cls ? cls.id : null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            locked: false,
            mode: mode || 'manual',
            config: safeConfig,
            players: Object.create(null),
            pending: Object.create(null),
            state: 'lobby',
            taskIndex: 0,
            started: false,
            currentTask: null,
            answeredByTask: Object.create(null),
            _seqHistory: [] // deduplikacja sekwencji per pokój (izolacja)
        };

        rooms[code].players[socket.id] = makePlayer({
            id: socket.id,
            uid: socket.uid,
            name: safeHostName,
            avatar: socket.data.avatar,
            role: 'host'
        });

        socket.join(code);
        socket.data.roomCode = code;
        socket.data.role = 'host';

        try {
            await createRoom(code, {
                hostId: socket.uid,
                hostName: safeHostName,
                classId: cls ? cls.id : null,
                mode: rooms[code].mode,
                config: safeConfig,
                locked: false,
                state: 'lobby'
            });
        } catch (e) { console.error('[create_room] Firestore error:', e.message); }

        socket.emit('room_created', { code, classId: cls ? cls.id : null });
        emitLobbyUpdate(code);
        console.log(`[ROOM] ${code} created by ${safeHostName} (class ${cls ? cls.id : '-'})`);
    });

    // 3a. Direct join — wymaga zalogowanego ucznia.
    socket.on('join_room', async (data) => {
        if (!checkRateLimit(socket.id, 'join_room', 5, 10000)) return;
        if (!requireAuth()) return;
        const code = sanitizeRoomCode(data?.code);
        const room = rooms[code];

        if (!room) return socket.emit('error_msg', 'Pokój nie istnieje.');
        if (room.locked) return socket.emit('join_error', { reason: 'ROOM_LOCKED', code });
        if (room.state !== 'lobby' && !room.players[socket.id]) {
            return socket.emit('join_error', { reason: 'GAME_IN_PROGRESS', code });
        }
        if (Object.keys(room.players).length >= MAX_ROOM_CAPACITY) {
            return socket.emit('join_error', { reason: 'ROOM_FULL', code });
        }

        const player = makePlayer({
            id: socket.id,
            uid: socket.uid,
            name: socket.data.name,
            avatar: socket.data.avatar,
            role: 'player'
        });

        room.players[socket.id] = player;
        socket.join(code);
        socket.data.roomCode = code;
        socket.data.role = 'player';

        // Auto-zapis do rosteru klasy powiązanej z pokojem.
        if (room.classId) {
            addClassMember(room.classId, socket.uid, player.name)
                .catch(e => console.warn('[join_room] addClassMember:', e.message));
        }

        const players = sortPlayersForLobby(room);
        io.to(code).emit('player_joined', { players });
        emitLobbyUpdate(code);
        socket.emit('joined_success', { code, players, config: room.config });
        console.log(`[JOIN] ${player.name} joined ${code}`);
    });

    // 3b. Request join — wymaga zalogowanego ucznia.
    socket.on('request_join', (data) => {
        if (!checkRateLimit(socket.id, 'request_join', 5, 10000)) return;
        if (!requireAuth()) return;
        const code = sanitizeRoomCode(data?.code);
        const room = rooms[code];

        if (!room) return socket.emit('error_msg', 'Pokój nie istnieje.');
        if (room.locked) return socket.emit('join_rejected', { reason: 'Pokój jest zablokowany.' });
        if (Object.keys(room.players).length >= MAX_ROOM_CAPACITY) {
            return socket.emit('join_rejected', { reason: 'Pokój pełny.' });
        }

        // Reconnect
        if (room.players[socket.id]) {
            socket.join(code);
            socket.data.roomCode = code;
            socket.data.role = room.players[socket.id].role;
            socket.emit('join_accepted', {
                roomCode: code,
                name: room.players[socket.id].name,
                avatar: room.players[socket.id].avatar
            });
            emitLobbyUpdate(code);
            return;
        }

        const pendingId = `${socket.id}-${Date.now()}`;
        const safeName = socket.data.name || sanitizeName(data?.name);

        room.pending[pendingId] = {
            socketId: socket.id,
            uid: socket.uid,
            name: safeName,
            avatar: socket.data.avatar || sanitizeAvatar(data?.avatar),
            requestedAt: Date.now()
        };

        io.to(room.host).emit('player_request', {
            pendingId,
            name: safeName,
            avatar: room.pending[pendingId].avatar,
            code
        });
        socket.emit('join_requested', { roomCode: code });
    });

    // Host accepts player
    socket.on('accept_player', ({ roomCode, pendingId }) => {
        if (!checkRateLimit(socket.id, 'accept_player', 20, 10000)) return;
        const code = sanitizeRoomCode(roomCode);
        const room = rooms[code];
        if (!room || socket.id !== room.host) return;

        const pending = room.pending?.[pendingId];
        if (!pending) return;

        const pendingSocket = io.sockets.sockets.get(pending.socketId);
        if (pendingSocket) {
            pendingSocket.join(code);
            pendingSocket.data.roomCode = code;
            pendingSocket.data.role = 'player';

            room.players[pending.socketId] = makePlayer({
                id: pending.socketId,
                uid: pending.uid,
                name: pending.name,
                avatar: pending.avatar,
                role: 'player'
            });

            delete room.pending[pendingId];

            // Auto-zapis do rosteru klasy po akceptacji nauczyciela.
            if (room.classId && pending.uid) {
                addClassMember(room.classId, pending.uid, pending.name)
                    .catch(e => console.warn('[accept_player] addClassMember:', e.message));
            }

            pendingSocket.emit('join_accepted', { roomCode: code, name: pending.name, avatar: pending.avatar });
            emitLobbyUpdate(code);
            console.log(`[ACCEPT] ${pending.name} added to ${code}`);
        } else {
            delete room.pending[pendingId];
        }
    });

    // Host rejects player
    socket.on('reject_player', ({ roomCode, pendingId }) => {
        if (!checkRateLimit(socket.id, 'reject_player', 20, 10000)) return;
        const code = sanitizeRoomCode(roomCode);
        const room = rooms[code];
        if (!room || socket.id !== room.host) return;

        const pending = room.pending?.[pendingId];
        if (pending) {
            io.to(pending.socketId).emit('join_rejected', { reason: 'Odrzucono przez nauczyciela.' });
            delete room.pending[pendingId];
        }
    });

    // 4. Room management

    socket.on('toggle_lock_room', ({ code, lock }) => {
        if (!checkRateLimit(socket.id, 'toggle_lock_room', 10, 10000)) return;
        const c = sanitizeRoomCode(code);
        const room = rooms[c];
        if (!room || socket.id !== room.host) return;

        room.locked = !!lock;
        if (room.locked) io.to(c).emit('room_locked');
        else io.to(c).emit('room_unlocked');
        emitLobbyUpdate(c);
    });

    socket.on('kick_player', ({ code, playerId }) => {
        if (!checkRateLimit(socket.id, 'kick_player', 10, 10000)) return;
        const c = sanitizeRoomCode(code);
        const room = rooms[c];
        if (!room || socket.id !== room.host) return;
        if (!playerId || typeof playerId !== 'string') return;
        if (playerId === room.host) return;

        if (room.players[playerId]) {
            const pName = room.players[playerId].name;
            const victimSocket = io.sockets.sockets.get(playerId);
            delete room.players[playerId];

            if (victimSocket) {
                victimSocket.leave(c);
                victimSocket.data.roomCode = null;
                victimSocket.emit('player_kicked', { playerName: pName });
            }

            emitLobbyUpdate(c);
            console.log(`[KICK] ${playerId} kicked from ${c}`);
        }
    });

    // 5. Game flow

    socket.on('host_start_game', async (data) => {
        if (!checkRateLimit(socket.id, 'host_start_game', 3, 10000)) return;
        const code = sanitizeRoomCode(data?.code);
        const room = rooms[code];
        if (!room || socket.id !== room.host) return;

        room.state = 'playing';
        room.started = true;
        room.taskIndex = 0;
        room.answeredByTask = Object.create(null); // Reset answer tracking

        for (const pid of Object.keys(room.players)) {
            if (room.players[pid].role !== 'host') {
                room.players[pid].status = 'thinking';
            }
        }

        const taskFull = generateTask(room.config, room._seqHistory);
        room.currentTask = taskFull;
        const clientTask = { numbers: taskFull.numbers, operation: taskFull.operation, t: taskDisplayTime(room.config) };

        try {
            await updateRoom(code, { started: true, state: 'playing', updatedAt: Date.now() });
        } catch (e) { console.error('[host_start_game] Firestore error:', e.message); }

        io.to(code).emit('game_started', { config: room.config, mode: room.mode });
        io.to(code).emit('task_update', { index: 0, data: clientTask });
        emitLobbyUpdate(code);
    });

    socket.on('next_task', async (data) => {
        if (!checkRateLimit(socket.id, 'next_task', 10, 1000)) return;
        const code = sanitizeRoomCode(data?.code);
        const room = rooms[code];
        if (!room || socket.id !== room.host) return;

        room.taskIndex += 1;

        for (const pid of Object.keys(room.players)) {
            if (room.players[pid].role !== 'host') {
                room.players[pid].status = 'thinking';
            }
        }

        const taskFull = generateTask(room.config, room._seqHistory);
        room.currentTask = taskFull;
        const clientTask = { numbers: taskFull.numbers, operation: taskFull.operation, t: taskDisplayTime(room.config) };

        io.to(code).emit('task_update', { index: room.taskIndex, data: clientTask });
        emitLobbyUpdate(code);
    });

    socket.on('force_end_round', (data) => {
        if (!checkRateLimit(socket.id, 'force_end_round', 5, 10000)) return;
        const code = sanitizeRoomCode(data?.code);
        const room = rooms[code];
        if (!room || socket.id !== room.host) return;

        io.to(code).emit('round_ended', { reason: 'TIMEOUT', index: room.taskIndex });
    });

    // 6. Answer validation
    socket.on('submit_answer', async (data) => {
        if (!checkRateLimit(socket.id, 'submit_answer', 5, 1000)) return;
        const code = sanitizeRoomCode(data?.code);
        const room = rooms[code];
        if (!room || room.state !== 'playing') return;

        const player = room.players?.[socket.id];
        if (!player || player.role === 'host') return;
        if (!room.currentTask) return;

        // Prevent double-submission per task (race-condition safe)
        if (!room.answeredByTask[room.taskIndex]) {
            room.answeredByTask[room.taskIndex] = new Set();
        }
        if (room.answeredByTask[room.taskIndex].has(socket.id)) return;
        room.answeredByTask[room.taskIndex].add(socket.id);

        player.status = 'done';

        const submitted = Number.parseInt(data?.answer, 10);
        const expected = Number.parseInt(room.currentTask.answer, 10);
        const correct = Number.isFinite(submitted) && submitted === expected;

        let xpEarned = 0;
        if (correct) {
            xpEarned = pointsForConfig(room.config); // punkty zależne od trudności poziomu
            player.xp += xpEarned;
            // Punkty z zajęć (multiplayer) trafiają do rankingu klasy/roku ORAZ do
            // globalnego all-time — oba keyed trwałym uid gracza.
            try {
                await updateUserScore(player.uid, xpEarned);
                if (room.classId) {
                    await addPointsToClassMember(room.classId, player.uid, xpEarned, player.name);
                }
            } catch (e) {
                console.error('[submit_answer] Firestore XP error:', e.message);
                socket.emit('score_save_failed', { message: 'Wynik może nie zostać zapisany.' });
            }
        }

        // Time — validate range (0..5 min in ms)
        if (Number.isFinite(data?.time) && data.time >= 0 && data.time < 300000) {
            player.totalTime = (player.totalTime || 0) + data.time;
        }

        socket.emit('validation_result', { correct, xp: xpEarned, corAnswer: expected });

        const players = sortPlayersForLobby(room);
        io.to(code).emit('leaderboard_update', { players });
        emitLobbyUpdate(code);
    });

    // 7. Global leaderboard
    socket.on('request_global_leaderboard', async () => {
        if (!checkRateLimit(socket.id, 'request_global_leaderboard', 2, 10000)) return;
        try {
            const board = await getGlobalLeaderboard(20);
            socket.emit('global_leaderboard', { board });
        } catch (e) {
            socket.emit('global_leaderboard', { board: [] });
        }
    });

    // 8. Disconnect
    socket.on('disconnect', () => {
        console.log(`[CONN] ${socket.id} disconnected`);

        const knownCode = sanitizeRoomCode(socket.data?.roomCode);
        if (knownCode && rooms[knownCode]) {
            removePlayerFromRoom(knownCode, socket.id, 'DISCONNECT');
            return;
        }

        for (const code of Object.keys(rooms)) {
            const room = rooms[code];
            if (room.host === socket.id) {
                closeRoom(code, 'HOST_DISCONNECT');
            } else if (room.players?.[socket.id]) {
                removePlayerFromRoom(code, socket.id, 'DISCONNECT');
            } else if (room.pending) {
                for (const pid of Object.keys(room.pending)) {
                    if (room.pending[pid]?.socketId === socket.id) delete room.pending[pid];
                }
            }
        }
    });
});

// --- Graceful shutdown ---
let isShuttingDown = false;

function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[SERVER] ${signal} received — shutting down gracefully...`);

    io.emit('server_shutdown', { message: 'Serwer restartuje się. Spróbuj ponownie za chwilę.' });

    setTimeout(() => {
        io.close(() => {
            server.close(() => {
                console.log('[SERVER] Closed.');
                process.exit(0);
            });
        });
    }, 1500);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// --- Start ---
server.listen(PORT, () => console.log(`[SERVER] Anzan listening on port ${PORT}`));

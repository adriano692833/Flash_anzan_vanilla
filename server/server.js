// server/server.js
// Anzan Multiplayer Server (Socket.IO + Express + Firestore)
// ==========================================================

const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');

const {
    registerUser,
    getUser,
    updateTrainingPresets,
    createClass,
    getClass,
    listClassesForTeacher,
    addClassMember,
    awardMultiplayerPoints,
    getClassLeaderboard,
    removeClassMember,
    setClassActive,
    saveClassSession,
    listClassSessions,
    createSchool,
    getSchool,
    getSchoolDashboard,
    getGlobalLeaderboard,
    findClassForMember,
    isClassMember,
    createInvitations,
    getInvitation,
    claimInvitation,
    listInvitations,
    revokeInvitation,
    listSchoolUsers,
    createScheduleEvent,
    listScheduleEvents,
    cancelScheduleEvent,
    createAssignment,
    listAssignments,
    setAttendance,
    listAttendance,
    createPrivacyRequest,
    createMakeupRequest,
    listSchoolRequests,
    updateSchoolRequest,
    auditLog,
    listAuditLogs,
    healthCheck
} = require('./firestore');

// Wspólny generator zadań (to samo źródło co frontend) — gwarantuje, że gra
// sieciowa produkuje zadania merytorycznie poprawne, identyczne jak w trybie solo.
const SorobanGen = require('./soroban-generator');

// Firebase Admin — weryfikacja tokenów logowania. Na App Engine działa na
// domyślnym koncie serwisowym (bez sekretów w repo).
const { initializeApp, getApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const firebaseApp = getApps().length ? getApp() : initializeApp();
const firebaseAuth = getAuth(firebaseApp);

// Awaryjny kod bootstrap właściciela. Domyślnie wyłączony; produkcyjna ścieżka
// używa jednorazowego zaproszenia tworzonego skryptem operatorskim.
const teacherCodeFromEnv = String(process.env.TEACHER_ACCESS_CODE || '');
const TEACHER_ACCESS_CODE = teacherCodeFromEnv.length >= 16 && !teacherCodeFromEnv.startsWith('WPISZ-')
    ? teacherCodeFromEnv
    : '';
const ALLOW_OWNER_BOOTSTRAP = String(process.env.ALLOW_OWNER_BOOTSTRAP || '').toLowerCase() === 'true';
if (teacherCodeFromEnv && !TEACHER_ACCESS_CODE) {
    console.warn('[config] TEACHER_ACCESS_CODE jest za krótki lub nadal ma wartość przykładową.');
}

async function verifyIdToken(idToken) {
    if (!idToken || typeof idToken !== 'string') return null;
    try {
        // checkRevoked=true odrzuca również tokeny usuniętych/zablokowanych kont.
        return await firebaseAuth.verifyIdToken(idToken, true);
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

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
    next();
});
app.use(express.static('public'));

// Placeholder so rooms is accessible to health endpoint below
const rooms = Object.create(null);

// Health-check endpoint with Firestore connectivity
app.get('/', (req, res) => res.send('Anzan Server is running!'));
app.get('/health', (req, res) => {
    res.json({ status: 'ok', rooms: Object.keys(rooms).length, uptime: Math.floor(process.uptime()) });
});
app.get('/ready', async (req, res) => {
    try {
        const fsOk = await healthCheck();
        res.status(fsOk ? 200 : 503).json({
            status: fsOk ? 'ok' : 'degraded',
            rooms: Object.keys(rooms).length,
            uptime: Math.floor(process.uptime())
        });
    } catch (e) {
        res.status(503).json({ status: 'error', message: 'Firestore unavailable' });
    }
});

const server = http.createServer(app);

// Socket.IO — long-polling jako podstawa, WebSocket tylko jako opcjonalny upgrade.
// App Engine *standard* nie przepuszcza WebSocketow (to domena srodowiska flexible /
// Cloud Run), wiec wymuszanie WS konczylo sie bledem "websocket error" i cisza.
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
    transports: ['polling', 'websocket']
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
const ALLOWED_OPERATIONS = new Set(['add', 'sub', 'mixed', 'mul', 'div']);
const ALLOWED_ROOM_MODES = new Set(['manual', 'auto']);
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

    const presetName = sanitizeLabel(config.presetName || config.name, 40);
    if (presetName) {
        safe.name = presetName;
        safe.presetName = presetName;
    }

    if (config.id != null) safe.id = clampInt(config.id, 1, 20, 20);

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
    safe.m = ALLOWED_OPERATIONS.has(config.m) ? config.m : 'add';

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

    const safeRange = (value, minFallback, maxFallback) => {
        if (!value || typeof value !== 'object') return null;
        const min = clampInt(value.min, 1, 99999999, minFallback);
        const max = clampInt(value.max, 1, 99999999, maxFallback);
        return { min, max: Math.max(min, max) };
    };
    if (config.mul && typeof config.mul === 'object') {
        const a = safeRange(config.mul.a, 1, 9);
        const b = safeRange(config.mul.b, 2, 9);
        if (a && b) safe.mul = { a, b };
    }
    if (config.div && typeof config.div === 'object') {
        const divisor = safeRange(config.div.divisor, 2, 9);
        const quotient = safeRange(config.div.quotient, 1, 9);
        if (divisor && quotient) safe.div = { divisor, quotient };
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

const ALLOWED_PRESET_GAMES = new Set(['all', 'flash', 'spoken', 'worksheet', 'multiplayer']);
function validateTrainingPresets(presets) {
    if (!Array.isArray(presets)) return [];
    return presets.slice(0, 25).map((preset, index) => {
        const name = sanitizeLabel(preset && preset.name, 40) || `Konfiguracja ${index + 1}`;
        const rawId = String((preset && preset.id) || `preset_${index}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
        return {
            id: rawId || `preset_${index}`,
            name,
            game: ALLOWED_PRESET_GAMES.has(preset && preset.game) ? preset.game : 'all',
            config: validateConfig({ ...((preset && preset.config) || {}), presetName: name })
        };
    });
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

function sanitizeInviteCode(code) {
    return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
}

function sanitizeName(name) {
    return (String(name || '').trim()
        .replace(/[\x00-\x1f\x7f]/g, '')
        .replace(/[<>]/g, '')
        .slice(0, 24)) || 'Anonim';
}

function sanitizeLabel(value, maxLength = 80) {
    return String(value || '').trim()
        .replace(/[\x00-\x1f\x7f]/g, '')
        .replace(/[<>]/g, '')
        .slice(0, maxLength);
}

function sanitizeAvatar(avatar) {
    if (!avatar) return 'default';
    return String(avatar).trim().replace(/[<>"'`]/g, '').slice(0, 32) || 'default';
}

function normalizeContactEmail(value) {
    const email = String(value || '').trim().toLowerCase().slice(0, 160);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function normalizePhone(value) {
    const phone = String(value || '').trim().replace(/[^\d+]/g, '').slice(0, 20);
    return /^\+?\d{7,15}$/.test(phone) ? phone : '';
}

function invitationHash(code) {
    return crypto.createHash('sha256').update(sanitizeInviteCode(code)).digest('hex');
}

function generateInvitationCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(12);
    let raw = '';
    for (let i = 0; i < 12; i++) raw += alphabet[bytes[i] % alphabet.length];
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

function timestampIso(value) {
    if (!value) return '';
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    return String(value);
}

function publicInvitation(invite) {
    return {
        id: invite.id,
        role: invite.role,
        classId: invite.classId || '',
        studentUid: invite.studentUid || '',
        contactEmail: invite.contactEmail || '',
        contactPhone: invite.contactPhone || '',
        createdByName: invite.createdByName || '',
        status: invite.status || 'active',
        expiresAt: timestampIso(invite.expiresAt),
        createdAt: timestampIso(invite.createdAt),
        usedAt: timestampIso(invite.usedAt)
    };
}

function dateRangesOverlap(aStart, aEnd, bStart, bEnd) {
    return String(aStart || '') <= String(bEnd || '') && String(bStart || '') <= String(aEnd || '');
}

function timeRangesOverlap(aStart, aDuration, bStart, bDuration) {
    return aStart < bStart + bDuration && bStart < aStart + aDuration;
}

function scheduleEventsConflict(a, b) {
    if (!a || !b || a.status === 'cancelled' || b.status === 'cancelled') return false;
    const sameResource = (a.classId && a.classId === b.classId)
        || (a.teacherUid && a.teacherUid === b.teacherUid)
        || (a.location && b.location && a.location.toLowerCase() === b.location.toLowerCase());
    if (!sameResource) return false;
    if (a.kind === 'once' && b.kind === 'once') {
        return a.date === b.date && timeRangesOverlap(a.startMinutes, a.durationMinutes, b.startMinutes, b.durationMinutes);
    }
    if (a.kind === 'weekly' && b.kind === 'weekly') {
        return Number(a.weekday) === Number(b.weekday)
            && dateRangesOverlap(a.validFrom, a.validUntil, b.validFrom, b.validUntil)
            && timeRangesOverlap(a.startMinutes, a.durationMinutes, b.startMinutes, b.durationMinutes);
    }
    const once = a.kind === 'once' ? a : b;
    const weekly = a.kind === 'weekly' ? a : b;
    if (!dateRangesOverlap(once.date, once.date, weekly.validFrom, weekly.validUntil)) return false;
    // YYYY-MM-DD liczony w południe UTC zachowuje dzień tygodnia niezależnie od DST.
    const weekday = new Date(`${once.date}T12:00:00Z`).getUTCDay();
    return weekday === Number(weekly.weekday)
        && timeRangesOverlap(once.startMinutes, once.durationMinutes, weekly.startMinutes, weekly.durationMinutes);
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

const pendingSessionWrites = new Set();

function persistSession(room, reason) {
    if (!room?.classId || !room.startedAt || !room.sessionStats) return;
    const students = Object.values(room.sessionStats).map(stat => ({
        uid: String(stat.uid || ''),
        name: sanitizeName(stat.name),
        attempts: Math.max(0, stat.attempts || 0),
        correct: Math.max(0, stat.correct || 0),
        xp: Math.max(0, stat.xp || 0),
        totalTime: Math.max(0, stat.totalTime || 0)
    }));
    const write = saveClassSession(room.classId, room.sessionId, {
        teacherUid: room.hostUid,
        teacherName: room.hostName,
        kyuId: room.config?.id || null,
        trainingName: room.config?.presetName || room.config?.name || '',
        roomMode: room.mode,
        startedAt: room.startedAt,
        endedAt: Date.now(),
        endReason: reason || 'CLOSED',
        taskCount: Math.max(0, room.taskIndex + 1),
        studentCount: students.length,
        students
    }).catch(error => console.warn('[session] save failed:', error.message));
    pendingSessionWrites.add(write);
    write.finally(() => pendingSessionWrites.delete(write));
}

function closeRoom(code, reason) {
    const room = rooms[code];
    if (!room) return;
    if (room.autoAdvanceTimer) clearTimeout(room.autoAdvanceTimer);
    io.to(code).emit('room_closed', { reason: reason || 'CLOSED' });
    for (const socketId of Object.keys(room.players || {})) {
        const client = io.sockets.sockets.get(socketId);
        if (client?.data?.roomCode === code) {
            client.data.roomCode = null;
            client.data.roomRole = null;
            client.leave(code);
        }
    }
    persistSession(room, reason);
    delete rooms[code];
    console.log(`[CLOSE] Room ${code} closed (${reason || 'CLOSED'})`);
}

function leaveCurrentRoom(socket, exceptCode) {
    const current = sanitizeRoomCode(socket.data?.roomCode);
    if (!current || current === exceptCode) return;
    removePlayerFromRoom(current, socket.id, 'LEFT_FOR_ANOTHER_ROOM');
    socket.leave(current);
    socket.data.roomCode = null;
    socket.data.roomRole = null;
}

function roomHasUid(room, uid) {
    return Object.values(room.players || {}).some(player => player.uid === uid);
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

function publicLeaderboard(board, scoreField) {
    return (board || []).map(row => ({
        name: sanitizeName(row.name),
        [scoreField]: Math.max(0, Number(row[scoreField]) || 0)
    }));
}

function clientTaskFor(room) {
    return {
        numbers: room.currentTask.numbers,
        operation: room.currentTask.operation,
        t: taskDisplayTime(room.config)
    };
}

function scheduleAutoAdvance(code, delayOverride) {
    const room = rooms[code];
    if (!room || room.mode !== 'auto' || room.state !== 'playing') return;
    if (room.autoAdvanceTimer) clearTimeout(room.autoAdvanceTimer);
    const presentationMs = 3000 + room.currentTask.numbers.length * (taskDisplayTime(room.config) * 1000 + 150);
    const delay = Number.isFinite(delayOverride) ? delayOverride : presentationMs + 15000;
    const expectedIndex = room.taskIndex;
    room.autoAdvanceTimer = setTimeout(() => {
        const current = rooms[code];
        if (!current || current.state !== 'playing' || current.taskIndex !== expectedIndex) return;
        io.to(code).emit('round_ended', { reason: 'AUTO', index: current.taskIndex });
        current.autoAdvanceTimer = setTimeout(() => {
            const afterGrace = rooms[code];
            if (afterGrace && afterGrace.state === 'playing' && afterGrace.taskIndex === expectedIndex) {
                advanceRoomTask(code);
            }
        }, 1000);
    }, delay);
}

function advanceRoomTask(code) {
    const room = rooms[code];
    if (!room || room.state !== 'playing') return;
    room.taskIndex += 1;
    for (const pid of Object.keys(room.players)) {
        if (room.players[pid].role !== 'host') room.players[pid].status = 'thinking';
    }
    room.currentTask = generateTask(room.config, room._seqHistory);
    io.to(code).emit('task_update', { index: room.taskIndex, data: clientTaskFor(room) });
    emitLobbyUpdate(code);
    scheduleAutoAdvance(code);
}

// --- Socket.IO logic ---

io.on('connection', (socket) => {
    console.log(`[CONN] ${socket.id} connected`);

    // 1. Registration — wymaga zweryfikowanego tokenu Firebase.
    socket.on('register', async ({ idToken, name, avatar, requestedRole, teacherCode, inviteCode, contactEmail, contactPhone }) => {
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

        // Przy logowaniu rola zawsze pochodzi z Firestore. Przy pierwszej rejestracji
        // jest wyprowadzana z jednorazowego zaproszenia, nigdy z wyboru w przeglądarce.
        // Kod uruchomieniowy pozostaje wyłącznie ścieżką bootstrap dla właściciela
        // nowej szkoły; konta nauczycieli i uczniów nie mogą go użyć do awansu.
        let role = 'student';
        let effectiveRole = role;
        let schoolId = '';
        let schoolRole = '';
        let isNewProfile = false;
        try {
            const existing = await getUser(uid);
            if (existing) {
                role = ['school_admin', 'teacher', 'student', 'guardian'].includes(existing.role)
                    ? existing.role : 'student';
                schoolId = existing.schoolId || '';
                schoolRole = existing.schoolRole || '';
                if (role === 'school_admin') schoolRole = 'owner';
            } else {
                isNewProfile = true;
                const rawCode = String(inviteCode || teacherCode || '').trim();
                const email = normalizeContactEmail(contactEmail);
                const phone = normalizePhone(contactPhone);
                let invitation = null;

                if (email && normalizeContactEmail(decoded.email) !== email) {
                    socket.emit('auth_error', { message: 'E-mail logowania nie zgadza się z e-mailem kontaktowym.', rollback: true });
                    return;
                }

                if (ALLOW_OWNER_BOOTSTRAP && TEACHER_ACCESS_CODE && rawCode === TEACHER_ACCESS_CODE) {
                    role = 'school_admin';
                    schoolRole = '';
                } else {
                    const normalizedCode = sanitizeInviteCode(rawCode);
                    if (!normalizedCode) {
                        socket.emit('auth_error', { message: 'Do założenia konta potrzebny jest kod zaproszenia.', rollback: true });
                        return;
                    }
                    invitation = await getInvitation(invitationHash(normalizedCode));
                    const expires = invitation?.expiresAt?.toMillis ? invitation.expiresAt.toMillis() : 0;
                    if (!invitation || invitation.status !== 'active' || !expires || expires <= Date.now()) {
                        socket.emit('auth_error', { message: 'Kod zaproszenia jest błędny, wykorzystany albo wygasł.', rollback: true });
                        return;
                    }
                    role = invitation.role;
                    schoolId = invitation.schoolId || '';
                    schoolRole = role === 'teacher' ? 'teacher' : '';
                    if (!['school_admin', 'teacher', 'student', 'guardian'].includes(role)
                        || (role !== 'school_admin' && !schoolId)) {
                        socket.emit('auth_error', { message: 'Zaproszenie ma nieprawidłowy zakres.', rollback: true });
                        return;
                    }
                    if (invitation.contactEmail && invitation.contactEmail !== email) {
                        socket.emit('auth_error', { message: 'Adres e-mail nie zgadza się z zaproszeniem.', rollback: true });
                        return;
                    }
                    if (invitation.contactPhone && invitation.contactPhone !== phone) {
                        socket.emit('auth_error', { message: 'Numer telefonu nie zgadza się z zaproszeniem.', rollback: true });
                        return;
                    }
                    if (['school_admin', 'teacher', 'guardian'].includes(role) && !email) {
                        socket.emit('auth_error', { message: 'Dla konta pracownika lub opiekuna wymagany jest poprawny e-mail kontaktowy.', rollback: true });
                        return;
                    }
                    if (schoolId) {
                        const school = await getSchool(schoolId);
                        const users = await listSchoolUsers(schoolId);
                        if (!school || school.status !== 'active' || (school.seatLimit && users.length >= school.seatLimit)) {
                            socket.emit('auth_error', { message: 'Szkoła jest nieaktywna albo osiągnęła limit kont.', rollback: true });
                            return;
                        }
                    }
                    await claimInvitation(invitation.id, uid);
                }

                if (['school_admin', 'teacher', 'guardian'].includes(role) && !email) {
                    socket.emit('auth_error', { message: 'Dla konta pracownika lub opiekuna wymagany jest poprawny e-mail kontaktowy.', rollback: true });
                    return;
                }
                await registerUser(uid, {
                    name: safeName,
                    avatar: safeAvatar,
                    role,
                    schoolId,
                    schoolRole,
                    contactEmail: email,
                    contactPhone: phone,
                    linkedStudentUid: invitation?.studentUid || ''
                });
                if (role === 'student' && invitation?.classId) {
                    await addClassMember(invitation.classId, uid, safeName, schoolId);
                }
                if (schoolId) await auditLog(schoolId, uid, 'account.registered', { role });
            }
            // Rola autorytatywna pochodzi z Firestore (np. nauczyciel pozostaje nauczycielem).
            const stored = await getUser(uid);
            if (stored && stored.role) {
                effectiveRole = stored.role;
                schoolId = stored.schoolId || schoolId;
                schoolRole = stored.schoolRole || schoolRole;
            }
        } catch (e) {
            // Bez profilu z Firestore nie znamy autorytatywnej roli — cicha degradacja
            // do 'student' pokazywala nauczycielowi panel ucznia. Lepiej powiedziec wprost.
            console.error('[register] Firestore error:', e.message);
            socket.emit('auth_error', { message: 'Serwer nie mógł bezpiecznie utworzyć profilu. Poproś o nowe zaproszenie.', rollback: isNewProfile });
            return;
        }

        socket.uid = uid;
        socket.data.name = safeName;
        socket.data.avatar = safeAvatar;
        socket.data.accountRole = effectiveRole;
        socket.data.schoolId = schoolId;
        socket.data.schoolRole = schoolRole;
        socket.data.emailVerified = !!decoded.email_verified;
        socket.data.roomRole = null;
        socket.emit('registered', { uid, name: safeName, avatar: safeAvatar, role: effectiveRole, schoolId, schoolRole });
    });

    // Gwarancja uwierzytelnienia dla akcji wymagających konta.
    function requireAuth() {
        if (!socket.uid) { socket.emit('auth_error', { message: 'Zaloguj się.' }); return false; }
        return true;
    }

    function requireVerifiedStaff() {
        if (['school_admin', 'teacher'].includes(socket.data.accountRole) && !socket.data.emailVerified) {
            socket.emit('error_msg', 'Potwierdź e-mail z wiadomości Firebase, a następnie wyloguj się i zaloguj ponownie.');
            return false;
        }
        return true;
    }

    async function requireActiveSchool() {
        if (!socket.data.schoolId) {
            socket.emit('error_msg', 'Konto nie jest przypisane do aktywnej szkoły. Poproś administratora o kod zaproszenia.');
            return false;
        }
        try {
            const school = await getSchool(socket.data.schoolId);
            if (school?.status === 'active') return true;
            socket.emit('error_msg', 'Licencja szkoły jest nieaktywna. Skontaktuj się z administratorem.');
            return false;
        } catch (error) {
            socket.emit('error_msg', 'Nie udało się potwierdzić licencji szkoły. Spróbuj ponownie.');
            return false;
        }
    }

    socket.on('create_school', async ({ name }) => {
        if (!checkRateLimit(socket.id, 'create_school', 3, 60000)) return;
        if (!requireAuth()) return;
        if (!requireVerifiedStaff()) return;
        if (socket.data.accountRole !== 'school_admin') return socket.emit('error_msg', 'Tylko administrator może utworzyć szkołę.');
        if (socket.data.schoolId) return socket.emit('error_msg', 'Konto jest już przypisane do szkoły.');
        const schoolName = sanitizeLabel(name, 80);
        if (!schoolName) return socket.emit('error_msg', 'Podaj nazwę szkoły.');
        try {
            const schoolId = 'SCH' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
            await createSchool(schoolId, {
                name: schoolName,
                ownerUid: socket.uid,
                ownerName: socket.data.name
            });
            socket.data.schoolId = schoolId;
            socket.data.schoolRole = 'owner';
            socket.data.accountRole = 'school_admin';
            socket.emit('school_data', { id: schoolId, name: schoolName, plan: 'trial', status: 'active', schoolRole: 'owner' });
        } catch (error) {
            console.error('[create_school] error:', error.message);
            socket.emit('error_msg', 'Nie udało się utworzyć szkoły.');
        }
    });

    socket.on('request_school', async () => {
        if (!checkRateLimit(socket.id, 'request_school', 5, 10000)) return;
        if (!requireAuth()) return;
        if (!socket.data.schoolId) return socket.emit('school_data', null);
        try {
            const school = await getSchool(socket.data.schoolId);
            socket.emit('school_data', school ? {
                id: school.id,
                name: school.name,
                plan: school.plan || 'trial',
                status: school.status || 'active',
                seatLimit: school.seatLimit || 0,
                schoolRole: socket.data.schoolRole || 'teacher'
            } : null);
        } catch (error) {
            socket.emit('error_msg', 'Nie udało się wczytać danych szkoły.');
        }
    });

    socket.on('request_school_dashboard', async () => {
        if (!checkRateLimit(socket.id, 'request_school_dashboard', 5, 10000)) return;
        if (!requireAuth()) return;
        if (socket.data.accountRole !== 'school_admin' || socket.data.schoolRole !== 'owner' || !socket.data.schoolId) {
            return socket.emit('error_msg', 'Tylko administrator szkoły ma dostęp do panelu nadzorczego.');
        }
        try {
            const dashboard = await getSchoolDashboard(socket.data.schoolId);
            socket.emit('school_dashboard', dashboard);
        } catch (error) {
            console.error('[school_dashboard] error:', error.message);
            socket.emit('error_msg', 'Nie udało się wczytać panelu szkoły.');
        }
    });

    async function manageableClass(classId) {
        const cls = await getClass(String(classId || ''));
        if (!cls || !socket.data.schoolId || cls.schoolId !== socket.data.schoolId) return null;
        if (socket.data.accountRole === 'school_admin' && socket.data.schoolRole === 'owner') return cls;
        if (socket.data.accountRole === 'teacher' && cls.teacherUid === socket.uid) return cls;
        return null;
    }

    // Jednorazowe zaproszenia. Kod jawny wraca wyłącznie w tej odpowiedzi;
    // kolejne listowanie pokazuje metadane, bo baza zna tylko skrót kodu.
    socket.on('create_invitations', async (payload = {}) => {
        if (!checkRateLimit(socket.id, 'create_invitations', 5, 60000)) return;
        if (!requireAuth() || !await requireActiveSchool()) return;
        if (!requireVerifiedStaff()) return;
        const role = String(payload.role || '');
        const isOwner = socket.data.accountRole === 'school_admin' && socket.data.schoolRole === 'owner';
        const isTeacher = socket.data.accountRole === 'teacher';
        if ((role === 'teacher' && !isOwner) || (!['teacher', 'student', 'guardian'].includes(role)) || (!isOwner && !isTeacher)) {
            return socket.emit('error_msg', 'Nie masz uprawnień do tworzenia takiego zaproszenia.');
        }
        const count = Math.max(1, Math.min(30, Number.parseInt(payload.count || '1', 10) || 1));
        const days = Math.max(1, Math.min(30, Number.parseInt(payload.expiresDays || '7', 10) || 7));
        const email = normalizeContactEmail(payload.contactEmail);
        const phone = normalizePhone(payload.contactPhone);
        if (count > 1 && (email || phone)) return socket.emit('error_msg', 'Kontakt można przypisać tylko do pojedynczego zaproszenia.');
        let cls = null;
        let student = null;
        if (role === 'student' || role === 'guardian') {
            cls = await manageableClass(payload.classId);
            if (!cls) return socket.emit('error_msg', 'Wybierz klasę, którą możesz zarządzać.');
        }
        if (role === 'guardian') {
            const studentUid = String(payload.studentUid || '');
            if (!studentUid || !await isClassMember(cls.id, studentUid)) return socket.emit('error_msg', 'Wybierz ucznia z tej klasy.');
            student = await getUser(studentUid);
            if (!student) return socket.emit('error_msg', 'Nie znaleziono ucznia.');
        }
        try {
            const expiresAt = new Date(Date.now() + days * 86400000);
            const generated = [];
            const records = [];
            for (let i = 0; i < count; i++) {
                const code = generateInvitationCode();
                generated.push(code);
                records.push({
                    codeHash: invitationHash(code), role, schoolId: socket.data.schoolId,
                    classId: cls?.id || '', studentUid: student?.uid || '',
                    contactEmail: email, contactPhone: phone,
                    createdBy: socket.uid, createdByName: socket.data.name, expiresAt
                });
            }
            await createInvitations(records);
            await auditLog(socket.data.schoolId, socket.uid, 'invitation.created', { role, count, classId: cls?.id || '' });
            socket.emit('invitations_created', {
                role, codes: generated, className: cls?.name || '',
                expiresAt: expiresAt.toISOString(),
                registrationBase: `${String(process.env.PUBLIC_APP_URL || 'https://anzan-web.ew.r.appspot.com').replace(/\/$/, '')}/?auth=register&invite=`
            });
            const all = await listInvitations(socket.data.schoolId);
            socket.emit('invitations_list', { invitations: all.map(publicInvitation) });
        } catch (error) {
            console.error('[create_invitations] error:', error.message);
            socket.emit('error_msg', 'Nie udało się utworzyć zaproszeń.');
        }
    });

    socket.on('list_invitations', async () => {
        if (!checkRateLimit(socket.id, 'list_invitations', 10, 10000)) return;
        if (!requireAuth() || !socket.data.schoolId || !['school_admin', 'teacher'].includes(socket.data.accountRole)) return;
        try {
            let invitations = await listInvitations(socket.data.schoolId);
            if (socket.data.accountRole === 'teacher') invitations = invitations.filter(item => item.createdBy === socket.uid);
            socket.emit('invitations_list', { invitations: invitations.map(publicInvitation) });
        } catch (error) { socket.emit('error_msg', 'Nie udało się wczytać zaproszeń.'); }
    });

    socket.on('revoke_invitation', async ({ inviteId }) => {
        if (!checkRateLimit(socket.id, 'revoke_invitation', 10, 10000)) return;
        if (!requireAuth() || !socket.data.schoolId || !['school_admin', 'teacher'].includes(socket.data.accountRole)) return;
        if (!requireVerifiedStaff()) return;
        try {
            const invite = await getInvitation(String(inviteId || ''));
            const allowed = invite && invite.schoolId === socket.data.schoolId
                && (socket.data.accountRole === 'school_admin' || invite.createdBy === socket.uid);
            if (!allowed) return socket.emit('error_msg', 'Brak dostępu do zaproszenia.');
            await revokeInvitation(invite.id, socket.data.schoolId);
            await auditLog(socket.data.schoolId, socket.uid, 'invitation.revoked', { role: invite.role });
            socket.emit('info_msg', 'Zaproszenie unieważnione.');
            socket.emit('invitations_list', { invitations: (await listInvitations(socket.data.schoolId)).map(publicInvitation) });
        } catch (error) { socket.emit('error_msg', 'Nie udało się unieważnić zaproszenia.'); }
    });

    socket.on('request_school_operations', async () => {
        if (!checkRateLimit(socket.id, 'request_school_operations', 10, 10000)) return;
        if (!requireAuth() || !await requireActiveSchool()) return;
        try {
            const profile = await getUser(socket.uid);
            const isOwner = socket.data.accountRole === 'school_admin' && socket.data.schoolRole === 'owner';
            const [allEvents, allAssignments, allUsers, dashboard, school, privacyRequests, makeupRequests] = await Promise.all([
                listScheduleEvents(socket.data.schoolId),
                listAssignments(socket.data.schoolId),
                listSchoolUsers(socket.data.schoolId),
                ['school_admin', 'teacher'].includes(socket.data.accountRole)
                    ? getSchoolDashboard(socket.data.schoolId) : Promise.resolve({ classes: [] }),
                getSchool(socket.data.schoolId),
                isOwner ? listSchoolRequests('privacyRequests', socket.data.schoolId) : Promise.resolve([]),
                isOwner ? listSchoolRequests('makeupRequests', socket.data.schoolId) : Promise.resolve([])
            ]);
            let classId = profile?.classId || '';
            if (socket.data.accountRole === 'guardian' && profile?.linkedStudentUid) {
                const child = await getUser(profile.linkedStudentUid);
                classId = child?.classId || '';
            }
            let events = allEvents;
            let assignments = allAssignments;
            if (socket.data.accountRole === 'teacher') {
                events = events.filter(item => item.teacherUid === socket.uid);
                assignments = assignments.filter(item => item.teacherUid === socket.uid);
            } else if (['student', 'guardian'].includes(socket.data.accountRole)) {
                events = events.filter(item => item.classId === classId);
                assignments = assignments.filter(item => item.classId === classId);
            }
            const staff = allUsers.filter(user => ['teacher', 'school_admin'].includes(user.role)).map(user => ({
                uid: user.uid, name: user.name, role: user.role
            }));
            const visibleClasses = socket.data.accountRole === 'teacher'
                ? (dashboard.classes || []).filter(item => item.teacherUid === socket.uid)
                : (dashboard.classes || []);
            socket.emit('school_operations_data', {
                role: socket.data.accountRole,
                timezone: 'Europe/Warsaw',
                classId,
                classes: visibleClasses,
                staff,
                events,
                assignments,
                seatUsage: { used: allUsers.length, limit: Number(school?.seatLimit) || 0 },
                requests: {
                    privacy: privacyRequests.map(item => ({ ...item, createdAt: timestampIso(item.createdAt), updatedAt: timestampIso(item.updatedAt) })),
                    makeup: makeupRequests.map(item => ({ ...item, createdAt: timestampIso(item.createdAt), updatedAt: timestampIso(item.updatedAt) }))
                },
                profile: {
                    name: profile?.name || socket.data.name,
                    contactEmail: profile?.contactEmail || '',
                    contactPhone: profile?.contactPhone || '',
                    linkedStudentUid: profile?.linkedStudentUid || ''
                }
            });
        } catch (error) {
            console.error('[request_school_operations] error:', error.message);
            socket.emit('error_msg', 'Nie udało się wczytać planu szkoły.');
        }
    });

    socket.on('update_school_request', async ({ requestType, requestId, status }) => {
        if (!checkRateLimit(socket.id, 'update_school_request', 20, 60000) || !requireAuth()) return;
        if (socket.data.accountRole !== 'school_admin' || socket.data.schoolRole !== 'owner') return;
        const collectionName = requestType === 'privacy' ? 'privacyRequests'
            : requestType === 'makeup' ? 'makeupRequests' : '';
        const safeStatus = ['new', 'in_progress', 'resolved', 'rejected'].includes(status) ? status : '';
        if (!collectionName || !safeStatus) return socket.emit('error_msg', 'Nieprawidłowy status wniosku.');
        try {
            await updateSchoolRequest(collectionName, String(requestId || ''), socket.data.schoolId, safeStatus, socket.uid);
            await auditLog(socket.data.schoolId, socket.uid, 'request.updated', { requestType, requestId, status: safeStatus });
            socket.emit('school_operations_changed');
        } catch (error) { socket.emit('error_msg', 'Nie udało się zaktualizować wniosku.'); }
    });

    socket.on('create_managed_class', async ({ name, schoolYear, teacherUid }) => {
        if (!checkRateLimit(socket.id, 'create_managed_class', 5, 60000)) return;
        if (!requireAuth() || !await requireActiveSchool()) return;
        if (!requireVerifiedStaff()) return;
        if (socket.data.accountRole !== 'school_admin' || socket.data.schoolRole !== 'owner') {
            return socket.emit('error_msg', 'Tylko właściciel szkoły może przypisać klasę nauczycielowi.');
        }
        const className = sanitizeLabel(name, 60);
        const teacher = await getUser(String(teacherUid || ''));
        if (!className || !teacher || teacher.role !== 'teacher' || teacher.schoolId !== socket.data.schoolId) {
            return socket.emit('error_msg', 'Podaj nazwę klasy i wybierz nauczyciela z tej szkoły.');
        }
        try {
            const classId = 'C' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1000);
            await createClass(classId, {
                name: className, teacherUid: teacher.uid, teacherName: teacher.name,
                schoolYear: String(schoolYear || '').slice(0, 16), schoolId: socket.data.schoolId
            });
            await auditLog(socket.data.schoolId, socket.uid, 'class.created', { classId, teacherUid: teacher.uid });
            socket.emit('info_msg', 'Klasa utworzona i przypisana nauczycielowi.');
            socket.emit('school_operations_changed');
        } catch (error) { socket.emit('error_msg', 'Nie udało się utworzyć klasy.'); }
    });

    socket.on('create_schedule_event', async (payload = {}) => {
        if (!checkRateLimit(socket.id, 'create_schedule_event', 10, 60000)) return;
        if (!requireAuth() || !await requireActiveSchool()) return;
        if (!requireVerifiedStaff()) return;
        const cls = await manageableClass(payload.classId);
        if (!cls) return socket.emit('error_msg', 'Brak dostępu do wybranej klasy.');
        const isOwner = socket.data.accountRole === 'school_admin';
        const teacherUid = isOwner ? String(payload.teacherUid || cls.teacherUid || '') : socket.uid;
        const teacher = await getUser(teacherUid);
        if (!teacher || teacher.schoolId !== socket.data.schoolId || teacher.role !== 'teacher') {
            return socket.emit('error_msg', 'Wybierz nauczyciela z tej szkoły.');
        }
        const kind = payload.kind === 'weekly' ? 'weekly' : 'once';
        const startMinutes = Math.max(0, Math.min(1439, Number(payload.startMinutes) || 0));
        const durationMinutes = Math.max(15, Math.min(360, Number(payload.durationMinutes) || 60));
        const event = {
            schoolId: socket.data.schoolId, classId: cls.id, className: cls.name,
            teacherUid, teacherName: teacher.name || 'Nauczyciel',
            title: sanitizeLabel(payload.title || 'Zajęcia Anzan', 80),
            location: sanitizeLabel(payload.location, 80), kind, startMinutes, durationMinutes,
            date: kind === 'once' ? String(payload.date || '').slice(0, 10) : '',
            weekday: kind === 'weekly' ? Math.max(0, Math.min(6, Number(payload.weekday) || 0)) : null,
            validFrom: kind === 'weekly' ? String(payload.validFrom || '').slice(0, 10) : '',
            validUntil: kind === 'weekly' ? String(payload.validUntil || '').slice(0, 10) : '',
            timezone: 'Europe/Warsaw', status: 'active', createdBy: socket.uid
        };
        if (!event.title || (kind === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(event.date))
            || startMinutes + durationMinutes > 1440
            || (kind === 'weekly' && (!/^\d{4}-\d{2}-\d{2}$/.test(event.validFrom)
                || !/^\d{4}-\d{2}-\d{2}$/.test(event.validUntil) || event.validFrom > event.validUntil))) {
            return socket.emit('error_msg', 'Uzupełnij poprawnie termin zajęć.');
        }
        try {
            const conflicts = (await listScheduleEvents(socket.data.schoolId)).filter(item => scheduleEventsConflict(item, event));
            if (conflicts.length) return socket.emit('schedule_conflict', { conflicts });
            const eventId = 'EV' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
            await createScheduleEvent(eventId, event);
            await auditLog(socket.data.schoolId, socket.uid, 'schedule.created', { eventId, classId: cls.id });
            socket.emit('info_msg', 'Zajęcia dodane do planu.');
            socket.emit('school_operations_changed');
        } catch (error) { socket.emit('error_msg', 'Nie udało się zapisać zajęć.'); }
    });

    socket.on('cancel_schedule_event', async ({ eventId }) => {
        if (!checkRateLimit(socket.id, 'cancel_schedule_event', 10, 10000)) return;
        if (!requireAuth() || !socket.data.schoolId || !['school_admin', 'teacher'].includes(socket.data.accountRole)) return;
        if (!requireVerifiedStaff()) return;
        try {
            const event = (await listScheduleEvents(socket.data.schoolId)).find(item => item.id === eventId);
            if (!event || (socket.data.accountRole === 'teacher' && event.teacherUid !== socket.uid)) return socket.emit('error_msg', 'Brak dostępu do zajęć.');
            await cancelScheduleEvent(eventId, socket.data.schoolId, socket.uid);
            await auditLog(socket.data.schoolId, socket.uid, 'schedule.cancelled', { eventId });
            socket.emit('school_operations_changed');
        } catch (error) { socket.emit('error_msg', 'Nie udało się odwołać zajęć.'); }
    });

    socket.on('create_assignment', async (payload = {}) => {
        if (!checkRateLimit(socket.id, 'create_assignment', 10, 60000)) return;
        if (!requireAuth() || socket.data.accountRole !== 'teacher' || !await requireActiveSchool()) return;
        if (!requireVerifiedStaff()) return;
        const cls = await manageableClass(payload.classId);
        if (!cls) return socket.emit('error_msg', 'Brak dostępu do klasy.');
        const title = sanitizeLabel(payload.title, 100);
        if (!title) return socket.emit('error_msg', 'Podaj tytuł zadania.');
        try {
            const assignmentId = 'AS' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
            await createAssignment(assignmentId, {
                schoolId: socket.data.schoolId, classId: cls.id, className: cls.name,
                teacherUid: socket.uid, teacherName: socket.data.name, title,
                description: sanitizeLabel(payload.description, 500),
                dueDate: String(payload.dueDate || '').slice(0, 10),
                trainingKey: sanitizeLabel(payload.trainingKey, 80)
            });
            await auditLog(socket.data.schoolId, socket.uid, 'assignment.created', { assignmentId, classId: cls.id });
            socket.emit('info_msg', 'Zadanie opublikowane.');
            socket.emit('school_operations_changed');
        } catch (error) { socket.emit('error_msg', 'Nie udało się zapisać zadania.'); }
    });

    socket.on('save_attendance', async ({ eventId, occurrenceDate, entries }) => {
        if (!checkRateLimit(socket.id, 'save_attendance', 10, 60000)) return;
        if (!requireAuth() || !['school_admin', 'teacher'].includes(socket.data.accountRole)) return;
        if (!requireVerifiedStaff()) return;
        const event = (await listScheduleEvents(socket.data.schoolId)).find(item => item.id === eventId);
        if (!event || (socket.data.accountRole === 'teacher' && event.teacherUid !== socket.uid)) return socket.emit('error_msg', 'Brak dostępu do listy obecności.');
        const safeEntries = Array.isArray(entries) ? entries.slice(0, 100).map(entry => ({
            uid: String(entry.uid || ''), name: sanitizeName(entry.name),
            status: ['present', 'absent', 'late', 'excused'].includes(entry.status) ? entry.status : 'present'
        })).filter(entry => entry.uid) : [];
        try {
            await setAttendance(eventId, String(occurrenceDate || '').slice(0, 10), safeEntries, socket.uid);
            await auditLog(socket.data.schoolId, socket.uid, 'attendance.saved', { eventId, count: safeEntries.length });
            socket.emit('info_msg', 'Obecność zapisana.');
        } catch (error) { socket.emit('error_msg', 'Nie udało się zapisać obecności.'); }
    });

    socket.on('request_attendance', async ({ eventId, occurrenceDate }) => {
        if (!requireAuth() || !['school_admin', 'teacher'].includes(socket.data.accountRole)) return;
        const event = (await listScheduleEvents(socket.data.schoolId)).find(item => item.id === eventId);
        if (!event || (socket.data.accountRole === 'teacher' && event.teacherUid !== socket.uid)) return;
        const [members, attendance] = await Promise.all([
            getClassLeaderboard(event.classId, 100), listAttendance(eventId, String(occurrenceDate || '').slice(0, 10))
        ]);
        socket.emit('attendance_data', { eventId, occurrenceDate, members, attendance });
    });

    socket.on('create_privacy_request', async ({ type }) => {
        if (!checkRateLimit(socket.id, 'create_privacy_request', 3, 86400000) || !requireAuth()) return;
        const requestType = ['export', 'delete', 'correct'].includes(type) ? type : 'export';
        try {
            const requestId = 'PR' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
            await createPrivacyRequest(requestId, { uid: socket.uid, schoolId: socket.data.schoolId || '', type: requestType });
            if (socket.data.schoolId) await auditLog(socket.data.schoolId, socket.uid, 'privacy.requested', { type: requestType });
            socket.emit('info_msg', 'Wniosek został zapisany. Administrator szkoły go zweryfikuje.');
        } catch (error) { socket.emit('error_msg', 'Nie udało się zapisać wniosku.'); }
    });

    socket.on('create_makeup_request', async ({ eventId, preferredDate, note }) => {
        if (!checkRateLimit(socket.id, 'create_makeup_request', 5, 86400000) || !requireAuth()) return;
        if (!['student', 'guardian'].includes(socket.data.accountRole)) return socket.emit('error_msg', 'Ta funkcja jest przeznaczona dla ucznia lub opiekuna.');
        try {
            const requestId = 'MR' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
            await createMakeupRequest(requestId, {
                uid: socket.uid, schoolId: socket.data.schoolId, eventId: String(eventId || ''),
                preferredDate: String(preferredDate || '').slice(0, 10), note: sanitizeLabel(note, 300)
            });
            socket.emit('info_msg', 'Prośba o odrobienie zajęć została wysłana.');
        } catch (error) { socket.emit('error_msg', 'Nie udało się wysłać prośby.'); }
    });

    socket.on('request_audit_logs', async () => {
        if (!requireAuth() || socket.data.accountRole !== 'school_admin' || socket.data.schoolRole !== 'owner') return;
        try {
            const logs = await listAuditLogs(socket.data.schoolId, 100);
            socket.emit('audit_logs', { logs: logs.map(item => ({ ...item, createdAt: timestampIso(item.createdAt) })) });
        } catch (error) { socket.emit('error_msg', 'Nie udało się wczytać dziennika audytowego.'); }
    });

    // 1b. Klasy (grupy / rok szkolny)
    socket.on('create_class', async ({ name, schoolYear }) => {
        if (!checkRateLimit(socket.id, 'create_class', 5, 10000)) return;
        if (!requireAuth()) return;
        if (!requireVerifiedStaff()) return;
        if (socket.data.accountRole !== 'teacher') return socket.emit('error_msg', 'Tylko nauczyciel może tworzyć klasy.');
        if (!await requireActiveSchool()) return;
        const className = sanitizeLabel(name, 60);
        if (!className) return socket.emit('error_msg', 'Podaj nazwę klasy.');
        try {
            const classId = 'C' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1000);
            await createClass(classId, {
                name: className,
                teacherUid: socket.uid,
                teacherName: socket.data.name,
                schoolYear: String(schoolYear || '').slice(0, 16),
                schoolId: socket.data.schoolId || ''
            });
            socket.emit('class_created', { classId, name: className, schoolYear });
        } catch (e) {
            console.error('[create_class] error:', e.message);
            socket.emit('error_msg', 'Nie udało się utworzyć klasy.');
        }
    });

    socket.on('list_classes', async () => {
        if (!checkRateLimit(socket.id, 'list_classes', 10, 10000)) return;
        if (!requireAuth()) return;
        try {
            const classes = socket.data.accountRole === 'teacher'
                ? await listClassesForTeacher(socket.uid, socket.data.schoolId)
                : [];
            socket.emit('classes_list', { classes });
        } catch (e) {
            socket.emit('classes_list', { classes: [] });
        }
    });

    socket.on('request_class_leaderboard', async ({ classId }) => {
        if (!checkRateLimit(socket.id, 'request_class_leaderboard', 5, 10000)) return;
        if (!requireAuth()) return;
        try {
            const id = String(classId || '');
            const cls = await getClass(id);
            const sameSchoolStaff = cls && ['teacher', 'school_admin'].includes(socket.data.accountRole)
                && cls.schoolId && cls.schoolId === socket.data.schoolId;
            const allowed = cls && (cls.teacherUid === socket.uid || sameSchoolStaff || await isClassMember(id, socket.uid));
            if (!allowed) return socket.emit('error_msg', 'Brak dostępu do rankingu tej klasy.');
            const board = publicLeaderboard(await getClassLeaderboard(id, 50), 'points');
            socket.emit('class_leaderboard', { classId: id, board });
        } catch (e) {
            socket.emit('class_leaderboard', { classId, board: [] });
        }
    });

    // Weryfikacja: zalogowany nauczyciel będący właścicielem klasy.
    async function ownsClass(classId) {
        if (!socket.uid || socket.data.accountRole !== 'teacher') return null;
        try {
            const cls = await getClass(String(classId || ''));
            const ownLegacyClass = cls && cls.teacherUid === socket.uid;
            const sameSchool = cls && cls.schoolId && cls.schoolId === socket.data.schoolId;
            return (ownLegacyClass || sameSchool) ? cls : null;
        } catch (e) { return null; }
    }

    // Administrator ma szkolny podgląd, ale operacje zmieniające klasę nadal
    // przechodzą wyłącznie przez ownsClass(), czyli konto nauczyciela.
    async function canViewClass(classId) {
        if (!socket.uid) return null;
        try {
            const cls = await getClass(String(classId || ''));
            if (!cls) return null;
            const schoolStaff = ['teacher', 'school_admin'].includes(socket.data.accountRole)
                && cls.schoolId && cls.schoolId === socket.data.schoolId;
            return (cls.teacherUid === socket.uid || schoolStaff) ? cls : null;
        } catch (error) { return null; }
    }

    // Roster klasy (dla nauczyciela) — lista uczniów z punktami.
    socket.on('list_class_members', async ({ classId }) => {
        if (!checkRateLimit(socket.id, 'list_class_members', 10, 10000)) return;
        if (!requireAuth()) return;
        if (!await canViewClass(classId)) return socket.emit('error_msg', 'Brak dostępu do tej klasy.');
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
        if (!requireVerifiedStaff()) return;
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
        if (!requireVerifiedStaff()) return;
        if (!await ownsClass(classId)) return socket.emit('error_msg', 'Brak dostępu do tej klasy.');
        try {
            if (!await isClassMember(String(classId), String(uid || ''))) {
                return socket.emit('error_msg', 'Ten użytkownik nie należy do tej klasy.');
            }
            // Tymczasowe hasło do przekazania uczniowi.
            const targetUid = String(uid || '');
            const target = await getUser(targetUid);
            if (!target || target.role !== 'student') {
                return socket.emit('error_msg', 'Hasło można resetować tylko kontu ucznia.');
            }
            const temp = 'Az!' + crypto.randomBytes(6).toString('base64url');
            await firebaseAuth.updateUser(targetUid, { password: temp });
            await firebaseAuth.revokeRefreshTokens(targetUid);
            socket.emit('member_password_reset', { uid, tempPassword: temp });
        } catch (e) {
            console.error('[reset_member_password] error:', e.message);
            socket.emit('error_msg', 'Nie udało się zresetować hasła.');
        }
    });

    socket.on('close_class', async ({ classId }) => {
        if (!checkRateLimit(socket.id, 'close_class', 10, 10000)) return;
        if (!requireAuth()) return;
        if (!requireVerifiedStaff()) return;
        if (!await ownsClass(classId)) return socket.emit('error_msg', 'Brak dostępu do tej klasy.');
        try {
            await setClassActive(String(classId), false);
            const classes = await listClassesForTeacher(socket.uid, socket.data.schoolId);
            socket.emit('classes_list', { classes });
            socket.emit('info_msg', 'Klasa zamknięta (rok zakończony).');
        } catch (e) {
            socket.emit('error_msg', 'Nie udało się zamknąć klasy.');
        }
    });

    socket.on('request_class_report', async ({ classId }) => {
        if (!checkRateLimit(socket.id, 'request_class_report', 5, 10000)) return;
        if (!requireAuth()) return;
        if (!await canViewClass(classId)) return socket.emit('error_msg', 'Brak dostępu do raportu tej klasy.');
        try {
            const sessions = await listClassSessions(String(classId), 30);
            socket.emit('class_report', { classId: String(classId), sessions });
        } catch (error) {
            console.error('[request_class_report] error:', error.message);
            socket.emit('error_msg', 'Nie udało się wczytać raportu klasy.');
        }
    });

    // 2. Create room (Host) — tylko nauczyciel; pokój powiązany z klasą.
    socket.on('create_room', async ({ config, mode, classId }) => {
        if (!checkRateLimit(socket.id, 'create_room', 3, 10000)) return;
        if (!requireAuth()) return;
        if (!requireVerifiedStaff()) return;
        if (socket.data.accountRole !== 'teacher') return socket.emit('error_msg', 'Tylko nauczyciel może tworzyć pokój.');
        if (!await requireActiveSchool()) return;

        // Zweryfikuj, że klasa istnieje i należy do tego nauczyciela.
        if (!classId) return socket.emit('error_msg', 'Wybierz aktywną klasę.');
        let cls = null;
        try { cls = await getClass(String(classId)); } catch (e) { /* ignore */ }
        const canManageClass = cls && (cls.teacherUid === socket.uid || (cls.schoolId && cls.schoolId === socket.data.schoolId));
        if (!canManageClass || cls.active === false) {
            return socket.emit('error_msg', 'Nieprawidłowa lub zamknięta klasa.');
        }

        leaveCurrentRoom(socket);

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
            mode: ALLOWED_ROOM_MODES.has(mode) ? mode : 'manual',
            config: safeConfig,
            players: Object.create(null),
            pending: Object.create(null),
            state: 'lobby',
            taskIndex: 0,
            started: false,
            currentTask: null,
            answeredByTask: Object.create(null),
            autoAdvanceTimer: null,
            sessionId: 'S' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex'),
            startedAt: null,
            sessionStats: Object.create(null),
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
        socket.data.roomRole = 'host';

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
        socket.emit('join_error', { reason: 'APPROVAL_REQUIRED', code });
    });

    // 3b. Request join — wymaga zalogowanego ucznia.
    socket.on('request_join', async (data) => {
        if (!checkRateLimit(socket.id, 'request_join', 5, 10000)) return;
        if (!requireAuth()) return;
        const code = sanitizeRoomCode(data?.code);
        const room = rooms[code];

        if (!room) return socket.emit('error_msg', 'Pokój nie istnieje.');
        if (room.locked) return socket.emit('join_rejected', { reason: 'Pokój jest zablokowany.' });
        if (room.state !== 'lobby') return socket.emit('join_rejected', { reason: 'Zajęcia już trwają.' });
        if (room.players[socket.id]) {
            socket.join(code);
            socket.data.roomCode = code;
            socket.data.roomRole = room.players[socket.id].role;
            socket.emit('join_accepted', {
                roomCode: code,
                name: room.players[socket.id].name,
                avatar: room.players[socket.id].avatar
            });
            emitLobbyUpdate(code);
            return;
        }
        if (Object.keys(room.players).length >= MAX_ROOM_CAPACITY) {
            return socket.emit('join_rejected', { reason: 'Pokój pełny.' });
        }
        if (socket.data.accountRole !== 'student') {
            return socket.emit('join_rejected', { reason: 'Do pokoju uczniowskiego może wejść tylko uczeń.' });
        }
        if (room.classId && !await isClassMember(room.classId, socket.uid)) {
            return socket.emit('join_rejected', { reason: 'Najpierw dołącz do klasy kodem od nauczyciela.' });
        }
        if (roomHasUid(room, socket.uid)) {
            return socket.emit('join_rejected', { reason: 'To konto jest już w pokoju.' });
        }
        const existingPending = Object.values(room.pending || {}).find(p => p.uid === socket.uid);
        if (existingPending) {
            socket.emit('join_requested', { roomCode: code });
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
            if (Object.keys(room.players).length >= MAX_ROOM_CAPACITY) {
                pendingSocket.emit('join_rejected', { reason: 'Pokój pełny.' });
                delete room.pending[pendingId];
                return;
            }
            if (roomHasUid(room, pending.uid)) {
                pendingSocket.emit('join_rejected', { reason: 'To konto jest już w pokoju.' });
                delete room.pending[pendingId];
                return;
            }
            leaveCurrentRoom(pendingSocket, code);
            pendingSocket.join(code);
            pendingSocket.data.roomCode = code;
            pendingSocket.data.roomRole = 'player';

            room.players[pending.socketId] = makePlayer({
                id: pending.socketId,
                uid: pending.uid,
                name: pending.name,
                avatar: pending.avatar,
                role: 'player'
            });

            delete room.pending[pendingId];

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

    socket.on('close_room', (data) => {
        if (!checkRateLimit(socket.id, 'close_room', 3, 10000)) return;
        const code = sanitizeRoomCode(data?.code);
        const room = rooms[code];
        if (!room || socket.id !== room.host) return;
        closeRoom(code, 'TEACHER_ENDED');
    });

    socket.on('host_start_game', async (data) => {
        if (!checkRateLimit(socket.id, 'host_start_game', 3, 10000)) return;
        const code = sanitizeRoomCode(data?.code);
        const room = rooms[code];
        if (!room || socket.id !== room.host) return;
        if (room.state !== 'lobby') return socket.emit('error_msg', 'Te zajęcia już zostały rozpoczęte.');

        room.state = 'playing';
        room.started = true;
        if (!room.startedAt) room.startedAt = Date.now();
        room.taskIndex = 0;
        room.answeredByTask = Object.create(null); // Reset answer tracking

        for (const pid of Object.keys(room.players)) {
            if (room.players[pid].role !== 'host') {
                room.players[pid].status = 'thinking';
                const player = room.players[pid];
                if (!room.sessionStats[player.uid]) {
                    room.sessionStats[player.uid] = {
                        uid: player.uid,
                        name: player.name,
                        attempts: 0,
                        correct: 0,
                        xp: 0,
                        totalTime: 0
                    };
                }
            }
        }

        room.currentTask = generateTask(room.config, room._seqHistory);

        io.to(code).emit('game_started', { config: room.config, mode: room.mode });
        io.to(code).emit('task_update', { index: 0, data: clientTaskFor(room) });
        emitLobbyUpdate(code);
        scheduleAutoAdvance(code);
    });

    socket.on('next_task', async (data) => {
        if (!checkRateLimit(socket.id, 'next_task', 10, 1000)) return;
        const code = sanitizeRoomCode(data?.code);
        const room = rooms[code];
        if (!room || socket.id !== room.host || room.state !== 'playing') return;
        advanceRoomTask(code);
    });

    socket.on('force_end_round', (data) => {
        if (!checkRateLimit(socket.id, 'force_end_round', 5, 10000)) return;
        const code = sanitizeRoomCode(data?.code);
        const room = rooms[code];
        if (!room || socket.id !== room.host) return;

        io.to(code).emit('round_ended', { reason: 'TIMEOUT', index: room.taskIndex });
        if (room.mode === 'auto') {
            if (room.autoAdvanceTimer) clearTimeout(room.autoAdvanceTimer);
            const expectedIndex = room.taskIndex;
            room.autoAdvanceTimer = setTimeout(() => {
                const current = rooms[code];
                if (current && current.state === 'playing' && current.taskIndex === expectedIndex) {
                    advanceRoomTask(code);
                }
            }, 1000);
        }
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
        if (!Number.isInteger(data?.taskIndex) || data.taskIndex !== room.taskIndex) {
            return socket.emit('answer_rejected', { reason: 'STALE_TASK' });
        }

        // Prevent double-submission per task (race-condition safe)
        if (!room.answeredByTask[room.taskIndex]) {
            room.answeredByTask[room.taskIndex] = new Set();
        }
        if (room.answeredByTask[room.taskIndex].has(player.uid)) return;
        room.answeredByTask[room.taskIndex].add(player.uid);

        player.status = 'done';

        const submitted = Number(data?.answer);
        const expected = Number(room.currentTask.answer);
        const correct = Number.isInteger(submitted) && submitted === expected;

        const stat = room.sessionStats[player.uid] || (room.sessionStats[player.uid] = {
            uid: player.uid,
            name: player.name,
            attempts: 0,
            correct: 0,
            xp: 0,
            totalTime: 0
        });
        stat.attempts += 1;
        if (correct) stat.correct += 1;

        let xpEarned = 0;
        if (correct) {
            xpEarned = pointsForConfig(room.config); // punkty zależne od trudności poziomu
            player.xp += xpEarned;
            stat.xp += xpEarned;
            // Punkty z zajęć (multiplayer) trafiają do rankingu klasy/roku ORAZ do
            // globalnego all-time — oba keyed trwałym uid gracza.
            try {
                if (room.classId) {
                    await awardMultiplayerPoints(room.classId, player.uid, xpEarned, player.name);
                }
            } catch (e) {
                console.error('[submit_answer] Firestore XP error:', e.message);
                socket.emit('score_save_failed', { message: 'Wynik może nie zostać zapisany.' });
            }
        }

        // Time — validate range (0..5 min in ms)
        if (Number.isFinite(data?.time) && data.time >= 0 && data.time < 300000) {
            player.totalTime = (player.totalTime || 0) + data.time;
            stat.totalTime += data.time;
        }

        socket.emit('validation_result', { correct, xp: xpEarned, corAnswer: expected });

        const players = sortPlayersForLobby(room);
        io.to(code).emit('leaderboard_update', { players });
        emitLobbyUpdate(code);
        const activePlayers = Object.values(room.players).filter(p => p.role !== 'host');
        if (room.mode === 'auto' && activePlayers.length > 0 && activePlayers.every(p => p.status === 'done')) {
            scheduleAutoAdvance(code, 1200);
        }
    });

    // 7. Profil i rankingi. Trening solo pozostaje lokalny: klient nie może
    // wiarygodnie poświadczyć poprawności odpowiedzi.

    // --- PROFIL ---
    socket.on('request_profile', async () => {
        if (!checkRateLimit(socket.id, 'request_profile', 5, 10000)) return;
        if (!requireAuth()) return;
        try {
            const user = await getUser(socket.uid);
            const cls = await findClassForMember(socket.uid);
            socket.emit('profile_data', {
                name: (user && user.name) || socket.data.name,
                role: socket.data.accountRole,
                totalXp: (user && user.totalXp) || 0,
                soloXp: (user && user.soloXp) || 0,
                history: (user && user.history) || {},
                trainingPresets: (user && user.trainingPresets) || [],
                classId: cls ? cls.id : '',
                className: cls ? cls.name : '',
                classPoints: cls ? cls.points : 0
            });
        } catch (e) {
            console.error('[request_profile] error:', e.message);
            socket.emit('error_msg', 'Nie udało się wczytać profilu.');
        }
    });

    socket.on('save_training_presets', async (data) => {
        if (!checkRateLimit(socket.id, 'save_training_presets', 10, 60000)) return;
        if (!requireAuth()) return;
        try {
            const presets = validateTrainingPresets(data && data.presets);
            await updateTrainingPresets(socket.uid, presets);
            socket.emit('training_presets_saved', { presets });
        } catch (e) {
            console.error('[save_training_presets] error:', e.message);
            socket.emit('error_msg', 'Nie udało się zapisać konfiguracji treningu.');
        }
    });

    socket.on('request_global_leaderboard', async () => {
        if (!checkRateLimit(socket.id, 'request_global_leaderboard', 2, 10000)) return;
        if (!requireAuth()) return;
        try {
            const board = publicLeaderboard(await getGlobalLeaderboard(20), 'totalXp');
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
    for (const code of Object.keys(rooms)) closeRoom(code, 'SERVER_SHUTDOWN');

    setTimeout(async () => {
        await Promise.allSettled(Array.from(pendingSessionWrites));
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

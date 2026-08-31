// server/firestore.js
// Helper module for Firestore operations used by the Anzan multiplayer server.
// The project runs on Google App Engine, so the default service account has
// permission to read/write Firestore without extra credentials.

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore({ databaseId: 'anzan-db' });

// ---------- USERS ----------
// uid = trwały identyfikator z Firebase Authentication (NIE socket.id).
async function registerUser(uid, { name, avatar, role }) {
    const userRef = db.collection('users').doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) {
        await userRef.set({
            name,
            avatar: avatar || 'default',
            role: role || 'student',
            totalXp: 0,
            ownedItems: [],
            createdAt: Firestore.FieldValue.serverTimestamp()
        });
    } else {
        // Aktualizuj dane profilu; NIE nadpisuj totalXp. Rolę ustaw, jeśli brak;
        // dopuść awans na nauczyciela (z poprawnym kodem sprawdzanym w serwerze),
        // ale nigdy nie degraduj nauczyciela do ucznia.
        const update = { name };
        if (avatar) update.avatar = avatar;
        const cur = snap.data().role;
        if (!cur) update.role = role || 'student';
        else if (role === 'teacher' && cur !== 'teacher') update.role = 'teacher';
        await userRef.update(update);
    }
    return userRef;
}

async function getUser(uid) {
    const snap = await db.collection('users').doc(uid).get();
    return snap.exists ? { uid: snap.id, ...snap.data() } : null;
}

// Globalny ranking all-time (tylko punkty z zajęć/multiplayer).
async function updateUserScore(uid, delta) {
    const userRef = db.collection('users').doc(uid);
    await userRef.set({
        totalXp: Firestore.FieldValue.increment(delta),
        history: { [todayKey()]: Firestore.FieldValue.increment(delta) }
    }, { merge: true });
}

function todayKey() {
    return new Date().toISOString().split('T')[0];
}

// Punkty z treningu solo — CELOWO osobne pole. Ranking "Trening" mierzy
// pracowitosc, ranking "Zajecia" (totalXp) mierzy umiejetnosc w warunkach
// kontrolowanych przez nauczyciela. Mieszanie ich pozwoliloby nabic tabele
// najlatwiejszym poziomem wybranym samodzielnie.
async function addSoloXp(uid, delta) {
    const userRef = db.collection('users').doc(uid);
    await userRef.set({
        soloXp: Firestore.FieldValue.increment(delta),
        history: { [todayKey()]: Firestore.FieldValue.increment(delta) },
        lastActive: Firestore.FieldValue.serverTimestamp()
    }, { merge: true });
}

async function getSoloLeaderboard(limit = 20) {
    const snap = await db.collection('users')
        .orderBy('soloXp', 'desc')
        .limit(limit)
        .get();
    return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

// Punkty ucznia w konkretnej klasie (do profilu).
async function getMemberPoints(classId, uid) {
    const snap = await db.collection('classes').doc(classId).collection('members').doc(uid).get();
    return snap.exists ? (snap.data().points || 0) : 0;
}

// Klasa ucznia do naglowka profilu. Czytamy users/{uid}.classId zapisane przy
// dolaczeniu — collectionGroup po polu 'uid' nie zadzialaby, bo dokumenty
// czlonkow trzymaja uid jako ID dokumentu, nie jako pole (i wymagaloby indeksu).
async function findClassForMember(uid) {
    const user = await getUser(uid);
    if (!user || !user.classId) return null;
    const cls = await getClass(user.classId);
    if (!cls) return null;
    const points = await getMemberPoints(user.classId, uid);
    return { id: cls.id, name: cls.name, points };
}

// ---------- CLASSES (grupy / rok szkolny) ----------
async function createClass(classId, { name, teacherUid, teacherName, schoolYear, joinCode }) {
    const ref = db.collection('classes').doc(classId);
    await ref.set({
        name,
        teacherUid,
        teacherName: teacherName || '',
        schoolYear: schoolYear || '',
        joinCode,
        active: true,
        createdAt: Firestore.FieldValue.serverTimestamp()
    });
    return ref;
}

async function getClass(classId) {
    const snap = await db.collection('classes').doc(classId).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

// Znajdź aktywną klasę po kodzie dołączenia (kod unikalny wśród aktywnych).
async function findClassByJoinCode(joinCode) {
    const q = await db.collection('classes')
        .where('joinCode', '==', joinCode)
        .where('active', '==', true)
        .limit(1)
        .get();
    if (q.empty) return null;
    const doc = q.docs[0];
    return { id: doc.id, ...doc.data() };
}

async function listClassesByTeacher(teacherUid) {
    const q = await db.collection('classes')
        .where('teacherUid', '==', teacherUid)
        .get();
    return q.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Dopisz ucznia do rosteru klasy (idempotentnie — nie zeruje punktów przy ponownym wejściu).
async function addClassMember(classId, uid, name) {
    const ref = db.collection('classes').doc(classId).collection('members').doc(uid);
    // Zapamietaj klase na profilu ucznia — profil czyta ja jednym odczytem,
    // bez zapytania collectionGroup i bez indeksu zlozonego.
    await db.collection('users').doc(uid).set({ classId }, { merge: true });
    const snap = await ref.get();
    if (!snap.exists) {
        await ref.set({
            name,
            points: 0,
            joinedAt: Firestore.FieldValue.serverTimestamp(),
            lastActive: Firestore.FieldValue.serverTimestamp()
        });
    } else {
        await ref.update({ name, lastActive: Firestore.FieldValue.serverTimestamp() });
    }
    return ref;
}

// Punkty w obrębie klasy/roku (ranking klasy). merge=true na wypadek braku dokumentu.
async function addPointsToClassMember(classId, uid, delta, name) {
    const ref = db.collection('classes').doc(classId).collection('members').doc(uid);
    await ref.set({
        name: name || '',
        points: Firestore.FieldValue.increment(delta),
        lastActive: Firestore.FieldValue.serverTimestamp()
    }, { merge: true });
}

async function getClassLeaderboard(classId, limit = 50) {
    const q = await db.collection('classes').doc(classId).collection('members')
        .orderBy('points', 'desc')
        .limit(limit)
        .get();
    return q.docs.map(d => ({ uid: d.id, ...d.data() }));
}

async function removeClassMember(classId, uid) {
    await db.collection('classes').doc(classId).collection('members').doc(uid).delete();
}

async function setClassActive(classId, active) {
    await db.collection('classes').doc(classId).update({ active: !!active });
}

// ---------- ROOMS ----------
async function createRoom(code, data) {
    const roomRef = db.collection('rooms').doc(code);
    await roomRef.set(Object.assign({
        players: {},
        pending: {},
        taskIndex: 0,
        started: false,
        createdAt: Firestore.FieldValue.serverTimestamp()
    }, data));
    return roomRef;
}

async function updateRoom(code, data) {
    const roomRef = db.collection('rooms').doc(code);
    await roomRef.update(data);
}

async function getRoom(code) {
    const snap = await db.collection('rooms').doc(code).get();
    return snap.exists ? snap.data() : null;
}

// Usuwa dokument pokoju po zamknięciu (dotąd rosły w nieskończoność).
async function deleteRoom(code) {
    await db.collection('rooms').doc(code).delete();
}

// ---------- GLOBAL LEADERBOARD ----------
async function getGlobalLeaderboard(limit = 20) {
    const snap = await db.collection('users')
        .orderBy('totalXp', 'desc')
        .limit(limit)
        .get();
    return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

async function healthCheck() {
    try {
        await db.collection('_health').limit(1).get();
        return true;
    } catch (e) {
        console.error('[healthCheck] Firestore unreachable:', e.message);
        return false;
    }
}

module.exports = {
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
    getRoom,
    deleteRoom,
    getGlobalLeaderboard,
    addSoloXp,
    getSoloLeaderboard,
    getMemberPoints,
    findClassForMember,
    healthCheck
};

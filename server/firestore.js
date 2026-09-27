// server/firestore.js
// Helper module for Firestore operations used by the Anzan multiplayer server.
// The project runs on Google App Engine, so the default service account has
// permission to read/write Firestore without extra credentials.

const { Firestore } = require('@google-cloud/firestore');
const db = new Firestore({ databaseId: 'anzan-db' });

// ---------- USERS ----------
// uid = trwały identyfikator z Firebase Authentication (NIE socket.id).
async function registerUser(uid, { name, avatar, role, schoolId, schoolRole }) {
    const userRef = db.collection('users').doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) {
        await userRef.set({
            name,
            avatar: avatar || 'default',
            role: role || 'student',
            schoolId: schoolId || '',
            schoolRole: schoolRole || '',
            totalXp: 0,
            ownedItems: [],
            createdAt: Firestore.FieldValue.serverTimestamp()
        });
    } else {
        // Aktualizuj dane profilu; NIE nadpisuj totalXp. Awans roli jest wcześniej
        // autoryzowany przez serwer kodem szkoły albo kodem administratora.
        const update = { name };
        if (avatar) update.avatar = avatar;
        const cur = snap.data().role;
        if (!cur) update.role = role || 'student';
        else if (role === 'school_admin' && cur !== 'school_admin') update.role = 'school_admin';
        else if (role === 'teacher' && cur === 'student') update.role = 'teacher';
        if (schoolId) update.schoolId = schoolId;
        if (schoolRole) update.schoolRole = schoolRole;
        await userRef.update(update);
    }
    return userRef;
}

async function getUser(uid) {
    const snap = await db.collection('users').doc(uid).get();
    return snap.exists ? { uid: snap.id, ...snap.data() } : null;
}

function todayKey() {
    return new Date().toISOString().split('T')[0];
}

// Punkty ucznia w konkretnej klasie (do profilu).
async function getMemberPoints(classId, uid) {
    const snap = await db.collection('classes').doc(classId).collection('members').doc(uid).get();
    return snap.exists ? (snap.data().points || 0) : 0;
}

async function isClassMember(classId, uid) {
    if (!classId || !uid) return false;
    const snap = await db.collection('classes').doc(classId).collection('members').doc(uid).get();
    return snap.exists;
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
async function createClass(classId, { name, teacherUid, teacherName, schoolYear, joinCode, schoolId }) {
    const ref = db.collection('classes').doc(classId);
    await ref.set({
        name,
        teacherUid,
        teacherName: teacherName || '',
        schoolYear: schoolYear || '',
        joinCode,
        schoolId: schoolId || '',
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

async function listClassesForTeacher(teacherUid, schoolId) {
    if (!schoolId) return listClassesByTeacher(teacherUid);
    const q = await db.collection('classes').where('schoolId', '==', schoolId).get();
    return q.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Dopisz ucznia do rosteru klasy (idempotentnie — nie zeruje punktów przy ponownym wejściu).
async function addClassMember(classId, uid, name, schoolId) {
    const ref = db.collection('classes').doc(classId).collection('members').doc(uid);
    // Zapamietaj klase na profilu ucznia — profil czyta ja jednym odczytem,
    // bez zapytania collectionGroup i bez indeksu zlozonego.
    await db.collection('users').doc(uid).set({ classId, ...(schoolId ? { schoolId } : {}) }, { merge: true });
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

// Jeden atomowy zapis utrzymuje ranking globalny i klasowy w zgodzie.
async function awardMultiplayerPoints(classId, uid, delta, name) {
    const userRef = db.collection('users').doc(uid);
    const memberRef = db.collection('classes').doc(classId).collection('members').doc(uid);
    const batch = db.batch();
    batch.set(userRef, {
        totalXp: Firestore.FieldValue.increment(delta),
        history: { [todayKey()]: Firestore.FieldValue.increment(delta) },
        lastActive: Firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    batch.set(memberRef, {
        name: name || '',
        points: Firestore.FieldValue.increment(delta),
        lastActive: Firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await batch.commit();
}

async function getClassLeaderboard(classId, limit = 50) {
    const q = await db.collection('classes').doc(classId).collection('members')
        .orderBy('points', 'desc')
        .limit(limit)
        .get();
    return q.docs.map(d => ({ uid: d.id, ...d.data() }));
}

async function removeClassMember(classId, uid) {
    const memberRef = db.collection('classes').doc(classId).collection('members').doc(uid);
    const userRef = db.collection('users').doc(uid);
    await db.runTransaction(async transaction => {
        const userSnap = await transaction.get(userRef);
        transaction.delete(memberRef);
        if (userSnap.exists && userSnap.data().classId === classId) {
            transaction.update(userRef, { classId: Firestore.FieldValue.delete() });
        }
    });
}

async function setClassActive(classId, active) {
    await db.collection('classes').doc(classId).update({ active: !!active });
}

// ---------- SCHOOLS / TENANCY ----------
async function createSchool(schoolId, { name, ownerUid, ownerName, teacherJoinCode }) {
    const ref = db.collection('schools').doc(schoolId);
    const userRef = db.collection('users').doc(ownerUid);
    await db.runTransaction(async transaction => {
        const userSnap = await transaction.get(userRef);
        if (!userSnap.exists) throw new Error('OWNER_NOT_FOUND');
        if (userSnap.data().schoolId) throw new Error('SCHOOL_ALREADY_ASSIGNED');
        transaction.create(ref, {
            name,
            ownerUid,
            ownerName,
            teacherJoinCode,
            plan: 'trial',
            status: 'active',
            seatLimit: 100,
            createdAt: Firestore.FieldValue.serverTimestamp()
        });
        transaction.update(userRef, { schoolId, schoolRole: 'owner', role: 'school_admin' });
    });
    const legacyClasses = await db.collection('classes').where('teacherUid', '==', ownerUid).get();
    if (!legacyClasses.empty) {
        const batch = db.batch();
        let updates = 0;
        legacyClasses.docs.forEach(doc => {
            if (!doc.data().schoolId) {
                batch.update(doc.ref, { schoolId });
                updates++;
            }
        });
        if (updates) await batch.commit();
    }
    return ref;
}

async function getSchool(schoolId) {
    if (!schoolId) return null;
    const snap = await db.collection('schools').doc(schoolId).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function findSchoolByTeacherCode(code) {
    if (!code) return null;
    const snap = await db.collection('schools')
        .where('teacherJoinCode', '==', code)
        .where('status', '==', 'active')
        .limit(1)
        .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() };
}

async function rotateSchoolTeacherCode(schoolId, teacherJoinCode) {
    await db.collection('schools').doc(schoolId).update({ teacherJoinCode });
}

// ---------- SESSION REPORTS ----------
// Jedna lekcja = jeden dokument zbiorczy. Statystyki są agregowane w pamięci
// podczas zajęć i zapisywane dopiero przy zamknięciu pokoju, co ogranicza koszty.
async function saveClassSession(classId, sessionId, data) {
    const ref = db.collection('classes').doc(classId).collection('sessions').doc(sessionId);
    await ref.set({
        ...data,
        savedAt: Firestore.FieldValue.serverTimestamp()
    });
}

async function listClassSessions(classId, limit = 30) {
    const snap = await db.collection('classes').doc(classId).collection('sessions')
        .orderBy('startedAt', 'desc')
        .limit(limit)
        .get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
    createClass,
    getClass,
    findClassByJoinCode,
    listClassesByTeacher,
    listClassesForTeacher,
    addClassMember,
    awardMultiplayerPoints,
    getClassLeaderboard,
    removeClassMember,
    setClassActive,
    createSchool,
    getSchool,
    findSchoolByTeacherCode,
    rotateSchoolTeacherCode,
    saveClassSession,
    listClassSessions,
    getGlobalLeaderboard,
    getMemberPoints,
    isClassMember,
    findClassForMember,
    healthCheck
};

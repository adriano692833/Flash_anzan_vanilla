// server/firestore.js
// Helper module for Firestore operations used by the Anzan multiplayer server.
// The project runs on Google App Engine, so the default service account has
// permission to read/write Firestore without extra credentials.

const { Firestore } = require('@google-cloud/firestore');
const crypto = require('crypto');
const db = new Firestore({ databaseId: 'anzan-db' });

function loginNameId(normalizedName) {
    return crypto.createHash('sha256').update(String(normalizedName || ''), 'utf8').digest('hex');
}

// ---------- USERS ----------
// uid = trwały identyfikator z Firebase Authentication (NIE socket.id).
async function registerUser(uid, { name, avatar, role, schoolId, schoolRole, contactEmail, contactPhone, linkedStudentUid, loginNameNormalized }) {
    const userRef = db.collection('users').doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) {
        await userRef.set({
            name,
            avatar: avatar || 'default',
            role: role || 'student',
            schoolId: schoolId || '',
            schoolRole: schoolRole || '',
            contactEmail: contactEmail || '',
            contactPhone: contactPhone || '',
            linkedStudentUid: linkedStudentUid || '',
            loginNameNormalized: loginNameNormalized || '',
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
        if (contactEmail) update.contactEmail = contactEmail;
        if (contactPhone) update.contactPhone = contactPhone;
        if (linkedStudentUid) update.linkedStudentUid = linkedStudentUid;
        if (loginNameNormalized) update.loginNameNormalized = loginNameNormalized;
        await userRef.update(update);
    }
    // Lekki katalog pracowników szkoły: administrator nie musi skanować profili
    // wszystkich uczniów, aby wyświetlić listę nauczycieli.
    if (role === 'teacher' && schoolId) {
        await db.collection('schools').doc(schoolId).collection('teachers').doc(uid).set({
            name,
            role: 'teacher',
            lastActive: Firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }
    return userRef;
}

async function getUser(uid) {
    const snap = await db.collection('users').doc(uid).get();
    return snap.exists ? { uid: snap.id, ...snap.data() } : null;
}

async function findUidByLoginName(normalizedName) {
    if (!normalizedName) return '';
    const snap = await db.collection('loginNames').doc(loginNameId(normalizedName)).get();
    return snap.exists ? String(snap.data().uid || '') : '';
}

async function claimLoginName(uid, normalizedName) {
    if (!uid || !normalizedName) throw new Error('INVALID_LOGIN_NAME');
    const aliasRef = db.collection('loginNames').doc(loginNameId(normalizedName));
    await db.runTransaction(async transaction => {
        const aliasSnap = await transaction.get(aliasRef);
        if (aliasSnap.exists && aliasSnap.data().uid !== uid) throw new Error('LOGIN_NAME_TAKEN');
        transaction.set(aliasRef, {
            uid,
            updatedAt: Firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    });
}

async function releaseLoginName(uid, normalizedName) {
    if (!uid || !normalizedName) return;
    const aliasRef = db.collection('loginNames').doc(loginNameId(normalizedName));
    await db.runTransaction(async transaction => {
        const snap = await transaction.get(aliasRef);
        if (snap.exists && snap.data().uid === uid) transaction.delete(aliasRef);
    });
}

async function updateTrainingPresets(uid, presets) {
    await db.collection('users').doc(uid).set({ trainingPresets: presets }, { merge: true });
}

// Wyniki solo są statystyką treningową (nie trafiają do rankingów szkoły).
// Klient wysyła zbuforowany przyrost, dzięki czemu nie płacimy za zapis po każdym przykładzie.
async function awardSoloPoints(uid, delta) {
    await db.collection('users').doc(uid).set({
        soloXp: Firestore.FieldValue.increment(delta),
        history: { [todayKey()]: Firestore.FieldValue.increment(delta) },
        lastActive: Firestore.FieldValue.serverTimestamp()
    }, { merge: true });
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
async function createClass(classId, { name, teacherUid, teacherName, schoolYear, schoolId }) {
    const ref = db.collection('classes').doc(classId);
    await ref.set({
        name,
        teacherUid,
        teacherName: teacherName || '',
        schoolYear: schoolYear || '',
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

async function listClassesByTeacher(teacherUid) {
    const q = await db.collection('classes')
        .where('teacherUid', '==', teacherUid)
        .get();
    return q.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function listClassesForTeacher(teacherUid, schoolId) {
    if (!schoolId) return listClassesByTeacher(teacherUid);
    const q = await db.collection('classes').where('schoolId', '==', schoolId).get();
    return q.docs.map(d => ({ id: d.id, ...d.data() })).filter(item => item.teacherUid === teacherUid);
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
async function createSchool(schoolId, { name, ownerUid, ownerName }) {
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
            plan: 'trial',
            status: 'active',
            seatLimit: 100,
            createdAt: Firestore.FieldValue.serverTimestamp()
        });
        transaction.update(userRef, { schoolId, schoolRole: 'owner', role: 'school_admin', canTeach: true });
    });
    await ref.collection('teachers').doc(ownerUid).set({
        name: ownerName,
        role: 'owner_instructor',
        lastActive: Firestore.FieldValue.serverTimestamp()
    }, { merge: true });
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

// Jeden odczyt panelu właściciela. Dla każdej klasy używamy tanich agregacji
// count(), zamiast pobierać wszystkie dokumenty uczniów i sesji.
async function getSchoolDashboard(schoolId) {
    const [teachersSnap, classesSnap] = await Promise.all([
        db.collection('schools').doc(schoolId).collection('teachers').get(),
        db.collection('classes').where('schoolId', '==', schoolId).get()
    ]);
    const teachers = teachersSnap.docs.map(doc => ({
        name: doc.data().name || 'Nauczyciel'
    }));
    const classes = await Promise.all(classesSnap.docs.map(async doc => {
        const [membersCount, sessionsCount] = await Promise.all([
            doc.ref.collection('members').count().get(),
            doc.ref.collection('sessions').count().get()
        ]);
        const data = doc.data();
        return {
            id: doc.id,
            name: data.name || 'Klasa',
            teacherUid: data.teacherUid || '',
            teacherName: data.teacherName || '—',
            schoolYear: data.schoolYear || '',
            active: data.active !== false,
            studentCount: membersCount.data().count,
            sessionCount: sessionsCount.data().count
        };
    }));
    classes.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'pl'));
    teachers.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    return {
        teachers,
        classes,
        totals: {
            teachers: teachers.length,
            classes: classes.length,
            activeClasses: classes.filter(item => item.active).length,
            students: classes.reduce((sum, item) => sum + item.studentCount, 0),
            sessions: classes.reduce((sum, item) => sum + item.sessionCount, 0)
        }
    };
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

// ---------- INVITATIONS / SCHOOL OPERATIONS ----------
// Id dokumentu zaproszenia jest skrótem SHA-256 kodu. Sam kod istnieje tylko
// w odpowiedzi po utworzeniu i nie może zostać odczytany z bazy po fakcie.
async function createInvitations(items) {
    const batch = db.batch();
    items.forEach(item => {
        const ref = db.collection('invitations').doc(item.codeHash);
        batch.create(ref, {
            role: item.role,
            schoolId: item.schoolId || '',
            classId: item.classId || '',
            studentUid: item.studentUid || '',
            schoolName: item.schoolName || '',
            contactEmail: item.contactEmail || '',
            contactPhone: item.contactPhone || '',
            createdBy: item.createdBy,
            createdByName: item.createdByName || '',
            deliveryStatus: item.contactEmail ? 'pending' : 'not_requested',
            status: 'active',
            expiresAt: Firestore.Timestamp.fromDate(item.expiresAt),
            createdAt: Firestore.FieldValue.serverTimestamp()
        });
    });
    await batch.commit();
}

async function markInvitationDelivery(inviteId, status) {
    const allowed = new Set(['sent', 'failed', 'not_configured']);
    if (!inviteId || !allowed.has(status)) throw new Error('INVALID_DELIVERY_STATUS');
    const update = { deliveryStatus: status, deliveryUpdatedAt: Firestore.FieldValue.serverTimestamp() };
    if (status === 'sent') update.deliveredAt = Firestore.FieldValue.serverTimestamp();
    await db.collection('invitations').doc(inviteId).set(update, { merge: true });
}

async function getInvitation(codeHash) {
    const snap = await db.collection('invitations').doc(codeHash).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function claimInvitation(codeHash, uid) {
    const ref = db.collection('invitations').doc(codeHash);
    return db.runTransaction(async transaction => {
        const snap = await transaction.get(ref);
        if (!snap.exists) throw new Error('INVITE_INVALID');
        const invite = snap.data();
        if (invite.status !== 'active') throw new Error('INVITE_USED');
        const expires = invite.expiresAt && invite.expiresAt.toMillis ? invite.expiresAt.toMillis() : 0;
        if (!expires || expires <= Date.now()) throw new Error('INVITE_EXPIRED');
        transaction.update(ref, {
            status: 'used',
            usedBy: uid,
            usedAt: Firestore.FieldValue.serverTimestamp()
        });
        return { id: snap.id, ...invite };
    });
}

async function listInvitations(schoolId, limit = 100) {
    const snap = await db.collection('invitations')
        .where('schoolId', '==', schoolId)
        .limit(limit)
        .get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function revokeInvitation(inviteId, schoolId) {
    const ref = db.collection('invitations').doc(inviteId);
    await db.runTransaction(async transaction => {
        const snap = await transaction.get(ref);
        if (!snap.exists || snap.data().schoolId !== schoolId) throw new Error('INVITE_NOT_FOUND');
        if (snap.data().status === 'active') {
            transaction.update(ref, { status: 'revoked', revokedAt: Firestore.FieldValue.serverTimestamp() });
        }
    });
}

async function listSchoolUsers(schoolId) {
    const snap = await db.collection('users').where('schoolId', '==', schoolId).get();
    return snap.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
}

async function createScheduleEvent(eventId, data) {
    await db.collection('scheduleEvents').doc(eventId).create({
        ...data,
        createdAt: Firestore.FieldValue.serverTimestamp(),
        updatedAt: Firestore.FieldValue.serverTimestamp()
    });
}

async function listScheduleEvents(schoolId) {
    const snap = await db.collection('scheduleEvents').where('schoolId', '==', schoolId).get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function cancelScheduleEvent(eventId, schoolId, cancelledBy) {
    const ref = db.collection('scheduleEvents').doc(eventId);
    await db.runTransaction(async transaction => {
        const snap = await transaction.get(ref);
        if (!snap.exists || snap.data().schoolId !== schoolId) throw new Error('EVENT_NOT_FOUND');
        transaction.update(ref, {
            status: 'cancelled',
            cancelledBy,
            updatedAt: Firestore.FieldValue.serverTimestamp()
        });
    });
}

async function createAssignment(assignmentId, data) {
    await db.collection('assignments').doc(assignmentId).create({
        ...data,
        status: 'active',
        createdAt: Firestore.FieldValue.serverTimestamp()
    });
}

async function listAssignments(schoolId) {
    const snap = await db.collection('assignments').where('schoolId', '==', schoolId).get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function setAttendance(eventId, occurrenceDate, entries, markedBy) {
    const batch = db.batch();
    entries.forEach(entry => {
        const id = `${occurrenceDate}_${entry.uid}`;
        const ref = db.collection('scheduleEvents').doc(eventId).collection('attendance').doc(id);
        batch.set(ref, {
            uid: entry.uid,
            name: entry.name || '',
            occurrenceDate,
            status: entry.status,
            markedBy,
            markedAt: Firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    });
    await batch.commit();
}

async function listAttendance(eventId, occurrenceDate) {
    const snap = await db.collection('scheduleEvents').doc(eventId).collection('attendance')
        .where('occurrenceDate', '==', occurrenceDate).get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function createPrivacyRequest(requestId, data) {
    await db.collection('privacyRequests').doc(requestId).create({
        ...data,
        status: 'new',
        createdAt: Firestore.FieldValue.serverTimestamp()
    });
}

async function createMakeupRequest(requestId, data) {
    await db.collection('makeupRequests').doc(requestId).create({
        ...data,
        status: 'new',
        createdAt: Firestore.FieldValue.serverTimestamp()
    });
}

async function listSchoolRequests(collectionName, schoolId, limit = 100) {
    const allowed = new Set(['privacyRequests', 'makeupRequests']);
    if (!allowed.has(collectionName)) throw new Error('INVALID_COLLECTION');
    const snap = await db.collection(collectionName).where('schoolId', '==', schoolId).limit(limit).get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function updateSchoolRequest(collectionName, requestId, schoolId, status, resolvedBy) {
    const allowed = new Set(['privacyRequests', 'makeupRequests']);
    if (!allowed.has(collectionName)) throw new Error('INVALID_COLLECTION');
    const ref = db.collection(collectionName).doc(requestId);
    await db.runTransaction(async transaction => {
        const snap = await transaction.get(ref);
        if (!snap.exists || snap.data().schoolId !== schoolId) throw new Error('REQUEST_NOT_FOUND');
        transaction.update(ref, {
            status,
            resolvedBy,
            updatedAt: Firestore.FieldValue.serverTimestamp()
        });
    });
}

async function auditLog(schoolId, actorUid, action, details) {
    const ref = db.collection('schools').doc(schoolId).collection('auditLogs').doc();
    await ref.set({ actorUid, action, details: details || {}, createdAt: Firestore.FieldValue.serverTimestamp() });
}

async function listAuditLogs(schoolId, limit = 100) {
    const snap = await db.collection('schools').doc(schoolId).collection('auditLogs')
        .orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
    findUidByLoginName,
    claimLoginName,
    releaseLoginName,
    updateTrainingPresets,
    awardSoloPoints,
    createClass,
    getClass,
    listClassesByTeacher,
    listClassesForTeacher,
    addClassMember,
    awardMultiplayerPoints,
    getClassLeaderboard,
    removeClassMember,
    setClassActive,
    createSchool,
    getSchool,
    getSchoolDashboard,
    saveClassSession,
    listClassSessions,
    createInvitations,
    markInvitationDelivery,
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
    getMemberPoints,
    isClassMember,
    findClassForMember,
    healthCheck
};

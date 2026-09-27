'use strict';

const { Firestore } = require('@google-cloud/firestore');

const [schoolId, status, plan = 'trial'] = process.argv.slice(2);
const allowedStatuses = new Set(['active', 'suspended']);
const allowedPlans = new Set(['trial', 'start', 'school', 'network']);

if (!schoolId || !allowedStatuses.has(status) || !allowedPlans.has(plan)) {
    console.error('Użycie: npm run school:license -- <schoolId> <active|suspended> [trial|start|school|network]');
    process.exit(1);
}

async function main() {
    const db = new Firestore({ databaseId: 'anzan-db' });
    const ref = db.collection('schools').doc(String(schoolId));
    const snap = await ref.get();
    if (!snap.exists) throw new Error(`Szkoła ${schoolId} nie istnieje.`);
    await ref.update({
        status,
        plan,
        licenseUpdatedAt: Firestore.FieldValue.serverTimestamp()
    });
    console.log(`Licencja ${schoolId}: status=${status}, plan=${plan}`);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});

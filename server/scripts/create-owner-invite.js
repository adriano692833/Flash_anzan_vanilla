'use strict';

const crypto = require('crypto');
const { createInvitations } = require('../firestore');

function arg(name) {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

function normalizeEmail(value) {
    const email = String(value || '').trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function generateCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let raw = '';
    for (let i = 0; i < 12; i++) raw += alphabet[crypto.randomInt(alphabet.length)];
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

async function main() {
    const email = normalizeEmail(arg('email'));
    const schoolName = arg('school');
    const days = Math.max(1, Math.min(30, Number.parseInt(arg('days') || '7', 10) || 7));
    if (!schoolName) {
        throw new Error('Użycie: npm run invite:owner -- --school "Nazwa szkoły" [--email owner@example.com] [--days 7]');
    }
    const code = generateCode();
    await createInvitations([{
        codeHash: crypto.createHash('sha256').update(code.replace(/-/g, '')).digest('hex'),
        role: 'school_admin', schoolId: '', schoolName,
        contactEmail: email, contactPhone: '', createdBy: 'platform-operator',
        createdByName: 'Właściciel platformy', expiresAt: new Date(Date.now() + days * 86400000)
    }]);
    console.log(`Jednorazowe zaproszenie właściciela szkoły: ${code}`);
    console.log(`Link: https://anzan-web.ew.r.appspot.com/?auth=register&invite=${encodeURIComponent(code)}`);
    console.log(`Ważne przez: ${days} dni. ${email ? `Przypisany e-mail: ${email}` : 'E-mail właściciel poda przy rejestracji.'}`);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});

// Self-test generatora sorobanu.
// Uruchom: cd server && npm test
// Sprawdza, że KAŻDA operacja mieści się w dozwolonej technice poziomu,
// że sumy nie schodzą poniżej zera i że sekwencje nie są trywialne.

const G = require('./soroban-generator.js');

// Tabela odwzorowuje pole `tier` + cyfry + tryb z DEFAULT_KYU (js/app.js).
const KYU = {
    20: { d: 1, o: { min: 3, max: 5 }, m: 'add', tier: 'direct' },
    19: { d: 1, o: { min: 3, max: 5 }, m: 'add', tier: 'direct' },
    18: { d: 1, o: { min: 3, max: 6 }, m: 'add', tier: 'direct' },
    17: { d: 1, o: { min: 4, max: 6 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'friend5' },
    16: { d: 1, o: { min: 4, max: 6 }, m: 'add', tier: 'friend5' },
    15: { d: 1, o: { min: 4, max: 7 }, m: 'add', tier: 'friend5' },
    14: { d: 1, o: { min: 5, max: 7 }, m: 'add', tier: 'friend5' },
    13: { d: 1, o: { min: 5, max: 10 }, m: 'add', tier: 'friend10' },
    12: { d: 1, o: { min: 5, max: 10 }, m: 'add', tier: 'friend10' },
    11: { d: 1, o: { min: 10, max: 15 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'friend10' },
    10: { d: 2, o: { min: 5, max: 10 }, m: 'add', tier: 'full' },
    9: { d: 2, o: { min: 5, max: 5 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'full' },
    8: { d: 3, o: { min: 5, max: 10 }, m: 'add', tier: 'full' },
    6: { d: 4, o: { min: 5, max: 10 }, m: 'add', tier: 'full' },
    5: { d: 5, o: { min: 3, max: 7 }, m: 'add', tier: 'full' },
    3: { d: 8, o: { min: 3, max: 5 }, m: 'add', tier: 'full' },
    1: { d: 8, o: { min: 8, max: 12 }, m: 'add', tier: 'full' }
};

const TIER = G.TIER;
let violations = 0, negatives = 0, empties = 0;
const N = 2000;

for (const kyu of Object.keys(KYU)) {
    const cfg = KYU[kyu];
    const limit = TIER[cfg.tier];
    for (let s = 0; s < N; s++) {
        const seq = G.generateSequence(cfg);
        if (!seq.length) { empties++; continue; }
        let rods = [], running = 0;
        for (const term of seq) {
            const res = G.applyTerm(rods, Math.abs(term), term < 0 ? '-' : '+');
            if (!res.ok || res.tier > limit) { violations++; break; }
            rods = res.rods;
            running += term;
            if (running < 0) { negatives++; break; }
        }
    }
}

console.log(`Naruszenia techniki: ${violations}`);
console.log(`Sumy ujemne:         ${negatives}`);
console.log(`Puste sekwencje:     ${empties}`);
if (violations === 0 && negatives === 0 && empties === 0) {
    console.log('WYNIK: OK');
    process.exit(0);
} else {
    console.log('WYNIK: BŁĄD');
    process.exit(1);
}

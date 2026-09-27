// Self-test generatora sorobanu.
// Uruchom: cd server && npm test
// Sprawdza, że KAŻDA operacja mieści się w dozwolonej technice poziomu,
// że sumy nie schodzą poniżej zera i że sekwencje nie są trywialne.

const G = require('./soroban-generator.js');

// Tabela odwzorowuje pole `tier` + cyfry + tryb z DEFAULT_KYU (js/app.js).
const KYU = {
    20: { d: 1, o: { min: 3, max: 5 }, m: 'add', tier: 'direct', range: { min: 1, max: 4 } },
    19: { d: 1, o: { min: 3, max: 5 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'direct', range: { min: 1, max: 4 } },
    18: { d: 1, o: { min: 3, max: 6 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'direct', range: { min: 1, max: 5 } },
    17: { d: 1, o: { min: 4, max: 6 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'direct', range: { min: 5, max: 5 } },
    16: { d: 1, o: { min: 4, max: 6 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'direct', range: { min: 1, max: 9 } },
    15: { d: 1, o: { min: 4, max: 7 }, m: 'add', tier: 'friend5', range: { min: 1, max: 9 } },
    14: { d: 1, o: { min: 5, max: 7 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'friend5', range: { min: 1, max: 9 } },
    13: { d: 1, o: { min: 5, max: 10 }, m: 'add', tier: 'friend10' },
    12: { d: 1, o: { min: 5, max: 10 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'friend10' },
    11: { d: 1, o: { min: 10, max: 15 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'friend10' },
    10: { d: 2, o: { min: 5, max: 10 }, m: 'add', tier: 'full' },
    9: { d: 2, o: { min: 5, max: 8 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'full' },
    8: { d: 3, o: { min: 5, max: 10 }, m: 'add', tier: 'full', range: { min: 10, max: 999 } },
    6: { d: 4, o: { min: 5, max: 10 }, m: 'add', tier: 'full' },
    5: { d: 5, o: { min: 3, max: 7 }, m: 'add', tier: 'full' },
    3: { d: 8, o: { min: 3, max: 5 }, m: 'add', tier: 'full' },
    1: { d: 8, o: { min: 8, max: 12 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'full' }
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

// Jawne zakresy z poziomów i konfiguracji indywidualnych muszą być twardym
// ograniczeniem, a nie tylko opisem w interfejsie.
for (let i = 0; i < N; i++) {
    const basic = G.generateSequence({ d: 1, o: 4, m: 'mixed', tier: 'direct', range: { min: 1, max: 4 } });
    if (basic.some(term => Math.abs(term) < 1 || Math.abs(term) > 4)) violations++;
    const custom = G.generateSequence({ d: 3, o: 6, m: 'mixed', tier: 'full', range: { min: 25, max: 240 } });
    if (custom.some(term => Math.abs(term) < 25 || Math.abs(term) > 240)) violations++;
}

// Operacje dodatkowe muszą zawsze dawać całkowity, dodatni wynik.
for (let i = 0; i < N; i++) {
    const mul = G.generateSequence({ m: 'mul', d: 2, mul: { a: { min: 10, max: 99 }, b: { min: 2, max: 9 } } });
    if (mul.length !== 2 || !Number.isInteger(mul[0] * mul[1]) || mul[0] < 1 || mul[1] < 1) violations++;

    const div = G.generateSequence({ m: 'div', d: 2, div: { divisor: { min: 2, max: 9 }, quotient: { min: 2, max: 99 } } });
    if (div.length !== 2 || div[1] === 0 || !Number.isInteger(div[0] / div[1]) || div[0] < 1) violations++;
}

// Historia przekazana przez pokój ma być izolowana i ograniczona rozmiarem.
const historyA = [];
const historyB = [];
for (let i = 0; i < 40; i++) G.generateSequence(KYU[10], { history: historyA });
G.generateSequence(KYU[10], { history: historyB });
if (historyA.length !== 30 || historyB.length !== 1) violations++;

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

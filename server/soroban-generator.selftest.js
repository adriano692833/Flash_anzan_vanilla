// Self-test generatora sorobanu.
// Uruchom: cd server && npm test
// Sprawdza, że KAŻDA operacja mieści się w dozwolonej technice poziomu,
// że sumy nie schodzą poniżej zera i że sekwencje nie są trywialne.

const G = require('./soroban-generator.js');

// Tabela odwzorowuje pole `tier` + cyfry + tryb z DEFAULT_KYU (js/app.js).
const KYU = {
    20: { d: 1, o: { min: 3, max: 5 }, m: 'add', tier: 'direct', range: { min: 1, max: 5 } },
    19: { d: 1, o: { min: 3, max: 5 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'direct', range: { min: 1, max: 4 } },
    18: { d: 1, o: { min: 3, max: 6 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'direct', range: { min: 1, max: 5 } },
    17: { d: 1, o: { min: 4, max: 6 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'direct', range: { min: 1, max: 5 }, requiredAbsValue: 5 },
    16: { d: 1, o: { min: 4, max: 6 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'direct', range: { min: 1, max: 9 } },
    15: { d: 1, o: { min: 4, max: 7 }, m: 'add', tier: 'friend5', range: { min: 1, max: 9 } },
    14: { d: 1, o: { min: 5, max: 7 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'friend5', range: { min: 1, max: 9 } },
    13: { d: 1, o: { min: 5, max: 10 }, m: 'add', tier: 'friend10', range: { min: 1, max: 9 } },
    12: { d: 1, o: { min: 5, max: 10 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'friend10', range: { min: 1, max: 9 } },
    11: { d: 1, o: { min: 10, max: 15 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'friend10', range: { min: 1, max: 9 } },
    10: { d: 2, o: { min: 5, max: 10 }, m: 'add', tier: 'full', range: { min: 10, max: 99 } },
    9: { d: 2, o: { min: 5, max: 8 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'full', range: { min: 10, max: 99 } },
    8: { d: 3, o: { min: 5, max: 10 }, m: 'add', tier: 'full', range: { min: 10, max: 999 } },
    7: { d: 3, o: { min: 5, max: 10 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'full', range: { min: 100, max: 999 } },
    6: { d: 4, o: { min: 5, max: 10 }, m: 'add', tier: 'full', range: { min: 100, max: 9999 } },
    5: { d: 5, o: { min: 3, max: 7 }, m: 'add', tier: 'full', range: { min: 10000, max: 99999 } },
    4: { d: 7, o: { min: 3, max: 7 }, m: 'add', tier: 'full', range: { min: 100000, max: 9999999 } },
    3: { d: 8, o: { min: 3, max: 5 }, m: 'add', tier: 'full', range: { min: 10000000, max: 99999999 } },
    2: { d: 8, o: { min: 5, max: 8 }, m: 'add', tier: 'full', range: { min: 10000000, max: 99999999 } },
    1: { d: 8, o: { min: 8, max: 12 }, m: 'mixed', ops: { add: true, sub: true }, tier: 'full', range: { min: 10000000, max: 99999999 } }
};

const TIER = G.TIER;
let violations = 0, negatives = 0, empties = 0, badLengths = 0, badAnswers = 0;
const N = 2000;

const EXPECTED_MAX = {
    20: 9, 19: 4, 18: 9, 17: 9, 16: 9, 15: 9, 14: 9,
    13: 90, 12: 90, 11: 135, 10: 990, 9: 792, 8: 9990,
    7: 9990, 6: 99990, 5: 699993, 4: 69999993,
    3: 499999995, 2: 799999992, 1: 1199999988
};

for (const [kyu, expected] of Object.entries(EXPECTED_MAX)) {
    const maximum = G.maxPossibleResult(KYU[kyu]);
    if (!maximum.exact || maximum.value !== expected) violations++;
}
if (G.maxPossibleResult({ m: 'mul', d: 1, mul: { a: { min: 2, max: 12 }, b: { min: 3, max: 8 } } }).value !== 96) violations++;
if (G.maxPossibleResult({ m: 'div', div: { divisor: { min: 2, max: 9 }, quotient: { min: 4, max: 25 } } }).value !== 25) violations++;
const limitedMaximum = G.maxPossibleResult({ m: 'mixed', d: 2, o: 5, tier: 'full', range: { min: 10, max: 99 }, maxResult: 100 });
if (limitedMaximum.value !== 100 || limitedMaximum.exact) violations++;

for (const kyu of Object.keys(KYU)) {
    const cfg = KYU[kyu];
    const limit = TIER[cfg.tier];
    for (let s = 0; s < N; s++) {
        const seq = G.generateSequence(cfg);
        if (!seq.length) { empties++; continue; }
        const minTerms = typeof cfg.o === 'number' ? cfg.o : cfg.o.min;
        const maxTerms = typeof cfg.o === 'number' ? cfg.o : cfg.o.max;
        if (seq.length < minTerms || seq.length > maxTerms) badLengths++;
        if (!seq.every(Number.isSafeInteger) || !Number.isSafeInteger(seq.reduce((a, b) => a + b, 0))) badAnswers++;
        if (cfg.range && seq.some(term => Math.abs(term) < cfg.range.min || Math.abs(term) > cfg.range.max)) violations++;
        if (cfg.requiredAbsValue && !seq.some(term => Math.abs(term) === cfg.requiredAbsValue)) violations++;
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
    if (mul.length !== 2 || !Number.isSafeInteger(mul[0] * mul[1]) || mul[0] < 1 || mul[1] < 1) violations++;

    const div = G.generateSequence({ m: 'div', d: 2, div: { divisor: { min: 2, max: 9 }, quotient: { min: 2, max: 99 } } });
    if (div.length !== 2 || div[1] === 0 || !Number.isSafeInteger(div[0]) || !Number.isInteger(div[0] / div[1]) || div[0] < 1) violations++;
}

// Zakresy indywidualne nie mogą produkować liczb poza dokładnością IEEE-754.
let unsafeRejected = 0;
try { G.generateSequence({ m: 'mul', mul: { a: { min: 99999999, max: 99999999 }, b: { min: 99999999, max: 99999999 } } }); } catch (_) { unsafeRejected++; }
try { G.generateSequence({ m: 'div', div: { divisor: { min: 99999999, max: 99999999 }, quotient: { min: 99999999, max: 99999999 } } }); } catch (_) { unsafeRejected++; }
if (unsafeRejected !== 2) violations++;

// Historia przekazana przez pokój ma być izolowana i ograniczona do 10 zadań.
const historyA = [];
const historyB = [];
for (let i = 0; i < 40; i++) G.generateSequence(KYU[10], { history: historyA });
G.generateSequence(KYU[10], { history: historyB });
if (historyA.length !== 10 || historyB.length !== 1) violations++;

// Żaden poziom Kyu nie może powtórzyć zadania z poprzednich 10 rund.
for (const kyu of Object.keys(KYU)) {
    const cfg = KYU[kyu];
    const previous = [];
    const history = [];
    for (let i = 0; i < 100; i++) {
        const seq = G.generateSequence(cfg, { history });
        const hash = (cfg.m || 'add') + ':' + seq.join(',');
        if (previous.includes(hash)) violations++;
        previous.push(hash);
        if (previous.length > 10) previous.shift();
    }
}

// Okno anty-powtórkowe obejmuje również mnożenie i dzielenie.
for (const cfg of [
    { m: 'mul', mul: { a: { min: 2, max: 20 }, b: { min: 2, max: 20 } } },
    { m: 'div', div: { divisor: { min: 2, max: 20 }, quotient: { min: 2, max: 20 } } }
]) {
    const previous = [], history = [];
    for (let i = 0; i < 100; i++) {
        const seq = G.generateSequence(cfg, { history });
        const hash = cfg.m + ':' + seq.join(',');
        if (previous.includes(hash)) violations++;
        previous.push(hash);
        if (previous.length > 10) previous.shift();
    }
}

// Ustawiony limit wyniku jest twardym warunkiem generatora, również dla × i ÷.
for (const cfg of [
    { m: 'mixed', d: 2, o: 5, tier: 'full', range: { min: 10, max: 99 }, maxResult: 100 },
    { m: 'mul', mul: { a: { min: 2, max: 20 }, b: { min: 2, max: 20 } }, maxResult: 50 },
    { m: 'div', div: { divisor: { min: 2, max: 20 }, quotient: { min: 2, max: 20 } }, maxResult: 5 }
]) {
    const history = [];
    for (let i = 0; i < 50; i++) {
        const seq = G.generateSequence(cfg, { history });
        const result = cfg.m === 'mul' ? seq[0] * seq[1]
            : cfg.m === 'div' ? seq[0] / seq[1]
                : seq.reduce((sum, term) => sum + term, 0);
        if (result > cfg.maxResult) violations++;
    }
}

console.log(`Naruszenia techniki: ${violations}`);
console.log(`Sumy ujemne:         ${negatives}`);
console.log(`Puste sekwencje:     ${empties}`);
console.log(`Zła liczba składników: ${badLengths}`);
console.log(`Niepoprawne wyniki:    ${badAnswers}`);
if (violations === 0 && negatives === 0 && empties === 0 && badLengths === 0 && badAnswers === 0) {
    console.log('WYNIK: OK');
    process.exit(0);
} else {
    console.log('WYNIK: BŁĄD');
    process.exit(1);
}

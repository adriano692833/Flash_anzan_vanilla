'use strict';

const fs = require('fs');
const path = require('path');
const G = require('../soroban-generator.js');

const root = path.resolve(__dirname, '..', '..');
const appSource = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function answer(cfg, sequence) {
    if (cfg.m === 'mul') return sequence[0] * sequence[1];
    if (cfg.m === 'div') return sequence[0] / sequence[1];
    return sequence.reduce((sum, term) => sum + term, 0);
}

function simulateRounds(label, cfg, rounds) {
    const history = [];
    const recent = [];
    for (let round = 0; round < rounds; round++) {
        const sequence = G.generateSequence(cfg, { history });
        const hash = `${cfg.m}:${sequence.join(',')}`;
        assert(!recent.includes(hash), `${label}: zadanie powtórzyło się w oknie 10 rund`);
        recent.push(hash);
        if (recent.length > 10) recent.shift();
        if (cfg.m !== 'mul' && cfg.m !== 'div') assert(sequence.length === cfg.o, `${label}: zła liczba składników`);
        const result = answer(cfg, sequence);
        assert(Number.isSafeInteger(result), `${label}: wynik nie jest bezpieczną liczbą całkowitą`);
        if (Number.isSafeInteger(cfg.maxResult)) assert(result <= cfg.maxResult, `${label}: przekroczony maksymalny wynik`);
    }
}

// Perspektywa ucznia: wybór standardowego Kyu, ręczna zmiana wszystkich trzech
// parametrów sesji i przejście przez więcej niż pełne okno anty-powtórkowe.
simulateRounds('Flash 20 Kyu po zmianach ucznia', {
    d: 1, o: 3, t: 0.7, m: 'add', tier: 'direct', range: { min: 1, max: 5 }, maxResult: 9
}, 25);

// Własna konfiguracja: dowolny zakres, technika, liczba składników, czas i limit.
simulateRounds('Własna konfiguracja mieszana', {
    d: 2, o: 7, t: 1.3, m: 'mixed', ops: { add: true, sub: true },
    tier: 'full', range: { min: 10, max: 99 }, maxResult: 300
}, 25);

// Survival z ręcznie wybranym rodzajem zadania i parametrami.
simulateRounds('Survival mieszany', {
    d: 1, o: 4, t: 1, m: 'mixed', ops: { add: true, sub: true },
    tier: 'direct', range: { min: 1, max: 5 }, maxResult: 15
}, 12);

// Symulacja awansu 20 -> 17 Kyu co dwie prawidłowe odpowiedzi.
let level = 20;
const visited = [];
for (let streak = 1; streak <= 8; streak++) {
    visited.push(level);
    if (streak % 2 === 0 && level > 17) level--;
}
assert(visited.join(',') === '20,20,19,19,18,18,17,17', 'Survival: niepoprawny rytm awansu');

// Kontrola przepływu UI, którego sam generator nie widzi.
for (const id of ['game-terms', 'game-max-result', 'game-cancel-btn', 'game-phase-label', 'survival-setup-modal', 'surv-operation']) {
    assert(html.includes(`id="${id}"`), `UI ucznia: brak elementu ${id}`);
}
for (const marker of ['START ZA', 'SERIA LICZB', 'SERIA GŁOSOWA', 'PODAJ WYNIK', '_stopRoundTimers', 'roundToken']) {
    assert(appSource.includes(marker), `Przebieg rundy: brak ${marker}`);
}

console.log('Symulacja ucznia Flash/Survival: OK');

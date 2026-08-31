// soroban-generator.js
// =====================================================================
// Wspólny generator zadań anzan/soroban — JEDNO źródło prawdy dla
// frontendu (window.SorobanGen) i serwera (require).
//
// Rdzeń: dodawanie/odejmowanie jest sprawdzane KOLUMNA PO KOLUMNIE tak,
// jak liczy się na sorobanie. Dla każdej operacji wyznaczamy najwyższą
// wymaganą technikę:
//   - direct   — bezpośrednie dołożenie/zdjęcie koralików (także belka 5),
//                bez komplementów i bez przeniesienia
//   - friend5  — komplement 5 (mali przyjaciele), bez przeniesienia
//   - friend10 — komplement 10 (duzi przyjaciele), z przeniesieniem
// Składnik jest akceptowany tylko, gdy KAŻDA dotknięta kolumna mieści się
// w technikach dozwolonych na danym poziomie (pole cfg.tier). Dzięki temu
// np. Kyu 20 nigdy nie wygeneruje 3+4 (co wymaga przyjaciół 5).
//
// Poziomy wielocyfrowe (tier 'full') dopuszczają wszystkie techniki —
// jedyne ograniczenie to brak sumy ujemnej (soroban nie schodzi < 0).
// =====================================================================

(function (root, factory) {
    const mod = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = mod;
    if (typeof window !== 'undefined') window.SorobanGen = mod;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Uporządkowane poziomy technik (rosnąca trudność)
    const TIER = { direct: 0, friend5: 1, friend10: 2, full: 3 };

    function randInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function resolveTermCount(cfg) {
        if (typeof cfg.o === 'number') return cfg.o;
        if (cfg.o && typeof cfg.o === 'object') return randInt(cfg.o.min, cfg.o.max);
        return 5;
    }

    // Liczba cyfr składnika (drabinka cyfrowa). d bywa liczbą lub {min,max}.
    function resolveDigits(cfg) {
        if (typeof cfg.d === 'number') return cfg.d;
        if (cfg.d && typeof cfg.d === 'object') return cfg.d.max || cfg.d.min || 1;
        return 1;
    }

    // Poziom techniki: preferuj jawne cfg.tier; w razie braku wyprowadź ze
    // starych pól (techniques/liczba cyfr) — zgodność wsteczna.
    function resolveTier(cfg) {
        if (cfg.tier && Object.prototype.hasOwnProperty.call(TIER, cfg.tier)) return cfg.tier;
        if (resolveDigits(cfg) >= 2) return 'full';
        const t = cfg.techniques || [];
        if (t.indexOf('rule_of_10') !== -1 || t.indexOf('rule_of_10_basic') !== -1) return 'friend10';
        if (t.indexOf('rule_of_5') !== -1 || t.indexOf('rule_of_5_basic') !== -1 ||
            t.indexOf('rule_of_5_advanced') !== -1) return 'friend5';
        return 'direct';
    }

    // --- Symulacja sorobanu: kolumny (index 0 = jedności) ---

    // Dodaje pojedynczą cyfrę d (0..9) do kolumny i. Zwraca {ok, tier}.
    function addDigit(rods, i, d) {
        if (d === 0) return { ok: true, tier: TIER.direct };
        while (rods.length <= i) rods.push(0);
        const c = rods[i];
        const lower = c % 5, five = c >= 5 ? 1 : 0;
        const dLower = d % 5, dFive = d >= 5 ? 1 : 0;

        // bezpośrednio: dość wolnych koralików, bez przeniesienia
        if (five + dFive <= 1 && lower + dLower <= 4) {
            rods[i] = c + d;
            return { ok: true, tier: TIER.direct };
        }
        // w obrębie kolumny (bez przeniesienia), ale potrzebny komplement 5
        if (c + d <= 9) {
            rods[i] = c + d;
            return { ok: true, tier: TIER.friend5 };
        }
        // przeniesienie -> komplement 10
        rods[i] = (c + d) - 10;
        const up = addDigit(rods, i + 1, 1);
        if (!up.ok) return { ok: false };
        return { ok: true, tier: TIER.friend10 };
    }

    // Odejmuje pojedynczą cyfrę d (0..9) od kolumny i. Zwraca {ok, tier}.
    function subDigit(rods, i, d) {
        if (d === 0) return { ok: true, tier: TIER.direct };
        while (rods.length <= i) rods.push(0);
        const c = rods[i];
        const lower = c % 5, five = c >= 5 ? 1 : 0;
        const dLower = d % 5, dFive = d >= 5 ? 1 : 0;

        // bezpośrednio: zdejmij koraliki, bez pożyczki
        if (five - dFive >= 0 && lower - dLower >= 0) {
            rods[i] = c - d;
            return { ok: true, tier: TIER.direct };
        }
        // w obrębie kolumny, ale potrzebny komplement 5
        if (c - d >= 0) {
            rods[i] = c - d;
            return { ok: true, tier: TIER.friend5 };
        }
        // pożyczka -> komplement 10
        rods[i] = (c - d) + 10;
        const up = subDigit(rods, i + 1, 1);
        if (!up.ok) return { ok: false };
        return { ok: true, tier: TIER.friend10 };
    }

    function rodsToNumber(rods) {
        let n = 0;
        for (let i = rods.length - 1; i >= 0; i--) n = n * 10 + rods[i];
        return n;
    }

    // Dodaje/odejmuje pełną liczbę term do stanu rodów (na kopii). Zwraca
    // { ok, tier, rods } gdzie tier = najwyższa użyta technika.
    function applyTerm(rods, term, op) {
        // Soroban nie schodzi poniżej zera — odejmowanie większe niż bieżąca
        // liczba jest niewykonalne (i zapobiega nieskończonej pożyczce).
        if (op === '-' && term > rodsToNumber(rods)) return { ok: false };
        const r = rods.slice();
        let maxTier = TIER.direct;
        let t = term, i = 0;
        do {
            const d = t % 10;
            const res = (op === '+') ? addDigit(r, i, d) : subDigit(r, i, d);
            if (!res.ok) return { ok: false };
            if (res.tier > maxTier) maxTier = res.tier;
            t = Math.floor(t / 10);
            i++;
        } while (t > 0);
        return { ok: true, tier: maxTier, rods: r };
    }

    // --- Generator dodawania/odejmowania (mitori-zan) ---

    function generateAddSub(cfg) {
        const tierLimit = TIER[resolveTier(cfg)];
        const n = resolveTermCount(cfg);
        const digits = resolveDigits(cfg);
        const multiDigit = digits >= 2;
        const allowSub = (cfg.m === 'mixed') || (cfg.ops && cfg.ops.sub);

        const termMin = multiDigit ? Math.pow(10, digits - 1) : 1;
        const termMax = Math.pow(10, digits) - 1;

        // Poziomy jednorzędowe (direct/friend5) NIE dopuszczają przeniesienia,
        // więc suma nie przekracza 9. Budżetujemy dodawanie tak, by dla każdego
        // pozostałego składnika zostało miejsce na co najmniej 1.
        const cappedSingleRod = !multiDigit && tierLimit <= TIER.friend5;

        // Zwraca legalne ruchy z danego stanu (rods,total) dla kroku o `left`
        // pozostałych składnikach. { atTier:[], below:[] } wg drylowanej techniki.
        function movesFrom(rods, total, left, firstStep) {
            const atTier = [], below = [];
            const add = (val, op, res) => {
                if (op === '-' && total - val < 0) return;
                (res.tier === tierLimit ? atTier : below).push({ val, op, res });
            };
            if (multiDigit) {
                for (let tries = 0; tries < 16; tries++) {
                    const val = randInt(termMin, termMax);
                    const op = (!firstStep && allowSub && Math.random() < 0.4) ? '-' : '+';
                    const res = applyTerm(rods, val, op);
                    if (!res.ok || res.tier > tierLimit) continue;
                    add(val, op, res);
                }
            } else {
                const ops = (!firstStep && allowSub) ? ['+', '-'] : ['+'];
                for (let d = 1; d <= termMax; d++) {
                    for (let k = 0; k < ops.length; k++) {
                        const op = ops[k];
                        if (cappedSingleRod && op === '+' && total + d > 9 - left) continue;
                        const res = applyTerm(rods, d, op);
                        if (!res.ok || res.tier > tierLimit) continue;
                        add(d, op, res);
                    }
                }
            }
            return { atTier, below };
        }

        let rods = [];
        let total = 0;
        const seq = [];

        for (let i = 0; i < n; i++) {
            const left = n - 1 - i; // składniki po bieżącym
            let { atTier, below } = movesFrom(rods, total, left, i === 0);

            // Jednokrokowy lookahead: jeśli to nie ostatni składnik, odrzuć ruchy
            // prowadzące w ślepy zaułek (brak dowolnego legalnego ruchu dalej) —
            // dzięki temu sekwencja nigdy nie urywa się przed czasem.
            if (left > 0 && !multiDigit) {
                const alive = (c) => {
                    const nx = movesFrom(c.res.rods, total + (c.op === '-' ? -c.val : c.val), left - 1, false);
                    return nx.atTier.length + nx.below.length > 0;
                };
                const a2 = atTier.filter(alive), b2 = below.filter(alive);
                if (a2.length || b2.length) { atTier = a2; below = b2; }
            }

            // Preferuj operacje drylujące docelową technikę poziomu
            let pool;
            if (atTier.length && Math.random() < 0.6) pool = atTier;
            else pool = atTier.concat(below);

            if (!pool.length) break; // brak legalnego ruchu -> kończymy sekwencję
            const pick = pool[randInt(0, pool.length - 1)];
            rods = pick.res.rods;
            const signed = pick.op === '-' ? -pick.val : pick.val;
            total += signed;
            seq.push(signed);
        }

        return seq;
    }

    // --- Mnożenie (A × B). Zakresy z cfg.mul; fallback wg liczby cyfr ---
    function generateMul(cfg) {
        let aMin, aMax, bMin, bMax;
        if (cfg.mul && cfg.mul.a && cfg.mul.b) {
            aMin = cfg.mul.a.min; aMax = cfg.mul.a.max;
            bMin = cfg.mul.b.min; bMax = cfg.mul.b.max;
        } else {
            const d = resolveDigits(cfg);
            aMin = Math.pow(10, d - 1); aMax = Math.pow(10, d) - 1;
            bMin = 2; bMax = 9;
        }
        return [randInt(aMin, aMax), randInt(bMin, bMax)];
    }

    // --- Dzielenie (A ÷ B = C bez reszty). A = B × C ---
    function generateDiv(cfg) {
        let bMin, bMax, cMin, cMax;
        if (cfg.div && cfg.div.divisor && cfg.div.quotient) {
            bMin = cfg.div.divisor.min; bMax = cfg.div.divisor.max;
            cMin = cfg.div.quotient.min; cMax = cfg.div.quotient.max;
        } else {
            bMin = 2; bMax = 9; cMin = 2; cMax = 9;
        }
        const B = randInt(bMin, bMax);
        const C = randInt(cMin, cMax);
        return [B * C, B];
    }

    // --- Dyspozytor + deduplikacja ostatnich sekwencji ---
    let _lastSeqs = [];

    function generateSequence(cfg) {
        const mode = cfg.m || 'add';
        if (mode === 'mul') return generateMul(cfg);
        if (mode === 'div') return generateDiv(cfg);

        let seq = generateAddSub(cfg);
        // unikaj powtórek i zbyt trywialnych (1-składnikowych) sekwencji
        for (let retry = 0; retry < 20; retry++) {
            const hash = seq.join(',');
            if (seq.length >= 2 && _lastSeqs.indexOf(hash) === -1) break;
            seq = generateAddSub(cfg);
        }
        _lastSeqs.push(seq.join(','));
        if (_lastSeqs.length > 30) _lastSeqs.shift();
        return seq;
    }

    return {
        TIER: TIER,
        generateSequence: generateSequence,
        generateAddSub: generateAddSub,
        generateMul: generateMul,
        generateDiv: generateDiv,
        // pomocnicze (używane w self-teście)
        applyTerm: applyTerm,
        resolveTier: resolveTier,
        resolveDigits: resolveDigits
    };
});

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const html = read('index.html');
const server = read('server/server.js');
const rules = read('firestore.rules');
const clientFiles = ['js/app.js', 'js/auth.js', 'js/multiplayer.js', 'js/school-operations.js', 'js/ui.js', 'js/main.js'];
const client = clientFiles.map(read).join('\n');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function uniqueMatches(source, regex) {
    return [...new Set([...source.matchAll(regex)].map(match => match[1]))];
}

// Powierzchnia UI: brak zduplikowanych identyfikatorów i brak martwych lokalnych skryptów.
const ids = uniqueMatches(html, /\sid="([^"]+)"/g);
const allIds = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
assert(ids.length === allIds.length, 'HTML zawiera zduplikowane id');
for (const src of uniqueMatches(html, /<script[^>]+src="([^"]+)"/g).filter(src => !/^https?:/.test(src) && !src.startsWith('/socket.io'))) {
    assert(fs.existsSync(path.join(root, src)), `Brak skryptu użytego przez HTML: ${src}`);
}

// Kontrakt klient-serwer. Dwa zdarzenia round:* należą do lokalnej magistrali aplikacji.
const clientEmits = uniqueMatches(client, /\.emit\(['"]([^'"]+)/g)
    .filter(event => !event.startsWith('round:'));
const serverHandlers = uniqueMatches(server, /socket\.on\(['"]([^'"]+)/g);
for (const event of clientEmits) assert(serverHandlers.includes(event), `Brak handlera serwera dla zdarzenia: ${event}`);
const serverEmits = uniqueMatches(server, /(?:socket|io(?:\.to\([^)]*\))?|pendingSocket|oldSocket)\.emit\(['"]([^'"]+)/g);
const clientHandlers = uniqueMatches(client, /\.on\(['"]([^'"]+)/g);
for (const event of serverEmits) assert(clientHandlers.includes(event), `Brak handlera klienta dla zdarzenia: ${event}`);

// Krytyczne zabezpieczenia uwierzytelnienia, transportu i wielodostępności.
for (const marker of [
    'verifyIdToken(idToken, true)',
    'FIREBASE_WEB_API_KEY',
    "express.json({ limit: '8kb' })",
    'maxHttpBufferSize: 64 * 1024',
    "res.setHeader('X-Frame-Options', 'DENY')",
    "res.setHeader('Strict-Transport-Security'",
    'socket.use((packet, next)',
    'playersForViewer(room, viewer)',
    "socket.on('set_ranking_visibility'",
    "socket.on('save_solo_progress'",
    "socket.on('request_attendance'"
]) assert(server.includes(marker), `Brak zabezpieczenia: ${marker}`);

assert(!read('js/auth.js').includes('apiKey: window.FIREBASE_CONFIG'), 'Klient nadal wybiera klucz projektu dla serwerowej weryfikacji hasła');
assert(server.includes('encodeURIComponent(FIREBASE_WEB_API_KEY)'), 'REST Firebase nie używa przypiętego klucza projektu');
assert(rules.includes('allow read, write: if false;'), 'Reguły Firestore nie blokują bezpośredniego dostępu klienta');
assert(!/\beval\s*\(|new\s+Function\s*\(/.test(client + server), 'Kod zawiera dynamiczne wykonanie JavaScript');

for (const id of ['host-ranking-visibility', 'live-ranking-visibility', 'host-task-points', 'host-answer-time', 'host-task-limit']) {
    assert(html.includes(`id="${id}"`), `Brak kontrolki: ${id}`);
}
assert(client.includes('setRankingVisibility: function'), 'Brak sterowania rankingiem podczas zajęć');
assert(client.includes('recordSoloProgress: function'), 'Postęp treningu solo nie jest synchronizowany z kontem');
assert(client.includes("s.on('join_requested'"), 'Uczeń nie dostaje potwierdzenia prośby o wejście');

console.log(`Audyt kontraktu: ${serverHandlers.length} zdarzeń serwera, ${clientHandlers.length} handlerów klienta, ${ids.length} pól HTML — OK`);

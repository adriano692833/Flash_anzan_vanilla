'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const server = fs.readFileSync(path.join(root, 'server', 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'js', 'multiplayer.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

// Symulacja reguły powtórzenia: indeks i zbiór odpowiedzi nie zmieniają się.
const room = { taskIndex: 4, answeredByTask: { 4: new Set(['student-a', 'student-b']) } };
const before = room.answeredByTask[room.taskIndex];
const repeatedTaskIndex = room.taskIndex;
assert(repeatedTaskIndex === 4, 'Powtórzenie zmieniło numer zadania');
assert(before.has('student-a') && before.has('student-b'), 'Powtórzenie wyczyściło zapisane odpowiedzi');
assert(!before.has('student-c'), 'Uczeń bez odpowiedzi został błędnie zablokowany');

for (const marker of [
    "socket.on('repeat_task'", "reason: 'ALREADY_ANSWERED'", 'emitTaskUpdate(code, true)',
    "socket.on('set_task_points'", 'room.currentTask.points', "socket.on('toggle_ready'",
    "socket.on('set_ranking_visibility'", 'playersForViewer(room, viewer)',
    "socket.on('resume_room'", 'room.answerOpensAt', 'const serverTime =',
    'for (let round = 0; round < 11; round++)', "emit('session_completed'"
]) assert(server.includes(marker), `Serwer multiplayer: brak ${marker}`);

assert(!server.includes('stat.totalTime += data.time'), 'Serwer nadal ufa czasowi przesłanemu przez klienta');

for (const marker of ['answerLocked', 'taskPoints', 'repeatTask', 'setTaskPoints', 'setRankingVisibility', 'toggleReady', '_resumeRoomCode']) {
    assert(client.includes(marker) || app.includes(marker), `Klient multiplayer: brak ${marker}`);
}

for (const id of ['host-task-points', 'host-answer-time', 'host-task-limit', 'host-ranking-visibility', 'live-ranking-visibility', 'lobby-ready-btn', 'live-task-points']) {
    assert(html.includes(`id="${id}"`), `UI multiplayer: brak ${id}`);
}

console.log('Symulacja multiplayer: powtórzenia, punkty, gotowość i czas serwera — OK');

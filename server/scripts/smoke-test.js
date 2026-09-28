'use strict';

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const port = 18080;
const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
});

let stderr = '';
let stdout = '';
let done = false;
child.stderr.on('data', chunk => { stderr += chunk; });
child.stdout.on('data', chunk => { stdout += chunk; });

function finish(code, message) {
    if (done) return;
    done = true;
    if (!child.killed) child.kill();
    if (message) (code ? console.error : console.log)(message);
    if (code && stdout.trim()) console.error(stdout.trim());
    if (stderr.trim()) console.error(stderr.trim());
    process.exitCode = code;
}

const timeout = setTimeout(() => finish(1, 'Smoke test: timeout uruchomienia serwera.'), 15000);
function get(pathname) {
    return new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}${pathname}`, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => resolve({ status: response.statusCode, body, headers: response.headers }));
        }).on('error', reject);
    });
}

function postJson(pathname, payload) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(payload);
        const request = http.request(`http://127.0.0.1:${port}${pathname}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, response => {
            let responseBody = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { responseBody += chunk; });
            response.on('end', () => resolve({ status: response.statusCode, body: responseBody }));
        });
        request.on('error', reject);
        request.end(body);
    });
}

async function verify() {
    try {
        const [home, health, manifest, aliasMalformed, oversized] = await Promise.all([
            get('/'), get('/health'), get('/manifest.webmanifest'),
            postJson('/api/auth/username', { username: 'x', password: 'x' }),
            postJson('/api/auth/username', { username: 'testuser', password: 'x'.repeat(9000) })
        ]);
        clearTimeout(timeout);
        const healthData = JSON.parse(health.body);
        const manifestData = JSON.parse(manifest.body);
        const ok = home.status === 200 && home.body.includes('Flash Anzan')
            && home.body.includes('Jednorazowy kod zaproszenia')
            && home.body.includes('Panel właściciela szkoły')
            && home.body.includes('Plan, zadania i organizacja')
            && health.status === 200 && healthData.status === 'ok'
            && aliasMalformed.status === 400
            && oversized.status === 413
            && home.headers['x-content-type-options'] === 'nosniff'
            && home.headers['x-frame-options'] === 'DENY'
            && home.headers['referrer-policy'] === 'same-origin'
            && home.headers['permissions-policy'] === 'camera=(), geolocation=(), microphone=()'
            && manifest.status === 200 && manifestData.short_name === 'Flash Anzan';
        finish(ok ? 0 : 1, ok ? 'Smoke test HTTP/PWA: OK' : 'Smoke test HTTP/PWA: niepełna odpowiedź aplikacji.');
    } catch (error) {
        if (!done) setTimeout(verify, 500);
    }
}

setTimeout(verify, 500);

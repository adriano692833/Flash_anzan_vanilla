'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const server = path.resolve(__dirname, '..');
const checkOnly = process.argv.includes('--check');
const files = [
    'index.html',
    'manifest.webmanifest',
    'service-worker.js',
    'icons/anzan-pro.svg',
    'css/app.css',
    'css/mobile.css',
    'js/app.js',
    'js/ui.js',
    'js/auth.js',
    'js/multiplayer.js',
    'js/main.js',
    'js/config.js',
    'js/firebase-config.js',
    'js/soroban-generator.js'
];

let differences = 0;
for (const relative of files) {
    const source = path.join(root, relative);
    const target = path.join(server, 'public', relative);
    const sourceData = fs.readFileSync(source);
    const targetData = fs.existsSync(target) ? fs.readFileSync(target) : null;
    if (!targetData || !sourceData.equals(targetData)) {
        differences++;
        if (!checkOnly) {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.copyFileSync(source, target);
            console.log(`sync: ${relative}`);
        } else {
            console.error(`out of sync: ${relative}`);
        }
    }
}

const generatorSource = path.join(root, 'js', 'soroban-generator.js');
const generatorTarget = path.join(server, 'soroban-generator.js');
const generatorData = fs.readFileSync(generatorSource);
const serverGeneratorData = fs.existsSync(generatorTarget) ? fs.readFileSync(generatorTarget) : null;
if (!serverGeneratorData || !generatorData.equals(serverGeneratorData)) {
    differences++;
    if (!checkOnly) {
        fs.copyFileSync(generatorSource, generatorTarget);
        console.log('sync: server/soroban-generator.js');
    } else {
        console.error('out of sync: server/soroban-generator.js');
    }
}

if (checkOnly && differences) process.exit(1);
console.log(checkOnly ? 'Synchronizacja: OK' : `Synchronizacja zakończona (${differences} zmian).`);

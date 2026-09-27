'use strict';

const { initializeApp, getApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const app = getApps().length ? getApp() : initializeApp();
const auth = getAuth(app);

for (const method of ['verifyIdToken', 'updateUser', 'revokeRefreshTokens', 'getUser', 'createCustomToken']) {
    if (typeof auth[method] !== 'function') {
        throw new Error(`Firebase Admin Auth: brak metody ${method}`);
    }
}

console.log('Firebase Admin Auth API: OK');

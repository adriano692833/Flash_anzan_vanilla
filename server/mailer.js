'use strict';

const nodemailer = require('nodemailer');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

let transporterPromise = null;

function cleanHeader(value, fallback = '') {
    return String(value || fallback).replace(/[\r\n\0]/g, ' ').trim().slice(0, 160);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function mailConfigured() {
    return Boolean(process.env.SMTP_USER && (process.env.SMTP_PASS || process.env.SMTP_PASSWORD_SECRET));
}

async function smtpPassword() {
    if (process.env.SMTP_PASS) return String(process.env.SMTP_PASS);
    const configuredName = String(process.env.SMTP_PASSWORD_SECRET || '').trim();
    if (!configuredName) return '';
    const projectId = String(process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '').trim();
    if (!projectId && !configuredName.startsWith('projects/')) throw new Error('SMTP_SECRET_PROJECT_MISSING');
    const name = configuredName.startsWith('projects/')
        ? configuredName
        : `projects/${projectId}/secrets/${configuredName}/versions/latest`;
    const client = new SecretManagerServiceClient();
    const [version] = await client.accessSecretVersion({ name });
    const value = version.payload && version.payload.data ? version.payload.data.toString('utf8').trim() : '';
    if (!value) throw new Error('SMTP_SECRET_EMPTY');
    return value;
}

async function transporter() {
    if (!transporterPromise) {
        transporterPromise = (async () => {
            if (!mailConfigured()) return null;
            const port = Math.max(1, Math.min(65535, Number.parseInt(process.env.SMTP_PORT || '465', 10) || 465));
            return nodemailer.createTransport({
                host: cleanHeader(process.env.SMTP_HOST, 'smtp.gmail.com'),
                port,
                secure: String(process.env.SMTP_SECURE || (port === 465 ? 'true' : 'false')).toLowerCase() === 'true',
                auth: { user: cleanHeader(process.env.SMTP_USER), pass: await smtpPassword() },
                connectionTimeout: 10000,
                greetingTimeout: 10000,
                socketTimeout: 15000,
                disableFileAccess: true,
                disableUrlAccess: true,
                tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true }
            });
        })();
    }
    return transporterPromise;
}

async function sendInvitationEmail({ to, roleLabel, schoolName, inviterName, expiresAt, registrationLink }) {
    const transport = await transporter();
    if (!transport) return { status: 'not_configured' };
    const recipient = cleanHeader(to).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error('INVALID_RECIPIENT');
    const sender = cleanHeader(process.env.MAIL_FROM || process.env.SMTP_USER);
    const replyTo = cleanHeader(process.env.MAIL_REPLY_TO || process.env.SMTP_USER);
    const school = cleanHeader(schoolName, 'Twoja szkoła');
    const inviter = cleanHeader(inviterName, 'administrator szkoły');
    const role = cleanHeader(roleLabel, 'użytkownik');
    const expiry = new Date(expiresAt).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });
    const link = String(registrationLink || '');
    if (!/^https:\/\//.test(link)) throw new Error('INVALID_REGISTRATION_LINK');

    const info = await transport.sendMail({
        from: { name: 'Flash Anzan', address: sender }, replyTo, to: recipient,
        subject: `Zaproszenie do ${school} w Flash Anzan`,
        text: `Dzień dobry,\n\n${inviter} zaprasza Cię do szkoły „${school}” w platformie Flash Anzan jako: ${role}.\n\nZałóż konto: ${link}\n\nLink jest jednorazowy i ważny do ${expiry}. Jeśli nie oczekujesz tej wiadomości, zignoruj ją.\n\nFlash Anzan`,
        html: `<div style="font-family:Arial,sans-serif;max-width:620px;color:#142033"><div style="border-top:5px solid #e75a42;padding:28px;border-right:1px solid #ccd5df;border-bottom:1px solid #ccd5df;border-left:1px solid #ccd5df"><p style="font-size:12px;letter-spacing:1.5px;color:#c84432;font-weight:700">FLASH ANZAN · ZAPROSZENIE</p><h1 style="font-size:26px;margin:12px 0">Dołącz do ${escapeHtml(school)}</h1><p>${escapeHtml(inviter)} zaprasza Cię do platformy jako: <strong>${escapeHtml(role)}</strong>.</p><p style="margin:28px 0"><a href="${escapeHtml(link)}" style="background:#e75a42;color:#fff;text-decoration:none;padding:14px 22px;display:inline-block;font-weight:700">Załóż konto</a></p><p style="font-size:13px;color:#526273">Link jest jednorazowy i ważny do ${escapeHtml(expiry)}. Jeśli nie oczekujesz tej wiadomości, zignoruj ją.</p></div></div>`,
        disableFileAccess: true, disableUrlAccess: true
    });
    return { status: 'sent', messageId: cleanHeader(info.messageId).slice(0, 200) };
}

module.exports = { mailConfigured, sendInvitationEmail };

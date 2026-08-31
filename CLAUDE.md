# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**Backend (server):**
```bash
cd server
npm install
npm start        # runs on localhost:8080 (or $PORT)
npm test         # runs the soroban generator self-test (technique/negative-sum checks)
```

**Frontend:**
Open `index.html` directly in a browser — no build step, no bundler.

**Local multiplayer testing:**
`SOCKET_URL` is derived in one place — `js/config.js` (`window.ANZAN_SOCKET_URL`). It auto-selects
`http://localhost:8080` on localhost/127.0.0.1 and the App Engine URL otherwise, so local testing
usually needs **no edits**. To force an environment, edit `js/config.js` only.

**Deploy backend to Google App Engine:**
```bash
gcloud auth login
gcloud config set project <project-id>
cd server && gcloud app deploy
```

**Deploy Firestore security rules** (required — see `firestore.rules`):
```bash
firebase deploy --only firestore:rules   # or paste rules in Firebase Console → Firestore → Rules
```

**Deploy frontend to Vercel:**
Push to GitHub and Vercel auto-deploys, or run `vercel` CLI in the project root.

> NOTE: In practice the app is served from App Engine out of `server/public/`, which is a **manual
> mirror** of the root frontend files. After editing any root frontend file, copy it into
> `server/public/`. The shared generator `js/soroban-generator.js` must ALSO be copied to
> `server/soroban-generator.js` (the server `require`s it).

## Prerequisites (one-time, outside code)

- **Firebase Authentication** must be enabled in the Firebase project that owns Firestore `anzan-db`:
  Console → Authentication → **Email/Password**. Create a Web app and paste `apiKey`/`authDomain`/
  `projectId` into `js/firebase-config.js` (apiKey is public/safe in the frontend).
- **Teacher access code**: set env var `TEACHER_ACCESS_CODE` on App Engine (default `ANZAN-TEACHER`).
  Registering with the teacher role requires this code (server-gated).

## Architecture

### Frontend — vanilla JS, no bundler (loaded via `<script>` in `index.html`, order matters)
| File | Role |
|------|------|
| `js/firebase-config.js` | Firebase web config placeholder (fill in from console) |
| `js/config.js` | Single source of `SOCKET_URL` (`window.ANZAN_SOCKET_URL`) |
| `js/soroban-generator.js` | **Shared UMD** task generator (technique-aware) — also used by the server |
| `js/app.js` | Core game logic: `DEFAULT_KYU` configs, mode adapters, state machine, PDF |
| `js/ui.js` | Toast notifications, modal dialogs, result screen |
| `js/auth.js` | Firebase Authentication (login/register, ID token, login-screen toggle) |
| `js/multiplayer.js` | Socket.IO client, lobby, teacher/student panels, classes, leaderboards |
| `js/main.js` | Bootstrap: `app.init()` then `app.auth.init()` |
| `css/app.css`, `css/mobile.css` | Design tokens (glassmorphism) + responsive overrides |

### Backend — Node.js/Express + Socket.IO (`server/`)
| File | Role |
|------|------|
| `server.js` | Express + Socket.IO, auth verification, room/class management, task generation, scoring |
| `firestore.js` | Firestore helpers: users, classes + members, rooms, leaderboards |
| `soroban-generator.js` | Copy of the shared generator (`require`d by `server.js`) |
| `soroban-generator.selftest.js` | `npm test` — asserts every generated step respects the level's technique |
| `app.yaml` | App Engine config (**runtime nodejs22, F2, max_instances=1**) |
| `firestore.rules` | (repo root) Denies all direct client DB access — everything goes through the server |

### Database — Google Firestore (`anzan-db`)
- `users/{uid}` — `name`, `avatar`, `role` ('teacher'|'student'), `totalXp` (global all-time), `createdAt`.
  **`uid` is the Firebase Auth uid** (persistent), not the socket id.
- `classes/{classId}` — `name`, `teacherUid`, `teacherName`, `schoolYear`, `joinCode`, `active`, `createdAt`.
- `classes/{classId}/members/{uid}` — `name`, `points` (this class/year), `joinedAt`, `lastActive`.
- `rooms/{code}` — ephemeral room snapshot; deleted on room close.

### Authentication & identity
- Frontend uses **Firebase Auth (Email/Password)**. Students self-register "by username" — the
  username is mapped to a synthetic email (`<username>@<ANZAN_USER_EMAIL_DOMAIN>`, see
  `js/firebase-config.js`). Teachers additionally supply the teacher access code.
- On Socket.IO `register`, the client sends the Firebase **ID token**; the server verifies it with
  `firebase-admin` (App Engine default service account, no secrets) and sets `socket.uid` — the
  authoritative identity for all scoring/leaderboards. The persisted `role` (Firestore) wins; a
  teacher never gets downgraded.
- Password recovery for username accounts: a teacher resets a class member's password server-side
  (`reset_member_password` → `admin.auth().updateUser`), returning a temporary password to hand over.

### Multiplayer data flow
1. User logs in (Firebase) → client connects Socket.IO → `register {idToken,...}` → server verifies, sets `socket.uid`/role.
2. Teacher creates a **class** (join code) once; students join the class by code (or are auto-enrolled on room approval).
3. Teacher creates a **room linked to a class** → students `request_join` → teacher approves (approval gate).
4. Host starts game → server generates task from Kyu config (incl. display speed `t`) → broadcasts to the room.
5. Player submits → server validates → points scaled by difficulty (`pointsForConfig`) → written to
   BOTH `classes/{id}/members/{uid}.points` (class/year ranking) and `users/{uid}.totalXp` (global). Solo modes do NOT affect rankings.
6. Rankings delivered over Socket.IO (`request_class_leaderboard` / `request_global_leaderboard`); client never reads Firestore directly.

## Key Design Details

- **Kyu system**: 20 levels in `DEFAULT_KYU` (`js/app.js`). Kyu 20 = easiest, Kyu 1 = hardest. Each
  level has a `tier` field driving the generator: `direct` → `friend5` → `friend10` → `full`.
- **Technique-aware generator** (`js/soroban-generator.js`): add/sub sequences are validated **per
  soroban column** so a level only produces operations solvable with the techniques it has unlocked
  (e.g. Kyu 20 never emits `3+4`, which needs the "friends of 5"). Single-rod tiers (direct/friend5)
  keep the sum ≤ 9 (no carry). Multiplication/division are separate (`generateMul`/`generateDiv`).
  `generateSequence(cfg, {history})` accepts a per-room dedup history so concurrent classes don't share state.
- **Bump `KYU_VERSION`** (`js/app.js`) whenever `DEFAULT_KYU` changes, so existing users' localStorage
  ladder migrates (XP/history preserved). Currently 4.
- **`APP_VERSION`** (`js/app.js`) also appears in the sidebar footer and PDF; keep them in sync.
- **Task generation is server-side** for multiplayer; the client cannot influence difficulty.
  Config is whitelisted/clamped in `validateConfig` (`server.js`), including `tier`.
- **Concurrency**: rooms are isolated by design (per-`rooms[code]` state, `io.to(code)` broadcasts,
  scoring routed to `room.classId`). Multiple teachers running simultaneous classes do not interfere.
  All room state is in-memory → `app.yaml` must stay `max_instances: 1` (no shared store yet).
- **Game modes**: Flash (visual), Voice (Web Speech API — falls back with a warning if no `pl` voice),
  Worksheet (jsPDF export), Multiplayer (Socket.IO), Survival (rapid-fire to first mistake).
- **No .env / secrets in repo** — App Engine service account covers Firestore and `firebase-admin`.
  `TEACHER_ACCESS_CODE` is the only env knob.

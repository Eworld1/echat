# Echat — Connect, Share & Chat

Real-time social app: feed, 24h stories, one-to-one chat, voice/video calls (WebRTC),
Pages, Groups, Events, Settings & Privacy, and a developer admin dashboard.

**Stack:** Vite + React 19 + TypeScript + Tailwind 4 · Express · `ws` WebSocket server
(chat, presence, call signaling) · JSON-file database (`data/echat_db.json`) · Firebase client.

## Requirements

- Node.js 22.12+ (Node 24 recommended)
- npm 10+

## Quick start

```bash
npm install --legacy-peer-deps
cp .env.example .env        # then fill in your Firebase values
npm run dev
```

`npm run dev` prints `[Echat] Server on 3000` and `[vite] Local: http://localhost:5173/`.
Open http://localhost:5173 (or :3000 — both serve the app).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Express + Vite dev middleware (hot reload) |
| `npm run build` | Production frontend build into `dist/` |
| `npm start` | Production server: serves `dist/` + API + WebSocket + uploads |
| `npm run preview` | Preview the built frontend only |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

## Environment variables

See `.env.example`. Key ones:

- `PORT` — server port (default `3000`)
- `CORS_ORIGIN` — allowed browser origins, comma-separated (default `*`)
- `VITE_API_URL` — backend base URL; empty = same origin
- `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` — optional TURN relay for calls
- `VITE_FIREBASE_*` — Firebase client config

## Project structure

```
server.ts            Express app: REST API, CORS, uploads, static dist, WebSocket attach
server/              db.ts (JSON DB), socket.ts (WebSocket + call signaling), types.ts
src/components/      UI components (CallModal, PostCard, ProfileView, ...)
src/pages/           Pages, Groups, Events, Settings, HomePage
src/context/         AuthContext, SocketContext (WebSocket + WebRTC)
src/hooks/           Custom hooks
src/services/        api.ts (REST client), apiBase.ts (URLs), db.ts, firebase.ts
data/                JSON database + data/uploads (git-ignored, created at runtime)
```

## Features

- **Social:** feed with photo/video posts, tag friends, edit and delete your own posts, reactions, comments,
  share to your timeline or to WhatsApp / Facebook / X / Telegram / LinkedIn / email, saved posts, hashtags and
  trending topics, 24h stories, Go Live, post privacy (Public / Friends / Only me), blocking.
- **Chat and calls:** one-to-one chat with online status and read receipts, voice and video calls between any
  users (respecting "Who can call me"), live message and missed-call notifications with a Call back button.
- **Pages, Groups, Events:** create them with a profile picture and cover photo chosen from your gallery;
  owners can change the photos later.
- **Appearance and language:** light, dark or follow-the-device theme and six languages (English, Krio, French,
  Spanish, Arabic, German), applied instantly and remembered.
- **Install it:** works as an installable app (PWA) on Android, iPhone/iPad, Windows, Mac and Linux.
- **Admin console:** live overview with charts and system health, user management (search, filters, bulk block,
  verify, delete, CSV export), moderation queue, announcements to everyone, and an activity log of every admin action.

## Installing the app on a device

Open the site, then:
- **Android / Windows / Mac / Linux (Chrome, Edge, Samsung Internet):** tap **Install** on the banner, or
  profile menu, **Install app**.
- **iPhone / iPad (Safari):** Share button, then **Add to Home Screen**.

## Becoming the admin

Set `ADMIN_BOOTSTRAP_PASSWORD` on the server. Sign in, open the Developer tab, and enter that password in the
**Activate admin access** box. There is no built-in admin account.

## Deploying

Echat needs a **long-running Node process** (WebSocket server), so the backend can't run on Vercel.

1. **Database (MongoDB Atlas, free):** create a free M0 cluster at https://www.mongodb.com/atlas,
   create a database user, allow network access from anywhere (0.0.0.0/0), and copy the connection
   string. This keeps your users, posts, chats **and uploaded photos** safe even though Render's free
   disk is wiped on every restart.
2. **Backend → Render:** Build `npm install --legacy-peer-deps && npm run build`, Start `npm start`.
   Environment: `MONGO_URI` (step 1), `CORS_ORIGIN` (your Vercel URL), `ADMIN_BOOTSTRAP_PASSWORD`,
   `NODE_VERSION=22.12.0`.
3. **Frontend → Vercel** (`vercel.json` included). Set `VITE_API_URL` to the Render URL and the
   `VITE_FIREBASE_*` variables, then redeploy.

Check `https://YOUR-BACKEND/api/health`: `storage` shows `MongoDB` when durable storage is active.
Without `MONGO_URI` the app falls back to a local JSON file (fine for development).

Calls across mobile carriers usually need a TURN server: set `VITE_TURN_*`.

## Security notes

- `firestore.rules` currently allows all reads/writes. Lock it down before real users arrive.
- Never commit `.env`; it is git-ignored.

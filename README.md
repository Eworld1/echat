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

## Deploying

Echat needs a **long-running Node process** (WebSocket server + writable disk for
`data/` and `public/uploads/`). Vercel's serverless functions can't host that, so:

1. **Backend** → Render / Railway / Fly.io / any VPS. Build: `npm install --legacy-peer-deps && npm run build`.
   Start: `npm start`. Set `CORS_ORIGIN` to your Vercel URL. Attach a persistent disk for `data/` and `public/uploads/`.
2. **Frontend** → Vercel (`vercel.json` included). Set `VITE_API_URL` to the backend URL and the `VITE_FIREBASE_*` variables in the Vercel dashboard.

Calls across mobile carriers usually need a TURN server — set `VITE_TURN_*`.

## Security notes

- `firestore.rules` currently allows all reads/writes. Lock it down before real users arrive.
- Never commit `.env`; it is git-ignored.

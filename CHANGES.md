# eChat backend audit and fixes

## Findings

| # | Bug / issue | Severity | Evidence | Fix / status |
|---|---|---|---|---|
| 1 | Frontend has no backend URL in this source; when `VITE_API_URL` is empty, REST and WebSocket requests fall back to the Vercel origin. Vercel config only defines AI/live functions, not the main Express API. | Critical | `src/services/apiBase.ts`; `vercel.json`; deployment notes in `README.md` | Not resolvable from archive. Set `VITE_API_URL` and `VITE_SOCKET_URL` to the public backend service URL in Vercel, then redeploy. Find that URL on the backend host service page; README assumes Render. |
| 2 | Vercel workspace suspension is account state, not source code. | Critical | User-provided Vercel notice; not inspectable from ZIP | Not fixable by source edits. Workspace owner must restore service in Vercel; reactivation/upgrade may be required. |
| 3 | Health returned `{ok:true}` and didn't expose failed MongoDB persistence. | Medium | `server.ts`; `server/db.ts` | Health now returns `status`, storage state, uptime, and a concise degraded-storage message (503 when configured durable storage fails). |
| 4 | JSON parser allowed 25 MB; regular uploads allowed 15 MB; Reels allowed up to 250 MB. | High | `server.ts`; client upload code | Request parser and upload limits now enforce a 2 MB file ceiling. Image compression is used before uploads in the primary composer flows. |
| 5 | `/api/posts` sent every post on every request. | High | `server.ts`; `src/services/api.ts` | Feed API now returns 10 posts plus a cursor. Classic and V2 home feeds request more through a Load more button. |
| 6 | CORS defaulted to wildcard. | Medium | `server.ts`; `.env.example`; `render.yaml` | Allowlist always includes `https://echat-ivory.vercel.app`; production examples set that origin explicitly. |
| 7 | Server port, API health route, and centralized Express/WebSocket error handling already existed. | — | `server.ts`; `server/socket.ts` | Confirmed; port continues to use `process.env.PORT`. No runtime logs or live host access were provided, so an actual crash or connection timeout cannot be confirmed. |

## Changed files

- `server.ts`
- `server/db.ts`
- `src/services/api.ts`
- `src/components/Feed.tsx`
- `src/components/CreatePostModal.tsx`
- `src/pages/v2/V2Home.tsx`
- `.env.example`
- `render.yaml`
- `README.md`

## Deploy

1. Restore the suspended Vercel workspace from its dashboard.
2. Deploy the Node/Express backend on a long-running host (the included `render.yaml` targets Render). Set `MONGO_URI` and `CORS_ORIGIN=https://echat-ivory.vercel.app` there. Do not move server-only secrets into `VITE_*` variables.
3. Copy the public backend URL shown by that host. In Vercel → Project → Settings → Environment Variables, set `VITE_API_URL` and `VITE_SOCKET_URL` to that URL; set the required `VITE_FIREBASE_*` variables as well.
4. Redeploy the Vercel frontend so Vite embeds those values.
5. Open `https://YOUR-BACKEND/api/health`. A healthy response includes `{"status":"ok"}`; degraded database persistence returns a message and HTTP 503.

Keep uploads small, use a CDN/object store with image transforms for sustained media delivery, and watch Vercel Usage → Bandwidth. Source changes cannot reactivate a suspended workspace.

## Validation

No dependencies were installed in the extracted project. `npm run typecheck` was attempted and reported missing package declarations plus existing errors in unrelated LiveViewerModal, V2Games, V2Market and live route files. A successful build or deployment was therefore not confirmed.

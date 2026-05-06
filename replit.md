# Focus Tracker

A Rize.io-inspired focus tracker dashboard — dark, minimal, clean — that visualizes focus scores, session activity, and settings from a local capture API.

## Run & Operate

- `pnpm --filter @workspace/focus-tracker run dev` — run the dashboard (port auto-assigned)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- No database provisioned — all data currently served via mock in `src/api.ts`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS (dark theme)
- API: Express 5 (api-server artifact)
- DB: PostgreSQL + Drizzle ORM (provisioned but schema empty — for future use)
- Build: esbuild (CJS bundle for server), Vite (frontend)

## Where things live

- `artifacts/focus-tracker/src/api.ts` — **all API calls** live here; `USE_MOCK = true` at top
- `artifacts/focus-tracker/src/pages/` — Today, Calendar, Database, Settings pages
- `artifacts/focus-tracker/src/index.css` — dark theme CSS variables
- `artifacts/api-server/src/routes/` — Express route handlers (health only currently)
- `lib/api-spec/openapi.yaml` — OpenAPI contract (health only currently)

## Architecture decisions

- **Single api.ts entry point**: All HTTP calls go through `src/api.ts` only. `USE_MOCK = true` at the top returns realistic mock data; set to `false` to call the real API at `http://localhost:3456`.
- **Mock-first design**: Mock data is built into `api.ts` functions with realistic scores, categories, summaries. State mutations (PATCH/DELETE) mutate the in-memory `MOCK_LOGS` array so edits persist within a session.
- **Dark-only theme**: CSS variables are set to a deep blue-gray palette in `:root` only (no light/dark toggle needed). Background `222 13% 8%`, cards `222 13% 11%`.
- **No codegen**: This frontend doesn't use the OpenAPI codegen pipeline — the API shape is defined in `api.ts` types directly, since the data source is an external app at `localhost:3456`.

## Product

- **Today**: Current focus score, category badge, hourly heatmap (24-column, color-coded), stats (focused time, avg score, screenshots), Pause button with duration dropdown
- **Calendar**: Month view with per-day avg score coloring, click day → hourly breakdown, click hour → list of entries with time/category/score/summary
- **Database**: Filterable/paginated table of all log entries; inline-edit score and category; delete rows
- **Settings**: Provider selector (Gemini/Ollama), token input with TEST button, screenshot interval, idle threshold slider, focused score threshold, system status

## User preferences

- All API calls must go through `src/api.ts` only
- Each function has a `USE_MOCK = true` constant at module top — flip to `false` for real API
- Dark theme only, Rize.io inspired aesthetic
- No auth, no new backend logic

## Gotchas

- `USE_MOCK` is a module-level const at the top of `api.ts`; change it once to switch the entire app to real API calls
- Real API base URL is `http://localhost:3456` — change `BASE_URL` in `api.ts` if needed
- Calendar mock generates per-month data randomly each call (not persisted across renders)

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

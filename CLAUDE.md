# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Focus-track is a productivity monitoring system that captures periodic screenshots on macOS when the user is active, analyzes them with LLM (Gemini/Ollama), and displays statistics in a web dashboard.

**Stack:**
- macOS: LaunchAgent + bash scripts for screenshot capture
- Backend: Express API (port 5001) with SQLite database
- Frontend: React + TypeScript + Tailwind (Vite dev server)
- LLM: Google Gemini Flash (default) or Ollama (local)
- Database: SQLite with Drizzle ORM

## Setup

See `SETUP.md` for installation instructions.

Quick start:
```bash
# Install dependencies
pnpm install

# Build API server
pnpm --filter @workspace/api-server run build

# Start API server (port 5001)
PORT=5001 pnpm --filter @workspace/api-server run start

# Start frontend dev server (port 5173)
pnpm --filter @workspace/focus-tracker run dev
```

## Testing

Run tests:
```bash
npm test
```

Tests use Node.js built-in test runner (node:test) with ES modules (.mjs files).

## Architecture

### Workspace Structure
- `lib/db` - SQLite schema with Drizzle ORM
- `lib/llm` - LLM provider abstraction (Gemini + Ollama)
- `artifacts/api-server` - Express REST API
- `artifacts/focus-tracker` - React dashboard
- `scripts` - CLI tools (analyze-screenshot)
- `mac` - LaunchAgent plists and bash scripts

### Screenshot Flow
1. `capture-random-loop.sh` runs in background via LaunchAgent
2. Every 120-600 sec (random), calls `capture-if-active.sh`
3. `capture-if-active.sh` checks idle time, takes screenshot if active
4. Calls `analyze-screenshot.ts` with image path
5. Script analyzes via LLM, saves to `focus_log` table

### Database Schema
Table `focus_log`:
- `id` - auto-increment primary key
- `datetime` - ISO 8601 timestamp
- `timestamp` - Unix timestamp (seconds)
- `category` - enum: code, video, social, idle
- `focus_score` - real (0-10)
- `summary` - text (max 200 chars)

### API Endpoints
- `GET /api/stats/today` - today's stats with hourly heatmap
- `GET /api/stats/calendar?month=YYYY-MM` - monthly calendar
- `GET /api/logs` - filtered log entries with pagination
- `PATCH /api/logs/:id` - update log entry
- `GET /api/settings` - get settings
- `POST /api/settings` - update settings
- `GET /api/status` - watcher status

### Environment Variables
- `FOCUS_TRACK_ROOT` - absolute path to repository
- `FOCUS_TRACK_IDLE_SEC` - idle threshold (default: 60)
- `FOCUS_TRACK_TICK_MIN_SEC` - min interval (default: 120)
- `FOCUS_TRACK_TICK_MAX_SEC` - max interval (default: 600)
- `FOCUS_PROVIDER` - gemini or ollama (default: gemini)
- `GEMINI_API_KEY` - Google AI API key
- `OLLAMA_HOST` - Ollama server URL (default: http://localhost:11434)
- `DATABASE_PATH` - path to focus.db (default: ./focus.db)
- `PORT` - API server port (default: 5001)

## Code Style

- Language: Russian (comments, documentation)
- Minimal changes - don't refactor working code
- No ASCII art, no summaries in responses
- TDD approach - write failing tests first
- Strict TypeScript typing (no `any`)
- All type contracts in `lib/db/src/schema` and `lib/llm/src/types`


# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Focus-track is a productivity monitoring system that captures periodic screenshots on macOS when the user is active. The project uses a macOS LaunchAgent to run background screenshot capture with randomized intervals and idle detection.

Current implementation: macOS screenshot capture scripts
Planned: NestJS backend with TypeScript, SQLite, Redis/BullMQ, Telegram integration, WebSocket support

## Testing

Run tests:
```bash
npm test
```

Tests use Node.js built-in test runner (node:test) with ES modules (.mjs files).

## macOS LaunchAgent Setup

The screenshot capture system consists of:
- `mac/com.focus-track.screenshot.plist` - LaunchAgent configuration
- `mac/capture-random-loop.sh` - Infinite loop with randomized sleep intervals
- `mac/capture-if-active.sh` - Screenshot capture with idle detection

### Environment Variables

Configure in the plist file:
- `FOCUS_TRACK_ROOT` - Absolute path to repository (must be set before use)
- `FOCUS_TRACK_IDLE_SEC` - Idle threshold in seconds (default: 60)
- `FOCUS_TRACK_TICK_MIN_SEC` - Minimum interval between captures (default: 120)
- `FOCUS_TRACK_TICK_MAX_SEC` - Maximum interval between captures (default: 600)

### Screenshot Behavior

- Captures only when idle time < `FOCUS_TRACK_IDLE_SEC`
- Uses `screencapture -x -t jpg` for silent JPEG capture
- Resizes to max 1280px on longest side using `sips -Z 1280`
- Saves to `~/Library/Application Support/focus-track/captures/` with timestamp filenames

## Architecture (Planned NestJS Backend)

When implementing the backend, follow these principles from `.cursor/rules/project.mdc`:

- Modular NestJS structure (see `docs/PROJECT_STRUCTURE.md` when it exists)
- Strict TypeScript typing (no `any`)
- All type contracts in `src/types/contracts.ts` - never duplicate types locally
- Configuration via `ConfigService` only, use `getOrThrow` for required env vars
- Comments in Russian

### Stack
- NestJS + TypeScript
- SQLite with TypeORM (`@nestjs/typeorm`)
- Redis/BullMQ for queues (`@nestjs/bullmq`)
- Telegram via `nestjs-telegraf`
- WebSocket (NestJS built-in)

## Workflow Integration

The project uses Notion for task tracking with custom Cursor skills:
- `start-task` - Begin work on a Notion task (fetch, check dependencies, update status, start TDD)
- `check` - Verify task completion against DoD checklist
- `review-task` - Review changes, run checks, commit, update Notion status

Current task tracked in `.cursor/rules/epic-current.mdc`

## Code Style

- Language: Russian (comments, documentation)
- Minimal changes - don't refactor working code
- No ASCII art, no summaries in responses
- TDD approach - write failing tests first

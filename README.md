# Focus Tracker

Local productivity monitoring for macOS. Screenshots → Gemini → focus score → dashboard.

## Install

1. Download the ZIP from GitHub (**Code → Download ZIP**) and unpack it.
2. In Terminal:
   ```bash
   cd ~/Downloads/focus-track-0.0.9
   make focus-great-again
   ```
   No `make`? → `bash scripts/bootstrap.sh`

At the end the **Gemini key creation page** and **Settings** open in the browser. Project and key names can be anything: copy the key and paste it into API Token (it is saved automatically). **Test** checks the connection.

Running the installer again is safe, it only fetches what is missing.

## What the installer does

- Node + pnpm (through Homebrew **or** into `~/` without admin rights)
- dependencies, database, screen capture, background services
- a free port, **5001** (or 5002, 5003… if taken)
- opens the Gemini key page and `http://localhost:PORT/#settings`

macOS may ask for:
- an admin password (Homebrew only, it works without one);
- **Command Line Tools**: not needed for the release ZIP (v0.0.9+), `focus-capture` is prebuilt and Homebrew is not installed from scratch;
- **Screen Recording** permission for `mac/bin/focus-capture`.

**Do not use `sudo brew`.**

## After install

```bash
make diagnose
make pause MIN=10
make backup
```

Dashboard: see the port in `.env` (`PORT=...`) or in the `make diagnose` output.

### Habit grid

The second tab, **Habits** (`/habits`), shows four calendar weeks, Mon–Sun. Cells are toggled by hand, and a manual decision always wins over automatic filling. Activities can be created, edited, dragged by the grip to change priority, and archived with compact icon buttons. The technical ID is generated from the name. Archiving does not delete saved cells or the audit history.

Starter activities: Meditation 🧘, English drill 🇬🇧, Walk 🚶 and Node learning 🟩. The last two are marked auto: an external agent may fill them through the habit API but cannot overwrite a state that was set manually.

## Secrets

| What | Where |
|------|-------|
| Gemini key | dashboard → Settings → `focus-app-settings.json` |
| History | `focus.db` |
| Telegram | `.env` (optional) |
| Goal messages | `focus-goal.json`, `speaking-topics.txt` (optional, local) |

## Telegram (optional)

[@BotFather](https://t.me/botfather) → `TG_BOT_TOKEN`, [@userinfobot](https://t.me/userinfobot) → `TG_CHAT_ID` in `.env`.

### Goal messages (optional)

With Telegram configured, put a `focus-goal.json` next to `focus.db` to get one message a day: a question to discuss aloud in English, sent after 14:00 when you are not busy and the habit is not ticked yet. You also get a weekly summary and a streak of non-empty days with freezes. Without the file nothing is sent.

```json
{
  "first_action": "speak English with an AI",
  "step_habit_ids": ["walk", "talk_to_llm_eng"],
  "question_habit_id": "talk_to_llm_eng",
  "nudge_hour": 14,
  "min_screenshots": 5,
  "streak": { "start_date": "2026-10-06", "earn_every": 5, "cap": 2, "start_freezes": 1 }
}
```

`step_habit_ids` are the habits that make a day count. Dry run without sending: `pnpm --silent --filter @workspace/scripts run goal-report --dry-run --no-llm`.

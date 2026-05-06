# Focus Tracker - Setup Instructions

## 1. Install LaunchAgents

```bash
# Update paths in plist files
REPO_PATH="/Users/mich/PycharmProjects/focus-track"
sed -i '' "s|/path/to/focus-track|${REPO_PATH}|g" mac/*.plist

# Copy to LaunchAgents
cp mac/com.focus-track.screenshot.plist ~/Library/LaunchAgents/
cp mac/com.focus-track.api-server.plist ~/Library/LaunchAgents/

# Load agents
launchctl load ~/Library/LaunchAgents/com.focus-track.screenshot.plist
launchctl load ~/Library/LaunchAgents/com.focus-track.api-server.plist
```

## 2. Configure Settings

Edit `~/Library/LaunchAgents/com.focus-track.screenshot.plist`:
- Set `GEMINI_API_KEY` to your Google AI API key
- Or set `FOCUS_PROVIDER` to `ollama` for local inference

## 3. Start Services

```bash
# Check status
launchctl list | grep focus-track

# View logs
tail -f /tmp/focus-track-screenshot.err.log
tail -f /tmp/focus-track-api.err.log
```

## 4. Open Dashboard

```bash
pnpm -w run dev
```

Open http://localhost:5001 in browser. API and frontend served from one process with HMR.

## Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.focus-track.screenshot.plist
launchctl unload ~/Library/LaunchAgents/com.focus-track.api-server.plist
rm ~/Library/LaunchAgents/com.focus-track.*.plist
```

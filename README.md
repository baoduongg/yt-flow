# yt-flow

[Tiếng Việt](README.vi.md)

Automated pipeline: pick a car, generate an ASMR-style video of it, preview and confirm it, generate YouTube metadata, upload to YouTube.

## Setup

1. Copy `.env.example` to `.env` and fill in the keys below.
2. `npm install`, then `npx playwright install chromium`.
3. One-time Gemini login: `npm run gemini:login` (opens a real Chrome window, log in by hand, press Enter in the terminal when done — session persists in `.gemini-profile/`, not committed to git).

### Getting the `.env` keys

**`GEMINI_API_KEY`** — used only for text metadata generation, not video:
1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Click "Create API key", pick or create a Google Cloud project.
3. Copy the key into `.env`.

**`YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`** — OAuth client for the upload:
1. In [Google Cloud Console](https://console.cloud.google.com/), pick/create a project, then enable the **YouTube Data API v3** (APIs & Services → Library).
2. APIs & Services → Credentials → Create Credentials → OAuth client ID → Application type **Desktop app**.
3. Copy the generated Client ID and Client Secret into `.env`.
4. If prompted, configure the OAuth consent screen first (External, testing mode is fine for personal use — add your own Google account as a test user).

**`YOUTUBE_REFRESH_TOKEN`** — obtained once via a manual OAuth flow, e.g. [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground):
1. Click the gear icon (top right) → check "Use your own OAuth credentials" → paste your `YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET`.
2. In the scopes list (or type manually), enter `https://www.googleapis.com/auth/youtube.upload`, click **Authorize APIs**, sign in with the Google account that owns the target YouTube channel.
3. Click **Exchange authorization code for tokens** — copy the **Refresh token** value into `.env`.

## Running

`npm run pipeline`:

1. Picks the next car from `data/cars-queue.json` (refills from `data/cars.json` when empty).
2. Fills `prompt-veo3.md` with the car and generates the video by driving `gemini.google.com` via Playwright (`lib/gemini-browser.ts`) — no Veo3 API key needed. Saved to `output/veo-<timestamp>.mp4`.
3. Opens the video for you to preview. Confirm in the terminal: `y` continues to upload, `n` deletes it and regenerates.
4. Generates title/description/tags from `prompt-create-info-video.md` via the Gemini API.
5. Uploads to YouTube (privacy from `YOUTUBE_PRIVACY_STATUS`, defaults to private) and deletes the local video file.

## Remote control via Telegram

`npm run bot` starts a long-running bot that lets you trigger and approve
runs from your phone — no terminal needed after it's started.

1. Create a bot with [@BotFather](https://t.me/BotFather), copy the token
   into `TELEGRAM_BOT_TOKEN` in `.env`.
2. Send any message to your new bot, then open
   `https://api.telegram.org/bot<token>/getUpdates` in a browser and copy
   `message.chat.id` into `TELEGRAM_CHAT_ID` in `.env`. Only this chat can
   issue commands — everyone else is silently ignored.
3. `npm run bot`.
4. From Telegram:
   - `/run` — pick the next car from the queue and run the full pipeline.
   - `/run Toyota Supra MK4` — run the pipeline for a specific car (must
     match an entry in `data/cars.json`).
   - `/status` — check whether a run is in progress and which step it's on.
   - When a video is generated you'll receive it with **Duyệt** (approve)
     / **Làm lại** (regenerate) buttons. If the video is too large for
     Telegram to send (>50MB), open the printed path on the machine
     directly and reply `/approve` or `/reject` instead.

Keep it running in the background with [pm2](https://pm2.keymetrics.io/)
(works the same on macOS and Windows):

```bash
npm install -g pm2
pm2 start npm --name yt-flow-bot -- run bot
pm2 save
```

## If Google changes the Gemini UI

Selectors in `lib/gemini-browser.ts` are tied to the live DOM and can break. Debug tools:

- `npx tsx --env-file=.env scripts/gemini-test-video.ts "test prompt"` — run the video-gen flow standalone.
- `npx tsx --env-file=.env scripts/gemini-inspect.ts [url]` — dump the accessibility tree of a Gemini page.
- `npx tsx --env-file=.env scripts/gemini-inspect-result.ts "prompt"` — submit a prompt and dump the DOM every 60s until the video's ready.
- `npx tsx --env-file=.env scripts/gemini-inspect-ratio.ts` — dump the aspect-ratio picker menu.

## Other files

- `next-car.sh` — standalone helper that pops a car from `cars-queue.txt`/`cars-master.txt` and fills both prompt templates into `output/<slug>-<timestamp>/`, for manual use outside the automated pipeline.

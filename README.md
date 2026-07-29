# yt-flow

Automated pipeline: pick a car, generate a video of it, generate YouTube metadata, upload to YouTube.

## Gemini video generation setup

Video generation drives the `gemini.google.com` web app via Playwright (no Veo3 API key needed) — see `lib/gemini-browser.ts`.

1. One-time login: `npm run gemini:login` (opens a browser, log in by hand, press Enter in the terminal when done — session persists in `.gemini-profile/`).
2. If video generation breaks (Google changed the UI), debug selectors live: `npx tsx --env-file=.env scripts/gemini-test-video.ts "test prompt"`.
3. Run the full pipeline: `npm run pipeline`.

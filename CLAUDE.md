# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Automated pipeline that picks a car, generates an ASMR-style video of it via Gemini (Veo3), lets a human preview/approve it, generates YouTube title/description/tags, and uploads to YouTube. Three interchangeable front-ends drive the same pipeline: a CLI script, a Telegram bot, and a local web dashboard. Only run one of the three at a time — they all read/write `data/cars-queue.json` and can race.

TypeScript, ESM (`"type": "module"`), run directly via `tsx` — no build step.

## Commands

```bash
npm run pipeline    # CLI: full pipeline, confirm in terminal
npm run bot         # Telegram bot (long-running)
npm run web         # Web dashboard on http://127.0.0.1:3000 (WEB_PORT to override)
npm run gemini:login # One-time interactive Gemini login, persists session to .gemini-profile/
npm test            # tsx --test lib/*.test.ts
```

Run a single test file: `tsx --test lib/pipeline.test.ts`

Gemini browser-automation debug tools (when selectors in `lib/gemini-browser.ts` break after a Google UI change):

```bash
npx tsx --env-file=.env scripts/gemini-test-video.ts "test prompt"     # run video-gen flow standalone
npx tsx --env-file=.env scripts/gemini-inspect.ts [url]                # dump a11y tree of a Gemini page
npx tsx --env-file=.env scripts/gemini-inspect-result.ts "prompt"      # submit + dump DOM every 60s until ready
npx tsx --env-file=.env scripts/gemini-inspect-ratio.ts                # dump the aspect-ratio picker menu
```

There is no lint/typecheck script; `tsconfig.json` has `noEmit: true` (use `tsc --noEmit` manually for a type check if needed).

## Architecture

**Core pipeline** (`lib/pipeline.ts`, `runPipeline`) is UI-agnostic: it takes a `PipelineDeps` object (car picker, video generator, metadata generator, uploader — real impls in `lib/car-picker.ts`, `scripts/veo-to-youtube.ts`, `lib/generate-metadata.ts`) and a `PipelineHooks` object (`onStep`, `confirmVideo`, `confirmMetadata`) supplied by whichever front-end is driving it. This dependency-injection split is what makes `lib/pipeline.test.ts` mockable via `lib/test-support.ts` without touching Playwright/YouTube/Gemini.

Three front-ends wrap `runPipeline` with different hook implementations:
- `scripts/run-shorts-pipeline.ts` — CLI, hooks resolve via terminal stdin y/n.
- `scripts/telegram-bot.ts` — hooks resolve via Telegram inline keyboard / `/approve` /`/reject`.
- `lib/web-job.ts` (`createJobRunner`) — wraps `runPipeline` as a subscribable state machine (`idle → running → awaiting-video → awaiting-metadata → done/error`) polled by `scripts/web-server.ts`'s SSE endpoint (`/api/events`) and driven by `public/app.js`.

**Video generation** (`lib/gemini-browser.ts`) does not use a Veo3 API — it drives `gemini.google.com` directly with a persistent Playwright Chromium context (channel `chrome`, profile in `.gemini-profile/`, not committed). Selectors are tied to the live Gemini DOM and are documented inline with the date they were last confirmed working; when Google changes the UI, re-run the `gemini-inspect*` scripts above to find the new structure before touching selectors blind.

**Metadata generation** (`lib/generate-metadata.ts`) is a separate concern — text-only Gemini API call (`@google/genai`), templated from `prompt-create-info-video.md`, parsed as strict JSON (`{ title, description, tags }`).

**Car selection** (`lib/car-picker.ts`): `data/cars.json` is the full pool; `data/cars-queue.json` is a shuffled working queue that gets popped from and refilled (reshuffled from the pool) when empty. `pickNextCar()` mutates the queue file on disk — this is the shared state that makes concurrent runners unsafe.

**Env config** (`lib/env-file.ts`): hand-rolled `.env` parser/writer (not `dotenv`) used by the web dashboard's Setup UI to read/mask and persist keys without wiping unknown/manual edits beyond the known key set. `KNOWN_ENV_KEYS` there is the single source of truth for which keys the dashboard exposes.

**Web dashboard** (`scripts/web-server.ts` + `public/`): plain Express + static HTML/CSS/JS, no frontend framework/build step. Binds to `127.0.0.1` only, no auth — single-user local tool by design. State pushed to the browser via Server-Sent Events, not polling.

## Conventions

- User-facing strings (CLI/Telegram/web progress messages, error messages) are in Vietnamese; code, comments, and docs are in English. Keep this split when adding new user-facing messages.
- Comments prefixed `// ponytail:` mark a deliberate simplification with a known ceiling — read them before "fixing" the thing they describe.
- Prompt templates (`prompt-veo3.md`, `prompt-create-info-video.md`) use `{CAR_MODEL}` as a placeholder replaced via `replaceAll`.

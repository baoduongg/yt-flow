# Playwright-based video gen on Gemini web app

## Problem

`generateVideo()` in `scripts/veo-to-youtube.ts` calls the Veo3 model via
`@google/genai`, which requires a paid/allowlisted `GEMINI_API_KEY`. The user
only has a logged-in Google account with Gemini Advanced access in the
browser, not Veo3 API access. Need to generate the same video by driving
`gemini.google.com` with Playwright instead.

## Scope

- Replace the video-generation half of the pipeline only.
- `lib/generate-metadata.ts` (text metadata via `@google/genai`) is untouched.
- `run-shorts-pipeline.ts` is untouched — it only calls `generateVideo(prompt)`
  and expects a local file path back, same as today.

## Architecture

New module `lib/gemini-browser.ts`:

- `loginGemini()` — one-time interactive helper (also exposed as
  `scripts/gemini-login.ts`): launches a persistent Chromium context headed,
  navigates to `gemini.google.com/app`, waits for the user to log in and
  press Enter in the terminal, then closes. Run manually once before first
  pipeline run, and again whenever the session expires.
- `generateVideoViaBrowser(prompt: string): Promise<string>` — replaces the
  body of `generateVideo()` in `veo-to-youtube.ts`. Same signature/contract
  as the current `@google/genai`-based implementation (returns a local file
  path to the downloaded mp4).

Both use `chromium.launchPersistentContext(profileDir, { headless: false })`
where `profileDir` defaults to `.gemini-profile/` at the project root
(overridable via `GEMINI_PROFILE_DIR` env var). Headed mode is deliberate —
headless Chromium is more likely to get flagged as a bot by Google.

## Flow inside `generateVideoViaBrowser`

1. Open a new page in the persistent context, go to `gemini.google.com/app`.
2. Verify logged in (presence of the chat input); if not, throw an error
   instructing the user to run `scripts/gemini-login.ts` first.
3. Select the Veo 3 / video generation mode in the UI.
4. Type the prompt into the chat input and submit.
5. Poll for the generated video to appear (10s interval, ~10 min timeout —
   mirrors the polling pattern already used for the Veo3 API operation).
6. Trigger the download action in the UI, capture it via
   `page.waitForEvent('download')`, save to `path.join(tmpdir(), 'veo-<ts>.mp4')`.
7. Close the page (context stays open across calls within one process, or is
   relaunched per call — implementation detail, either is fine since the
   profile dir persists the session either way).
8. Return the saved file path.

## Known risk / open item

Steps 3, 4, and 6 depend on `gemini.google.com`'s DOM, which is not
inspectable ahead of time in this environment and which Google changes
without notice. Selectors will be written using role/text-based Playwright
locators (`getByRole`, `getByText`) as the most resilient option available,
but the first real run will very likely need live debugging in headed mode
to fix selectors against the actual page. This is flagged in code with a
`ponytail:` comment at the selector call sites, naming this as the ceiling
and pointing back to this doc as the place to update the flow if Google's
UI changes structurally (e.g. video gen moves to a different page/tool).

## Dependencies

- Add `playwright` to `package.json` dependencies.
- One-time setup: `npx playwright install chromium`.

## Error handling

- Not logged in → throw with instructions to run the login script.
- Selector not found (UI changed / video mode unavailable) → throw with the
  step name and prompt, so failures are traceable without needing to
  reproduce interactively.
- Generation timeout (~10 min) → throw, matching the existing timeout-less-
  but-analogous behavior of the API polling loop (currently that loop has no
  timeout either; this one gets one since a stuck browser session is more
  likely than a stuck API operation).

## Testing

No automated test — this drives a live third-party web UI with a real
Google account, which can't be meaningfully unit-tested or run in CI. The
"test" is a single manual `npm run pipeline` execution in headed mode after
implementation, watched end-to-end once to confirm selectors work, per the
project's existing `ponytail:` convention of pairing non-trivial logic with
one runnable check where automated testing is feasible — here it isn't, so
manual verification is the check.

## Not doing

- Not adding retry/backoff beyond what's already needed — first version
  fails loud and lets the user re-run.
- Not abstracting over "video source" (API vs browser) behind a strategy
  interface — the user picked browser-only replacement, so the API path is
  simply removed from `generateVideo()`.

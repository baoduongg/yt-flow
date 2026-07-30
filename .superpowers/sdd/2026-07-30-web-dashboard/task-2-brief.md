### Task 2: `.env` read/mask/write module

**Files:**
- Create: `lib/env-file.ts`
- Create: `lib/env-file.test.ts`
- Modify: `package.json` (test script glob)

**Interfaces:**
- Produces:
  - `KNOWN_ENV_KEYS: readonly string[]` — the 8 keys the dashboard manages: `GEMINI_API_KEY`, `GEMINI_TEXT_MODEL`, `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`, `YOUTUBE_PRIVACY_STATUS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
  - `type EnvKey = (typeof KNOWN_ENV_KEYS)[number]`
  - `parseEnvFile(content: string): Record<string, string>`
  - `maskValue(value: string): string`
  - `readEnvConfig(envPath: string): Promise<Record<EnvKey, { isSet: boolean; masked: string }>>`
  - `writeEnvConfig(envPath: string, updates: Partial<Record<EnvKey, string>>): Promise<Record<string, string>>` — returns the full merged key/value map (used by the caller to refresh `process.env`).
- Consumes: nothing from other new modules (pure, standalone).

- [ ] **Step 1: Write the failing tests**

Create `lib/env-file.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseEnvFile, maskValue, readEnvConfig, writeEnvConfig } from "./env-file.ts";

test("parseEnvFile ignores comments and blank lines", () => {
  const content = "# comment\nFOO=bar\n\nBAZ=qux\n";
  assert.deepEqual(parseEnvFile(content), { FOO: "bar", BAZ: "qux" });
});

test("maskValue masks long values keeping first/last 4 chars", () => {
  assert.equal(maskValue("AIzaSyABCDEFGHIJK"), "AIza****HIJK");
});

test("maskValue fully masks short values", () => {
  assert.equal(maskValue("abc"), "***");
  assert.equal(maskValue(""), "");
});

test("writeEnvConfig merges updates, readEnvConfig reflects them, blank keeps existing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "yt-flow-env-"));
  const envPath = path.join(dir, ".env");
  try {
    await writeEnvConfig(envPath, { GEMINI_API_KEY: "secret-key-12345" });
    const config1 = await readEnvConfig(envPath);
    assert.equal(config1.GEMINI_API_KEY.isSet, true);
    assert.equal(config1.YOUTUBE_CLIENT_ID.isSet, false);

    await writeEnvConfig(envPath, { GEMINI_API_KEY: "", YOUTUBE_CLIENT_ID: "client-abc" });
    const config2 = await readEnvConfig(envPath);
    assert.equal(config2.GEMINI_API_KEY.isSet, true);
    assert.equal(config2.GEMINI_API_KEY.masked, config1.GEMINI_API_KEY.masked);
    assert.equal(config2.YOUTUBE_CLIENT_ID.isSet, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readEnvConfig on missing file returns all keys unset", async () => {
  const config = await readEnvConfig("/tmp/yt-flow-does-not-exist/.env");
  assert.equal(config.GEMINI_API_KEY.isSet, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/env-file.test.ts`
Expected: FAIL — `lib/env-file.ts` doesn't exist yet (module not found).

- [ ] **Step 3: Implement**

Create `lib/env-file.ts`:

```ts
import { readFile, writeFile } from "node:fs/promises";

export const KNOWN_ENV_KEYS = [
  "GEMINI_API_KEY",
  "GEMINI_TEXT_MODEL",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_REFRESH_TOKEN",
  "YOUTUBE_PRIVACY_STATUS",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
] as const;

export type EnvKey = (typeof KNOWN_ENV_KEYS)[number];

export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return result;
}

export function maskValue(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

async function readExisting(envPath: string): Promise<Record<string, string>> {
  try {
    return parseEnvFile(await readFile(envPath, "utf-8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

export async function readEnvConfig(
  envPath: string,
): Promise<Record<EnvKey, { isSet: boolean; masked: string }>> {
  const parsed = await readExisting(envPath);
  const result = {} as Record<EnvKey, { isSet: boolean; masked: string }>;
  for (const key of KNOWN_ENV_KEYS) {
    const value = parsed[key] ?? "";
    result[key] = { isSet: value !== "", masked: maskValue(value) };
  }
  return result;
}

export async function writeEnvConfig(
  envPath: string,
  updates: Partial<Record<EnvKey, string>>,
): Promise<Record<string, string>> {
  const merged = { ...(await readExisting(envPath)) };
  for (const key of KNOWN_ENV_KEYS) {
    const update = updates[key];
    if (update !== undefined && update !== "") merged[key] = update;
  }

  // ponytail: rewrites .env as plain KEY=VALUE lines; comments and blank-line
  // formatting in the original file are not preserved. Acceptable for a
  // local single-user config file — revisit if hand-written comments in
  // .env turn out to matter.
  const lines = Object.entries(merged).map(([key, value]) => `${key}=${value}`);
  await writeFile(envPath, lines.join("\n") + "\n");
  return merged;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test lib/env-file.test.ts`
Expected: all 5 tests PASS.

- [ ] **Step 5: Widen the test script to cover all `lib/*.test.ts` files**

In `package.json`, change:

```json
"test": "tsx --test lib/pipeline.test.ts"
```

to:

```json
"test": "tsx --test lib/*.test.ts"
```

Run: `npm test`
Expected: PASS, and output shows both `pipeline.test.ts` and `env-file.test.ts` ran.

- [ ] **Step 6: Commit**

```bash
git add lib/env-file.ts lib/env-file.test.ts package.json
git commit -m "feat: add .env parse/mask/write module for the web dashboard"
```

---


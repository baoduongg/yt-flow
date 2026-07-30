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
  assert.equal(maskValue("AIzaSyABCDEFGHIJK"), "AIza****GHIJK");
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

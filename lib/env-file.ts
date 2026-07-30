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
  return `${value.slice(0, 4)}****${value.slice(-5)}`;
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

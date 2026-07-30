import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const profileDir = process.env.GEMINI_PROFILE_DIR ?? path.join(projectRoot, ".gemini-profile");
const prompt = process.argv[2] ?? "A close-up shot of a wooden toy car on a workshop table.";

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1280, height: 900 },
  channel: "chrome",
  args: ["--disable-blink-features=AutomationControlled"],
  ignoreDefaultArgs: ["--enable-automation"],
});

const page = await context.newPage();
await page.goto("https://gemini.google.com/videos");
await page.waitForTimeout(3000);

const tryButton = page.getByRole("button", { name: /dùng thử|try it|try/i });
if (await tryButton.first().isVisible().catch(() => false)) {
  await tryButton.first().click();
  await page.waitForTimeout(1000);
}

const input = page.getByRole("main").getByRole("textbox").first();
await input.click();
await input.fill(prompt);
await input.press("Enter");
console.log("Prompt submitted, polling for completion...");

const checkpoints = [60, 60, 60, 60, 60]; // seconds between each check
for (let i = 0; i < checkpoints.length; i++) {
  await page.waitForTimeout(checkpoints[i] * 1000);
  const elapsed = checkpoints.slice(0, i + 1).reduce((a, b) => a + b, 0);
  console.log(`\n=== snapshot at ~${elapsed}s ===`);
  console.log(await page.locator("main").ariaSnapshot());
}

await context.close();

import { loginGemini } from "../lib/gemini-browser.ts";

loginGemini().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

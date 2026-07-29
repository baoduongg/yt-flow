import { generateVideoViaBrowser } from "../lib/gemini-browser.ts";

const prompt = process.argv[2] ?? "A close-up shot of a wooden toy car on a workshop table.";

generateVideoViaBrowser(prompt)
  .then((filePath) => console.log(`Video saved to: ${filePath}`))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });

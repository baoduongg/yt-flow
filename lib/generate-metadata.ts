import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = path.join(projectRoot, "prompt-create-info-video.md");
const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash";

export interface VideoMetadata {
  title: string;
  description: string;
  tags: string[];
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

function assertSchema(value: unknown): asserts value is VideoMetadata {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as VideoMetadata).title !== "string" ||
    typeof (value as VideoMetadata).description !== "string" ||
    !Array.isArray((value as VideoMetadata).tags) ||
    !(value as VideoMetadata).tags.every((t) => typeof t === "string")
  ) {
    throw new Error(
      `generateMetadata: response không đúng schema { title, description, tags }: ${JSON.stringify(value)}`,
    );
  }
}

export async function generateMetadata(carModel: string): Promise<VideoMetadata> {
  const template = await readFile(templatePath, "utf-8");
  const prompt = template.replaceAll("{CAR_MODEL}", carModel);

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: prompt,
  });

  const text = response.text;
  if (!text) {
    throw new Error("generateMetadata: response rỗng từ Gemini API");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    throw new Error(`generateMetadata: response không phải JSON hợp lệ: ${text}`);
  }

  assertSchema(parsed);
  return parsed;
}

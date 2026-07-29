import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { google } from "googleapis";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
// ponytail: model id per Veo docs at time of writing, verify against
// https://ai.google.dev/gemini-api/docs/video before relying on it long-term.
const VEO_MODEL = process.env.VEO_MODEL ?? "veo-3.1-generate-preview";

export interface YoutubeMeta {
  title: string;
  description: string;
  tags: string[];
}

export async function generateVideo(prompt: string): Promise<string> {
  let operation = await ai.models.generateVideos({
    model: VEO_MODEL,
    prompt,
  });

  while (!operation.done) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  const video = operation.response?.generatedVideos?.[0]?.video;
  if (!video) {
    throw new Error(`generateVideo: Veo API không trả về video (operation: ${JSON.stringify(operation)})`);
  }

  const outputPath = path.join(tmpdir(), `veo-${Date.now()}.mp4`);
  await ai.files.download({ file: video, downloadPath: outputPath });
  return outputPath;
}

export async function uploadToYoutube(filePath: string, meta: YoutubeMeta): Promise<string> {
  const oauth2Client = new google.auth.OAuth2(process.env.YOUTUBE_CLIENT_ID, process.env.YOUTUBE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });

  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: meta.title,
        description: meta.description,
        tags: meta.tags,
        categoryId: "2", // Autos & Vehicles
      },
      status: {
        // ponytail: defaults to private so nothing auto-publishes to the public
        // web; set YOUTUBE_PRIVACY_STATUS=public in .env once reviewed.
        privacyStatus: (process.env.YOUTUBE_PRIVACY_STATUS as "public" | "private" | "unlisted" | undefined) ?? "private",
      },
    },
    media: {
      body: createReadStream(filePath),
    },
  });

  const videoId = res.data.id;
  if (!videoId) {
    throw new Error(`uploadToYoutube: không nhận được video id (response: ${JSON.stringify(res.data)})`);
  }
  return `https://youtu.be/${videoId}`;
}

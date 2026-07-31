import { createReadStream } from "node:fs";
import { google } from "googleapis";
import { generateVideoViaBrowser } from "../lib/gemini-browser.ts";

export interface YoutubeMeta {
  title: string;
  description: string;
  tags: string[];
}

export async function generateVideo(prompt: string): Promise<string> {
  return generateVideoViaBrowser(prompt);
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

export async function getYoutubeChannelInfo() {
  const clientID = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

  if (!clientID || !clientSecret || !refreshToken) {
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(clientID, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  try {
    const res = await youtube.channels.list({
      part: ["snippet", "statistics"],
      mine: true,
    });

    const channel = res.data.items?.[0];
    if (!channel) return null;

    return {
      title: channel.snippet?.title ?? "Không xác định",
      customUrl: channel.snippet?.customUrl ?? "",
      thumbnail: channel.snippet?.thumbnails?.default?.url ?? "",
      subscriberCount: channel.statistics?.subscriberCount ?? "0",
      videoCount: channel.statistics?.videoCount ?? "0",
      privacyStatus: (process.env.YOUTUBE_PRIVACY_STATUS as string) ?? "private",
    };
  } catch (error: any) {
    console.error("Lỗi khi lấy thông tin kênh YouTube:", error);
    if (error.status === 403 || error.code === 403 || (error.message && error.message.includes("Permission"))) {
      return { error: "insufficient_scope" };
    }
    return null;
  }
}

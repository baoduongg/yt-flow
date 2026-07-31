import { google } from "googleapis";
import { readEnvConfig } from "./lib/env-file.ts";

async function main() {
  const envPath = "./.env";
  const config = await readEnvConfig(envPath);
  
  const clientID = process.env.YOUTUBE_CLIENT_ID || "";
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || "";
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN || "";

  console.log("ClientID loaded:", !!clientID, clientID ? clientID.substring(0, 10) + "..." : "");
  console.log("ClientSecret loaded:", !!clientSecret, clientSecret ? clientSecret.substring(0, 10) + "..." : "");
  console.log("RefreshToken loaded:", !!refreshToken, refreshToken ? refreshToken.substring(0, 10) + "..." : "");

  const oauth2Client = new google.auth.OAuth2(clientID, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  try {
    console.log("Calling channels.list...");
    const res = await youtube.channels.list({
      part: ["snippet", "statistics"],
      mine: true,
    });

    console.log("Result:", JSON.stringify(res.data, null, 2));
  } catch (error) {
    console.error("Error from YouTube API:", error);
  }
}

main();

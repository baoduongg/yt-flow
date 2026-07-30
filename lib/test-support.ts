import type { PipelineDeps } from "./pipeline.ts";

export type MockDeps = PipelineDeps & {
  calls: { generateVideo: number; unlink: number; uploadToYoutube: number; generateMetadata: number };
};

export function makeMockDeps(): MockDeps {
  const calls = { generateVideo: 0, unlink: 0, uploadToYoutube: 0, generateMetadata: 0 };
  return {
    calls,
    pickNextCar: async () => "Test Car",
    generateVideo: async () => {
      calls.generateVideo++;
      return `/tmp/video-${calls.generateVideo}.mp4`;
    },
    generateMetadata: async () => {
      calls.generateMetadata++;
      return { title: "t", description: "d", tags: [] };
    },
    uploadToYoutube: async () => {
      calls.uploadToYoutube++;
      return "https://youtu.be/test";
    },
    unlink: async () => {
      calls.unlink++;
    },
  };
}

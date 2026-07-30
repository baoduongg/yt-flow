import { test } from "node:test";
import assert from "node:assert/strict";
import { runPipeline, type PipelineDeps } from "./pipeline.ts";

function makeDeps(): PipelineDeps & {
  calls: { generateVideo: number; unlink: number; uploadToYoutube: number; generateMetadata: number };
} {
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

test("confirmVideo false triggers regeneration, true continues to upload", async () => {
  const deps = makeDeps();
  let confirmCalls = 0;
  const confirmVideo = async () => {
    confirmCalls++;
    return confirmCalls >= 2;
  };

  const result = await runPipeline({}, { confirmVideo }, deps);

  assert.equal(deps.calls.generateVideo, 2);
  assert.equal(deps.calls.unlink, 2);
  assert.equal(deps.calls.uploadToYoutube, 1);
  assert.equal(deps.calls.generateMetadata, 1);
  assert.equal(result.videoUrl, "https://youtu.be/test");
  assert.equal(result.car, "Test Car");
});

test("confirmVideo true immediately uploads on first try", async () => {
  const deps = makeDeps();
  const result = await runPipeline({}, { confirmVideo: async () => true }, deps);

  assert.equal(deps.calls.generateVideo, 1);
  assert.equal(deps.calls.unlink, 1);
  assert.equal(deps.calls.uploadToYoutube, 1);
  assert.equal(result.car, "Test Car");
});

test("invalid carOverride throws before generating any video", async () => {
  const deps = makeDeps();

  await assert.rejects(
    () => runPipeline({ carOverride: "Không Tồn Tại XYZ" }, { confirmVideo: async () => true }, deps),
    /Không tìm thấy xe/,
  );
  assert.equal(deps.calls.generateVideo, 0);
});

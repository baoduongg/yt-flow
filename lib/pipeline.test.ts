import { test } from "node:test";
import assert from "node:assert/strict";
import { runPipeline } from "./pipeline.ts";
import { makeMockDeps } from "./test-support.ts";
import type { VideoMetadata } from "./generate-metadata.ts";

test("confirmVideo false triggers regeneration, true continues to upload", async () => {
  const deps = makeMockDeps();
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
  const deps = makeMockDeps();
  const result = await runPipeline({}, { confirmVideo: async () => true }, deps);

  assert.equal(deps.calls.generateVideo, 1);
  assert.equal(deps.calls.unlink, 1);
  assert.equal(deps.calls.uploadToYoutube, 1);
  assert.equal(result.car, "Test Car");
});

test("invalid carOverride throws before generating any video", async () => {
  const deps = makeMockDeps();

  await assert.rejects(
    () => runPipeline({ carOverride: "Không Tồn Tại XYZ" }, { confirmVideo: async () => true }, deps),
    /Không tìm thấy xe/,
  );
  assert.equal(deps.calls.generateVideo, 0);
});

test("confirmMetadata edits metadata before upload", async () => {
  const deps = makeMockDeps();
  const uploaded: VideoMetadata[] = [];
  deps.uploadToYoutube = async (_path, meta) => {
    uploaded.push(meta);
    return "https://youtu.be/edited";
  };

  const result = await runPipeline(
    {},
    {
      confirmVideo: async () => true,
      confirmMetadata: async (meta) => ({ ...meta, title: "Edited Title" }),
    },
    deps,
  );

  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].title, "Edited Title");
  assert.equal(result.videoUrl, "https://youtu.be/edited");
});

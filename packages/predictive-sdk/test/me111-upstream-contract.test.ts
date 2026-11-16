/** Contract parity against immutably pinned TAC-OSM ME111 Android source. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ME111_FROZEN_CONTRACT as c } from "../src/me111-bridge.ts";

const root = process.env.ME111_PINNED_ANDROID_SOURCE;

test("pinned frozen ONNX Android input/output identity matches Woyengi bridge", {
  skip: !root && "Requires pinned TAC-OSM source checkout: not a device or neural test",
}, () => {
  if (!root) throw Error("ME111_PINNED_ANDROID_SOURCE missing");
  const path = join(root, "mobile/android/model01/sample-app/app/src/main/java/org/tacosm/mobile/me111");
  const contract = readFileSync(join(path, "Me111Contract.java"), "utf8");
  const engine = readFileSync(join(path, "Me111LocalEngine.java"), "utf8");
  for (const [key, value] of [
    ["MODEL_SHA256", c.modelSha256],
    ["CHECKPOINT_SHA256", c.checkpointSha256],
  ] as const) {
    assert.ok(contract.includes('"' + value + '"'), key + " pinned SHA mismatch");
  }
  for (const [key, value] of [
    ["CHANNELS", c.channels],
    ["CLOCK_FIELDS", c.clocks],
    ["FORECAST_CHANNELS", c.forecastChannels],
    ["EVIDENCE_DIM", c.evidenceDim],
    ["MEMORY_DIM", c.memoryRows],
  ] as const) {
    assert.ok(contract.includes("public static final int " + key + " = " + value + ";"),
      key + " pinned dimension mismatch");
  }
  for (const name of [
    "values", "observed", "ages", "clock", "owners", "hours",
    "source_sum", "source_mass", "evidence_sum", "count", "memory", "last_hour",
    "log_location", "left_scale", "right_scale", "next_source_sum",
    "next_source_mass", "next_evidence_sum", "next_count", "next_memory",
    "next_last_hour", "chronology_ok",
  ]) {
    assert.ok(engine.includes('"' + name + '"'), "missing pinned ONNX operator contract " + name);
  }
  assert.ok(engine.includes("public synchronized Result predict("),
    "pinned engine must implement synchronous native ONNX step");
  assert.ok(engine.includes("new Me111Contract.State"),
    "pinned engine must propagate source-local persistent state");
  assert.ok(engine.includes("environment.createSession(model, options)"),
    "pinned ONNX asset must be embedded/loaded locally");
  assert.ok(!engine.includes("HttpURLConnection"), "unexpected network client");
});

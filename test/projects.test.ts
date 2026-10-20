import { test } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { join } from "node:path";

// projects.ts imports vscode for workspace search; readProject itself doesn't need it.
const load = (Module as any)._load;
(Module as any)._load = function (req: string, ...rest: any[]) {
  return req === "vscode" ? {} : load.call(this, req, ...rest);
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readProject } = require("../src/projects");

test("readProject reads a generated cmake_gcc/CMakePresets.json", () => {
  const presets = join(__dirname, "..", "..", "test", "fixtures", "CMakePresets.json");
  const p = readProject(presets);
  assert.equal(p.workflowPreset, "project");
  assert.equal(p.configuration, "base");
  assert.equal(p.name, "test"); // folder above the presets' folder
});

test("readProject returns undefined for a missing file", () => {
  assert.equal(readProject("/nonexistent/cmake_gcc/CMakePresets.json"), undefined);
});

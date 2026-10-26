import { formatMemory, gpuVisualState } from "./gpuState";

describe("gpuVisualState", () => {
  it.each([
    ["healthy", "idle", "idle"],
    ["healthy", "reserved", "reserved"],
    ["healthy", "running", "running"],
    ["error", "idle", "error"],
    ["error", "running", "error"],
    ["offline", "running", "offline"],
    ["offline", "idle", "offline"],
  ] as const)("health=%s activity=%s → %s", (health, activity, expected) => {
    expect(gpuVisualState({ health, activity })).toBe(expected);
  });
});

describe("formatMemory", () => {
  it.each([
    [512, "512 MiB"],
    [8192, "8 GiB"],
    [24576, "24 GiB"],
    [12800, "12.5 GiB"],
  ])("%d MiB → %s", (mib, text) => {
    expect(formatMemory(mib)).toBe(text);
  });
});

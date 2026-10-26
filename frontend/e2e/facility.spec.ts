import { expect, test, type Page } from "@playwright/test";

import type { FleetSnapshot } from "../src/api/fleet";
import { computeFacilityLayout, VIEW_WIDTH } from "../src/facility/layout";
import { makeGpu, simulatedFleet } from "../src/test/fleetFixture";

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

/** Click the centre of a GPU board on the canvas, using the same layout the scene uses. */
async function clickGpuInScene(page: Page, fleet: FleetSnapshot, gpuId: string) {
  const canvas = page.locator(".facility__canvas canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas has no bounding box");
  const slot = computeFacilityLayout(fleet.gpus, fleet.workers)
    .racks.flatMap((rack) => rack.gpus)
    .find((g) => g.gpuId === gpuId);
  if (!slot) throw new Error(`${gpuId} is not in the layout`);
  const scale = box.width / VIEW_WIDTH;
  await page.mouse.click(
    box.x + (slot.x + slot.width / 2) * scale,
    box.y + (slot.y + slot.height / 2) * scale,
  );
}

const inspectorHeading = (page: Page) =>
  page.getByRole("complementary").getByRole("heading", { level: 2 });

test("the facility renders the backend's GPUs and clicking one opens it", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");

  await expect(page.locator(".facility__canvas canvas")).toBeVisible();
  // StrictMode mounts twice in development; exactly one game must survive.
  await page.waitForTimeout(500);
  await expect(page.locator("canvas")).toHaveCount(1);
  const roster = page.getByRole("region", { name: "Fleet roster" });
  await expect(roster.getByRole("button")).toHaveCount(6);

  const fleet = (await (await page.request.get("/api/fleet")).json()) as FleetSnapshot;
  for (const gpuId of ["GPU-03", "GPU-06", "GPU-01"]) {
    await clickGpuInScene(page, fleet, gpuId);
    await expect(inspectorHeading(page)).toHaveText(gpuId);
    await expect(roster.getByRole("button", { name: new RegExp(gpuId) })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }

  expect(errors).toEqual([]);
});

test("every visual state renders without errors", async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const fleet = simulatedFleet();
  fleet.gpus[0] = makeGpu({ ...fleet.gpus[0]!, activity: "running", current_task_id: "task-1" });
  fleet.gpus[1] = makeGpu({ ...fleet.gpus[1]!, activity: "reserved" });
  await page.route("**/api/fleet", (route) => route.fulfill({ json: fleet }));

  await page.goto("/");
  await expect(page.locator(".facility__canvas canvas")).toBeVisible();
  await page.getByRole("button", { name: /GPU-01/ }).click();
  await page.waitForTimeout(600);

  await testInfo.attach("all-states", {
    body: await page.locator(".facility").screenshot(),
    contentType: "image/png",
  });
  await expect(inspectorHeading(page)).toHaveText("GPU-01");
  expect(errors).toEqual([]);
});

test("the app stays usable when the scene cannot load", async ({ page }) => {
  await page.route(/\/(phaser|createFacilityGame)[^/]*$/, (route) => route.abort());
  await page.goto("/");

  await expect(page.getByText(/facility view couldn't start/)).toBeVisible();
  await page.getByRole("button", { name: /GPU-02/ }).click();
  await expect(inspectorHeading(page)).toHaveText("GPU-02");
});

test("reduced motion still renders the facility", async ({ page }) => {
  const errors = collectErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await expect(page.locator(".facility__canvas canvas")).toBeVisible();
  await page.getByRole("button", { name: /GPU-05/ }).click();
  await expect(inspectorHeading(page)).toHaveText("GPU-05");
  expect(errors).toEqual([]);
});

test("narrow screens stack facility, inspector and roster", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.locator(".facility__canvas canvas")).toBeVisible();
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: /GPU-04/ }).click();
  await expect(inspectorHeading(page)).toHaveText("GPU-04");
});

import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

const unique = (label: string) =>
  `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const taskRow = (page: Page, note: string) =>
  page.getByRole("region", { name: "Tasks" }).getByRole("button", { name: new RegExp(note) });
const chip = (page: Page) => page.locator(".topbar .chip");

test("a task created elsewhere shows up and runs without a reload", async ({ page, request }) => {
  await page.goto("/");
  await expect(chip(page)).toContainText("Live");

  const note = unique("external");
  const created = await request.post("/api/tasks", {
    data: { prompt: note, workload: { type: "echo", message: "hi" } },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };

  await expect(taskRow(page, note)).toBeVisible({ timeout: 3000 });
  await expect(taskRow(page, note)).toContainText("Succeeded", { timeout: 20_000 });

  // Every view agrees on the outcome.
  const task = (await (await request.get(`/api/tasks/${id}`)).json()) as {
    assigned_gpu_id: string;
  };
  await taskRow(page, note).click();
  const inspector = page.getByRole("complementary");
  await expect(inspector.locator(".inspector__header .status-pill")).toHaveText("Succeeded");
  await expect(inspector.getByRole("region", { name: /Scheduler decision/ })).toContainText(
    `Picked ${task.assigned_gpu_id}`,
  );
  const feed = page.getByRole("region", { name: "Activity" });
  await expect(
    feed.getByRole("button", { name: new RegExp(`Succeeded Echo ${id.slice(5, 11)}`) }),
  ).toBeVisible();
});

test("refreshes are driven by change notifications, not a timer", async ({ page }) => {
  let changed = 0;
  let hellos = 0;
  let snapshots = 0;
  let polls = 0;
  page.on("websocket", (ws) =>
    ws.on("framereceived", ({ payload }) => {
      const type = (JSON.parse(String(payload)) as { type: string }).type;
      if (type === "changed") changed++;
      if (type === "hello") hellos++;
    }),
  );
  page.on("request", (req) => {
    const path = new URL(req.url()).pathname;
    if (path === "/api/live/snapshot") snapshots++;
    if (path === "/api/fleet" || path === "/api/tasks") polls++;
  });

  await page.goto("/");
  await expect(chip(page)).toContainText("Live");
  await page.waitForTimeout(4000);

  expect(polls).toBe(0);
  // One initial load, then at most one fetch per hello or change notification.
  expect(snapshots).toBeLessThanOrEqual(1 + hellos + changed);
});

test("recovers after the live connection drops", async ({ page, request }) => {
  let current: WebSocketRoute | null = null;
  await page.routeWebSocket(/\/api\/live$/, (ws) => {
    current = ws;
    ws.connectToServer();
  });

  await page.goto("/");
  await expect(chip(page)).toContainText("Live");

  // Cut the connection, then change things while the page can't hear about it.
  await current!.close();
  await expect(chip(page)).toContainText("Reconnecting");
  const note = unique("missed");
  await request.post("/api/tasks", {
    data: { prompt: note, workload: { type: "echo", message: "hi" } },
  });

  await expect(chip(page)).toContainText("Live", { timeout: 5000 });
  await expect(taskRow(page, note)).toBeVisible({ timeout: 5000 });

  // The feed backfilled what it missed, once.
  const feedTimes = await page
    .locator(".feed__item")
    .evaluateAll((items) => items.map((item) => item.textContent));
  expect(new Set(feedTimes).size).toBe(feedTimes.length);
});

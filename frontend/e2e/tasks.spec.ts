import { expect, test, type Page } from "@playwright/test";

// Tests share one backend and its GPUs, so each uses a unique note to find its own
// task, and cancels long-running work when done.
const unique = (label: string) =>
  `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function submit(
  page: Page,
  note: string,
  workload: "Echo" | "GPU benchmark",
  fill: (terminal: ReturnType<Page["getByRole"]>) => Promise<void>,
) {
  const terminal = page.getByRole("region", { name: "Command terminal" });
  await terminal.getByRole("radio", { name: workload }).check();
  await fill(terminal);
  await terminal.getByLabel("Note (optional)").fill(note);
  await terminal.getByRole("button", { name: "Submit ▶" }).click();
  await expect(terminal.getByRole("status")).toContainText("queued");
}

const inspector = (page: Page) => page.getByRole("complementary");
const statusPill = (page: Page) => inspector(page).locator(".inspector__header .status-pill");

test("a task runs to completion and survives a page reload", async ({ page }) => {
  const note = unique("echo");
  await page.goto("/");
  await submit(page, note, "Echo", (t) => t.getByLabel("Message").fill("hello from the browser"));

  await expect(statusPill(page)).toHaveText("Succeeded", { timeout: 20_000 });
  await expect(
    inspector(page).getByText('"message": "hello from the browser"').first(),
  ).toBeVisible();
  await expect(inspector(page).getByText(/Finished on GPU-0\d\. Released GPU-0\d\./)).toBeVisible();

  await page.reload();
  const row = page
    .getByRole("region", { name: "Tasks" })
    .getByRole("button", { name: new RegExp(note) });
  await expect(row).toContainText("Succeeded");
});

test("the backend places a task, its GPU lights up, and cancelling frees it", async ({
  page,
}, testInfo) => {
  const note = unique("bench");
  await page.goto("/");
  await submit(page, note, "GPU benchmark", (t) => t.getByLabel("Duration (s)").fill("120"));

  await expect(statusPill(page)).toHaveText("Running", { timeout: 20_000 });
  const decision = inspector(page).getByRole("region", { name: /Scheduler decision/ });
  await expect(decision).toContainText("Scheduler decision · Placed");
  await expect(decision).toContainText("best_fit_memory");
  const gpuId = (await decision.locator(".candidates__selected th").textContent())?.trim() ?? "";
  expect(gpuId).toMatch(/^GPU-0\d$/);

  const roster = page.getByRole("region", { name: "Fleet roster" });
  await expect(roster.getByRole("button", { name: new RegExp(gpuId) })).toContainText("Running");
  await testInfo.attach("running", {
    body: await page.locator(".facility").screenshot(),
    contentType: "image/png",
  });

  // The GPU's inspector links back to the task it's running.
  await roster.getByRole("button", { name: new RegExp(gpuId) }).click();
  const taskId = await inspector(page)
    .getByRole("button", { name: /^task_/ })
    .textContent();
  await inspector(page)
    .getByRole("button", { name: /^task_/ })
    .click();
  await expect(inspector(page).getByText(taskId ?? "missing")).toBeVisible();

  await inspector(page).getByRole("button", { name: "Request cancel" }).click();
  await expect(statusPill(page)).toHaveText("Cancelled", { timeout: 10_000 });
  await expect(
    inspector(page).getByText(/Stopped by the worker after a cancel request/),
  ).toBeVisible();
  await expect(roster.getByRole("button", { name: new RegExp(gpuId) })).not.toContainText(
    "Running",
    {
      timeout: 10_000,
    },
  );

  const again = await page.request.post(`/api/tasks/${taskId}/cancel`);
  expect(again.status()).toBe(409);
});

test("an impossible memory requirement is explained", async ({ page }) => {
  const note = unique("huge");
  await page.goto("/");
  await submit(page, note, "Echo", async (t) => {
    await t.getByLabel("Message").fill("hi");
    await t.getByLabel("Min memory (GiB)").fill("64");
  });

  await expect(statusPill(page)).toHaveText("Failed", { timeout: 20_000 });
  await expect(inspector(page).getByRole("region", { name: /Scheduler decision/ })).toContainText(
    "No GPU satisfies the 64 GiB memory requirement. The largest is 24 GiB (GPU-01, GPU-02).",
  );
});

test("the backend rejects workloads outside the allowlist", async ({ request }) => {
  const response = await request.post("/api/tasks", {
    data: { workload: { type: "shell", command: "rm -rf /" } },
  });

  expect(response.status()).toBe(422);
  expect((await response.json()).error.code).toBe("unsupported_workload");
});

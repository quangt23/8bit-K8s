import { expect, test, type Page } from "@playwright/test";

// Tests share one backend, so each uses a unique note to find its own task.
const unique = (label: string) =>
  `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function submitEcho(page: Page, note: string, message = "hello from the browser") {
  const terminal = page.getByRole("region", { name: "Command terminal" });
  await terminal.getByRole("radio", { name: "Echo" }).check();
  await terminal.getByLabel("Message").fill(message);
  await terminal.getByLabel("Note (optional)").fill(note);
  await terminal.getByRole("button", { name: "Submit ▶" }).click();
  await expect(terminal.getByRole("status")).toContainText("queued");
}

test("a submitted task is stored by the backend and survives a page reload", async ({ page }) => {
  const note = unique("persist");
  await page.goto("/");
  await submitEcho(page, note);

  const inspector = page.getByRole("complementary");
  await expect(inspector.getByText(note)).toBeVisible();
  await expect(inspector.getByText("Task accepted and queued.")).toBeVisible();

  await page.reload();
  const row = page
    .getByRole("region", { name: "Tasks" })
    .getByRole("button", { name: new RegExp(note) });
  await expect(row).toContainText("Queued");

  // The backend agrees.
  const listed = (await (await page.request.get("/api/tasks?limit=200")).json()) as {
    tasks: { prompt: string | null; status: string }[];
  };
  expect(listed.tasks.find((t) => t.prompt === note)?.status).toBe("queued");
});

test("a queued task can be cancelled, and cancelling again is refused", async ({ page }) => {
  const note = unique("cancel");
  await page.goto("/");
  await submitEcho(page, note);

  const inspector = page.getByRole("complementary");
  await inspector.getByRole("button", { name: "Cancel task" }).click();
  await expect(inspector.getByText("Cancelled before it started running.")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Tasks" }).getByRole("button", { name: new RegExp(note) }),
  ).toContainText("Cancelled");

  const id = (await inspector.locator(".inspector__device code").textContent()) ?? "";
  const again = await page.request.post(`/api/tasks/${id}/cancel`);
  expect(again.status()).toBe(409);
  expect((await again.json()).error.code).toBe("invalid_transition");
});

test("the backend rejects workloads outside the allowlist", async ({ request }) => {
  const response = await request.post("/api/tasks", {
    data: { workload: { type: "shell", command: "rm -rf /" } },
  });

  expect(response.status()).toBe(422);
  expect((await response.json()).error.code).toBe("unsupported_workload");
});

import type { FeedEvent } from "../api/live";
import { FEED_LIMIT, mergeFeed } from "./useLive";

const event = (id: number): FeedEvent => ({
  id,
  task_id: `task_${id}`,
  timestamp: "2026-10-25T12:00:00Z",
  kind: "status",
  level: "info",
  message: "",
  from_status: null,
  to_status: "queued",
  data: null,
  workload_type: "echo",
  gpu_id: null,
});

describe("mergeFeed", () => {
  it("keeps events in ID order without duplicates", () => {
    const merged = mergeFeed(
      [event(1), event(2), event(3)],
      [event(3), event(2), event(5), event(4)],
    );

    expect(merged.map((e) => e.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps only the most recent events", () => {
    const many = Array.from({ length: FEED_LIMIT + 10 }, (_, i) => event(i + 1));

    const merged = mergeFeed([], many);

    expect(merged).toHaveLength(FEED_LIMIT);
    expect(merged[0]!.id).toBe(11);
  });

  it("returns the same array when nothing is new", () => {
    const feed = [event(1)];
    expect(mergeFeed(feed, [])).toBe(feed);
  });
});

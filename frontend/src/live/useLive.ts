import { useCallback, useEffect, useRef, useState } from "react";

import { fetchSnapshot, liveSocketUrl, type FeedEvent, type LiveSnapshot } from "../api/live";
import type { Resource } from "../hooks/usePolledResource";
import {
  LiveConnection,
  type ConnectionStatus,
  type LiveConnectionOptions,
} from "./LiveConnection";

export const FEED_LIMIT = 200;
/** How often to resync while the WebSocket is down. */
export const FALLBACK_POLL_MS = 3_000;

export interface LiveState {
  snapshot: Resource<LiveSnapshot>;
  connection: ConnectionStatus;
  /** Activity feed, oldest first, deduplicated by event ID. */
  feed: FeedEvent[];
  refresh: () => Promise<void>;
}

/** Merge new events into the feed: by ID, so a replayed event never appears twice. */
export function mergeFeed(feed: FeedEvent[], incoming: FeedEvent[]): FeedEvent[] {
  if (incoming.length === 0) return feed;
  const byId = new Map(feed.map((e) => [e.id, e]));
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-FEED_LIMIT);
}

/**
 * The control room's live state. A WebSocket says when something changed; we then
 * fetch one consistent snapshot. Reconnecting also just fetches a snapshot, so a
 * client that was away for a while recovers exactly the current state.
 */
export function useLive(connectionOptions?: LiveConnectionOptions): LiveState {
  const [snapshot, setSnapshot] = useState<Resource<LiveSnapshot>>({ kind: "loading" });
  const [connection, setConnection] = useState<ConnectionStatus>({ state: "connecting" });
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const sync = useRef({
    inFlight: false,
    again: false,
    appliedRevision: -1,
    lastEventId: null as number | null,
    mounted: true,
  });

  const refresh = useCallback(async () => {
    const s = sync.current;
    if (s.inFlight) {
      s.again = true; // one more fetch after the current one covers this request
      return;
    }
    s.inFlight = true;
    try {
      do {
        s.again = false;
        const snap = await fetchSnapshot(s.lastEventId ?? undefined);
        if (!s.mounted) return;
        if (snap.events_truncated) {
          // Missed too much to backfill: start the feed over from the latest events.
          s.lastEventId = null;
          s.again = true;
          continue;
        }
        const resetFeed = s.lastEventId === null;
        s.lastEventId = snap.latest_event_id;
        s.appliedRevision = Math.max(s.appliedRevision, snap.revision);
        setSnapshot({ kind: "ready", data: snap, error: null });
        setFeed((prev) => (resetFeed ? mergeFeed([], snap.events) : mergeFeed(prev, snap.events)));
      } while (s.again && s.mounted);
    } catch (error) {
      if (!s.mounted) return;
      const message = error instanceof Error ? error.message : "Unknown error.";
      setSnapshot((prev) =>
        prev.kind === "ready" ? { ...prev, error: message } : { kind: "failed", error: message },
      );
    } finally {
      s.inFlight = false;
    }
  }, []);

  useEffect(() => {
    const s = sync.current;
    s.mounted = true;
    const live = new LiveConnection(
      liveSocketUrl(),
      {
        onHello: () => void refresh(),
        onChanged: (revision) => {
          if (revision > s.appliedRevision) void refresh();
        },
        onStatus: setConnection,
      },
      connectionOptions,
    );
    // Connect on the next tick: React StrictMode's immediate unmount in development then
    // cancels the timer instead of closing a socket that is still connecting.
    const first = setTimeout(() => {
      live.start();
      void refresh();
    }, 0);
    return () => {
      s.mounted = false;
      clearTimeout(first);
      live.stop();
    };
    // connectionOptions is read once, at connect time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  // Without a live socket, fall back to polling so the UI never silently freezes.
  const isLive = connection.state === "live";
  useEffect(() => {
    if (isLive) return;
    const timer = setInterval(() => void refresh(), FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [isLive, refresh]);

  return { snapshot, connection, feed, refresh };
}

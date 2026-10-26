import { vi } from "vitest";

import { defaultBackoff, LiveConnection, type ConnectionStatus } from "./LiveConnection";

class Socket {
  static instances: Socket[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    Socket.instances.push(this);
  }

  send(message: unknown) {
    this.onmessage?.({
      data: typeof message === "string" ? message : JSON.stringify(message),
    } as MessageEvent);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
}

function setup(options: { heartbeatTimeoutMs?: number } = {}) {
  Socket.instances = [];
  const statuses: ConnectionStatus[] = [];
  const hello = vi.fn();
  const changed = vi.fn();
  const connection = new LiveConnection(
    "ws://test/api/live",
    { onHello: hello, onChanged: changed, onStatus: (s) => statuses.push(s) },
    { WebSocketImpl: Socket as unknown as typeof WebSocket, ...options },
  );
  connection.start();
  const latest = () => Socket.instances.at(-1)!;
  return { connection, statuses, hello, changed, latest };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("LiveConnection", () => {
  it("goes live on hello and forwards change notifications", () => {
    const { statuses, hello, changed, latest } = setup();

    latest().send({ type: "hello", revision: 4 });
    latest().send({ type: "changed", revision: 5 });
    latest().send({ type: "ping", revision: 5 });
    latest().send("not json");

    expect(statuses).toEqual([{ state: "connecting" }, { state: "live" }]);
    expect(hello).toHaveBeenCalledWith(4);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith(5);
  });

  it("reconnects with exponential backoff and resets after success", () => {
    const { statuses, latest } = setup();

    latest().close();
    expect(statuses.at(-1)).toEqual({ state: "reconnecting", attempt: 1, retryInMs: 500 });
    vi.advanceTimersByTime(499);
    expect(Socket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(Socket.instances).toHaveLength(2);

    latest().close();
    expect(statuses.at(-1)).toEqual({ state: "reconnecting", attempt: 2, retryInMs: 1000 });
    vi.advanceTimersByTime(1000);
    latest().send({ type: "hello", revision: 1 });
    expect(statuses.at(-1)).toEqual({ state: "live" });

    latest().close();
    expect(statuses.at(-1)).toEqual({ state: "reconnecting", attempt: 1, retryInMs: 500 });
  });

  it("caps the backoff", () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(defaultBackoff)).toEqual([
      500, 1000, 2000, 4000, 8000, 10000, 10000,
    ]);
  });

  it("treats a silent connection as dead", () => {
    const { statuses, latest } = setup({ heartbeatTimeoutMs: 1000 });
    latest().send({ type: "hello", revision: 0 });

    vi.advanceTimersByTime(999);
    expect(statuses.at(-1)).toEqual({ state: "live" });
    vi.advanceTimersByTime(1);

    expect(Socket.instances[0]!.closed).toBe(true);
    expect(statuses.at(-1)).toMatchObject({ state: "reconnecting", attempt: 1 });
  });

  it("stops for good when stopped", () => {
    const { connection, latest } = setup();

    connection.stop();
    vi.advanceTimersByTime(60_000);

    expect(latest().closed).toBe(true);
    expect(Socket.instances).toHaveLength(1);
  });
});

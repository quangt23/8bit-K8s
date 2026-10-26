/**
 * A WebSocket that tells us *when* to resync, never *what* changed.
 *
 * Messages: `hello` (just connected), `changed` (state changed since), `ping`
 * (idle keep-alive). The connection reconnects with exponential backoff, and a
 * watchdog closes sockets that go silent (e.g. a sleeping laptop).
 */

export type ConnectionStatus =
  | { state: "connecting" }
  | { state: "live" }
  | { state: "reconnecting"; attempt: number; retryInMs: number };

export interface LiveHandlers {
  onHello(revision: number): void;
  onChanged(revision: number): void;
  onStatus(status: ConnectionStatus): void;
}

export interface LiveConnectionOptions {
  /** Close and reconnect if nothing (not even a ping) arrives for this long. */
  heartbeatTimeoutMs?: number;
  backoffMs?: (attempt: number) => number;
  WebSocketImpl?: typeof WebSocket;
}

export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 40_000;

export function defaultBackoff(attempt: number): number {
  return Math.min(10_000, 500 * 2 ** (attempt - 1));
}

interface Message {
  type: string;
  revision?: number;
}

export class LiveConnection {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private readonly heartbeatTimeoutMs: number;
  private readonly backoffMs: (attempt: number) => number;
  private readonly WebSocketImpl: typeof WebSocket;

  constructor(
    private readonly url: string,
    private readonly handlers: LiveHandlers,
    options: LiveConnectionOptions = {},
  ) {
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    this.backoffMs = options.backoffMs ?? defaultBackoff;
    this.WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
  }

  start(): void {
    this.stopped = false;
    this.handlers.onStatus({ state: "connecting" });
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private open(): void {
    let socket: WebSocket;
    try {
      socket = new this.WebSocketImpl(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.armWatchdog();
    socket.onmessage = (event) => this.onMessage(socket, event);
    socket.onclose = () => this.onClosed(socket);
    socket.onerror = () => socket.close();
  }

  private onMessage(socket: WebSocket, event: MessageEvent): void {
    if (socket !== this.socket) return;
    this.armWatchdog();
    let message: Message;
    try {
      message = JSON.parse(String(event.data)) as Message;
    } catch {
      return;
    }
    const revision = typeof message.revision === "number" ? message.revision : 0;
    if (message.type === "hello") {
      this.attempt = 0;
      this.handlers.onStatus({ state: "live" });
      this.handlers.onHello(revision);
    } else if (message.type === "changed") {
      this.handlers.onChanged(revision);
    }
  }

  private onClosed(socket: WebSocket): void {
    if (socket !== this.socket) return;
    this.socket = null;
    if (!this.stopped) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.clearTimers();
    this.attempt += 1;
    const retryInMs = this.backoffMs(this.attempt);
    this.handlers.onStatus({ state: "reconnecting", attempt: this.attempt, retryInMs });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) this.open();
    }, retryInMs);
  }

  private armWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      // Silent too long: assume the connection is dead. Don't wait for close() to
      // finish its handshake, which never completes on a dead network.
      const socket = this.socket;
      this.socket = null;
      socket?.close();
      if (!this.stopped) this.scheduleReconnect();
    }, this.heartbeatTimeoutMs);
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.watchdog) clearTimeout(this.watchdog);
    this.retryTimer = null;
    this.watchdog = null;
  }
}

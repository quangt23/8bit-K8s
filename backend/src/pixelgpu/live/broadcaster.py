"""Tells connected clients that something changed.

Every database commit, from any thread (API, scheduler, workers), calls
``notify``. The broadcaster coalesces bursts (e.g. progress ticks) and sends each
WebSocket client a small ``{"type": "changed", "revision": n}`` message. Clients
then fetch one consistent snapshot. Messages carry no state of their own, so they
can't arrive stale or out of order in a way that matters.
"""

import asyncio
import contextlib
import logging
from typing import Any

logger = logging.getLogger(__name__)

Message = dict[str, Any]

CLIENT_QUEUE_SIZE = 32
DISCONNECT: Message = {"type": "_disconnect"}


class LiveBroadcaster:
    def __init__(self, debounce_seconds: float = 0.05) -> None:
        self.debounce_seconds = debounce_seconds
        self.revision = 0
        self._loop: asyncio.AbstractEventLoop | None = None
        self._dirty: asyncio.Event | None = None
        self._clients: set[asyncio.Queue[Message]] = set()
        self._task: asyncio.Task[None] | None = None

    # ----- lifecycle (event loop thread) -----

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._dirty = asyncio.Event()
        self._task = asyncio.create_task(self._run(), name="pixelgpu-live-broadcaster")

    async def stop(self) -> None:
        self._loop = None
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        for queue in list(self._clients):
            self._offer(queue, DISCONNECT)

    # ----- any thread -----

    def notify(self) -> None:
        """Record that state changed. Safe to call from any thread, at any rate."""
        loop, dirty = self._loop, self._dirty
        if loop is None or dirty is None or loop.is_closed():
            return
        with contextlib.suppress(RuntimeError):  # the loop is shutting down
            loop.call_soon_threadsafe(dirty.set)

    # ----- clients (event loop thread) -----

    def subscribe(self) -> asyncio.Queue[Message]:
        queue: asyncio.Queue[Message] = asyncio.Queue(maxsize=CLIENT_QUEUE_SIZE)
        self._clients.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[Message]) -> None:
        self._clients.discard(queue)

    @property
    def client_count(self) -> int:
        return len(self._clients)

    async def _run(self) -> None:
        assert self._dirty is not None
        while True:
            await self._dirty.wait()
            # Let a burst of commits finish, then announce them once.
            await asyncio.sleep(self.debounce_seconds)
            self._dirty.clear()
            self.revision += 1
            message: Message = {"type": "changed", "revision": self.revision}
            for queue in list(self._clients):
                self._offer(queue, message)

    def _offer(self, queue: asyncio.Queue[Message], message: Message) -> None:
        try:
            queue.put_nowait(message)
        except asyncio.QueueFull:
            # A client this far behind is better off reconnecting and resyncing.
            logger.warning("Dropping a live client that stopped reading")
            self._clients.discard(queue)
            while not queue.empty():
                queue.get_nowait()
            queue.put_nowait(DISCONNECT)

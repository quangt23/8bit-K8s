"""Live updates: a WebSocket that says "something changed", and the endpoints a
client reads afterwards: one consistent snapshot, the activity feed, metrics."""

import asyncio
import contextlib
from datetime import UTC, datetime
from typing import Annotated, cast

from fastapi import APIRouter, Query, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy import select

from pixelgpu.api.deps import FleetDep, SessionDep, TaskServiceDep
from pixelgpu.api.fleet import FleetSnapshot
from pixelgpu.fleet.live import live_gpus, live_workers
from pixelgpu.live.broadcaster import DISCONNECT, LiveBroadcaster
from pixelgpu.live.feed import MAX_EVENTS, FeedEvent, FeedPage, read_feed
from pixelgpu.live.metrics import Metrics, compute_metrics
from pixelgpu.tasks.lifecycle import ACTIVE_STATUSES
from pixelgpu.tasks.models import TaskRecord
from pixelgpu.tasks.schemas import TaskRead

router = APIRouter(tags=["live"])

RECENT_TASKS = 50
HEARTBEAT_SECONDS = 15.0

EventsAfter = Annotated[
    int | None,
    Query(ge=0, description="Return events after this ID (oldest first); omit for the latest."),
]


class LiveSnapshot(BaseModel):
    """Everything the control room shows, read in one database transaction."""

    generated_at: datetime
    revision: int
    """Includes every change announced with this revision or earlier."""
    fleet: FleetSnapshot
    tasks: list[TaskRead]
    """Every active task plus the most recent finished ones, newest first."""
    total_tasks: int
    metrics: Metrics
    events: list[FeedEvent]
    latest_event_id: int
    events_truncated: bool


@router.get("/live/snapshot", response_model=LiveSnapshot)
def live_snapshot(
    request: Request,
    fleet: FleetDep,
    session: SessionDep,
    service: TaskServiceDep,
    events_after: EventsAfter = None,
) -> LiveSnapshot:
    # Read the revision before the data: anything announced up to it was already
    # committed, so the reads below include it.
    revision = cast(LiveBroadcaster, request.app.state.broadcaster).revision
    now = datetime.now(UTC)
    gpus = live_gpus(session, fleet)
    active = session.scalars(
        select(TaskRecord).where(TaskRecord.status.in_(list(ACTIVE_STATUSES)))
    ).all()
    recent, total = service.list(limit=RECENT_TASKS)
    by_id = {task.id: task for task in [*active, *recent]}
    ordered = sorted(by_id.values(), key=lambda t: (t.created_at, t.id), reverse=True)
    positions = service.queue_positions()
    feed: FeedPage = read_feed(session, after=events_after)
    return LiveSnapshot(
        generated_at=now,
        revision=revision,
        fleet=FleetSnapshot(workers=live_workers(fleet), gpus=gpus, generated_at=now),
        tasks=[
            TaskRead.model_validate(t).model_copy(update={"queue_position": positions.get(t.id)})
            for t in ordered
        ],
        total_tasks=total,
        metrics=compute_metrics(session, gpus, now),
        events=feed.events,
        latest_event_id=feed.latest_event_id,
        events_truncated=feed.truncated,
    )


@router.get("/events", response_model=FeedPage)
def list_events(
    session: SessionDep,
    after: EventsAfter = None,
    limit: Annotated[int, Query(ge=1, le=MAX_EVENTS)] = MAX_EVENTS,
) -> FeedPage:
    return read_feed(session, after=after, limit=limit)


@router.get("/metrics", response_model=Metrics)
def get_metrics(fleet: FleetDep, session: SessionDep) -> Metrics:
    return compute_metrics(session, live_gpus(session, fleet), datetime.now(UTC))


@router.websocket("/live")
async def live(websocket: WebSocket) -> None:
    """Sends ``hello``, then ``changed`` after commits, and ``ping`` when idle.

    The server never sends state over this socket: on ``hello`` or ``changed`` the
    client fetches ``/api/live/snapshot``.
    """
    broadcaster = cast(LiveBroadcaster, websocket.app.state.broadcaster)
    await websocket.accept()
    queue = broadcaster.subscribe()
    try:
        await websocket.send_json({"type": "hello", "revision": broadcaster.revision})
        while True:
            try:
                message = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
            except TimeoutError:
                message = {"type": "ping", "revision": broadcaster.revision}
            if message is DISCONNECT:
                await websocket.close(code=1013)  # try again later
                return
            await websocket.send_json(message)
    except (WebSocketDisconnect, RuntimeError):
        pass  # client went away; it will reconnect and resync
    finally:
        broadcaster.unsubscribe(queue)
        with contextlib.suppress(RuntimeError):
            await websocket.close()

"""The task lifecycle state machine.

    queued ──► scheduled ──► running ──► succeeded
       │           │            │
       └───────────┴────────────┴──► failed / cancelled

Only the transitions below are legal. Terminal states never change again.
"""

from enum import StrEnum


class TaskStatus(StrEnum):
    QUEUED = "queued"
    SCHEDULED = "scheduled"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


ALLOWED_TRANSITIONS: dict[TaskStatus, frozenset[TaskStatus]] = {
    TaskStatus.QUEUED: frozenset({TaskStatus.SCHEDULED, TaskStatus.FAILED, TaskStatus.CANCELLED}),
    TaskStatus.SCHEDULED: frozenset({TaskStatus.RUNNING, TaskStatus.FAILED, TaskStatus.CANCELLED}),
    TaskStatus.RUNNING: frozenset({TaskStatus.SUCCEEDED, TaskStatus.FAILED, TaskStatus.CANCELLED}),
    TaskStatus.SUCCEEDED: frozenset(),
    TaskStatus.FAILED: frozenset(),
    TaskStatus.CANCELLED: frozenset(),
}

TERMINAL_STATUSES = frozenset(s for s, targets in ALLOWED_TRANSITIONS.items() if not targets)
ACTIVE_STATUSES = frozenset(TaskStatus) - TERMINAL_STATUSES


class InvalidTransitionError(Exception):
    def __init__(self, task_id: str, current: TaskStatus, target: TaskStatus) -> None:
        self.task_id = task_id
        self.current = current
        self.target = target
        super().__init__(f"Task {task_id} cannot move from '{current}' to '{target}'.")


def can_transition(current: TaskStatus, target: TaskStatus) -> bool:
    return target in ALLOWED_TRANSITIONS[current]


def ensure_transition(task_id: str, current: TaskStatus, target: TaskStatus) -> None:
    if not can_transition(current, target):
        raise InvalidTransitionError(task_id, current, target)

"""What a running workload can do: report progress, log, and pass time.

Waiting goes through ``ExecutionContext.sleep``, which notices cancellation
requests and the task timeout between short slices of real time.
"""

import time
from collections.abc import Callable

from pixelgpu.tasks.service import TaskService


class TaskCancelledError(Exception):
    """The user asked for the task to stop."""


class TaskTimeoutError(Exception):
    def __init__(self, timeout_seconds: float) -> None:
        self.timeout_seconds = timeout_seconds
        super().__init__(f"Exceeded the {timeout_seconds:g} s time limit.")


class WorkloadFailedError(Exception):
    """The workload itself failed, with a message meant for the user."""


SLICE_SECONDS = 0.05


class ExecutionContext:
    def __init__(
        self,
        service: TaskService,
        task_id: str,
        *,
        speed: float,
        timeout_seconds: float,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.service = service
        self.task_id = task_id
        self.speed = speed
        self.timeout_seconds = timeout_seconds
        self._sleep = sleep
        self.elapsed = 0.0
        """Simulated seconds of work done so far."""

    def log(self, message: str, level: str = "info") -> None:
        self.service.log(self.task_id, message, level=level)

    def progress(self, fraction: float) -> None:
        self.service.set_progress(self.task_id, fraction)

    def check(self) -> None:
        if self.service.cancel_requested(self.task_id):
            raise TaskCancelledError()
        if self.elapsed > self.timeout_seconds:
            raise TaskTimeoutError(self.timeout_seconds)

    def sleep(self, seconds: float) -> None:
        """Spend ``seconds`` of simulated time; real time is divided by ``speed``."""
        remaining = seconds
        while remaining > 0:
            self.check()
            step = min(remaining, SLICE_SECONDS * self.speed)
            self._sleep(step / self.speed)
            self.elapsed += step
            remaining -= step
        self.check()

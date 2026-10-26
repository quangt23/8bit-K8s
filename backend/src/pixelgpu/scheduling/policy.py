"""Placement: which GPUs could run a task, and which one it gets.

Pure functions over a snapshot of the fleet, so the policy can be tested in
isolation and swapped without touching the database, the API or the UI.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from pydantic import BaseModel

from pixelgpu.fleet.models import GpuDevice, Worker


def gib(mib: int) -> str:
    value = mib / 1024
    return f"{value:g} GiB" if mib >= 1024 else f"{mib} MiB"


@dataclass(frozen=True)
class Requirements:
    workload_type: str
    min_memory_mb: int


@dataclass(frozen=True)
class GpuState:
    """What the scheduler needs to know about one GPU right now."""

    gpu: GpuDevice
    worker: Worker | None
    reserved_by: str | None


class Candidate(BaseModel):
    gpu_id: str
    worker_id: str
    memory_total_mb: int
    eligible: bool
    reason: str | None
    """Why the GPU was rejected; None when eligible."""


class SchedulingDecision(BaseModel):
    """Everything needed to explain a placement, or the lack of one, after the fact."""

    outcome: Literal["scheduled", "waiting", "unschedulable"]
    policy: str
    decided_at: datetime
    workload_type: str
    min_memory_mb: int
    selected_gpu_id: str | None
    selected_worker_id: str | None
    candidates: list[Candidate]
    explanation: str


def capability_reason(state: GpuState, req: Requirements) -> str | None:
    """Reasons that won't change by waiting: the GPU can never run this task."""
    worker = state.worker
    if worker is None:
        return f"Worker {state.gpu.worker_id} is not registered."
    if req.workload_type not in worker.supported_workloads:
        return f"Worker {worker.id} doesn't support '{req.workload_type}'."
    if state.gpu.memory_total_mb < req.min_memory_mb:
        return f"Has {gib(state.gpu.memory_total_mb)}; needs {gib(req.min_memory_mb)}."
    return None


def availability_reason(state: GpuState) -> str | None:
    """Reasons that may clear later: the GPU is capable but not usable right now."""
    if state.worker is not None and state.worker.status != "online":
        return f"Worker {state.worker.id} is offline."
    if state.gpu.health == "offline":
        return "Device is offline."
    if state.gpu.health == "error":
        detail = f": {state.gpu.health_reason}" if state.gpu.health_reason else "."
        return f"Device is reporting an error{detail}"
    if state.reserved_by is not None:
        return f"Busy with {state.reserved_by}."
    return None


def evaluate(states: list[GpuState], req: Requirements) -> list[Candidate]:
    """Check every GPU, in ID order, and say why each one can or can't take the task."""
    candidates = []
    for state in sorted(states, key=lambda s: s.gpu.id):
        reason = capability_reason(state, req) or availability_reason(state)
        candidates.append(
            Candidate(
                gpu_id=state.gpu.id,
                worker_id=state.gpu.worker_id,
                memory_total_mb=state.gpu.memory_total_mb,
                eligible=reason is None,
                reason=reason,
            )
        )
    return candidates


class SchedulingPolicy(Protocol):
    name: str

    def choose(self, eligible: list[Candidate], req: Requirements) -> tuple[Candidate, str]:
        """Pick one of the (non-empty) eligible candidates and explain why."""
        ...


class BestFitPolicy:
    """Smallest GPU that satisfies the memory requirement; ties broken by GPU ID.

    GPUs are exclusive (one task each), so every eligible GPU is equally idle and
    "least loaded" can't separate them. Best fit keeps the large GPUs free for
    tasks that actually need them.
    """

    name = "best_fit_memory"

    def choose(self, eligible: list[Candidate], req: Requirements) -> tuple[Candidate, str]:
        chosen = min(eligible, key=lambda c: (c.memory_total_mb, c.gpu_id))
        others = len(eligible) - 1
        explanation = (
            f"Picked {chosen.gpu_id}: the smallest free GPU with at least "
            f"{gib(req.min_memory_mb)} ({gib(chosen.memory_total_mb)}, best fit)."
        )
        if others == 1:
            explanation += " 1 other eligible GPU was larger or later by ID."
        elif others > 1:
            explanation += f" {others} other eligible GPUs were larger or later by ID."
        return chosen, explanation


def decide(
    states: list[GpuState], req: Requirements, policy: SchedulingPolicy, now: datetime
) -> SchedulingDecision:
    candidates = evaluate(states, req)
    eligible = [c for c in candidates if c.eligible]

    def decision(
        outcome: Literal["scheduled", "waiting", "unschedulable"],
        explanation: str,
        chosen: Candidate | None = None,
    ) -> SchedulingDecision:
        return SchedulingDecision(
            outcome=outcome,
            policy=policy.name,
            decided_at=now,
            workload_type=req.workload_type,
            min_memory_mb=req.min_memory_mb,
            selected_gpu_id=chosen.gpu_id if chosen else None,
            selected_worker_id=chosen.worker_id if chosen else None,
            candidates=candidates,
            explanation=explanation,
        )

    if eligible:
        chosen, explanation = policy.choose(eligible, req)
        return decision("scheduled", explanation, chosen)

    capable = [s for s in states if capability_reason(s, req) is None]
    if not capable:
        return decision("unschedulable", _unschedulable_explanation(states, req))
    return decision("waiting", _waiting_explanation(candidates, {s.gpu.id for s in capable}))


def _unschedulable_explanation(states: list[GpuState], req: Requirements) -> str:
    if not states:
        return "No GPUs are registered."
    supported = [
        s for s in states if s.worker and req.workload_type in s.worker.supported_workloads
    ]
    if not supported:
        return f"No worker supports the '{req.workload_type}' workload."
    largest = max(s.gpu.memory_total_mb for s in supported)
    ids = sorted(s.gpu.id for s in supported if s.gpu.memory_total_mb == largest)
    return (
        f"No GPU satisfies the {gib(req.min_memory_mb)} memory requirement. "
        f"The largest is {gib(largest)} ({', '.join(ids)})."
    )


def _waiting_explanation(candidates: list[Candidate], capable_ids: set[str]) -> str:
    blocked = [c for c in candidates if c.gpu_id in capable_ids]
    counts: dict[str, int] = {}
    for candidate in blocked:
        reason = candidate.reason or ""
        if reason.startswith("Busy with"):
            label = "busy"
        elif reason.startswith("Device is reporting an error"):
            label = "reporting an error"
        elif reason == "Device is offline.":
            label = "offline"
        else:
            label = "on an offline worker"
        counts[label] = counts.get(label, 0) + 1
    summary = ", ".join(f"{n} {label}" for label, n in counts.items())
    noun = "GPU" if len(blocked) == 1 else "GPUs"
    verb = "is" if len(blocked) == 1 else "are"
    return (
        f"Waiting for a GPU. The {len(blocked)} {noun} that could run this {verb} "
        f"unavailable: {summary}."
    )

from datetime import UTC, datetime

from pixelgpu.fleet.models import DeviceHealth, GpuDevice, Metric, RackLocation, Worker
from pixelgpu.scheduling.policy import BestFitPolicy, GpuState, Requirements, decide

NOW = datetime(2026, 10, 25, 12, 0, tzinfo=UTC)
ALL_WORKLOADS = ["echo", "text_summary", "sample_inference", "benchmark"]


def worker(
    worker_id: str = "w1", *, status: str = "online", supports: list[str] | None = None
) -> Worker:
    return Worker.model_validate(
        {
            "id": worker_id,
            "name": worker_id,
            "execution_mode": "simulated",
            "status": status,
            "rack": "A",
            "gpu_ids": [],
            "supported_workloads": ALL_WORKLOADS if supports is None else supports,
        }
    )


def state(
    gpu_id: str,
    memory_gb: int,
    *,
    health: DeviceHealth = "healthy",
    reserved_by: str | None = None,
    w: Worker | None = None,
) -> GpuState:
    w = w or worker()
    gpu = GpuDevice(
        id=gpu_id,
        name="Test",
        worker_id=w.id,
        execution_mode="simulated",
        location=RackLocation(rack="A", slot=int(gpu_id[-1])),
        memory_total_mb=memory_gb * 1024,
        memory_used=Metric(value=0, unit="MiB", source="simulated"),
        utilization=Metric.unavailable("%", "n/a"),
        health=health,
        health_reason="fan stuck" if health == "error" else None,
    )
    return GpuState(gpu=gpu, worker=w, reserved_by=reserved_by)


def req(memory_gb: float, workload: str = "echo") -> Requirements:
    return Requirements(workload_type=workload, min_memory_mb=int(memory_gb * 1024))


def run(states: list[GpuState], requirements: Requirements):  # type: ignore[no-untyped-def]
    return decide(states, requirements, BestFitPolicy(), NOW)


def test_best_fit_picks_the_smallest_gpu_that_fits() -> None:
    decision = run([state("GPU-1", 24), state("GPU-2", 8), state("GPU-3", 16)], req(6))

    assert decision.outcome == "scheduled"
    assert decision.selected_gpu_id == "GPU-2"
    assert decision.policy == "best_fit_memory"
    assert decision.explanation == (
        "Picked GPU-2: the smallest free GPU with at least 6 GiB (8 GiB, best fit). "
        "2 other eligible GPUs were larger or later by ID."
    )


def test_ties_are_broken_by_gpu_id() -> None:
    decision = run([state("GPU-3", 16), state("GPU-1", 16), state("GPU-2", 16)], req(1))

    assert decision.selected_gpu_id == "GPU-1"


def test_every_gpu_is_listed_with_a_reason() -> None:
    w_offline = worker("w2", status="offline")
    states = [
        state("GPU-1", 4),
        state("GPU-2", 16, health="offline"),
        state("GPU-3", 16, health="error"),
        state("GPU-4", 16, reserved_by="task_other"),
        state("GPU-5", 16, w=w_offline),
        state("GPU-6", 16),
    ]
    decision = run(states, req(8))

    reasons = {c.gpu_id: c.reason for c in decision.candidates}
    assert reasons == {
        "GPU-1": "Has 4 GiB; needs 8 GiB.",
        "GPU-2": "Device is offline.",
        "GPU-3": "Device is reporting an error: fan stuck",
        "GPU-4": "Busy with task_other.",
        "GPU-5": "Worker w2 is offline.",
        "GPU-6": None,
    }
    assert decision.selected_gpu_id == "GPU-6"
    assert [c.gpu_id for c in decision.candidates] == [f"GPU-{i}" for i in range(1, 7)]


def test_unsupported_workload_is_a_capability_problem() -> None:
    picky = worker(supports=["echo"])
    decision = run([state("GPU-1", 24, w=picky)], req(1, "benchmark"))

    assert decision.outcome == "unschedulable"
    assert decision.explanation == "No worker supports the 'benchmark' workload."
    assert decision.candidates[0].reason == "Worker w1 doesn't support 'benchmark'."


def test_impossible_memory_is_unschedulable_with_an_explanation() -> None:
    decision = run([state("GPU-1", 24), state("GPU-2", 24), state("GPU-3", 8)], req(32))

    assert decision.outcome == "unschedulable"
    assert decision.selected_gpu_id is None
    assert decision.explanation == (
        "No GPU satisfies the 32 GiB memory requirement. The largest is 24 GiB (GPU-1, GPU-2)."
    )


def test_no_gpus_at_all() -> None:
    assert run([], req(1)).explanation == "No GPUs are registered."


def test_waits_when_capable_gpus_are_busy_or_unhealthy() -> None:
    states = [
        state("GPU-1", 24, reserved_by="task_a"),
        state("GPU-2", 24, health="offline"),
        state("GPU-3", 8),
    ]
    decision = run(states, req(16))

    assert decision.outcome == "waiting"
    assert decision.explanation == (
        "Waiting for a GPU. The 2 GPUs that could run this are unavailable: 1 busy, 1 offline."
    )
    reasons = {c.gpu_id: c.reason for c in decision.candidates}
    assert reasons["GPU-1"] == "Busy with task_a."


def test_same_inputs_give_the_same_decision() -> None:
    states = [state("GPU-1", 24), state("GPU-2", 16, reserved_by="task_x"), state("GPU-3", 16)]

    assert run(states, req(10)) == run(list(reversed(states)), req(10))

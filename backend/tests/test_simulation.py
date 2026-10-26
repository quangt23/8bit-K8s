from typing import Any

import pytest
from pydantic import TypeAdapter

from pixelgpu.tasks.workloads import WorkloadSpec
from pixelgpu.workers.execution import (
    ExecutionContext,
    TaskCancelledError,
    TaskTimeoutError,
    WorkloadFailedError,
)
from pixelgpu.workers.simulation import run_simulated, simulated_duration

specs: TypeAdapter[WorkloadSpec] = TypeAdapter(WorkloadSpec)


class FakeService:
    """Stands in for TaskService: records what the workload reports."""

    def __init__(self, cancel_after_sleeps: int | None = None) -> None:
        self.logs: list[str] = []
        self.progress: list[float] = []
        self.checks = 0
        self.cancel_after_sleeps = cancel_after_sleeps

    def log(self, task_id: str, message: str, *, level: str = "info") -> None:
        self.logs.append(message)

    def set_progress(self, task_id: str, progress: float) -> None:
        self.progress.append(progress)

    def cancel_requested(self, task_id: str) -> bool:
        self.checks += 1
        return self.cancel_after_sleeps is not None and self.checks > self.cancel_after_sleeps


def run(spec: dict[str, Any], *, timeout: float = 600, service: FakeService | None = None):  # type: ignore[no-untyped-def]
    service = service or FakeService()
    slept: list[float] = []
    ctx = ExecutionContext(
        service,  # type: ignore[arg-type]
        "task_x",
        speed=1000,
        timeout_seconds=timeout,
        sleep=slept.append,
    )
    return run_simulated(specs.validate_python(spec), ctx), service, ctx


def test_echo_returns_the_message_labelled_simulated() -> None:
    result, service, ctx = run({"type": "echo", "message": "hello"})

    assert result == {"execution_mode": "simulated", "message": "hello"}
    assert service.progress[-1] == 1.0
    assert service.progress == sorted(service.progress)
    assert ctx.elapsed == pytest.approx(2.0)


def test_summary_is_extractive_and_says_so() -> None:
    text = "First point. Second point! Third point? Fourth point."
    result, _, _ = run({"type": "text_summary", "text": text, "max_sentences": 2})

    assert result["summary"] == "First point. Second point!"
    assert result["sentences_in"] == 4
    assert result["sentences_out"] == 2
    assert "no model" in result["method"]


def test_inference_never_pretends_to_have_run_a_model() -> None:
    result, service, _ = run({"type": "sample_inference", "prompt": "hi"})

    assert result["execution_mode"] == "simulated"
    assert "No model was run" in result["text"]
    assert any("simulated" in line for line in service.logs)


def test_benchmark_reports_no_performance_numbers() -> None:
    result, _, ctx = run({"type": "benchmark", "duration_seconds": 10})

    assert ctx.elapsed == pytest.approx(10.0)
    assert set(result) == {"execution_mode", "duration_seconds", "matrix_size", "note"}


def test_requested_failure() -> None:
    with pytest.raises(WorkloadFailedError, match="disk on fire"):
        run({"type": "echo", "message": "fail: disk on fire"})


def test_timeout() -> None:
    with pytest.raises(TaskTimeoutError):
        run({"type": "benchmark", "duration_seconds": 60}, timeout=5)


def test_cancel_is_noticed_between_slices() -> None:
    with pytest.raises(TaskCancelledError):
        run(
            {"type": "benchmark", "duration_seconds": 60},
            service=FakeService(cancel_after_sleeps=3),
        )


@pytest.mark.parametrize(
    "spec",
    [
        {"type": "echo", "message": "same"},
        {"type": "text_summary", "text": "One sentence here. Another one there."},
        {"type": "sample_inference", "prompt": "same prompt", "model": "pixel-small-7b"},
        {"type": "benchmark", "matrix_size": 2048},
    ],
)
def test_results_and_durations_are_deterministic(spec: dict[str, Any]) -> None:
    first, s1, _ = run(spec)
    second, s2, _ = run(spec)

    assert first == second
    assert s1.logs == s2.logs
    assert s1.progress == s2.progress
    assert simulated_duration(specs.validate_python(spec)) == simulated_duration(
        specs.validate_python(spec)
    )

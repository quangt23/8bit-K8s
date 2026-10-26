"""Deterministic simulated workloads.

Durations, logs, progress and results depend only on the workload spec, so the
same task always behaves the same way. Nothing here touches a GPU or a model, and
every result says so. ``text_summary`` does real (if simple) text processing.

A failure can be requested on purpose: an ``echo`` whose message starts with
``fail:`` fails with the rest of the message. Tests and demos use this.
"""

import hashlib
import re
from typing import Any

from pixelgpu.tasks.workloads import (
    BenchmarkWorkload,
    EchoWorkload,
    SampleInferenceWorkload,
    TextSummaryWorkload,
    WorkloadSpec,
)
from pixelgpu.workers.execution import ExecutionContext, WorkloadFailedError

SIMULATED = {"execution_mode": "simulated"}


def _steps(ctx: ExecutionContext, total_seconds: float, steps: int, label: str) -> None:
    for step in range(1, steps + 1):
        ctx.sleep(total_seconds / steps)
        ctx.progress(step / steps)
        if step in (steps // 2, steps):
            ctx.log(f"{label}: {step}/{steps}")


def run_simulated(spec: WorkloadSpec, ctx: ExecutionContext) -> dict[str, Any]:
    match spec:
        case EchoWorkload():
            return _echo(spec, ctx)
        case TextSummaryWorkload():
            return _summary(spec, ctx)
        case SampleInferenceWorkload():
            return _inference(spec, ctx)
        case BenchmarkWorkload():
            return _benchmark(spec, ctx)


def simulated_duration(spec: WorkloadSpec) -> float:
    """Simulated seconds of work, before any slowdown or speed-up."""
    match spec:
        case EchoWorkload():
            return 2.0
        case TextSummaryWorkload():
            return 3.0 + len(spec.text) / 4000
        case SampleInferenceWorkload():
            per_token = 0.03 if spec.model == "pixel-tiny-1b" else 0.08
            return 2.0 + spec.max_tokens * per_token
        case BenchmarkWorkload():
            return float(spec.duration_seconds)


def _echo(spec: EchoWorkload, ctx: ExecutionContext) -> dict[str, Any]:
    ctx.log("Echoing message.")
    _steps(ctx, simulated_duration(spec), 4, "Echo")
    if spec.message.startswith("fail:"):
        raise WorkloadFailedError(
            spec.message.removeprefix("fail:").strip() or "Requested failure."
        )
    return {**SIMULATED, "message": spec.message}


_SENTENCE = re.compile(r"(?<=[.!?])\s+")


def _summary(spec: TextSummaryWorkload, ctx: ExecutionContext) -> dict[str, Any]:
    sentences = [s.strip() for s in _SENTENCE.split(spec.text.strip()) if s.strip()]
    ctx.log(f"Read {len(sentences)} sentences.")
    _steps(ctx, simulated_duration(spec), 5, "Summarizing")
    summary = " ".join(sentences[: spec.max_sentences])
    return {
        **SIMULATED,
        "summary": summary,
        "method": "extractive: the first sentences of the text (no model)",
        "sentences_in": len(sentences),
        "sentences_out": min(len(sentences), spec.max_sentences),
    }


def _inference(spec: SampleInferenceWorkload, ctx: ExecutionContext) -> dict[str, Any]:
    ctx.log(f"Loading sample model {spec.model} (simulated).")
    _steps(ctx, simulated_duration(spec), 8, "Generating")
    digest = hashlib.sha256(f"{spec.model}:{spec.prompt}".encode()).hexdigest()[:12]
    return {
        **SIMULATED,
        "model": spec.model,
        "text": (
            f"[Simulated output {digest}] No model was run, so there is no generated text. "
            "Real inference arrives in a later phase."
        ),
        "tokens": spec.max_tokens,
    }


def _benchmark(spec: BenchmarkWorkload, ctx: ExecutionContext) -> dict[str, Any]:
    ctx.log(f"Simulating {spec.matrix_size}x{spec.matrix_size} matrix multiplications.")
    _steps(ctx, simulated_duration(spec), 10, "Benchmark")
    return {
        **SIMULATED,
        "duration_seconds": spec.duration_seconds,
        "matrix_size": spec.matrix_size,
        "note": "Simulated run: no GPU work was done, so no performance figures are reported.",
    }

import pytest
from pydantic import TypeAdapter, ValidationError

from pixelgpu.tasks.workloads import (
    SUPPORTED_WORKLOAD_TYPES,
    WorkloadSpec,
    workload_catalog,
)

adapter: TypeAdapter[WorkloadSpec] = TypeAdapter(WorkloadSpec)


def test_catalog_lists_every_supported_workload() -> None:
    catalog = workload_catalog()

    assert [w.type for w in catalog] == list(SUPPORTED_WORKLOAD_TYPES)
    assert SUPPORTED_WORKLOAD_TYPES == ("echo", "text_summary", "sample_inference", "benchmark")
    for info in catalog:
        assert info.label and info.description
        assert info.config_schema["additionalProperties"] is False


@pytest.mark.parametrize(
    ("spec", "memory"),
    [
        ({"type": "echo", "message": "hi"}, 512),
        ({"type": "text_summary", "text": "x" * 20}, 2048),
        ({"type": "sample_inference", "prompt": "hi"}, 4096),
        ({"type": "sample_inference", "prompt": "hi", "model": "pixel-small-7b"}, 14_336),
        ({"type": "benchmark"}, 4096),
        ({"type": "benchmark", "matrix_size": 8192}, 8192),
    ],
)
def test_default_memory_requirements(spec: dict[str, object], memory: int) -> None:
    assert adapter.validate_python(spec).default_min_memory_mb() == memory


@pytest.mark.parametrize(
    "spec",
    [
        {"type": "shell", "command": "rm -rf /"},
        {"type": "echo", "message": ""},
        {"type": "echo", "message": "hi", "extra": True},
        {"type": "text_summary", "text": "too short"},
        {"type": "sample_inference", "prompt": "hi", "model": "gpt-unknown"},
        {"type": "benchmark", "duration_seconds": 1000},
        {"type": "benchmark", "matrix_size": 3000},
    ],
)
def test_invalid_specs_are_rejected(spec: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        adapter.validate_python(spec)

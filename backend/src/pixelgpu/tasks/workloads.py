"""The allowlist of workloads PixelGPU can run.

A task's workload is one of these typed specs. Anything else, including unknown
config fields, is rejected at the API boundary. Free text from the user is never
interpreted as a workload; it is stored separately as the task's ``prompt``.

Workloads currently run only on simulated workers (Phase 3). The inference model
names are labels for simulated runs, not real models.
"""

from typing import Annotated, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field


class _WorkloadBase(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    label: ClassVar[str]
    description: ClassVar[str]

    def default_min_memory_mb(self) -> int:
        """Memory this workload needs at minimum, independent of user requests."""
        raise NotImplementedError


class EchoWorkload(_WorkloadBase):
    label: ClassVar[str] = "Echo"
    description: ClassVar[str] = "Diagnostic: returns the message unchanged."

    type: Literal["echo"] = "echo"
    message: str = Field(min_length=1, max_length=500)

    def default_min_memory_mb(self) -> int:
        return 512


class TextSummaryWorkload(_WorkloadBase):
    label: ClassVar[str] = "Summarize text"
    description: ClassVar[str] = "Condenses a passage into a few sentences."

    type: Literal["text_summary"] = "text_summary"
    text: str = Field(min_length=20, max_length=20_000)
    max_sentences: int = Field(default=3, ge=1, le=10)

    def default_min_memory_mb(self) -> int:
        return 2048


INFERENCE_MODEL_MEMORY_MB: dict[str, int] = {"pixel-tiny-1b": 4096, "pixel-small-7b": 14_336}


class SampleInferenceWorkload(_WorkloadBase):
    label: ClassVar[str] = "Sample inference"
    description: ClassVar[str] = "Generates text from a prompt with a sample model (simulated)."

    type: Literal["sample_inference"] = "sample_inference"
    model: Literal["pixel-tiny-1b", "pixel-small-7b"] = "pixel-tiny-1b"
    prompt: str = Field(min_length=1, max_length=2000)
    max_tokens: int = Field(default=128, ge=1, le=512)

    def default_min_memory_mb(self) -> int:
        return INFERENCE_MODEL_MEMORY_MB[self.model]


class BenchmarkWorkload(_WorkloadBase):
    label: ClassVar[str] = "GPU benchmark"
    description: ClassVar[str] = "Repeated matrix multiplications for a fixed duration."

    type: Literal["benchmark"] = "benchmark"
    duration_seconds: int = Field(default=30, ge=5, le=120)
    matrix_size: Literal[1024, 2048, 4096, 8192] = 4096

    def default_min_memory_mb(self) -> int:
        return self.matrix_size


WorkloadSpec = Annotated[
    EchoWorkload | TextSummaryWorkload | SampleInferenceWorkload | BenchmarkWorkload,
    Field(discriminator="type"),
]

WORKLOAD_TYPES: tuple[type[_WorkloadBase], ...] = (
    EchoWorkload,
    TextSummaryWorkload,
    SampleInferenceWorkload,
    BenchmarkWorkload,
)

SUPPORTED_WORKLOAD_TYPES: tuple[str, ...] = tuple(
    str(cls.model_fields["type"].default) for cls in WORKLOAD_TYPES
)


class WorkloadInfo(BaseModel):
    type: str
    label: str
    description: str
    config_schema: dict[str, object]


def workload_catalog() -> list[WorkloadInfo]:
    return [
        WorkloadInfo(
            type=str(cls.model_fields["type"].default),
            label=cls.label,
            description=cls.description,
            config_schema=cls.model_json_schema(),
        )
        for cls in WORKLOAD_TYPES
    ]

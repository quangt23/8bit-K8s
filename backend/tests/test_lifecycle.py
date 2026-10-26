import itertools

import pytest

from pixelgpu.tasks.lifecycle import (
    ACTIVE_STATUSES,
    TERMINAL_STATUSES,
    InvalidTransitionError,
    TaskStatus,
    can_transition,
    ensure_transition,
)

S = TaskStatus
LEGAL = {
    (S.QUEUED, S.SCHEDULED),
    (S.QUEUED, S.FAILED),
    (S.QUEUED, S.CANCELLED),
    (S.SCHEDULED, S.RUNNING),
    (S.SCHEDULED, S.FAILED),
    (S.SCHEDULED, S.CANCELLED),
    (S.RUNNING, S.SUCCEEDED),
    (S.RUNNING, S.FAILED),
    (S.RUNNING, S.CANCELLED),
}


@pytest.mark.parametrize(("current", "target"), list(itertools.product(S, S)))
def test_only_documented_transitions_are_allowed(current: S, target: S) -> None:
    assert can_transition(current, target) is ((current, target) in LEGAL)


def test_terminal_states_are_final() -> None:
    assert {S.SUCCEEDED, S.FAILED, S.CANCELLED} == TERMINAL_STATUSES
    assert {S.QUEUED, S.SCHEDULED, S.RUNNING} == ACTIVE_STATUSES


def test_ensure_transition_raises_with_context() -> None:
    with pytest.raises(InvalidTransitionError) as info:
        ensure_transition("task_1", S.SUCCEEDED, S.RUNNING)

    assert info.value.current == S.SUCCEEDED
    assert info.value.target == S.RUNNING
    assert "succeeded" in str(info.value)

from typing import Any

from app.executor import DeterministicMockModel
from app.runtimes.base import AgentRuntime
from app.schemas import AITaskStep


class DeterministicRuntime(AgentRuntime):
    """AgentRuntime that delegates to DeterministicMockModel for testing."""

    def __init__(self) -> None:
        self._model = DeterministicMockModel()

    @property
    def name(self) -> str:
        return "deterministic"

    async def execute(
        self, step: AITaskStep, input_data: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        return await self._model.execute(step, input_data)

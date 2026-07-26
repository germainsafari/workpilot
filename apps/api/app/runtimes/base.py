from abc import ABC, abstractmethod
from typing import Any

from app.schemas import AITaskStep


class AgentRuntime(ABC):
    """Abstract base for all agent execution runtimes."""

    @abstractmethod
    async def execute(
        self, step: AITaskStep, input_data: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Execute an AI task step.

        Args:
            step: The AITaskStep to execute.
            input_data: Context data available to the step.

        Returns:
            Tuple of (output_data, model_usage).
        """

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique identifier for this runtime."""

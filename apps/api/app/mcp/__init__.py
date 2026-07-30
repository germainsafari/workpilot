"""Model Context Protocol client for WorkPilot.

This package is what lets a workflow step reach a real third-party system.
Before it existed, ``tool`` steps returned a hardcoded dictionary and no
credential was ever read — see the executor's ``ToolStep`` branch.
"""

from app.mcp.client import (
    McpAuthError,
    McpClient,
    McpError,
    McpTool,
    call_tool,
    discover_tools,
    is_read_only_tool,
)

__all__ = [
    "McpAuthError",
    "McpClient",
    "McpError",
    "McpTool",
    "call_tool",
    "discover_tools",
    "is_read_only_tool",
]

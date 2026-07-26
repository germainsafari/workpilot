"""WorkPilot Demo MCP Server.

A minimal Model Context Protocol server over HTTP/SSE that exposes
three demo tools. Run it locally and connect it from the Connections page.

Usage:
    pip install fastmcp uvicorn starlette
    python apps/mcp-server/server.py

The server starts on http://localhost:9000
Connect it in WorkPilot → Connections → MCP Servers
Enter URL: http://localhost:9000/mcp
"""

from __future__ import annotations

import asyncio
import datetime
import json
import random

try:
    from fastmcp import FastMCP
except ImportError:
    print("Install fastmcp first:  pip install fastmcp")
    raise

mcp = FastMCP("WorkPilot Demo")


@mcp.tool()
def get_weather(city: str) -> str:
    """Return current weather for a city (demo data, not real weather)."""
    conditions = ["Sunny", "Partly cloudy", "Overcast", "Light rain", "Clear"]
    temp = random.randint(14, 28)
    condition = random.choice(conditions)
    return json.dumps({
        "city": city,
        "temperature_celsius": temp,
        "condition": condition,
        "humidity_percent": random.randint(40, 80),
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        "note": "Demo data — not real weather",
    })


@mcp.tool()
def summarise_text(text: str, max_words: int = 50) -> str:
    """Summarise text to at most max_words words (demo — truncates, no real AI)."""
    words = text.split()
    if len(words) <= max_words:
        return text
    truncated = " ".join(words[:max_words])
    return truncated + f"… [truncated from {len(words)} to {max_words} words — connect a real LLM for actual summarisation]"


@mcp.tool()
def list_tasks(project: str) -> str:
    """List open tasks for a project (demo data)."""
    demo_tasks = {
        "default": [
            {"id": "T-001", "title": "Review client brief", "status": "open", "assignee": "Maya Chen"},
            {"id": "T-002", "title": "Prepare invoice draft", "status": "in_progress", "assignee": "Noah Williams"},
            {"id": "T-003", "title": "Schedule kick-off call", "status": "open", "assignee": "Alex Morgan"},
        ]
    }
    tasks = demo_tasks.get(project.lower(), demo_tasks["default"])
    return json.dumps({"project": project, "tasks": tasks, "note": "Demo data"})


async def main() -> None:
    try:
        import uvicorn
        from starlette.middleware.cors import CORSMiddleware
    except ImportError:
        print("Install uvicorn and starlette:  pip install uvicorn starlette")
        raise

    # Get the ASGI app from fastmcp and wrap with CORS middleware.
    # expose_headers is required so the browser can read mcp-session-id.
    asgi_app = mcp.http_app(path="/mcp")
    app_with_cors = CORSMiddleware(
        asgi_app,
        allow_origins=["*"],
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["mcp-session-id"],
    )

    print("WorkPilot Demo MCP Server starting …")
    print("  Endpoint : http://localhost:9000/mcp")
    print("  Tools    : get_weather, summarise_text, list_tasks")
    print("  Connect  : WorkPilot → Connections → MCP Servers")
    print("  URL field: http://localhost:9000/mcp")

    config = uvicorn.Config(app_with_cors, host="0.0.0.0", port=9000, log_level="warning")
    server = uvicorn.Server(config)
    await server.serve()


if __name__ == "__main__":
    asyncio.run(main())

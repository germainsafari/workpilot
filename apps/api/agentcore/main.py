"""WorkPilot's AgentCore agent — the code that runs inside the AWS microVM.

This file is bundled (together with a vendored ``boto3``) into
``agent_bundled.zip`` and uploaded to S3; see ``deploy.py`` in this directory.

**It deliberately holds no credentials for the tenant's systems.** Connector
tokens are encrypted at rest and decrypted only in the WorkPilot API process, so
this agent cannot call Scoro (or anything else) itself. Instead it plays one turn
at a time:

* WorkPilot POSTs ``{system, user_message, tools, messages, tool_result}``.
* We call Bedrock Converse. If the model wants a tool we return
  ``{"action": "call_tool", "tool", "arguments", "tool_use_id", "messages"}`` and
  stop. WorkPilot performs the call (re-checking its read-only policy) and POSTs
  again with ``tool_result`` filled in.
* When the model answers we return ``{"action": "final", "output": …}``.

Two constraints learned the hard way, please do not regress them:

* ``boto3`` is **bundled** into the zip, never listed in ``requirements.txt`` —
  a cold-start ``pip install`` blows the 30-second init budget.
* The boto3 client is created **lazily**, inside the first request, not at import
  time, for the same reason.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "packages"))

import json  # noqa: E402
import traceback  # noqa: E402
from http.server import BaseHTTPRequestHandler, HTTPServer  # noqa: E402

REGION = os.environ.get("AWS_REGION", "eu-central-1")
MODEL_ID = os.environ.get("WORKPILOT_MODEL_ID", "eu.amazon.nova-micro-v1:0")
MAX_TOKENS = 1024

_bedrock = None


def get_bedrock():
    """Create the Bedrock client on first use — not at import time."""
    global _bedrock
    if _bedrock is None:
        import boto3

        _bedrock = boto3.client("bedrock-runtime", region_name=REGION)
    return _bedrock


# --------------------------------------------------------------------------- #
# Tool plumbing
# --------------------------------------------------------------------------- #
def _clean_schema(schema):
    """Reduce an MCP input schema to what Bedrock's toolSpec reliably accepts.

    Nova rejects a few JSON Schema keywords that MCP servers like to emit
    (``$schema``, ``$defs``, ``additionalProperties``), and a tool whose schema
    is refused takes the whole request down with it.
    """
    if not isinstance(schema, dict):
        return {"type": "object", "properties": {}}
    cleaned = {"type": "object", "properties": {}}
    props = schema.get("properties")
    if isinstance(props, dict):
        cleaned["properties"] = {
            name: spec for name, spec in props.items() if isinstance(spec, dict)
        }
    required = schema.get("required")
    if isinstance(required, list) and required:
        cleaned["required"] = [r for r in required if isinstance(r, str)]
    if isinstance(schema.get("description"), str):
        cleaned["description"] = schema["description"][:512]
    return cleaned


def _tool_config(tools):
    specs = []
    for tool in tools or []:
        name = tool.get("name")
        if not name:
            continue
        specs.append(
            {
                "toolSpec": {
                    "name": name,
                    "description": (tool.get("description") or name)[:1024],
                    "inputSchema": {"json": _clean_schema(tool.get("input_schema"))},
                }
            }
        )
    return {"tools": specs} if specs else None


def _flatten_history(messages):
    """Rewrite toolUse/toolResult blocks as plain text.

    Bedrock refuses a conversation containing tool blocks unless a ``toolConfig``
    is supplied — which would let the model ask for yet another tool. On the last
    permitted turn WorkPilot sends no tools, so we flatten the history instead:
    the model can still see what it looked up, but it has nothing left to call
    and must answer.
    """
    flat = []
    for message in messages or []:
        blocks = []
        for block in message.get("content") or []:
            if not isinstance(block, dict):
                continue
            if "text" in block:
                blocks.append({"text": block["text"]})
            elif "toolUse" in block:
                use = block["toolUse"] or {}
                blocks.append(
                    {
                        "text": "[requested tool %s with %s]"
                        % (use.get("name"), json.dumps(use.get("input") or {})[:2000])
                    }
                )
            elif "toolResult" in block:
                parts = [
                    part.get("text", "")
                    for part in (block["toolResult"] or {}).get("content") or []
                    if isinstance(part, dict)
                ]
                blocks.append({"text": "[tool result] " + " ".join(parts)})
        if blocks:
            flat.append({"role": message.get("role", "user"), "content": blocks})
    return flat


def _build_messages(payload):
    """Assemble the Converse message list for this turn."""
    messages = payload.get("messages")
    if not isinstance(messages, list) or not messages:
        user_message = (
            payload.get("user_message")
            or payload.get("prompt")
            or json.dumps(payload.get("input") or {})
        )
        return [{"role": "user", "content": [{"text": str(user_message)}]}]

    messages = [m for m in messages if isinstance(m, dict)]
    tool_result = payload.get("tool_result")
    if isinstance(tool_result, dict):
        block = {
            "toolResult": {
                "toolUseId": tool_result.get("tool_use_id") or "unknown",
                "content": [{"text": str(tool_result.get("content", ""))}],
            }
        }
        messages = messages + [{"role": "user", "content": [block]}]
    return messages


# --------------------------------------------------------------------------- #
# One turn
# --------------------------------------------------------------------------- #
def run_turn(payload):
    system_prompt = payload.get("system") or (
        "You are WorkPilot's AI assistant running on AWS AgentCore. "
        "Return ONLY a JSON object with the result. No prose, no code fences."
    )
    tool_config = _tool_config(payload.get("tools"))
    messages = _build_messages(payload)
    if tool_config is None:
        # No tools this turn: the history must not contain tool blocks.
        messages = _flatten_history(messages) or messages

    kwargs = {
        "modelId": MODEL_ID,
        "messages": messages,
        "system": [{"text": str(system_prompt)}],
        "inferenceConfig": {"maxTokens": MAX_TOKENS, "temperature": 0.2},
    }
    if tool_config is not None:
        kwargs["toolConfig"] = tool_config

    response = get_bedrock().converse(**kwargs)

    usage = response.get("usage") or {}
    reply = {
        "model": MODEL_ID,
        "runtime": "agentcore",
        "usage": {
            "input_tokens": usage.get("inputTokens", 0),
            "output_tokens": usage.get("outputTokens", 0),
        },
    }

    assistant = (response.get("output") or {}).get("message") or {}
    content = assistant.get("content") or []
    history = messages + [{"role": "assistant", "content": content}]
    reply["messages"] = history

    tool_use = None
    texts = []
    for block in content:
        if not isinstance(block, dict):
            continue
        if "toolUse" in block and tool_use is None:
            tool_use = block["toolUse"]
        elif "text" in block:
            texts.append(block["text"])

    if response.get("stopReason") == "tool_use" and tool_use:
        reply["action"] = "call_tool"
        reply["tool"] = tool_use.get("name")
        reply["arguments"] = tool_use.get("input") or {}
        reply["tool_use_id"] = tool_use.get("toolUseId")
        if texts:
            reply["thought"] = "\n".join(texts)
        return reply

    reply["action"] = "final"
    reply["output"] = "\n".join(texts)
    reply["stop_reason"] = response.get("stopReason")
    return reply


# --------------------------------------------------------------------------- #
# HTTP surface
# --------------------------------------------------------------------------- #
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.send_json({"status": "HEALTHY"})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) if length else b"{}")
            if not isinstance(payload, dict):
                payload = {"prompt": str(payload)}
            self.send_json(run_turn(payload))
        except Exception as exc:
            # Reported as an error field, which WorkPilot raises on. Returning a
            # plausible-looking answer here would hide the failure.
            self.send_json(
                {
                    "error": "%s: %s" % (type(exc).__name__, exc),
                    "traceback": traceback.format_exc()[-2000:],
                    "runtime": "agentcore",
                }
            )


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    print("WorkPilot AgentCore agent starting on port %d" % port, flush=True)
    HTTPServer(("0.0.0.0", port), Handler).serve_forever()

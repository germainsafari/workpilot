import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url));
const origin = "http://localhost:4123";
let server;
let output = "";

before(async () => {
  server = spawn(process.execPath, [cli, "dev", "--port", "4123"], {
    cwd: root,
    env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/wrangler-test.log" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr.on("data", (chunk) => { output += chunk.toString(); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${origin}/v1/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`WorkPilot test server did not start.\n${output}`);
});

after(() => {
  server?.kill();
});

test("server-renders the WorkPilot dashboard", async () => {
  const response = await fetch(`${origin}/`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>WorkPilot — AI operations, under your control<\/title>/i);
  assert.match(html, /Good morning, Alex/);
  assert.match(html, /Waiting for approval/);
  assert.match(html, /Recent runs/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Starter Project/);
});

test("server-renders the workflow library", async () => {
  const response = await fetch(`${origin}/workflows`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Client brief processor/);
  assert.match(html, /Weekly project health report/);
  assert.match(html, /Create workflow/);
});

test("serves the hosted health endpoint", async () => {
  const response = await fetch(`${origin}/v1/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "workpilot-demo", version: "0.1.0" });
});

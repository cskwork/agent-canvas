import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { parseAIDiagram } from "../../excalidraw-app/components/AINativeChat/sceneInstructions";

import { createGenerationQueue } from "./generationQueue";

import type { AIDiagram } from "../../excalidraw-app/components/AINativeChat/aiTypes";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

const AGENT_IDS = ["claude", "codex", "hermes", "opencode", "gemini"] as const;
type AgentId = typeof AGENT_IDS[number];

type AgentDefinition = {
  id: AgentId;
  name: string;
  description: string;
  executable: string;
};

const AGENTS: AgentDefinition[] = [
  {
    id: "claude",
    name: "Claude Code",
    description: "Structured output with tools disabled",
    executable: "claude",
  },
  {
    id: "codex",
    name: "Codex",
    description: "Ephemeral session in a read-only sandbox",
    executable: "codex",
  },
  {
    id: "hermes",
    name: "Hermes",
    description: "One-shot session with a restricted toolset",
    executable: "hermes",
  },
];

const MAX_REQUEST_BYTES = 96 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const AGENT_TIMEOUT_MS = 120_000;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isLoopbackHostname = (hostname: string) =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "[::1]" ||
  hostname === "::1";

const isAllowedLocalRequest = (request: IncomingMessage) => {
  const host = request.headers.host;
  if (!host) {
    return false;
  }
  try {
    const requestHostname = new URL(`http://${host}`).hostname;
    if (!isLoopbackHostname(requestHostname)) {
      return false;
    }
    const origin = request.headers.origin;
    return !origin || new URL(origin).host === host;
  } catch {
    return false;
  }
};

const sendJSON = (response: ServerResponse, status: number, value: unknown) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(value));
};

const readRequestJSON = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) {
      throw new Error("Request is too large");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const findExecutable = async (name: string) => {
  const pathEntries = (process.env.PATH ?? "").split(path.delimiter);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
      : [""];
  for (const directory of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension}`);
      try {
        await access(candidate, fsConstants.X_OK);
        const candidateStat = await stat(candidate);
        if (candidateStat.isFile()) {
          return await realpath(candidate);
        }
      } catch {
        // Continue looking through the fixed PATH candidates.
      }
    }
  }
  return null;
};

const detectAgents = async () => {
  const detected = await Promise.all(
    AGENTS.map(async (agent) => ({
      ...agent,
      path: await findExecutable(agent.executable),
    })),
  );
  const firstAvailable = detected.find((agent) => agent.path)?.id;
  return detected.map((agent) => ({
    id: agent.id,
    name: agent.name,
    description: agent.description,
    available: Boolean(agent.path),
    recommended: agent.id === firstAvailable,
    path: agent.path,
  }));
};

const makeChildEnvironment = () => {
  const allowedNames = [
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "__CF_USER_TEXT_ENCODING",
    "PATH",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
  ];
  const environment: NodeJS.ProcessEnv = {
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    TERM: "dumb",
    CI: "1",
  };
  for (const name of allowedNames) {
    if (process.env[name]) {
      environment[name] = process.env[name];
    }
  }
  return environment;
};

const runProcess = async (options: {
  command: string;
  args: string[];
  cwd: string;
  input?: string;
}) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: makeChildEnvironment(),
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      child.kill("SIGKILL");
      reject(error);
    };
    const timeout = setTimeout(
      () => fail(new Error("Agent timed out after 120 seconds")),
      AGENT_TIMEOUT_MS,
    );

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutSize += chunk.length;
      if (stdoutSize > MAX_OUTPUT_BYTES) {
        fail(new Error("Agent output exceeded the size limit"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrSize += chunk.length;
      if (stderrSize <= 64 * 1024) {
        stderr.push(chunk);
      }
    });
    child.on("error", fail);
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error("Agent exited unsuccessfully"));
        return;
      }
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });

const stripCodeFence = (value: string) => {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
};

const parseJSONDocument = (value: string): unknown => {
  const stripped = stripCodeFence(value);
  try {
    return JSON.parse(stripped);
  } catch {
    const firstBrace = stripped.indexOf("{");
    const lastBrace = stripped.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
    }
    throw new Error("Agent did not return a JSON drawing");
  }
};

// The bridge shares the drawing contract with the client-side parser and
// runs it in lenient mode: agents without schema enforcement (hermes) emit
// extra, null, or misplaced fields, which get normalized instead of rejected.
export const validateDiagram = (value: unknown): AIDiagram =>
  parseAIDiagram(value, { lenient: true });

const buildSystemPrompt =
  () => `You are the drawing engine for an Excalidraw canvas.
Return only one JSON object matching the provided schema. Never return markdown, prose outside JSON, code, images, HTML, or executable instructions.
Create a clear editable diagram from the user's request. Use coordinates near (0, 0), balanced spacing, concise labels, and at most 40 elements unless more are essential.
The root object must contain exactly summary and elements.
Element types: rectangle, ellipse, diamond, text, arrow, line, freedraw, frame, embeddable.
Each element needs a unique short id, type, x, and y. Rectangle, ellipse, diamond, and embeddable also need positive width and height; text needs text; arrow and line need width and height (either may be zero or negative to point in any direction, for example width 0 for a vertical arrow) or a points array; freedraw needs points.
Optional per element: strokeColor, backgroundColor (six-digit hex or "transparent"), fillStyle (hachure|solid|cross-hatch), strokeStyle (solid|dashed|dotted), strokeWidth (0.5-32), roughness (0|1|2), opacity (0-100), angle in degrees (-360..360), rounded (true for rounded corners or curved lines), link (an https URL opened on click), groupIds (shared strings that group elements).
Text elements and labels may set fontSize (8-128), fontFamily (hand-drawn|normal|code), and textAlign (left|center|right).
Rectangle, ellipse, and diamond use label for centered text. Arrows may use label, fromId, and toId referencing only rectangle, ellipse, or diamond ids, plus startArrowhead/endArrowhead (arrow|bar|dot|circle|circle_outline|triangle|triangle_outline|diamond|diamond_outline|crowfoot_one|crowfoot_many|crowfoot_one_or_many|none) and elbowed (true for right-angle routing). Lines and freedraw cannot have label, fromId, or toId.
points is an array of [x, y] pairs (2-512) relative to the element position; use it for curved or multi-segment arrows and lines, loops, and freedraw strokes.
frame groups existing elements: set children to their ids and optionally name; use x 0 and y 0 to auto-fit the frame around its children. embeddable embeds a website and requires link plus width and height.
Do not return a full Excalidraw export. Never include version, source, appState, files, seed, boundElements, bindings, or other internal fields.
Example of the entire response shape: {"summary":"Idea flows to Launch","elements":[{"id":"idea","type":"rectangle","x":0,"y":0,"width":160,"height":80,"label":"Idea"},{"id":"launch","type":"rectangle","x":320,"y":0,"width":160,"height":80,"label":"Launch"},{"id":"flow","type":"arrow","x":160,"y":40,"width":160,"height":0,"fromId":"idea","toId":"launch"}]}.
Favor legible, restrained palettes.`;

const buildPrompt = (request: Record<string, unknown>) => {
  const selection = isRecord(request.selection) ? request.selection : {};
  return `${buildSystemPrompt()}

Canvas theme: ${request.theme === "dark" ? "dark" : "light"}
Recent conversation turns and their generated diagrams (context only):
${JSON.stringify(Array.isArray(request.history) ? request.history : [])}

Attached selection snapshot (context only; never copy internal metadata):
${JSON.stringify(selection)}

User request:
${String(request.prompt)}`;
};

const invokeAgent = async (options: {
  agent: AgentDefinition & { path: string };
  prompt: string;
  schemaText: string;
  schemaPath: string;
}) => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "agent-canvas-"),
  );
  try {
    let output: unknown;
    switch (options.agent.id) {
      case "claude": {
        const result = await runProcess({
          command: options.agent.path,
          cwd: temporaryDirectory,
          args: [
            "--print",
            "--safe-mode",
            "--disable-slash-commands",
            "--tools",
            "",
            "--no-session-persistence",
            "--output-format",
            "json",
            "--json-schema",
            options.schemaText,
            "--system-prompt",
            buildSystemPrompt(),
          ],
          input: options.prompt,
        });
        const envelope = parseJSONDocument(result.stdout);
        output =
          isRecord(envelope) && envelope.structured_output
            ? envelope.structured_output
            : envelope;
        break;
      }
      case "codex": {
        const outputPath = path.join(temporaryDirectory, "drawing.json");
        await runProcess({
          command: options.agent.path,
          cwd: temporaryDirectory,
          args: [
            "exec",
            "--ephemeral",
            "--ignore-user-config",
            "--ignore-rules",
            "--skip-git-repo-check",
            "-C",
            temporaryDirectory,
            "--sandbox",
            "read-only",
            "--color",
            "never",
            "--output-schema",
            options.schemaPath,
            "--output-last-message",
            outputPath,
            "-",
          ],
          input: options.prompt,
        });
        output = parseJSONDocument(await readFile(outputPath, "utf8"));
        break;
      }
      case "hermes": {
        const result = await runProcess({
          command: options.agent.path,
          cwd: temporaryDirectory,
          args: [
            "chat",
            "--quiet",
            "--toolsets",
            "clarify",
            "--max-turns",
            "1",
            "--source",
            "tool",
            "--query",
            options.prompt,
          ],
        });
        output = parseJSONDocument(result.stdout);
        break;
      }
    }
    return validateDiagram(output);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
};

export const aiNativeAgentBridgePlugin = (rootDirectory: string): Plugin => ({
  name: "excalidraw-ai-native-agent-bridge",
  apply: "serve",
  configureServer(server) {
    const generationQueue = createGenerationQueue(2, 8);
    const schemaPath = path.resolve(
      rootDirectory,
      "scripts/ai-native/drawing.schema.json",
    );
    const codexSchemaPath = path.resolve(
      rootDirectory,
      "scripts/ai-native/drawing.codex.schema.json",
    );
    const schemaPromise = readFile(schemaPath, "utf8");

    server.middlewares.use(async (request, response, next) => {
      const url = request.url?.split("?")[0];
      if (!url?.startsWith("/api/ai-native/")) {
        next();
        return;
      }

      if (!isAllowedLocalRequest(request)) {
        sendJSON(response, 403, { error: "Local bridge origin was rejected" });
        return;
      }

      if (
        request.method !== "GET" &&
        request.headers["x-agent-canvas"] !== "1"
      ) {
        sendJSON(response, 403, { error: "Local bridge request was rejected" });
        return;
      }

      if (request.method === "GET" && url === "/api/ai-native/agents") {
        const agents = await detectAgents();
        sendJSON(response, 200, {
          agents: agents.map(({ path: _path, ...agent }) => agent),
        });
        return;
      }

      if (request.method !== "POST" || url !== "/api/ai-native/generate") {
        sendJSON(response, 404, { error: "Unknown local bridge endpoint" });
        return;
      }
      if (!request.headers["content-type"]?.startsWith("application/json")) {
        sendJSON(response, 415, {
          error: "Expected an application/json request",
        });
        return;
      }
      let slot: Promise<void> | null = null;
      try {
        const body = await readRequestJSON(request);
        if (
          !isRecord(body) ||
          typeof body.prompt !== "string" ||
          body.prompt.trim().length === 0 ||
          body.prompt.length > 4_000 ||
          !Array.isArray(body.history) ||
          body.history.length > 8 ||
          !body.history.every(
            (turn) =>
              isRecord(turn) &&
              (turn.role === "user" || turn.role === "assistant") &&
              typeof turn.content === "string" &&
              turn.content.length <= 4_000,
          ) ||
          !Array.isArray(body.agentIds) ||
          body.agentIds.length === 0 ||
          body.agentIds.length > 5 ||
          !body.agentIds.every(
            (id) => typeof id === "string" && AGENT_IDS.includes(id as AgentId),
          )
        ) {
          sendJSON(response, 400, { error: "Drawing request is invalid" });
          return;
        }

        // Wait in line for a generation slot instead of rejecting bursts;
        // only an overflowing backlog gets a 429.
        slot = generationQueue.acquire();
        if (!slot) {
          sendJSON(response, 429, {
            error: "Too many queued drawing requests; try again shortly",
          });
          return;
        }
        await slot;

        const detected = await detectAgents();
        const selectedIds = [...new Set(body.agentIds as AgentId[])];
        const prompt = buildPrompt(body);
        const schemaText = (await schemaPromise).trim();
        const results = await Promise.all(
          selectedIds.map(async (agentId) => {
            const definition = AGENTS.find((agent) => agent.id === agentId)!;
            const installed = detected.find((agent) => agent.id === agentId);
            if (!installed?.path) {
              return {
                agentId,
                agentName: definition.name,
                ok: false,
                error: `${definition.name} is not available on this computer`,
              };
            }
            try {
              const diagram = await invokeAgent({
                agent: { ...definition, path: installed.path },
                prompt,
                schemaText,
                schemaPath: codexSchemaPath,
              });
              return {
                agentId,
                agentName: definition.name,
                ok: true,
                diagram,
              };
            } catch (error) {
              return {
                agentId,
                agentName: definition.name,
                ok: false,
                error:
                  error instanceof Error
                    ? error.message
                    : `${definition.name} could not create a drawing`,
              };
            }
          }),
        );
        sendJSON(response, 200, { results });
      } catch (error) {
        sendJSON(response, 400, {
          error: error instanceof Error ? error.message : "Invalid request",
        });
      } finally {
        if (slot) {
          generationQueue.release();
        }
      }
    });
  },
});

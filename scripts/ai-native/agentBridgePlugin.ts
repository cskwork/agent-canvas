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

type AgentElement = {
  id: string;
  type: "rectangle" | "ellipse" | "diamond" | "text" | "arrow" | "line";
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  label?: string;
  fromId?: string;
  toId?: string;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: "hachure" | "solid" | "cross-hatch";
  strokeStyle?: "solid" | "dashed" | "dotted";
  roughness?: 0 | 1 | 2;
  opacity?: number;
};

type Diagram = { summary: string; elements: AgentElement[] };

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
const ALLOWED_ELEMENT_KEYS = new Set([
  "id",
  "type",
  "x",
  "y",
  "width",
  "height",
  "text",
  "label",
  "fromId",
  "toId",
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeStyle",
  "roughness",
  "opacity",
]);
const ELEMENT_TYPES = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "arrow",
  "line",
]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

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

const finiteBetween = (value: unknown, minimum: number, maximum: number) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= minimum &&
  value <= maximum;

export const validateDiagram = (value: unknown): Diagram => {
  if (!isRecord(value)) {
    throw new Error("Drawing response must be an object");
  }
  if (
    typeof value.summary !== "string" ||
    value.summary.length === 0 ||
    value.summary.length > 500 ||
    !Array.isArray(value.elements) ||
    value.elements.length === 0 ||
    value.elements.length > 80
  ) {
    throw new Error("Drawing response has an invalid summary or element list");
  }

  const elements: AgentElement[] = value.elements.map((rawValue, index) => {
    if (!isRecord(rawValue)) {
      throw new Error(`Element ${index + 1} must be an object`);
    }
    // Agents without schema enforcement (hermes) occasionally add extra or
    // null fields; drop them instead of rejecting the whole drawing.
    const raw = Object.fromEntries(
      Object.entries(rawValue).filter(
        ([key, fieldValue]) =>
          ALLOWED_ELEMENT_KEYS.has(key) && fieldValue !== null,
      ),
    );
    if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) {
      throw new Error(`Element ${index + 1} has an invalid id`);
    }
    if (typeof raw.type !== "string" || !ELEMENT_TYPES.has(raw.type)) {
      throw new Error(`Element ${index + 1} has an unsupported type`);
    }
    if (
      !finiteBetween(raw.x, -10_000, 10_000) ||
      !finiteBetween(raw.y, -10_000, 10_000) ||
      !finiteBetween(raw.width, -4_000, 4_000) ||
      !finiteBetween(raw.height, -4_000, 4_000)
    ) {
      throw new Error(`Element ${index + 1} has invalid geometry`);
    }
    if (
      raw.type !== "arrow" &&
      raw.type !== "line" &&
      ((raw.width as number) < 1 || (raw.height as number) < 1)
    ) {
      throw new Error(`Element ${index + 1} must have a positive size`);
    }
    if (
      raw.type === "text" &&
      (typeof raw.text !== "string" || raw.text.length === 0)
    ) {
      throw new Error(`Text element ${index + 1} is missing text`);
    }
    for (const key of ["text", "label"] as const) {
      if (
        raw[key] !== undefined &&
        (typeof raw[key] !== "string" || raw[key].length > 2_000)
      ) {
        throw new Error(`Element ${index + 1} has invalid ${key}`);
      }
    }
    for (const key of ["fromId", "toId"] as const) {
      if (
        raw[key] !== undefined &&
        (typeof raw[key] !== "string" || !ID_PATTERN.test(raw[key]))
      ) {
        throw new Error(`Element ${index + 1} has an invalid reference`);
      }
    }
    if (
      raw.type === "line" &&
      (raw.label !== undefined ||
        raw.fromId !== undefined ||
        raw.toId !== undefined)
    ) {
      throw new Error(
        `Line element ${index + 1} cannot have labels or bindings`,
      );
    }
    for (const key of ["strokeColor", "backgroundColor"] as const) {
      if (
        raw[key] !== undefined &&
        (typeof raw[key] !== "string" || !COLOR_PATTERN.test(raw[key]))
      ) {
        throw new Error(`Element ${index + 1} has an invalid color`);
      }
    }
    if (
      raw.fillStyle !== undefined &&
      !["hachure", "solid", "cross-hatch"].includes(String(raw.fillStyle))
    ) {
      throw new Error(`Element ${index + 1} has an invalid fill style`);
    }
    if (
      raw.strokeStyle !== undefined &&
      !["solid", "dashed", "dotted"].includes(String(raw.strokeStyle))
    ) {
      throw new Error(`Element ${index + 1} has an invalid stroke style`);
    }
    if (
      raw.roughness !== undefined &&
      ![0, 1, 2].includes(raw.roughness as number)
    ) {
      throw new Error(`Element ${index + 1} has invalid roughness`);
    }
    if (raw.opacity !== undefined && !finiteBetween(raw.opacity, 0, 100)) {
      throw new Error(`Element ${index + 1} has invalid opacity`);
    }
    return raw as unknown as AgentElement;
  });

  const ids = new Set<string>();
  for (const element of elements) {
    if (ids.has(element.id)) {
      throw new Error(`Duplicate element id: ${element.id}`);
    }
    ids.add(element.id);
  }
  const typesById = new Map(
    elements.map((element) => [element.id, element.type]),
  );
  for (const element of elements) {
    for (const reference of [element.fromId, element.toId]) {
      if (reference && !ids.has(reference)) {
        throw new Error(`Unknown element reference: ${reference}`);
      }
      if (
        reference &&
        !["rectangle", "ellipse", "diamond"].includes(typesById.get(reference)!)
      ) {
        throw new Error(
          `Element reference ${reference} is not a bindable shape`,
        );
      }
    }
  }

  return { summary: value.summary.trim(), elements };
};

const buildSystemPrompt =
  () => `You are the drawing engine for an Excalidraw canvas.
Return only one JSON object matching the provided schema. Never return markdown, prose outside JSON, code, URLs, images, HTML, or executable instructions.
Create a clear editable diagram from the user's request. Use coordinates near (0, 0), balanced spacing, concise labels, and at most 40 elements unless more are essential.
The root object must contain exactly summary and elements. Each element may contain only: id, type, x, y, width, height, text, label, fromId, toId, strokeColor, backgroundColor, fillStyle, strokeStyle, roughness, opacity.
Each element needs a unique short id, type, x, y, width, and height. For text elements also set text. For rectangle, ellipse, and diamond use label for centered text. For arrows, fromId and toId may reference only rectangle, ellipse, or diamond ids. Use arrows when connecting shapes. Arrows and lines may use zero or negative width and height to point in any direction, for example width 0 for a vertical arrow. Lines cannot have label, fromId, or toId.
Do not return a full Excalidraw export. Never include version, source, appState, files, seed, angle, strokeWidth, groupIds, boundElements, bindings, points, arrowheads, or any other internal fields.
Example of the entire response shape: {"summary":"Idea flows to Launch","elements":[{"id":"idea","type":"rectangle","x":0,"y":0,"width":160,"height":80,"label":"Idea"},{"id":"launch","type":"rectangle","x":320,"y":0,"width":160,"height":80,"label":"Launch"},{"id":"flow","type":"arrow","x":160,"y":40,"width":160,"height":0,"fromId":"idea","toId":"launch"}]}.
Allowed colors are six-digit hex values. Favor legible, restrained palettes. Text must use backgroundColor #ffffff if a background is required; otherwise omit it.`;

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
    let activeRequests = 0;
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
      if (activeRequests >= 2) {
        sendJSON(response, 429, { error: "Local agents are already busy" });
        return;
      }

      try {
        activeRequests += 1;
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
        activeRequests -= 1;
      }
    });
  },
});

import { parseAIDiagram } from "./sceneInstructions";

import type { ChatMessage, SelectionContext } from "./aiTypes";

// Chat history, including generated diagrams, survives reloads so agents'
// drawings stay available permanently alongside the persisted canvas.
const STORAGE_KEY = "excalidraw-ai-native-chat";
const MAX_STORED_MESSAGES = 50;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sanitizeSelection = (value: unknown): SelectionContext | undefined => {
  if (!isRecord(value) || !Array.isArray(value.elements)) {
    return undefined;
  }
  const elements = value.elements.filter(
    (element): element is SelectionContext["elements"][number] =>
      isRecord(element) &&
      typeof element.id === "string" &&
      typeof element.type === "string" &&
      typeof element.x === "number" &&
      typeof element.y === "number" &&
      typeof element.width === "number" &&
      typeof element.height === "number",
  );
  return { elements, truncated: value.truncated === true };
};

const sanitizeMessage = (value: unknown): ChatMessage | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    (value.role !== "user" &&
      value.role !== "assistant" &&
      value.role !== "error") ||
    typeof value.content !== "string"
  ) {
    return null;
  }
  const message: ChatMessage = {
    id: value.id,
    role: value.role,
    content: value.content,
  };
  if (typeof value.agentName === "string") {
    message.agentName = value.agentName;
  }
  if (value.applied === true) {
    message.applied = true;
  }
  message.selection = sanitizeSelection(value.selection);
  if (value.diagram !== undefined) {
    try {
      message.diagram = parseAIDiagram(value.diagram);
    } catch {
      // Drop diagrams that no longer satisfy the drawing contract.
    }
  }
  return message;
};

export const loadChatMessages = (): ChatMessage[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(sanitizeMessage)
      .filter((message): message is ChatMessage => message !== null)
      .slice(-MAX_STORED_MESSAGES);
  } catch {
    return [];
  }
};

export const saveChatMessages = (messages: ChatMessage[]) => {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)),
    );
  } catch {
    // Storage may be full or unavailable; the in-memory chat still works.
  }
};

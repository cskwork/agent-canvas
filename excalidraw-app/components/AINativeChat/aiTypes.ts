export const AI_AGENT_IDS = ["claude", "codex", "hermes"] as const;

export type AIAgentId = typeof AI_AGENT_IDS[number];

export type LocalAgent = {
  id: AIAgentId;
  name: string;
  description: string;
  available: boolean;
  recommended: boolean;
};

export const AI_ELEMENT_TYPES = [
  "rectangle",
  "ellipse",
  "diamond",
  "text",
  "arrow",
  "line",
] as const;

export type AIElementType = typeof AI_ELEMENT_TYPES[number];

export type AIElementSpec = {
  id: string;
  type: AIElementType;
  x: number;
  y: number;
  width?: number;
  height?: number;
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

export type AIDiagram = {
  summary: string;
  elements: AIElementSpec[];
};

export type SerializedSelectionElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
};

export type SelectionContext = {
  elements: SerializedSelectionElement[];
  truncated: boolean;
};

export type AgentGenerationResult = {
  agentId: AIAgentId;
  agentName: string;
  ok: boolean;
  diagram?: AIDiagram;
  error?: string;
};

export type AIConversationTurn = {
  role: "user" | "assistant";
  content: string;
  diagram?: AIDiagram;
};

export type GenerateResponse = {
  results: AgentGenerationResult[];
};

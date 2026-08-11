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
  "freedraw",
  "frame",
  "embeddable",
] as const;

export type AIElementType = typeof AI_ELEMENT_TYPES[number];

export const AI_ARROWHEADS = [
  "arrow",
  "bar",
  "dot",
  "circle",
  "circle_outline",
  "triangle",
  "triangle_outline",
  "diamond",
  "diamond_outline",
  "crowfoot_one",
  "crowfoot_many",
  "crowfoot_one_or_many",
  "none",
] as const;

export type AIArrowhead = typeof AI_ARROWHEADS[number];

export const AI_FONT_FAMILIES = ["hand-drawn", "normal", "code"] as const;

export type AIFontFamily = typeof AI_FONT_FAMILIES[number];

export const AI_TEXT_ALIGNS = ["left", "center", "right"] as const;

export type AITextAlign = typeof AI_TEXT_ALIGNS[number];

export type AIElementSpec = {
  id: string;
  type: AIElementType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: [number, number][];
  text?: string;
  label?: string;
  fromId?: string;
  toId?: string;
  startArrowhead?: AIArrowhead;
  endArrowhead?: AIArrowhead;
  elbowed?: boolean;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: "hachure" | "solid" | "cross-hatch";
  strokeStyle?: "solid" | "dashed" | "dotted";
  strokeWidth?: number;
  roughness?: 0 | 1 | 2;
  opacity?: number;
  angle?: number;
  rounded?: boolean;
  fontSize?: number;
  fontFamily?: AIFontFamily;
  textAlign?: AITextAlign;
  link?: string;
  groupIds?: string[];
  children?: string[];
  name?: string;
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

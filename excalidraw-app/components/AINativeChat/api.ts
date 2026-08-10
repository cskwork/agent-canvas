import {
  AI_AGENT_IDS,
  type GenerateResponse,
  type LocalAgent,
} from "./aiTypes";
import { parseAIDiagram } from "./sceneInstructions";

import type { AIConversationTurn, SelectionContext } from "./aiTypes";

const requestJSON = async (url: string, options?: RequestInit) => {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data.error === "string"
        ? data.error
        : `Local agent bridge returned ${response.status}`;
    throw new Error(message);
  }
  return data;
};

export const detectLocalAgents = async (): Promise<LocalAgent[]> => {
  const data = await requestJSON("/api/ai-native/agents");
  if (!data || !Array.isArray(data.agents)) {
    throw new Error("Local agent bridge returned an invalid agent list");
  }
  return data.agents.filter(
    (agent: unknown): agent is LocalAgent =>
      typeof agent === "object" &&
      agent !== null &&
      "id" in agent &&
      typeof agent.id === "string" &&
      AI_AGENT_IDS.includes(agent.id as LocalAgent["id"]) &&
      "name" in agent &&
      typeof agent.name === "string" &&
      "available" in agent &&
      typeof agent.available === "boolean",
  );
};

export const generateWithLocalAgents = async (request: {
  prompt: string;
  agentIds: LocalAgent["id"][];
  selection: SelectionContext;
  history: AIConversationTurn[];
  theme: "light" | "dark";
}): Promise<GenerateResponse> => {
  const data = await requestJSON("/api/ai-native/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Canvas": "1",
    },
    body: JSON.stringify(request),
  });
  if (!data || !Array.isArray(data.results)) {
    throw new Error("Local agent bridge returned an invalid response");
  }

  return {
    results: data.results.map((result: any) => {
      const agentId = AI_AGENT_IDS.includes(result.agentId)
        ? result.agentId
        : request.agentIds[0];
      if (!result.ok) {
        return {
          agentId,
          agentName:
            typeof result.agentName === "string" ? result.agentName : agentId,
          ok: false,
          error:
            typeof result.error === "string"
              ? result.error
              : "The agent did not return a drawing",
        };
      }
      try {
        return {
          agentId,
          agentName:
            typeof result.agentName === "string" ? result.agentName : agentId,
          ok: true,
          diagram: parseAIDiagram(result.diagram),
        };
      } catch (error) {
        return {
          agentId,
          agentName:
            typeof result.agentName === "string" ? result.agentName : agentId,
          ok: false,
          error:
            error instanceof Error ? error.message : "Invalid drawing response",
        };
      }
    }),
  };
};

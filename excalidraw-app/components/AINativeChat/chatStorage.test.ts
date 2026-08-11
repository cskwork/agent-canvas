import { beforeEach, describe, expect, it } from "vitest";

import { loadChatMessages, saveChatMessages } from "./chatStorage";

import type { ChatMessage } from "./aiTypes";

const STORAGE_KEY = "excalidraw-ai-native-chat";

const sampleMessages = (): ChatMessage[] => [
  { id: "m1", role: "user", content: "Draw a flow" },
  {
    id: "m2",
    role: "assistant",
    agentName: "Hermes",
    content: "A flow",
    applied: true,
    selection: { elements: [], truncated: false },
    diagram: {
      summary: "A flow",
      elements: [
        { id: "node", type: "rectangle", x: 0, y: 0, width: 100, height: 60 },
      ],
    },
  },
];

describe("chat storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips messages with diagrams", () => {
    saveChatMessages(sampleMessages());

    const loaded = loadChatMessages();
    expect(loaded).toHaveLength(2);
    expect(loaded[1].diagram?.elements[0].id).toBe("node");
    expect(loaded[1].applied).toBe(true);
  });

  it("returns an empty list for corrupt storage", () => {
    window.localStorage.setItem(STORAGE_KEY, "not json");
    expect(loadChatMessages()).toEqual([]);

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ nope: true }));
    expect(loadChatMessages()).toEqual([]);
  });

  it("drops messages and diagrams that fail validation", () => {
    const messages = sampleMessages();
    (messages[1].diagram as Record<string, unknown>).elements = [
      { id: "bad", type: "nope", x: 0, y: 0 },
    ];
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([...messages, { id: 3, role: "user", content: "no" }]),
    );

    const loaded = loadChatMessages();
    expect(loaded).toHaveLength(2);
    expect(loaded[1].diagram).toBeUndefined();
  });

  it("caps stored history at 50 messages", () => {
    const many: ChatMessage[] = Array.from({ length: 60 }, (_, index) => ({
      id: `m${index}`,
      role: "user",
      content: `prompt ${index}`,
    }));
    saveChatMessages(many);

    const loaded = loadChatMessages();
    expect(loaded).toHaveLength(50);
    expect(loaded[0].content).toBe("prompt 10");
  });
});

import { useEffect, useMemo, useRef, useState } from "react";

import { useExcalidrawStateValue } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import "./AINativeChat.scss";

import { detectLocalAgents, generateWithLocalAgents } from "./api";
import { loadChatMessages, saveChatMessages } from "./chatStorage";
import { applyAIDiagram } from "./sceneMaterializer";
import { serializeSelectedElements } from "./selectionContext";

import type {
  AIDiagram,
  ChatMessage,
  LocalAgent,
  SelectionContext,
} from "./aiTypes";

type QueuedRequest = {
  prompt: string;
  agentIds: LocalAgent["id"][];
  selection: SelectionContext;
};

const EMPTY_SELECTION: SelectionContext = { elements: [], truncated: false };
const SUGGESTIONS = [
  "Draw a user sign-up flow",
  "Turn this selection into a system diagram",
  "Sketch three homepage concepts",
];

const SparkIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.75c.4 4.58 2.67 6.85 7.25 7.25-4.58.4-6.85 2.67-7.25 7.25-.4-4.58-2.67-6.85-7.25-7.25C9.33 9.6 11.6 7.33 12 2.75Z" />
    <path d="M18.5 16.5c.15 1.76 1.24 2.85 3 3-1.76.15-2.85 1.24-3 3-.15-1.76-1.24-2.85-3-3 1.76-.15 2.85-1.24 3-3Z" />
  </svg>
);

const SendIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m4 12 15-7-4.5 14-3-5.5L4 12Z" />
    <path d="m11.5 13.5 7.5-8.5" />
  </svg>
);

const SelectionIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4" />
    <path d="M9 9h6v6H9z" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m7 7 10 10M17 7 7 17" />
  </svg>
);

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const AINativeChat = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => {
  const theme = useExcalidrawStateValue("theme") ?? "light";
  const [isOpen, setIsOpen] = useState(false);
  const [agents, setAgents] = useState<LocalAgent[]>([]);
  const [selectedAgentIds, setSelectedAgentIds] = useState<LocalAgent["id"][]>(
    [],
  );
  const [isDetecting, setIsDetecting] = useState(false);
  const [bridgeError, setBridgeError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [selection, setSelection] = useState<SelectionContext>(EMPTY_SELECTION);
  const [messages, setMessages] = useState<ChatMessage[]>(loadChatMessages);
  const [isGenerating, setIsGenerating] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesStateRef = useRef<ChatMessage[]>(messages);
  const requestQueueRef = useRef<QueuedRequest[]>([]);
  const isProcessingRef = useRef(false);

  useEffect(() => {
    messagesStateRef.current = messages;
    saveChatMessages(messages);
  }, [messages]);

  const availableAgents = useMemo(
    () => agents.filter((agent) => agent.available),
    [agents],
  );

  useEffect(() => {
    if (!isOpen || agents.length > 0) {
      return;
    }
    let ignore = false;
    setIsDetecting(true);
    detectLocalAgents()
      .then((detectedAgents) => {
        if (ignore) {
          return;
        }
        setAgents(detectedAgents);
        const recommended = detectedAgents.find(
          (agent) => agent.available && agent.recommended,
        );
        const fallback = detectedAgents.find((agent) => agent.available);
        const defaultAgent = recommended ?? fallback;
        if (defaultAgent) {
          setSelectedAgentIds([defaultAgent.id]);
        }
        setBridgeError("");
      })
      .catch((error) => {
        if (!ignore) {
          setBridgeError(
            error instanceof Error
              ? error.message
              : "Could not reach the local agent bridge",
          );
        }
      })
      .finally(() => {
        if (!ignore) {
          setIsDetecting(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, [agents.length, isOpen]);

  useEffect(() => {
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [isGenerating, messages]);

  useEffect(() => {
    if (isOpen) {
      window.setTimeout(() => textareaRef.current?.focus(), 180);
    }
  }, [isOpen]);

  const toggleAgent = (agentId: LocalAgent["id"]) => {
    setSelectedAgentIds((current) =>
      current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : [...current, agentId],
    );
  };

  const attachSelection = () => {
    setSelection(serializeSelectedElements(excalidrawAPI));
  };

  const applyDiagram = (
    messageId: string,
    diagram: AIDiagram,
    selectionSnapshot: SelectionContext,
  ) => {
    applyAIDiagram(excalidrawAPI, diagram, selectionSnapshot);
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId ? { ...message, applied: true } : message,
      ),
    );
  };

  const runRequest = async (request: QueuedRequest) => {
    try {
      const response = await generateWithLocalAgents({
        prompt: request.prompt,
        agentIds: request.agentIds,
        selection: request.selection,
        history: messagesStateRef.current
          .filter((message) => message.role !== "error")
          .slice(-4)
          .map((message) => ({
            role: message.role as "user" | "assistant",
            content: message.content,
            diagram:
              message.applied && message.diagram
                ? {
                    summary: message.diagram.summary,
                    elements: message.diagram.elements
                      .slice(0, 30)
                      .map((element) => ({
                        ...element,
                        text: element.text?.slice(0, 300),
                        label: element.label?.slice(0, 300),
                      })),
                  }
                : undefined,
          })),
        theme,
      });
      let autoApplied = false;
      const assistantMessages: ChatMessage[] = response.results.map(
        (result) => {
          if (!result.ok || !result.diagram) {
            return {
              id: makeId(),
              role: "error",
              agentName: result.agentName,
              content: result.error ?? "This agent did not return a drawing.",
            };
          }

          const message: ChatMessage = {
            id: makeId(),
            role: "assistant",
            agentName: result.agentName,
            content: result.diagram.summary,
            diagram: result.diagram,
            selection: request.selection,
            applied: false,
          };
          if (!autoApplied) {
            applyAIDiagram(excalidrawAPI, result.diagram, request.selection);
            message.applied = true;
            autoApplied = true;
          }
          return message;
        },
      );
      setMessages((current) => [...current, ...assistantMessages]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "error",
          content:
            error instanceof Error
              ? error.message
              : "The local agents could not complete this drawing.",
        },
      ]);
    }
  };

  // Prompts sent while agents are busy wait in a client-side FIFO queue and
  // run one at a time, so every request eventually draws.
  const processQueue = async () => {
    if (isProcessingRef.current) {
      return;
    }
    isProcessingRef.current = true;
    setIsGenerating(true);
    try {
      while (requestQueueRef.current.length > 0) {
        const request = requestQueueRef.current.shift()!;
        setQueuedCount(requestQueueRef.current.length);
        await runRequest(request);
      }
    } finally {
      isProcessingRef.current = false;
      setIsGenerating(false);
      setQueuedCount(0);
    }
  };

  const submit = (nextPrompt = prompt) => {
    const trimmedPrompt = nextPrompt.trim();
    if (!trimmedPrompt || selectedAgentIds.length === 0) {
      return;
    }

    setPrompt("");
    setMessages((current) => [
      ...current,
      { id: makeId(), role: "user", content: trimmedPrompt },
    ]);
    requestQueueRef.current.push({
      prompt: trimmedPrompt,
      agentIds: selectedAgentIds,
      selection,
    });
    setQueuedCount(requestQueueRef.current.length);
    void processQueue();
  };

  return (
    <div
      className={`ai-native-chat ai-native-chat--${theme}`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {isOpen ? (
        <section className="ai-native-chat__panel" aria-label="AI drawing chat">
          <header className="ai-native-chat__header">
            <div className="ai-native-chat__brand-mark">
              <SparkIcon />
            </div>
            <div>
              <h2>Agent canvas</h2>
              <p>
                {isDetecting
                  ? "Looking for local agents…"
                  : `${availableAgents.length} local agent${
                      availableAgents.length === 1 ? "" : "s"
                    } ready`}
              </p>
            </div>
            <button
              type="button"
              className="ai-native-chat__icon-button"
              aria-label="Close AI chat"
              onClick={() => setIsOpen(false)}
            >
              <CloseIcon />
            </button>
          </header>

          <div className="ai-native-chat__agents" aria-label="Attached agents">
            {isDetecting && (
              <div
                className="ai-native-chat__agent-skeleton"
                aria-hidden="true"
              />
            )}
            {availableAgents.map((agent) => {
              const isSelected = selectedAgentIds.includes(agent.id);
              return (
                <button
                  key={agent.id}
                  type="button"
                  className="ai-native-chat__agent-chip"
                  aria-pressed={isSelected}
                  title={agent.description}
                  onClick={() => toggleAgent(agent.id)}
                >
                  <span className="ai-native-chat__agent-light" />
                  {agent.name}
                  {agent.recommended && <small>auto</small>}
                </button>
              );
            })}
            {!isDetecting && availableAgents.length === 0 && (
              <span className="ai-native-chat__no-agents">
                {bridgeError || "No supported local agents detected"}
              </span>
            )}
          </div>

          <div className="ai-native-chat__messages" ref={messagesRef}>
            {messages.length === 0 ? (
              <div className="ai-native-chat__welcome">
                <div className="ai-native-chat__orbit" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <SparkIcon />
                </div>
                <h3>Describe it. Watch it take shape.</h3>
                <p>
                  Your local coding agents turn words and selected canvas
                  context into editable Excalidraw elements.
                </p>
                <div className="ai-native-chat__suggestions">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      type="button"
                      key={suggestion}
                      onClick={() => {
                        setPrompt(suggestion);
                        textareaRef.current?.focus();
                      }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <article
                  key={message.id}
                  className={`ai-native-chat__message ai-native-chat__message--${message.role}`}
                >
                  {message.agentName && <strong>{message.agentName}</strong>}
                  <p>{message.content}</p>
                  {message.diagram && (
                    <div className="ai-native-chat__result-row">
                      <span>{message.diagram.elements.length} elements</span>
                      {message.applied ? (
                        <span className="ai-native-chat__applied">Drawn</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            applyDiagram(
                              message.id,
                              message.diagram!,
                              message.selection ?? EMPTY_SELECTION,
                            )
                          }
                        >
                          Draw alternative
                        </button>
                      )}
                    </div>
                  )}
                </article>
              ))
            )}
            {isGenerating && (
              <div className="ai-native-chat__thinking" role="status">
                <span />
                <span />
                <span />
                Agents are sketching
                {queuedCount > 0 ? ` · ${queuedCount} queued` : ""}
              </div>
            )}
          </div>

          <footer className="ai-native-chat__composer">
            {selection.elements.length > 0 && (
              <div className="ai-native-chat__attachment">
                <SelectionIcon />
                <span>
                  {selection.elements.length} selected element
                  {selection.elements.length === 1 ? "" : "s"}
                  {selection.truncated ? " (first 30)" : ""}
                </span>
                <button
                  type="button"
                  aria-label="Remove attached selection"
                  onClick={() => setSelection(EMPTY_SELECTION)}
                >
                  <CloseIcon />
                </button>
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={prompt}
              rows={2}
              maxLength={4_000}
              placeholder="Ask your agents to draw…"
              aria-label="Drawing prompt"
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <div className="ai-native-chat__composer-actions">
              <button
                type="button"
                className="ai-native-chat__attach-button"
                onClick={attachSelection}
              >
                <SelectionIcon />
                Attach selection
              </button>
              <span>
                {selectedAgentIds.length} agent
                {selectedAgentIds.length === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                className="ai-native-chat__send-button"
                aria-label="Send drawing prompt"
                disabled={!prompt.trim() || selectedAgentIds.length === 0}
                onClick={() => void submit()}
              >
                <SendIcon />
              </button>
            </div>
          </footer>
        </section>
      ) : (
        <button
          type="button"
          className="ai-native-chat__trigger"
          aria-label="Open AI drawing chat"
          onClick={() => setIsOpen(true)}
        >
          <span className="ai-native-chat__trigger-icon">
            <SparkIcon />
          </span>
          <span className="ai-native-chat__trigger-copy">
            <strong>Draw with AI</strong>
            <small>Local agents</small>
          </span>
          <span className="ai-native-chat__trigger-status" aria-hidden="true" />
        </button>
      )}
    </div>
  );
};

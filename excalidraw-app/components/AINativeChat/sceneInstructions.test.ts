import { describe, expect, it } from "vitest";

import { parseAIDiagram } from "./sceneInstructions";

const validDiagram = () => ({
  summary: "A two-step flow",
  elements: [
    {
      id: "start",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 180,
      height: 80,
      label: "Start",
      backgroundColor: "#dff5e8",
    },
    {
      id: "finish",
      type: "ellipse",
      x: 300,
      y: 0,
      width: 180,
      height: 80,
      label: "Finish",
    },
    {
      id: "flow",
      type: "arrow",
      x: 180,
      y: 40,
      width: 120,
      height: 0,
      fromId: "start",
      toId: "finish",
    },
  ],
});

describe("parseAIDiagram", () => {
  it("parses a narrow drawing document", () => {
    expect(parseAIDiagram(validDiagram())).toEqual(validDiagram());
  });

  it("rejects internal Excalidraw fields", () => {
    const diagram = validDiagram();
    Object.assign(diagram.elements[0], { versionNonce: 1234 });

    expect(() => parseAIDiagram(diagram)).toThrow(
      "versionNonce is not allowed",
    );
  });

  it("rejects duplicate and unresolved logical IDs", () => {
    const duplicate = validDiagram();
    duplicate.elements[1].id = "start";
    expect(() => parseAIDiagram(duplicate)).toThrow("Duplicate element id");

    const unresolved = validDiagram();
    unresolved.elements[2].toId = "missing";
    expect(() => parseAIDiagram(unresolved)).toThrow(
      "Unknown element reference: missing",
    );
  });

  it("rejects non-finite and out-of-range geometry", () => {
    const diagram = validDiagram();
    diagram.elements[0].x = Number.POSITIVE_INFINITY;

    expect(() => parseAIDiagram(diagram)).toThrow("must be a finite number");
  });

  it("rejects labels and bindings on lines that cannot preserve them", () => {
    const diagram = validDiagram();
    Object.assign(diagram.elements[2] as unknown as Record<string, unknown>, {
      type: "line",
      label: "unsupported",
    });

    expect(() => parseAIDiagram(diagram)).toThrow(
      "line elements cannot have labels or bindings",
    );
  });

  it("validates the whole batch instead of returning partial elements", () => {
    const diagram = validDiagram();
    diagram.elements.push({
      id: "badText",
      type: "text",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    } as typeof diagram.elements[number]);

    expect(() => parseAIDiagram(diagram)).toThrow(
      "text is required for text elements",
    );
  });
});

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

  it("accepts vertical and leftward arrows with zero or negative width", () => {
    const diagram = validDiagram();
    Object.assign(diagram.elements[2], { width: 0, height: 120 });
    expect(parseAIDiagram(diagram).elements[2].width).toBe(0);

    const leftward = validDiagram();
    Object.assign(leftward.elements[2], { width: -120, height: 0 });
    expect(parseAIDiagram(leftward).elements[2].width).toBe(-120);
  });

  it("accepts ids that start with a digit", () => {
    const diagram = validDiagram();
    diagram.elements[1].id = "2fa";
    diagram.elements[2].toId = "2fa";

    expect(parseAIDiagram(diagram).elements[1].id).toBe("2fa");
  });

  it("rejects shapes without a positive width", () => {
    const diagram = validDiagram();
    diagram.elements[0].width = 0;

    expect(() => parseAIDiagram(diagram)).toThrow("must be a finite number");
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

  it("parses multi-point arrows without explicit dimensions", () => {
    const diagram = validDiagram();
    const arrow = diagram.elements[2] as Record<string, unknown>;
    delete arrow.width;
    delete arrow.height;
    arrow.points = [
      [0, 0],
      [60, -40],
      [120, 0],
    ];
    arrow.rounded = true;
    arrow.endArrowhead = "triangle";

    const parsed = parseAIDiagram(diagram);
    expect(parsed.elements[2].points).toHaveLength(3);
    expect(parsed.elements[2].rounded).toBe(true);
  });

  it("rejects points on non-linear elements", () => {
    const diagram = validDiagram();
    Object.assign(diagram.elements[0], {
      points: [
        [0, 0],
        [10, 10],
      ],
    });

    expect(() => parseAIDiagram(diagram)).toThrow(
      "points is only allowed for arrow, line, and freedraw",
    );
  });

  it("requires points for freedraw elements", () => {
    const diagram = validDiagram();
    diagram.elements.push({
      id: "sketch",
      type: "freedraw",
      x: 0,
      y: 0,
    } as unknown as typeof diagram.elements[number]);

    expect(() => parseAIDiagram(diagram)).toThrow(
      "points is required for freedraw elements",
    );
  });

  it("validates frame children", () => {
    const diagram = validDiagram();
    diagram.elements.push({
      id: "wrap",
      type: "frame",
      x: 0,
      y: 0,
      children: ["start", "missing"],
    } as unknown as typeof diagram.elements[number]);

    expect(() => parseAIDiagram(diagram)).toThrow(
      "Unknown frame child: missing",
    );
  });

  it("rejects frames inside frames", () => {
    const diagram = validDiagram();
    diagram.elements.push(
      {
        id: "inner",
        type: "frame",
        x: 0,
        y: 0,
        children: ["start"],
      } as unknown as typeof diagram.elements[number],
      {
        id: "outer",
        type: "frame",
        x: 0,
        y: 0,
        children: ["inner"],
      } as unknown as typeof diagram.elements[number],
    );

    expect(() => parseAIDiagram(diagram)).toThrow(
      "Frame outer cannot contain another frame",
    );
  });

  it("requires a link for embeddable elements", () => {
    const diagram = validDiagram();
    diagram.elements.push({
      id: "embed",
      type: "embeddable",
      x: 0,
      y: 0,
      width: 320,
      height: 200,
    } as unknown as typeof diagram.elements[number]);

    expect(() => parseAIDiagram(diagram)).toThrow(
      "link is required for embeddable elements",
    );
  });

  it("rejects arrowheads outside arrow elements", () => {
    const diagram = validDiagram();
    Object.assign(diagram.elements[0], { endArrowhead: "triangle" });

    expect(() => parseAIDiagram(diagram)).toThrow(
      "endArrowhead is only allowed for arrow elements",
    );
  });

  it("accepts transparent colors and text styling", () => {
    const diagram = validDiagram();
    Object.assign(diagram.elements[0], {
      backgroundColor: "transparent",
      fontSize: 24,
      fontFamily: "code",
      textAlign: "left",
    });

    const parsed = parseAIDiagram(diagram);
    expect(parsed.elements[0].backgroundColor).toBe("transparent");
    expect(parsed.elements[0].fontFamily).toBe("code");
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

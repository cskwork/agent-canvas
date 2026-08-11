import { describe, expect, it } from "vitest";

import { validateDiagram } from "./agentBridgePlugin";

const signUpFlow = () => ({
  summary: "User sign-up flow",
  elements: [
    {
      id: "form",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 200,
      height: 80,
      label: "Sign-up form",
    },
    {
      id: "verify",
      type: "diamond",
      x: 0,
      y: 200,
      width: 200,
      height: 100,
      label: "Verify email",
    },
    {
      id: "down",
      type: "arrow",
      x: 100,
      y: 80,
      width: 0,
      height: 120,
      fromId: "form",
      toId: "verify",
    },
  ],
});

describe("validateDiagram", () => {
  it("accepts vertical arrows with zero width", () => {
    expect(validateDiagram(signUpFlow()).elements).toHaveLength(3);
  });

  it("accepts arrows with negative width pointing left", () => {
    const diagram = signUpFlow();
    Object.assign(diagram.elements[2], { width: -120, height: 0 });

    expect(validateDiagram(diagram).elements).toHaveLength(3);
  });

  it("accepts ids that start with a digit", () => {
    const diagram = signUpFlow();
    diagram.elements[1].id = "2fa-check";
    diagram.elements[2].toId = "2fa-check";

    expect(validateDiagram(diagram).elements[1].id).toBe("2fa-check");
  });

  it("drops unknown and null fields instead of rejecting the drawing", () => {
    const diagram = signUpFlow();
    Object.assign(diagram.elements[1], {
      versionNonce: 1234,
      seed: 42,
      label: null,
    });

    const validated = validateDiagram(diagram);
    expect(validated.elements[1]).not.toHaveProperty("versionNonce");
    expect(validated.elements[1]).not.toHaveProperty("seed");
    expect(validated.elements[1].label).toBeUndefined();
  });

  it("folds text on shapes into a label", () => {
    const diagram = signUpFlow();
    const shape = diagram.elements[0] as Record<string, unknown>;
    delete shape.label;
    shape.text = "Sign-up form";

    const validated = validateDiagram(diagram);
    expect(validated.elements[0].label).toBe("Sign-up form");
    expect(validated.elements[0].text).toBeUndefined();
  });

  it("accepts the extended drawing vocabulary", () => {
    const validated = validateDiagram({
      summary: "Extended vocabulary",
      elements: [
        ...signUpFlow().elements,
        {
          id: "loop",
          type: "arrow",
          x: 200,
          y: 240,
          points: [
            [0, 0],
            [80, -40],
            [80, -160],
            [0, -200],
          ],
          rounded: true,
          endArrowhead: "triangle",
          strokeWidth: 2,
        },
        {
          id: "scribble",
          type: "freedraw",
          x: -100,
          y: 0,
          points: [
            [0, 0],
            [12, 8],
            [30, 4],
          ],
        },
        {
          id: "box",
          type: "frame",
          x: 0,
          y: 0,
          children: ["form", "verify"],
          name: "Sign-up",
        },
        {
          id: "docs",
          type: "embeddable",
          x: 400,
          y: 0,
          width: 320,
          height: 200,
          link: "https://example.com",
        },
      ],
    });

    expect(validated.elements).toHaveLength(7);
  });

  it("rejects shapes without a positive width", () => {
    const diagram = signUpFlow();
    diagram.elements[0].width = 0;

    expect(() => validateDiagram(diagram)).toThrow(
      "elements[0].width must be a finite number between 1 and 4000",
    );
  });

  it("rejects invalid ids", () => {
    const diagram = signUpFlow();
    diagram.elements[0].id = "-broken";

    expect(() => validateDiagram(diagram)).toThrow("elements[0].id is invalid");
  });

  it("rejects out-of-range geometry", () => {
    const diagram = signUpFlow();
    diagram.elements[2].width = -4_001;

    expect(() => validateDiagram(diagram)).toThrow(
      "elements[2].width must be a finite number between -4000 and 4000",
    );
  });
});

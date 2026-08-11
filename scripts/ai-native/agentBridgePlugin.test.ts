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
    Object.assign(diagram.elements[0], {
      versionNonce: 1234,
      strokeWidth: 2,
      label: null,
    });

    const validated = validateDiagram(diagram);
    expect(validated.elements[0]).not.toHaveProperty("versionNonce");
    expect(validated.elements[0]).not.toHaveProperty("strokeWidth");
    expect(validated.elements[0]).not.toHaveProperty("label");
  });

  it("rejects shapes without a positive width and height", () => {
    const diagram = signUpFlow();
    diagram.elements[0].width = 0;

    expect(() => validateDiagram(diagram)).toThrow(
      "Element 1 must have a positive size",
    );
  });

  it("reports invalid ids separately from geometry", () => {
    const diagram = signUpFlow();
    diagram.elements[0].id = "-broken";

    expect(() => validateDiagram(diagram)).toThrow(
      "Element 1 has an invalid id",
    );
  });

  it("rejects out-of-range geometry", () => {
    const diagram = signUpFlow();
    diagram.elements[2].width = -4_001;

    expect(() => validateDiagram(diagram)).toThrow(
      "Element 3 has invalid geometry",
    );
  });
});

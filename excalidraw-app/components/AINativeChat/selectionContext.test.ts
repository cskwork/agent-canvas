import { describe, expect, it } from "vitest";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { materializeAIDiagram } from "./sceneMaterializer";
import { serializeSelectedElements } from "./selectionContext";

const makeAPI = (
  selectedElementIds: Record<string, true>,
): ExcalidrawImperativeAPI => {
  const elements = materializeAIDiagram({
    summary: "Two nodes",
    elements: [
      {
        id: "selected",
        type: "rectangle",
        x: 10,
        y: 20,
        width: 160,
        height: 80,
        label: "Selected label",
      },
      {
        id: "other",
        type: "ellipse",
        x: 300,
        y: 20,
        width: 160,
        height: 80,
        label: "Private label",
      },
    ],
  });
  return {
    getSceneElements: () => elements,
    getAppState: () => ({ selectedElementIds }),
  } as unknown as ExcalidrawImperativeAPI;
};

describe("serializeSelectedElements", () => {
  it("does not leak the whole scene when nothing is selected", () => {
    expect(serializeSelectedElements(makeAPI({}))).toEqual({
      elements: [],
      truncated: false,
    });
  });

  it("includes the selected container and bound label with stable fields only", () => {
    const baseAPI = makeAPI({});
    const allElements = baseAPI.getSceneElements();
    const selectedRectangle = allElements.find(
      (element) => element.type === "rectangle",
    )!;
    const api = {
      getSceneElements: () => allElements,
      getAppState: () => ({
        selectedElementIds: { [selectedRectangle.id]: true },
      }),
    } as unknown as ExcalidrawImperativeAPI;
    const context = serializeSelectedElements(api);

    expect(context.elements.map((element) => element.type)).toEqual([
      "rectangle",
      "text",
    ]);
    expect(context.elements[1].text).toBe("Selected label");
    expect(context.elements[0]).not.toHaveProperty("versionNonce");
    expect(context.elements[0]).not.toHaveProperty("seed");
  });
});

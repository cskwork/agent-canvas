import { describe, expect, it, vi } from "vitest";

import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { isArrowElement } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { applyAIDiagram, materializeAIDiagram } from "./sceneMaterializer";

import type { AIDiagram } from "./aiTypes";

const diagram: AIDiagram = {
  summary: "Connected services",
  elements: [
    {
      id: "api",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 180,
      height: 80,
      label: "API",
    },
    {
      id: "db",
      type: "ellipse",
      x: 300,
      y: 0,
      width: 180,
      height: 80,
      label: "Database",
    },
    {
      id: "query",
      type: "arrow",
      x: 180,
      y: 40,
      width: 120,
      height: 0,
      fromId: "api",
      toId: "db",
    },
  ],
};

describe("AI diagram materialization", () => {
  it("creates complete elements and preserves remapped arrow bindings", () => {
    const elements = materializeAIDiagram(diagram);
    const arrow = elements.find(isArrowElement);
    const containers = elements.filter(
      (element) => element.type === "rectangle" || element.type === "ellipse",
    );

    expect(elements.length).toBeGreaterThan(diagram.elements.length);
    expect(arrow?.startBinding?.elementId).toBe(containers[0].id);
    expect(arrow?.endBinding?.elementId).toBe(containers[1].id);
    expect(arrow?.id).not.toBe("query");
  });

  it("materializes vertical arrows with zero width", () => {
    const elements = materializeAIDiagram({
      summary: "Vertical flow",
      elements: [
        {
          id: "top",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 180,
          height: 80,
          label: "Top",
        },
        {
          id: "bottom",
          type: "rectangle",
          x: 0,
          y: 200,
          width: 180,
          height: 80,
          label: "Bottom",
        },
        {
          id: "down",
          type: "arrow",
          x: 90,
          y: 80,
          width: 0,
          height: 120,
          fromId: "top",
          toId: "bottom",
        },
      ],
    });
    const arrow = elements.find(isArrowElement);

    expect(arrow).toBeDefined();
    expect(arrow?.startBinding?.elementId).toBeDefined();
    expect(arrow?.endBinding?.elementId).toBeDefined();
  });

  it("materializes the extended vocabulary", () => {
    const elements = materializeAIDiagram({
      summary: "Extended",
      elements: [
        {
          id: "node",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 180,
          height: 80,
          label: "Node",
          rounded: true,
          angle: 90,
        },
        {
          id: "loop",
          type: "arrow",
          x: 180,
          y: 40,
          points: [
            [0, 0],
            [80, -40],
            [0, -80],
          ],
          endArrowhead: "none",
        },
        {
          id: "sketch",
          type: "freedraw",
          x: -50,
          y: 0,
          points: [
            [0, 0],
            [12, 8],
            [30, 4],
          ],
        },
        {
          id: "wrap",
          type: "frame",
          x: 0,
          y: 0,
          children: ["node"],
          name: "Zone",
        },
      ],
    });

    const rectangle = elements.find((element) => element.type === "rectangle");
    expect(rectangle?.roundness).not.toBeNull();
    expect(rectangle?.angle).toBeCloseTo(Math.PI / 2);

    const arrow = elements.find(isArrowElement);
    expect(arrow?.points).toHaveLength(3);
    expect(arrow?.endArrowhead).toBeNull();
    expect(arrow?.width).toBe(80);
    expect(arrow?.height).toBe(80);

    const freedraw = elements.find((element) => element.type === "freedraw");
    expect(freedraw?.width).toBe(30);

    const frame = elements.find((element) => element.type === "frame");
    expect(frame).toBeDefined();
    expect(rectangle?.frameId).toBe(frame?.id);
  });

  it("uses a visible default stroke for dark canvases", () => {
    const elements = materializeAIDiagram(
      {
        summary: "Dark node",
        elements: [
          {
            id: "darkNode",
            type: "rectangle",
            x: 0,
            y: 0,
            width: 100,
            height: 60,
          },
        ],
      },
      "#f1f3f5",
    );

    expect(elements[0].strokeColor).toBe("#f1f3f5");
  });

  it("appends atomically, preserves tombstones, and makes the draw undoable", () => {
    const existing = materializeAIDiagram({
      summary: "Old item",
      elements: [
        {
          id: "old",
          type: "rectangle",
          x: 0,
          y: 0,
          width: 20,
          height: 20,
        },
      ],
    })[0];
    const tombstone = { ...existing, isDeleted: true };
    const updateScene = vi.fn();
    const setViewport = vi.fn();
    const api = {
      getSceneElements: () => [],
      getSceneElementsIncludingDeleted: () => [tombstone],
      getAppState: () => ({
        offsetLeft: 0,
        offsetTop: 0,
        width: 1_000,
        height: 800,
        zoom: { value: 1 },
        scrollX: 0,
        scrollY: 0,
        theme: "light",
      }),
      updateScene,
      setViewport,
    } as unknown as ExcalidrawImperativeAPI;

    const count = applyAIDiagram(api, diagram, {
      elements: [],
      truncated: false,
    });

    expect(count).toBeGreaterThan(diagram.elements.length);
    expect(updateScene).toHaveBeenCalledTimes(1);
    const update = updateScene.mock.calls[0][0];
    expect(update.elements[0]).toBe(tombstone);
    expect(update.captureUpdate).toBe(CaptureUpdateAction.IMMEDIATELY);
    expect(Object.values(update.appState.selectedElementIds)).toEqual(
      expect.arrayContaining([true]),
    );
    expect(setViewport).toHaveBeenCalledTimes(1);
  });
});

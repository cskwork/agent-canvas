import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  getCommonBounds,
  newElementWith,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import type { AIDiagram, AIElementSpec, SelectionContext } from "./aiTypes";

const DEFAULT_LIGHT_STROKE = "#1b1b1f";
const DEFAULT_DARK_STROKE = "#f1f3f5";
const DEFAULT_BACKGROUND = "transparent";
const SELECTION_GAP = 96;

const toSkeleton = (
  element: AIElementSpec,
  defaultStroke: string,
): ExcalidrawElementSkeleton => {
  const base = {
    id: element.id,
    type: element.type,
    x: element.x,
    y: element.y,
    strokeColor: element.strokeColor ?? defaultStroke,
    backgroundColor: element.backgroundColor ?? DEFAULT_BACKGROUND,
    fillStyle: element.fillStyle ?? "solid",
    strokeStyle: element.strokeStyle ?? "solid",
    roughness: element.roughness ?? 1,
    opacity: element.opacity ?? 100,
  };

  if (element.type === "text") {
    return {
      ...base,
      type: "text",
      text: element.text!,
    };
  }

  if (element.type === "arrow" || element.type === "line") {
    return {
      ...base,
      type: element.type,
      width: element.width!,
      height: element.height!,
      label: element.label ? { text: element.label } : undefined,
      start: element.fromId ? { id: element.fromId } : undefined,
      end: element.toId ? { id: element.toId } : undefined,
    };
  }

  return {
    ...base,
    type: element.type,
    width: element.width!,
    height: element.height!,
    label: element.label ? { text: element.label } : undefined,
  };
};

const getTargetCenter = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  selection: SelectionContext,
  generatedWidth: number,
) => {
  if (selection.elements.length > 0) {
    const minY = Math.min(...selection.elements.map((element) => element.y));
    const maxX = Math.max(
      ...selection.elements.map((element) => element.x + element.width),
    );
    const maxY = Math.max(
      ...selection.elements.map((element) => element.y + element.height),
    );
    return {
      x: maxX + SELECTION_GAP + generatedWidth / 2,
      y: (minY + maxY) / 2,
    };
  }

  const appState = excalidrawAPI.getAppState();
  return viewportCoordsToSceneCoords(
    {
      clientX: appState.offsetLeft + appState.width / 2,
      clientY: appState.offsetTop + appState.height / 2,
    },
    {
      zoom: appState.zoom,
      offsetLeft: appState.offsetLeft,
      offsetTop: appState.offsetTop,
      scrollX: appState.scrollX,
      scrollY: appState.scrollY,
    },
  );
};

export const materializeAIDiagram = (
  diagram: AIDiagram,
  defaultStroke = DEFAULT_LIGHT_STROKE,
) =>
  convertToExcalidrawElements(
    diagram.elements.map((element) => toSkeleton(element, defaultStroke)),
    {
      regenerateIds: true,
    },
  );

export const applyAIDiagram = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  diagram: AIDiagram,
  selection: SelectionContext,
) => {
  const defaultStroke =
    excalidrawAPI.getAppState().theme === "dark"
      ? DEFAULT_DARK_STROKE
      : DEFAULT_LIGHT_STROKE;
  const generatedElements = materializeAIDiagram(diagram, defaultStroke);
  const [minX, minY, maxX, maxY] = getCommonBounds(generatedElements);
  const width = maxX - minX;
  const target = getTargetCenter(excalidrawAPI, selection, width);
  const deltaX = target.x - (minX + maxX) / 2;
  const deltaY = target.y - (minY + maxY) / 2;
  const positionedElements = generatedElements.map((element) =>
    newElementWith(element, {
      x: element.x + deltaX,
      y: element.y + deltaY,
    }),
  );
  const selectedElementIds = positionedElements.reduce<
    AppState["selectedElementIds"]
  >((selectedIds, element) => ({ ...selectedIds, [element.id]: true }), {});

  excalidrawAPI.updateScene({
    elements: [
      ...excalidrawAPI.getSceneElementsIncludingDeleted(),
      ...positionedElements,
    ],
    appState: { selectedElementIds, selectedGroupIds: {} },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  excalidrawAPI.setViewport({
    target: positionedElements,
    fit: "scale-down",
    animation: { duration: 300 },
    offsets: { ui: true },
  });

  return positionedElements.length;
};

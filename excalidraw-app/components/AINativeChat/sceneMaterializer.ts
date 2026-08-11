import { FONT_FAMILY, ROUNDNESS } from "@excalidraw/common";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  getCommonBounds,
  newElementWith,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import { newEmbeddableElement, newFreeDrawElement } from "@excalidraw/element";

import type { LocalPoint, Radians } from "@excalidraw/math";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element";
import type { Arrowhead, FontFamilyValues } from "@excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import type {
  AIDiagram,
  AIElementSpec,
  AIFontFamily,
  SelectionContext,
} from "./aiTypes";

const DEFAULT_LIGHT_STROKE = "#1b1b1f";
const DEFAULT_DARK_STROKE = "#f1f3f5";
const DEFAULT_BACKGROUND = "transparent";
const SELECTION_GAP = 96;

const FONT_FAMILY_BY_NAME: Record<AIFontFamily, FontFamilyValues> = {
  "hand-drawn": FONT_FAMILY.Excalifont,
  normal: FONT_FAMILY.Nunito,
  code: FONT_FAMILY["Comic Shanns"],
};

const toRadians = (degrees: number | undefined) =>
  degrees === undefined ? undefined : ((degrees * Math.PI) / 180) as Radians;

const toArrowhead = (value: AIElementSpec["startArrowhead"]) =>
  value === undefined ? undefined : value === "none" ? null : (value as Arrowhead);

// Excalidraw expects points[0] at the element origin and width/height to
// match the point bounds; agents send arbitrary offsets, so normalize.
const normalizePoints = (points: [number, number][]) => {
  const [originX, originY] = points[0];
  const shifted = points.map(
    ([x, y]) => [x - originX, y - originY] as LocalPoint,
  );
  const xs = shifted.map(([x]) => x);
  const ys = shifted.map(([, y]) => y);
  return {
    points: shifted,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
};

const toSkeleton = (
  element: AIElementSpec,
  defaultStroke: string,
): ExcalidrawElementSkeleton => {
  const base = {
    id: element.id,
    x: element.x,
    y: element.y,
    strokeColor: element.strokeColor ?? defaultStroke,
    backgroundColor: element.backgroundColor ?? DEFAULT_BACKGROUND,
    fillStyle: element.fillStyle ?? "solid",
    strokeStyle: element.strokeStyle ?? "solid",
    strokeWidth: element.strokeWidth,
    roughness: element.roughness ?? 1,
    opacity: element.opacity ?? 100,
    angle: toRadians(element.angle),
    link: element.link,
    groupIds: element.groupIds,
  };
  const label = element.label
    ? {
        text: element.label,
        fontSize: element.fontSize,
        fontFamily: element.fontFamily
          ? FONT_FAMILY_BY_NAME[element.fontFamily]
          : undefined,
        textAlign: element.textAlign,
      }
    : undefined;

  if (element.type === "text") {
    return {
      ...base,
      type: "text",
      text: element.text!,
      width: element.width,
      height: element.height,
      fontSize: element.fontSize,
      fontFamily: element.fontFamily
        ? FONT_FAMILY_BY_NAME[element.fontFamily]
        : undefined,
      textAlign: element.textAlign,
    } as ExcalidrawElementSkeleton;
  }

  if (element.type === "frame") {
    return {
      type: "frame",
      id: element.id,
      children: element.children!,
      name: element.name,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    } as ExcalidrawElementSkeleton;
  }

  if (element.type === "freedraw") {
    const { points, width, height } = normalizePoints(element.points!);
    return newFreeDrawElement({
      ...base,
      type: "freedraw",
      points,
      width: element.width ?? width,
      height: element.height ?? height,
      simulatePressure: true,
    });
  }

  if (element.type === "embeddable") {
    return newEmbeddableElement({
      ...base,
      type: "embeddable",
      width: element.width!,
      height: element.height!,
      link: element.link!,
    });
  }

  if (element.type === "arrow" || element.type === "line") {
    const pointGeometry = element.points
      ? normalizePoints(element.points)
      : undefined;
    return {
      ...base,
      type: element.type,
      width: pointGeometry?.width ?? element.width!,
      height: pointGeometry?.height ?? element.height!,
      points: pointGeometry?.points,
      roundness: element.rounded
        ? { type: ROUNDNESS.PROPORTIONAL_RADIUS }
        : undefined,
      label,
      ...(element.type === "arrow"
        ? {
            start: element.fromId ? { id: element.fromId } : undefined,
            end: element.toId ? { id: element.toId } : undefined,
            startArrowhead: toArrowhead(element.startArrowhead),
            endArrowhead: toArrowhead(element.endArrowhead),
            elbowed: element.elbowed,
          }
        : {}),
    } as ExcalidrawElementSkeleton;
  }

  return {
    ...base,
    type: element.type,
    width: element.width!,
    height: element.height!,
    roundness: element.rounded
      ? { type: ROUNDNESS.ADAPTIVE_RADIUS }
      : undefined,
    label,
  } as ExcalidrawElementSkeleton;
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

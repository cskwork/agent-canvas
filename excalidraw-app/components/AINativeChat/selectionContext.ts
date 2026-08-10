import { getSelectedElements } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { SelectionContext } from "./aiTypes";

const MAX_SELECTION_ELEMENTS = 30;
const MAX_SELECTION_TEXT = 1_000;

export const serializeSelectedElements = (
  excalidrawAPI: ExcalidrawImperativeAPI,
): SelectionContext => {
  const selectedElements = getSelectedElements(
    excalidrawAPI.getSceneElements(),
    excalidrawAPI.getAppState(),
    {
      includeBoundTextElement: true,
      includeElementsInFrames: true,
    },
  );
  const visibleElements = selectedElements.slice(0, MAX_SELECTION_ELEMENTS);

  return {
    elements: visibleElements.map((element) => {
      const serialized = {
        id: element.id,
        type: element.type,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      } as SelectionContext["elements"][number];
      if (element.type === "text") {
        serialized.text = element.text.slice(0, MAX_SELECTION_TEXT);
      }
      return serialized;
    }),
    truncated: selectedElements.length > visibleElements.length,
  };
};

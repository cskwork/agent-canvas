import {
  AI_ARROWHEADS,
  AI_ELEMENT_TYPES,
  AI_FONT_FAMILIES,
  AI_TEXT_ALIGNS,
  type AIArrowhead,
  type AIDiagram,
  type AIElementSpec,
} from "./aiTypes";

const MAX_ELEMENTS = 80;
const MAX_TEXT_LENGTH = 2_000;
const MAX_SUMMARY_LENGTH = 500;
const MAX_POINTS = 512;
const MAX_LINK_LENGTH = 512;
const MAX_FRAME_NAME_LENGTH = 120;
const MAX_GROUP_IDS = 4;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const LINK_PATTERN = /^https?:\/\/\S+$/;
const ELEMENT_TYPE_SET = new Set<string>(AI_ELEMENT_TYPES);
const SHAPE_TYPES = new Set(["rectangle", "ellipse", "diamond"]);
const POINTED_TYPES = new Set(["arrow", "line", "freedraw"]);
const LABELED_TYPES = new Set(["rectangle", "ellipse", "diamond", "arrow"]);
const FONT_STYLED_TYPES = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "arrow",
  "text",
]);
const ALLOWED_ROOT_KEYS = new Set(["summary", "elements"]);
const ALLOWED_KEYS = new Set([
  "id",
  "type",
  "x",
  "y",
  "width",
  "height",
  "points",
  "text",
  "label",
  "fromId",
  "toId",
  "startArrowhead",
  "endArrowhead",
  "elbowed",
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeStyle",
  "strokeWidth",
  "roughness",
  "opacity",
  "angle",
  "rounded",
  "fontSize",
  "fontFamily",
  "textAlign",
  "link",
  "groupIds",
  "children",
  "name",
]);

export type ParseOptions = {
  // Lenient mode is for the local agent bridge: agents without schema
  // enforcement emit extra, null, or misplaced fields, which we normalize
  // instead of rejecting the whole drawing.
  lenient?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertFiniteNumber = (
  value: unknown,
  name: string,
  min: number,
  max: number,
) => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(
      `${name} must be a finite number between ${min} and ${max}`,
    );
  }
  return value;
};

const optionalString = (value: unknown, name: string, maxLength: number) => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`${name} must be a string up to ${maxLength} characters`);
  }
  return value;
};

const optionalEnum = <T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[],
): T | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${name} is not supported`);
  }
  return value as T;
};

const optionalBoolean = (value: unknown, name: string) => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean`);
  }
  return value;
};

const optionalColor = (value: unknown, name: string) => {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== "string" ||
    (value !== "transparent" && !HEX_COLOR_PATTERN.test(value))
  ) {
    throw new Error(`${name} must be a 6-digit hex color or "transparent"`);
  }
  return value;
};

const parsePoints = (value: unknown, name: string): [number, number][] => {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_POINTS) {
    throw new Error(`${name} must be an array of 2 to ${MAX_POINTS} points`);
  }
  return value.map((point, pointIndex) => {
    if (!Array.isArray(point) || point.length !== 2) {
      throw new Error(`${name}[${pointIndex}] must be an [x, y] pair`);
    }
    return [
      assertFiniteNumber(point[0], `${name}[${pointIndex}][0]`, -4_000, 4_000),
      assertFiniteNumber(point[1], `${name}[${pointIndex}][1]`, -4_000, 4_000),
    ];
  });
};

const parseElement = (
  rawValue: unknown,
  index: number,
  lenient: boolean,
): AIElementSpec => {
  if (!isRecord(rawValue)) {
    throw new Error(`elements[${index}] must be an object`);
  }
  let value = rawValue;
  if (lenient) {
    value = Object.fromEntries(
      Object.entries(rawValue).filter(
        ([key, fieldValue]) => ALLOWED_KEYS.has(key) && fieldValue !== null,
      ),
    );
  } else {
    for (const key of Object.keys(value)) {
      if (!ALLOWED_KEYS.has(key)) {
        throw new Error(`elements[${index}].${key} is not allowed`);
      }
    }
  }

  const id = value.id;
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new Error(`elements[${index}].id is invalid`);
  }
  if (typeof value.type !== "string" || !ELEMENT_TYPE_SET.has(value.type)) {
    throw new Error(`elements[${index}].type is not supported`);
  }
  const type = value.type as AIElementSpec["type"];

  if (lenient) {
    // Agents often put text on shapes or a label on text; fold them over.
    if (
      type !== "text" &&
      typeof value.text === "string" &&
      value.label === undefined
    ) {
      value = { ...value, label: value.text };
      delete value.text;
    }
    if (
      type === "text" &&
      value.text === undefined &&
      typeof value.label === "string"
    ) {
      value = { ...value, text: value.label };
    }
    if (type === "text") {
      delete value.label;
    }
  }

  const element: AIElementSpec = {
    id,
    type,
    x: assertFiniteNumber(value.x, `elements[${index}].x`, -10_000, 10_000),
    y: assertFiniteNumber(value.y, `elements[${index}].y`, -10_000, 10_000),
  };

  if (value.points !== undefined) {
    if (!POINTED_TYPES.has(type)) {
      throw new Error(
        `elements[${index}].points is only allowed for arrow, line, and freedraw`,
      );
    }
    element.points = parsePoints(value.points, `elements[${index}].points`);
  }
  if (type === "freedraw" && element.points === undefined) {
    throw new Error(
      `elements[${index}].points is required for freedraw elements`,
    );
  }

  const needsPositiveSize = SHAPE_TYPES.has(type) || type === "embeddable";
  const dimensionsOptional =
    type === "text" ||
    type === "frame" ||
    (POINTED_TYPES.has(type) && element.points !== undefined);
  if (!dimensionsOptional || value.width !== undefined) {
    element.width = assertFiniteNumber(
      value.width,
      `elements[${index}].width`,
      needsPositiveSize || type === "text" || type === "frame" ? 1 : -4_000,
      4_000,
    );
  }
  if (!dimensionsOptional || value.height !== undefined) {
    element.height = assertFiniteNumber(
      value.height,
      `elements[${index}].height`,
      needsPositiveSize || type === "text" || type === "frame" ? 1 : -4_000,
      4_000,
    );
  }

  element.text = optionalString(
    value.text,
    `elements[${index}].text`,
    MAX_TEXT_LENGTH,
  );
  element.label = optionalString(
    value.label,
    `elements[${index}].label`,
    MAX_TEXT_LENGTH,
  );
  if (type === "text" && !element.text?.trim()) {
    throw new Error(`elements[${index}].text is required for text elements`);
  }
  if (type !== "text" && element.text !== undefined) {
    throw new Error(
      `elements[${index}].text is only allowed for text elements`,
    );
  }
  if (element.label !== undefined && !LABELED_TYPES.has(type)) {
    if (type === "line" || type === "freedraw") {
      throw new Error(
        `elements[${index}] ${type} elements cannot have labels or bindings`,
      );
    }
    throw new Error(
      `elements[${index}].label is not allowed for ${type} elements`,
    );
  }

  for (const reference of ["fromId", "toId"] as const) {
    const referenceValue = value[reference];
    if (referenceValue !== undefined) {
      if (
        type !== "arrow" ||
        typeof referenceValue !== "string" ||
        !ID_PATTERN.test(referenceValue)
      ) {
        if (type === "line" || type === "freedraw") {
          throw new Error(
            `elements[${index}] ${type} elements cannot have labels or bindings`,
          );
        }
        throw new Error(`elements[${index}].${reference} is invalid`);
      }
      element[reference] = referenceValue;
    }
  }

  for (const key of ["startArrowhead", "endArrowhead"] as const) {
    if (value[key] !== undefined) {
      if (type !== "arrow") {
        throw new Error(
          `elements[${index}].${key} is only allowed for arrow elements`,
        );
      }
      element[key] = optionalEnum(
        value[key],
        `elements[${index}].${key}`,
        AI_ARROWHEADS,
      ) as AIArrowhead;
    }
  }
  if (value.elbowed !== undefined) {
    if (type !== "arrow") {
      throw new Error(
        `elements[${index}].elbowed is only allowed for arrow elements`,
      );
    }
    element.elbowed = optionalBoolean(
      value.elbowed,
      `elements[${index}].elbowed`,
    );
  }

  element.strokeColor = optionalColor(
    value.strokeColor,
    `elements[${index}].strokeColor`,
  );
  element.backgroundColor = optionalColor(
    value.backgroundColor,
    `elements[${index}].backgroundColor`,
  );
  element.fillStyle = optionalEnum(value.fillStyle, "fillStyle", [
    "hachure",
    "solid",
    "cross-hatch",
  ] as const);
  element.strokeStyle = optionalEnum(value.strokeStyle, "strokeStyle", [
    "solid",
    "dashed",
    "dotted",
  ] as const);
  if (value.strokeWidth !== undefined) {
    element.strokeWidth = assertFiniteNumber(
      value.strokeWidth,
      `elements[${index}].strokeWidth`,
      0.5,
      32,
    );
  }
  if (value.roughness !== undefined) {
    const roughness = assertFiniteNumber(
      value.roughness,
      `elements[${index}].roughness`,
      0,
      2,
    );
    if (!Number.isInteger(roughness)) {
      throw new Error(`elements[${index}].roughness must be 0, 1, or 2`);
    }
    element.roughness = roughness as 0 | 1 | 2;
  }
  if (value.opacity !== undefined) {
    element.opacity = assertFiniteNumber(
      value.opacity,
      `elements[${index}].opacity`,
      0,
      100,
    );
  }
  if (value.angle !== undefined) {
    element.angle = assertFiniteNumber(
      value.angle,
      `elements[${index}].angle`,
      -360,
      360,
    );
  }
  element.rounded = optionalBoolean(
    value.rounded,
    `elements[${index}].rounded`,
  );

  for (const key of ["fontSize", "fontFamily", "textAlign"] as const) {
    if (value[key] !== undefined && !FONT_STYLED_TYPES.has(type)) {
      throw new Error(
        `elements[${index}].${key} is only allowed for text and labeled elements`,
      );
    }
  }
  if (value.fontSize !== undefined) {
    element.fontSize = assertFiniteNumber(
      value.fontSize,
      `elements[${index}].fontSize`,
      8,
      128,
    );
  }
  element.fontFamily = optionalEnum(
    value.fontFamily,
    `elements[${index}].fontFamily`,
    AI_FONT_FAMILIES,
  );
  element.textAlign = optionalEnum(
    value.textAlign,
    `elements[${index}].textAlign`,
    AI_TEXT_ALIGNS,
  );

  if (value.link !== undefined) {
    if (
      typeof value.link !== "string" ||
      value.link.length > MAX_LINK_LENGTH ||
      !LINK_PATTERN.test(value.link)
    ) {
      throw new Error(
        `elements[${index}].link must be an http(s) URL up to ${MAX_LINK_LENGTH} characters`,
      );
    }
    element.link = value.link;
  }
  if (type === "embeddable" && element.link === undefined) {
    throw new Error(
      `elements[${index}].link is required for embeddable elements`,
    );
  }

  if (value.groupIds !== undefined) {
    if (
      !Array.isArray(value.groupIds) ||
      value.groupIds.length === 0 ||
      value.groupIds.length > MAX_GROUP_IDS ||
      !value.groupIds.every(
        (groupId) => typeof groupId === "string" && ID_PATTERN.test(groupId),
      )
    ) {
      throw new Error(`elements[${index}].groupIds is invalid`);
    }
    if (type === "frame") {
      throw new Error(
        `elements[${index}].groupIds is not allowed for frame elements`,
      );
    }
    element.groupIds = value.groupIds as string[];
  }

  for (const key of ["children", "name"] as const) {
    if (value[key] !== undefined && type !== "frame") {
      throw new Error(
        `elements[${index}].${key} is only allowed for frame elements`,
      );
    }
  }
  if (type === "frame") {
    if (
      !Array.isArray(value.children) ||
      value.children.length === 0 ||
      value.children.length > MAX_ELEMENTS ||
      !value.children.every(
        (childId) => typeof childId === "string" && ID_PATTERN.test(childId),
      )
    ) {
      throw new Error(
        `elements[${index}].children must list the ids inside the frame`,
      );
    }
    element.children = [...new Set(value.children as string[])];
    element.name = optionalString(
      value.name,
      `elements[${index}].name`,
      MAX_FRAME_NAME_LENGTH,
    );
  }

  return element;
};

export const parseAIDiagram = (
  value: unknown,
  options: ParseOptions = {},
): AIDiagram => {
  const lenient = options.lenient === true;
  if (!isRecord(value)) {
    throw new Error("Agent response must be a JSON object");
  }
  if (!lenient) {
    for (const key of Object.keys(value)) {
      if (!ALLOWED_ROOT_KEYS.has(key)) {
        throw new Error(`Agent response field ${key} is not allowed`);
      }
    }
  }
  if (typeof value.summary !== "string" || !value.summary.trim()) {
    throw new Error("Agent response summary is required");
  }
  if (value.summary.length > MAX_SUMMARY_LENGTH) {
    throw new Error(
      `Agent response summary exceeds ${MAX_SUMMARY_LENGTH} characters`,
    );
  }
  if (!Array.isArray(value.elements) || value.elements.length === 0) {
    throw new Error("Agent response must contain at least one element");
  }
  if (value.elements.length > MAX_ELEMENTS) {
    throw new Error(`Agent response exceeds the ${MAX_ELEMENTS} element limit`);
  }

  const elements = value.elements.map((rawElement, index) =>
    parseElement(rawElement, index, lenient),
  );
  const ids = new Set<string>();
  for (const element of elements) {
    if (ids.has(element.id)) {
      throw new Error(`Duplicate element id: ${element.id}`);
    }
    ids.add(element.id);
  }
  const typesById = new Map(
    elements.map((element) => [element.id, element.type]),
  );
  for (const element of elements) {
    for (const reference of [element.fromId, element.toId]) {
      if (reference && !ids.has(reference)) {
        throw new Error(`Unknown element reference: ${reference}`);
      }
      if (reference === element.id) {
        throw new Error(`Element ${element.id} cannot reference itself`);
      }
      if (
        reference &&
        !["rectangle", "ellipse", "diamond"].includes(typesById.get(reference)!)
      ) {
        throw new Error(
          `Element reference ${reference} is not a bindable shape`,
        );
      }
    }
  }
  const framedIds = new Set<string>();
  for (const element of elements) {
    if (element.type !== "frame") {
      continue;
    }
    for (const childId of element.children!) {
      if (!ids.has(childId)) {
        throw new Error(`Unknown frame child: ${childId}`);
      }
      if (typesById.get(childId) === "frame") {
        throw new Error(`Frame ${element.id} cannot contain another frame`);
      }
      if (framedIds.has(childId)) {
        throw new Error(`Element ${childId} belongs to more than one frame`);
      }
      framedIds.add(childId);
    }
  }

  return { summary: value.summary.trim(), elements };
};

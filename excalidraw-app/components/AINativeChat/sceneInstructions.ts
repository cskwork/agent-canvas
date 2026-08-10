import {
  AI_ELEMENT_TYPES,
  type AIDiagram,
  type AIElementSpec,
} from "./aiTypes";

const MAX_ELEMENTS = 80;
const MAX_TEXT_LENGTH = 2_000;
const MAX_SUMMARY_LENGTH = 500;
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const ELEMENT_TYPE_SET = new Set<string>(AI_ELEMENT_TYPES);
const ALLOWED_ROOT_KEYS = new Set(["summary", "elements"]);
const ALLOWED_KEYS = new Set([
  "id",
  "type",
  "x",
  "y",
  "width",
  "height",
  "text",
  "label",
  "fromId",
  "toId",
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeStyle",
  "roughness",
  "opacity",
]);

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

const parseElement = (value: unknown, index: number): AIElementSpec => {
  if (!isRecord(value)) {
    throw new Error(`elements[${index}] must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`elements[${index}].${key} is not allowed`);
    }
  }

  if (typeof value.id !== "string" || !ID_PATTERN.test(value.id)) {
    throw new Error(`elements[${index}].id is invalid`);
  }
  if (typeof value.type !== "string" || !ELEMENT_TYPE_SET.has(value.type)) {
    throw new Error(`elements[${index}].type is not supported`);
  }

  const type = value.type as AIElementSpec["type"];
  const element: AIElementSpec = {
    id: value.id,
    type,
    x: assertFiniteNumber(value.x, `elements[${index}].x`, -10_000, 10_000),
    y: assertFiniteNumber(value.y, `elements[${index}].y`, -10_000, 10_000),
  };

  const needsDimensions = type !== "text";
  if (needsDimensions || value.width !== undefined) {
    element.width = assertFiniteNumber(
      value.width,
      `elements[${index}].width`,
      1,
      4_000,
    );
  }
  if (needsDimensions || value.height !== undefined) {
    element.height = assertFiniteNumber(
      value.height,
      `elements[${index}].height`,
      type === "line" || type === "arrow" ? -4_000 : 1,
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
  if (type === "text" && element.label !== undefined) {
    throw new Error(
      `elements[${index}].label is not allowed for text elements`,
    );
  }

  for (const reference of ["fromId", "toId"] as const) {
    const referenceValue = value[reference];
    if (referenceValue !== undefined) {
      if (
        (type !== "arrow" && type !== "line") ||
        typeof referenceValue !== "string" ||
        !ID_PATTERN.test(referenceValue)
      ) {
        throw new Error(`elements[${index}].${reference} is invalid`);
      }
      element[reference] = referenceValue;
    }
  }

  if (
    type === "line" &&
    (element.label !== undefined ||
      element.fromId !== undefined ||
      element.toId !== undefined)
  ) {
    throw new Error(
      `elements[${index}] line elements cannot have labels or bindings`,
    );
  }

  for (const color of ["strokeColor", "backgroundColor"] as const) {
    const colorValue = value[color];
    if (colorValue !== undefined) {
      if (
        typeof colorValue !== "string" ||
        !HEX_COLOR_PATTERN.test(colorValue)
      ) {
        throw new Error(
          `elements[${index}].${color} must be a 6-digit hex color`,
        );
      }
      element[color] = colorValue;
    }
  }

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

  return element;
};

export const parseAIDiagram = (value: unknown): AIDiagram => {
  if (!isRecord(value)) {
    throw new Error("Agent response must be a JSON object");
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_ROOT_KEYS.has(key)) {
      throw new Error(`Agent response field ${key} is not allowed`);
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

  const elements = value.elements.map(parseElement);
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

  return { summary: value.summary.trim(), elements };
};

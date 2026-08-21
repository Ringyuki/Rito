import {
  expectBoolean,
  expectEnum,
  expectFiniteNumber,
  expectObject,
  expectString,
  requiredField,
  validateArrayItems,
  validateFiniteFields,
  validateOptionalField,
  validateSpacing,
} from './frame-command-buffer-value-validation.js';

const BORDER_STYLES = ['solid', 'dotted', 'dashed', 'double'];

export function validatePagePaint(value, path) {
  const paint = expectObject(value, path);
  validateOptionalField(paint, 'backgroundColor', path, expectString);
}

export function validateBlockDecorationPaint(value, path) {
  const paint = expectObject(value, path);
  validateOptionalField(paint, 'background', path, validateBlockBackground);
  validateOptionalField(paint, 'border', path, validateBlockBorder);
  validateOptionalField(paint, 'radius', path, validateBlockRadius);
  validateOptionalField(paint, 'boxShadow', path, validateBoxShadows);
}

export function validateBorderBox(value, path) {
  const borderBox = expectObject(value, path);
  validateFiniteFields(borderBox, path, ['topWidth', 'rightWidth', 'bottomWidth', 'leftWidth']);
}

export function validateRunPaint(value, path) {
  const paint = expectObject(value, path);
  expectString(requiredField(paint, 'color', path), `${path}.color`);
  validateFont(requiredField(paint, 'font', path), `${path}.font`);
  validateOptionalField(paint, 'wordSpacingPx', path, expectFiniteNumber);
  validateOptionalField(paint, 'letterSpacingPx', path, expectFiniteNumber);
  validateOptionalField(paint, 'backgroundColor', path, expectString);
  validateOptionalField(paint, 'backgroundRadius', path, expectFiniteNumber);
  validateOptionalField(paint, 'textShadow', path, validateTextShadows);
  validateOptionalField(paint, 'decoration', path, validateRunDecoration);
  validateOptionalField(paint, 'padding', path, validateSpacing);
  validateOptionalField(paint, 'border', path, validateRunBorder);
  validateOptionalField(paint, 'box', path, validateRunBox);
  validateOptionalField(paint, 'boxStart', path, expectBoolean);
  validateOptionalField(paint, 'boxEnd', path, expectBoolean);
}

export function validateHorizontalRulePaint(value, path) {
  const paint = expectObject(value, path);
  expectString(requiredField(paint, 'color', path), `${path}.color`);
  expectEnum(requiredField(paint, 'style', path), `${path}.style`, BORDER_STYLES);
}

export function validateTransformFunctions(value, path) {
  validateArrayItems(value, path, validateTransformFunction);
}

function validateTransformFunction(value, path) {
  const transform = expectObject(value, path);
  const kind = expectString(requiredField(transform, 'kind', path), `${path}.kind`);
  switch (kind) {
    case 'translate':
      validateLengthPct(requiredField(transform, 'x', path), `${path}.x`);
      validateLengthPct(requiredField(transform, 'y', path), `${path}.y`);
      return;
    case 'scale':
      expectFiniteNumber(requiredField(transform, 'sx', path), `${path}.sx`);
      expectFiniteNumber(requiredField(transform, 'sy', path), `${path}.sy`);
      return;
    case 'rotate':
      expectFiniteNumber(requiredField(transform, 'rad', path), `${path}.rad`);
      return;
    default:
      expectEnum(kind, `${path}.kind`, ['translate', 'scale', 'rotate']);
  }
}

function validateLengthPct(value, path) {
  const length = expectObject(value, path);
  expectEnum(requiredField(length, 'unit', path), `${path}.unit`, ['px', 'percent']);
  expectFiniteNumber(requiredField(length, 'value', path), `${path}.value`);
}

function validateBlockBackground(value, path) {
  const background = expectObject(value, path);
  validateOptionalField(background, 'color', path, expectString);
  validateOptionalField(background, 'image', path, expectString);
  validateOptionalField(background, 'size', path, validateBackgroundSize);
  validateOptionalField(background, 'repeat', path, (field, fieldPath) =>
    expectEnum(field, fieldPath, ['repeat', 'no-repeat']),
  );
  validateOptionalField(background, 'position', path, validateBackgroundPosition);
}

function validateBackgroundSize(value, path) {
  if (typeof value === 'string') {
    expectEnum(value, path, ['cover', 'contain', 'auto']);
    return;
  }
  const size = expectObject(value, path);
  validateBackgroundSizeAxis(requiredField(size, 'x', path), `${path}.x`);
  validateBackgroundSizeAxis(requiredField(size, 'y', path), `${path}.y`);
}

function validateBackgroundSizeAxis(value, path) {
  if (value === 'auto') return;
  validateLengthPct(value, path);
}

function validateBackgroundPosition(value, path) {
  const position = expectObject(value, path);
  validateLengthPct(requiredField(position, 'x', path), `${path}.x`);
  validateLengthPct(requiredField(position, 'y', path), `${path}.y`);
}

function validateBlockBorder(value, path) {
  const border = expectObject(value, path);
  for (const edge of ['top', 'right', 'bottom', 'left']) {
    validateOptionalField(border, edge, path, validateBorderPaintEdge);
  }
}

function validateBorderPaintEdge(value, path) {
  const edge = expectObject(value, path);
  expectString(requiredField(edge, 'color', path), `${path}.color`);
  expectEnum(requiredField(edge, 'style', path), `${path}.style`, BORDER_STYLES);
}

function validateBlockRadius(value, path) {
  const radius = expectObject(value, path);
  validateOptionalField(radius, 'px', path, expectFiniteNumber);
  validateOptionalField(radius, 'pct', path, expectFiniteNumber);
  // Non-uniform boxes carry four circular corner radii in CSS order
  // (top-left, top-right, bottom-right, bottom-left).
  validateOptionalField(radius, 'corners', path, (cornersValue, cornersPath) => {
    validateArrayItems(cornersValue, cornersPath, expectFiniteNumber);
    if (!Array.isArray(cornersValue) || cornersValue.length !== 4) {
      throw new Error(`${cornersPath} must hold exactly four corner radii`);
    }
  });
}

function validateBoxShadows(value, path) {
  validateArrayItems(value, path, (shadowValue, shadowPath) => {
    const shadow = expectObject(shadowValue, shadowPath);
    validateFiniteFields(shadow, shadowPath, ['offsetX', 'offsetY', 'blur', 'spread']);
    expectString(requiredField(shadow, 'color', shadowPath), `${shadowPath}.color`);
    expectBoolean(requiredField(shadow, 'inset', shadowPath), `${shadowPath}.inset`);
  });
}

function validateFont(value, path) {
  const font = expectObject(value, path);
  expectEnum(requiredField(font, 'style', path), `${path}.style`, ['normal', 'italic']);
  expectFiniteNumber(requiredField(font, 'weight', path), `${path}.weight`);
  expectFiniteNumber(requiredField(font, 'sizePx', path), `${path}.sizePx`);
  expectString(requiredField(font, 'family', path), `${path}.family`);
}

function validateTextShadows(value, path) {
  validateArrayItems(value, path, (shadowValue, shadowPath) => {
    const shadow = expectObject(shadowValue, shadowPath);
    validateFiniteFields(shadow, shadowPath, ['offsetX', 'offsetY', 'blur']);
    expectString(requiredField(shadow, 'color', shadowPath), `${shadowPath}.color`);
  });
}

function validateRunDecoration(value, path) {
  const decoration = expectObject(value, path);
  expectEnum(requiredField(decoration, 'kind', path), `${path}.kind`, [
    'underline',
    'line-through',
  ]);
  expectFiniteNumber(requiredField(decoration, 'y', path), `${path}.y`);
  expectFiniteNumber(requiredField(decoration, 'thickness', path), `${path}.thickness`);
  expectString(requiredField(decoration, 'color', path), `${path}.color`);
}

function validateRunBox(value, path) {
  const box = expectObject(value, path);
  validateFiniteFields(box, path, ['topPx', 'bottomPx']);
}

function validateRunBorder(value, path) {
  const border = expectObject(value, path);
  for (const edge of ['top', 'bottom', 'start', 'end']) {
    validateOptionalField(border, edge, path, validateRunBorderEdge);
  }
}

function validateRunBorderEdge(value, path) {
  const edge = expectObject(value, path);
  expectFiniteNumber(requiredField(edge, 'widthPx', path), `${path}.widthPx`);
  validateBorderPaintEdge(requiredField(edge, 'paint', path), `${path}.paint`);
}

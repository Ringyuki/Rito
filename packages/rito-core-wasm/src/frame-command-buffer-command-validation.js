import {
  validateBlockDecorationPaint,
  validateBorderBox,
  validateHorizontalRulePaint,
  validatePagePaint,
  validateRunPaint,
  validateTransformFunctions,
} from './frame-command-buffer-paint-validation.js';
import {
  expectEnum,
  expectFiniteNumber,
  expectNonNegativeSafeInteger,
  expectObject,
  expectString,
  invalidFrameCommand,
  requiredField,
  validateFiniteFields,
  validateOptionalField,
  validatePoint,
  validateRect,
  validateResolvedRadius,
  validateSize,
} from './frame-command-buffer-value-validation.js';

const COMMAND_KINDS = [
  'pushState',
  'popState',
  'translate',
  'opacity',
  'transform',
  'clipRect',
  'paintPage',
  'paintBlock',
  'paintText',
  'paintRuby',
  'paintImage',
  'paintHorizontalRule',
];

export function validateDecodedFrameCommandRecord(record, index) {
  validateFiniteFields(record, `records[${String(index)}]`, ['x', 'y', 'width', 'height']);
}

export function validateFrameCommand(value, index) {
  const path = `commands[${String(index)}]`;
  const command = expectObject(value, path);
  const kind = expectString(requiredField(command, 'kind', path), `${path}.kind`);
  switch (kind) {
    case 'pushState':
    case 'popState':
      break;
    case 'translate':
      validateFiniteFields(command, path, ['dx', 'dy']);
      break;
    case 'opacity':
      expectFiniteNumber(requiredField(command, 'value', path), `${path}.value`);
      break;
    case 'transform':
      validateTransformCommand(command, path);
      break;
    case 'clipRect':
      validateClipRectCommand(command, path);
      break;
    case 'paintPage':
      validatePaintCommand(command, path, validatePagePaint);
      break;
    case 'paintBlock':
      validatePaintBlockCommand(command, path);
      break;
    case 'paintText':
      validateTextCommand(command, path, true);
      break;
    case 'paintRuby':
      validateTextCommand(command, path, false);
      break;
    case 'paintImage':
      validateImageCommand(command, path);
      break;
    case 'paintHorizontalRule':
      validatePaintCommand(command, path, validateHorizontalRulePaint);
      break;
    default:
      expectEnum(kind, `${path}.kind`, COMMAND_KINDS);
  }
  return command;
}

export function validateFrameCommandSequence(commands) {
  let depth = 0;
  for (const [index, command] of commands.entries()) {
    if (command.kind === 'pushState') {
      depth += 1;
    } else if (command.kind === 'popState') {
      if (depth === 0) {
        invalidFrameCommand(`commands[${String(index)}]`, 'a matching pushState');
      }
      depth -= 1;
    }
  }
  if (depth !== 0) {
    invalidFrameCommand('commands', 'balanced pushState and popState commands');
  }
}

function validateTransformCommand(command, path) {
  validatePoint(requiredField(command, 'origin', path), `${path}.origin`);
  validateSize(requiredField(command, 'box', path), `${path}.box`);
  validateTransformFunctions(requiredField(command, 'transforms', path), `${path}.transforms`);
}

function validateClipRectCommand(command, path) {
  validateRect(requiredField(command, 'rect', path), `${path}.rect`);
  validateOptionalField(command, 'radius', path, validateResolvedRadius);
}

function validatePaintCommand(command, path, validatePaint) {
  validateRect(requiredField(command, 'rect', path), `${path}.rect`);
  validatePaint(requiredField(command, 'paint', path), `${path}.paint`);
}

function validatePaintBlockCommand(command, path) {
  validatePaintCommand(command, path, validateBlockDecorationPaint);
  validateOptionalField(command, 'borderBox', path, validateBorderBox);
}

function validateTextCommand(command, path, validateMetadata) {
  expectString(requiredField(command, 'text', path), `${path}.text`);
  validatePaintCommand(command, path, validateRunPaint);
  if (!validateMetadata) return;
  validateOptionalField(command, 'lineHeightPx', path, expectFiniteNumber);
  validateOptionalField(command, 'href', path, expectString);
  validateOptionalField(command, 'sourceText', path, expectString);
  validateOptionalField(command, 'sourceTextOffset', path, expectNonNegativeSafeInteger);
}

function validateImageCommand(command, path) {
  expectString(requiredField(command, 'src', path), `${path}.src`);
  validateRect(requiredField(command, 'rect', path), `${path}.rect`);
  validateOptionalField(command, 'alt', path, expectString);
  validateOptionalField(command, 'href', path, expectString);
}

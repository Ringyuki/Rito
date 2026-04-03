export { DEFAULT_STYLE } from './defaults';
export { parseCssDeclarations } from './css-property-parser';
export { parseCssRules, parseFontFaceRules } from './css-rule-parser';
export { resolveStyles } from './resolver';
export { matchesSelector, type SelectorTarget } from './selector-matcher';
export { calculateSpecificity, compareSpecificity } from './specificity';
export { getTagStyle } from './tag-styles';
export {
  type ComputedStyle,
  type CssRule,
  type Display,
  DISPLAY_VALUES,
  type FontFaceRule,
  FONT_STYLES,
  type FontStyle,
  FONT_WEIGHTS,
  type FontWeight,
  type Specificity,
  type StyledNode,
  TEXT_ALIGNMENTS,
  type TextAlignment,
  TEXT_DECORATIONS,
  type TextDecoration,
  type VerticalAlign,
  VERTICAL_ALIGNS,
  type Position,
  POSITIONS,
} from './types';

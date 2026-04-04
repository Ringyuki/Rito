import type { ComputedStyle } from '../../../style/core/types';
import type { TextMeasurer } from '../../text/text-measurer';

export interface StyleRange {
  readonly start: number;
  readonly end: number;
  readonly style: ComputedStyle;
}

export interface LineContext {
  readonly text: string;
  readonly baseStyle: ComputedStyle;
  readonly ranges: readonly StyleRange[];
  readonly maxWidth: number;
  readonly lineHeight: number;
  readonly measurer: TextMeasurer;
  readonly preserveWs: boolean;
  readonly allowWrap: boolean;
}

import type {
  RitoCoreWasmTextCaret,
  RitoCoreWasmTextCaretAddress,
  RitoCoreWasmTextInteractionUnavailableReason,
  RitoCoreWasmTextRange,
} from './interaction-text';

export type RitoCoreWasmTextSelectionMovement =
  | 'characterLeft'
  | 'characterRight'
  | 'wordLeft'
  | 'wordRight'
  | 'wordStartRight'
  | 'lineUp'
  | 'lineDown'
  | 'lineStart'
  | 'lineEnd'
  | 'paragraphBackward'
  | 'paragraphForward'
  | 'paragraphPreviousStart'
  | 'paragraphNextStart'
  | 'chapterStart'
  | 'chapterEnd'
  | 'documentStart'
  | 'documentEnd'
  | 'pageUp'
  | 'pageDown';

export interface RitoCoreWasmTextSelectionMovementRequest {
  readonly anchor: RitoCoreWasmTextCaretAddress;
  readonly focus: RitoCoreWasmTextCaretAddress;
  readonly movement: RitoCoreWasmTextSelectionMovement;
  readonly preferredInlinePosition?: number | undefined;
  readonly preferredBlockPosition?: number | undefined;
}

export type RitoCoreWasmTextSelectionMovementResolution =
  | {
      readonly status: 'resolved';
      readonly anchorCaret: RitoCoreWasmTextCaret;
      readonly focusCaret: RitoCoreWasmTextCaret;
      readonly range: RitoCoreWasmTextRange;
      readonly preferredInlinePosition?: number | undefined;
      readonly preferredBlockPosition?: number | undefined;
    }
  | { readonly status: 'boundary'; readonly boundary: 'start' | 'end' }
  | { readonly status: 'pending'; readonly boundary: 'start' | 'end' }
  | {
      readonly status: 'unavailable';
      readonly reason: RitoCoreWasmTextInteractionUnavailableReason;
    };

export interface RitoCoreWasmTextSelectionMovementResponse {
  readonly revisionId: string;
  readonly resolution: RitoCoreWasmTextSelectionMovementResolution;
}

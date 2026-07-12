import type { RitoCoreWasmSourceLocator } from './interaction';

export type RitoCoreWasmPageReadingAnchorUnavailableReason =
  | 'noSourceContent'
  | 'sourceUnavailable';

/** Revision-local projection of a durable source locator for a visible page. */
export type RitoCoreWasmPageReadingAnchor =
  | {
      readonly status: 'resolved';
      readonly revisionId: string;
      readonly pageIndex: number;
      readonly spreadIndex: number;
      /** Persist this locator; page and spread indexes belong only to this revision. */
      readonly locator: RitoCoreWasmSourceLocator;
    }
  | {
      readonly status: 'unavailable';
      readonly revisionId: string;
      readonly pageIndex: number;
      readonly spreadIndex: number;
      readonly reason: RitoCoreWasmPageReadingAnchorUnavailableReason;
    };

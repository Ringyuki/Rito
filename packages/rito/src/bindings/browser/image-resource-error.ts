export type BrowserReaderImageResourceFailureReason =
  | 'resource-unavailable'
  | 'decode-failed'
  | 'unsupported-runtime';

export type BrowserReaderImageLoadOutcome =
  | { readonly status: 'ready' }
  | {
      readonly status: 'failed';
      readonly reason: BrowserReaderImageResourceFailureReason;
      readonly detail?: string | undefined;
    };

export const BROWSER_READER_IMAGE_RESOURCE_ERROR_CODE = 'image-resource-unavailable' as const;

/** Stable terminal error for one image in one exact Core revision. */
export class BrowserReaderImageResourceError extends Error {
  readonly code = BROWSER_READER_IMAGE_RESOURCE_ERROR_CODE;

  constructor(
    readonly reason: BrowserReaderImageResourceFailureReason,
    readonly href: string,
    readonly revisionId: string,
    readonly revisionVersion: number,
    readonly detail?: string | undefined,
  ) {
    super(
      `Reader image resource is unavailable for ${revisionId}@${String(revisionVersion)}: ${href} (${reason})`,
    );
    this.name = 'BrowserReaderImageResourceError';
  }
}

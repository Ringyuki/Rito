export class BrowserReaderCanvasUnsupportedError extends Error {
  readonly feature: string;

  constructor(feature: string) {
    super(`Browser reader session Canvas presenter does not support: ${feature}`);
    this.name = 'BrowserReaderCanvasUnsupportedError';
    this.feature = feature;
  }
}

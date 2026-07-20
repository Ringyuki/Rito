export class BrowserReaderCanvasUnsupportedErrorV1 extends Error {
  readonly feature: string;

  constructor(feature: string) {
    super(`Browser Reader v1 Canvas presenter does not support: ${feature}`);
    this.name = 'BrowserReaderCanvasUnsupportedErrorV1';
    this.feature = feature;
  }
}

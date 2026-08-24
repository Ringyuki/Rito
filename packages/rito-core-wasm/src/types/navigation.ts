export interface RitoCoreWasmLocatorRequest {
  readonly href: string;
}

export interface RitoCoreWasmResolvedLocator {
  readonly revisionId: string;
  readonly href: string;
  readonly spineIdref: string;
  readonly pageIndex: number;
  readonly spreadIndex: number;
  readonly fragment?: string | undefined;
}

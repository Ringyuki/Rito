export interface RitoCoreWasmStatus {
  readonly packageName: '@ritojs/core-wasm';
  readonly status: 'experimental';
  readonly engine: 'rust';
  readonly rustFacade: {
    readonly publicationJson: true;
    readonly createFullRevisionBundleJson: true;
    readonly createInitialPreviewRevisionBundleJson: true;
    readonly createActiveChapterPreviewRevisionBundleJson: true;
    readonly createPreviewRevisionBundleJson: true;
    readonly createViewRevisionBundleJson: true;
    readonly createViewRevisionBundleBytes: boolean;
    readonly runtimeBundleRitorb1: true;
    readonly frameJson: true;
    readonly packedFrameCommandBuffer: true;
    readonly footnoteJson: true;
    readonly footnotesJson: true;
    readonly chapterTextIndicesJson: true;
    readonly pageTargetsJson: true;
    readonly pageTextPositionsJson: true;
    readonly textRangeGeometryJson: true;
    readonly locatorJson: true;
    readonly resourcePrefetchJson: true;
    readonly plannedFrameResourcePrefetchJson: true;
    readonly searchJson: true;
    readonly resourceTransferLeases: true;
    readonly wasmBindgen: true;
    readonly npmWasmArtifact: boolean;
  };
}

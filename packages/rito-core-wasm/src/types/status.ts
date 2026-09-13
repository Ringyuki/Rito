export interface RitoCoreWasmStatus {
  readonly packageName: '@ritojs/core-wasm';
  readonly status: 'experimental';
  readonly engine: 'rust';
  readonly rustFacade: {
    readonly publicationJson: true;
    readonly pinnedFontPolicyJson: true;
    readonly runtimeBundleRitorb1: true;
    readonly frameJson: true;
    readonly packedFrameCommandBuffer: true;
    readonly footnoteJson: true;
    readonly footnotesJson: true;
    readonly chapterTextIndicesJson: true;
    readonly pageTargetsJson: true;
    readonly pageSemanticsJson: true;
    readonly pageReadingAnchorJson: true;
    readonly pageTextPositionsJson: true;
    readonly textRangeGeometryJson: true;
    readonly exactTextInteractionJson: true;
    readonly locatorJson: true;
    readonly resourcePrefetchJson: true;
    readonly plannedFrameResourcePrefetchJson: true;
    readonly searchJson: true;
    readonly resourceTransferLeases: true;
    readonly versionedRevisionAccess: true;
    readonly boundedRevisionControl: true;
    readonly chapterLocalRevisionControl: true;
    readonly boundedSessionController: true;
    readonly readerSession: boolean;
    readonly wasmBindgen: true;
    readonly npmWasmArtifact: boolean;
  };
}

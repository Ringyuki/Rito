import type { RitoCoreWasmStatus } from './types';

export function getRitoCoreWasmStatus(): RitoCoreWasmStatus {
  return createRitoCoreWasmStatus(false);
}

export function createRitoCoreWasmStatus(npmWasmArtifact: boolean): RitoCoreWasmStatus {
  return {
    packageName: '@ritojs/core-wasm',
    status: 'experimental',
    engine: 'rust',
    rustFacade: {
      publicationJson: true,
      pinnedFontPolicyJson: true,
      runtimeBundleRitorb1: true,
      frameJson: true,
      packedFrameCommandBuffer: true,
      footnoteJson: true,
      footnotesJson: true,
      chapterTextIndicesJson: true,
      pageTargetsJson: true,
      pageSemanticsJson: true,
      pageReadingAnchorJson: true,
      pageTextPositionsJson: true,
      textRangeGeometryJson: true,
      exactTextInteractionJson: true,
      locatorJson: true,
      resourcePrefetchJson: true,
      plannedFrameResourcePrefetchJson: true,
      searchJson: true,
      resourceTransferLeases: true,
      versionedRevisionAccess: true,
      revisionControl: true,
      chapterLocalRevisionControl: true,
      revisionSessionController: true,
      readerSession: false,
      wasmBindgen: true,
      npmWasmArtifact,
    },
  };
}

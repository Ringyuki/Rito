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
      createFullRevisionBundleJson: true,
      createInitialPreviewRevisionBundleJson: true,
      createActiveChapterPreviewRevisionBundleJson: true,
      createPreviewRevisionBundleJson: true,
      createViewRevisionBundleJson: true,
      createViewRevisionBundleBytes: true,
      runtimeBundleRitorb1: true,
      frameJson: true,
      packedFrameCommandBuffer: true,
      footnoteJson: true,
      footnotesJson: true,
      chapterTextIndicesJson: true,
      pageTargetsJson: true,
      pageTextPositionsJson: true,
      textRangeGeometryJson: true,
      locatorJson: true,
      resourcePrefetchJson: true,
      plannedFrameResourcePrefetchJson: true,
      searchJson: true,
      resourceTransferLeases: true,
      versionedRevisionAccess: true,
      boundedRevisionControl: true,
      boundedSessionController: true,
      wasmBindgen: true,
      npmWasmArtifact,
    },
  };
}

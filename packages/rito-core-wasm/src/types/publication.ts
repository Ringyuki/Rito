export interface RitoCoreWasmPackageMetadata {
  readonly title: string;
  readonly language: string;
  readonly identifier: string;
  readonly creator?: string | undefined;
}

export interface RitoCoreWasmManifestItem {
  readonly id: string;
  readonly href: string;
  readonly mediaType: string;
  readonly properties?: readonly string[] | undefined;
}

export interface RitoCoreWasmSpineItem {
  readonly idref: string;
  readonly linear: boolean;
}

export interface RitoCoreWasmTocEntry {
  readonly label: string;
  readonly href: string;
  readonly children: readonly RitoCoreWasmTocEntry[];
}

export interface RitoCoreWasmPackageDocument {
  readonly metadata: RitoCoreWasmPackageMetadata;
  readonly manifest: readonly RitoCoreWasmManifestItem[];
  readonly spine: readonly RitoCoreWasmSpineItem[];
  readonly toc: readonly RitoCoreWasmTocEntry[];
}

export interface RitoCoreWasmTextResourceSummary {
  readonly href: string;
  readonly textLength: number;
  readonly textHash: string;
}

export interface RitoCoreWasmBinaryResourceSummary {
  readonly href: string;
  readonly byteLength: number;
  readonly byteHash?: string | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export interface RitoCoreWasmPublicationResources {
  readonly stylesheets: readonly RitoCoreWasmTextResourceSummary[];
  readonly fonts: readonly RitoCoreWasmBinaryResourceSummary[];
  readonly images: readonly RitoCoreWasmBinaryResourceSummary[];
}

export interface RitoCoreWasmChapterSource {
  readonly idref: string;
  readonly href: string;
  readonly linear: boolean;
  readonly textLength: number;
  readonly textHash: string;
}

export interface RitoCoreWasmFontFaceSummary {
  readonly family: string;
  readonly href: string;
  readonly style?: string | undefined;
  readonly weight?: string | undefined;
}

export interface RitoCoreWasmPublicationInfo {
  readonly package: RitoCoreWasmPackageDocument;
  readonly resources: RitoCoreWasmPublicationResources;
  readonly chapters: readonly RitoCoreWasmChapterSource[];
  readonly fontFaces: readonly RitoCoreWasmFontFaceSummary[];
}

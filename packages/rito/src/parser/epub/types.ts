// EPUB container and package types.

/** Represents a single item in the EPUB manifest. */
export interface ManifestItem {
  readonly id: string;
  readonly href: string;
  readonly mediaType: string;
  readonly properties?: readonly string[];
}

/** Represents the EPUB spine (reading order). */
export interface SpineItem {
  readonly idref: string;
  readonly linear: boolean;
}

/** Represents parsed EPUB package metadata. */
export interface PackageMetadata {
  readonly title: string;
  readonly language: string;
  readonly identifier: string;
  readonly creator?: string;
}

/** Represents a fully parsed EPUB package document. */
export interface PackageDocument {
  readonly metadata: PackageMetadata;
  readonly manifest: readonly ManifestItem[];
  readonly spine: readonly SpineItem[];
}

/** A single entry in the table of contents. */
export interface TocEntry {
  readonly label: string;
  readonly href: string;
  readonly children: readonly TocEntry[];
}

import type { ImageDimensions } from '../../layout/core/types';

export type { ImageDimensions };

export interface ImageResource {
  readonly href: string;
  readonly bytes: Uint8Array;
}

export interface ImageDecoder<TImage extends ImageDimensions> {
  decode(resource: ImageResource): Promise<TImage>;
  dispose(image: TImage): void;
}

export interface FontResource {
  readonly family: string;
  readonly src: string;
  readonly bytes: Uint8Array;
  readonly weight?: string;
  readonly style?: string;
}

export interface FontRegistry {
  loadFont(resource: FontResource): Promise<void>;
}

export interface ImageAssetResolver<TImage extends ImageDimensions> {
  resolveImage(src: string): TImage | undefined;
}

export interface ImageObjectUrlProvider {
  createImageObjectUrl(src: string): string | undefined;
}

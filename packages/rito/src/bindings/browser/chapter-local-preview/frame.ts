import { createCanvasImageResolver } from '../image-href-resolver';
import type { BrowserReaderFrame, BrowserReaderState } from '../reader/types';
import { sameBrowserReaderChapterLocalOwner } from './state';
import type {
  BrowserReaderChapterLocalFrameBuffer,
  BrowserReaderChapterLocalOwner,
  BrowserReaderChapterLocalResolvedFrame,
  BrowserReaderChapterLocalResourceBytes,
} from './types';

export function decodeBrowserReaderChapterLocalFrame(
  state: BrowserReaderState,
  owner: BrowserReaderChapterLocalOwner,
  localSpreadIndex: number,
  mountSpreadIndex: number,
  buffer: BrowserReaderChapterLocalFrameBuffer,
): BrowserReaderFrame {
  requireFrameOwner(buffer, owner, localSpreadIndex);
  const metadata = {
    ...buffer.metadata,
    revisionId: owner.revisionId,
    spreadIndex: mountSpreadIndex,
  };
  const decoded = state.decodeFrameCommandBuffer(metadata, buffer.bytes);
  return {
    revisionId: owner.revisionId,
    spreadIndex: mountSpreadIndex,
    width: metadata.width,
    height: metadata.height,
    commands: decoded.commands,
    commandHash: metadata.commandHash,
    resourceRefs: { images: metadata.resourceTable },
    fontFamilies: metadata.fontFamilies,
    imageDominated: metadata.imageDominated,
  };
}

export async function prepareBrowserReaderChapterLocalFrameResources(
  owner: BrowserReaderChapterLocalOwner,
  _localSpreadIndex: number,
  frame: BrowserReaderFrame,
  response: BrowserReaderChapterLocalResolvedFrame,
): Promise<Map<string, ImageBitmap> | undefined> {
  if (response.missingResources.length > 0) return undefined;
  requireResourceOwners(response.resources, owner);
  const images = await decodePreviewImages(response.resources);
  if (typeof createImageBitmap === 'undefined') return images;
  const resolveImage = createCanvasImageResolver(images);
  if (frame.resourceRefs.images.every((href) => resolveImage(href) !== undefined)) return images;
  closeBrowserReaderChapterLocalImages(images);
  return undefined;
}

export function closeBrowserReaderChapterLocalImages(images: Map<string, ImageBitmap>): void {
  for (const image of images.values()) {
    try {
      image.close();
    } catch {
      // Continue releasing the remaining preview-owned bitmaps.
    }
  }
  images.clear();
}

async function decodePreviewImages(
  resources: readonly BrowserReaderChapterLocalResourceBytes[],
): Promise<Map<string, ImageBitmap>> {
  const images = new Map<string, ImageBitmap>();
  if (typeof createImageBitmap === 'undefined') return images;
  try {
    for (const resource of resources) {
      const image = await createImageBitmap(
        new Blob([ownedArrayBuffer(resource.bytes)], { type: resource.payload.mediaType }),
      );
      images.get(resource.payload.href)?.close();
      images.set(resource.payload.href, image);
    }
    return images;
  } catch (error) {
    closeBrowserReaderChapterLocalImages(images);
    throw error;
  }
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function requireFrameOwner(
  buffer: BrowserReaderChapterLocalFrameBuffer,
  owner: BrowserReaderChapterLocalOwner,
  localSpreadIndex: number,
): void {
  if (
    !sameBrowserReaderChapterLocalOwner(buffer.owner, owner) ||
    !sameBrowserReaderChapterLocalOwner(buffer.metadata.owner, owner) ||
    buffer.localSpreadIndex !== localSpreadIndex ||
    buffer.metadata.localSpreadIndex !== localSpreadIndex
  ) {
    throw new Error('Reader chapter-local frame does not match its exact owner request');
  }
}

function requireResourceOwners(
  resources: readonly BrowserReaderChapterLocalResourceBytes[],
  owner: BrowserReaderChapterLocalOwner,
): void {
  for (const resource of resources) {
    if (!sameBrowserReaderChapterLocalOwner(resource.payload.owner, owner)) {
      throw new Error('Reader chapter-local resource does not match its exact owner request');
    }
  }
}

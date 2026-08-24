import type { FontRegistry, FontResource } from '../types';
import { toExactArrayBuffer } from '../bytes';

export function createWebFontRegistry(fonts: FontFaceSet = document.fonts): FontRegistry {
  const registered = new Set<FontFace>();
  let disposed = false;
  const isDisposed = (): boolean => disposed;
  return {
    async loadFont(resource: FontResource): Promise<void> {
      if (isDisposed()) throw new Error('Font registry has been disposed');
      const descriptors: FontFaceDescriptors = {};
      if (resource.weight) descriptors.weight = resource.weight;
      if (resource.style) descriptors.style = resource.style;

      const face = new FontFace(resource.family, toExactArrayBuffer(resource.bytes), descriptors);
      await face.load();
      if (isDisposed()) return;
      fonts.add(face);
      registered.add(face);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const face of registered) fonts.delete(face);
      registered.clear();
    },
  };
}

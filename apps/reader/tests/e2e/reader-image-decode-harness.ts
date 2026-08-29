import type { Page } from '@playwright/test';

export async function installDelayedImageDecode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface ImageDecodeGate {
      __ritoImageDecodePending?: boolean;
      __ritoImageDecodeComplete?: boolean;
      __ritoReleaseImageDecode?: () => void;
    }
    const scope = globalThis as typeof globalThis & ImageDecodeGate;
    const original = globalThis.createImageBitmap.bind(globalThis);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    scope.__ritoReleaseImageDecode = () => release?.();
    globalThis.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
      scope.__ritoImageDecodePending = true;
      await gate;
      const image = await Reflect.apply(original, globalThis, args);
      scope.__ritoImageDecodeComplete = true;
      return image;
    }) as typeof createImageBitmap;
    // The reader prefers element-sourced decodes (HTMLImageElement.decode)
    // where a DOM exists; gate that primitive through the same release.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-applied via Reflect with the element as receiver
    const originalDecode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function decode(
      ...args: Parameters<HTMLImageElement['decode']>
    ) {
      scope.__ritoImageDecodePending = true;
      await gate;
      await Reflect.apply(originalDecode, this, args);
      scope.__ritoImageDecodeComplete = true;
    };
  });
}

export function imageDecodePending(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      (globalThis as typeof globalThis & { __ritoImageDecodePending?: boolean })
        .__ritoImageDecodePending === true,
  );
}

export function releaseImageDecode(page: Page): Promise<void> {
  return page.evaluate(() => {
    (
      globalThis as typeof globalThis & { __ritoReleaseImageDecode?: () => void }
    ).__ritoReleaseImageDecode?.();
  });
}

export function imageDecodeComplete(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      (globalThis as typeof globalThis & { __ritoImageDecodeComplete?: boolean })
        .__ritoImageDecodeComplete === true,
  );
}

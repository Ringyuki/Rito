# Stable Primitives

The main `@ritojs/core` entry is platform-neutral. It exposes parsing,
pagination, spread grouping, display-list construction, and adapter contracts.
Browser Canvas helpers live in `@ritojs/core/web`.

## Pipeline Overview

```ts
import {
  loadEpub,
  createLayoutConfig,
  paginate,
  buildSpreads,
  buildSpreadDisplayList,
} from '@ritojs/core';
```

Typical flow:

1. `loadEpub()` to parse the archive
2. `createLayoutConfig()` to define geometry
3. provide a platform `TextMeasurer` and call `paginate()`
4. `buildSpreads()` to group pages
5. `buildSpreadDisplayList()` to produce platform-neutral paint commands
6. execute the display list with an injected backend

## Exports

| Export                                   | Use when                                                        |
| ---------------------------------------- | --------------------------------------------------------------- |
| `loadEpub(data, options?)`               | You want a parsed `EpubDocument` with lazy chapter reads        |
| `paginate(doc, config, measurer)`        | You want full-book pagination from a loaded document            |
| `buildSpreads(pages, config)`            | You want presentation-layer spread grouping from pages          |
| `buildPageDisplayList(page, config)`     | You want paint commands for one page                            |
| `buildSpreadDisplayList(spread, config)` | You want paint commands for a spread                            |
| `createLayoutConfig(input)`              | You want a `LayoutConfig` from shorthand viewport input         |
| `loadFontsWithRegistry()`                | You want injected font registration without assuming Web APIs   |
| `loadImagesWithDecoder()`                | You want injected image decoding without assuming `ImageBitmap` |

Commonly used types include `TextMeasurer`, `TextMetrics`, `FontMetricsProvider`, `FontMetrics`,
`DisplayListRenderer`, `TextMeasurementBackend`, `ImageAssetResolver`, `ImageDecoder`, and
`ImageDimensions`.

`loadEpub()` is safe to use in Node and worker runtimes; XML parsing does not
depend on a browser-global `DOMParser`. ZIP resource budgets are enabled by
default and can be tightened for a host application:

```ts
const doc = loadEpub(epubData, {
  zipLimits: {
    maxArchiveBytes: 100 * 1024 * 1024,
    maxTotalUncompressedBytes: 250 * 1024 * 1024,
    maxEntryUncompressedBytes: 64 * 1024 * 1024,
    maxEntries: 5_000,
    maxCompressionRatio: 100,
  },
});
```

This is the entry to build on for Flutter, Skia, native UI, server-side
rendering, or any runtime where Rito should not assume browser globals.

## Example: Custom Pipeline

```ts
import {
  loadEpub,
  createLayoutConfig,
  paginate,
  buildSpreads,
  buildSpreadDisplayList,
} from '@ritojs/core';

const doc = loadEpub(epubData);
const config = createLayoutConfig({
  width: 800,
  height: 600,
  margin: 40,
  spread: 'double',
});

const measurer = createYourPlatformTextMeasurer();
const pages = paginate(doc, config, measurer);
const spreads = buildSpreads(pages, config);

const spread = spreads[0];

if (spread) {
  const displayList = buildSpreadDisplayList(spread, config, { backgroundColor: '#ffffff' });
  yourRenderer.render(displayList, yourTarget);
}
```

## Web Canvas Preset

For browser Canvas code, import the Web preset:

```ts
import { createTextMeasurer, prepare, render } from '@ritojs/core/web';
```

`prepare()` loads Web fonts/images and paginates. `render()` executes the spread display list with
the default Canvas backend.

## Notes

- `prepare()` is a Web preset helper, not a main-entry core API.
- `paginate()` expects a `TextMeasurer`. In browser code, use `createTextMeasurer()` from `@ritojs/core/web`.
- `FontMetricsProvider` is a platform text capability for backends and future line-metric work; the default Canvas measurer implements it.
- `render()` and `disposeResources()` are Web preset helpers for the default Canvas path.
- Backends are structural TypeScript objects; they implement the `DisplayListRenderer` or `TextMeasurementBackend` shape without inheriting from a base class.

## Related Docs

- [Reader API](./reader.md)
- [Advanced Entry](./advanced.md)

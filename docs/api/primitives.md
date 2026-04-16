# Stable Primitives

These exports come from the main `@rito/core` entry and are intended for custom pipelines.

## Pipeline Overview

```ts
import {
  loadEpub,
  createLayoutConfig,
  prepare,
  createTextMeasurer,
  paginate,
  buildSpreads,
  render,
} from '@rito/core';
```

Typical flow:

1. `loadEpub()` to parse the archive
2. `createLayoutConfig()` to define geometry
3. choose one of:
   - `createTextMeasurer()` + `paginate()` for a fully manual pipeline
   - `prepare()` for load-assets + paginate in one step
4. `buildSpreads()` to group pages
5. `render()` to paint a spread

## Exports

| Export                               | Use when                                                           |
| ------------------------------------ | ------------------------------------------------------------------ |
| `loadEpub(data, options?)`           | You want a parsed `EpubDocument` with lazy chapter reads           |
| `prepare(doc, config, canvas)`       | You want one call that loads browser resources and paginates       |
| `disposeResources(resources)`        | You need to release decoded image resources created by `prepare()` |
| `render(spread, ctx, config, opts?)` | You already have a spread and want to paint it                     |
| `paginate(doc, config, measurer)`    | You want full-book pagination from a loaded document               |
| `buildSpreads(pages, config)`        | You want presentation-layer spread grouping from pages             |
| `createLayoutConfig(input)`          | You want a `LayoutConfig` from shorthand viewport input            |
| `getSpreadDimensions(config)`        | You need spread canvas dimensions without rendering                |
| `createTextMeasurer(canvas)`         | You need a text measurer from a canvas element                     |

## Example: Custom Pipeline

```ts
import {
  loadEpub,
  createLayoutConfig,
  createTextMeasurer,
  paginate,
  buildSpreads,
  render,
} from '@rito/core';

const doc = loadEpub(epubData);
const config = createLayoutConfig({
  width: 800,
  height: 600,
  margin: 40,
  spread: 'double',
});

const measurer = createTextMeasurer(canvas);
const pages = paginate(doc, config, measurer);
const spreads = buildSpreads(pages, config);

const spread = spreads[0];
const ctx = canvas.getContext('2d');

if (spread && ctx) {
  render(spread, ctx, config, { backgroundColor: '#ffffff' });
}
```

## Notes

- `prepare()` is the highest-level primitive path. It already loads assets and paginates, so you do not call `paginate()` separately on that path.
- `paginate()` expects a text measurer. In browser code, use `createTextMeasurer()`.
- `disposeResources()` should be called when you are done with prepared decoded assets.

## Related Docs

- [Reader API](./reader.md)
- [Advanced Entry](./advanced.md)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { RESIZE_SETTLE_MS } from '../src/controller/facade/resize-settle';

const SESSION_RS = join(
  import.meta.dirname,
  '../../../crates/rito-core/src/runtime/reader_session/session.rs',
);

describe('a resize holds the book as long as the engine declares', () => {
  it('settles for the engine relayout settle', () => {
    const declared = /pub const READER_RELAYOUT_SETTLE_MS: u32 = (\d+);/.exec(
      readFileSync(SESSION_RS, 'utf8'),
    );
    expect(declared).not.toBeNull();
    expect(RESIZE_SETTLE_MS).toBe(Number(declared?.[1]));
  });
});

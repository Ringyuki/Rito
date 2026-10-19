import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BOOK_QUANTUM } from '../../src/bindings/browser/session-reader/artifacts';

const SESSION_RS = join(
  import.meta.dirname,
  '../../../../crates/rito-core/src/runtime/reader_session/session.rs',
);

describe('the reader paces the book as the engine declares', () => {
  it('asks each step of the whole book for the engine frame quantum', () => {
    const declared = /pub const READER_FRAME_QUANTUM_PAGES: u32 = (\d+);/.exec(
      readFileSync(SESSION_RS, 'utf8'),
    );
    expect(declared).not.toBeNull();
    expect(BOOK_QUANTUM).toBe(Number(declared?.[1]));
  });
});

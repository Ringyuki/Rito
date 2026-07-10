import { describe, expect, it } from 'vitest';
import { createReader as createRootReader } from '../../src/index';
import { createReader as createReferenceReader } from '../../src/reference';
import { createReader as createWebCompatibilityReader } from '../../src/compatibility/web';

describe('TypeScript reference core facade', () => {
  it('keeps the reference reader separate from the root production reader', () => {
    expect(createReferenceReader).not.toBe(createRootReader);
  });

  it('keeps the source-only web compatibility reader on the reference implementation', () => {
    expect(createWebCompatibilityReader).toBe(createReferenceReader);
  });
});

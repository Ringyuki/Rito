import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import { BOOK, book, pack } from './helpers';

const MISSING = 'listed in the package but not readable from the archive';

describe('checkPublication', () => {
  it('finds a well-formed book readable, without problems', async () => {
    await expect(pack.checkPublication(BOOK)).resolves.toEqual({ readable: true, problems: [] });
    await expect(pack.checkPublication(book())).resolves.toEqual({ readable: true, problems: [] });
  });

  it('fails a book whose chapter the archive lacks, as laying the book out does', async () => {
    const check = await pack.checkPublication(book({ 'chapter-2.xhtml': undefined }));
    expect(check.readable).toBe(false);
    expect(check.readable ? '' : check.error).toContain('OPS/chapter-2.xhtml');
  });

  it('fails a book whose chapter links a stylesheet the archive lacks', async () => {
    const check = await pack.checkPublication(book({ 'style.css': undefined }));
    expect(check.readable ? '' : check.error).toContain('ExternalStylesheetMissing');
  });

  it('reads a chapter that does not parse as empty, and says so', async () => {
    const check = await pack.checkPublication(book({ 'chapter-2.xhtml': 'not markup <<<' }));
    expect(check.readable).toBe(true);
    const problems = check.readable ? check.problems : [];
    expect(problems).toHaveLength(1);
    expect(problems[0]?.path).toBe('OPS/chapter-2.xhtml');
    expect(problems[0]?.message).toMatch(/^shows no content: Invalid XHTML/);
  });

  it('lists a listed image the archive lacks as a problem', async () => {
    await expect(pack.checkPublication(book({ 'plate.png': undefined }))).resolves.toEqual({
      readable: true,
      problems: [{ path: 'OPS/plate.png', message: MISSING }],
    });
  });

  it('fails what is not an EPUB', async () => {
    const check = await pack.checkPublication(strToU8('plain text'));
    expect(check.readable).toBe(false);
    expect(check.readable ? '' : check.error).toMatch(/Invalid EPUB ZIP/);
  });
});

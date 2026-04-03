// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseNavDocument, parseNcx } from '../../src/parser/epub/toc-parser';

describe('parseNavDocument', () => {
  it('parses a valid EPUB3 nav document', () => {
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="chapter1.xhtml">Chapter 1</a></li>
      <li><a href="chapter2.xhtml">Chapter 2</a></li>
    </ol>
  </nav>
</body>
</html>`;

    const entries = parseNavDocument(xhtml);
    expect(entries).toEqual([
      { label: 'Chapter 1', href: 'chapter1.xhtml', children: [] },
      { label: 'Chapter 2', href: 'chapter2.xhtml', children: [] },
    ]);
  });

  it('returns empty array when no nav element exists', () => {
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<body><p>No nav here</p></body>
</html>`;

    expect(parseNavDocument(xhtml)).toEqual([]);
  });

  it('returns empty array when nav has no ol', () => {
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <nav epub:type="toc"></nav>
</body>
</html>`;

    expect(parseNavDocument(xhtml)).toEqual([]);
  });

  it('parses nested TOC entries', () => {
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <nav epub:type="toc">
    <ol>
      <li>
        <a href="part1.xhtml">Part 1</a>
        <ol>
          <li><a href="ch1.xhtml">Chapter 1</a></li>
          <li><a href="ch2.xhtml">Chapter 2</a></li>
        </ol>
      </li>
      <li><a href="part2.xhtml">Part 2</a></li>
    </ol>
  </nav>
</body>
</html>`;

    const entries = parseNavDocument(xhtml);
    expect(entries).toEqual([
      {
        label: 'Part 1',
        href: 'part1.xhtml',
        children: [
          { label: 'Chapter 1', href: 'ch1.xhtml', children: [] },
          { label: 'Chapter 2', href: 'ch2.xhtml', children: [] },
        ],
      },
      { label: 'Part 2', href: 'part2.xhtml', children: [] },
    ]);
  });

  it('ignores nav elements without epub:type="toc"', () => {
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <nav epub:type="landmarks">
    <ol><li><a href="cover.xhtml">Cover</a></li></ol>
  </nav>
</body>
</html>`;

    expect(parseNavDocument(xhtml)).toEqual([]);
  });

  it('skips entries with empty labels', () => {
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <nav epub:type="toc">
    <ol>
      <li><a href="empty.xhtml">   </a></li>
      <li><a href="valid.xhtml">Valid</a></li>
    </ol>
  </nav>
</body>
</html>`;

    const entries = parseNavDocument(xhtml);
    expect(entries).toEqual([{ label: 'Valid', href: 'valid.xhtml', children: [] }]);
  });
});

describe('parseNcx', () => {
  it('parses a valid NCX document', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <navMap>
    <navPoint id="np1">
      <navLabel><text>Chapter 1</text></navLabel>
      <content src="chapter1.xhtml"/>
    </navPoint>
    <navPoint id="np2">
      <navLabel><text>Chapter 2</text></navLabel>
      <content src="chapter2.xhtml"/>
    </navPoint>
  </navMap>
</ncx>`;

    const entries = parseNcx(xml);
    expect(entries).toEqual([
      { label: 'Chapter 1', href: 'chapter1.xhtml', children: [] },
      { label: 'Chapter 2', href: 'chapter2.xhtml', children: [] },
    ]);
  });

  it('parses nested navPoints', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <navMap>
    <navPoint id="np1">
      <navLabel><text>Part 1</text></navLabel>
      <content src="part1.xhtml"/>
      <navPoint id="np1-1">
        <navLabel><text>Section A</text></navLabel>
        <content src="section-a.xhtml"/>
      </navPoint>
    </navPoint>
  </navMap>
</ncx>`;

    const entries = parseNcx(xml);
    expect(entries).toEqual([
      {
        label: 'Part 1',
        href: 'part1.xhtml',
        children: [{ label: 'Section A', href: 'section-a.xhtml', children: [] }],
      },
    ]);
  });

  it('returns empty array for empty navMap', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <navMap/>
</ncx>`;

    expect(parseNcx(xml)).toEqual([]);
  });

  it('returns empty array when navMap is missing', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"/>`;

    expect(parseNcx(xml)).toEqual([]);
  });
});

// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parsePackageDocument } from '../../src/parser/epub/package-parser';

const VALID_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="uid">urn:uuid:1234</dc:identifier>
    <dc:creator>Test Author</dc:creator>
  </metadata>
  <manifest>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
    <itemref idref="nav" linear="no"/>
  </spine>
</package>`;

describe('parsePackageDocument', () => {
  describe('metadata', () => {
    it('extracts title, language, and identifier', () => {
      const pkg = parsePackageDocument(VALID_OPF);

      expect(pkg.metadata.title).toBe('Test Book');
      expect(pkg.metadata.language).toBe('en');
      expect(pkg.metadata.identifier).toBe('urn:uuid:1234');
    });

    it('extracts optional creator', () => {
      const pkg = parsePackageDocument(VALID_OPF);
      expect(pkg.metadata.creator).toBe('Test Author');
    });

    it('omits creator when not present', () => {
      const opf = VALID_OPF.replace('    <dc:creator>Test Author</dc:creator>\n', '');
      const pkg = parsePackageDocument(opf);
      expect(pkg.metadata).not.toHaveProperty('creator');
    });

    it('throws on missing title', () => {
      const opf = VALID_OPF.replace('<dc:title>Test Book</dc:title>', '');
      expect(() => parsePackageDocument(opf)).toThrow('dc:title');
    });

    it('throws on missing language', () => {
      const opf = VALID_OPF.replace('<dc:language>en</dc:language>', '');
      expect(() => parsePackageDocument(opf)).toThrow('dc:language');
    });

    it('throws on missing identifier', () => {
      const opf = VALID_OPF.replace('<dc:identifier id="uid">urn:uuid:1234</dc:identifier>', '');
      expect(() => parsePackageDocument(opf)).toThrow('dc:identifier');
    });
  });

  describe('manifest', () => {
    it('parses manifest items', () => {
      const pkg = parsePackageDocument(VALID_OPF);

      expect(pkg.manifest).toHaveLength(4);
      expect(pkg.manifest[0]).toEqual({
        id: 'ch1',
        href: 'chapter1.xhtml',
        mediaType: 'application/xhtml+xml',
      });
    });

    it('parses item properties', () => {
      const pkg = parsePackageDocument(VALID_OPF);
      const navItem = pkg.manifest.find((m) => m.id === 'nav');

      expect(navItem?.properties).toEqual(['nav']);
    });

    it('omits properties when not present', () => {
      const pkg = parsePackageDocument(VALID_OPF);
      expect(pkg.manifest[0]).not.toHaveProperty('properties');
    });

    it('throws on missing manifest element', () => {
      const opf = VALID_OPF.replace(/<manifest>[\s\S]*<\/manifest>/, '');
      expect(() => parsePackageDocument(opf)).toThrow('Missing <manifest>');
    });
  });

  describe('spine', () => {
    it('parses spine items', () => {
      const pkg = parsePackageDocument(VALID_OPF);

      expect(pkg.spine).toHaveLength(3);
      expect(pkg.spine[0]).toEqual({ idref: 'ch1', linear: true });
    });

    it('handles linear="no"', () => {
      const pkg = parsePackageDocument(VALID_OPF);
      const navRef = pkg.spine.find((s) => s.idref === 'nav');

      expect(navRef?.linear).toBe(false);
    });

    it('throws on missing spine element', () => {
      const opf = VALID_OPF.replace(/<spine>[\s\S]*<\/spine>/, '');
      expect(() => parsePackageDocument(opf)).toThrow('Missing <spine>');
    });
  });
});

/**
 * Architecture invariants (post-Phase 2).
 *
 * These tests enforce the layout / render boundary at the source-text level.
 * They are a safety net against regressions — any change that re-introduces
 * a violated pattern should fail CI before it lands.
 *
 * The invariants come straight from REFACTOR_PLAN.md §1:
 *  1. layout produces paint-ready data; render only consumes it
 *  2. render does no CSS string parsing or semantic derivation
 *  3. each piece of info is produced in exactly one place
 *  4. render-only fields live on paint sub-objects, not layout node top-levels
 *
 * See AGENTS.md "Layout / Render boundary" for the same rules in prose.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(import.meta.dirname, '../../src');
const RENDER = join(SRC, 'render');
const LAYOUT_TYPES = join(SRC, 'layout/core/types.ts');

function walkTs(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkTs(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function rel(path: string): string {
  return relative(SRC, path).split(sep).join('/');
}

/** Return all substring matches of `pattern` paired with the file that
 *  produced them. */
function scan(
  files: readonly string[],
  pattern: RegExp,
  skipFile?: (path: string) => boolean,
): { file: string; match: string }[] {
  const hits: { file: string; match: string }[] = [];
  for (const file of files) {
    if (skipFile?.(file)) continue;
    const text = read(file);
    for (const m of text.matchAll(pattern)) {
      hits.push({ file: rel(file), match: m[0] });
    }
  }
  return hits;
}

const RENDER_FILES = walkTs(RENDER);

describe('Architecture invariant: render/ does not import ComputedStyle', () => {
  it('no file in render/ imports the ComputedStyle type', () => {
    const hits = scan(RENDER_FILES, /import[^;]*\bComputedStyle\b[^;]*;/g);
    expect(hits, `ComputedStyle import found in:\n${JSON.stringify(hits, null, 2)}`).toEqual([]);
  });
});

describe('Architecture invariant: render/ does not read removed TextRun fields', () => {
  // Phase 2 removed these TextRun fields in favour of run.paint.* / independent
  // RubyAnnotation nodes / paint.border.start|end.
  const BANNED_RUN_FIELDS = ['style', 'rubyAnnotation', 'borderStart', 'borderEnd'] as const;

  for (const field of BANNED_RUN_FIELDS) {
    it(`run.${field} is never accessed in render/`, () => {
      // Match `.field` but require a word boundary and not a chained leaf we care about.
      // Specifically `run.style` / `textRun.style` / `run.rubyAnnotation` / etc.
      const re = new RegExp(`\\b(run|textRun)\\.${field}\\b`, 'g');
      const hits = scan(RENDER_FILES, re);
      expect(hits, `Found reads of run.${field}:\n${JSON.stringify(hits, null, 2)}`).toEqual([]);
    });
  }
});

describe('Architecture invariant: render/ does not read removed LayoutBlock fields', () => {
  const BANNED_BLOCK_FIELDS = [
    'backgroundColor',
    'backgroundImage',
    'backgroundSize',
    'backgroundRepeat',
    'backgroundPosition',
    'borderRadius',
    'borderRadiusPct',
    'opacity',
    'boxShadow',
    'transform',
    'overflow',
    'relativeOffset',
    'borders',
  ] as const;

  for (const field of BANNED_BLOCK_FIELDS) {
    it(`block.${field} is never read in render/`, () => {
      // Only flag direct `block.field` reads (not `block.paint.field` etc.).
      const re = new RegExp(`\\bblock\\.${field}\\b`, 'g');
      const hits = scan(RENDER_FILES, re);
      expect(hits, `Found reads of block.${field}:\n${JSON.stringify(hits, null, 2)}`).toEqual([]);
    });
  }
});

describe('Architecture invariant: render/ does not parse CSS strings', () => {
  // We ban the three primitives that appeared in the pre-Phase-2 render-side
  // CSS parsers (transform regex, backgroundPosition split, custom RegExp).
  // Legitimate non-CSS uses on user text must mark themselves with an
  // `ARCH-ALLOW:` comment on the SAME line or the line immediately before.
  //
  // This is intentionally narrower than "no regex literals" — we tested that
  // broader rule and it hit too many false-positives on `../` import paths.
  // The three checks below cover every pattern the original violations used.

  const BANNED: { name: string; detector: RegExp }[] = [
    { name: '.split(', detector: /\.split\(/ },
    { name: 'new RegExp(', detector: /\bnew\s+RegExp\s*\(/ },
    {
      name: 'TRANSFORM_FN_RE / similar module-level CSS regex',
      detector: /^\s*const\s+[A-Z_]+_RE\s*=\s*\//m,
    },
  ];

  for (const { name, detector } of BANNED) {
    it(`no unannotated ${name} in render/`, () => {
      const hits: { file: string; line: number; match: string }[] = [];
      for (const file of RENDER_FILES) {
        const text = read(file);
        const lines = text.split('\n');
        lines.forEach((line, i) => {
          if (!detector.test(line)) return;
          if (/^\s*\/\//.test(line) || /^\s*\*/.test(line)) return;
          const prev = i > 0 ? (lines[i - 1] ?? '') : '';
          if (line.includes('ARCH-ALLOW:') || prev.includes('ARCH-ALLOW:')) return;
          hits.push({ file: rel(file), line: i + 1, match: line.trim() });
        });
      }
      expect(hits, `Unannotated "${name}" in render/:\n${JSON.stringify(hits, null, 2)}`).toEqual(
        [],
      );
    });
  }
});

describe('Architecture invariant: LayoutBlock and TextRun shape', () => {
  // Parse the interface body out of layout/core/types.ts and count readonly
  // fields. This is a string match, not a TS-AST walk — good enough for a
  // regression guard, cheap to maintain.
  function extractInterface(name: string): string {
    const text = read(LAYOUT_TYPES);
    const re = new RegExp(`export interface ${name}\\s*{([\\s\\S]*?)\\n}`, 'm');
    const m = re.exec(text);
    if (!m) throw new Error(`Interface ${name} not found in layout/core/types.ts`);
    return m[1] ?? '';
  }

  function readonlyFieldNames(body: string): string[] {
    // Match `readonly <name>` (optionally `?`) and capture the name.
    const names: string[] = [];
    for (const m of body.matchAll(/^\s*readonly\s+([a-zA-Z_]\w*)\??:/gm)) {
      if (m[1]) names.push(m[1]);
    }
    return names;
  }

  it('LayoutBlock has exactly 11 top-level fields', () => {
    const body = extractInterface('LayoutBlock');
    const fields = readonlyFieldNames(body);
    const expected = [
      'type',
      'bounds',
      'children',
      'anchorId',
      'semanticTag',
      'borderBox',
      'pageBreakBefore',
      'pageBreakAfter',
      'orphans',
      'widows',
      'paint',
    ].sort();
    expect(fields.slice().sort()).toEqual(expected);
  });

  it('TextRun does not carry style / rubyAnnotation / borderStart / borderEnd', () => {
    const body = extractInterface('TextRun');
    const fields = readonlyFieldNames(body);
    for (const banned of ['style', 'rubyAnnotation', 'borderStart', 'borderEnd']) {
      expect(fields, `TextRun.${banned} should not exist`).not.toContain(banned);
    }
  });

  it('TextRun requires paint: RunPaint', () => {
    const body = extractInterface('TextRun');
    expect(body).toMatch(/readonly\s+paint\s*:\s*RunPaint/);
  });

  it('HorizontalRule carries paint: HrPaint (no top-level color / borderStyle)', () => {
    const body = extractInterface('HorizontalRule');
    const fields = readonlyFieldNames(body);
    expect(fields).toContain('paint');
    expect(fields).not.toContain('color');
    expect(fields).not.toContain('borderStyle');
  });

  it('Page carries paint?: PagePaint (no top-level bodyBackgroundColor)', () => {
    const body = extractInterface('Page');
    const fields = readonlyFieldNames(body);
    expect(fields).toContain('paint');
    expect(fields).not.toContain('bodyBackgroundColor');
  });

  it('InlineAtom does not carry verticalAlign', () => {
    const body = extractInterface('InlineAtom');
    const fields = readonlyFieldNames(body);
    expect(fields).not.toContain('verticalAlign');
  });
});

describe('Architecture invariant: deleted types stay deleted', () => {
  // Guard against anyone re-introducing the pre-Phase-2 shape under the same
  // name somewhere new.
  const BANNED_TYPES = ['BlockBorders', 'BlockBorderEdge', 'RelativeOffset'] as const;

  for (const name of BANNED_TYPES) {
    it(`type "${name}" is not defined anywhere in src/`, () => {
      const files = walkTs(SRC);
      const re = new RegExp(`export\\s+(?:interface|type)\\s+${name}\\b`, 'g');
      const hits = scan(files, re);
      expect(hits, `${name} was re-introduced:\n${JSON.stringify(hits, null, 2)}`).toEqual([]);
    });
  }
});

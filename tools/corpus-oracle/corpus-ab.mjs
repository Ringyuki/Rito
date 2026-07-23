// Corpus line-break oracle: rito fragment layout vs pinned-font Chromium.
//
// Setup:
//   node tools/corpus-oracle/unpack-corpus.mjs ~/Downloads /tmp/rito-corpus
//   cargo build --release --example chapter-fragment-probe -p rito-core
//   RITO_ORACLE_DIR=/tmp/rito-corpus node tools/corpus-oracle/corpus-ab.mjs
// Corpus A/B v2: rito fragment layout vs pinned-font Chromium, aligned by
// line-break points instead of raw line index.
//
// Fixes over v1: browser fonts are pinned to the engine's exact resolution
// (book @font-face wins by name; every other family and all generics map
// to Tinos for U+0000-2FFF and SourceHanSerifCN elsewhere), ruby
// annotations are skipped on both sides, whitespace is normalized, empty
// and image-only lines are dropped, and scoring compares the break-point
// sets of the concatenated text so one extra line never misaligns a
// whole chapter.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(`${new URL('../..', import.meta.url).pathname}package.json`)(
  '@playwright/test',
);

const REPO = new URL('../..', import.meta.url).pathname;
const DIR = `${process.env.RITO_ORACLE_DIR ?? '.'}/`;
const PROBE = `${REPO}target/release/examples/chapter-fragment-probe`;
const SERIF = `${REPO}apps/reader/src/assets/fonts/SourceHanSerifCN-Regular.otf`;
const TINOS = `${REPO}apps/reader/src/assets/fonts/Tinos-Regular.ttf`;
const WIDTH = 500;
const MAX_LINES = 90;

const serifB64 = readFileSync(SERIF).toString('base64');
const tinosB64 = readFileSync(TINOS).toString('base64');
const manifest = JSON.parse(readFileSync(`${DIR}manifest.json`, 'utf8'));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: 6000 } });

const normalize = (line) => line.replace(/\s+/g, '');

// Break-point agreement between two line lists over (near-)identical text.
function scoreLines(ritoLines, browserLines) {
  const a = ritoLines.map(normalize).filter(Boolean);
  const b = browserLines.map(normalize).filter(Boolean);
  const textA = a.join('');
  const textB = b.join('');
  if (textA !== textB) {
    // Content differs (footnote flow, alt text, comparator gap): fall back
    // to line-text LCS so partial credit still reflects matching breaks.
    const lcs = lineLcs(a, b);
    return { mode: 'lcs', lines: Math.max(a.length, b.length), matched: lcs, contentEqual: false };
  }
  const breaksA = new Set();
  const breaksB = new Set();
  let acc = 0;
  for (const line of a.slice(0, -1)) {
    acc += line.length;
    breaksA.add(acc);
  }
  acc = 0;
  for (const line of b.slice(0, -1)) {
    acc += line.length;
    breaksB.add(acc);
  }
  const union = new Set([...breaksA, ...breaksB]);
  let both = 0;
  for (const offset of breaksA) if (breaksB.has(offset)) both += 1;
  return {
    mode: 'breaks',
    contentEqual: true,
    lines: union.size,
    matched: both,
    firstMiss: [...union].sort((x, y) => x - y).find((o) => !(breaksA.has(o) && breaksB.has(o))),
  };
}

function lineLcs(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] =
        a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

const results = [];
for (const book of manifest) {
  const contentChapters = book.chapters.filter(([, path]) => {
    if (/cover|toc|nav|message|copyright/i.test(path)) return false;
    // Only chapters with real body text can score line breaks.
    try {
      const body = readFileSync(path, 'utf8')
        .replace(/^[\s\S]*?<body[^>]*>/i, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, '');
      return body.length >= 200;
    } catch {
      return false;
    }
  });
  const picks = [0.3, 0.55, 0.8]
    .map((f) => contentChapters[Math.floor(f * contentChapters.length)])
    .filter(Boolean)
    .filter((c, i, all) => all.indexOf(c) === i);
  if (picks.length === 0) continue;

  let probe;
  try {
    const request = JSON.stringify({
      epubPath: book.epub,
      fontPaths: [TINOS, SERIF],
      namedFonts: book.fonts,
      contentWidthPx: WIDTH,
      chapterIdrefs: picks.map(([idref]) => idref),
    });
    probe = JSON.parse(execFileSync(PROBE, { input: request, maxBuffer: 1 << 28 }).toString());
  } catch (error) {
    results.push({ book: book.epub, error: `probe: ${String(error).slice(0, 120)}` });
    console.log(`ERR\t${book.epub.split('/').pop().slice(0, 44)}`);
    continue;
  }

  const bookResult = { book: book.epub, chapters: [] };
  for (let ci = 0; ci < picks.length; ci += 1) {
    const [idref, chapterPath] = picks[ci];
    const ritoChapter = probe.chapters[ci];
    if (!ritoChapter || ritoChapter.error) {
      bookResult.chapters.push({ idref, error: ritoChapter?.error?.slice(0, 140) ?? 'missing' });
      continue;
    }
    const ritoLines = ritoChapter.lines.slice(0, MAX_LINES).map((l) => l.text);

    let browserLines;
    try {
      await page.goto(`file://${chapterPath}`, { timeout: 20000 });
      // Pin fonts: book-declared @font-face families keep their own bytes;
      // every other family (and the generics, via stack rewriting) maps to
      // Tinos (BMP latin) + SourceHanSerifCN, mirroring the engine.
      await page.evaluate(
        ({ serif, tinos }) => {
          const declared = new Set();
          for (const face of document.fonts)
            declared.add(face.family.replace(/^"|"$/g, '').toLowerCase());
          const familyFaces = (name) => `
          @font-face { font-family: "${name}"; src: url(data:font/otf;base64,${serif}); }
          @font-face { font-family: "${name}"; src: url(data:font/ttf;base64,${tinos}); unicode-range: U+0000-2FFF; }`;
          const sheet = [familyFaces('__rp-generic')];
          const seen = new Set();
          for (const el of document.querySelectorAll('*')) {
            const stack = getComputedStyle(el).fontFamily;
            const rewritten = stack.split(',').map((part) => {
              const name = part.trim().replace(/^"|"$/g, '');
              const lower = name.toLowerCase();
              if (
                [
                  'serif',
                  'sans-serif',
                  'monospace',
                  'cursive',
                  'fantasy',
                  'system-ui',
                  'ui-serif',
                  'ui-sans-serif',
                ].includes(lower)
              ) {
                return '"__rp-generic"';
              }
              if (!declared.has(lower) && !seen.has(lower)) {
                seen.add(lower);
                sheet.push(familyFaces(name));
              }
              return `"${name}"`;
            });
            rewritten.push('"__rp-generic"');
            el.style.fontFamily = rewritten.join(', ');
          }
          const style = document.createElement('style');
          style.textContent = sheet.join('\n');
          document.head.appendChild(style);
        },
        { serif: serifB64, tinos: tinosB64 },
      );
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      browserLines = await page.evaluate((maxLines) => {
        const lines = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            const tag = node.parentElement?.closest('rt, rp');
            return tag ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
          },
        });
        const range = document.createRange();
        while (walker.nextNode() && lines.length < maxLines + 8) {
          const node = walker.currentNode;
          const text = node.textContent;
          if (!text || !text.trim()) continue;
          let lineStart = 0;
          let lastTop = null;
          for (let i = 0; i < text.length; i += 1) {
            range.setStart(node, i);
            range.setEnd(node, Math.min(i + 1, text.length));
            const rect = range.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) continue;
            if (lastTop === null) {
              lastTop = rect.top;
            } else if (Math.abs(rect.top - lastTop) > 2) {
              lines.push(text.slice(lineStart, i));
              lineStart = i;
              lastTop = rect.top;
            }
          }
          if (lastTop !== null) lines.push(text.slice(lineStart));
        }
        return lines;
      }, MAX_LINES);
    } catch (error) {
      bookResult.chapters.push({ idref, error: `browser: ${String(error).slice(0, 120)}` });
      continue;
    }
    const score = scoreLines(ritoLines, browserLines.slice(0, MAX_LINES));
    bookResult.chapters.push({ idref, ...score });
  }
  results.push(bookResult);
  const scored = bookResult.chapters.filter((c) => !c.error && c.lines > 0);
  const pct = scored.length
    ? Math.round((scored.reduce((sum, c) => sum + c.matched / c.lines, 0) / scored.length) * 100)
    : 0;
  const eq = bookResult.chapters.filter((c) => c.contentEqual).length;
  console.log(
    `${String(pct).padStart(3)}%\teq${eq}/${bookResult.chapters.length}\t${book.epub.split('/').pop().slice(0, 44)}`,
  );
}
writeFileSync(`${DIR}corpus-ab-report.json`, JSON.stringify(results, null, 1));
await browser.close();
console.log('REPORT WRITTEN');

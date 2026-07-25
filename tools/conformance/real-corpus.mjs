// Real-book conformance across a whole corpus.
//
// Runs the per-book harness over every EPUB in a directory and ranks the
// results worst-first, with each book's dominant defect classes. One book
// tells you whether a fix worked; a corpus tells you which fix is worth
// making — a class that costs 0.3% in one book and 8% in nine others is
// the one to take next.
//
// Usage: node tools/conformance/real-corpus.mjs <dir-with-epubs> [outDir] [flowWidth]

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const [, , dirArg, outDirArg, widthArg] = process.argv;
if (!dirArg) throw new Error('usage: real-corpus.mjs <dir-with-epubs> [outDir] [flowWidth]');
const outDir = outDirArg ?? '/tmp/rito-real-corpus';
const flowWidth = widthArg ?? '500';
mkdirSync(outDir, { recursive: true });

const books = readdirSync(dirArg)
  .filter((name) => name.toLowerCase().endsWith('.epub'))
  .sort()
  .map((name) => ({ name, file: path.join(dirArg, name) }));

const results = [];
for (const [index, book] of books.entries()) {
  const bookOut = path.join(outDir, `book-${String(index).padStart(2, '0')}`);
  process.stdout.write(`[${index + 1}/${books.length}] ${book.name}\n`);
  const run = spawnSync(
    'node',
    [path.join(REPO, 'tools/conformance/real-book.mjs'), book.file, bookOut, flowWidth],
    { maxBuffer: 256 * 1024 * 1024, timeout: 20 * 60 * 1000 },
  );
  const reportPath = path.join(bookOut, 'report.json');
  if (!existsSync(reportPath)) {
    const why = (run.stderr?.toString() ?? '').trim().split('\n').at(-1) ?? 'no report';
    results.push({ book: book.name, error: why.slice(0, 200) });
    process.stdout.write(`      failed: ${why.slice(0, 120)}\n`);
    continue;
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  let matched = 0;
  let within = 0;
  let missing = 0;
  for (const chapter of report.perChapter) {
    matched += chapter.matched ?? 0;
    within += chapter.within ?? 0;
    missing += chapter.missing ?? 0;
  }
  const classes = {};
  for (const offender of report.offenders) {
    const key = `${offender.tag} ${offender.axis}`;
    classes[key] = (classes[key] ?? 0) + 1;
  }
  const entry = {
    book: book.name,
    rate: matched > 0 ? within / matched : 0,
    within,
    matched,
    missing,
    classes: Object.entries(classes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
    worst: report.offenders.slice(0, 3).map((o) => ({
      chapter: o.chapter,
      id: o.id,
      tag: o.tag,
      axis: o.axis,
      engine: o.engine,
      chromium: o.chromium,
    })),
  };
  results.push(entry);
  process.stdout.write(
    `      ${(entry.rate * 100).toFixed(1)}% (${within}/${matched}, ${missing} missing)\n`,
  );
}

const scored = results.filter((r) => r.error === undefined);
scored.sort((a, b) => a.rate - b.rate);
const totalMatched = scored.reduce((sum, r) => sum + r.matched, 0);
const totalWithin = scored.reduce((sum, r) => sum + r.within, 0);
// Corpus-wide defect classes: what to fix next is whatever costs the most
// boxes across books, not whatever is loudest in one.
const corpusClasses = {};
for (const r of scored)
  for (const [key, count] of r.classes) corpusClasses[key] = (corpusClasses[key] ?? 0) + count;

const lines = [
  '# Real-corpus geometry conformance',
  '',
  `books: ${scored.length} scored, ${results.length - scored.length} failed`,
  `corpus: ${totalMatched > 0 ? ((totalWithin / totalMatched) * 100).toFixed(2) : 'n/a'}% ` +
    `within 0.5px (${totalWithin}/${totalMatched} boxes)`,
  '',
  '## Dominant defect classes (corpus-wide)',
  '',
  ...Object.entries(corpusClasses)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([key, count]) => `- ${key}: ${count}`),
  '',
  '## Books, worst first',
  '',
];
for (const r of scored) {
  lines.push(
    `- ${(r.rate * 100).toFixed(1)}% ${r.book} (${r.within}/${r.matched}, ${r.missing} missing) ` +
      `— ${r.classes.map(([key, count]) => `${key}×${count}`).join(', ')}`,
  );
}
for (const r of results.filter((entry) => entry.error !== undefined)) {
  lines.push(`- FAILED ${r.book}: ${r.error}`);
}
writeFileSync(path.join(outDir, 'corpus.md'), lines.join('\n'));
writeFileSync(path.join(outDir, 'corpus.json'), JSON.stringify(results, null, 1));
console.log(`\n${lines.join('\n')}`);

import { pixelReviewCss } from './pixel-review-assets';
import { pixelReviewScript } from './pixel-review-script';
import type { PixelReviewRecord, PixelReviewStatus } from './pixel-review';

interface BookReviewGroup {
  readonly bookId: string;
  readonly records: readonly PixelReviewRecord[];
  readonly problemCount: number;
}

const REVIEW_STATUS_ORDER: readonly PixelReviewStatus[] = [
  'fail',
  'error',
  'missing',
  'warn',
  'pass',
];

export function renderPixelReviewHtml(records: readonly PixelReviewRecord[]): string {
  const sorted = [...records].sort(compareReviewRecords);
  const groups = groupRecordsByBook(sorted);
  const problems = sorted.filter(isProblemRecord);
  const selectedBookId = initialSelectedBookId(groups);
  const title = `Rito Pixel Review (${String(sorted.length)} cases)`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${pixelReviewCss()}</style>
</head>
<body>
  <header class="top" id="top">
    <h1>Rito Pixel Review</h1>
    <p>${escapeHtml(summaryText(sorted))}</p>
  </header>
  <nav class="nav-panel" aria-label="Pixel review navigation">
    <section class="nav-section">
      <h2>Problem Cases</h2>
      ${renderProblemList(problems)}
    </section>
    <section class="nav-section">
      <h2>Books</h2>
      <div class="book-links">${groups
        .map((group) => renderBookButton(group, selectedBookId))
        .join('')}</div>
    </section>
  </nav>
  <main class="books">
    ${groups.map((group) => renderBookGroup(group, selectedBookId)).join('\n')}
  </main>
  <button class="top-button" type="button" data-scroll-top>Top</button>
  <script>${pixelReviewScript()}</script>
</body>
</html>
`;
}

function renderProblemList(records: readonly PixelReviewRecord[]): string {
  if (records.length === 0) {
    return '<p class="empty">No non-pass cases.</p>';
  }
  return `<ol class="problem-list">${records.map(renderProblemLink).join('')}</ol>`;
}

function renderProblemLink(record: PixelReviewRecord): string {
  return `<li>
  <a class="problem-link status-${record.status}" href="#${caseAnchor(
    record.id,
  )}" data-book-target="${escapeHtml(record.bookId)}">
    <span>${escapeHtml(record.status.toUpperCase())}</span>
    <strong>${escapeHtml(record.id)}</strong>
    <em>${escapeHtml(diffText(record))}</em>
  </a>
</li>`;
}

function renderBookButton(group: BookReviewGroup, selectedBookId: string | undefined): string {
  const problemClass = group.problemCount > 0 ? 'book-link-problem' : 'book-link-pass';
  const activeClass = group.bookId === selectedBookId ? ' is-active' : '';
  return `<button class="book-link ${problemClass}${activeClass}" type="button" data-book-target="${escapeHtml(
    group.bookId,
  )}">
  <strong>${escapeHtml(group.bookId)}</strong>
  <span>${String(group.records.length)} cases</span>
  <em>${String(group.problemCount)} non-pass</em>
</button>`;
}

function renderBookGroup(group: BookReviewGroup, selectedBookId: string | undefined): string {
  const activeClass = group.bookId === selectedBookId ? ' is-active' : '';
  return `<section class="book-view${activeClass}" id="${bookAnchor(
    group.bookId,
  )}" data-book-panel="${escapeHtml(group.bookId)}">
  <header class="book-header">
    <strong>${escapeHtml(group.bookId)}</strong>
    <span>${String(group.records.length)} cases / ${escapeHtml(summaryText(group.records))}</span>
  </header>
  <div class="book-cases">
    ${group.records.map(renderReviewCard).join('\n')}
  </div>
</section>`;
}

function renderReviewCard(record: PixelReviewRecord): string {
  const images = renderImages(record);
  return `<article id="${caseAnchor(record.id)}" class="case case-${record.status}">
  <header class="case-header">
    <div>
      <h2>${escapeHtml(record.id)}</h2>
      <p>${escapeHtml(caseSubtitle(record))}</p>
    </div>
    <span class="status">${escapeHtml(record.status.toUpperCase())}</span>
  </header>
  <dl class="metrics">${renderMetrics(record)}</dl>
  <div class="tags">${record.tags.map(renderTag).join('')}</div>
  ${record.error ? `<p class="error">${escapeHtml(record.error)}</p>` : ''}
  ${images}
</article>`;
}

function renderImages(record: PixelReviewRecord): string {
  if (!record.expectedPath || !record.diffPath) {
    return `<section class="single-image">${imageHtml('Actual', record.actualPath)}</section>`;
  }
  return `<section class="image-grid">
  ${imageHtml('Expected', record.expectedPath)}
  ${imageHtml('Actual', record.actualPath)}
  ${imageHtml('Diff', record.diffPath)}
</section>
<section class="overlay" data-overlay>
  <img class="overlay-base" src="${escapeHtml(record.expectedPath)}" alt="Expected ${escapeHtml(
    record.id,
  )}" />
  <div class="overlay-actual" data-overlay-actual>
    <img src="${escapeHtml(record.actualPath)}" alt="Actual ${escapeHtml(record.id)}" />
  </div>
  <input data-overlay-slider type="range" min="0" max="100" value="50" />
</section>`;
}

function imageHtml(label: string, path: string): string {
  return `<figure><figcaption>${escapeHtml(label)}</figcaption><img src="${escapeHtml(
    path,
  )}" alt="${escapeHtml(label)}" loading="lazy" /></figure>`;
}

function renderMetrics(record: PixelReviewRecord): string {
  return [
    metricHtml('Book', record.bookId),
    metricHtml('Spread', String(record.spreadIndex)),
    metricHtml(
      'Viewport',
      `${String(record.width)}x${String(record.height)} @${String(record.devicePixelRatio)}x`,
    ),
    metricHtml('Line breaking', record.lineBreaking),
    metricHtml('Diff', diffText(record)),
    metricHtml('Limit', ratioText(record.maxDiffPixelRatio)),
  ].join('');
}

function metricHtml(label: string, value: string): string {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function renderTag(tag: string): string {
  return `<span>${escapeHtml(tag)}</span>`;
}

function groupRecordsByBook(records: readonly PixelReviewRecord[]): readonly BookReviewGroup[] {
  const groups = new Map<string, PixelReviewRecord[]>();
  for (const record of records) {
    const group = groups.get(record.bookId) ?? [];
    group.push(record);
    groups.set(record.bookId, group);
  }
  return [...groups.entries()]
    .map(([bookId, groupRecords]) => ({
      bookId,
      records: groupRecords,
      problemCount: groupRecords.filter(isProblemRecord).length,
    }))
    .sort(compareBookGroups);
}

function initialSelectedBookId(groups: readonly BookReviewGroup[]): string | undefined {
  return groups.find((group) => group.problemCount > 0)?.bookId ?? groups[0]?.bookId;
}

function caseSubtitle(record: PixelReviewRecord): string {
  return `${record.bookId} spread ${String(record.spreadIndex)} / ${String(
    record.width,
  )}x${String(record.height)} margin ${String(record.margin)}`;
}

function diffText(record: PixelReviewRecord): string {
  if (record.diffPixels === undefined || record.diffRatio === undefined) return 'n/a';
  return `${String(record.diffPixels)} px (${ratioText(record.diffRatio)})`;
}

function ratioText(value: number): string {
  return `${(value * 100).toFixed(3)}%`;
}

function summaryText(records: readonly PixelReviewRecord[]): string {
  const counts = new Map<PixelReviewStatus, number>();
  for (const record of records) counts.set(record.status, (counts.get(record.status) ?? 0) + 1);
  return REVIEW_STATUS_ORDER.map((status) => `${status}: ${String(counts.get(status) ?? 0)}`).join(
    ' / ',
  );
}

function compareReviewRecords(left: PixelReviewRecord, right: PixelReviewRecord): number {
  return left.id.localeCompare(right.id);
}

function compareBookGroups(left: BookReviewGroup, right: BookReviewGroup): number {
  return left.bookId.localeCompare(right.bookId);
}

function isProblemRecord(record: PixelReviewRecord): boolean {
  return record.status !== 'pass';
}

function bookAnchor(bookId: string): string {
  return `book-${safeAnchorPart(bookId)}`;
}

function caseAnchor(caseId: string): string {
  return `case-${safeAnchorPart(caseId)}`;
}

function safeAnchorPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

import { pixelReviewCss } from './pixel-review-assets';
import { pixelReviewScript } from './pixel-review-script';
import {
  groupRecordsByBook,
  initialSelectedGroup,
  isProblemRecord,
  summaryText,
  type BookReviewGroup,
  type RunReviewGroup,
  type SelectedReviewGroup,
} from './pixel-review-groups';
import type { PixelReviewRecord } from './pixel-review';

export function renderPixelReviewHtml(records: readonly PixelReviewRecord[]): string {
  const sorted = [...records].sort(compareReviewRecords);
  const groups = groupRecordsByBook(sorted);
  const problems = sorted.filter(isProblemRecord);
  const selected = initialSelectedGroup(groups);
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
        .map((group) => renderBookButton(group, selected.bookId))
        .join('')}</div>
    </section>
  </nav>
  <main class="books">
    ${groups.map((group) => renderBookGroup(group, selected)).join('\n')}
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
  )}" data-book-target="${escapeHtml(record.bookId)}" data-run-target="${escapeHtml(record.runId)}">
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

function renderBookGroup(group: BookReviewGroup, selected: SelectedReviewGroup): string {
  const activeClass = group.bookId === selected.bookId ? ' is-active' : '';
  return `<section class="book-view${activeClass}" id="${bookAnchor(
    group.bookId,
  )}" data-book-panel="${escapeHtml(group.bookId)}">
  <header class="book-header">
    <strong>${escapeHtml(group.bookId)}</strong>
    <span>${String(group.records.length)} cases / ${escapeHtml(summaryText(group.records))}</span>
  </header>
  <div class="run-links">${group.runs.map((run) => renderRunButton(run, selected)).join('')}</div>
  <div class="book-cases">
    ${group.runs.map((run) => renderRunGroup(run, selected)).join('\n')}
  </div>
</section>`;
}

function renderRunButton(run: RunReviewGroup, selected: SelectedReviewGroup): string {
  const activeClass = run.runId === selected.runId ? ' is-active' : '';
  const problemClass = run.problemCount > 0 ? 'run-link-problem' : 'run-link-pass';
  return `<button class="run-link ${problemClass}${activeClass}" type="button" data-book-target="${escapeHtml(
    run.records[0]?.bookId ?? '',
  )}" data-run-target="${escapeHtml(run.runId)}">
  <strong>${escapeHtml(run.profileId)}</strong>
  <span>${escapeHtml(run.lineBreaking)}</span>
  <em>${String(run.problemCount)} non-pass</em>
</button>`;
}

function renderRunGroup(run: RunReviewGroup, selected: SelectedReviewGroup): string {
  const activeClass = run.runId === selected.runId ? ' is-active' : '';
  return `<section class="run-view${activeClass}" data-run-panel="${escapeHtml(run.runId)}">
  ${run.records.map(renderReviewCard).join('\n')}
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
  if (!record.expectedPath) {
    return `<section class="single-image">${imageHtml('Actual', record.actualPath)}</section>`;
  }
  if (!record.diffPath) {
    return `<section class="image-grid">
  ${imageHtml('Expected', record.expectedPath)}
  ${imageHtml('Actual', record.actualPath)}
</section>`;
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
    metricHtml('Profile', record.profileId),
    metricHtml('Spread', `${String(record.spreadIndex)} / ${String(record.totalSpreads)}`),
    metricHtml(
      'Viewport',
      `${String(record.width)}x${String(record.height)} @${String(record.devicePixelRatio)}x`,
    ),
    metricHtml('Spread mode', record.spread),
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

function caseSubtitle(record: PixelReviewRecord): string {
  return `${record.bookId} / ${record.profileId} / ${record.lineBreaking} / spread ${String(
    record.spreadIndex,
  )}`;
}

function diffText(record: PixelReviewRecord): string {
  if (record.diffPixels === undefined || record.diffRatio === undefined) return 'n/a';
  return `${String(record.diffPixels)} px (${ratioText(record.diffRatio)})`;
}

function ratioText(value: number): string {
  return `${(value * 100).toFixed(3)}%`;
}

function compareReviewRecords(left: PixelReviewRecord, right: PixelReviewRecord): number {
  return left.id.localeCompare(right.id);
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

import { pixelReviewCss } from './pixel-review-assets';
import { pixelReviewScript } from './pixel-review-script';
import {
  groupRecordsByBook,
  isProblemRecord,
  summaryText,
  type BookReviewGroup,
} from './pixel-review-groups';
import type { PixelReviewRecord, PixelReviewStatus } from './pixel-review';

const REVIEW_STATUSES: readonly PixelReviewStatus[] = ['fail', 'error', 'missing', 'warn', 'pass'];

export function renderPixelReviewHtml(records: readonly PixelReviewRecord[]): string {
  const sorted = [...records].sort(compareReviewRecords);
  const groups = groupRecordsByBook(sorted);
  const problems = sorted.filter(isProblemRecord);
  const selectedCase = problems[0] ?? sorted[0];
  const title = `Rito Pixel Review (${String(sorted.length)} cases)`;
  const reviewData = {
    records: sorted,
    selected: {
      activeId: selectedCase?.id ?? '',
    },
    defaultProblemsOnly: problems.length > 0,
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${pixelReviewCss()}</style>
</head>
<body>
  <div class="review-app" data-review-app>
    <aside class="review-sidebar" aria-label="Pixel review case navigation">
      <header class="review-title">
        <h1>Rito Pixel Review</h1>
        <p>${escapeHtml(summaryText(sorted))}</p>
      </header>

      <section class="review-controls" aria-label="Filters">
        <label class="search-box">
          <span>Search</span>
          <input data-search type="search" placeholder="book, profile, spread, status" />
        </label>
        <div class="status-filters" aria-label="Status filters">
          ${REVIEW_STATUSES.map((status) => renderStatusButton(status, sorted)).join('')}
        </div>
        <label class="problem-toggle">
          <input data-problems-only type="checkbox" ${problems.length > 0 ? 'checked' : ''} />
          <span>Non-pass only</span>
        </label>
      </section>

      <section class="book-filter" aria-label="Books">
        <button class="book-chip is-active" type="button" data-book-filter="">All books</button>
        ${groups.map((group) => renderBookChip(group)).join('')}
      </section>

      <section class="run-filter" aria-label="Runs">
        <div class="section-label">Runs</div>
        <div class="run-filter-list" data-run-filter-list></div>
      </section>

      <section class="queue-panel" aria-label="Cases">
        <header class="queue-header">
          <strong data-queue-count>0 cases</strong>
          <span data-current-position></span>
        </header>
        <ol class="case-queue" data-case-list></ol>
      </section>
    </aside>

    <main class="review-stage">
      <header class="stage-toolbar">
        <div class="case-heading">
          <span class="case-status" data-case-status>Ready</span>
          <div>
            <h2 data-case-title>No case selected</h2>
            <p data-case-subtitle></p>
          </div>
        </div>
        <div class="stage-actions">
          <button type="button" data-prev-case>Prev</button>
          <button type="button" data-next-case>Next</button>
          <div class="mode-tabs" aria-label="Image mode">
            <button type="button" data-view-mode="overlay">Overlay</button>
            <button type="button" data-view-mode="compare">Compare</button>
            <button type="button" data-view-mode="reference">Reference</button>
            <button type="button" data-view-mode="diff">Diff</button>
            <button type="button" data-view-mode="actual">Actual</button>
            <button type="button" data-view-mode="expected">Expected</button>
          </div>
        </div>
      </header>

      <section class="stage-body">
        <section class="viewer-panel" data-viewer aria-label="Image review area"></section>
        <aside class="inspector" aria-label="Case details">
          <dl data-metrics></dl>
          <div class="tag-list" data-tags></div>
          <p class="case-error" data-error hidden></p>
        </aside>
      </section>
    </main>
  </div>
  <script id="review-data" type="application/json">${escapeScriptJson(
    JSON.stringify(reviewData),
  )}</script>
  <script>${pixelReviewScript()}</script>
</body>
</html>
`;
}

function renderStatusButton(
  status: PixelReviewStatus,
  records: readonly PixelReviewRecord[],
): string {
  const count = records.filter((record) => record.status === status).length;
  return `<button class="status-filter status-${status} is-active" type="button" data-status-filter="${status}">
  <span>${escapeHtml(status)}</span>
  <strong>${String(count)}</strong>
</button>`;
}

function renderBookChip(group: BookReviewGroup): string {
  const problemClass = group.problemCount > 0 ? 'has-problems' : 'is-clean';
  return `<button class="book-chip ${problemClass}" type="button" data-book-filter="${escapeHtml(
    group.bookId,
  )}">
  <strong>${escapeHtml(group.bookId)}</strong>
  <span>${String(group.problemCount)} / ${String(group.records.length)}</span>
</button>`;
}

function compareReviewRecords(left: PixelReviewRecord, right: PixelReviewRecord): number {
  const severity = statusSeverity(left.status) - statusSeverity(right.status);
  if (severity !== 0) return severity;
  return left.id.localeCompare(right.id);
}

function statusSeverity(status: PixelReviewStatus): number {
  const index = REVIEW_STATUSES.indexOf(status);
  return index === -1 ? REVIEW_STATUSES.length : index;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeScriptJson(value: string): string {
  return value.replaceAll('<', '\\u003c');
}

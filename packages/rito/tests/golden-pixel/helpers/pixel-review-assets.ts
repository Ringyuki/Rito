export function pixelReviewCss(): string {
  return `
:root {
  color-scheme: light;
  --bg: #f4f6f8;
  --panel: #ffffff;
  --line: #d8dee4;
  --line-strong: #afb8c1;
  --text: #1f2328;
  --muted: #57606a;
  --accent: #0969da;
  --accent-soft: #ddf4ff;
  --pass: #1a7f37;
  --warn: #9a6700;
  --fail: #cf222e;
  --error: #8250df;
  --missing: #bf3989;
}
* { box-sizing: border-box; }
html,
body {
  height: 100%;
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow: hidden;
}
button,
input {
  font: inherit;
}
button {
  cursor: pointer;
}
h1,
h2,
p,
dl,
dd,
ol,
figure {
  margin: 0;
}
.review-app {
  display: grid;
  grid-template-columns: 380px minmax(0, 1fr);
  height: 100vh;
  min-width: 980px;
}
.review-sidebar {
  background: var(--panel);
  border-right: 1px solid var(--line);
  display: grid;
  grid-template-rows: auto auto auto auto minmax(0, 1fr);
  min-height: 0;
}
.review-title {
  border-bottom: 1px solid var(--line);
  padding: 14px 16px;
}
.review-title h1 {
  font-size: 18px;
  line-height: 1.2;
}
.review-title p {
  color: var(--muted);
  margin-top: 4px;
}
.review-controls {
  border-bottom: 1px solid var(--line);
  display: grid;
  gap: 10px;
  padding: 12px 16px;
}
.search-box {
  display: grid;
  gap: 5px;
}
.search-box span,
.section-label {
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.search-box input {
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  height: 32px;
  padding: 0 10px;
  width: 100%;
}
.search-box input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px #0969da22;
  outline: 0;
}
.status-filters {
  display: grid;
  gap: 6px;
  grid-template-columns: repeat(5, minmax(0, 1fr));
}
.status-filter,
.book-chip,
.run-chip,
.case-row,
.stage-actions button {
  background: #fff;
  border: 1px solid var(--line);
  color: var(--text);
}
.status-filter {
  border-radius: 6px;
  display: grid;
  gap: 1px;
  min-width: 0;
  padding: 6px 4px;
}
.status-filter span {
  color: var(--muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  text-transform: uppercase;
}
.status-filter strong {
  font-size: 13px;
}
.status-filter:not(.is-active) {
  opacity: 0.42;
}
.status-filter.status-pass.is-active { border-color: #74c69d; }
.status-filter.status-warn.is-active { border-color: #d4a72c; }
.status-filter.status-fail.is-active { border-color: #ff8182; }
.status-filter.status-error.is-active { border-color: #b083f0; }
.status-filter.status-missing.is-active { border-color: #e275ad; }
.problem-toggle {
  align-items: center;
  color: var(--muted);
  display: flex;
  gap: 8px;
}
.book-filter,
.run-filter {
  border-bottom: 1px solid var(--line);
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 10px 16px;
}
.run-filter {
  display: grid;
  gap: 8px;
}
.run-filter-list {
  display: flex;
  gap: 8px;
  overflow-x: auto;
}
.book-chip,
.run-chip {
  border-radius: 999px;
  flex: 0 0 auto;
  min-height: 30px;
  padding: 5px 10px;
  white-space: nowrap;
}
.book-chip strong {
  margin-right: 6px;
}
.book-chip span,
.run-chip span {
  color: var(--muted);
  font-size: 12px;
}
.book-chip.is-active,
.run-chip.is-active,
.stage-actions button.is-active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: #0550ae;
}
.book-chip.has-problems:not(.is-active) {
  border-color: #ffb3b8;
}
.queue-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
}
.queue-header {
  align-items: center;
  border-bottom: 1px solid var(--line);
  display: flex;
  gap: 10px;
  justify-content: space-between;
  padding: 10px 16px;
}
.queue-header span {
  color: var(--muted);
}
.case-queue {
  display: grid;
  gap: 6px;
  list-style: none;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
}
.case-row {
  border-left: 4px solid var(--line-strong);
  border-radius: 7px;
  display: grid;
  gap: 4px;
  padding: 8px 10px;
  text-align: left;
  width: 100%;
}
.case-row:hover,
.case-row.is-active {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px #0969da22;
}
.case-row.is-active {
  background: #f6fbff;
}
.case-row.status-pass { border-left-color: var(--pass); }
.case-row.status-warn { border-left-color: var(--warn); }
.case-row.status-fail { border-left-color: var(--fail); }
.case-row.status-error { border-left-color: var(--error); }
.case-row.status-missing { border-left-color: var(--missing); }
.case-row-top,
.case-row-meta {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: space-between;
  min-width: 0;
}
.case-row strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.case-row-meta {
  color: var(--muted);
  font-size: 12px;
}
.status-pill {
  border: 1px solid currentColor;
  border-radius: 999px;
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 700;
  padding: 1px 7px;
  text-transform: uppercase;
}
.status-pill.status-pass,
.case-status.status-pass { color: var(--pass); }
.status-pill.status-warn,
.case-status.status-warn { color: var(--warn); }
.status-pill.status-fail,
.case-status.status-fail { color: var(--fail); }
.status-pill.status-error,
.case-status.status-error { color: var(--error); }
.status-pill.status-missing,
.case-status.status-missing { color: var(--missing); }
.review-stage {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  min-width: 0;
}
.stage-toolbar {
  align-items: center;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(0, 1fr) auto;
  padding: 12px 16px;
}
.case-heading {
  align-items: center;
  display: flex;
  gap: 12px;
  min-width: 0;
}
.case-heading h2 {
  font-size: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.case-heading p {
  color: var(--muted);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.case-status {
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  padding: 4px 9px;
  text-transform: uppercase;
}
.stage-actions {
  align-items: center;
  display: flex;
  gap: 8px;
}
.stage-actions button {
  border-radius: 6px;
  min-height: 30px;
  padding: 5px 10px;
}
.mode-tabs {
  border-left: 1px solid var(--line);
  display: flex;
  gap: 6px;
  padding-left: 8px;
}
.stage-body {
  display: grid;
  gap: 0;
  grid-template-columns: minmax(0, 1fr) 280px;
  min-height: 0;
  overflow: hidden;
}
.viewer-panel {
  background:
    linear-gradient(45deg, #eef1f4 25%, transparent 25%),
    linear-gradient(-45deg, #eef1f4 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #eef1f4 75%),
    linear-gradient(-45deg, transparent 75%, #eef1f4 75%);
  background-color: #fff;
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
  background-size: 16px 16px;
  min-height: 0;
  overflow: auto;
  padding: 16px;
}
.empty-state {
  align-items: center;
  color: var(--muted);
  display: grid;
  height: 100%;
  justify-items: center;
}
.image-grid {
  display: grid;
  gap: 14px;
}
.image-grid.compare {
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}
.image-grid.single {
  justify-content: start;
}
figure {
  min-width: 0;
}
figcaption {
  align-items: center;
  background: #f6f8fa;
  border: 1px solid var(--line);
  border-bottom: 0;
  color: var(--muted);
  display: flex;
  font-size: 11px;
  font-weight: 800;
  justify-content: space-between;
  letter-spacing: 0.04em;
  padding: 5px 8px;
  text-transform: uppercase;
}
img {
  background: #fff;
  border: 1px solid var(--line);
  display: block;
  height: auto;
  max-width: 100%;
}
.image-frame {
  max-width: 100%;
  width: fit-content;
}
.image-frame.is-sized {
  width: var(--review-image-width);
}
.image-frame img {
  height: auto;
  max-width: 100%;
}
.image-frame.is-sized img {
  width: 100%;
}
.overlay-shell {
  display: inline-grid;
  gap: 8px;
  max-width: 100%;
}
.overlay {
  background: #fff;
  border: 1px solid var(--line);
  box-sizing: content-box;
  display: grid;
  line-height: 0;
  max-width: 100%;
  overflow: hidden;
  position: relative;
  width: fit-content;
}
.overlay.is-sized {
  width: var(--review-display-width, var(--review-image-width));
}
.overlay img {
  border: 0;
  grid-area: 1 / 1;
  height: auto;
  max-width: 100%;
}
.overlay.is-sized img {
  width: var(--review-display-width, 100%);
}
.overlay-actual {
  clip-path: inset(0 calc(100% - var(--overlay-reveal, 50%)) 0 0);
}
.overlay-controls {
  align-items: center;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
  display: flex;
  gap: 10px;
  padding: 8px 10px;
}
.overlay-controls input {
  width: min(420px, 55vw);
}
.inspector {
  background: var(--panel);
  border-left: 1px solid var(--line);
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
}
.inspector dl {
  display: grid;
  gap: 10px;
}
.inspector dt {
  color: var(--muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.inspector dd {
  font-weight: 600;
  margin-top: 2px;
  overflow-wrap: anywhere;
}
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 14px;
}
.tag-list span {
  background: #eef4ff;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 2px 8px;
}
.case-error {
  background: #ffebe9;
  border: 1px solid #ff818266;
  border-radius: 6px;
  margin-top: 14px;
  padding: 10px;
}
@media (max-width: 1080px) {
  body { overflow: auto; }
  .review-app {
    grid-template-columns: 1fr;
    height: auto;
    min-height: 100vh;
    min-width: 0;
  }
  .review-sidebar {
    max-height: none;
  }
  .case-queue {
    max-height: 360px;
  }
  .stage-body {
    grid-template-columns: 1fr;
  }
  .inspector {
    border-left: 0;
    border-top: 1px solid var(--line);
  }
  .stage-toolbar {
    grid-template-columns: 1fr;
  }
  .stage-actions {
    flex-wrap: wrap;
  }
  .image-grid.compare {
    grid-template-columns: 1fr;
  }
}
`;
}

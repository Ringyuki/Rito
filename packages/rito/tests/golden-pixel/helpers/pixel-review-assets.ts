export function pixelReviewCss(): string {
  return `
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: #f6f7f8;
  color: #1f2328;
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.top {
  padding: 24px 32px;
  background: #ffffff;
  border-bottom: 1px solid #d8dee4;
}
h1, h2, p { margin: 0; }
.top p { margin-top: 6px; color: #57606a; }
.nav-panel {
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(280px, 1fr) 2fr;
  padding: 20px 24px 0;
}
.nav-section {
  background: #ffffff;
  border: 1px solid #d8dee4;
  border-radius: 8px;
  padding: 16px;
}
.nav-section h2 {
  font-size: 15px;
  margin-bottom: 10px;
}
.empty { color: #57606a; }
.problem-list {
  display: grid;
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.problem-link,
.book-link,
.run-link {
  align-items: center;
  background: #ffffff;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  color: inherit;
  display: grid;
  gap: 8px;
  font: inherit;
  padding: 8px 10px;
  text-decoration: none;
  text-align: left;
}
.problem-link:hover,
.book-link:hover,
.book-link.is-active,
.run-link:hover,
.run-link.is-active {
  border-color: #0969da;
  box-shadow: 0 0 0 2px #0969da22;
}
.problem-link {
  grid-template-columns: 70px 1fr auto;
}
.problem-link span,
.book-link em,
.run-link em {
  color: #cf222e;
  font-size: 12px;
  font-style: normal;
  font-weight: 700;
}
.problem-link em {
  color: #57606a;
  font-style: normal;
}
.book-links {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}
.book-link {
  cursor: pointer;
  grid-template-columns: 1fr auto;
}
.book-link strong { grid-column: 1 / -1; }
.book-link span { color: #57606a; }
.book-link-pass em { color: #2da44e; }
.run-links {
  border-top: 1px solid #d8dee4;
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  padding: 14px 18px;
}
.run-link {
  cursor: pointer;
  grid-template-columns: 1fr auto;
}
.run-link strong { grid-column: 1 / -1; }
.run-link span {
  color: #57606a;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}
.run-link-pass em { color: #2da44e; }
.books {
  display: grid;
  gap: 18px;
  padding: 24px;
}
.book-view {
  background: #ffffff;
  border: 1px solid #d8dee4;
  border-radius: 8px;
  display: none;
}
.book-view.is-active {
  display: block;
}
.book-header {
  align-items: center;
  display: flex;
  gap: 16px;
  justify-content: space-between;
  padding: 14px 18px;
}
.book-header span {
  color: #57606a;
  font-size: 13px;
  text-align: right;
}
.book-cases {
  border-top: 1px solid #d8dee4;
  padding: 18px;
}
.run-view {
  display: none;
}
.run-view.is-active {
  display: grid;
  gap: 20px;
}
.case {
  background: #ffffff;
  border: 1px solid #d8dee4;
  border-left-width: 6px;
  border-radius: 8px;
  padding: 18px;
  scroll-margin-top: 18px;
}
.case:target {
  box-shadow: 0 0 0 3px #0969da55;
}
.case-pass { border-left-color: #2da44e; }
.case-warn { border-left-color: #bf8700; }
.case-fail, .case-error, .case-missing { border-left-color: #cf222e; }
.case-header {
  align-items: start;
  display: flex;
  gap: 16px;
  justify-content: space-between;
}
.case-header p { color: #57606a; }
.status {
  border: 1px solid #d0d7de;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  padding: 4px 10px;
}
.metrics {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  margin: 14px 0;
}
.metrics div { min-width: 0; }
.metrics dt {
  color: #57606a;
  font-size: 12px;
}
.metrics dd {
  font-weight: 600;
  margin: 2px 0 0;
  overflow-wrap: anywhere;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 14px;
}
.tags span {
  background: #eef4ff;
  border: 1px solid #d0d7de;
  border-radius: 999px;
  padding: 2px 8px;
}
.error {
  background: #ffebe9;
  border: 1px solid #ff818266;
  border-radius: 6px;
  margin-bottom: 14px;
  padding: 10px;
}
.image-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}
figure { margin: 0; }
figcaption {
  color: #57606a;
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 6px;
  text-transform: uppercase;
}
img {
  background: #fff;
  border: 1px solid #d0d7de;
  display: block;
  height: auto;
  max-width: 100%;
}
.single-image img { max-height: 900px; }
.overlay {
  background: #fff;
  border: 1px solid #d0d7de;
  display: inline-block;
  line-height: 0;
  margin-top: 16px;
  max-width: min(100%, 720px);
  overflow: hidden;
  position: relative;
}
.overlay img {
  border: 0;
}
.overlay-base {
  height: auto;
  width: 100%;
}
.overlay-actual {
  inset: 0 auto 0 0;
  overflow: hidden;
  position: absolute;
  width: 50%;
}
.overlay-actual img {
  height: 100%;
  max-width: none;
  width: auto;
}
.overlay input {
  bottom: 12px;
  left: 16px;
  position: absolute;
  right: 16px;
  width: calc(100% - 32px);
}
.top-button {
  background: #1f2328;
  border: 0;
  border-radius: 999px;
  bottom: 20px;
  color: #ffffff;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  padding: 10px 14px;
  position: fixed;
  right: 20px;
}
.top-button:hover {
  background: #0969da;
}
@media (max-width: 760px) {
  .nav-panel { grid-template-columns: 1fr; }
  .problem-link { grid-template-columns: 1fr; }
  .book-header {
    align-items: start;
    flex-direction: column;
  }
  .book-header span { text-align: left; }
}
`;
}

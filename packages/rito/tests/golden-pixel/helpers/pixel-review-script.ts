export function pixelReviewScript(): string {
  return `
const REVIEW_STATUSES = ['fail', 'error', 'missing', 'warn', 'pass'];
const VIEW_MODES = ['overlay', 'compare', 'reference', 'diff', 'actual', 'expected'];
const dataNode = document.getElementById('review-data');
const reviewData = JSON.parse(dataNode?.textContent || '{"records":[]}');
const records = Array.isArray(reviewData.records) ? reviewData.records : [];
const labels = {
  expected: reviewData.labels?.expected || 'Expected',
  actual: reviewData.labels?.actual || 'Actual',
};
const state = {
  bookId: '',
  runId: '',
  query: '',
  problemsOnly: Boolean(reviewData.defaultProblemsOnly),
  statuses: new Set(REVIEW_STATUSES),
  activeId: '',
  viewMode: 'overlay',
  overlayWidth: 50,
};
const elements = {
  search: document.querySelector('[data-search]'),
  problemsOnly: document.querySelector('[data-problems-only]'),
  runList: document.querySelector('[data-run-filter-list]'),
  caseList: document.querySelector('[data-case-list]'),
  queueCount: document.querySelector('[data-queue-count]'),
  currentPosition: document.querySelector('[data-current-position]'),
  title: document.querySelector('[data-case-title]'),
  subtitle: document.querySelector('[data-case-subtitle]'),
  status: document.querySelector('[data-case-status]'),
  viewer: document.querySelector('[data-viewer]'),
  metrics: document.querySelector('[data-metrics]'),
  tags: document.querySelector('[data-tags]'),
  error: document.querySelector('[data-error]'),
};

hydrateInitialState();
bindControls();
refresh();

function hydrateInitialState() {
  const selected = reviewData.selected || {};
  state.activeId = selected.activeId || '';
  const hashId = decodeURIComponent(window.location.hash.slice(1));
  if (hashId) {
    const matched = records.find((record) => record.id === hashId || 'case-' + record.id === hashId);
    if (matched) {
      state.bookId = matched.bookId;
      state.runId = matched.runId;
      state.activeId = matched.id;
      state.problemsOnly = false;
    }
  }
}

function bindControls() {
  if (elements.search instanceof HTMLInputElement) {
    elements.search.addEventListener('input', () => {
      state.query = elements.search.value.trim().toLowerCase();
      refreshQueue();
    });
  }
  if (elements.problemsOnly instanceof HTMLInputElement) {
    elements.problemsOnly.checked = state.problemsOnly;
    elements.problemsOnly.addEventListener('change', () => {
      state.problemsOnly = elements.problemsOnly.checked;
      refreshQueue();
    });
  }
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const statusButton = target.closest('[data-status-filter]');
    if (statusButton instanceof HTMLElement && statusButton.dataset.statusFilter) {
      toggleStatus(statusButton.dataset.statusFilter, statusButton);
      refreshQueue();
      return;
    }

    const bookButton = target.closest('[data-book-filter]');
    if (bookButton instanceof HTMLElement) {
      state.bookId = bookButton.dataset.bookFilter || '';
      state.runId = '';
      refresh();
      return;
    }

    const runButton = target.closest('[data-run-filter]');
    if (runButton instanceof HTMLElement) {
      state.runId = runButton.dataset.runFilter || '';
      refreshQueue();
      return;
    }

    const caseButton = target.closest('[data-case-id]');
    if (caseButton instanceof HTMLElement && caseButton.dataset.caseId) {
      selectCase(caseButton.dataset.caseId, true);
      return;
    }

    const modeButton = target.closest('[data-view-mode]');
    if (modeButton instanceof HTMLElement && modeButton.dataset.viewMode) {
      state.viewMode = modeButton.dataset.viewMode;
      renderActiveCase();
      return;
    }

    if (target.closest('[data-prev-case]')) {
      stepCase(-1);
      return;
    }
    if (target.closest('[data-next-case]')) {
      stepCase(1);
    }
  });

  document.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.matches('[data-overlay-slider]')) return;
    state.overlayWidth = Number(target.value);
    const overlay = document.querySelector('[data-overlay]');
    if (overlay instanceof HTMLElement) overlay.style.setProperty('--overlay-reveal', target.value + '%');
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    if (event.key === 'j' || event.key === 'ArrowDown') {
      event.preventDefault();
      stepCase(1);
    } else if (event.key === 'k' || event.key === 'ArrowUp') {
      event.preventDefault();
      stepCase(-1);
    } else if (/^[1-6]$/.test(event.key)) {
      state.viewMode = VIEW_MODES[Number(event.key) - 1] || state.viewMode;
      renderActiveCase();
    }
  });
  window.addEventListener('resize', syncOverlayLayout);
}

function toggleStatus(status, button) {
  if (state.statuses.has(status)) {
    state.statuses.delete(status);
  } else {
    state.statuses.add(status);
  }
  button.classList.toggle('is-active', state.statuses.has(status));
}

function refresh() {
  renderBookFilters();
  renderRunFilters();
  refreshQueue();
}

function refreshQueue() {
  const filtered = filteredRecords();
  if (!filtered.some((record) => record.id === state.activeId)) {
    state.activeId = filtered[0]?.id || '';
  }
  renderCaseList(filtered);
  renderActiveCase();
}

function filteredRecords() {
  return records.filter((record) => {
    if (state.bookId && record.bookId !== state.bookId) return false;
    if (state.runId && record.runId !== state.runId) return false;
    if (state.problemsOnly && record.status === 'pass') return false;
    if (!state.statuses.has(record.status)) return false;
    if (!state.query) return true;
    return searchableText(record).includes(state.query);
  });
}

function searchableText(record) {
  return [
    record.id,
    record.bookId,
    record.profileId,
    record.lineBreaking,
    record.status,
    String(record.spreadIndex),
    String(record.totalSpreads),
    ...(record.tags || []),
  ]
    .join(' ')
    .toLowerCase();
}

function renderBookFilters() {
  for (const button of document.querySelectorAll('[data-book-filter]')) {
    if (!(button instanceof HTMLElement)) continue;
    button.classList.toggle('is-active', (button.dataset.bookFilter || '') === state.bookId);
  }
}

function renderRunFilters() {
  const list = elements.runList;
  if (!(list instanceof HTMLElement)) return;
  list.replaceChildren();

  const source = state.bookId ? records.filter((record) => record.bookId === state.bookId) : records;
  const runs = [...groupRuns(source).values()];
  if (state.runId && !runs.some((run) => run.runId === state.runId)) state.runId = '';

  list.appendChild(runChip('', 'All runs', summaryForRecords(source)));
  for (const run of runs) {
    list.appendChild(
      runChip(run.runId, run.profileId + ' / ' + run.lineBreaking, summaryForRecords(run.records)),
    );
  }
}

function groupRuns(source) {
  const map = new Map();
  for (const record of source) {
    const run = map.get(record.runId) || {
      runId: record.runId,
      profileId: record.profileId,
      lineBreaking: record.lineBreaking,
      records: [],
    };
    run.records.push(record);
    map.set(record.runId, run);
  }
  return map;
}

function runChip(runId, label, summary) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'run-chip';
  button.dataset.runFilter = runId;
  button.classList.toggle('is-active', runId === state.runId);
  const strong = document.createElement('strong');
  strong.textContent = label;
  const span = document.createElement('span');
  span.textContent = summary;
  button.append(strong, ' ', span);
  return button;
}

function renderCaseList(filtered) {
  const list = elements.caseList;
  if (!(list instanceof HTMLElement)) return;
  list.replaceChildren();

  if (elements.queueCount) {
    elements.queueCount.textContent = String(filtered.length) + ' cases';
  }
  if (elements.currentPosition) {
    const index = filtered.findIndex((record) => record.id === state.activeId);
    elements.currentPosition.textContent = index >= 0 ? String(index + 1) + ' / ' + String(filtered.length) : '';
  }

  for (const record of filtered) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'case-row status-' + record.status;
    button.dataset.caseId = record.id;
    button.classList.toggle('is-active', record.id === state.activeId);

    const top = document.createElement('span');
    top.className = 'case-row-top';
    const title = document.createElement('strong');
    title.textContent = caseShortTitle(record);
    const status = document.createElement('span');
    status.className = 'status-pill status-' + record.status;
    status.textContent = record.status;
    top.append(title, status);

    const meta = document.createElement('span');
    meta.className = 'case-row-meta';
    const left = document.createElement('span');
    left.textContent = record.profileId + ' / ' + record.lineBreaking;
    const right = document.createElement('span');
    right.textContent = diffText(record);
    meta.append(left, right);

    button.append(top, meta);
    item.appendChild(button);
    list.appendChild(item);
  }
}

function renderActiveCase() {
  const record = records.find((entry) => entry.id === state.activeId);
  renderModeButtons(record);
  renderCaseListSelection();

  if (!record) {
    renderEmptyCase();
    return;
  }

  if (elements.title) elements.title.textContent = record.id;
  if (elements.subtitle) {
    elements.subtitle.textContent =
      record.bookId + ' / ' + record.profileId + ' / ' + record.lineBreaking + ' / spread ' + String(record.spreadIndex);
  }
  if (elements.status) {
    elements.status.textContent = record.status;
    elements.status.className = 'case-status status-' + record.status;
  }
  renderMetrics(record);
  renderTags(record);
  renderError(record);
  renderViewer(record);
}

function renderCaseListSelection() {
  for (const button of document.querySelectorAll('[data-case-id]')) {
    if (!(button instanceof HTMLElement)) continue;
    const active = button.dataset.caseId === state.activeId;
    button.classList.toggle('is-active', active);
    if (active) button.scrollIntoView({ block: 'nearest' });
  }
  const filtered = filteredRecords();
  if (elements.currentPosition) {
    const index = filtered.findIndex((record) => record.id === state.activeId);
    elements.currentPosition.textContent = index >= 0 ? String(index + 1) + ' / ' + String(filtered.length) : '';
  }
}

function renderEmptyCase() {
  if (elements.title) elements.title.textContent = 'No matching case';
  if (elements.subtitle) elements.subtitle.textContent = 'Adjust filters to show review cases.';
  if (elements.status) {
    elements.status.textContent = 'Empty';
    elements.status.className = 'case-status';
  }
  if (elements.metrics) elements.metrics.replaceChildren();
  if (elements.tags) elements.tags.replaceChildren();
  if (elements.error instanceof HTMLElement) {
    elements.error.hidden = true;
    elements.error.textContent = '';
  }
  if (elements.viewer) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No cases match the current filters.';
    elements.viewer.replaceChildren(empty);
  }
}

function renderModeButtons(record) {
  const available = availableModes(record);
  if (!available.includes(state.viewMode)) state.viewMode = available[0] || 'actual';
  for (const button of document.querySelectorAll('[data-view-mode]')) {
    if (!(button instanceof HTMLButtonElement)) continue;
    const mode = button.dataset.viewMode || '';
    button.disabled = !available.includes(mode);
    button.classList.toggle('is-active', mode === state.viewMode);
  }
}

function availableModes(record) {
  if (!record) return [];
  const modes = ['actual'];
  if (record.expectedPath) modes.push('expected');
  if (record.referencePath) modes.push('reference');
  if (record.diffPath) modes.push('diff');
  if (record.expectedPath && record.actualPath) modes.push('overlay', 'compare');
  return VIEW_MODES.filter((mode) => modes.includes(mode));
}

function renderViewer(record) {
  const viewer = elements.viewer;
  if (!(viewer instanceof HTMLElement)) return;
  viewer.replaceChildren();

  if (state.viewMode === 'overlay' && record.expectedPath && record.actualPath) {
    viewer.appendChild(overlayView(record));
    syncOverlayLayout();
    return;
  }
  if (state.viewMode === 'compare') {
    viewer.appendChild(compareView(record));
    return;
  }
  const path = imagePathForMode(record, state.viewMode);
  const label =
    state.viewMode === 'reference'
      ? record.referenceLabel || 'Browser XHTML'
      : labelForMode(state.viewMode);
  viewer.appendChild(singleImageView(label, path || record.actualPath, record));
}

function overlayView(record) {
  const shell = document.createElement('div');
  shell.className = 'overlay-shell';
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.dataset.overlay = '';
  overlay.style.setProperty('--overlay-reveal', String(state.overlayWidth) + '%');
  applyImageFrameSize(overlay, record, 'primary');
  const expected = image(labels.expected, record.expectedPath, record, 'primary');
  expected.className = 'overlay-base';
  const actual = image(labels.actual, record.actualPath, record, 'primary');
  actual.className = 'overlay-actual';
  overlay.append(expected, actual);

  const controls = document.createElement('label');
  controls.className = 'overlay-controls';
  const label = document.createElement('span');
  label.textContent = labels.actual + ' reveal';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = String(state.overlayWidth);
  slider.dataset.overlaySlider = '';
  controls.append(label, slider);
  shell.append(overlay, controls);
  return shell;
}

function compareView(record) {
  const grid = document.createElement('div');
  grid.className = 'image-grid compare';
  if (record.expectedPath) {
    grid.appendChild(figure(labels.expected, record.expectedPath, record, 'primary'));
  }
  grid.appendChild(figure(labels.actual, record.actualPath, record, 'primary'));
  if (record.referencePath) {
    grid.appendChild(
      figure(record.referenceLabel || 'Browser XHTML', record.referencePath, record, 'reference'),
    );
  }
  if (record.diffPath) grid.appendChild(figure('Diff', record.diffPath, record, 'primary'));
  return grid;
}

function singleImageView(label, path, record) {
  const grid = document.createElement('div');
  grid.className = 'image-grid single';
  grid.appendChild(figure(label, path, record, state.viewMode === 'reference' ? 'reference' : 'primary'));
  return grid;
}

function figure(label, path, record, sizeRole) {
  const figureNode = document.createElement('figure');
  figureNode.className = 'image-frame';
  applyImageFrameSize(figureNode, record, sizeRole);
  const caption = document.createElement('figcaption');
  caption.textContent = label;
  figureNode.append(caption, image(label, path, record, sizeRole));
  return figureNode;
}

function image(label, path, record, sizeRole) {
  const img = document.createElement('img');
  img.src = path;
  img.alt = label;
  img.loading = 'eager';
  const size = imageSize(record, sizeRole);
  if (size) {
    img.width = size.width;
    img.height = size.height;
  }
  return img;
}

function applyImageFrameSize(element, record, sizeRole) {
  const size = imageSize(record, sizeRole);
  if (!size) return;
  element.dataset.imageWidth = String(size.width);
  element.dataset.imageHeight = String(size.height);
  element.classList.add('is-sized');
  element.style.setProperty('--review-image-width', String(size.width) + 'px');
  element.style.setProperty('--review-image-height', String(size.height) + 'px');
}

function syncOverlayLayout() {
  const overlay = document.querySelector('[data-overlay]');
  const viewer = elements.viewer;
  if (!(overlay instanceof HTMLElement) || !(viewer instanceof HTMLElement)) return;

  const width = Number(overlay.dataset.imageWidth);
  const height = Number(overlay.dataset.imageHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;

  const viewerStyle = getComputedStyle(viewer);
  const contentWidth =
    viewer.clientWidth - pixelValue(viewerStyle.paddingLeft) - pixelValue(viewerStyle.paddingRight);
  const contentHeight =
    viewer.clientHeight - pixelValue(viewerStyle.paddingTop) - pixelValue(viewerStyle.paddingBottom);
  const shell = overlay.closest('.overlay-shell');
  const controls = shell?.querySelector('.overlay-controls');
  const controlsHeight = controls instanceof HTMLElement ? controls.offsetHeight : 0;
  const rowGap = shell instanceof HTMLElement ? pixelValue(getComputedStyle(shell).rowGap) : 0;
  const maxImageWidth = Math.max(1, contentWidth);
  const maxImageHeight = Math.max(1, contentHeight - controlsHeight - rowGap);
  const scale = Math.min(1, maxImageWidth / width, maxImageHeight / height);
  overlay.style.setProperty('--review-display-width', String(Math.max(1, width * scale)) + 'px');
}

function pixelValue(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function imageSize(record, sizeRole) {
  const width = Number(sizeRole === 'reference' ? record.referenceImageWidth : record.imageWidth);
  const height = Number(sizeRole === 'reference' ? record.referenceImageHeight : record.imageHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

function imagePathForMode(record, mode) {
  if (mode === 'expected') return record.expectedPath;
  if (mode === 'reference') return record.referencePath;
  if (mode === 'diff') return record.diffPath;
  return record.actualPath;
}

function labelForMode(mode) {
  if (mode === 'expected') return labels.expected;
  if (mode === 'actual') return labels.actual;
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function renderMetrics(record) {
  const metrics = elements.metrics;
  if (!(metrics instanceof HTMLElement)) return;
  metrics.replaceChildren();
  const items = [
    ['Book', record.bookId],
    ['Profile', record.profileId],
    ['Line breaking', record.lineBreaking],
    ['Spread', String(record.spreadIndex) + ' / ' + String(record.totalSpreads)],
    ['Viewport', String(record.width) + 'x' + String(record.height) + ' @' + String(record.devicePixelRatio) + 'x'],
    ['Spread mode', record.spread],
    ['Diff', diffText(record)],
    ['Limit', ratioText(record.maxDiffPixelRatio)],
    ['Reference', referenceText(record)],
    ['Generated', record.generatedAt],
  ];
  for (const [label, value] of items) {
    const wrapper = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    wrapper.append(dt, dd);
    metrics.appendChild(wrapper);
  }
}

function renderTags(record) {
  const tags = elements.tags;
  if (!(tags instanceof HTMLElement)) return;
  tags.replaceChildren();
  for (const tag of record.tags || []) {
    const item = document.createElement('span');
    item.textContent = tag;
    tags.appendChild(item);
  }
}

function renderError(record) {
  if (!(elements.error instanceof HTMLElement)) return;
  elements.error.hidden = !record.error;
  elements.error.textContent = record.error || '';
}

function selectCase(caseId, updateHash) {
  state.activeId = caseId;
  renderActiveCase();
  if (updateHash) history.replaceState(null, '', '#' + encodeURIComponent(caseId));
}

function stepCase(delta) {
  const filtered = filteredRecords();
  if (filtered.length === 0) return;
  const current = filtered.findIndex((record) => record.id === state.activeId);
  const next = current < 0 ? 0 : Math.min(filtered.length - 1, Math.max(0, current + delta));
  selectCase(filtered[next].id, true);
}

function caseShortTitle(record) {
  return record.bookId + ' spread ' + String(record.spreadIndex).padStart(4, '0');
}

function diffText(record) {
  if (record.diffPixels === undefined || record.diffRatio === undefined) return 'n/a';
  return String(record.diffPixels) + ' px (' + ratioText(record.diffRatio) + ')';
}

function referenceText(record) {
  if (record.referencePath) {
    const source = record.referenceSourceHref ? ' / ' + record.referenceSourceHref : '';
    const target = record.referenceTargetFound === false ? ' / target not found' : '';
    return (record.referenceLabel || 'Browser XHTML') + source + target;
  }
  if (record.referenceSkipped) return 'skipped: ' + record.referenceSkipped;
  if (record.referenceError) return 'error: ' + record.referenceError;
  return 'n/a';
}

function ratioText(value) {
  return (value * 100).toFixed(3) + '%';
}

function summaryForRecords(source) {
  const problemCount = source.filter((record) => record.status !== 'pass').length;
  return String(problemCount) + ' / ' + String(source.length);
}
`;
}

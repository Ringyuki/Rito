import { requireRevisionHandle } from './core-wasm-versioned-validation-runtime.js';
import { requirePageIndex } from './reader-worker-interaction-validation-runtime.js';
import { requirePageReadingAnchor } from './reader-worker-page-reading-anchor-validation-runtime.js';

export function createPageReadingAnchorDocumentMethod(versionedIndex) {
  return function getPageReadingAnchorAtRevision(handle, pageIndex) {
    const expectedPageIndex = requirePageIndex(pageIndex, 'getPageReadingAnchorAtRevision');
    return versionedIndex(
      this,
      'getPageReadingAnchorAtRevision',
      handle,
      expectedPageIndex,
      (value, revision, operation) =>
        requirePageReadingAnchor(value, revision, expectedPageIndex, operation),
    );
  };
}

export function createPageReadingAnchorClientMethod(send, currentRevisionResult) {
  return (revision, pageIndex) => {
    const expectedPageIndex = requirePageIndex(pageIndex, 'getPageReadingAnchorAtRevision');
    return currentRevisionResult(
      send,
      'getPageReadingAnchorAtRevision',
      revision,
      { pageIndex: expectedPageIndex },
      (result, handle, operation) =>
        requirePageReadingAnchor(result, handle, expectedPageIndex, operation),
    );
  };
}

export function pageReadingAnchorResponse(document, request, validatedValueResponse) {
  const operation = request.kind;
  const revision = requireRevisionHandle(request.revision, operation);
  const pageIndex = requirePageIndex(request.pageIndex, operation);
  const envelope = document.getPageReadingAnchorAtRevision(revision, pageIndex);
  return validatedValueResponse(operation, revision, envelope, (value) =>
    requirePageReadingAnchor(value, revision, pageIndex, operation),
  );
}

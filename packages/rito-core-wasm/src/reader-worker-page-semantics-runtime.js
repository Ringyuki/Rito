import { requireRevisionHandle } from './core-wasm-versioned-validation-runtime.js';
import { requirePageIndex } from './reader-worker-interaction-validation-runtime.js';
import { requirePageSemantics } from './reader-worker-page-semantics-validation-runtime.js';

export function createPageSemanticsDocumentMethod(versionedIndex) {
  return function getPageSemanticsAtRevision(handle, pageIndex) {
    const expectedPageIndex = requirePageIndex(pageIndex, 'getPageSemanticsAtRevision');
    return versionedIndex(
      this,
      'getPageSemanticsAtRevision',
      handle,
      expectedPageIndex,
      (value, revision, operation) =>
        requirePageSemantics(value, revision, expectedPageIndex, operation),
    );
  };
}

export function createPageSemanticsClientMethod(send, currentRevisionResult) {
  return (revision, pageIndex) => {
    const expectedPageIndex = requirePageIndex(pageIndex, 'getPageSemanticsAtRevision');
    return currentRevisionResult(
      send,
      'getPageSemanticsAtRevision',
      revision,
      { pageIndex: expectedPageIndex },
      (result, handle, operation) =>
        requirePageSemantics(result, handle, expectedPageIndex, operation),
    );
  };
}

export function pageSemanticsResponse(document, request, validatedValueResponse) {
  const operation = request.kind;
  const revision = requireRevisionHandle(request.revision, operation);
  const pageIndex = requirePageIndex(request.pageIndex, operation);
  const envelope = document.getPageSemanticsAtRevision(revision, pageIndex);
  return validatedValueResponse(operation, revision, envelope, (value) =>
    requirePageSemantics(value, revision, pageIndex, operation),
  );
}

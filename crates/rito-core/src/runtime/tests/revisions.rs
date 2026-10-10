//! The interaction entry points take the revision they answer for, the way
//! a reader session calls them with the revision it holds. A test names a
//! whole-book revision by the id `create_revision` reported.

use crate::runtime::{
    frame::RuntimeRevision, RuntimeDocument, RuntimeExactSourceRangeRequest,
    RuntimeExactSourceRangeResolution, RuntimeSourceLocatorError,
};

/// The whole-book revision `revision_id` names.
pub(in crate::runtime) fn revision_by_id<'a>(
    document: &'a RuntimeDocument,
    revision_id: &str,
) -> &'a RuntimeRevision {
    document
        .revisions
        .get(revision_id)
        .expect("the document holds the revision")
}

/// Projects a durable source range onto a revision's pages: prepared
/// against the chapter source first, then resolved on the revision.
pub(in crate::runtime) fn exact_source_range(
    document: &mut RuntimeDocument,
    revision_id: &str,
    request: RuntimeExactSourceRangeRequest,
) -> Result<RuntimeExactSourceRangeResolution, RuntimeSourceLocatorError> {
    let prepared = document.prepare_exact_source_range(request)?;
    document.resolve_prepared_in(revision_by_id(document, revision_id), prepared)
}

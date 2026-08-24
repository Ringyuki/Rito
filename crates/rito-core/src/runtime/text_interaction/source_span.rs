use crate::epub::LoadedChapter;

use super::super::{
    page_artifact::PageArtifactSourcePoint, RuntimeSourceLocator, RuntimeSourcePoint,
    RuntimeSourceRange,
};
use super::{RuntimeTextSourceSpan, RuntimeTextSourceSpanEndpoint};

pub(super) fn runtime_text_source_endpoint(
    chapter: &LoadedChapter,
    source_point: PageArtifactSourcePoint,
) -> RuntimeTextSourceSpanEndpoint {
    RuntimeTextSourceSpanEndpoint {
        href: chapter.href.clone(),
        source_point: runtime_source_point(source_point),
    }
}

pub(super) fn compatible_source_locator(
    span: &RuntimeTextSourceSpan,
) -> Option<RuntimeSourceLocator> {
    (span.start.href == span.end.href).then(|| RuntimeSourceLocator {
        href: span.start.href.clone(),
        anchor_id: None,
        source_point: None,
        source_range: Some(RuntimeSourceRange {
            start: span.start.source_point.clone(),
            end: span.end.source_point.clone(),
        }),
        progression: None,
    })
}

pub(super) fn runtime_source_point(point: PageArtifactSourcePoint) -> RuntimeSourcePoint {
    RuntimeSourcePoint {
        node_path: point.node_path,
        text_offset: point.text_offset,
    }
}

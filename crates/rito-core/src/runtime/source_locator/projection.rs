use crate::layout::{collect_source_run_starts, LayoutSourceRunStart};

use super::{RuntimeSourceChapterIndex, RuntimeSourcePoint};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SourceProjection {
    Page(usize),
    BeyondSealedExtent,
    NoPageProjection,
}

pub(super) fn project_source_offset(
    pages: &[crate::layout::LayoutRuntimePage],
    source_index: &RuntimeSourceChapterIndex,
    target_offset: usize,
) -> SourceProjection {
    let starts = collect_source_run_starts(pages);
    project_source_offset_from_starts(&starts, source_index, target_offset)
}

pub(super) fn project_source_point(
    pages: &[crate::layout::LayoutRuntimePage],
    source_index: &RuntimeSourceChapterIndex,
    point: &RuntimeSourcePoint,
) -> SourceProjection {
    let starts = collect_source_run_starts(pages);
    project_source_point_from_starts(&starts, source_index, point)
}

fn project_source_offset_from_starts(
    starts: &[LayoutSourceRunStart],
    source_index: &RuntimeSourceChapterIndex,
    target_offset: usize,
) -> SourceProjection {
    let mut nearest_before: Option<(usize, usize)> = None;
    let mut nearest_after: Option<(usize, usize)> = None;
    let mut sealed_end = None;
    for start in starts {
        let Some(offset) = source_run_start_offset(source_index, start) else {
            continue;
        };
        if let Some(end) = source_run_end_offset(source_index, start) {
            sealed_end = Some(sealed_end.map_or(end, |current: usize| current.max(end)));
        }
        update_nearest_pages(
            offset,
            start.page_index,
            target_offset,
            &mut nearest_before,
            &mut nearest_after,
        );
    }
    if sealed_end.is_none_or(|end| target_offset > end) {
        return SourceProjection::BeyondSealedExtent;
    }
    nearest_before
        .or(nearest_after)
        .map(|(_, page_index)| SourceProjection::Page(page_index))
        .unwrap_or(SourceProjection::NoPageProjection)
}

fn project_source_point_from_starts(
    starts: &[LayoutSourceRunStart],
    source_index: &RuntimeSourceChapterIndex,
    point: &RuntimeSourcePoint,
) -> SourceProjection {
    let mut nearest_before: Option<(usize, usize)> = None;
    let mut nearest_after: Option<(usize, usize)> = None;
    let mut sealed_node_end = None;
    for start in starts
        .iter()
        .filter(|start| start.node_path == point.node_path)
    {
        update_nearest_pages(
            start.text_offset,
            start.page_index,
            point.text_offset,
            &mut nearest_before,
            &mut nearest_after,
        );
        let end = start.text_offset.saturating_add(start.text_length);
        sealed_node_end = Some(sealed_node_end.map_or(end, |current: usize| current.max(end)));
    }
    if let Some(end) = sealed_node_end {
        if point.text_offset > end {
            return SourceProjection::BeyondSealedExtent;
        }
        return nearest_before
            .or(nearest_after)
            .map(|(_, page_index)| SourceProjection::Page(page_index))
            .unwrap_or(SourceProjection::NoPageProjection);
    }

    let Some(target_span_index) = source_index.span_index(&point.node_path) else {
        return SourceProjection::NoPageProjection;
    };
    let max_sealed_span_index = starts
        .iter()
        .filter_map(|start| source_index.span_index(&start.node_path))
        .max();
    if max_sealed_span_index.is_none_or(|index| target_span_index > index) {
        SourceProjection::BeyondSealedExtent
    } else {
        SourceProjection::NoPageProjection
    }
}

fn update_nearest_pages(
    offset: usize,
    page_index: usize,
    target_offset: usize,
    nearest_before: &mut Option<(usize, usize)>,
    nearest_after: &mut Option<(usize, usize)>,
) {
    if offset <= target_offset {
        if nearest_before.is_none_or(|(best, _)| offset > best) {
            *nearest_before = Some((offset, page_index));
        }
    } else if nearest_after.is_none_or(|(best, _)| offset < best) {
        *nearest_after = Some((offset, page_index));
    }
}

fn source_run_start_offset(
    index: &RuntimeSourceChapterIndex,
    start: &LayoutSourceRunStart,
) -> Option<usize> {
    let span = index.span(&start.node_path)?;
    (start.text_offset >= span.source_start && start.text_offset <= span.source_end)
        .then(|| span.normalized_start + start.text_offset - span.source_start)
}

fn source_run_end_offset(
    index: &RuntimeSourceChapterIndex,
    start: &LayoutSourceRunStart,
) -> Option<usize> {
    let span = index.span(&start.node_path)?;
    let source_end = start
        .text_offset
        .saturating_add(start.text_length)
        .min(span.source_end);
    (source_end >= span.source_start)
        .then(|| span.normalized_start + source_end - span.source_start)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::super::RuntimeSourceChapterIndex;
    use super::{
        project_source_offset_from_starts, project_source_point_from_starts, SourceProjection,
    };
    use crate::{
        layout::LayoutSourceRunStart,
        runtime::{RuntimeChapterTextIndex, RuntimeChapterTextSpan, RuntimeSourcePoint},
    };

    #[test]
    fn targets_beyond_the_sealed_source_extent_remain_pending() {
        let index = source_index();
        let starts = vec![LayoutSourceRunStart {
            page_index: 0,
            node_path: vec![0],
            text_offset: 0,
            text_length: 5,
        }];

        assert_eq!(
            project_source_point_from_starts(
                &starts,
                &index,
                &RuntimeSourcePoint {
                    node_path: vec![0],
                    text_offset: 4,
                }
            ),
            SourceProjection::Page(0)
        );
        assert_eq!(
            project_source_point_from_starts(
                &starts,
                &index,
                &RuntimeSourcePoint {
                    node_path: vec![1],
                    text_offset: 0,
                }
            ),
            SourceProjection::BeyondSealedExtent
        );
        assert_eq!(
            project_source_offset_from_starts(&starts, &index, 7),
            SourceProjection::BeyondSealedExtent
        );
    }

    #[test]
    fn source_point_projection_does_not_depend_on_run_traversal_order() {
        let index = source_index();
        let starts = vec![
            LayoutSourceRunStart {
                page_index: 2,
                node_path: vec![0],
                text_offset: 4,
                text_length: 1,
            },
            LayoutSourceRunStart {
                page_index: 0,
                node_path: vec![0],
                text_offset: 0,
                text_length: 2,
            },
            LayoutSourceRunStart {
                page_index: 1,
                node_path: vec![0],
                text_offset: 2,
                text_length: 2,
            },
        ];

        assert_eq!(
            project_source_point_from_starts(
                &starts,
                &index,
                &RuntimeSourcePoint {
                    node_path: vec![0],
                    text_offset: 3,
                }
            ),
            SourceProjection::Page(1)
        );
    }

    fn source_index() -> RuntimeSourceChapterIndex {
        RuntimeSourceChapterIndex {
            text: RuntimeChapterTextIndex {
                href: "chapter.xhtml".to_owned(),
                normalized_text: "abcdefghij".to_owned(),
                spans: vec![
                    RuntimeChapterTextSpan {
                        node_path: vec![0],
                        source_start: 0,
                        source_end: 5,
                        normalized_start: 0,
                        normalized_end: 5,
                    },
                    RuntimeChapterTextSpan {
                        node_path: vec![1],
                        source_start: 0,
                        source_end: 5,
                        normalized_start: 5,
                        normalized_end: 10,
                    },
                ],
            },
            span_by_path: BTreeMap::from([(vec![0], 0), (vec![1], 1)]),
            anchors: BTreeMap::new(),
        }
    }
}

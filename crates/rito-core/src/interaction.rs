pub const NAME: &str = "interaction";
pub const OWNS: &str = "Hit maps, locators, selection, search, anchors, annotations, and footnotes";

mod text;

pub(crate) use text::{
    resolve_exact_source_range, resolve_text_caret, resolve_text_range,
    resolve_text_range_from_points, resolve_text_range_to_point, resolve_text_selection_movement,
    ExactTextRangeRect, LayoutExactTextRange, LayoutExactTextRangeResolution, LayoutSourcePoint,
    LayoutTextCaret, LayoutTextCaretResolution, LayoutTextPageRange, LayoutTextPoint,
    LayoutTextRangeFromPointsResolution, LayoutTextSelectionGranularity,
    LayoutTextSelectionMovement, LayoutTextSelectionMovementResolution,
};
pub use text::{
    TextCaretAddress, TextCaretAffinity, TextCaretGeometry, TextInteractionUnavailableReason,
    TextSelectionBoundary, TextSelectionMovement,
};

use serde::{Deserialize, Serialize};

#[cfg(test)]
use crate::xhtml::{parse_xhtml, DocumentNode};

mod footnote;

pub(crate) use footnote::{
    discover_footnote_targets, extract_footnotes_for_targets, FootnoteFilterChapter,
    FootnoteIndexBuilder, FootnoteTargetSet,
};
pub use footnote::{FootnoteEntry, FootnoteKind};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionSummary {
    pub chapter_text_index_ids: Vec<String>,
    pub footnote_keys: Vec<String>,
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub footnotes: std::collections::BTreeMap<String, FootnoteEntry>,
}

#[cfg(test)]
pub(crate) struct InteractionChapterInput<'a> {
    pub idref: &'a str,
    pub href: &'a str,
    pub xhtml_source: &'a str,
}

#[cfg(test)]
pub(crate) struct ParsedInteractionChapterInput<'a> {
    pub idref: &'a str,
    pub href: &'a str,
    pub nodes: &'a [DocumentNode],
}

#[cfg(test)]
pub(crate) fn summarize_interaction<'a>(
    chapters: impl IntoIterator<Item = InteractionChapterInput<'a>>,
) -> InteractionSummary {
    let chapters = chapters
        .into_iter()
        .map(|chapter| ParsedInteractionChapter {
            idref: chapter.idref.to_owned(),
            href: chapter.href.to_owned(),
            nodes: parse_xhtml(chapter.xhtml_source)
                .map(|parsed| parsed.nodes)
                .unwrap_or_default(),
        })
        .collect::<Vec<_>>();
    summarize_interaction_from_parsed(chapters.iter().map(|chapter| {
        ParsedInteractionChapterInput {
            idref: &chapter.idref,
            href: &chapter.href,
            nodes: &chapter.nodes,
        }
    }))
}

#[cfg(test)]
pub(crate) fn summarize_interaction_from_parsed<'a>(
    chapters: impl IntoIterator<Item = ParsedInteractionChapterInput<'a>>,
) -> InteractionSummary {
    let chapters = chapters.into_iter().collect::<Vec<_>>();
    let footnote_inputs = footnote_inputs(&chapters);
    let targets = discover_footnote_targets(&footnote_inputs);
    interaction_summary(&chapters, &targets)
}

pub(crate) fn summarize_interaction_with_footnotes(
    chapter_text_index_ids: impl IntoIterator<Item = String>,
    footnotes: std::collections::BTreeMap<String, FootnoteEntry>,
) -> InteractionSummary {
    let mut chapter_text_index_ids = chapter_text_index_ids.into_iter().collect::<Vec<_>>();
    chapter_text_index_ids.sort();
    let footnote_keys = footnotes.keys().cloned().collect();
    InteractionSummary {
        chapter_text_index_ids,
        footnote_keys,
        footnotes,
    }
}

#[cfg(test)]
fn interaction_summary(
    chapters: &[ParsedInteractionChapterInput<'_>],
    targets: &FootnoteTargetSet,
) -> InteractionSummary {
    let footnotes = extract_footnotes_for_targets(&footnote_inputs(chapters), targets).footnotes;
    summarize_interaction_with_footnotes(
        chapters.iter().map(|chapter| chapter.idref.to_owned()),
        footnotes,
    )
}

#[cfg(test)]
fn footnote_inputs<'a>(
    chapters: &'a [ParsedInteractionChapterInput<'a>],
) -> Vec<FootnoteFilterChapter<'a>> {
    chapters
        .iter()
        .map(|chapter| FootnoteFilterChapter {
            idref: chapter.idref,
            href: chapter.href,
            nodes: chapter.nodes,
        })
        .collect()
}

#[cfg(test)]
struct ParsedInteractionChapter {
    idref: String,
    href: String,
    nodes: Vec<DocumentNode>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarize_interaction_includes_structured_footnotes() {
        let summary = summarize_interaction([InteractionChapterInput {
            idref: "ch1",
            href: "Text/ch1.xhtml",
            xhtml_source: r##"
            <html xmlns:epub="http://www.idpf.org/2007/ops">
              <body>
                <p>Body<a epub:type="noteref" href="#fn1">1</a></p>
                <aside epub:type="endnote" id="fn1"><p>Referenced &amp; escaped</p></aside>
              </body>
            </html>
            "##,
        }]);
        let footnote = summary
            .footnotes
            .get("Text/ch1.xhtml#fn1")
            .expect("footnote entry is retained");

        assert_eq!(summary.footnote_keys, vec!["Text/ch1.xhtml#fn1"]);
        assert_eq!(footnote.kind, FootnoteKind::Endnote);
        assert_eq!(footnote.text, "Referenced & escaped");
        assert_eq!(footnote.html, "<p>Referenced &amp; escaped</p>");
    }
}

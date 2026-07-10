use super::{
    inline_segment::InlineSegment, line::LineBox, line_layout::layout_greedy_lines_with_fonts,
    line_optimal::layout_optimal_lines_with_fonts, text_measure::TextMeasurementFonts,
    LineBreaking,
};

#[cfg(test)]
use super::{line_layout::layout_greedy_lines, line_optimal::layout_optimal_lines};

#[cfg(test)]
pub(crate) fn layout_lines(
    segments: &[InlineSegment],
    max_width: f64,
    line_breaking: LineBreaking,
) -> Vec<LineBox> {
    match line_breaking {
        LineBreaking::Greedy => layout_greedy_lines(segments, max_width),
        LineBreaking::Optimal => layout_optimal_lines(segments, max_width),
    }
}

pub(crate) fn layout_lines_with_fonts<'a>(
    segments: &[InlineSegment],
    max_width: f64,
    line_breaking: LineBreaking,
    fonts: &'a TextMeasurementFonts<'a>,
) -> Vec<LineBox> {
    match line_breaking {
        LineBreaking::Greedy => layout_greedy_lines_with_fonts(segments, max_width, fonts),
        LineBreaking::Optimal => layout_optimal_lines_with_fonts(segments, max_width, fonts),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Map};

    use super::layout_lines;
    use crate::layout::{
        inline_segment::{InlineSegment, TextSegment},
        LineBreaking,
    };

    #[test]
    fn selects_greedy_line_layout() {
        let lines = layout_lines(&[text_segment("one two")], 200.0, LineBreaking::Greedy);

        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text(), "one two");
    }

    #[test]
    fn selects_optimal_line_layout() {
        let lines = layout_lines(
            &[text_segment("one two three four")],
            60.0,
            LineBreaking::Optimal,
        );

        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].text(), "one two");
    }

    fn text_segment(text: &str) -> InlineSegment {
        InlineSegment::Text(TextSegment {
            text: text.to_owned(),
            style: Map::from_iter([
                ("fontSize".to_owned(), json!(10)),
                ("lineHeight".to_owned(), json!(1.2)),
            ]),
            href: None,
            source_path: None,
            source_text: None,
            source_text_offset: None,
            ruby_annotation: None,
            inline_margin_left: None,
            inline_margin_right: None,
            border_start: false,
            border_end: false,
        })
    }
}

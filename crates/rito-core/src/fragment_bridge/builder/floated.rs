//! `TreeBuilder`'s floated images. CSS takes a floated element out of its
//! line and makes it block-level (CSS 2.1 §9.7): a floated `<img>` is a
//! float box exactly as large as the image's margin box, with no line box
//! around it. One that opens the inline content of a block container
//! (nothing before it occupies a line) is built as such a float box ahead
//! of the content's lines, and the block engine places it and wraps the
//! following lines and floats beside it. One met after content on a line
//! would need that line broken again around it, which the engine does not
//! do: it stays an inline image and the degradation says so.

use rito_fragment::{FormattingNode, FormattingNodeContent, FormattingNodeId};
use rito_style_contract::{
    self as c, LayoutDisplay, LayoutDisplayInside, LayoutDisplayOutside, LayoutFormattingStyle,
    LayoutStyleId, StyleId,
};

use crate::epub::{EpubError, EpubResult};
use crate::fragment_bridge::TreeBuilder;
use crate::xhtml::ImageNode;

impl TreeBuilder<'_> {
    /// Whether the image's computed `float` takes it out of its line.
    pub(super) fn image_floats(&mut self, source_index: usize) -> bool {
        self.layout
            .style_for_node(source_index)
            .is_ok_and(|style| style.float != c::Float::None)
    }

    /// Builds a floated image as a float box: the box carries the image's
    /// float, clearance and margins, and holds the image as the only atom
    /// of a flow whose strut has no height, so the box is exactly the
    /// image (no strut descent below it, as no line box surrounds a float).
    pub(super) fn build_floated_image(
        &mut self,
        image: &ImageNode,
        inherited: StyleId,
        link: Option<String>,
    ) -> EpubResult<FormattingNodeId> {
        let source_index = image
            .source_ref
            .source_node_id
            .map(|id| id.index())
            .ok_or_else(|| {
                EpubError::new(format!("image {} carries no source identity", image.src))
            })?;
        let image_style = self.layout_style_id(source_index, "image");
        let float_box = {
            let resolved = self
                .layout
                .style(image_style)
                .map_err(|error| EpubError::new(format!("floated image style: {error}")))?;
            float_box_style(resolved)
        };
        let float_box = self
            .layout
            .intern(float_box)
            .map_err(|error| EpubError::new(format!("floated image box interns: {error}")))?;
        let mut content = self.inline_collector();
        content.current_link = link;
        self.collect_image(image, inherited, 0.0, &mut content, true)?;
        let (items, sources) = content.finish();
        let id = self.push_node(
            FormattingNode {
                style: float_box,
                content: FormattingNodeContent::InlineFlow { items },
                children: Vec::new(),
            },
            None,
        );
        let strut = self.zero_height_strut(inherited)?;
        self.strut_styles.insert(id.0, strut);
        self.flow_item_sources.insert(id.0, sources);
        Ok(id)
    }

    /// The image's own layout style as the content of its float box: the
    /// box took the float, the clearance and the margins, and a percentage
    /// width, which resolves against the float's containing block, is the
    /// box's width that the image fills.
    pub(super) fn floated_image_content_style(
        &mut self,
        style: LayoutStyleId,
    ) -> EpubResult<LayoutStyleId> {
        let mut content = *self
            .layout
            .style(style)
            .map_err(|error| EpubError::new(format!("floated image content style: {error}")))?;
        content.float = c::Float::None;
        content.clear = c::Clear::None;
        content.margin = zero_margins()?;
        if width_has_percentage(&content) {
            content.width = c::PreferredSize::Value(c::NonNegativeLengthPercentage::new(
                c::LengthPercentage::Percentage(c::Percentage::from_ratio(1.0).map_err(
                    |error| EpubError::new(format!("floated image full width: {error:?}")),
                )?),
            ));
        }
        self.layout
            .intern(content)
            .map_err(|error| EpubError::new(format!("floated image content interns: {error}")))
    }

    /// The image's inline style as the content of its float box: its
    /// margins belong to the box, `vertical-align` does not apply to a
    /// float, and the strut an inline image's own style lends its line
    /// (the enclosing inline box's leading) has no height: no line box
    /// encloses a float.
    pub(super) fn floated_image_inline_style(&mut self, style: StyleId) -> EpubResult<StyleId> {
        let mut content = self
            .inline
            .style(style)
            .map_err(|error| EpubError::new(format!("floated image inline style: {error}")))?
            .clone();
        content.fragment.margin = zero_margins()?;
        content.font.line_height = zero_line_height()?;
        content.font.line_height_is_declared = true;
        content.fragment.baseline_shift = c::BaselineShift::Offset(c::LengthPercentage::Length(
            c::CssPx::new(0.0)
                .map_err(|error| EpubError::new(format!("zero baseline shift: {error:?}")))?,
        ));
        content.fragment.alignment_baseline = c::AlignmentBaseline::Baseline;
        self.inline
            .intern(content)
            .map_err(|error| EpubError::new(format!("floated image inline interns: {error}")))
    }

    /// The parent's text style with no box, no indent and a zero line
    /// height: a strut that adds nothing to the image's line.
    fn zero_height_strut(&mut self, inherited: StyleId) -> EpubResult<StyleId> {
        let bare = self.container_text_style(inherited)?;
        let bare = self.anonymous_strut_style(bare)?;
        let mut strut = self
            .inline
            .style(bare)
            .map_err(|error| EpubError::new(format!("floated image strut: {error}")))?
            .clone();
        strut.font.line_height = zero_line_height()?;
        strut.font.line_height_is_declared = true;
        self.inline
            .intern(strut)
            .map_err(|error| EpubError::new(format!("floated image strut interns: {error}")))
    }
}

/// The float box of a floated image: a block box with the image's float,
/// clearance and margins, as wide as the image (shrink-to-fit) unless the
/// image's width is a percentage of the containing block.
fn float_box_style(image: &LayoutFormattingStyle) -> LayoutFormattingStyle {
    let zero = c::NonNegativeLengthPercentage::new(c::LengthPercentage::Length(
        c::CssPx::new(0.0).expect("zero is finite"),
    ));
    LayoutFormattingStyle {
        display: LayoutDisplay {
            outside: LayoutDisplayOutside::Block,
            inside: LayoutDisplayInside::Flow,
            is_list_item: false,
        },
        padding: c::PhysicalSides {
            top: zero,
            right: zero,
            bottom: zero,
            left: zero,
        },
        width: if width_has_percentage(image) {
            image.width
        } else {
            c::PreferredSize::Auto
        },
        height: c::PreferredSize::Auto,
        max_width: c::MaximumSize::None,
        min_height: c::MinimumHeight::Auto,
        max_height: c::MaximumHeight::None,
        position: c::Position::Static,
        ..*image
    }
}

fn width_has_percentage(style: &LayoutFormattingStyle) -> bool {
    match style.width {
        c::PreferredSize::Value(value) => match value.value() {
            c::LengthPercentage::Length(_) => false,
            c::LengthPercentage::Percentage(_) => true,
            c::LengthPercentage::Linear { percentage, .. } => percentage.ratio() != 0.0,
        },
        _ => false,
    }
}

fn zero_line_height() -> EpubResult<c::LineHeight> {
    Ok(c::LineHeight::Length(
        c::NonNegativeCssPx::new(0.0)
            .map_err(|error| EpubError::new(format!("zero line height: {error:?}")))?,
    ))
}

fn zero_margins() -> EpubResult<c::PhysicalSides<c::LengthPercentageOrAuto>> {
    let zero = c::LengthPercentageOrAuto::Value(c::LengthPercentage::Length(
        c::CssPx::new(0.0).map_err(|error| EpubError::new(format!("zero margin: {error:?}")))?,
    ));
    Ok(c::PhysicalSides {
        top: zero,
        right: zero,
        bottom: zero,
        left: zero,
    })
}

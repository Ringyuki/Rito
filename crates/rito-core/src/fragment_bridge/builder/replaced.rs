//! `TreeBuilder`'s replaced elements. An `<hr>` becomes a fixed-height leaf
//! whose visible line is a rule stroke across its box; an `<img>` becomes an
//! atomic inline item carrying its intrinsic dimensions (or the broken-image
//! placeholder when none are known), its own border absorbed as padding
//! with the flank paint recorded, its baseline shift and its `object-fit`.

use rito_fragment::{FormattingNode, FormattingNodeContent, FormattingNodeId, InlineItem};
use rito_style_contract::StyleId;

use super::element_source_index;
use super::inline::resolved_baseline_shift;
use crate::epub::{EpubError, EpubResult};
use crate::fragment_bridge::{InlineCollector, NodePaint, TreeBuilder};
use crate::render::contract::ReaderBorderStyle;
use crate::xhtml::{ElementNode, ImageNode};

impl TreeBuilder<'_> {
    /// Builds one `<hr>`: a fixed-height leaf whose visible line is a
    /// stroke across its box. An author border-top drives the line's
    /// height, pattern, and color, mirroring the retained engine's rule
    /// resolution; without one the rule is the classic one-pixel solid
    /// line in the element's text color. Exotic stroke patterns collapse
    /// to solid exactly as the render protocol does.
    pub(super) fn build_hr(
        &mut self,
        element: &ElementNode,
    ) -> EpubResult<Option<FormattingNodeId>> {
        use rito_style_contract::BorderStyle;
        let source_index = element_source_index(element)?;
        if self.is_display_none(source_index, "hr") {
            return Ok(None);
        }
        let style = self.layout_style_id(source_index, "hr");
        self.require_block_capabilities(style, "hr")?;
        let inline_style = self.inline_style_id(source_index, "hr");
        let resolved = self
            .inline
            .style(inline_style)
            .map_err(|error| EpubError::new(format!("hr style: {error}")))?;
        let border = resolved.fragment.border.top;
        let use_border = border.resolved_width.get() > 0.0
            && !matches!(border.style, BorderStyle::None | BorderStyle::Hidden);
        let (thickness, stroke, color) = if use_border {
            let stroke = match border.style {
                BorderStyle::Dotted => ReaderBorderStyle::Dotted,
                BorderStyle::Dashed => ReaderBorderStyle::Dashed,
                // A thin inset rule paints Chromium's fixed 3D bevel pair
                // (top #9A9A9A, bottom #EEEEEE, border-color ignored —
                // measured identical for gray, red and slate); the paint
                // walk expands it into two solid strokes.
                BorderStyle::Inset | BorderStyle::Groove => ReaderBorderStyle::Inset,
                _ => ReaderBorderStyle::Solid,
            };
            let color = border.color.resolve(resolved.paint.foreground);
            (f64::from(border.resolved_width.get()), stroke, color)
        } else {
            // No author border: the UA default is `border: 1px inset`, so
            // the rule is Chromium's bevel pair over a two-pixel box
            // (b52 profile pages: every block below a bare <hr> sat one
            // pixel high under the old one-pixel model).
            (1.0, ReaderBorderStyle::Inset, resolved.paint.foreground)
        };
        // The box the rule occupies in flow follows the CSS box model: an
        // author `height` is the content height, and both horizontal
        // borders add to it (the book-measured 3px cascade: a
        // `height: 2px; border: 1px inset` rule flows 4px tall in Blink
        // while the stroke stays 1px). Without author borders the UA
        // 1px-inset pair still spans two pixels of flow.
        let block_size = if use_border {
            let bottom = resolved.fragment.border.bottom;
            let bottom_width = if matches!(bottom.style, BorderStyle::None | BorderStyle::Hidden) {
                0.0
            } else {
                f64::from(bottom.resolved_width.get())
            };
            let author_height = self
                .layout
                .style(style)
                .ok()
                .and_then(|layout_style| match layout_style.height {
                    rito_style_contract::PreferredSize::Value(value) => match value.value() {
                        rito_style_contract::LengthPercentage::Length(px) => {
                            Some(f64::from(px.get()))
                        }
                        _ => None,
                    },
                    _ => None,
                })
                .unwrap_or(0.0);
            thickness + author_height + bottom_width
        } else {
            thickness * 2.0
        };
        let color = crate::style::paint_color(color)
            .map_err(|error| EpubError::new(format!("hr stroke color: {error:?}")))?;
        let id = self.push_node(
            FormattingNode {
                style,
                content: FormattingNodeContent::SizedLeaf {
                    block_size,
                    breakable: false,
                },
                children: Vec::new(),
            },
            Some(source_index),
        );
        self.node_paints.insert(
            id.0,
            NodePaint::Rule {
                color,
                style: stroke,
                thickness,
            },
        );
        Ok(Some(id))
    }

    /// Collects one image as an atomic inline item. The image element has
    /// its own projected styles; display sizing happens at layout time.
    pub(super) fn collect_image(
        &mut self,
        image: &ImageNode,
        inherited: StyleId,
        ancestor_shift_px: f64,
        collector: &mut InlineCollector,
    ) -> EpubResult<()> {
        let source_index = image
            .source_ref
            .source_node_id
            .map(|id| id.index())
            .ok_or_else(|| {
                EpubError::new(format!("image {} carries no source identity", image.src))
            })?;
        if self.is_display_none(source_index, "image") {
            return Ok(());
        }
        let dimensions = self.image_dimensions.get(&image.src).copied();
        let (width, height) = match dimensions {
            Some(dimensions) => dimensions,
            None => {
                // A missing or undecodable image lays out as Chromium's
                // broken-image placeholder instead of refusing the chapter.
                // Measured (pinned-face oracle): a 16×16 icon, followed by
                // the alt text in the element's own style when alt is
                // non-empty (alt "015" at 16px → 40×18: icon 16 + three
                // 8px digits; the pair participates in inline layout, so a
                // centered row of art + missing plate shifts by half the
                // placeholder — the b69 finale page's 19px displacement).
                // An empty alt collapses in Chromium (0×0); the 1×1 here
                // is the closest the atom pipeline represents.
                self.degrade(format!(
                    "image dimensions unavailable, placeholder rendered: {}",
                    image.src
                ));
                if image.alt.is_empty() {
                    (1, 1)
                } else {
                    (16, 16)
                }
            }
        };
        let style = self.inline_style_id(source_index, "image");
        let layout_style = self.layout_style_id(source_index, "image");
        // The image's own border reserves space exactly like a
        // container's: its widths become padding on the derived layout
        // style, the atom's advance spans them, and the raster paints
        // inside (measured on the b60 cover's 1px `none solid` flanks —
        // dropping them shifted the whole plate one pixel against Blink).
        let layout_style = match self.block_box_paint_plan(source_index, "image")? {
            Some((paint, widths)) if widths.iter().any(|width| *width > 0.0) => {
                self.image_border_paints
                    .insert(source_index as u32, (paint, widths));
                self.style_with_border_padding(layout_style, widths, "image")?
            }
            _ => layout_style,
        };
        self.require_image_capabilities(layout_style)?;
        self.require_inline_capabilities(style, true, "image")?;
        let resolved = self
            .inline
            .style(style)
            .map_err(|error| EpubError::new(format!("image style: {error}")))?;
        if let Some(anchor) = image
            .attributes
            .as_ref()
            .and_then(|attributes| attributes.id.clone())
        {
            self.source_anchors.insert(source_index, anchor);
        }
        // NOTE: an SVG-folded raster's PLACEMENT is two-stage in the
        // browser — the svg element letterboxes its viewBox (cover:
        // 1434×2048 → 595.166×850 at x 22.417), then the inner <image>
        // contain-fits the raster (1119×1600) inside the scaled
        // image-element rect, landing at x 22.766, width 594.47. The
        // raster intrinsics below reproduce that FINAL rect in one step,
        // which is why swapping them for the viewBox regresses the cover
        // (10.6k → 226k, twice measured: the raster then letterboxes a
        // second time against the wrong basis). The residual 1,701-px
        // edge-column class lives in the 0.35px band between the viewBox
        // content edge and the raster edge — whatever the browser paints
        // there needs a reduced svg-letterbox probe before any change.
        // `vertical-align: top` pins the image to the line-box top,
        // stepping OUT of whatever baseline-shift chain wraps it (the
        // zhangyue footnote badge sits inside <sup> yet hugs the line
        // top in Blink; the sup's strut still raises the envelope).
        let align_top = matches!(
            resolved.fragment.baseline_shift,
            rito_style_contract::BaselineShift::Top
        );
        let baseline_shift_px = ancestor_shift_px
            + resolved_baseline_shift(
                resolved,
                self.inline
                    .style(inherited)
                    .map(|parent| f64::from(parent.font.size.get()))
                    .map_err(|error| EpubError::new(format!("image parent style: {error}")))?,
            );
        // Computed `object-fit` from the cascade (the UA stylesheet sets
        // `contain` on `img`, authors can override). Only fill and
        // contain paint distinctly today; cover/none/scale-down
        // approximate as contain with a degradation note.
        let object_fit = {
            let resolved = self
                .layout
                .style(layout_style)
                .map_err(|error| EpubError::new(format!("image layout style: {error}")))?
                .object_fit;
            match resolved {
                rito_style_contract::ObjectFit::Fill | rito_style_contract::ObjectFit::Contain => {
                    resolved
                }
                other => {
                    self.degrade(format!(
                        "object-fit {other:?} approximated as contain: {}",
                        image.src
                    ));
                    rito_style_contract::ObjectFit::Contain
                }
            }
        };
        collector.push_image(
            InlineItem::Image {
                src: image.src.clone(),
                source: source_index as u32,
                intrinsic_width: f64::from(width),
                intrinsic_height: f64::from(height),
                style,
                layout_style,
                fit_contain: image.svg_contain,
                viewport: image.svg_viewport,
                align_top,
                baseline_shift_px,
                object_fit,
            },
            source_index,
            image.source_ref.node_path.clone(),
            &image.alt,
        );
        if dimensions.is_none() && !image.alt.is_empty() {
            // The placeholder's alt text follows the icon inline, in the
            // image element's own style — exactly the run Chromium lays
            // out for a broken image.
            collector.push_text(
                &image.alt,
                style,
                baseline_shift_px,
                true,
                None,
                Some(source_index),
                Some(image.source_ref.node_path.clone()),
            );
        }
        Ok(())
    }
}

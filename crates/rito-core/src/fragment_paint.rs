//! Paints the fragment engine's layout output through the reader's
//! display-command protocol.
//!
//! The reader renders `DisplayCommand` streams and nothing else, so the
//! fragment engine reaches the screen by walking its fragment tree and
//! emitting the same commands the legacy pipeline produces. The walk is
//! paint-only: it takes geometry exactly as laid out and reads every visual
//! property from the typed style tables the formatting tree carries. A
//! style the command protocol cannot express fails closed naming the
//! property — the same doctrine as the tree builder's whitelist — so a
//! chapter never reaches the screen with silently dropped ink.

use std::sync::Arc;

use rito_fragment::{
    FormattingNodeContent, FormattingTree, Fragment, ImageFragment, InlineItem, LineFragment,
    TextFragment,
};
use rito_style_contract::{
    AbsoluteColor, FontSlant, InlineFormattingStyleV1, LengthPercentage, TextDecorationStyle,
};
use serde_json::Value;

use std::collections::BTreeMap;

use crate::epub::{EpubError, EpubResult};
use crate::fragment_bridge::NodePaint;
use crate::layout::{
    FontPaint, FontPaintStyle, MeasurePaint, RunDecoration, RunDecorationKind, RunPaint,
    RunPaintData, TextShadowPaint,
};
use crate::render::{DisplayCommand, DisplayTextCommandInput};
use crate::style::{absolute_color, serialize_font_families};

/// How painted family stacks reach the canvas when the reader pins fonts.
///
/// The renderer resolves the painted `font-family` string against the
/// host's font set, while layout resolved it against exactly the faces
/// registered in the engine. Left as computed, a family the host happens
/// to own (but the engine does not) would render in a font layout never
/// measured. This policy reproduces the retained pipeline's rewrite:
/// families the engine cannot resolve are dropped, and the reader's
/// pinned faces are appended under their stable alias names ahead of the
/// generic fallback, which the host has registered via `FontFace`.
#[derive(Clone, Debug, Default)]
pub(crate) struct PaintFamilyPolicy {
    /// Lowercased family names layout can actually resolve.
    pub(crate) available: std::collections::BTreeSet<String>,
    /// Pinned-face alias names, in policy order.
    pub(crate) aliases: Vec<String>,
}

/// Fraction of the font size between a run's alphabetic baseline and the
/// edge the reader's canvas painter anchors text at (`textBaseline: 'top'`
/// places the em-square top at the paint rect's y). The canvas em-square
/// top is font-dependent; this shared engine-wide proxy is what the legacy
/// pipeline positions baselines with, and the browser pixel oracle owns
/// calibrating it.
const CANVAS_TOP_ASCENT_RATIO: f64 = 0.8;

/// Wire-precision JSON number: three decimal places, integral values as
/// integers — the rounding every display-command producer shares.
pub(crate) fn number_value(value: f64) -> Value {
    let rounded = (value * 1000.0).round() / 1000.0;
    if rounded.fract().abs() < f64::EPSILON {
        Value::Number(serde_json::Number::from(rounded as i64))
    } else {
        Value::Number(
            serde_json::Number::from_f64(rounded).unwrap_or_else(|| serde_json::Number::from(0)),
        )
    }
}

/// Wire rectangle in the shared `{x, y, width, height}` shape.
pub(crate) fn rect_value(x: f64, y: f64, width: f64, height: f64) -> Value {
    serde_json::json!({
        "x": number_value(x),
        "y": number_value(y),
        "width": number_value(width),
        "height": number_value(height),
    })
}

/// Everything the paint walk needs besides the fragments themselves.
#[derive(Clone, Copy, Default)]
pub(crate) struct FragmentPaintContext<'a> {
    /// Family-stack rewrite for pinned-font readers; `None` paints
    /// computed stacks as-is.
    pub(crate) family_policy: Option<&'a PaintFamilyPolicy>,
    /// Layout-inert per-node paint the bridge collected (rules today).
    pub(crate) node_paints: Option<&'a BTreeMap<u32, NodePaint>>,
}

/// Walks a laid-out fragment tree and appends the display commands that
/// paint it, with every rectangle translated by `(origin_x, origin_y)`
/// into the caller's coordinate space (a page's content origin).
pub(crate) fn append_fragment_display_commands(
    commands: &mut Vec<DisplayCommand>,
    tree: &FormattingTree,
    fragment: &Fragment,
    origin_x: f64,
    origin_y: f64,
    context: FragmentPaintContext<'_>,
) -> EpubResult<()> {
    match fragment {
        Fragment::Box(fragment) => {
            if let Some(paint) = context
                .node_paints
                .and_then(|paints| paints.get(&fragment.source.0))
            {
                match paint {
                    NodePaint::Rule { color, style } => {
                        commands.push(DisplayCommand::paint_horizontal_rule(
                            rect_value(
                                origin_x + fragment.rect.x,
                                origin_y + fragment.rect.y,
                                fragment.rect.width,
                                fragment.rect.height,
                            ),
                            serde_json::json!({ "color": color, "style": style }),
                        ));
                    }
                    NodePaint::Box { paint, border_box } => {
                        commands.push(DisplayCommand::paint_block(
                            rect_value(
                                origin_x + fragment.rect.x,
                                origin_y + fragment.rect.y,
                                fragment.rect.width,
                                fragment.rect.height,
                            ),
                            paint.clone(),
                            border_box.clone(),
                        ));
                    }
                }
            }
            for child in &fragment.children {
                append_fragment_display_commands(
                    commands,
                    tree,
                    child,
                    origin_x + fragment.rect.x,
                    origin_y + fragment.rect.y,
                    context,
                )?;
            }
            Ok(())
        }
        Fragment::Line(line) => append_line_commands(
            commands,
            tree,
            line,
            origin_x,
            origin_y,
            context.family_policy,
        ),
        Fragment::Text(_) | Fragment::Image(_) => Err(EpubError::new(
            "text and image fragments paint through their line box, not standalone",
        )),
    }
}

fn append_line_commands(
    commands: &mut Vec<DisplayCommand>,
    tree: &FormattingTree,
    line: &LineFragment,
    origin_x: f64,
    origin_y: f64,
    family_policy: Option<&PaintFamilyPolicy>,
) -> EpubResult<()> {
    let FormattingNodeContent::InlineFlow { items } = &tree.node(line.source).content else {
        return Err(EpubError::new("line fragment source is not an inline flow"));
    };
    let styles = tree
        .styles()
        .ok_or_else(|| EpubError::new("formatting tree carries no style tables"))?;
    // Text fragments address the flow's concatenated item text by byte
    // range; rebuild that concatenation to slice run text and map each run
    // back to the item whose style paints it.
    let mut full_text = String::new();
    let mut text_ranges: Vec<(std::ops::Range<usize>, usize)> = Vec::new();
    for (item_index, item) in items.iter().enumerate() {
        if let InlineItem::Text { text, .. } = item {
            let start = full_text.len();
            full_text.push_str(text);
            text_ranges.push((start..full_text.len(), item_index));
        }
    }
    let line_x = origin_x + line.rect.x;
    let line_y = origin_y + line.rect.y;
    for child in &line.children {
        match child {
            Fragment::Text(run) => {
                append_text_run_command(
                    commands,
                    items,
                    styles,
                    &full_text,
                    &text_ranges,
                    line,
                    run,
                    line_x,
                    line_y,
                    family_policy,
                )?;
            }
            Fragment::Image(image) => {
                append_image_command(commands, items, image, line_x, line_y)?;
            }
            Fragment::Box(_) | Fragment::Line(_) => {
                return Err(EpubError::new(
                    "line boxes contain only text and image fragments",
                ));
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn append_text_run_command(
    commands: &mut Vec<DisplayCommand>,
    items: &[InlineItem],
    styles: &rito_fragment::FormattingTreeStyles,
    full_text: &str,
    text_ranges: &[(std::ops::Range<usize>, usize)],
    line: &LineFragment,
    run: &TextFragment,
    line_x: f64,
    line_y: f64,
    family_policy: Option<&PaintFamilyPolicy>,
) -> EpubResult<()> {
    let start = run.text_start as usize;
    let end = run.text_end as usize;
    // The inline provider brushes every glyph run with its item index, so
    // a run always lies inside exactly one item; a run that straddles two
    // items would paint one item's style over the other's text.
    let (_, item_index) = text_ranges
        .iter()
        .find(|(range, _)| range.start <= start && end <= range.end)
        .ok_or_else(|| {
            EpubError::new(format!(
                "text run bytes {start}..{end} do not lie inside one inline item"
            ))
        })?;
    let InlineItem::Text {
        style,
        baseline_shift_px,
        ruby_annotation,
        ..
    } = &items[*item_index]
    else {
        return Err(EpubError::new("text run maps to a non-text inline item"));
    };
    let style = styles
        .inline
        .style(*style)
        .map_err(|error| EpubError::new(format!("text run has no inline style: {error}")))?;
    let paint = run_paint(style, family_policy)?;
    let font_size = f64::from(style.font.size.get());
    // The run's baseline is the line's, raised by the item's own shift;
    // the paint rect starts one canvas-'top' ascent above it and spans the
    // em box. The line box height travels separately so consumers can
    // reconstruct line geometry.
    let baseline = line_y + line.baseline - baseline_shift_px;
    let em_top = baseline - CANVAS_TOP_ASCENT_RATIO * font_size;
    if let Some(annotation) = ruby_annotation {
        // The reader's ruby convention (shared with the retained engine):
        // the annotation paints at half the base font size, centered over
        // the base run's laid-out extent, its bottom edge one pixel above
        // the base's paint anchor. A base split across lines repeats its
        // full annotation over each of its runs.
        let annotation_size = font_size * 0.5;
        commands.push(DisplayCommand::paint_ruby(DisplayTextCommandInput {
            text: Value::String(annotation.clone()),
            rect: rect_value(
                line_x + run.rect.x,
                em_top - annotation_size - 1.0,
                run.rect.width,
                annotation_size,
            ),
            paint: paint.for_ruby(annotation_size),
            line_height_px: None,
            href: None,
            source_text: None,
            source_text_offset: None,
        }));
    }
    commands.push(DisplayCommand::paint_text(DisplayTextCommandInput {
        text: Value::String(full_text[start..end].to_owned()),
        rect: rect_value(line_x + run.rect.x, em_top, run.rect.width, font_size),
        paint,
        line_height_px: Some(number_value(line.rect.height)),
        href: None,
        source_text: None,
        source_text_offset: None,
    }));
    Ok(())
}

fn append_image_command(
    commands: &mut Vec<DisplayCommand>,
    items: &[InlineItem],
    image: &ImageFragment,
    line_x: f64,
    line_y: f64,
) -> EpubResult<()> {
    let Some(InlineItem::Image { src, .. }) = items.get(image.item_index as usize) else {
        return Err(EpubError::new(format!(
            "image fragment item index {} does not name an image item",
            image.item_index
        )));
    };
    // Alt text and link targets travel with the interaction layer, which
    // the fragment contract does not carry yet.
    commands.push(DisplayCommand::paint_image(
        src.clone(),
        rect_value(
            line_x + image.rect.x,
            line_y + image.rect.y,
            image.rect.width,
            image.rect.height,
        ),
        None,
        None,
    ));
    Ok(())
}

/// Builds the typed run paint the renderer consumes from one item's inline
/// style. Pure paint properties the command protocol cannot express fail
/// closed by name rather than dropping ink.
fn run_paint(
    style: &InlineFormattingStyleV1,
    family_policy: Option<&PaintFamilyPolicy>,
) -> EpubResult<RunPaint> {
    let paint = &style.paint;
    if paint.opacity.get() != 1.0 {
        return Err(not_paintable("inline opacity below one"));
    }
    if paint.background_image.is_some() {
        return Err(not_paintable("inline background-image"));
    }
    if !paint.transform.is_none() {
        return Err(not_paintable("inline transform"));
    }
    if !paint.box_shadows.is_empty() {
        return Err(not_paintable("inline box-shadow"));
    }
    let color = css_color(paint.foreground)?;
    let background = paint.background.resolve(paint.foreground);
    let background_color = if background.alpha().get() == 0.0 {
        None
    } else {
        Some(css_color(background)?)
    };
    let font_size = f64::from(style.font.size.get());
    let text_shadows = paint
        .text_shadows
        .iter()
        .map(|shadow| {
            Ok(TextShadowPaint {
                offset_x: f64::from(shadow.offset_x.get()),
                offset_y: f64::from(shadow.offset_y.get()),
                blur: f64::from(shadow.blur_radius.get()),
                color: css_color(shadow.color.resolve(paint.foreground))?,
            })
        })
        .collect::<EpubResult<Vec<_>>>()?;
    Ok(RunPaint::new(RunPaintData {
        measure: MeasurePaint {
            font: FontPaint {
                // The protocol expresses upright and slanted only; oblique
                // paints as italic, exactly as the canvas font string would
                // coerce it.
                style: match style.font.slant {
                    FontSlant::Normal => FontPaintStyle::NORMAL,
                    FontSlant::Italic | FontSlant::Oblique(_) => FontPaintStyle::ITALIC,
                },
                weight: f64::from(style.font.weight.get()),
                size_px: font_size,
                family: paint_family_stack(style, family_policy)?,
            },
            word_spacing_px: spacing_px(style.text_flow.word_spacing)?,
            letter_spacing_px: spacing_px(style.text_flow.letter_spacing)?,
        },
        color,
        background_color,
        background_radius: None,
        text_shadows: Arc::from(text_shadows),
        decoration: run_decoration(style, font_size)?,
        padding: None,
        border: None,
    }))
}

/// Maps computed text-decoration onto the protocol's single solid stroke.
fn run_decoration(
    style: &InlineFormattingStyleV1,
    font_size: f64,
) -> EpubResult<Option<RunDecoration>> {
    let decoration = &style.paint.text_decoration;
    let lines = decoration.lines;
    if lines.is_empty() {
        return Ok(None);
    }
    if lines.overline || lines.blink {
        return Err(not_paintable("text-decoration overline or blink"));
    }
    if lines.underline && lines.line_through {
        return Err(not_paintable("combined text-decoration lines"));
    }
    match decoration.style {
        TextDecorationStyle::Solid | TextDecorationStyle::MozNone => {}
        _ => return Err(not_paintable("non-solid text-decoration stroke")),
    }
    let (kind, y) = if lines.underline {
        (RunDecorationKind::UNDERLINE, font_size)
    } else {
        (RunDecorationKind::LINE_THROUGH, font_size * 0.5)
    };
    Ok(Some(RunDecoration {
        kind,
        y,
        thickness: 1.0,
        color: css_color(decoration.color.resolve(style.paint.foreground))?,
    }))
}

/// Spacing is painter-visible (`canvas.letterSpacing`), so only the exact
/// pixel form the whitelist admits reaches here.
fn spacing_px(spacing: LengthPercentage) -> EpubResult<Option<f64>> {
    match spacing {
        LengthPercentage::Length(px) if px.get() != 0.0 => Ok(Some(f64::from(px.get()))),
        LengthPercentage::Length(_) => Ok(None),
        LengthPercentage::Percentage(_) | LengthPercentage::Linear { .. } => {
            Err(not_paintable("non-length letter/word spacing"))
        }
    }
}

/// The `font-family` string painted for a run: the computed stack as-is
/// without a policy, or the policy's rewrite of it (see
/// [`PaintFamilyPolicy`]).
fn paint_family_stack(
    style: &InlineFormattingStyleV1,
    family_policy: Option<&PaintFamilyPolicy>,
) -> EpubResult<String> {
    use rito_style_contract::{FontFamily, FontFamilyNameSyntax, GenericFontFamily};
    let Some(policy) = family_policy else {
        return serialize_font_families(&style.font)
            .map_err(|error| not_paintable(&format!("font family list: {error:?}")));
    };
    let generic_keyword = |generic: GenericFontFamily| -> &'static str {
        match generic {
            GenericFontFamily::Serif => "serif",
            GenericFontFamily::SansSerif => "sans-serif",
            GenericFontFamily::Monospace => "monospace",
            GenericFontFamily::Cursive => "cursive",
            GenericFontFamily::Fantasy => "fantasy",
            GenericFontFamily::SystemUi => "system-ui",
        }
    };
    let mut parts: Vec<String> = Vec::new();
    let mut aliases_added = false;
    for family in style.font.families.iter() {
        match family {
            FontFamily::Named(name) => {
                if !policy
                    .available
                    .contains(&name.as_str().to_ascii_lowercase())
                {
                    continue;
                }
                parts.push(match name.syntax() {
                    FontFamilyNameSyntax::Quoted => format!(
                        "\"{}\"",
                        name.as_str().replace('\\', "\\\\").replace('"', "\\\"")
                    ),
                    FontFamilyNameSyntax::Identifiers => name.as_str().to_owned(),
                });
            }
            FontFamily::Generic(generic) => {
                if !aliases_added {
                    parts.extend(policy.aliases.iter().cloned());
                    aliases_added = true;
                }
                parts.push(generic_keyword(*generic).to_owned());
            }
        }
    }
    if !aliases_added {
        parts.extend(policy.aliases.iter().cloned());
    }
    if parts.is_empty() {
        return Err(not_paintable("an empty rewritten font family stack"));
    }
    Ok(parts.join(", "))
}

fn css_color(color: AbsoluteColor) -> EpubResult<String> {
    absolute_color(color).map_err(|error| not_paintable(&format!("color: {error:?}")))
}

fn not_paintable(what: &str) -> EpubError {
    EpubError::new(format!("{what} is not paintable yet"))
}

#[cfg(test)]
mod tests {
    use super::*;

    use rito_fragment::{
        BoxFragment, FormattingNode, FormattingNodeId, FormattingTreeStyles, FragmentRect,
    };
    use rito_inline::plain_paragraph_style;
    use rito_style_contract::{
        AbsoluteColorSpace, ColorNoneFlags, FontFamilies, FontFamily, FontFamilyName,
        InlineStyleTableV1, LayoutStyleId, LayoutStyleTableV1, StyleId, UnitInterval,
    };

    fn srgb(red: f32, green: f32, blue: f32, alpha: f32) -> AbsoluteColor {
        AbsoluteColor::new(
            AbsoluteColorSpace::Srgb,
            [red, green, blue],
            alpha,
            ColorNoneFlags::new(false, false, false, false),
        )
        .expect("test color is finite")
    }

    fn body_style(foreground: AbsoluteColor) -> InlineFormattingStyleV1 {
        let families = FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Tinos"))])
            .expect("family list is non-empty");
        let mut style = plain_paragraph_style(families, 16.0, 0.0);
        style.paint.foreground = foreground;
        style.paint.background = srgb(0.0, 0.0, 0.0, 0.0).into();
        style
    }

    struct FlowFixture {
        tree: FormattingTree,
    }

    /// Two-item flow — "Red " in red then "black." in black — so tests can
    /// exercise per-item paint boundaries inside one line.
    fn two_color_flow(build: impl FnOnce(StyleId, StyleId) -> Vec<InlineItem>) -> FlowFixture {
        let mut inline = InlineStyleTableV1::new(2);
        let red = inline
            .intern_for_node(0, body_style(srgb(1.0, 0.0, 0.0, 1.0)))
            .expect("red style interns");
        let black = inline
            .intern_for_node(1, body_style(srgb(0.0, 0.0, 0.0, 1.0)))
            .expect("black style interns");
        let items = build(red, black);
        let nodes = vec![FormattingNode {
            style: LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow { items },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("tree builds");
        FlowFixture { tree }
    }

    fn text_item(text: &str, style: StyleId, shift: f64) -> InlineItem {
        InlineItem::Text {
            text: text.to_owned(),
            style,
            baseline_shift_px: shift,
            ruby_annotation: None,
        }
    }

    fn text_run(x: f64, width: f64, start: u32, end: u32) -> Fragment {
        Fragment::Text(TextFragment {
            source: FormattingNodeId(0),
            rect: FragmentRect {
                x,
                y: 0.0,
                width,
                height: 0.0,
            },
            text_start: start,
            text_end: end,
        })
    }

    fn boxed_line(children: Vec<Fragment>) -> Fragment {
        Fragment::Box(BoxFragment {
            source: FormattingNodeId(0),
            rect: FragmentRect {
                x: 10.0,
                y: 20.0,
                width: 100.0,
                height: 20.0,
            },
            children: vec![Fragment::Line(LineFragment {
                source: FormattingNodeId(0),
                rect: FragmentRect {
                    x: 4.0,
                    y: 6.0,
                    width: 70.0,
                    height: 20.0,
                },
                baseline: 13.0,
                trailing_whitespace: 0.0,
                children,
            })],
        })
    }

    fn paint(tree: &FormattingTree, root: &Fragment) -> Vec<DisplayCommand> {
        let mut commands = Vec::new();
        append_fragment_display_commands(
            &mut commands,
            tree,
            root,
            0.0,
            0.0,
            FragmentPaintContext::default(),
        )
        .expect("fragments paint");
        commands
    }

    #[test]
    fn adjacent_items_paint_with_their_own_styles() {
        let fixture = two_color_flow(|red, black| {
            vec![text_item("Red ", red, 0.0), text_item("black.", black, 0.0)]
        });
        let root = boxed_line(vec![text_run(0.0, 30.0, 0, 4), text_run(30.0, 40.0, 4, 10)]);
        let commands = paint(&fixture.tree, &root);
        assert_eq!(commands.len(), 2);
        let DisplayCommand::PaintText(first) = &commands[0] else {
            panic!("expected a text command, got {:?}", commands[0]);
        };
        assert_eq!(first.text, Value::String("Red ".to_owned()));
        assert_eq!(first.paint.color(), "#ff0000");
        assert_eq!(first.paint.measure().font.family, "Tinos");
        // Line top is 20 + 6 = 26; the paint rect starts one canvas-'top'
        // ascent (0.8 × 16px) above the 13px baseline.
        assert_eq!(first.rect, rect_value(14.0, 26.2, 30.0, 16.0));
        assert_eq!(first.line_height_px, Some(number_value(20.0)));
        let DisplayCommand::PaintText(second) = &commands[1] else {
            panic!("expected a text command, got {:?}", commands[1]);
        };
        assert_eq!(second.text, Value::String("black.".to_owned()));
        assert_eq!(second.paint.color(), "#000000");
        assert_eq!(second.rect, rect_value(44.0, 26.2, 40.0, 16.0));
    }

    #[test]
    fn baseline_shift_raises_the_paint_anchor() {
        let fixture = two_color_flow(|red, _| vec![text_item("2", red, 4.0)]);
        let root = boxed_line(vec![text_run(0.0, 8.0, 0, 1)]);
        let commands = paint(&fixture.tree, &root);
        let DisplayCommand::PaintText(command) = &commands[0] else {
            panic!("expected a text command, got {:?}", commands[0]);
        };
        assert_eq!(command.rect, rect_value(14.0, 22.2, 8.0, 16.0));
    }

    #[test]
    fn rule_paints_stroke_across_its_sized_box() {
        let fixture = two_color_flow(|red, _| vec![text_item("x", red, 0.0)]);
        let rule = Fragment::Box(BoxFragment {
            source: FormattingNodeId(0),
            rect: FragmentRect {
                x: 3.0,
                y: 7.0,
                width: 90.0,
                height: 2.0,
            },
            children: Vec::new(),
        });
        let root = Fragment::Box(BoxFragment {
            source: FormattingNodeId(0),
            rect: FragmentRect {
                x: 10.0,
                y: 20.0,
                width: 100.0,
                height: 30.0,
            },
            children: vec![rule],
        });
        let mut paints = std::collections::BTreeMap::new();
        paints.insert(
            0u32,
            NodePaint::Rule {
                color: "#445566".to_owned(),
                style: "solid",
            },
        );
        let mut commands = Vec::new();
        append_fragment_display_commands(
            &mut commands,
            &fixture.tree,
            &root,
            0.0,
            0.0,
            FragmentPaintContext {
                family_policy: None,
                node_paints: Some(&paints),
            },
        )
        .expect("rule paints");
        // Both boxes share source node 0 in this fixture, so the outer box
        // also strokes; the inner rule is the second command.
        let DisplayCommand::PaintHorizontalRule { rect, paint } = &commands[1] else {
            panic!("expected a rule command, got {:?}", commands[1]);
        };
        assert_eq!(*rect, rect_value(13.0, 27.0, 90.0, 2.0));
        assert_eq!(paint["color"], "#445566");
        assert_eq!(paint["style"], "solid");
    }

    #[test]
    fn the_family_policy_drops_unresolvable_families_and_appends_aliases() {
        let fixture = two_color_flow(|red, _| vec![text_item("x", red, 0.0)]);
        let root = boxed_line(vec![text_run(0.0, 8.0, 0, 1)]);
        let policy = PaintFamilyPolicy {
            available: ["tinos".to_owned()].into_iter().collect(),
            aliases: vec!["__RitoPinned_test".to_owned()],
        };
        let mut commands = Vec::new();
        append_fragment_display_commands(
            &mut commands,
            &fixture.tree,
            &root,
            0.0,
            0.0,
            FragmentPaintContext {
                family_policy: Some(&policy),
                node_paints: None,
            },
        )
        .expect("fragments paint");
        let DisplayCommand::PaintText(command) = &commands[0] else {
            panic!("expected a text command, got {:?}", commands[0]);
        };
        // The fixture stack is just "Tinos" with no generic, so the alias
        // lands at the end; a host-only family would have been dropped.
        assert_eq!(
            command.paint.measure().font.family,
            "Tinos, __RitoPinned_test"
        );
    }

    #[test]
    fn ruby_bases_paint_their_annotation_above_the_run() {
        let fixture = two_color_flow(|red, _| {
            vec![InlineItem::Text {
                text: "漢字".to_owned(),
                style: red,
                baseline_shift_px: 0.0,
                ruby_annotation: Some("かんじ".to_owned()),
            }]
        });
        let root = boxed_line(vec![text_run(0.0, 32.0, 0, 6)]);
        let commands = paint(&fixture.tree, &root);
        assert_eq!(commands.len(), 2);
        let DisplayCommand::PaintRuby(annotation) = &commands[0] else {
            panic!("annotation paints before its base, got {:?}", commands[0]);
        };
        assert_eq!(annotation.text, Value::String("かんじ".to_owned()));
        // The base anchors at 26.2 (line top 26 + baseline 13 − 0.8 × 16);
        // the 8px annotation sits one pixel above that anchor, spanning
        // the base run's extent for centered rendering.
        assert_eq!(annotation.rect, rect_value(14.0, 17.2, 32.0, 8.0));
        assert_eq!(annotation.paint.measure().font.size_px, 8.0);
        assert_eq!(annotation.paint.color(), "#ff0000");
        let DisplayCommand::PaintText(base) = &commands[1] else {
            panic!("expected the base text command, got {:?}", commands[1]);
        };
        assert_eq!(base.text, Value::String("漢字".to_owned()));
        assert_eq!(base.rect, rect_value(14.0, 26.2, 32.0, 16.0));
    }

    #[test]
    fn images_paint_with_their_source_reference() {
        use rito_style_contract::{
            AlignItemsV1, BoxSizingV1, ClearV1, CssPx, FloatV1, JustifyContentV1,
            LayoutDisplayInsideV1, LayoutDisplayOutsideV1, LayoutDisplayV1,
            LayoutFormattingStyleV1, LengthPercentageOrAuto, ListMarkerStyleV1, MaximumHeightV1,
            MaximumSizeV1, MinimumHeightV1, NonNegativeLengthPercentage, OverflowV1, PageBreakV1,
            PhysicalSides, PositionV1, PreferredSizeV1,
        };
        let mut inline = InlineStyleTableV1::new(1);
        let text_style = inline
            .intern_for_node(0, body_style(srgb(0.0, 0.0, 0.0, 1.0)))
            .expect("style interns");
        let zero_padding = NonNegativeLengthPercentage::new(LengthPercentage::Length(
            CssPx::new(0.0).expect("zero length"),
        ));
        let sides = |value| PhysicalSides {
            top: value,
            right: value,
            bottom: value,
            left: value,
        };
        let mut layout = LayoutStyleTableV1::new(1);
        let image_layout = layout
            .intern_for_node(
                0,
                LayoutFormattingStyleV1 {
                    display: LayoutDisplayV1 {
                        outside: LayoutDisplayOutsideV1::Inline,
                        inside: LayoutDisplayInsideV1::Flow,
                        is_list_item: false,
                    },
                    margin: sides(LengthPercentageOrAuto::Auto),
                    padding: PhysicalSides {
                        top: zero_padding,
                        right: zero_padding,
                        bottom: zero_padding,
                        left: zero_padding,
                    },
                    box_sizing: BoxSizingV1::ContentBox,
                    justify_content: JustifyContentV1::Normal,
                    align_items: AlignItemsV1::Normal,
                    break_before: PageBreakV1::Auto,
                    break_after: PageBreakV1::Auto,
                    width: PreferredSizeV1::Auto,
                    height: PreferredSizeV1::Auto,
                    max_width: MaximumSizeV1::None,
                    min_height: MinimumHeightV1::Auto,
                    max_height: MaximumHeightV1::None,
                    clear: ClearV1::None,
                    float: FloatV1::None,
                    overflow: OverflowV1::Visible,
                    list_style_type: ListMarkerStyleV1::None,
                    position: PositionV1::Static,
                    inset: sides(LengthPercentageOrAuto::Auto),
                },
            )
            .expect("layout style interns");
        let nodes = vec![FormattingNode {
            style: LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![InlineItem::Image {
                    src: "images/portrait.png".to_owned(),
                    intrinsic_width: 40.0,
                    intrinsic_height: 30.0,
                    style: text_style,
                    layout_style: image_layout,
                    baseline_shift_px: 0.0,
                }],
            },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            FormattingTreeStyles { layout, inline },
        )
        .expect("tree builds");
        let root = boxed_line(vec![Fragment::Image(ImageFragment {
            source: FormattingNodeId(0),
            rect: FragmentRect {
                x: 5.0,
                y: 2.0,
                width: 40.0,
                height: 30.0,
            },
            item_index: 0,
        })]);
        let commands = paint(&tree, &root);
        assert_eq!(commands.len(), 1);
        let DisplayCommand::PaintImage { src, rect, .. } = &commands[0] else {
            panic!("expected an image command, got {:?}", commands[0]);
        };
        assert_eq!(src, "images/portrait.png");
        assert_eq!(*rect, rect_value(19.0, 28.0, 40.0, 30.0));
    }

    #[test]
    fn a_text_run_crossing_item_boundaries_fails_closed() {
        let fixture = two_color_flow(|red, black| {
            vec![text_item("Red ", red, 0.0), text_item("black.", black, 0.0)]
        });
        let root = boxed_line(vec![text_run(0.0, 60.0, 2, 8)]);
        let mut commands = Vec::new();
        let error = append_fragment_display_commands(
            &mut commands,
            &fixture.tree,
            &root,
            0.0,
            0.0,
            FragmentPaintContext::default(),
        )
        .expect_err("a run straddling two items must not paint");
        assert!(
            error
                .to_string()
                .contains("do not lie inside one inline item"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn unsupported_pure_paint_fails_closed_by_name() {
        let mut inline = InlineStyleTableV1::new(1);
        let mut style = body_style(srgb(0.0, 0.0, 0.0, 1.0));
        style.paint.opacity = UnitInterval::new(0.5).expect("opacity is bounded");
        let translucent = inline.intern_for_node(0, style).expect("style interns");
        let nodes = vec![FormattingNode {
            style: LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![text_item("dim", translucent, 0.0)],
            },
            children: Vec::new(),
        }];
        let tree = FormattingTree::with_styles(
            nodes,
            FormattingNodeId(0),
            FormattingTreeStyles {
                layout: LayoutStyleTableV1::new(0),
                inline,
            },
        )
        .expect("tree builds");
        let root = boxed_line(vec![text_run(0.0, 20.0, 0, 3)]);
        let mut commands = Vec::new();
        let error = append_fragment_display_commands(
            &mut commands,
            &tree,
            &root,
            0.0,
            0.0,
            FragmentPaintContext::default(),
        )
        .expect_err("translucent ink must not silently flatten");
        assert!(
            error.to_string().contains("inline opacity"),
            "unexpected error: {error}"
        );
    }
}

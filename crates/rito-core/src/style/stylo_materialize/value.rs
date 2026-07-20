use rito_style_contract::{
    AbsoluteColor, AbsoluteColorSpace, AlignItemsV1, AlignmentBaseline, BaselineShift,
    BaselineSource, BorderEdge, BorderRadii, BorderStyle, ClearV1, ComputedColorV1, Direction,
    FloatV1, FontFamily, FontFamilyNameSyntax, FontSlant, GenericFontFamily,
    InlineFormattingStyleV1, JustifyContentV1, LayoutDisplayInsideV1, LayoutDisplayOutsideV1,
    LayoutFormattingStyleV1, LengthPercentage, LengthPercentageOrAuto, LineBreak, LineHeight,
    ListMarkerStyleV1, MaximumHeightV1, MaximumSizeV1, MinimumHeightV1, OverflowV1, OverflowWrap,
    PageBreakV1, PhysicalSides, PreferredSizeV1, TextAlign, TextDecorationStyle, TextJustify,
    TextTransformCase, TextWrapMode, UnicodeBidi, WhiteSpaceCollapse, WordBreak, WritingMode,
};
use serde_json::{json, Map, Value};

use super::background::{materialize_background_image, BackgroundMaterializeError};
use super::transform::materialize_transform;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MaterializeField {
    Display,
    JustifyContent,
    AlignItems,
    FontFamily,
    LetterSpacing,
    WordSpacing,
    TextIndent,
    WhiteSpace,
    LineBreak,
    TextTransform,
    Bidi,
    Margin,
    FlexItemMargin,
    Padding,
    BorderRadius,
    VerticalAlign,
    TextDecoration,
    Width,
    Height,
    MaxWidth,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MaterializeValueError {
    UnsupportedConsumerValue { field: MaterializeField },
    LinearLengthNotSupported { field: MaterializeField },
    PercentageNotSupported { field: MaterializeField },
    NonSrgbColor,
    MissingColorComponent,
    OutOfGamutSrgb,
    Background(BackgroundMaterializeError),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum LayoutMaterializationMode {
    FlowOnly,
    /// Exact bounded flex subset: row, nowrap, one image, and centered on both
    /// axes inside a positive absolute-height block flex container.
    SingleImageCenteredFlex,
}

impl From<BackgroundMaterializeError> for MaterializeValueError {
    fn from(value: BackgroundMaterializeError) -> Self {
        Self::Background(value)
    }
}

type Result<T> = std::result::Result<T, MaterializeValueError>;

pub(super) fn materialize_style(
    inline: &InlineFormattingStyleV1,
    layout: &LayoutFormattingStyleV1,
    layout_mode: LayoutMaterializationMode,
    parent_style: &Map<String, Value>,
) -> Result<Map<String, Value>> {
    let mut output = Map::new();
    materialize_font(&mut output, inline, parent_style)?;
    materialize_text_flow(&mut output, inline)?;
    materialize_fragment(&mut output, inline)?;
    materialize_paint(&mut output, inline)?;
    materialize_layout(&mut output, layout, layout_mode)?;
    Ok(output)
}

pub(super) fn display_is_none(style: &LayoutFormattingStyleV1) -> bool {
    style.display.outside == LayoutDisplayOutsideV1::None
}

pub(super) fn is_transparent(color: AbsoluteColor) -> bool {
    color.alpha().get() == 0.0
}

fn materialize_font(
    output: &mut Map<String, Value>,
    style: &InlineFormattingStyleV1,
    parent_style: &Map<String, Value>,
) -> Result<()> {
    let inherited_line_height = parent_style
        .get("lineHeight")
        .and_then(Value::as_f64)
        .unwrap_or(1.2);
    let font = &style.font;
    insert_string(output, "fontFamily", serialize_font_families(font)?);
    insert_number(output, "fontSize", font.size.get());
    insert_number(output, "fontWeight", font.weight.get());
    insert_string(
        output,
        "fontStyle",
        match font.slant {
            FontSlant::Normal => "normal",
            FontSlant::Italic | FontSlant::Oblique(_) => "italic",
        },
    );
    match font.line_height {
        // The legacy resolver could not parse `normal`, so an explicit or
        // default `normal` keeps the inherited ratio (1.2 at the root).
        LineHeight::Normal => insert_number(output, "lineHeight", inherited_line_height),
        LineHeight::Number(value) => insert_number(output, "lineHeight", value.get()),
        LineHeight::Length(value) => {
            // Compatibility policy: the retired resolver inherited
            // line-height as a *ratio* and re-resolved the pixels against
            // each element's own font size, where CSS inherits the computed
            // length unchanged. Reproducing the consumer contract therefore
            // needs both halves of that rule, and telling a declaration from
            // an inherited value is impossible from computed values alone —
            // the projection reports whether the cascade declared it here.
            let ratio = if font.line_height_is_declared {
                f64::from(value.get() / font.size.get())
            } else {
                inherited_line_height
            };
            insert_number(output, "lineHeight", ratio);
            insert_number(output, "lineHeightPx", ratio * f64::from(font.size.get()));
        }
    }
    Ok(())
}

fn serialize_font_families(style: &rito_style_contract::FontStyleV1) -> Result<String> {
    if style.families.as_slice().is_empty() {
        return Err(unsupported(MaterializeField::FontFamily));
    }
    Ok(style
        .families
        .iter()
        .map(|family| match family {
            FontFamily::Named(name) => match name.syntax() {
                FontFamilyNameSyntax::Quoted => quote_family(name.as_str()),
                FontFamilyNameSyntax::Identifiers => name.as_str().to_owned(),
            },
            FontFamily::Generic(generic) => generic_family(*generic).to_owned(),
        })
        .collect::<Vec<_>>()
        .join(", "))
}

fn quote_family(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

fn generic_family(value: GenericFontFamily) -> &'static str {
    match value {
        GenericFontFamily::Serif => "serif",
        GenericFontFamily::SansSerif => "sans-serif",
        GenericFontFamily::Monospace => "monospace",
        GenericFontFamily::Cursive => "cursive",
        GenericFontFamily::Fantasy => "fantasy",
        GenericFontFamily::SystemUi => "system-ui",
    }
}

fn materialize_text_flow(
    output: &mut Map<String, Value>,
    style: &InlineFormattingStyleV1,
) -> Result<()> {
    materialize_bidi(style)?;
    let text = &style.text_flow;
    insert_string(output, "textAlign", text_align(text.text_align));
    insert_string(output, "textJustify", text_justify(text.text_justify));
    insert_string(output, "textTransform", text_transform(text)?);
    insert_string(output, "whiteSpace", white_space(text)?);
    insert_string(
        output,
        "wordBreak",
        word_break(text.word_break, text.overflow_wrap),
    );
    insert_string(output, "lineBreak", line_break(text.line_break)?);
    insert_number(
        output,
        "letterSpacing",
        absolute_length(text.letter_spacing, MaterializeField::LetterSpacing)?,
    );
    insert_number(
        output,
        "wordSpacing",
        absolute_length(text.word_spacing, MaterializeField::WordSpacing)?,
    );
    if text.text_indent.hanging || text.text_indent.each_line {
        return Err(unsupported(MaterializeField::TextIndent));
    }
    insert_number(
        output,
        "textIndent",
        absolute_length(text.text_indent.value, MaterializeField::TextIndent)?,
    );
    insert_string(
        output,
        "language",
        text.language
            .as_ref()
            .map_or("und", |language| language.as_str()),
    );
    Ok(())
}

fn materialize_bidi(style: &InlineFormattingStyleV1) -> Result<()> {
    if style.bidi.direction != Direction::LeftToRight
        || style.bidi.unicode_bidi != UnicodeBidi::Normal
        || style.bidi.writing_mode != WritingMode::HorizontalTopToBottom
    {
        return Err(unsupported(MaterializeField::Bidi));
    }
    Ok(())
}

fn text_align(value: TextAlign) -> &'static str {
    match value {
        TextAlign::Start | TextAlign::Left | TextAlign::MozLeft => "left",
        TextAlign::Right | TextAlign::End | TextAlign::MozRight => "right",
        TextAlign::Center | TextAlign::MozCenter => "center",
        TextAlign::Justify => "justify",
    }
}

fn text_justify(value: TextJustify) -> &'static str {
    match value {
        TextJustify::Auto => "auto",
        TextJustify::None => "none",
        TextJustify::InterWord => "inter-word",
        TextJustify::InterCharacter => "inter-character",
    }
}

fn text_transform(style: &rito_style_contract::InlineTextFlowV1) -> Result<&'static str> {
    if style.text_transform.full_width || style.text_transform.full_size_kana {
        return Err(unsupported(MaterializeField::TextTransform));
    }
    Ok(match style.text_transform.case {
        TextTransformCase::None => "none",
        TextTransformCase::Uppercase => "uppercase",
        TextTransformCase::Lowercase => "lowercase",
        TextTransformCase::Capitalize => "capitalize",
    })
}

fn white_space(style: &rito_style_contract::InlineTextFlowV1) -> Result<&'static str> {
    match (style.white_space_collapse, style.text_wrap_mode) {
        (WhiteSpaceCollapse::Collapse, TextWrapMode::Wrap) => Ok("normal"),
        (WhiteSpaceCollapse::Collapse, TextWrapMode::NoWrap) => Ok("nowrap"),
        (WhiteSpaceCollapse::Preserve, TextWrapMode::NoWrap) => Ok("pre"),
        (WhiteSpaceCollapse::Preserve, TextWrapMode::Wrap) => Ok("pre-wrap"),
        (WhiteSpaceCollapse::PreserveBreaks | WhiteSpaceCollapse::BreakSpaces, _) => {
            Err(unsupported(MaterializeField::WhiteSpace))
        }
    }
}

fn word_break(value: WordBreak, overflow: OverflowWrap) -> &'static str {
    match (value, overflow) {
        (WordBreak::Normal, OverflowWrap::Normal) => "normal",
        // Rito's line breaker has a distinct emergency-only `break-word`
        // policy. For the current consumer, `anywhere` has the same used-line
        // behavior because min-content sizing is not represented.
        (WordBreak::Normal, OverflowWrap::BreakWord | OverflowWrap::Anywhere) => "break-word",
        (WordBreak::BreakAll, _) => "break-all",
        (WordBreak::KeepAll, _) => "keep-all",
    }
}

fn line_break(value: LineBreak) -> Result<&'static str> {
    match value {
        LineBreak::Auto => Ok("auto"),
        LineBreak::Normal => Ok("normal"),
        LineBreak::Strict => Ok("strict"),
        LineBreak::Loose | LineBreak::Anywhere => Err(unsupported(MaterializeField::LineBreak)),
    }
}

fn materialize_fragment(
    output: &mut Map<String, Value>,
    style: &InlineFormattingStyleV1,
) -> Result<()> {
    materialize_margins(output, style.fragment.margin)?;
    materialize_non_negative_sides(output, "padding", style.fragment.padding)?;
    materialize_border(output, style)?;
    materialize_radius(output, style.fragment.border_radii)?;
    insert_string(output, "verticalAlign", vertical_align(style)?);
    Ok(())
}

fn materialize_margins(
    output: &mut Map<String, Value>,
    sides: PhysicalSides<LengthPercentageOrAuto>,
) -> Result<()> {
    materialize_margin_side(output, "marginTop", "marginTopPct", sides.top, false)?;
    materialize_margin_side(output, "marginRight", "marginRightPct", sides.right, true)?;
    materialize_margin_side(
        output,
        "marginBottom",
        "marginBottomPct",
        sides.bottom,
        false,
    )?;
    materialize_margin_side(output, "marginLeft", "marginLeftPct", sides.left, true)?;
    Ok(())
}

fn materialize_margin_side(
    output: &mut Map<String, Value>,
    key: &str,
    pct_key: &str,
    value: LengthPercentageOrAuto,
    horizontal: bool,
) -> Result<()> {
    let auto_key = format!("{key}Auto");
    match value {
        LengthPercentageOrAuto::Auto => {
            insert_number(output, key, 0.0);
            if horizontal {
                output.insert(auto_key, Value::Bool(true));
            }
        }
        LengthPercentageOrAuto::Value(value) => {
            materialize_length_percentage(output, key, pct_key, value, MaterializeField::Margin)?;
            if horizontal {
                output.insert(auto_key, Value::Bool(false));
            }
        }
    }
    Ok(())
}

fn materialize_non_negative_sides(
    output: &mut Map<String, Value>,
    prefix: &str,
    sides: PhysicalSides<rito_style_contract::NonNegativeLengthPercentage>,
) -> Result<()> {
    for (suffix, value) in [
        ("Top", sides.top),
        ("Right", sides.right),
        ("Bottom", sides.bottom),
        ("Left", sides.left),
    ] {
        materialize_length_percentage(
            output,
            &format!("{prefix}{suffix}"),
            &format!("{prefix}{suffix}Pct"),
            value.value(),
            MaterializeField::Padding,
        )?;
    }
    Ok(())
}

fn materialize_border(
    output: &mut Map<String, Value>,
    style: &InlineFormattingStyleV1,
) -> Result<()> {
    let foreground = style.paint.foreground;
    for (key, edge) in [
        ("borderTop", style.fragment.border.top),
        ("borderRight", style.fragment.border.right),
        ("borderBottom", style.fragment.border.bottom),
        ("borderLeft", style.fragment.border.left),
    ] {
        output.insert(key.to_owned(), border_edge(edge, foreground)?);
    }
    Ok(())
}

fn border_edge(edge: BorderEdge, foreground: AbsoluteColor) -> Result<Value> {
    let style = match edge.style {
        BorderStyle::None | BorderStyle::Hidden => "none",
        BorderStyle::Dotted => "dotted",
        BorderStyle::Dashed => "dashed",
        BorderStyle::Solid => "solid",
        // The current Canvas paint contract has no 3D/double border
        // primitives. Preserve computed width and color and use the same
        // solid-line compatibility used by the retired parser for
        // double/groove/ridge; inset/outset receive that stable fallback too.
        BorderStyle::Double
        | BorderStyle::Groove
        | BorderStyle::Ridge
        | BorderStyle::Inset
        | BorderStyle::Outset => "solid",
    };
    Ok(json!({
        "width": snap_f32_decimal(f64::from(edge.resolved_width.get())),
        "style": style,
        "color": color(edge.color, foreground)?,
    }))
}

fn materialize_radius(output: &mut Map<String, Value>, radii: BorderRadii) -> Result<()> {
    // The current layout/paint consumer has one uniform radius slot. Its
    // retired parser consumed only the first component of `border-radius`.
    // The source gate therefore admits that shorthand but rejects every
    // corner longhand; Stylo's top-left horizontal value is exactly the first
    // shorthand component. Preserve that explicit compatibility contract
    // until BlockPaint grows lossless four-corner radii.
    let first = radii.top_left;
    match first.horizontal.value() {
        LengthPercentage::Length(value) => insert_number(output, "borderRadius", value.get()),
        LengthPercentage::Percentage(value) => {
            insert_number(output, "borderRadiusPct", value.percent())
        }
        LengthPercentage::Linear { .. } => {
            return Err(MaterializeValueError::LinearLengthNotSupported {
                field: MaterializeField::BorderRadius,
            });
        }
    }
    Ok(())
}

fn vertical_align(style: &InlineFormattingStyleV1) -> Result<&'static str> {
    let fragment = &style.fragment;
    if fragment.baseline_source != BaselineSource::Auto {
        return Err(unsupported(MaterializeField::VerticalAlign));
    }
    match fragment.baseline_shift {
        BaselineShift::Sub => Ok("sub"),
        BaselineShift::Super => Ok("super"),
        BaselineShift::Top => Ok("top"),
        BaselineShift::Center => Ok("middle"),
        BaselineShift::Bottom => Ok("bottom"),
        BaselineShift::Offset(value) if is_zero_length(value) => {
            match fragment.alignment_baseline {
                AlignmentBaseline::Baseline | AlignmentBaseline::Alphabetic => Ok("baseline"),
                AlignmentBaseline::TextBottom => Ok("text-bottom"),
                AlignmentBaseline::Middle | AlignmentBaseline::Central => Ok("middle"),
                AlignmentBaseline::TextTop => Ok("text-top"),
                AlignmentBaseline::Ideographic
                | AlignmentBaseline::Mathematical
                | AlignmentBaseline::Hanging => Err(unsupported(MaterializeField::VerticalAlign)),
            }
        }
        BaselineShift::Offset(_) => Err(unsupported(MaterializeField::VerticalAlign)),
    }
}

fn is_zero_length(value: LengthPercentage) -> bool {
    match value {
        LengthPercentage::Length(value) => value.get() == 0.0,
        LengthPercentage::Percentage(value) => value.ratio() == 0.0,
        LengthPercentage::Linear { length, percentage } => {
            length.get() == 0.0 && percentage.ratio() == 0.0
        }
    }
}

fn materialize_paint(
    output: &mut Map<String, Value>,
    style: &InlineFormattingStyleV1,
) -> Result<()> {
    let foreground = style.paint.foreground;
    insert_string(output, "color", absolute_color(foreground)?);
    insert_number(output, "opacity", style.paint.opacity.get());
    insert_string(
        output,
        "backgroundColor",
        background_color(style.paint.background, foreground)?,
    );
    materialize_background_image(output, style.paint.background_image.as_ref())?;
    materialize_transform(output, &style.paint.transform);
    insert_string(output, "textDecoration", text_decoration(style)?);
    output.insert(
        "textShadow".to_owned(),
        Value::Array(
            style
                .paint
                .text_shadows
                .iter()
                .map(|shadow| {
                    Ok(json!({
                        "offsetX": snap_f32_decimal(f64::from(shadow.offset_x.get())),
                        "offsetY": snap_f32_decimal(f64::from(shadow.offset_y.get())),
                        "blur": snap_f32_decimal(f64::from(shadow.blur_radius.get())),
                        "color": color(shadow.color, foreground)?,
                    }))
                })
                .collect::<Result<Vec<_>>>()?,
        ),
    );
    output.insert(
        "boxShadow".to_owned(),
        Value::Array(
            style
                .paint
                .box_shadows
                .iter()
                .map(|shadow| {
                    Ok(json!({
                        "offsetX": snap_f32_decimal(f64::from(shadow.offset_x.get())),
                        "offsetY": snap_f32_decimal(f64::from(shadow.offset_y.get())),
                        "blur": snap_f32_decimal(f64::from(shadow.blur_radius.get())),
                        "spread": snap_f32_decimal(f64::from(shadow.spread_radius.get())),
                        "color": color(shadow.color, foreground)?,
                        "inset": shadow.inset,
                    }))
                })
                .collect::<Result<Vec<_>>>()?,
        ),
    );
    Ok(())
}

fn text_decoration(style: &InlineFormattingStyleV1) -> Result<&'static str> {
    let decoration = style.paint.text_decoration;
    if decoration.lines.is_empty() {
        return Ok("none");
    }
    if decoration.style != TextDecorationStyle::Solid
        || color(decoration.color, style.paint.foreground)?
            != absolute_color(style.paint.foreground)?
        || decoration.lines.blink
        || decoration.lines.overline
    {
        return Err(unsupported(MaterializeField::TextDecoration));
    }
    match (decoration.lines.underline, decoration.lines.line_through) {
        (true, false) => Ok("underline"),
        (false, true) => Ok("line-through"),
        (true, true) | (false, false) => Err(unsupported(MaterializeField::TextDecoration)),
    }
}

fn materialize_layout(
    output: &mut Map<String, Value>,
    style: &LayoutFormattingStyleV1,
    layout_mode: LayoutMaterializationMode,
) -> Result<()> {
    insert_string(output, "display", display(style, layout_mode)?);
    if layout_mode == LayoutMaterializationMode::SingleImageCenteredFlex {
        if style.justify_content != JustifyContentV1::Center {
            return Err(unsupported(MaterializeField::JustifyContent));
        }
        if style.align_items != AlignItemsV1::Center {
            return Err(unsupported(MaterializeField::AlignItems));
        }
        insert_string(output, "justifyContent", "center");
        insert_string(output, "alignItems", "center");
        insert_string(output, "flexDirection", "row");
        insert_string(output, "flexWrap", "nowrap");
    }
    materialize_size(output, "width", "widthPct", style.width, true)?;
    materialize_size(output, "height", "heightPct", style.height, false)?;
    materialize_max_width(output, style.max_width)?;
    materialize_min_height(output, style.min_height);
    materialize_max_height(output, style.max_height);
    insert_string(output, "clear", clear(style.clear));
    insert_string(output, "float", float(style.float));
    // The legacy resolver materialized an `objectFit` default on every
    // element; images override it with their replaced-element policy.
    insert_string(output, "objectFit", "fill");
    insert_string(output, "overflow", overflow(style.overflow));
    insert_string(output, "pageBreakBefore", page_break(style.break_before));
    insert_string(output, "pageBreakAfter", page_break(style.break_after));
    insert_string(
        output,
        "listStyleType",
        list_style_type(style.list_style_type),
    );
    Ok(())
}

fn materialize_min_height(output: &mut Map<String, Value>, value: MinimumHeightV1) {
    match value {
        MinimumHeightV1::Length(value) => insert_number(output, "minHeight", value.get()),
        MinimumHeightV1::Auto => {}
        // Compatibility policy: the current consumer has no percentage-height
        // basis here, and the legacy parser deliberately omitted this field.
        // Preserve the computed percentage in the contract without pretending
        // it is `auto` or writing an incorrect absolute constraint.
        MinimumHeightV1::Percentage(_) => {}
    }
}

fn materialize_max_height(output: &mut Map<String, Value>, value: MaximumHeightV1) {
    match value {
        MaximumHeightV1::Length(value) => insert_number(output, "maxHeight", value.get()),
        MaximumHeightV1::None => {}
        // See `materialize_min_height`: omission is the explicit legacy
        // compatibility policy until the consumer can resolve a height basis.
        MaximumHeightV1::Percentage(_) => {}
    }
}

fn materialize_max_width(output: &mut Map<String, Value>, value: MaximumSizeV1) -> Result<()> {
    match value {
        MaximumSizeV1::None => insert_number(output, "maxWidth", 0.0),
        MaximumSizeV1::Value(value) => match value.value() {
            LengthPercentage::Length(value) => insert_number(output, "maxWidth", value.get()),
            LengthPercentage::Percentage(value) if value.ratio() == 0.0 => {
                insert_number(output, "maxWidth", 0.0)
            }
            LengthPercentage::Percentage(value) => {
                insert_number(output, "maxWidthPct", value.percent())
            }
            LengthPercentage::Linear { .. } => {
                return Err(MaterializeValueError::LinearLengthNotSupported {
                    field: MaterializeField::MaxWidth,
                });
            }
        },
    }
    Ok(())
}

fn clear(value: ClearV1) -> &'static str {
    match value {
        ClearV1::None => "none",
        ClearV1::Left => "left",
        ClearV1::Right => "right",
        ClearV1::Both => "both",
    }
}

fn float(value: FloatV1) -> &'static str {
    match value {
        FloatV1::None => "none",
        FloatV1::Left => "left",
        FloatV1::Right => "right",
    }
}

fn overflow(value: OverflowV1) -> &'static str {
    match value {
        OverflowV1::Visible => "visible",
        OverflowV1::Hidden => "hidden",
    }
}

fn page_break(value: PageBreakV1) -> &'static str {
    match value {
        PageBreakV1::Auto => "auto",
        PageBreakV1::Always => "always",
    }
}

fn display(
    style: &LayoutFormattingStyleV1,
    layout_mode: LayoutMaterializationMode,
) -> Result<&'static str> {
    use LayoutDisplayInsideV1 as Inside;
    use LayoutDisplayOutsideV1 as Outside;
    match (style.display.outside, style.display.inside) {
        (Outside::None, _) => Ok("none"),
        (Outside::Block, Inside::Flex)
            if !style.display.is_list_item
                && layout_mode == LayoutMaterializationMode::SingleImageCenteredFlex =>
        {
            Ok("flex")
        }
        (_, Inside::Contents | Inside::Flex | Inside::Grid) => {
            Err(unsupported(MaterializeField::Display))
        }
        (Outside::Inline, Inside::Flow) if !style.display.is_list_item => Ok("inline"),
        (Outside::Inline, Inside::FlowRoot) if !style.display.is_list_item => Ok("inline-block"),
        (Outside::Block, Inside::Flow | Inside::FlowRoot) => Ok("block"),
        (
            Outside::Block | Outside::TableCaption | Outside::InternalTable,
            Inside::Table
            | Inside::TableRowGroup
            | Inside::TableColumn
            | Inside::TableColumnGroup
            | Inside::TableHeaderGroup
            | Inside::TableFooterGroup
            | Inside::TableRow
            | Inside::TableCell,
        ) => Ok("block"),
        _ => Err(unsupported(MaterializeField::Display)),
    }
}

fn materialize_size(
    output: &mut Map<String, Value>,
    key: &str,
    pct_key: &str,
    value: PreferredSizeV1,
    percentage_supported: bool,
) -> Result<()> {
    let field = if key == "width" {
        MaterializeField::Width
    } else {
        MaterializeField::Height
    };
    match value {
        PreferredSizeV1::Auto => insert_number(output, key, 0.0),
        PreferredSizeV1::Value(value) => match value.value() {
            // Compatibility policy: the current consumer has no containing-
            // block height basis, and the retired parser ignored percentage
            // heights. The legacy map kept its zero default for the consumer
            // field until layout can resolve it.
            LengthPercentage::Percentage(_) if !percentage_supported => {
                insert_number(output, key, 0.0);
            }
            value if percentage_supported => {
                materialize_length_percentage(output, key, pct_key, value, field)?
            }
            LengthPercentage::Length(value) => insert_number(output, key, value.get()),
            LengthPercentage::Percentage(_) => {
                return Err(MaterializeValueError::PercentageNotSupported { field });
            }
            LengthPercentage::Linear { .. } => {
                return Err(MaterializeValueError::LinearLengthNotSupported { field });
            }
        },
        PreferredSizeV1::MaxContent
        | PreferredSizeV1::MinContent
        | PreferredSizeV1::FitContent
        | PreferredSizeV1::WebkitFillAvailable
        | PreferredSizeV1::Stretch
        | PreferredSizeV1::FitContentFunction(_) => return Err(unsupported(field)),
    }
    Ok(())
}

fn list_style_type(value: ListMarkerStyleV1) -> &'static str {
    match value {
        ListMarkerStyleV1::None => "none",
        ListMarkerStyleV1::Disc => "disc",
        ListMarkerStyleV1::Circle => "circle",
        ListMarkerStyleV1::Square => "square",
        ListMarkerStyleV1::Decimal => "decimal",
        ListMarkerStyleV1::LowerRoman => "lower-roman",
        ListMarkerStyleV1::UpperRoman => "upper-roman",
        ListMarkerStyleV1::LowerAlpha => "lower-alpha",
        ListMarkerStyleV1::UpperAlpha => "upper-alpha",
    }
}

fn materialize_length_percentage(
    output: &mut Map<String, Value>,
    key: &str,
    pct_key: &str,
    value: LengthPercentage,
    field: MaterializeField,
) -> Result<()> {
    match value {
        LengthPercentage::Length(value) => insert_number(output, key, value.get()),
        LengthPercentage::Percentage(value) => {
            insert_number(output, pct_key, value.percent());
            // The legacy map kept its zero pixel default alongside the
            // percentage helper key.
            insert_number(output, key, 0.0);
        }
        LengthPercentage::Linear { .. } => {
            return Err(MaterializeValueError::LinearLengthNotSupported { field });
        }
    }
    Ok(())
}

fn absolute_length(value: LengthPercentage, field: MaterializeField) -> Result<f32> {
    match value {
        LengthPercentage::Length(value) => Ok(value.get()),
        LengthPercentage::Percentage(value) if value.ratio() == 0.0 => Ok(0.0),
        LengthPercentage::Percentage(_) => {
            Err(MaterializeValueError::PercentageNotSupported { field })
        }
        LengthPercentage::Linear { .. } => {
            Err(MaterializeValueError::LinearLengthNotSupported { field })
        }
    }
}

fn color(value: ComputedColorV1, foreground: AbsoluteColor) -> Result<String> {
    absolute_color(value.resolve(foreground))
}

fn background_color(value: ComputedColorV1, foreground: AbsoluteColor) -> Result<String> {
    let resolved = value.resolve(foreground);
    let serialized = absolute_color(resolved)?;
    if resolved.alpha().get() == 0.0 {
        Ok(String::new())
    } else {
        Ok(serialized)
    }
}

fn absolute_color(value: AbsoluteColor) -> Result<String> {
    if value.space() != AbsoluteColorSpace::Srgb {
        return Err(MaterializeValueError::NonSrgbColor);
    }
    let none = value.none();
    if none.component_0 || none.component_1 || none.component_2 || none.alpha {
        return Err(MaterializeValueError::MissingColorComponent);
    }
    let components = value.components().map(|component| component.get());
    if components
        .iter()
        .any(|component| !(0.0..=1.0).contains(component))
    {
        return Err(MaterializeValueError::OutOfGamutSrgb);
    }
    let [red, green, blue] = components.map(|component| (component * 255.0).round() as u8);
    let alpha = value.alpha().get();
    if alpha == 1.0 {
        Ok(format!("#{red:02x}{green:02x}{blue:02x}"))
    } else {
        Ok(format!("rgba({red}, {green}, {blue}, {alpha})"))
    }
}

fn insert_string(output: &mut Map<String, Value>, key: &str, value: impl Into<String>) {
    output.insert(key.to_owned(), Value::String(value.into()));
}

fn insert_number(output: &mut Map<String, Value>, key: &str, value: impl Into<f64>) {
    output.insert(key.to_owned(), json!(snap_f32_decimal(value.into())));
}

/// Widens an f32-derived scalar through its shortest decimal form.
///
/// Contract scalars are `f32`; a plain widening cast carries binary noise
/// (`19.2f32 as f64 == 19.200000762939453`) that accumulates visibly over a
/// chapter of layout. The retired parser produced `f64` values parsed from
/// the author's decimal text, so snapping through the shortest round-trip
/// representation reproduces its arithmetic exactly.
fn snap_f32_decimal(value: f64) -> f64 {
    (value as f32).to_string().parse().unwrap_or(value)
}

fn unsupported(field: MaterializeField) -> MaterializeValueError {
    MaterializeValueError::UnsupportedConsumerValue { field }
}

#[cfg(test)]
mod tests {
    use rito_style_contract::{CssPx, NonNegativeCssPx, NonNegativeLengthPercentage, Percentage};

    use super::*;

    #[test]
    fn max_width_materializes_only_consumer_exact_values() {
        let mut output = Map::new();
        materialize_max_width(
            &mut output,
            MaximumSizeV1::Value(NonNegativeLengthPercentage::new(
                LengthPercentage::Percentage(Percentage::from_percent(80.0).unwrap()),
            )),
        )
        .unwrap();
        assert_eq!(output.get("maxWidthPct"), Some(&json!(80.0)));
        assert!(!output.contains_key("maxWidth"));

        output.clear();
        materialize_max_width(&mut output, MaximumSizeV1::None).unwrap();
        assert_eq!(output.get("maxWidth"), Some(&json!(0.0)));
        assert!(!output.contains_key("maxWidthPct"));
    }

    #[test]
    fn linear_max_width_fails_closed_at_the_consumer_boundary() {
        let value =
            MaximumSizeV1::Value(NonNegativeLengthPercentage::new(LengthPercentage::linear(
                CssPx::new(12.0).unwrap(),
                Percentage::from_percent(25.0).unwrap(),
            )));

        assert_eq!(
            materialize_max_width(&mut Map::new(), value),
            Err(MaterializeValueError::LinearLengthNotSupported {
                field: MaterializeField::MaxWidth,
            })
        );
    }

    #[test]
    fn physical_clear_values_keep_the_legacy_consumer_spelling() {
        assert_eq!(clear(ClearV1::None), "none");
        assert_eq!(clear(ClearV1::Left), "left");
        assert_eq!(clear(ClearV1::Right), "right");
        assert_eq!(clear(ClearV1::Both), "both");
    }

    #[test]
    fn height_constraints_emit_only_explicit_absolute_lengths() {
        let mut output = Map::new();
        materialize_min_height(&mut output, MinimumHeightV1::Auto);
        materialize_max_height(&mut output, MaximumHeightV1::None);
        materialize_min_height(
            &mut output,
            MinimumHeightV1::Percentage(Percentage::from_percent(25.0).unwrap()),
        );
        materialize_max_height(
            &mut output,
            MaximumHeightV1::Percentage(Percentage::from_percent(100.0).unwrap()),
        );
        assert!(output.is_empty());

        materialize_min_height(
            &mut output,
            MinimumHeightV1::Length(NonNegativeCssPx::new(12.0).unwrap()),
        );
        materialize_max_height(
            &mut output,
            MaximumHeightV1::Length(NonNegativeCssPx::new(120.0).unwrap()),
        );
        assert_eq!(output.get("minHeight"), Some(&json!(12.0)));
        assert_eq!(output.get("maxHeight"), Some(&json!(120.0)));
    }

    #[test]
    fn float_and_overflow_keep_the_consumer_spelling() {
        assert_eq!(float(FloatV1::None), "none");
        assert_eq!(float(FloatV1::Left), "left");
        assert_eq!(float(FloatV1::Right), "right");
        assert_eq!(overflow(OverflowV1::Visible), "visible");
        assert_eq!(overflow(OverflowV1::Hidden), "hidden");
    }
}

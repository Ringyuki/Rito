use crate::{
    layout::{
        create_layout_config, LayoutConfig, LayoutConfigInput, MarginInput, SpreadMode,
        TextMeasurementMode,
    },
    runtime::{
        RuntimeResourceKind, RuntimeSourceLocator, RuntimeSourceLocatorMatchedBy,
        RuntimeSourcePoint, RuntimeSourceRange,
    },
};

use super::{
    ReaderErrorKindV1, ReaderErrorV1, ReaderLayoutV1, ReaderLocatorMatchV1, ReaderLocatorV1,
    ReaderResourceKindV1, ReaderSourcePointV1, ReaderSourceRangeV1, ReaderSpreadModeV1,
};

pub(super) fn layout_config(value: ReaderLayoutV1) -> Result<LayoutConfig, ReaderErrorV1> {
    validate_layout(&value)?;
    let spread = match value.spread_mode {
        ReaderSpreadModeV1::Single => SpreadMode::Single,
        ReaderSpreadModeV1::Double => SpreadMode::Double,
    };
    let force_family = value.font_family_override.is_some();
    Ok(create_layout_config(LayoutConfigInput {
        width: value.viewport_width,
        height: value.viewport_height,
        margin: MarginInput::Sides {
            top: value.margin_top,
            right: value.margin_right,
            bottom: value.margin_bottom,
            left: value.margin_left,
        },
        spread,
        first_page_alone: value.first_page_alone,
        spread_gap: value.spread_gap,
        root_font_size: value.root_font_size,
        line_height_override: value.line_height_override,
        line_height_force: value.line_height_override.map(|_| true),
        font_family_override: value.font_family_override,
        font_family_force: force_family.then_some(true),
        pagination_policy: None,
        // Reader sessions measure text with real font glyphs: the
        // fixture-compatible estimator exists only for legacy TS fixture
        // parity and misplaces real-book line breaks.
        text_measurement: Some(TextMeasurementMode::FontAware),
    }))
}

fn validate_layout(value: &ReaderLayoutV1) -> Result<(), ReaderErrorV1> {
    let positive = [
        ("viewportWidth", value.viewport_width),
        ("viewportHeight", value.viewport_height),
        ("rootFontSize", value.root_font_size),
    ];
    if let Some((name, field)) = positive
        .into_iter()
        .find(|(_, field)| !field.is_finite() || *field <= 0.0)
    {
        return Err(invalid_layout(format!(
            "{name} must be finite and greater than zero, got {field}"
        )));
    }
    let non_negative = [
        ("marginTop", value.margin_top),
        ("marginRight", value.margin_right),
        ("marginBottom", value.margin_bottom),
        ("marginLeft", value.margin_left),
        ("spreadGap", value.spread_gap),
    ];
    if let Some((name, field)) = non_negative
        .into_iter()
        .find(|(_, field)| !field.is_finite() || *field < 0.0)
    {
        return Err(invalid_layout(format!(
            "{name} must be finite and non-negative, got {field}"
        )));
    }
    if value.margin_left + value.margin_right >= value.viewport_width
        || value.margin_top + value.margin_bottom >= value.viewport_height
    {
        return Err(invalid_layout("margins must leave a positive content box"));
    }
    if value
        .line_height_override
        .is_some_and(|line_height| !line_height.is_finite() || line_height < 0.0)
    {
        return Err(invalid_layout(
            "lineHeightOverride must be finite and non-negative",
        ));
    }
    Ok(())
}

pub(super) fn runtime_locator(
    value: ReaderLocatorV1,
) -> Result<RuntimeSourceLocator, ReaderErrorV1> {
    // An empty href is the start-of-book locator. A host opening a
    // publication for the first time holds no href: the spine only becomes
    // readable once a session exists, and a session only exists after open.
    Ok(RuntimeSourceLocator {
        href: value.href,
        anchor_id: value.anchor_id,
        source_point: value.source_point.map(runtime_source_point).transpose()?,
        source_range: value.source_range.map(runtime_source_range).transpose()?,
        progression: value.progression,
    })
}

pub(super) fn reader_locator(
    value: RuntimeSourceLocator,
) -> Result<ReaderLocatorV1, ReaderErrorV1> {
    Ok(ReaderLocatorV1 {
        href: value.href,
        anchor_id: value.anchor_id,
        source_point: value.source_point.map(reader_source_point).transpose()?,
        source_range: value.source_range.map(reader_source_range).transpose()?,
        progression: value.progression,
    })
}

fn runtime_source_point(value: ReaderSourcePointV1) -> Result<RuntimeSourcePoint, ReaderErrorV1> {
    Ok(RuntimeSourcePoint {
        node_path: value
            .node_path
            .into_iter()
            .map(usize::try_from)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| numeric_overflow("source node path"))?,
        text_offset: usize_from_u64(value.text_offset, "source text offset")?,
    })
}

fn runtime_source_range(value: ReaderSourceRangeV1) -> Result<RuntimeSourceRange, ReaderErrorV1> {
    Ok(RuntimeSourceRange {
        start: runtime_source_point(value.start)?,
        end: runtime_source_point(value.end)?,
    })
}

fn reader_source_point(value: RuntimeSourcePoint) -> Result<ReaderSourcePointV1, ReaderErrorV1> {
    Ok(ReaderSourcePointV1 {
        node_path: value
            .node_path
            .into_iter()
            .map(|part| u32_from_usize(part, "source node path"))
            .collect::<Result<Vec<_>, _>>()?,
        text_offset: u64_from_usize(value.text_offset, "source text offset")?,
    })
}

fn reader_source_range(value: RuntimeSourceRange) -> Result<ReaderSourceRangeV1, ReaderErrorV1> {
    Ok(ReaderSourceRangeV1 {
        start: reader_source_point(value.start)?,
        end: reader_source_point(value.end)?,
    })
}

pub(super) fn locator_match(value: RuntimeSourceLocatorMatchedBy) -> ReaderLocatorMatchV1 {
    match value {
        RuntimeSourceLocatorMatchedBy::SourceRange => ReaderLocatorMatchV1::SourceRange,
        RuntimeSourceLocatorMatchedBy::SourcePoint => ReaderLocatorMatchV1::SourcePoint,
        RuntimeSourceLocatorMatchedBy::Anchor => ReaderLocatorMatchV1::Anchor,
        RuntimeSourceLocatorMatchedBy::Progression => ReaderLocatorMatchV1::Progression,
        RuntimeSourceLocatorMatchedBy::Href => ReaderLocatorMatchV1::Href,
    }
}

pub(super) fn runtime_resource_kind(value: ReaderResourceKindV1) -> RuntimeResourceKind {
    match value {
        ReaderResourceKindV1::Image => RuntimeResourceKind::Image,
        ReaderResourceKindV1::Font => RuntimeResourceKind::Font,
        ReaderResourceKindV1::Stylesheet => RuntimeResourceKind::Stylesheet,
    }
}

pub(super) fn u32_from_usize(value: usize, field: &str) -> Result<u32, ReaderErrorV1> {
    u32::try_from(value).map_err(|_| numeric_overflow(field))
}

pub(super) fn u64_from_usize(value: usize, field: &str) -> Result<u64, ReaderErrorV1> {
    u64::try_from(value).map_err(|_| numeric_overflow(field))
}

pub(super) fn usize_from_u32(value: u32, field: &str) -> Result<usize, ReaderErrorV1> {
    usize::try_from(value).map_err(|_| numeric_overflow(field))
}

fn usize_from_u64(value: u64, field: &str) -> Result<usize, ReaderErrorV1> {
    usize::try_from(value).map_err(|_| numeric_overflow(field))
}

fn invalid_layout(message: impl Into<String>) -> ReaderErrorV1 {
    ReaderErrorV1::new(ReaderErrorKindV1::InvalidLayout, message)
}

pub(super) fn numeric_overflow(field: &str) -> ReaderErrorV1 {
    ReaderErrorV1::new(
        ReaderErrorKindV1::NumericOverflow,
        format!("{field} is not representable by protocol v1"),
    )
}

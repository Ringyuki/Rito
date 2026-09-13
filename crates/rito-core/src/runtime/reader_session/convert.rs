use crate::{
    layout::{create_layout_config, LayoutConfig, LayoutConfigInput, MarginInput, SpreadMode},
    runtime::{
        RuntimeResourceKind, RuntimeSourceLocator, RuntimeSourceLocatorMatchedBy,
        RuntimeSourcePoint, RuntimeSourceRange,
    },
};

use super::{
    ReaderError, ReaderErrorKind, ReaderLayout, ReaderLocator, ReaderLocatorMatch,
    ReaderResourceKind, ReaderSourcePoint, ReaderSourceRange, ReaderSpreadMode,
};

pub(super) fn layout_config(value: ReaderLayout) -> Result<LayoutConfig, ReaderError> {
    validate_layout(&value)?;
    let spread = match value.spread_mode {
        ReaderSpreadMode::Single => SpreadMode::Single,
        ReaderSpreadMode::Double => SpreadMode::Double,
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
    }))
}

fn validate_layout(value: &ReaderLayout) -> Result<(), ReaderError> {
    if !value.render_ratio.is_finite() || value.render_ratio <= 0.0 {
        return Err(invalid_layout(format!(
            "render ratio must be finite and positive, got {}",
            value.render_ratio
        )));
    }
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

pub(super) fn runtime_locator(value: ReaderLocator) -> Result<RuntimeSourceLocator, ReaderError> {
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

pub(super) fn reader_locator(value: RuntimeSourceLocator) -> Result<ReaderLocator, ReaderError> {
    Ok(ReaderLocator {
        href: value.href,
        anchor_id: value.anchor_id,
        source_point: value.source_point.map(reader_source_point).transpose()?,
        source_range: value.source_range.map(reader_source_range).transpose()?,
        progression: value.progression,
    })
}

fn runtime_source_point(value: ReaderSourcePoint) -> Result<RuntimeSourcePoint, ReaderError> {
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

fn runtime_source_range(value: ReaderSourceRange) -> Result<RuntimeSourceRange, ReaderError> {
    Ok(RuntimeSourceRange {
        start: runtime_source_point(value.start)?,
        end: runtime_source_point(value.end)?,
    })
}

fn reader_source_point(value: RuntimeSourcePoint) -> Result<ReaderSourcePoint, ReaderError> {
    Ok(ReaderSourcePoint {
        node_path: value
            .node_path
            .into_iter()
            .map(|part| u32_from_usize(part, "source node path"))
            .collect::<Result<Vec<_>, _>>()?,
        text_offset: u64_from_usize(value.text_offset, "source text offset")?,
    })
}

fn reader_source_range(value: RuntimeSourceRange) -> Result<ReaderSourceRange, ReaderError> {
    Ok(ReaderSourceRange {
        start: reader_source_point(value.start)?,
        end: reader_source_point(value.end)?,
    })
}

pub(super) fn locator_match(value: RuntimeSourceLocatorMatchedBy) -> ReaderLocatorMatch {
    match value {
        RuntimeSourceLocatorMatchedBy::SourceRange => ReaderLocatorMatch::SourceRange,
        RuntimeSourceLocatorMatchedBy::SourcePoint => ReaderLocatorMatch::SourcePoint,
        RuntimeSourceLocatorMatchedBy::Anchor => ReaderLocatorMatch::Anchor,
        RuntimeSourceLocatorMatchedBy::Progression => ReaderLocatorMatch::Progression,
        RuntimeSourceLocatorMatchedBy::Href => ReaderLocatorMatch::Href,
    }
}

pub(super) fn runtime_resource_kind(value: ReaderResourceKind) -> RuntimeResourceKind {
    match value {
        ReaderResourceKind::Image => RuntimeResourceKind::Image,
        ReaderResourceKind::Font => RuntimeResourceKind::Font,
        ReaderResourceKind::Stylesheet => RuntimeResourceKind::Stylesheet,
    }
}

pub(super) fn u32_from_usize(value: usize, field: &str) -> Result<u32, ReaderError> {
    u32::try_from(value).map_err(|_| numeric_overflow(field))
}

pub(super) fn u64_from_usize(value: usize, field: &str) -> Result<u64, ReaderError> {
    u64::try_from(value).map_err(|_| numeric_overflow(field))
}

pub(super) fn usize_from_u32(value: u32, field: &str) -> Result<usize, ReaderError> {
    usize::try_from(value).map_err(|_| numeric_overflow(field))
}

fn usize_from_u64(value: u64, field: &str) -> Result<usize, ReaderError> {
    usize::try_from(value).map_err(|_| numeric_overflow(field))
}

fn invalid_layout(message: impl Into<String>) -> ReaderError {
    ReaderError::new(ReaderErrorKind::InvalidLayout, message)
}

pub(super) fn numeric_overflow(field: &str) -> ReaderError {
    ReaderError::new(
        ReaderErrorKind::NumericOverflow,
        format!("{field} is not representable by the reader protocol"),
    )
}

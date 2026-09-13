use std::{collections::HashMap, fmt};

use rito_source::NodeId;
use rito_style_contract::{
    InlineFormattingStyle, InlineStyleTable, NumericError, StyleId, StyleTableError,
};
use style::properties::ComputedValues;

use crate::dom::{DomNode, DomStorage};

mod cache;
mod enums;
mod font;
mod fragment;
mod numeric;
mod paint;
mod specified;
mod text;
mod transform;

#[cfg(test)]
mod tests;

/// Contract field that prevented an exact inline-style projection.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InlineStyleField {
    /// The element has no primary computed style.
    ComputedStyle,
    /// Computed font-family list and provenance.
    FontFamilies,
    /// Computed font size.
    FontSize,
    /// Computed font weight.
    FontWeight,
    /// Computed font slant.
    FontSlant,
    /// Computed line height.
    LineHeight,
    /// Computed letter spacing.
    LetterSpacing,
    /// Computed word spacing.
    WordSpacing,
    /// Computed text indentation.
    TextIndent,
    /// Physical margin values.
    Margin,
    /// Physical padding values.
    Padding,
    /// Physical border values.
    Border,
    /// Physical border radii.
    BorderRadii,
    /// Canonical vertical alignment.
    VerticalAlign,
    /// Foreground or background color.
    Color,
    /// Element-group opacity.
    Opacity,
    /// Single-layer computed background image kind and URL.
    BackgroundImage,
    /// Computed background image position.
    BackgroundPosition,
    /// Computed background image repetition.
    BackgroundRepeat,
    /// Computed background image sizing.
    BackgroundSize,
    /// Computed background image viewport attachment.
    BackgroundAttachment,
    /// Computed background image positioning box.
    BackgroundOrigin,
    /// Computed background image clipping box.
    BackgroundClip,
    /// Computed background image blend mode.
    BackgroundBlendMode,
    /// Ordered standard `transform` operation list.
    Transform,
    /// Computed `transform-origin` when it differs from the consumer default.
    TransformOrigin,
    /// Independent `rotate` longhand interaction.
    IndividualRotate,
    /// Independent `scale` longhand interaction.
    IndividualScale,
    /// Independent `translate` longhand interaction.
    IndividualTranslate,
    /// This element's own computed text-decoration longhands.
    TextDecoration,
    /// Ordered text-shadow list.
    TextShadow,
    /// Ordered box-shadow list.
    BoxShadow,
}

/// Reason a computed field could not be represented without loss.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InlineStyleProjectionReason {
    /// Stylo did not expose a primary computed style for the element.
    MissingPrimaryStyle,
    /// The computed value contains an opaque CSS math expression.
    OpaqueCalc,
    /// The upstream value or value combination has no exact V1 representation.
    UnsupportedValue,
    /// A finite/range invariant in the engine-neutral contract was violated.
    InvalidNumeric(NumericError),
    /// A hostile or unreasonable payload exceeded a projection allocation cap.
    ProjectionBudgetExceeded,
}

/// One source-element disposition in deterministic document order.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InlineStyleDisposition {
    /// Every field included in V1 was projected and interned.
    ContractProjected {
        /// Canonical source element identifier.
        node_id: NodeId,
        /// First-seen deterministic style identifier.
        style_id: StyleId,
    },
    /// A V1 field failed closed at its first unrepresentable value.
    ContractRejected {
        /// Canonical source element identifier.
        node_id: NodeId,
        /// First contract field that could not be represented exactly.
        field: InlineStyleField,
        /// Stable failure category.
        reason: InlineStyleProjectionReason,
    },
}

/// Internal deterministic operation counts used by regression tests.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ProjectionMetrics {
    base_style_projection_count: usize,
    language_tag_normalization_count: usize,
    font_family_payload_projection_count: usize,
    font_family_item_projection_count: usize,
    text_shadow_payload_projection_count: usize,
    text_shadow_item_projection_count: usize,
    box_shadow_payload_projection_count: usize,
    box_shadow_item_projection_count: usize,
    background_image_url_projection_count: usize,
    transform_payload_projection_count: usize,
    transform_operation_projection_count: usize,
}

/// V1 contract table plus one audited disposition for every source element.
pub struct InlineStyleProjection {
    /// Dense source-node mapping and deterministically interned exact styles.
    table: InlineStyleTable,
    /// Source-element dispositions in canonical document order.
    dispositions: Vec<InlineStyleDisposition>,
    metrics: ProjectionMetrics,
}

impl fmt::Debug for InlineStyleProjection {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("InlineStyleProjection")
            .field("node_count", &self.table.node_count())
            .field("style_count", &self.table.style_count())
            .field("disposition_count", &self.dispositions.len())
            .field(
                "contract_projected_element_count",
                &self.contract_projected_element_count(),
            )
            .field(
                "contract_rejected_element_count",
                &self.contract_rejected_element_count(),
            )
            .field("metrics", &self.metrics)
            .finish()
    }
}

impl InlineStyleProjection {
    /// Returns the immutable dense source-node style table.
    pub fn table(&self) -> &InlineStyleTable {
        &self.table
    }

    /// Consumes the projection, keeping only the interned table.
    ///
    /// Dispositions exist to explain rejection; a chapter that materialized
    /// successfully has none, so retention callers keep just the table.
    pub fn into_table(self) -> InlineStyleTable {
        self.table
    }

    /// Returns the immutable source-element disposition ledger.
    pub fn dispositions(&self) -> &[InlineStyleDisposition] {
        &self.dispositions
    }

    /// Returns elements that received every field included in the V1 slice.
    pub fn contract_projected_element_count(&self) -> usize {
        self.dispositions
            .iter()
            .filter(|item| matches!(item, InlineStyleDisposition::ContractProjected { .. }))
            .count()
    }

    /// Returns elements rejected at the first unrepresentable V1 field.
    pub fn contract_rejected_element_count(&self) -> usize {
        self.dispositions.len() - self.contract_projected_element_count()
    }

    /// Reports whether every source element received the included V1 fields.
    ///
    /// This is not a CSS consumer-equivalence or same-work claim: shaping,
    /// layout, compositing, and paint properties outside V1 remain separate
    /// migration gates.
    pub fn is_contract_slice_complete(&self) -> bool {
        self.contract_projected_element_count() == self.dispositions.len()
    }
}

#[derive(Clone, Copy)]
pub(super) struct ProjectionFailure {
    pub(super) field: InlineStyleField,
    pub(super) reason: InlineStyleProjectionReason,
}

pub(super) type ProjectionResult<T> = Result<T, ProjectionFailure>;

type BaseProjectionCache = HashMap<usize, ProjectionResult<InlineFormattingStyle>>;

pub(crate) fn project_inline(dom: &DomStorage) -> Result<InlineStyleProjection, StyleTableError> {
    let mut table = InlineStyleTable::new(dom.source_node_count());
    let mut dispositions = Vec::new();
    let mut cache = BaseProjectionCache::new();
    let mut payload_caches = cache::ProjectionPayloadCaches::default();

    for element in dom.element_handles() {
        let disposition = project_element(
            element,
            dom.shared_lock(),
            &mut table,
            &mut cache,
            &mut payload_caches,
        )?;
        dispositions.push(disposition);
    }
    let metrics = projection_metrics(dom, &cache, &payload_caches);
    Ok(InlineStyleProjection {
        table,
        dispositions,
        metrics,
    })
}

fn projection_metrics(
    dom: &DomStorage,
    base_cache: &BaseProjectionCache,
    payloads: &cache::ProjectionPayloadCaches,
) -> ProjectionMetrics {
    let (font_payloads, font_items) = payloads.font_families.stats();
    let (text_payloads, text_items) = payloads.text_shadows.stats();
    let (box_payloads, box_items) = payloads.box_shadows.stats();
    let (transform_payloads, transform_items) = payloads.transforms.stats();
    ProjectionMetrics {
        base_style_projection_count: base_cache.len(),
        language_tag_normalization_count: dom.language_tag_normalization_count(),
        font_family_payload_projection_count: font_payloads,
        font_family_item_projection_count: font_items,
        text_shadow_payload_projection_count: text_payloads,
        text_shadow_item_projection_count: text_items,
        box_shadow_payload_projection_count: box_payloads,
        box_shadow_item_projection_count: box_items,
        background_image_url_projection_count: payloads.background_image_urls.projection_count(),
        transform_payload_projection_count: transform_payloads,
        transform_operation_projection_count: transform_items,
    }
}

fn project_element(
    element: DomNode<'_>,
    lock: &style::shared_lock::SharedRwLock,
    table: &mut InlineStyleTable,
    cache: &mut BaseProjectionCache,
    payload_caches: &mut cache::ProjectionPayloadCaches,
) -> Result<InlineStyleDisposition, StyleTableError> {
    let node_id = element.id();
    let Some(styles) = element.primary_styles() else {
        return Ok(rejected(node_id, missing_primary_style()));
    };
    // Primary ComputedValues remain owned by the DOM style slots for the full
    // projection, so a pointer address cannot be recycled while this cache is
    // live. Language is source-semantic state and is overlaid per element.
    let cache_key = std::ptr::from_ref(styles.as_ref()).addr();
    let base = match cached_base_style(cache, payload_caches, cache_key, &styles) {
        Ok(value) => value,
        Err(failure) => return Ok(rejected(node_id, failure)),
    };
    let mut style = base;
    style.text_flow.language = text::inherited_language(element);
    style.font.line_height_is_declared = specified::declares_line_height(&styles, lock);
    let style_id = table.intern_for_node(node_id.index(), style)?;
    Ok(InlineStyleDisposition::ContractProjected { node_id, style_id })
}

fn cached_base_style(
    cache: &mut BaseProjectionCache,
    payload_caches: &mut cache::ProjectionPayloadCaches,
    cache_key: usize,
    styles: &ComputedValues,
) -> ProjectionResult<InlineFormattingStyle> {
    if let Some(result) = cache.get(&cache_key) {
        return result.clone();
    }
    let result = inline_style(styles, payload_caches);
    cache.insert(cache_key, result.clone());
    result
}

fn inline_style(
    styles: &ComputedValues,
    payload_caches: &mut cache::ProjectionPayloadCaches,
) -> ProjectionResult<InlineFormattingStyle> {
    Ok(InlineFormattingStyle {
        font: font::project(styles, &mut payload_caches.font_families)?,
        text_flow: text::project(styles, None)?,
        bidi: enums::bidi(styles),
        fragment: fragment::project(styles)?,
        paint: paint::project(
            styles,
            &mut payload_caches.text_shadows,
            &mut payload_caches.box_shadows,
            &mut payload_caches.background_image_urls,
            &mut payload_caches.transforms,
        )?,
    })
}

fn missing_primary_style() -> ProjectionFailure {
    ProjectionFailure {
        field: InlineStyleField::ComputedStyle,
        reason: InlineStyleProjectionReason::MissingPrimaryStyle,
    }
}

fn rejected(node_id: NodeId, failure: ProjectionFailure) -> InlineStyleDisposition {
    InlineStyleDisposition::ContractRejected {
        node_id,
        field: failure.field,
        reason: failure.reason,
    }
}

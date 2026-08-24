use std::{collections::HashMap, fmt};

use crate::{
    LengthPercentageOrAuto, NonNegativeCssPx, NonNegativeLengthPercentage, Percentage,
    PhysicalSides,
};

/// Outer display role retained from the computed CSS display pair.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum LayoutDisplayOutsideV1 {
    None,
    Inline,
    Block,
    TableCaption,
    InternalTable,
}

/// Inner display role retained from the computed CSS display pair.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum LayoutDisplayInsideV1 {
    None,
    Contents,
    Flow,
    FlowRoot,
    Flex,
    Grid,
    Table,
    TableRowGroup,
    TableColumn,
    TableColumnGroup,
    TableHeaderGroup,
    TableFooterGroup,
    TableRow,
    TableCell,
}

/// Computed `display`, without flattening two-keyword or list-item semantics.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct LayoutDisplayV1 {
    pub outside: LayoutDisplayOutsideV1,
    pub inside: LayoutDisplayInsideV1,
    pub is_list_item: bool,
}

/// Computed `justify-content` values retained by the first bounded flex slice.
///
/// V1 only carries values that are either inert for non-flex layout (`normal`)
/// or implemented exactly by the single-item flex consumer (`center`).
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum JustifyContentV1 {
    Normal,
    Center,
}

/// Computed `align-items` values retained by the first bounded flex slice.
///
/// Other box-alignment values stay outside V1 until the layout consumer can
/// implement their used-value semantics without approximation.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum AlignItemsV1 {
    Normal,
    Center,
}

/// Forced page-break behavior implemented by the current paginator.
///
/// Standard `break-before` / `break-after` and their legacy page-break
/// aliases converge on this consumer contract after the Stylo cascade.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum PageBreakV1 {
    Auto,
    Always,
}

/// Exact V1 subset of the computed value used by `width` and `height`.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum PreferredSizeV1 {
    Auto,
    Value(NonNegativeLengthPercentage),
    MaxContent,
    MinContent,
    FitContent,
    WebkitFillAvailable,
    Stretch,
    FitContentFunction(NonNegativeLengthPercentage),
}

/// Computed `max-width` values implemented by Rito's current layout consumer.
///
/// Intrinsic sizing keywords and anchor functions are deliberately outside
/// this contract revision. Producers must reject them instead of flattening
/// them to `none` or an arbitrary length.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum MaximumSizeV1 {
    None,
    Value(NonNegativeLengthPercentage),
}

/// Physical `clear` values implemented by Rito's current float consumer.
///
/// Logical `inline-start` / `inline-end` values require writing-mode-aware
/// float clearance and are intentionally rejected by the V1 producer.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum ClearV1 {
    None,
    Left,
    Right,
    Both,
}

/// Physical `float` values implemented by Rito's current float consumer.
///
/// Logical float sides stay outside V1 until layout resolves them against
/// writing mode and direction.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum FloatV1 {
    None,
    Left,
    Right,
}

/// Uniform two-axis overflow behavior implemented by the current consumer.
///
/// The consumer owns one `overflow` field, so producers must reject differing
/// computed axes and scrolling/clip modes instead of flattening them.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum OverflowV1 {
    Visible,
    Hidden,
}

/// Computed `min-height` values retained at the current consumer boundary.
///
/// Percentages remain distinct even though the consumer currently applies the
/// legacy compatibility policy of omitting them without a height basis.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum MinimumHeightV1 {
    Auto,
    Length(NonNegativeCssPx),
    Percentage(Percentage),
}

/// Computed `max-height` values retained at the current consumer boundary.
///
/// Percentages remain distinct from `none`; see [`MinimumHeightV1`].
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum MaximumHeightV1 {
    None,
    Length(NonNegativeCssPx),
    Percentage(Percentage),
}

/// List marker systems implemented by the pre-Stylo Rito layout consumer.
///
/// Producers must reject other counter-style names, strings, and `symbols()`
/// until the marker consumer receives a richer engine-neutral contract.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum ListMarkerStyleV1 {
    None,
    Disc,
    Circle,
    Square,
    Decimal,
    LowerRoman,
    UpperRoman,
    LowerAlpha,
    UpperAlpha,
}

/// First engine-neutral block/layout migration slice.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct LayoutFormattingStyleV1 {
    pub display: LayoutDisplayV1,
    /// Physical box margins. Percentages resolve against the containing
    /// block's inline size (including the vertical sides, per CSS).
    pub margin: PhysicalSides<LengthPercentageOrAuto>,
    /// Physical box padding.
    pub padding: PhysicalSides<NonNegativeLengthPercentage>,
    /// How `width`/`height` map onto the box model.
    pub box_sizing: BoxSizingV1,
    pub justify_content: JustifyContentV1,
    pub align_items: AlignItemsV1,
    pub break_before: PageBreakV1,
    pub break_after: PageBreakV1,
    pub width: PreferredSizeV1,
    pub height: PreferredSizeV1,
    pub max_width: MaximumSizeV1,
    pub min_height: MinimumHeightV1,
    pub max_height: MaximumHeightV1,
    pub clear: ClearV1,
    pub float: FloatV1,
    pub overflow: OverflowV1,
    pub list_style_type: ListMarkerStyleV1,
    /// Positioning scheme. Only the schemes Rito's flow consumer implements
    /// are representable; anything else fails closed.
    pub position: PositionV1,
    /// Physical box offsets, meaningful only for a positioned box.
    pub inset: PhysicalSides<LengthPercentageOrAuto>,
    /// Computed `vertical-align` reduced to the alignments a table cell
    /// applies to its content box inside the row.
    pub vertical_align: CellVerticalAlignV1,
    /// Used horizontal/vertical separation between table cells, already
    /// accounting for `border-collapse`: a collapsed table reports zero.
    /// Inherited like its CSS source, and meaningful only on a table box.
    pub border_spacing: (NonNegativeCssPx, NonNegativeCssPx),
    /// `border-collapse: collapse` on a table box. A collapsed table's
    /// edge borders belong to its cells, so a dashed or dotted edge
    /// paints per cell segment with the pattern phase restarting at
    /// each cell's edge. Inherited like its CSS source.
    pub border_collapse: bool,
}

/// How a table cell aligns its content box within the row box.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum CellVerticalAlignV1 {
    /// Align cell baselines across the row (the CSS initial value).
    Baseline,
    /// Align with the row's top edge.
    Top,
    /// Center in the row box.
    Middle,
    /// Align with the row's bottom edge.
    Bottom,
}

/// Computed `box-sizing`: how `width`/`height` map onto the box model.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum BoxSizingV1 {
    ContentBox,
    BorderBox,
}

/// Positioning schemes implemented by Rito's current flow consumer.
///
/// `static` and `relative` participate in flow; `absolute` is removed from it.
/// `fixed` and `sticky` have no paginated meaning here and fail closed.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum PositionV1 {
    Static,
    Relative,
    Absolute,
}

/// Table-local zero-based identifier for one interned layout style.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct LayoutStyleId(u32);

impl LayoutStyleId {
    pub const fn from_raw(value: u32) -> Self {
        Self(value)
    }

    pub const fn raw(self) -> u32 {
        self.0
    }

    fn index(self) -> usize {
        self.0 as usize
    }
}

/// Error returned by checked layout-style table operations.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LayoutStyleTableError {
    NodeIndexOutOfBounds {
        node_index: usize,
        node_count: usize,
    },
    MissingNodeStyle {
        node_index: usize,
    },
    NodeStyleAlreadyAssigned {
        node_index: usize,
        style_id: LayoutStyleId,
    },
    StyleIdOutOfBounds {
        style_id: LayoutStyleId,
        style_count: usize,
    },
    StyleCapacityExceeded,
}

impl fmt::Display for LayoutStyleTableError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NodeIndexOutOfBounds {
                node_index,
                node_count,
            } => write!(
                formatter,
                "node index {node_index} is outside {node_count} slots"
            ),
            Self::MissingNodeStyle { node_index } => {
                write!(formatter, "node index {node_index} has no layout style")
            }
            Self::NodeStyleAlreadyAssigned {
                node_index,
                style_id,
            } => write!(
                formatter,
                "node index {node_index} already has layout style {}",
                style_id.raw()
            ),
            Self::StyleIdOutOfBounds {
                style_id,
                style_count,
            } => write!(
                formatter,
                "layout style id {} is outside {style_count} interned styles",
                style_id.raw()
            ),
            Self::StyleCapacityExceeded => {
                formatter.write_str("layout style table exhausted its u32 identifiers")
            }
        }
    }
}

impl std::error::Error for LayoutStyleTableError {}

/// Deterministically interned layout styles plus a dense source-node mapping.
#[derive(Clone)]
pub struct LayoutStyleTableV1 {
    styles: Vec<LayoutFormattingStyleV1>,
    interned: HashMap<LayoutFormattingStyleV1, LayoutStyleId>,
    node_styles: Vec<Option<LayoutStyleId>>,
}

impl fmt::Debug for LayoutStyleTableV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LayoutStyleTableV1")
            .field("style_count", &self.styles.len())
            .field("node_count", &self.node_styles.len())
            .field(
                "assigned_node_count",
                &self.node_styles.iter().flatten().count(),
            )
            .finish()
    }
}

impl LayoutStyleTableV1 {
    pub fn new(node_count: usize) -> Self {
        Self {
            styles: Vec::new(),
            interned: HashMap::new(),
            node_styles: vec![None; node_count],
        }
    }

    /// Interns a style without assigning it to a node slot, for synthesized
    /// boxes (anonymous block boxes) that have no source element.
    pub fn intern(
        &mut self,
        style: LayoutFormattingStyleV1,
    ) -> Result<LayoutStyleId, LayoutStyleTableError> {
        if let Some(style_id) = self.interned.get(&style) {
            return Ok(*style_id);
        }
        let raw = u32::try_from(self.styles.len())
            .map_err(|_| LayoutStyleTableError::StyleCapacityExceeded)?;
        let style_id = LayoutStyleId(raw);
        self.styles.push(style);
        self.interned.insert(style, style_id);
        Ok(style_id)
    }

    pub fn intern_for_node(
        &mut self,
        node_index: usize,
        style: LayoutFormattingStyleV1,
    ) -> Result<LayoutStyleId, LayoutStyleTableError> {
        if node_index >= self.node_styles.len() {
            return Err(LayoutStyleTableError::NodeIndexOutOfBounds {
                node_index,
                node_count: self.node_styles.len(),
            });
        }
        if let Some(style_id) = self.node_styles[node_index] {
            return Err(LayoutStyleTableError::NodeStyleAlreadyAssigned {
                node_index,
                style_id,
            });
        }
        let style_id = if let Some(style_id) = self.interned.get(&style) {
            *style_id
        } else {
            let raw = u32::try_from(self.styles.len())
                .map_err(|_| LayoutStyleTableError::StyleCapacityExceeded)?;
            let style_id = LayoutStyleId(raw);
            self.styles.push(style);
            self.interned.insert(style, style_id);
            style_id
        };
        self.node_styles[node_index] = Some(style_id);
        Ok(style_id)
    }

    pub fn style(
        &self,
        style_id: LayoutStyleId,
    ) -> Result<&LayoutFormattingStyleV1, LayoutStyleTableError> {
        self.styles
            .get(style_id.index())
            .ok_or(LayoutStyleTableError::StyleIdOutOfBounds {
                style_id,
                style_count: self.styles.len(),
            })
    }

    pub fn style_for_node(
        &self,
        node_index: usize,
    ) -> Result<&LayoutFormattingStyleV1, LayoutStyleTableError> {
        let style_id = self.node_style_id(node_index)?;
        self.style(style_id)
    }

    pub fn node_style_id(&self, node_index: usize) -> Result<LayoutStyleId, LayoutStyleTableError> {
        let Some(slot) = self.node_styles.get(node_index) else {
            return Err(LayoutStyleTableError::NodeIndexOutOfBounds {
                node_index,
                node_count: self.node_styles.len(),
            });
        };
        slot.ok_or(LayoutStyleTableError::MissingNodeStyle { node_index })
    }

    pub fn styles(&self) -> &[LayoutFormattingStyleV1] {
        &self.styles
    }

    pub fn style_count(&self) -> usize {
        self.styles.len()
    }

    pub fn node_count(&self) -> usize {
        self.node_styles.len()
    }

    pub fn node_style_ids(&self) -> &[Option<LayoutStyleId>] {
        &self.node_styles
    }
}

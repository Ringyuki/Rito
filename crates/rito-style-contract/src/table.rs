use std::{collections::HashMap, fmt};

use crate::InlineFormattingStyleV1;

mod fingerprint;
mod payload;

use self::fingerprint::style_fingerprint;
use self::payload::PayloadInterners;

/// Table-local zero-based identifier for one interned inline style.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct StyleId(u32);

impl StyleId {
    /// Creates an identifier from its storage representation.
    ///
    /// Use validates only the numeric range. It cannot prove that an ID with
    /// the same raw value originated from that table, so callers must not mix
    /// identifiers across tables.
    pub const fn from_raw(value: u32) -> Self {
        Self(value)
    }

    /// Returns the zero-based storage representation.
    pub const fn raw(self) -> u32 {
        self.0
    }

    fn index(self) -> usize {
        self.0 as usize
    }
}

/// Error returned by checked style-table and node-mapping operations.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StyleTableError {
    /// A node index was outside the fixed node mapping.
    NodeIndexOutOfBounds {
        /// Requested zero-based node index.
        node_index: usize,
        /// Number of mapped node slots.
        node_count: usize,
    },
    /// No style has been assigned to an in-bounds node.
    MissingNodeStyle {
        /// Zero-based node index with no assignment.
        node_index: usize,
    },
    /// A producer attempted to overwrite an existing node assignment.
    NodeStyleAlreadyAssigned {
        /// Zero-based node index that was already assigned.
        node_index: usize,
        /// Existing style identifier retained by the table.
        style_id: StyleId,
    },
    /// A style identifier did not exist in this table.
    StyleIdOutOfBounds {
        /// Requested style identifier.
        style_id: StyleId,
        /// Number of interned styles.
        style_count: usize,
    },
    /// The table cannot represent another style with its `u32` identifier.
    StyleCapacityExceeded,
}

impl fmt::Display for StyleTableError {
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
                write!(formatter, "node index {node_index} has no inline style")
            }
            Self::NodeStyleAlreadyAssigned {
                node_index,
                style_id,
            } => write!(
                formatter,
                "node index {node_index} already has inline style {}",
                style_id.raw()
            ),
            Self::StyleIdOutOfBounds {
                style_id,
                style_count,
            } => write!(
                formatter,
                "style id {} is outside {style_count} interned styles",
                style_id.raw()
            ),
            Self::StyleCapacityExceeded => {
                formatter.write_str("inline style table exhausted its u32 identifiers")
            }
        }
    }
}

impl std::error::Error for StyleTableError {}

/// Deterministically interned inline styles plus a fixed node-index mapping.
///
/// New IDs are assigned in first-seen input order. Hash-map iteration order is
/// never exposed, so random hash seeding cannot affect IDs or [`Self::styles`].
pub struct InlineStyleTableV1 {
    styles: Vec<InlineFormattingStyleV1>,
    interned: HashMap<u64, Vec<StyleId>>,
    node_styles: Vec<Option<StyleId>>,
    payloads: PayloadInterners,
}

impl fmt::Debug for InlineStyleTableV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let assigned_count = self.node_styles.iter().flatten().count();
        formatter
            .debug_struct("InlineStyleTableV1")
            .field("style_count", &self.styles.len())
            .field("node_count", &self.node_styles.len())
            .field("assigned_node_count", &assigned_count)
            .finish()
    }
}

impl InlineStyleTableV1 {
    /// Creates an empty style table with a fixed number of node slots.
    pub fn new(node_count: usize) -> Self {
        Self {
            styles: Vec::new(),
            interned: HashMap::new(),
            node_styles: vec![None; node_count],
            payloads: PayloadInterners::default(),
        }
    }

    /// Interns a style, returning the first ID assigned to an equal value.
    pub fn intern(&mut self, style: InlineFormattingStyleV1) -> Result<StyleId, StyleTableError> {
        let style = self.payloads.canonicalize(style);
        let fingerprint = style_fingerprint(&style);
        if let Some(ids) = self.interned.get(&fingerprint) {
            for id in ids {
                if self.styles[id.index()] == style {
                    return Ok(*id);
                }
            }
        }
        let raw =
            u32::try_from(self.styles.len()).map_err(|_| StyleTableError::StyleCapacityExceeded)?;
        let id = StyleId(raw);
        self.styles.push(style);
        self.interned.entry(fingerprint).or_default().push(id);
        Ok(id)
    }

    /// Assigns an existing style ID to an in-bounds node index.
    pub fn set_node_style(
        &mut self,
        node_index: usize,
        style_id: StyleId,
    ) -> Result<(), StyleTableError> {
        self.check_node_index(node_index)?;
        self.check_node_unassigned(node_index)?;
        self.style(style_id)?;
        self.node_styles[node_index] = Some(style_id);
        Ok(())
    }

    /// Interns a style and assigns it to an in-bounds node atomically.
    pub fn intern_for_node(
        &mut self,
        node_index: usize,
        style: InlineFormattingStyleV1,
    ) -> Result<StyleId, StyleTableError> {
        self.check_node_index(node_index)?;
        self.check_node_unassigned(node_index)?;
        let style_id = self.intern(style)?;
        self.node_styles[node_index] = Some(style_id);
        Ok(style_id)
    }

    /// Returns a style by checked identifier.
    pub fn style(&self, style_id: StyleId) -> Result<&InlineFormattingStyleV1, StyleTableError> {
        self.styles
            .get(style_id.index())
            .ok_or(StyleTableError::StyleIdOutOfBounds {
                style_id,
                style_count: self.styles.len(),
            })
    }

    /// Returns the assigned style ID for a checked node index.
    pub fn node_style_id(&self, node_index: usize) -> Result<StyleId, StyleTableError> {
        self.check_node_index(node_index)?;
        self.node_styles[node_index].ok_or(StyleTableError::MissingNodeStyle { node_index })
    }

    /// Returns the assigned style for a checked node index.
    pub fn style_for_node(
        &self,
        node_index: usize,
    ) -> Result<&InlineFormattingStyleV1, StyleTableError> {
        let style_id = self.node_style_id(node_index)?;
        self.style(style_id)
    }

    /// Returns styles in deterministic ID order.
    pub fn styles(&self) -> &[InlineFormattingStyleV1] {
        &self.styles
    }

    /// Returns the number of interned styles.
    pub fn style_count(&self) -> usize {
        self.styles.len()
    }

    /// Returns the fixed number of node mapping slots.
    pub fn node_count(&self) -> usize {
        self.node_styles.len()
    }

    /// Returns the dense node mapping, including unassigned slots.
    pub fn node_style_ids(&self) -> &[Option<StyleId>] {
        &self.node_styles
    }

    fn check_node_index(&self, node_index: usize) -> Result<(), StyleTableError> {
        if node_index >= self.node_styles.len() {
            return Err(StyleTableError::NodeIndexOutOfBounds {
                node_index,
                node_count: self.node_styles.len(),
            });
        }
        Ok(())
    }

    fn check_node_unassigned(&self, node_index: usize) -> Result<(), StyleTableError> {
        match self.node_styles[node_index] {
            Some(style_id) => Err(StyleTableError::NodeStyleAlreadyAssigned {
                node_index,
                style_id,
            }),
            None => Ok(()),
        }
    }
}

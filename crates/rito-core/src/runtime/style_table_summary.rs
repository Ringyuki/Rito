//! Read-only summary of the typed style tables a revision retains.
//!
//! Chapters resolve their styles through the Stylo projection into interned
//! layout and inline tables; the revision keeps both alongside the layout
//! so typed consumers never re-derive styles from JSON string maps. This
//! summary reports the retained coverage per chapter and a platform-stable
//! digest of the full table content, so corpus runs can assert that two
//! builds (or two platforms) projected byte-identical typed styles for the
//! same book and configuration.

use std::hash::{Hash, Hasher};

use serde::{Deserialize, Serialize};

use crate::epub::{EpubError, EpubResult};

use super::{RuntimeDocument, RuntimeRevisionStatus};

pub const RUNTIME_STYLE_TABLE_SUMMARY_SCHEMA_VERSION: u32 = 1;

/// Retained typed-style coverage for one chapter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeChapterStyleTableSummary {
    pub idref: String,
    /// Distinct interned layout styles in this chapter's table.
    pub interned_style_count: usize,
    /// Distinct interned inline styles in this chapter's table.
    pub inline_interned_style_count: usize,
    /// Source-node slots the tables were sized for.
    pub node_count: usize,
    /// Slots that resolved to an interned layout style.
    pub assigned_node_count: usize,
    /// Slots that resolved to an interned inline style.
    pub inline_assigned_node_count: usize,
}

/// Summary of every typed layout-style table a revision retains.
///
/// `is_complete == false` means later chapters may still be unresolved;
/// tables appear as their chapters' work is published.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStyleTableSummary {
    pub schema_version: u32,
    pub is_complete: bool,
    /// Chapters with a retained table.
    pub chapter_count: usize,
    pub total_interned_style_count: usize,
    pub total_inline_interned_style_count: usize,
    pub total_assigned_node_count: usize,
    pub chapters: Vec<RuntimeChapterStyleTableSummary>,
    /// FNV-1a 64 over the canonical content of every table in chapter-idref
    /// order. Equal books, configuration, and projection code must reproduce
    /// this digest exactly on every platform.
    pub table_digest: String,
}

impl RuntimeDocument {
    pub(super) fn style_table_summary(
        &self,
        revision_id: &str,
    ) -> EpubResult<RuntimeStyleTableSummary> {
        let revision = self
            .revisions
            .get(revision_id)
            .ok_or_else(|| EpubError::new(format!("unknown revision: {revision_id}")))?;
        let mut hasher = StableFnvHasher::default();
        let mut chapters = Vec::with_capacity(revision.chapter_style_tables.len());
        let mut total_interned = 0usize;
        let mut total_inline_interned = 0usize;
        let mut total_assigned = 0usize;
        for (idref, tables) in &revision.chapter_style_tables {
            idref.hash(&mut hasher);
            tables.layout.styles().hash(&mut hasher);
            tables.layout.node_style_ids().hash(&mut hasher);
            tables.inline.styles().hash(&mut hasher);
            tables.inline.node_style_ids().hash(&mut hasher);
            let assigned = tables.layout.node_style_ids().iter().flatten().count();
            let inline_assigned = tables.inline.node_style_ids().iter().flatten().count();
            total_interned += tables.layout.style_count();
            total_inline_interned += tables.inline.style_count();
            total_assigned += assigned;
            chapters.push(RuntimeChapterStyleTableSummary {
                idref: idref.clone(),
                interned_style_count: tables.layout.style_count(),
                inline_interned_style_count: tables.inline.style_count(),
                node_count: tables.layout.node_count(),
                assigned_node_count: assigned,
                inline_assigned_node_count: inline_assigned,
            });
        }
        Ok(RuntimeStyleTableSummary {
            schema_version: RUNTIME_STYLE_TABLE_SUMMARY_SCHEMA_VERSION,
            is_complete: revision.status == RuntimeRevisionStatus::Complete,
            chapter_count: chapters.len(),
            total_interned_style_count: total_interned,
            total_inline_interned_style_count: total_inline_interned,
            total_assigned_node_count: total_assigned,
            chapters,
            table_digest: format!("{:016x}", hasher.finish()),
        })
    }
}

/// FNV-1a 64 exposed as a `std::hash::Hasher`, with every integer write
/// pinned to little-endian and `usize` widened to eight bytes so identical
/// values hash identically on 32-bit wasm and 64-bit native targets.
struct StableFnvHasher(u64);

impl Default for StableFnvHasher {
    fn default() -> Self {
        Self(0xcbf2_9ce4_8422_2325)
    }
}

impl Hasher for StableFnvHasher {
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }

    fn write_u8(&mut self, value: u8) {
        self.write(&[value]);
    }

    fn write_u16(&mut self, value: u16) {
        self.write(&value.to_le_bytes());
    }

    fn write_u32(&mut self, value: u32) {
        self.write(&value.to_le_bytes());
    }

    fn write_u64(&mut self, value: u64) {
        self.write(&value.to_le_bytes());
    }

    fn write_u128(&mut self, value: u128) {
        self.write(&value.to_le_bytes());
    }

    fn write_usize(&mut self, value: usize) {
        self.write(&(value as u64).to_le_bytes());
    }

    fn write_i8(&mut self, value: i8) {
        self.write_u8(value as u8);
    }

    fn write_i16(&mut self, value: i16) {
        self.write_u16(value as u16);
    }

    fn write_i32(&mut self, value: i32) {
        self.write_u32(value as u32);
    }

    fn write_i64(&mut self, value: i64) {
        self.write_u64(value as u64);
    }

    fn write_i128(&mut self, value: i128) {
        self.write_u128(value as u128);
    }

    fn write_isize(&mut self, value: isize) {
        self.write_usize(value as usize);
    }
}

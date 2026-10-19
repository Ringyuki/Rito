//! The tables format 4 ends with, which every text and ruby run indexes
//! into instead of carrying its own copy: one host copies the message once
//! and reads the cluster table in place, as typed arrays, and decodes the
//! text and each distinct paint once however many runs share them.
//!
//! After the last primitive: the cluster count; zero bytes up to the next
//! offset that is a multiple of four from the message start; every
//! cluster's byte (u32), then every cluster's origin (x and y, f32), then
//! every cluster's joins flag (u8); the text table's byte length and its
//! UTF-8 bytes; the paint count and each paint.

use std::collections::HashMap;

use super::super::{
    contract::{ReaderCluster, ReaderTextRunPaint},
    ReaderDisplayListWireError,
};
use super::paint::write_run_paint;
use super::primitives::{checked_length, write_finite_f32, write_length, write_u32};

#[derive(Default)]
pub(in crate::render::commands::reader_wire) struct TextTables {
    bytes: Vec<u32>,
    origins: Vec<f32>,
    joins: Vec<u8>,
    text: String,
    /// The text table's length in UTF-16 code units.
    text_units: u32,
    paints: Vec<u8>,
    paint_count: u32,
    /// Each distinct paint's index, by its encoding.
    paint_indexes: HashMap<Vec<u8>, u32>,
    scratch: Vec<u8>,
}

impl TextTables {
    /// Tables with room for `clusters` clusters and `text` bytes of text.
    pub(super) fn with_capacity(clusters: usize, text: usize) -> Self {
        Self {
            bytes: Vec::with_capacity(clusters),
            origins: Vec::with_capacity(2 * clusters),
            joins: Vec::with_capacity(clusters),
            text: String::with_capacity(text),
            ..Self::default()
        }
    }

    /// A run's text: its byte range in the text table and the same range
    /// in UTF-16 code units, where a host decoding the table once into a
    /// UTF-16 string finds it.
    pub(super) fn write_text(
        &mut self,
        output: &mut Vec<u8>,
        text: &str,
    ) -> Result<(), ReaderDisplayListWireError> {
        let units = checked_length(text.encode_utf16().count(), "text")?;
        write_length(output, self.text.len(), "text table")?;
        write_length(output, text.len(), "text")?;
        write_u32(output, self.text_units);
        write_u32(output, units);
        self.text.push_str(text);
        self.text_units = self
            .text_units
            .checked_add(units)
            .ok_or(ReaderDisplayListWireError::LengthOverflow("text table"))?;
        Ok(())
    }

    /// A run's paint, by its index in the paint table.
    pub(super) fn write_paint(
        &mut self,
        output: &mut Vec<u8>,
        paint: &ReaderTextRunPaint,
    ) -> Result<(), ReaderDisplayListWireError> {
        self.scratch.clear();
        write_run_paint(&mut self.scratch, paint)?;
        let index = match self.paint_indexes.get(&self.scratch) {
            Some(index) => *index,
            None => {
                let index = self.paint_count;
                self.paints.extend_from_slice(&self.scratch);
                self.paint_indexes.insert(self.scratch.clone(), index);
                self.paint_count = index
                    .checked_add(1)
                    .ok_or(ReaderDisplayListWireError::LengthOverflow("paint"))?;
                index
            }
        };
        write_u32(output, index);
        Ok(())
    }

    /// A run's clusters: where they start in the cluster table and how
    /// many there are.
    pub(super) fn write_clusters(
        &mut self,
        output: &mut Vec<u8>,
        clusters: &[ReaderCluster],
    ) -> Result<(), ReaderDisplayListWireError> {
        write_length(output, self.bytes.len(), "cluster table")?;
        write_length(output, clusters.len(), "cluster")?;
        for cluster in clusters {
            let (x, y) = (cluster.x as f32, cluster.y as f32);
            if !x.is_finite() || !y.is_finite() {
                return Err(ReaderDisplayListWireError::NonFiniteNumber);
            }
            self.bytes.push(cluster.byte);
            self.origins.extend([x, y]);
            self.joins.push(u8::from(cluster.joins));
        }
        Ok(())
    }

    /// Appends the tables after the last primitive.
    pub(super) fn finish(self, output: &mut Vec<u8>) -> Result<(), ReaderDisplayListWireError> {
        output.reserve(4 + 3 + 13 * self.bytes.len() + 4 + self.text.len() + 4 + self.paints.len());
        write_length(output, self.bytes.len(), "cluster table")?;
        while !output.len().is_multiple_of(4) {
            output.push(0);
        }
        for byte in self.bytes {
            write_u32(output, byte);
        }
        for origin in self.origins {
            write_finite_f32(output, origin)?;
        }
        output.extend_from_slice(&self.joins);
        write_length(output, self.text.len(), "text table")?;
        output.extend_from_slice(self.text.as_bytes());
        write_u32(output, self.paint_count);
        output.extend_from_slice(&self.paints);
        Ok(())
    }
}

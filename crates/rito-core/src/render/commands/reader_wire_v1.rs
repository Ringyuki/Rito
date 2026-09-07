use std::{collections::BTreeSet, error::Error, fmt};

use sha2::{Digest, Sha256};

use super::DisplayCommand;
use crate::render::lower::{Primitive, PrimitiveList};
use contract::ReaderDisplayListV1;

pub(crate) mod contract;
#[cfg(test)]
mod decode;
mod encode;
mod legacy_adapter;
#[cfg(test)]
mod tests;

const READER_DISPLAY_LIST_MAGIC: &[u8; 7] = b"RITODL1";
/// Format 2 is the device-resolved primitive list. Format 1 carried the
/// semantic commands and is no longer written: hosts blit, they do not
/// interpret.
pub(crate) const READER_PRIMITIVE_LIST_FORMAT_VERSION: u32 = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReaderEncodedDisplayListV1 {
    pub format_version: u32,
    pub command_count: u32,
    pub semantic_digest: [u8; 32],
    pub bytes: Vec<u8>,
    pub image_hrefs: Vec<String>,
    pub font_families: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ReaderDisplayListWireError {
    LengthOverflow(&'static str),
    SourceTextOffsetOverflow,
    NonFiniteNumber,
    InvalidLegacyField(&'static str),
    UnsupportedLegacyValue(&'static str),
    InvalidLegacyColor(&'static str),
}

impl fmt::Display for ReaderDisplayListWireError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::LengthOverflow(context) => write!(formatter, "{context} length exceeds u32"),
            Self::SourceTextOffsetOverflow => formatter.write_str("source text offset exceeds u64"),
            Self::NonFiniteNumber => formatter.write_str("display value contains NaN or infinity"),
            Self::InvalidLegacyField(context) => {
                write!(
                    formatter,
                    "legacy display field has the wrong shape: {context}"
                )
            }
            Self::UnsupportedLegacyValue(context) => {
                write!(
                    formatter,
                    "legacy display value is not representable in V1: {context}"
                )
            }
            Self::InvalidLegacyColor(context) => {
                write!(formatter, "legacy display color is invalid: {context}")
            }
        }
    }
}

impl Error for ReaderDisplayListWireError {}

/// Adapts the JSON-shaped layout provider's commands to the owned V1
/// contract: the lowering's entry. The lowering and the encoder below
/// never consume `DisplayCommand` or a JSON value.
pub(crate) fn adapt_reader_display_list_v1(
    commands: &[DisplayCommand],
) -> Result<ReaderDisplayListV1, ReaderDisplayListWireError> {
    legacy_adapter::adapt(commands)
}

/// Encodes a lowered primitive list as `RITODL1` format version 2.
pub(crate) fn encode_reader_primitive_list_v1(
    list: &PrimitiveList,
) -> Result<ReaderEncodedDisplayListV1, ReaderDisplayListWireError> {
    let command_count = encode::checked_length(list.commands.len(), "primitive")?;
    let bytes = encode::encode_primitive_list(list)?;
    let semantic_digest = Sha256::digest(&bytes).into();
    let (image_hrefs, font_families) = collect_primitive_refs(list);
    Ok(ReaderEncodedDisplayListV1 {
        format_version: READER_PRIMITIVE_LIST_FORMAT_VERSION,
        command_count,
        semantic_digest,
        bytes,
        image_hrefs,
        font_families,
    })
}

fn collect_primitive_refs(list: &PrimitiveList) -> (Vec<String>, Vec<String>) {
    let mut images = BTreeSet::new();
    let mut families = BTreeSet::new();
    for primitive in &list.commands {
        match primitive {
            Primitive::DrawImage { src, .. } => {
                images.insert(src.clone());
            }
            Primitive::Text(text) | Primitive::Ruby(text) if !text.paint.font.family.is_empty() => {
                families.insert(text.paint.font.family.clone());
            }
            _ => {}
        }
    }
    (images.into_iter().collect(), families.into_iter().collect())
}

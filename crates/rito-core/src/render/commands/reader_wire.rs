use std::{collections::BTreeSet, error::Error, fmt};

use sha2::{Digest, Sha256};

use crate::render::lower::{Primitive, PrimitiveList};

pub(crate) mod contract;
#[cfg(test)]
mod decode;
mod encode;
#[cfg(test)]
mod tests;

const READER_DISPLAY_LIST_MAGIC: &[u8; 7] = b"RITODL1";
/// Format 2 is the device-resolved primitive list. Format 1 carried the
/// semantic commands and is no longer written: hosts blit, they do not
/// interpret.
pub(crate) const READER_PRIMITIVE_LIST_FORMAT_VERSION: u32 = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReaderEncodedDisplayList {
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
    NonFiniteNumber,
}

impl fmt::Display for ReaderDisplayListWireError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::LengthOverflow(context) => write!(formatter, "{context} length exceeds u32"),
            Self::NonFiniteNumber => formatter.write_str("display value contains NaN or infinity"),
        }
    }
}

impl Error for ReaderDisplayListWireError {}

/// Encodes a lowered primitive list as `RITODL1` format version 2.
pub(crate) fn encode_reader_primitive_list(
    list: &PrimitiveList,
) -> Result<ReaderEncodedDisplayList, ReaderDisplayListWireError> {
    let command_count = encode::checked_length(list.commands.len(), "primitive")?;
    let bytes = encode::encode_primitive_list(list)?;
    let semantic_digest = Sha256::digest(&bytes).into();
    let (image_hrefs, font_families) = collect_primitive_refs(list);
    Ok(ReaderEncodedDisplayList {
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

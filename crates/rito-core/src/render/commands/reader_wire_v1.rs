use std::{collections::BTreeSet, error::Error, fmt};

use sha2::{Digest, Sha256};

use super::DisplayCommand;
use contract::{ReaderDisplayCommandV1, ReaderDisplayListV1};

mod contract;
#[cfg(test)]
mod decode;
mod encode;
mod legacy_adapter;
#[cfg(test)]
mod tests;

const READER_DISPLAY_LIST_MAGIC: &[u8; 7] = b"RITODL1";
pub(crate) const READER_DISPLAY_LIST_FORMAT_VERSION: u32 = 1;

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
    CommandCountOverflow,
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
            Self::CommandCountOverflow => formatter.write_str("display command count exceeds u32"),
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

/// Temporary provider boundary for the existing JSON-shaped layout commands.
///
/// The primary encoder below never consumes `DisplayCommand` or a JSON value.
/// Removing this adapter is independent of freezing the `RITODL1` schema.
pub(crate) fn encode_reader_display_list_v1(
    commands: &[DisplayCommand],
) -> Result<ReaderEncodedDisplayListV1, ReaderDisplayListWireError> {
    let typed = legacy_adapter::adapt(commands)?;
    encode_typed_reader_display_list_v1(&typed)
}

fn encode_typed_reader_display_list_v1(
    display_list: &ReaderDisplayListV1,
) -> Result<ReaderEncodedDisplayListV1, ReaderDisplayListWireError> {
    let command_count = u32::try_from(display_list.commands.len())
        .map_err(|_| ReaderDisplayListWireError::CommandCountOverflow)?;
    let bytes = encode::encode(display_list)?;
    let semantic_digest = Sha256::digest(&bytes).into();
    let (image_hrefs, font_families) = collect_refs(display_list);
    Ok(ReaderEncodedDisplayListV1 {
        format_version: READER_DISPLAY_LIST_FORMAT_VERSION,
        command_count,
        semantic_digest,
        bytes,
        image_hrefs,
        font_families,
    })
}

fn collect_refs(display_list: &ReaderDisplayListV1) -> (Vec<String>, Vec<String>) {
    let mut images = BTreeSet::new();
    let mut families = BTreeSet::new();
    for command in &display_list.commands {
        match command {
            ReaderDisplayCommandV1::PaintBlock { paint, .. } => {
                if let Some(image) = paint
                    .background
                    .as_ref()
                    .and_then(|background| background.image.as_ref())
                {
                    images.insert(image.clone());
                }
            }
            ReaderDisplayCommandV1::PaintText(input) | ReaderDisplayCommandV1::PaintRuby(input)
                if !input.paint.font.family.is_empty() =>
            {
                families.insert(input.paint.font.family.clone());
            }
            ReaderDisplayCommandV1::PaintImage { src, .. } => {
                images.insert(src.clone());
            }
            _ => {}
        }
    }
    (images.into_iter().collect(), families.into_iter().collect())
}

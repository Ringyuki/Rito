//! The session's fonts on the wire: `RITOFNT1` carries the font catalog
//! and `RITOFNN1` a list of family names (the names a `font-family` list
//! would skip).
//!
//! A family is its name, its source (`0` host, `1` publication), its
//! generic role (`0` none, `1` serif, `2` sans-serif, `3` monospace), an
//! optional language and its faces; a face is its weight, its style and an
//! optional SHA-256 (a host face's removal handle).

use crate::runtime::{
    RuntimeFontCatalog, RuntimeFontFamily, RuntimeFontFamilyFace, RuntimeFontSource,
    RuntimePinnedFontGenericRole,
};

use super::primitives::{invalid, Reader, Writer};
use super::READER_WIRE_VERSION;
use crate::runtime::reader_session::ReaderError;

pub const READER_FONT_CATALOG_WIRE_MAGIC: [u8; 8] = *b"RITOFNT1";
pub const READER_FONT_NAMES_WIRE_MAGIC: [u8; 8] = *b"RITOFNN1";

pub fn encode_reader_font_catalog(catalog: &RuntimeFontCatalog) -> Result<Vec<u8>, ReaderError> {
    let mut writer = Writer::message(READER_FONT_CATALOG_WIRE_MAGIC, READER_WIRE_VERSION);
    writer.count(catalog.families.len(), "font families")?;
    for family in &catalog.families {
        writer.string(&family.name, "font family name")?;
        writer.u32(match family.source {
            RuntimeFontSource::Host => 0,
            RuntimeFontSource::Publication => 1,
        });
        writer.u32(match family.generic_role {
            None => 0,
            Some(RuntimePinnedFontGenericRole::Serif) => 1,
            Some(RuntimePinnedFontGenericRole::SansSerif) => 2,
            Some(RuntimePinnedFontGenericRole::Monospace) => 3,
        });
        writer.option(family.language.as_deref(), |writer, language| {
            writer.string(language, "font family language")
        })?;
        writer.count(family.faces.len(), "font faces")?;
        for face in &family.faces {
            writer.u16(face.weight);
            writer.string(&face.style, "font face style")?;
            writer.option(face.sha256.as_deref(), |writer, sha256| {
                writer.string(sha256, "font face sha256")
            })?;
        }
    }
    writer.finish_message()
}

pub fn decode_reader_font_catalog(bytes: &[u8]) -> Result<RuntimeFontCatalog, ReaderError> {
    let mut reader = Reader::message(bytes, READER_FONT_CATALOG_WIRE_MAGIC, READER_WIRE_VERSION)?;
    let families = reader.collection("font families", |reader| {
        Ok(RuntimeFontFamily {
            name: reader.string("font family name")?,
            source: match reader.u32()? {
                0 => RuntimeFontSource::Host,
                1 => RuntimeFontSource::Publication,
                tag => return Err(invalid(format!("unknown font source: {tag}"))),
            },
            generic_role: match reader.u32()? {
                0 => None,
                1 => Some(RuntimePinnedFontGenericRole::Serif),
                2 => Some(RuntimePinnedFontGenericRole::SansSerif),
                3 => Some(RuntimePinnedFontGenericRole::Monospace),
                tag => return Err(invalid(format!("unknown generic role: {tag}"))),
            },
            language: reader.option("font family language", |reader| {
                reader.string("font family language")
            })?,
            faces: reader.collection("font faces", |reader| {
                Ok(RuntimeFontFamilyFace {
                    weight: reader.u16()?,
                    style: reader.string("font face style")?,
                    sha256: reader.option("font face sha256", |reader| {
                        reader.string("font face sha256")
                    })?,
                })
            })?,
        })
    })?;
    reader.finish("font catalog wire message")?;
    Ok(RuntimeFontCatalog { families })
}

pub fn encode_reader_font_names(names: &[String]) -> Result<Vec<u8>, ReaderError> {
    let mut writer = Writer::message(READER_FONT_NAMES_WIRE_MAGIC, READER_WIRE_VERSION);
    writer.count(names.len(), "font names")?;
    for name in names {
        writer.string(name, "font name")?;
    }
    writer.finish_message()
}

pub fn decode_reader_font_names(bytes: &[u8]) -> Result<Vec<String>, ReaderError> {
    let mut reader = Reader::message(bytes, READER_FONT_NAMES_WIRE_MAGIC, READER_WIRE_VERSION)?;
    let names = reader.collection("font names", |reader| reader.string("font name"))?;
    reader.finish("font names wire message")?;
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    pub(crate) fn catalog_fixture() -> RuntimeFontCatalog {
        RuntimeFontCatalog {
            families: vec![
                RuntimeFontFamily {
                    name: "Tinos".to_owned(),
                    source: RuntimeFontSource::Host,
                    generic_role: Some(RuntimePinnedFontGenericRole::Serif),
                    language: Some("und".to_owned()),
                    faces: vec![RuntimeFontFamilyFace {
                        weight: 400,
                        style: "normal".to_owned(),
                        sha256: Some("ab".to_owned()),
                    }],
                },
                RuntimeFontFamily {
                    name: "Book".to_owned(),
                    source: RuntimeFontSource::Publication,
                    generic_role: None,
                    language: None,
                    faces: vec![RuntimeFontFamilyFace {
                        weight: 700,
                        style: "italic".to_owned(),
                        sha256: None,
                    }],
                },
            ],
        }
    }

    /// Byte-for-byte pins shared with the Dart decoder's tests.
    pub(crate) const FONT_CATALOG_HEX: &str = concat!(
        "5249544f464e5431010000006a00000000000000020000000500000054696e6f",
        "7300000000010000000103000000756e64010000009001060000006e6f726d61",
        "6c0102000000616204000000426f6f6b01000000000000000001000000bc0206",
        "0000006974616c696300",
    );
    pub(crate) const FONT_NAMES_HEX: &str = concat!(
        "5249544f464e4e31010000003300000000000000020000000c0000004e6f2053",
        "75636820466163650700000047656f72676961",
    );

    #[test]
    fn font_wires_round_trip_and_are_pinned_byte_for_byte() {
        let catalog = encode_reader_font_catalog(&catalog_fixture()).unwrap();
        assert_eq!(&catalog[..8], b"RITOFNT1");
        assert_eq!(
            decode_reader_font_catalog(&catalog).unwrap(),
            catalog_fixture()
        );
        let names = vec!["No Such Face".to_owned(), "Georgia".to_owned()];
        let names_wire = encode_reader_font_names(&names).unwrap();
        assert_eq!(&names_wire[..8], b"RITOFNN1");
        assert_eq!(decode_reader_font_names(&names_wire).unwrap(), names);
        assert_eq!(hex(&catalog), FONT_CATALOG_HEX);
        assert_eq!(hex(&names_wire), FONT_NAMES_HEX);
    }
}

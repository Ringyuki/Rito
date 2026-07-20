pub const NAME: &str = "resources";
pub const OWNS: &str = "Publication resource lookup, fonts, images, dimensions, and byte ownership";

use std::{
    cmp::Ordering,
    io::{Cursor, Read},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

mod href;

pub(crate) use href::{resolve_resource_href_index, ResourceHrefIndex};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextResourceSummary {
    pub href: String,
    pub text_length: usize,
    pub text_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryResourceSummary {
    pub href: String,
    pub byte_length: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub byte_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicationResources {
    #[serde(default)]
    pub stylesheets: Vec<TextResourceSummary>,
    #[serde(default)]
    pub fonts: Vec<BinaryResourceSummary>,
    #[serde(default)]
    pub images: Vec<BinaryResourceSummary>,
}

impl PublicationResources {
    pub fn total_binary_bytes(&self) -> usize {
        self.fonts
            .iter()
            .chain(self.images.iter())
            .map(|resource| resource.byte_length)
            .sum()
    }

    pub fn image(&self, href: &str) -> Option<&BinaryResourceSummary> {
        self.images.iter().find(|resource| resource.href == href)
    }
}

pub(crate) fn summarize_loaded_publication_resources<'a>(
    stylesheets: impl IntoIterator<Item = (&'a str, &'a str)>,
    fonts: impl IntoIterator<Item = (&'a str, &'a [u8])>,
    images: impl IntoIterator<Item = (&'a str, &'a [u8], Option<u32>, Option<u32>)>,
) -> PublicationResources {
    let stylesheets = stylesheets
        .into_iter()
        .map(|(href, text)| TextResourceSummary {
            href: href.to_owned(),
            text_length: utf16_len(text),
            text_hash: hash_text(text),
        })
        .collect::<Vec<_>>();
    let fonts = fonts
        .into_iter()
        .map(|(href, bytes)| binary_summary(href, bytes))
        .collect::<Vec<_>>();
    let images = images
        .into_iter()
        .map(|(href, bytes, width, height)| BinaryResourceSummary {
            href: href.to_owned(),
            byte_length: bytes.len(),
            byte_hash: Some(hash_bytes(bytes)),
            width,
            height,
        })
        .collect::<Vec<_>>();

    let mut resources = PublicationResources {
        stylesheets,
        fonts,
        images,
    };
    sort_publication_resources(&mut resources);
    resources
}

pub(crate) fn sort_publication_resources(resources: &mut PublicationResources) {
    resources
        .stylesheets
        .sort_by(|left, right| compare_fixture_href(&left.href, &right.href));
    resources
        .fonts
        .sort_by(|left, right| compare_fixture_href(&left.href, &right.href));
    resources
        .images
        .sort_by(|left, right| compare_fixture_href(&left.href, &right.href));
}

fn binary_summary(href: &str, bytes: &[u8]) -> BinaryResourceSummary {
    BinaryResourceSummary {
        href: href.to_owned(),
        byte_length: bytes.len(),
        byte_hash: Some(hash_bytes(bytes)),
        width: None,
        height: None,
    }
}

pub(crate) fn binary_summary_from_metadata(
    href: &str,
    byte_length: usize,
    byte_hash: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
) -> BinaryResourceSummary {
    BinaryResourceSummary {
        href: href.to_owned(),
        byte_length,
        byte_hash,
        width,
        height,
    }
}

pub(crate) fn detect_image_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    image_dimensions(bytes).map(|dimensions| (dimensions.width, dimensions.height))
}

pub(crate) fn detect_image_dimensions_from_reader(
    reader: &mut dyn Read,
) -> std::io::Result<Option<(u32, u32)>> {
    let mut prefix = [0_u8; 24];
    let prefix_length = read_available(reader, &mut prefix)?;
    if let Some(dimensions) = png_dimensions(&prefix[..prefix_length]) {
        return Ok(Some((dimensions.width, dimensions.height)));
    }
    let mut stream = Cursor::new(&prefix[..prefix_length]).chain(reader);
    Ok(jpeg_dimensions_from_reader(&mut stream)?
        .map(|dimensions| (dimensions.width, dimensions.height)))
}

#[derive(Clone, Copy)]
struct ImageDimensions {
    width: u32,
    height: u32,
}

fn image_dimensions(bytes: &[u8]) -> Option<ImageDimensions> {
    png_dimensions(bytes).or_else(|| jpeg_dimensions(bytes))
}

fn png_dimensions(bytes: &[u8]) -> Option<ImageDimensions> {
    const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    if bytes.len() < 24 || bytes[..8] != PNG_SIGNATURE || &bytes[12..16] != b"IHDR" {
        return None;
    }
    Some(ImageDimensions {
        width: read_u32be(bytes, 16)?,
        height: read_u32be(bytes, 20)?,
    })
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<ImageDimensions> {
    if bytes.len() < 4 || bytes[0] != 0xff || bytes[1] != 0xd8 {
        return None;
    }

    let mut offset = 2;
    while offset + 3 < bytes.len() {
        while offset < bytes.len() && bytes[offset] != 0xff {
            offset += 1;
        }
        while offset < bytes.len() && bytes[offset] == 0xff {
            offset += 1;
        }
        if offset >= bytes.len() {
            return None;
        }

        let marker = bytes[offset];
        offset += 1;
        if marker == 0xd9 || marker == 0xda || offset + 1 >= bytes.len() {
            return None;
        }
        let segment_length = read_u16be(bytes, offset)? as usize;
        if segment_length < 2 || offset + segment_length > bytes.len() {
            return None;
        }
        if is_jpeg_sof_marker(marker) && segment_length >= 7 {
            return Some(ImageDimensions {
                height: read_u16be(bytes, offset + 3)? as u32,
                width: read_u16be(bytes, offset + 5)? as u32,
            });
        }
        offset += segment_length;
    }

    None
}

fn jpeg_dimensions_from_reader(reader: &mut dyn Read) -> std::io::Result<Option<ImageDimensions>> {
    let mut signature = [0_u8; 2];
    if !read_exact_or_eof(reader, &mut signature)? || signature != [0xff, 0xd8] {
        return Ok(None);
    }
    loop {
        let Some(marker) = next_jpeg_marker(reader)? else {
            return Ok(None);
        };
        if marker == 0xd9 || marker == 0xda {
            return Ok(None);
        }
        if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            continue;
        }
        let mut length_bytes = [0_u8; 2];
        if !read_exact_or_eof(reader, &mut length_bytes)? {
            return Ok(None);
        }
        let segment_length = usize::from(u16::from_be_bytes(length_bytes));
        if segment_length < 2 {
            return Ok(None);
        }
        let payload_length = segment_length - 2;
        if is_jpeg_sof_marker(marker) {
            let mut header = [0_u8; 5];
            if payload_length < header.len() || !read_exact_or_eof(reader, &mut header)? {
                return Ok(None);
            }
            return Ok(Some(ImageDimensions {
                height: u32::from(u16::from_be_bytes([header[1], header[2]])),
                width: u32::from(u16::from_be_bytes([header[3], header[4]])),
            }));
        }
        if !discard_exact(reader, payload_length)? {
            return Ok(None);
        }
    }
}

fn next_jpeg_marker(reader: &mut dyn Read) -> std::io::Result<Option<u8>> {
    loop {
        let Some(byte) = read_byte(reader)? else {
            return Ok(None);
        };
        if byte != 0xff {
            continue;
        }
        loop {
            let Some(marker) = read_byte(reader)? else {
                return Ok(None);
            };
            if marker == 0xff {
                continue;
            }
            if marker != 0x00 {
                return Ok(Some(marker));
            }
            break;
        }
    }
}

fn read_available(reader: &mut dyn Read, output: &mut [u8]) -> std::io::Result<usize> {
    let mut filled = 0;
    while filled < output.len() {
        let read = reader.read(&mut output[filled..])?;
        if read == 0 {
            break;
        }
        filled += read;
    }
    Ok(filled)
}

fn read_exact_or_eof(reader: &mut dyn Read, output: &mut [u8]) -> std::io::Result<bool> {
    Ok(read_available(reader, output)? == output.len())
}

fn read_byte(reader: &mut dyn Read) -> std::io::Result<Option<u8>> {
    let mut byte = [0_u8; 1];
    Ok(read_exact_or_eof(reader, &mut byte)?.then_some(byte[0]))
}

fn discard_exact(reader: &mut dyn Read, mut remaining: usize) -> std::io::Result<bool> {
    let mut buffer = [0_u8; 8 * 1024];
    while remaining > 0 {
        let length = remaining.min(buffer.len());
        let read = read_available(reader, &mut buffer[..length])?;
        if read != length {
            return Ok(false);
        }
        remaining -= read;
    }
    Ok(true)
}

fn is_jpeg_sof_marker(marker: u8) -> bool {
    matches!(
        marker,
        0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf
    )
}

fn read_u16be(bytes: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_be_bytes(
        bytes.get(offset..offset + 2)?.try_into().ok()?,
    ))
}

fn read_u32be(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_be_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

fn hash_text(text: &str) -> String {
    hash_bytes(text.as_bytes())
}

pub(crate) fn hash_bytes(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

pub(crate) fn is_font_media_type(media_type: &str) -> bool {
    matches!(
        media_type,
        "font/ttf"
            | "font/otf"
            | "font/woff"
            | "font/woff2"
            | "application/x-font-ttf"
            | "application/x-font-woff"
            | "application/font-woff"
            | "application/font-woff2"
            | "application/vnd.ms-opentype"
            | "application/font-sfnt"
    )
}

pub(crate) fn is_image_media_type(media_type: &str) -> bool {
    media_type.starts_with("image/")
}

fn compare_fixture_href(left: &str, right: &str) -> Ordering {
    compare_ascii_locale_like(left, right).then_with(|| left.len().cmp(&right.len()))
}

fn compare_ascii_locale_like(left: &str, right: &str) -> Ordering {
    for (left_char, right_char) in left.chars().zip(right.chars()) {
        if left_char == right_char {
            continue;
        }

        let left_folded = left_char.to_ascii_lowercase();
        let right_folded = right_char.to_ascii_lowercase();
        let folded_order = left_folded.cmp(&right_folded);
        if folded_order != Ordering::Equal {
            return folded_order;
        }

        let left_is_lower = left_char.is_ascii_lowercase();
        let right_is_lower = right_char.is_ascii_lowercase();
        if left_is_lower != right_is_lower {
            return if left_is_lower {
                Ordering::Less
            } else {
                Ordering::Greater
            };
        }

        return left_char.cmp(&right_char);
    }

    Ordering::Equal
}

#[cfg(test)]
mod tests;

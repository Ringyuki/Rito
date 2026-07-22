//! Canonical byte encoding for fragment artifacts.
//!
//! Hand-rolled little-endian encoding with no external dependencies: equal
//! artifacts encode to equal bytes on every platform, which is what lets
//! serialized fragments back cache byte-accounting, cross the wasm/FFI
//! boundary, and be diffed byte-for-byte in determinism tests. Decoding
//! fails closed on truncation, unknown tags, and trailing bytes.

use crate::break_token::{BreakToken, BreakTokenStage};
use crate::context::LayoutOutcome;
use crate::formatting_tree::FormattingNodeId;
use crate::fragment::{
    BoxFragment, Fragment, FragmentRect, FragmentTree, ImageFragment, LineFragment, TextFragment,
};

const FRAGMENT_TAG_BOX: u8 = 0;
const FRAGMENT_TAG_LINE: u8 = 1;
const FRAGMENT_TAG_TEXT: u8 = 2;
const FRAGMENT_TAG_IMAGE: u8 = 3;
const STAGE_TAG_BEFORE: u8 = 0;
const STAGE_TAG_INSIDE: u8 = 1;

/// Encodes one layout outcome (fragments plus optional continuation) into
/// its canonical byte form.
pub fn encode_layout_outcome(outcome: &LayoutOutcome) -> Vec<u8> {
    let mut out = Vec::new();
    encode_fragment(&outcome.fragments.root, &mut out);
    match &outcome.continuation {
        None => out.push(0),
        Some(token) => {
            out.push(1);
            encode_break_token(token, &mut out);
        }
    }
    out
}

/// Decodes a canonical byte form back into a layout outcome.
///
/// Rejects truncated input, unknown tags, and trailing bytes.
pub fn decode_layout_outcome(bytes: &[u8]) -> Result<LayoutOutcome, String> {
    let mut reader = Reader { bytes, at: 0 };
    let root = decode_fragment(&mut reader)?;
    let continuation = match reader.u8()? {
        0 => None,
        1 => Some(decode_break_token(&mut reader)?),
        tag => return Err(format!("unknown continuation tag {tag}")),
    };
    if reader.at != bytes.len() {
        return Err(format!(
            "{} trailing bytes after layout outcome",
            bytes.len() - reader.at
        ));
    }
    Ok(LayoutOutcome {
        fragments: FragmentTree { root },
        continuation,
    })
}

fn encode_fragment(fragment: &Fragment, out: &mut Vec<u8>) {
    match fragment {
        Fragment::Box(fragment) => {
            out.push(FRAGMENT_TAG_BOX);
            out.extend_from_slice(&fragment.source.0.to_le_bytes());
            encode_rect(&fragment.rect, out);
            out.extend_from_slice(&(fragment.children.len() as u32).to_le_bytes());
            for child in &fragment.children {
                encode_fragment(child, out);
            }
        }
        Fragment::Line(fragment) => {
            out.push(FRAGMENT_TAG_LINE);
            out.extend_from_slice(&fragment.source.0.to_le_bytes());
            encode_rect(&fragment.rect, out);
            out.extend_from_slice(&fragment.baseline.to_bits().to_le_bytes());
            out.extend_from_slice(&fragment.trailing_whitespace.to_bits().to_le_bytes());
            out.extend_from_slice(&(fragment.children.len() as u32).to_le_bytes());
            for child in &fragment.children {
                encode_fragment(child, out);
            }
        }
        Fragment::Text(fragment) => {
            out.push(FRAGMENT_TAG_TEXT);
            out.extend_from_slice(&fragment.source.0.to_le_bytes());
            encode_rect(&fragment.rect, out);
            out.extend_from_slice(&fragment.text_start.to_le_bytes());
            out.extend_from_slice(&fragment.text_end.to_le_bytes());
        }
        Fragment::Image(fragment) => {
            out.push(FRAGMENT_TAG_IMAGE);
            out.extend_from_slice(&fragment.source.0.to_le_bytes());
            encode_rect(&fragment.rect, out);
            out.extend_from_slice(&fragment.item_index.to_le_bytes());
        }
    }
}

fn encode_rect(rect: &FragmentRect, out: &mut Vec<u8>) {
    for value in [rect.x, rect.y, rect.width, rect.height] {
        out.extend_from_slice(&value.to_bits().to_le_bytes());
    }
}

fn decode_fragment(reader: &mut Reader<'_>) -> Result<Fragment, String> {
    let tag = reader.u8()?;
    let source = FormattingNodeId(reader.u32()?);
    let rect = decode_rect(reader)?;
    match tag {
        FRAGMENT_TAG_BOX => {
            let child_count = reader.u32()? as usize;
            let mut children = Vec::with_capacity(child_count.min(reader.remaining()));
            for _ in 0..child_count {
                children.push(decode_fragment(reader)?);
            }
            Ok(Fragment::Box(BoxFragment {
                source,
                rect,
                children,
            }))
        }
        FRAGMENT_TAG_LINE => {
            let baseline = reader.f64()?;
            let trailing_whitespace = reader.f64()?;
            let child_count = reader.u32()? as usize;
            let mut children = Vec::with_capacity(child_count.min(reader.remaining()));
            for _ in 0..child_count {
                children.push(decode_fragment(reader)?);
            }
            Ok(Fragment::Line(LineFragment {
                source,
                rect,
                baseline,
                trailing_whitespace,
                children,
            }))
        }
        FRAGMENT_TAG_TEXT => {
            let text_start = reader.u32()?;
            let text_end = reader.u32()?;
            Ok(Fragment::Text(TextFragment {
                source,
                rect,
                text_start,
                text_end,
            }))
        }
        FRAGMENT_TAG_IMAGE => {
            let item_index = reader.u32()?;
            Ok(Fragment::Image(ImageFragment {
                source,
                rect,
                item_index,
            }))
        }
        tag => Err(format!("unknown fragment tag {tag}")),
    }
}

fn decode_rect(reader: &mut Reader<'_>) -> Result<FragmentRect, String> {
    let x = reader.f64()?;
    let y = reader.f64()?;
    let width = reader.f64()?;
    let height = reader.f64()?;
    Ok(FragmentRect {
        x,
        y,
        width,
        height,
    })
}

fn encode_break_token(token: &BreakToken, out: &mut Vec<u8>) {
    out.extend_from_slice(&(token.pending_floats.len() as u32).to_le_bytes());
    for float_break in &token.pending_floats {
        out.extend_from_slice(&float_break.child.0.to_le_bytes());
        encode_break_token(&float_break.token, out);
    }
    out.extend_from_slice(&(token.resume_path.len() as u32).to_le_bytes());
    for node in &token.resume_path {
        out.extend_from_slice(&node.0.to_le_bytes());
    }
    match token.stage {
        BreakTokenStage::Before => out.push(STAGE_TAG_BEFORE),
        BreakTokenStage::Inside {
            consumed_block_size,
        } => {
            out.push(STAGE_TAG_INSIDE);
            out.extend_from_slice(&consumed_block_size.to_bits().to_le_bytes());
        }
    }
}

fn decode_break_token(reader: &mut Reader<'_>) -> Result<BreakToken, String> {
    let float_count = reader.u32()? as usize;
    let mut pending_floats = Vec::with_capacity(float_count.min(reader.remaining()));
    for _ in 0..float_count {
        let child = FormattingNodeId(reader.u32()?);
        let token = decode_break_token(reader)?;
        pending_floats.push(crate::FloatBreak { child, token });
    }
    let path_len = reader.u32()? as usize;
    let mut resume_path = Vec::with_capacity(path_len.min(reader.remaining()));
    for _ in 0..path_len {
        resume_path.push(FormattingNodeId(reader.u32()?));
    }
    let stage = match reader.u8()? {
        STAGE_TAG_BEFORE => BreakTokenStage::Before,
        STAGE_TAG_INSIDE => BreakTokenStage::Inside {
            consumed_block_size: reader.f64()?,
        },
        tag => return Err(format!("unknown break-token stage tag {tag}")),
    };
    Ok(BreakToken {
        resume_path,
        stage,
        pending_floats,
    })
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn remaining(&self) -> usize {
        self.bytes.len() - self.at
    }

    fn take(&mut self, len: usize) -> Result<&[u8], String> {
        let end = self
            .at
            .checked_add(len)
            .filter(|end| *end <= self.bytes.len())
            .ok_or_else(|| "truncated fragment artifact".to_owned())?;
        let slice = &self.bytes[self.at..end];
        self.at = end;
        Ok(slice)
    }

    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }

    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    fn f64(&mut self) -> Result<f64, String> {
        Ok(f64::from_bits(u64::from_le_bytes(
            self.take(8)?.try_into().unwrap(),
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_outcome() -> LayoutOutcome {
        LayoutOutcome {
            fragments: FragmentTree {
                root: Fragment::Box(BoxFragment {
                    source: FormattingNodeId(7),
                    rect: FragmentRect {
                        x: 0.0,
                        y: 0.0,
                        width: 300.0,
                        height: 200.0,
                    },
                    children: vec![
                        Fragment::Box(BoxFragment {
                            source: FormattingNodeId(1),
                            rect: FragmentRect {
                                x: 0.0,
                                y: 0.0,
                                width: 300.0,
                                height: 120.5,
                            },
                            children: Vec::new(),
                        }),
                        Fragment::Box(BoxFragment {
                            source: FormattingNodeId(2),
                            rect: FragmentRect {
                                x: 0.0,
                                y: 120.5,
                                width: 300.0,
                                height: 79.5,
                            },
                            children: Vec::new(),
                        }),
                    ],
                }),
            },
            continuation: Some(BreakToken {
                resume_path: vec![FormattingNodeId(2)],
                stage: BreakTokenStage::Inside {
                    consumed_block_size: 79.5,
                },
                pending_floats: Vec::new(),
            }),
        }
    }

    #[test]
    fn round_trips_identically() {
        let outcome = sample_outcome();
        let bytes = encode_layout_outcome(&outcome);
        assert_eq!(decode_layout_outcome(&bytes).expect("decode"), outcome);
    }

    #[test]
    fn encoding_is_deterministic() {
        let outcome = sample_outcome();
        assert_eq!(
            encode_layout_outcome(&outcome),
            encode_layout_outcome(&outcome.clone())
        );
    }

    #[test]
    fn truncated_input_fails_closed() {
        let bytes = encode_layout_outcome(&sample_outcome());
        for len in 0..bytes.len() {
            assert!(
                decode_layout_outcome(&bytes[..len]).is_err(),
                "prefix of {len} bytes must not decode"
            );
        }
    }

    #[test]
    fn trailing_bytes_fail_closed() {
        let mut bytes = encode_layout_outcome(&sample_outcome());
        bytes.push(0);
        assert!(decode_layout_outcome(&bytes).is_err());
    }

    #[test]
    fn unknown_tags_fail_closed() {
        let mut bytes = encode_layout_outcome(&sample_outcome());
        bytes[0] = 9;
        assert!(decode_layout_outcome(&bytes).is_err());
    }

    fn inline_outcome() -> LayoutOutcome {
        use crate::fragment::{LineFragment, TextFragment};
        LayoutOutcome {
            fragments: FragmentTree {
                root: Fragment::Box(BoxFragment {
                    source: FormattingNodeId(0),
                    rect: FragmentRect {
                        x: 0.0,
                        y: 0.0,
                        width: 200.0,
                        height: 38.0,
                    },
                    children: vec![Fragment::Line(LineFragment {
                        source: FormattingNodeId(0),
                        rect: FragmentRect {
                            x: 0.0,
                            y: 0.0,
                            width: 180.5,
                            height: 19.0,
                        },
                        baseline: 14.8,
                        trailing_whitespace: 4.25,
                        children: vec![Fragment::Text(TextFragment {
                            source: FormattingNodeId(0),
                            rect: FragmentRect {
                                x: 0.0,
                                y: 0.0,
                                width: 178.25,
                                height: 19.0,
                            },
                            text_start: 0,
                            text_end: 42,
                        })],
                    })],
                }),
            },
            continuation: None,
        }
    }

    #[test]
    fn line_and_text_fragments_round_trip() {
        let outcome = inline_outcome();
        let bytes = encode_layout_outcome(&outcome);
        assert_eq!(decode_layout_outcome(&bytes).expect("decode"), outcome);
        for len in 0..bytes.len() {
            assert!(
                decode_layout_outcome(&bytes[..len]).is_err(),
                "prefix of {len} bytes must not decode"
            );
        }
    }
}

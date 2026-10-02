//! The fixed shard envelope: a 68-byte little-endian header followed by the
//! payload, sealed with XChaCha20-Poly1305 when the shard is encrypted. The
//! whole header is the AEAD's associated data, so a ciphertext cannot be
//! moved under another book, shard id or kind.

use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};

use super::{ShardKey, ShardKind, SHARD_FORMAT_VERSION, SHARD_MAGIC};
use crate::epub::{EpubError, EpubResult};

pub(super) const HEADER_BYTES: usize = 68;
const NONCE_BYTES: usize = 24;
const TAG_BYTES: usize = 16;
const CIPHER_NONE: u8 = 0;
const CIPHER_XCHACHA20_POLY1305: u8 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct ShardHeader {
    pub(super) kind: ShardKind,
    pub(super) encrypted: bool,
    pub(super) book_id: [u8; 16],
    pub(super) shard_id: u32,
    pub(super) nonce: [u8; NONCE_BYTES],
}

impl ShardHeader {
    fn encode(&self, payload_bytes: u64) -> [u8; HEADER_BYTES] {
        let mut header = [0u8; HEADER_BYTES];
        header[0..8].copy_from_slice(SHARD_MAGIC);
        header[8..12].copy_from_slice(&SHARD_FORMAT_VERSION.to_le_bytes());
        header[12] = match self.kind {
            ShardKind::Skeleton => 0,
            ShardKind::Content => 1,
        };
        header[13] = if self.encrypted {
            CIPHER_XCHACHA20_POLY1305
        } else {
            CIPHER_NONE
        };
        header[16..32].copy_from_slice(&self.book_id);
        header[32..36].copy_from_slice(&self.shard_id.to_le_bytes());
        header[36..60].copy_from_slice(&self.nonce);
        header[60..68].copy_from_slice(&payload_bytes.to_le_bytes());
        header
    }

    fn decode(bytes: &[u8]) -> EpubResult<(Self, u64)> {
        let header = bytes
            .get(..HEADER_BYTES)
            .ok_or_else(|| shard_error("shard is shorter than its header"))?;
        if &header[0..8] != SHARD_MAGIC {
            return Err(shard_error("not a Rito publication shard"));
        }
        let version = u32::from_le_bytes(header[8..12].try_into().expect("four bytes"));
        if version != SHARD_FORMAT_VERSION {
            return Err(shard_error(format!(
                "unsupported shard format version {version} (this engine reads {SHARD_FORMAT_VERSION})"
            )));
        }
        let kind = match header[12] {
            0 => ShardKind::Skeleton,
            1 => ShardKind::Content,
            other => return Err(shard_error(format!("unknown shard kind {other}"))),
        };
        let encrypted = match header[13] {
            CIPHER_NONE => false,
            CIPHER_XCHACHA20_POLY1305 => true,
            other => return Err(shard_error(format!("unknown shard cipher {other}"))),
        };
        if header[14..16] != [0, 0] {
            return Err(shard_error("shard header reserved bytes must be zero"));
        }
        let mut book_id = [0u8; 16];
        book_id.copy_from_slice(&header[16..32]);
        let shard_id = u32::from_le_bytes(header[32..36].try_into().expect("four bytes"));
        let mut nonce = [0u8; NONCE_BYTES];
        nonce.copy_from_slice(&header[36..60]);
        let payload_bytes = u64::from_le_bytes(header[60..68].try_into().expect("eight bytes"));
        if (kind == ShardKind::Skeleton) != (shard_id == 0) {
            return Err(shard_error("shard id 0 is reserved for the skeleton shard"));
        }
        if !encrypted && nonce != [0u8; NONCE_BYTES] {
            return Err(shard_error("a plain shard carries a zero nonce"));
        }
        Ok((
            Self {
                kind,
                encrypted,
                book_id,
                shard_id,
                nonce,
            },
            payload_bytes,
        ))
    }
}

/// Seals `payload` into one shard. `key` and `nonce` are both present for an
/// encrypted shard and both absent for a plain one.
pub(super) fn seal_shard(
    header: ShardHeader,
    payload: &[u8],
    key: Option<&ShardKey>,
) -> EpubResult<Vec<u8>> {
    if header.encrypted != key.is_some() {
        return Err(shard_error("an encrypted shard needs exactly one key"));
    }
    let body = match key {
        Some(key) => {
            let sealed_bytes = payload
                .len()
                .checked_add(TAG_BYTES)
                .ok_or_else(|| shard_error("shard payload is too large"))?;
            let aad = header.encode(sealed_bytes as u64);
            cipher(key)
                .encrypt(
                    XNonce::from_slice(&header.nonce),
                    Payload {
                        msg: payload,
                        aad: &aad,
                    },
                )
                .map_err(|_| shard_error("shard encryption failed"))?
        }
        None => payload.to_vec(),
    };
    let mut shard = header.encode(body.len() as u64).to_vec();
    shard.extend_from_slice(&body);
    Ok(shard)
}

/// Verifies and, when encrypted, decrypts one shard.
pub(super) fn open_shard(
    bytes: &[u8],
    key: Option<&ShardKey>,
) -> EpubResult<(ShardHeader, Vec<u8>)> {
    let (header, payload_bytes) = ShardHeader::decode(bytes)?;
    let body = &bytes[HEADER_BYTES..];
    if u64::try_from(body.len()).ok() != Some(payload_bytes) {
        return Err(shard_error("shard length does not match its header"));
    }
    let payload = match (header.encrypted, key) {
        (true, Some(key)) => cipher(key)
            .decrypt(
                XNonce::from_slice(&header.nonce),
                Payload {
                    msg: body,
                    aad: &bytes[..HEADER_BYTES],
                },
            )
            .map_err(|_| {
                shard_error(format!(
                    "shard {} failed authentication: wrong key or altered bytes",
                    header.shard_id
                ))
            })?,
        (true, None) => {
            return Err(shard_error(format!(
                "shard {} is encrypted and no key was given",
                header.shard_id
            )))
        }
        (false, Some(_)) => {
            return Err(shard_error(format!(
                "shard {} is not encrypted but a key was given",
                header.shard_id
            )))
        }
        (false, None) => body.to_vec(),
    };
    Ok((header, payload))
}

fn cipher(key: &ShardKey) -> XChaCha20Poly1305 {
    XChaCha20Poly1305::new(key.as_bytes().into())
}

pub(super) fn shard_error(message: impl Into<String>) -> EpubError {
    EpubError::new(format!("invalid publication shard: {}", message.into()))
}

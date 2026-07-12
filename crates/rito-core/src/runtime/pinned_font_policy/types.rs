use serde::{Deserialize, Serialize};

use crate::epub::{EpubError, EpubResult};

pub const RUNTIME_PINNED_FONT_POLICY_SCHEMA_VERSION: u32 = 1;

/// Generic CSS family role occupied by one pinned fallback face.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimePinnedFontGenericRole {
    Serif,
    SansSerif,
    /// Reserved in v1 so a later policy does not need a new role schema.
    Monospace,
}

/// Validated, lowercase language selector used by a pinned fallback face.
///
/// This intentionally accepts a conservative BCP47-style subset: an ASCII
/// tag up to 63 bytes, made of non-empty alphanumeric subtags of at most eight
/// bytes separated by `-`. Case is normalized so selectors are canonical.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RuntimePinnedFontLanguageTag(String);

impl RuntimePinnedFontLanguageTag {
    pub fn parse(value: &str) -> EpubResult<Self> {
        if value.is_empty()
            || value.len() > 63
            || !value.is_ascii()
            || value.split('-').any(|subtag| {
                subtag.is_empty()
                    || subtag.len() > 8
                    || !subtag.bytes().all(|byte| byte.is_ascii_alphanumeric())
            })
        {
            return Err(EpubError::new(
                "pinned font face language must be an ASCII BCP47-style tag",
            ));
        }
        Ok(Self(value.to_ascii_lowercase()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for RuntimePinnedFontLanguageTag {
    fn default() -> Self {
        Self("und".to_owned())
    }
}

impl TryFrom<&str> for RuntimePinnedFontLanguageTag {
    type Error = EpubError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::parse(value)
    }
}

impl TryFrom<String> for RuntimePinnedFontLanguageTag {
    type Error = EpubError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(&value)
    }
}

/// Owned face input accepted only when opting into a pinned runtime font policy.
///
/// An absent language means `und`. Style and weight are fixed to `normal` and
/// `400` in policy schema v1.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimePinnedFontFaceInput {
    pub bytes: Vec<u8>,
    pub expected_sha256: String,
    pub generic_role: RuntimePinnedFontGenericRole,
    pub language: Option<RuntimePinnedFontLanguageTag>,
}

/// Version-one pinned fallback face set supplied when a runtime document opens.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimePinnedFontPolicyInput {
    pub faces: Vec<RuntimePinnedFontFaceInput>,
}

/// Bytes-free accepted face metadata for the later WASM open handshake.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePinnedFontFaceSummary {
    pub sha256: String,
    pub shape_fingerprint: String,
    pub family_alias: String,
    pub byte_length: usize,
    pub generic_role: RuntimePinnedFontGenericRole,
    pub language: String,
    pub style: String,
    pub weight: u16,
}

/// Canonical, bytes-free identity of the document-lifetime pinned font set.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePinnedFontPolicySummary {
    pub schema_version: u32,
    pub policy_id: String,
    pub faces: Vec<RuntimePinnedFontFaceSummary>,
}

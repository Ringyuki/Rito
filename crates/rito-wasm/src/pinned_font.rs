use std::collections::BTreeSet;

use rito_core::runtime::{
    RuntimeDocument, RuntimePinnedFontFaceInput, RuntimePinnedFontGenericRole,
    RuntimePinnedFontLanguageTag, RuntimePinnedFontPolicyInput,
    RUNTIME_PINNED_FONT_POLICY_SCHEMA_VERSION,
};
use serde::{de::Error as _, Deserialize, Deserializer};

use crate::{wire::serialize_json, WasmRuntimeDocument, WasmRuntimeError};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PinnedFontPolicyMetadata {
    schema_version: u32,
    faces: Vec<PinnedFontFaceMetadata>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PinnedFontFaceMetadata {
    expected_sha256: String,
    generic_role: RuntimePinnedFontGenericRole,
    #[serde(default, deserialize_with = "deserialize_language")]
    language: MetadataLanguage,
}

pub(crate) struct ValidatedPinnedFontPolicyMetadata {
    faces: Vec<ValidatedPinnedFontFaceMetadata>,
}

struct ValidatedPinnedFontFaceMetadata {
    expected_sha256: String,
    generic_role: RuntimePinnedFontGenericRole,
    language: Option<RuntimePinnedFontLanguageTag>,
}

#[derive(Default)]
enum MetadataLanguage {
    #[default]
    Missing,
    Value(String),
}

impl WasmRuntimeDocument {
    pub fn open_with_pinned_font_policy(
        bytes: Vec<u8>,
        metadata_json: &str,
        face_bytes: Vec<Vec<u8>>,
    ) -> Result<Self, WasmRuntimeError> {
        let metadata = validate_pinned_font_policy_metadata(metadata_json, face_bytes.len())?;
        Self::open_with_validated_pinned_font_policy(bytes, metadata, face_bytes)
    }

    pub(crate) fn open_with_validated_pinned_font_policy(
        bytes: Vec<u8>,
        metadata: ValidatedPinnedFontPolicyMetadata,
        face_bytes: Vec<Vec<u8>>,
    ) -> Result<Self, WasmRuntimeError> {
        let input = pinned_font_policy_input(metadata, face_bytes);
        RuntimeDocument::open_owned_with_pinned_font_policy(bytes, input)
            .map(Self::from_runtime_document)
            .map_err(WasmRuntimeError::from_engine)
    }

    pub fn pinned_font_policy_json(&self) -> Result<String, WasmRuntimeError> {
        serialize_json(&self.document.pinned_font_policy_summary())
    }
}

pub(crate) fn validate_pinned_font_policy_metadata(
    metadata_json: &str,
    face_count: usize,
) -> Result<ValidatedPinnedFontPolicyMetadata, WasmRuntimeError> {
    let metadata: PinnedFontPolicyMetadata =
        serde_json::from_str(metadata_json).map_err(|error| {
            WasmRuntimeError::bad_request(format!("invalid pinned font policy metadata: {error}"))
        })?;
    if metadata.schema_version != RUNTIME_PINNED_FONT_POLICY_SCHEMA_VERSION {
        return Err(WasmRuntimeError::bad_request(format!(
            "unsupported pinned font policy schemaVersion: {}",
            metadata.schema_version
        )));
    }
    if metadata.faces.is_empty() {
        return Err(WasmRuntimeError::bad_request(
            "pinned font policy must contain at least one face",
        ));
    }
    if metadata.faces.len() != face_count {
        return Err(WasmRuntimeError::bad_request(format!(
            "pinned font policy face count mismatch: metadata={}, bytes={}",
            metadata.faces.len(),
            face_count
        )));
    }
    let faces = metadata
        .faces
        .into_iter()
        .map(validate_pinned_font_face_metadata)
        .collect::<Result<Vec<_>, _>>()?;
    reject_duplicate_pinned_font_faces(&faces)?;
    Ok(ValidatedPinnedFontPolicyMetadata { faces })
}

fn validate_pinned_font_face_metadata(
    metadata: PinnedFontFaceMetadata,
) -> Result<ValidatedPinnedFontFaceMetadata, WasmRuntimeError> {
    let expected_sha256 = validate_expected_sha256(metadata.expected_sha256)?;
    let language = match metadata.language {
        MetadataLanguage::Missing => None,
        MetadataLanguage::Value(value) => Some(
            RuntimePinnedFontLanguageTag::parse(&value)
                .map_err(|error| WasmRuntimeError::bad_request(error.message()))?,
        ),
    };
    Ok(ValidatedPinnedFontFaceMetadata {
        expected_sha256,
        generic_role: metadata.generic_role,
        language,
    })
}

fn validate_expected_sha256(value: String) -> Result<String, WasmRuntimeError> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(WasmRuntimeError::bad_request(
            "pinned font face expected SHA-256 must contain 64 hexadecimal digits",
        ));
    }
    Ok(value.to_ascii_lowercase())
}

fn reject_duplicate_pinned_font_faces(
    faces: &[ValidatedPinnedFontFaceMetadata],
) -> Result<(), WasmRuntimeError> {
    let mut hashes = BTreeSet::new();
    let mut selectors = BTreeSet::new();
    for face in faces {
        let language = face
            .language
            .as_ref()
            .map_or("und", RuntimePinnedFontLanguageTag::as_str);
        if !hashes.insert(face.expected_sha256.as_str()) {
            return Err(WasmRuntimeError::bad_request(
                "pinned font policy contains a duplicate face SHA-256",
            ));
        }
        if !selectors.insert((face.generic_role, language)) {
            return Err(WasmRuntimeError::bad_request(
                "pinned font policy contains a duplicate generic role and language",
            ));
        }
    }
    Ok(())
}

pub(crate) fn pinned_font_policy_input(
    metadata: ValidatedPinnedFontPolicyMetadata,
    face_bytes: Vec<Vec<u8>>,
) -> RuntimePinnedFontPolicyInput {
    debug_assert_eq!(metadata.faces.len(), face_bytes.len());
    let faces = metadata
        .faces
        .into_iter()
        .zip(face_bytes)
        .map(|(metadata, bytes)| RuntimePinnedFontFaceInput {
            bytes,
            expected_sha256: metadata.expected_sha256,
            generic_role: metadata.generic_role,
            language: metadata.language,
        })
        .collect();
    RuntimePinnedFontPolicyInput { faces }
}

fn deserialize_language<'de, D>(deserializer: D) -> Result<MetadataLanguage, D::Error>
where
    D: Deserializer<'de>,
{
    let value = String::deserialize(deserializer)
        .map_err(|_| D::Error::custom("language must be a string when present"))?;
    Ok(MetadataLanguage::Value(value))
}

//! The host faces a session opens with or is given later, as a page hands
//! them over: their metadata as JSON and their bytes as an array of
//! `Uint8Array`s. What is malformed here is an invalid request and never
//! reaches the engine; the engine checks the bytes against their digests.

use std::collections::BTreeSet;

use js_sys::{Array, Uint8Array};
use rito_core::runtime::{
    RuntimePinnedFontFaceInput, RuntimePinnedFontGenericRole, RuntimePinnedFontLanguageTag,
    RuntimePinnedFontPolicyInput, RUNTIME_PINNED_FONT_POLICY_SCHEMA_VERSION,
};
use serde::{de::Error as _, Deserialize, Deserializer};
use wasm_bindgen::{JsCast, JsValue};

use super::{ProjectionResult, ReaderProjectionError, ReaderProjectionErrorCode};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FacesMetadata {
    schema_version: u32,
    faces: Vec<FaceMetadata>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FaceMetadata {
    expected_sha256: String,
    generic_role: RuntimePinnedFontGenericRole,
    #[serde(default, deserialize_with = "deserialize_language")]
    language: MetadataLanguage,
}

#[derive(Default)]
enum MetadataLanguage {
    #[default]
    Missing,
    Value(String),
}

/// A face's metadata, checked; its bytes join it once copied out of the page.
struct ValidatedFace {
    expected_sha256: String,
    generic_role: RuntimePinnedFontGenericRole,
    language: Option<RuntimePinnedFontLanguageTag>,
}

/// The policy a session opens with: one face for each generic role and
/// language it names.
pub(super) fn opening_policy(
    metadata_json: &str,
    face_bytes: JsValue,
) -> ProjectionResult<RuntimePinnedFontPolicyInput> {
    faces(metadata_json, face_bytes, true).map(|faces| RuntimePinnedFontPolicyInput { faces })
}

/// Faces added to an open session: the contract of an open's policy,
/// except that a face may share its generic role and language with another
/// (a second serif family for Chinese is a choice, not a conflict).
pub(super) fn added_faces(
    metadata_json: &str,
    face_bytes: JsValue,
) -> ProjectionResult<Vec<RuntimePinnedFontFaceInput>> {
    faces(metadata_json, face_bytes, false)
}

fn faces(
    metadata_json: &str,
    face_bytes: JsValue,
    unique_selectors: bool,
) -> ProjectionResult<Vec<RuntimePinnedFontFaceInput>> {
    if !Array::is_array(&face_bytes) {
        return Err(invalid(
            "pinned font face bytes must be an array of Uint8Array values",
        ));
    }
    let face_bytes = Array::from(&face_bytes);
    let metadata = validate_metadata(
        metadata_json,
        face_bytes.length() as usize,
        unique_selectors,
    )?;
    let mut bytes = Vec::with_capacity(metadata.len());
    for (index, value) in face_bytes.iter().enumerate() {
        if !value.is_instance_of::<Uint8Array>() {
            return Err(invalid(format!(
                "pinned font face bytes at index {index} must be a Uint8Array"
            )));
        }
        let face = Uint8Array::new(&value);
        if face.length() == 0 {
            return Err(invalid(format!(
                "pinned font face bytes at index {index} must not be empty"
            )));
        }
        bytes.push(face.to_vec());
    }
    Ok(metadata
        .into_iter()
        .zip(bytes)
        .map(|(face, bytes)| RuntimePinnedFontFaceInput {
            bytes,
            expected_sha256: face.expected_sha256,
            generic_role: face.generic_role,
            language: face.language,
        })
        .collect())
}

fn validate_metadata(
    metadata_json: &str,
    face_count: usize,
    unique_selectors: bool,
) -> ProjectionResult<Vec<ValidatedFace>> {
    let metadata: FacesMetadata = serde_json::from_str(metadata_json)
        .map_err(|error| invalid(format!("invalid pinned font policy metadata: {error}")))?;
    if metadata.schema_version != RUNTIME_PINNED_FONT_POLICY_SCHEMA_VERSION {
        return Err(invalid(format!(
            "unsupported pinned font policy schemaVersion: {}",
            metadata.schema_version
        )));
    }
    if metadata.faces.is_empty() {
        return Err(invalid("pinned font policy must contain at least one face"));
    }
    if metadata.faces.len() != face_count {
        return Err(invalid(format!(
            "pinned font policy face count mismatch: metadata={}, bytes={}",
            metadata.faces.len(),
            face_count
        )));
    }
    let faces = metadata
        .faces
        .into_iter()
        .map(validate_face)
        .collect::<Result<Vec<_>, _>>()?;
    reject_duplicates(&faces, unique_selectors)?;
    Ok(faces)
}

fn validate_face(metadata: FaceMetadata) -> ProjectionResult<ValidatedFace> {
    let sha256 = metadata.expected_sha256;
    if sha256.len() != 64 || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(invalid(
            "pinned font face expected SHA-256 must contain 64 hexadecimal digits",
        ));
    }
    let language = match metadata.language {
        MetadataLanguage::Missing => None,
        MetadataLanguage::Value(value) => Some(
            RuntimePinnedFontLanguageTag::parse(&value)
                .map_err(|error| invalid(error.message()))?,
        ),
    };
    Ok(ValidatedFace {
        expected_sha256: sha256.to_ascii_lowercase(),
        generic_role: metadata.generic_role,
        language,
    })
}

fn reject_duplicates(faces: &[ValidatedFace], unique_selectors: bool) -> ProjectionResult<()> {
    let mut hashes = BTreeSet::new();
    let mut selectors = BTreeSet::new();
    for face in faces {
        let language = face
            .language
            .as_ref()
            .map_or("und", RuntimePinnedFontLanguageTag::as_str);
        if !hashes.insert(face.expected_sha256.as_str()) {
            return Err(invalid(
                "pinned font policy contains a duplicate face SHA-256",
            ));
        }
        if unique_selectors && !selectors.insert((face.generic_role, language)) {
            return Err(invalid(
                "pinned font policy contains a duplicate generic role and language",
            ));
        }
    }
    Ok(())
}

fn deserialize_language<'de, D>(deserializer: D) -> Result<MetadataLanguage, D::Error>
where
    D: Deserializer<'de>,
{
    let value = String::deserialize(deserializer)
        .map_err(|_| D::Error::custom("language must be a string when present"))?;
    Ok(MetadataLanguage::Value(value))
}

fn invalid(message: impl Into<String>) -> ReaderProjectionError {
    ReaderProjectionError {
        code: ReaderProjectionErrorCode::InvalidRequest,
        message: message.into(),
        pending_shards: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SERIF: &str = "abababababababababababababababababababababababababababababababab";
    const OTHER: &str = "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd";

    fn face(sha256: &str, extra: &str) -> String {
        format!(r#"{{"expectedSha256":"{sha256}","genericRole":"serif"{extra}}}"#)
    }

    fn policy(faces: &[String]) -> String {
        format!(r#"{{"schemaVersion":1,"faces":[{}]}}"#, faces.join(","))
    }

    fn refusal(metadata: &str, face_count: usize, unique: bool) -> String {
        let error = validate_metadata(metadata, face_count, unique)
            .err()
            .expect("the metadata is refused");
        assert_eq!(error.code, ReaderProjectionErrorCode::InvalidRequest);
        error.message
    }

    #[test]
    fn metadata_names_each_face_by_a_canonical_digest_role_and_language() {
        let upper = SERIF.to_ascii_uppercase();
        let faces = validate_metadata(
            &policy(&[face(&upper, ""), face(OTHER, r#","language":"zh-Hans""#)]),
            2,
            true,
        )
        .expect("the metadata is accepted");
        assert_eq!(faces[0].expected_sha256, SERIF);
        assert!(faces[0].language.is_none());
        assert_eq!(
            faces[1]
                .language
                .as_ref()
                .map(RuntimePinnedFontLanguageTag::as_str),
            Some("zh-hans")
        );
    }

    #[test]
    fn malformed_metadata_is_an_invalid_request() {
        let one = policy(&[face(SERIF, "")]);
        assert!(refusal("{", 1, true).contains("invalid pinned font policy metadata"));
        assert!(refusal(
            &one.replace("\"schemaVersion\":1", "\"schemaVersion\":2"),
            1,
            true
        )
        .contains("schemaVersion"));
        assert!(refusal(r#"{"schemaVersion":1,"faces":[]}"#, 0, true).contains("at least one"));
        assert!(refusal(&one, 2, true).contains("face count mismatch"));
        assert!(refusal(&policy(&[face("abc", "")]), 1, true).contains("64 hexadecimal"));
        assert!(
            refusal(&policy(&[face(SERIF, r#","language":7"#)]), 1, true)
                .contains("language must be a string")
        );
        assert!(
            refusal(&policy(&[face(SERIF, r#","style":"italic""#)]), 1, true)
                .contains("unknown field")
        );
        assert!(refusal(
            &policy(&[face(SERIF, ""), face(SERIF, r#","language":"ja""#)]),
            2,
            true
        )
        .contains("duplicate face SHA-256"));
    }

    #[test]
    fn two_faces_share_a_role_and_language_only_when_added() {
        let pair = policy(&[face(SERIF, ""), face(OTHER, "")]);
        assert!(refusal(&pair, 2, true).contains("duplicate generic role and language"));
        assert_eq!(
            validate_metadata(&pair, 2, false)
                .expect("added faces may share a role")
                .len(),
            2
        );
    }
}

use std::collections::BTreeSet;

use sha2::{Digest, Sha256};

use crate::epub::{
    open_runtime_document, open_runtime_document_owned, EpubError, EpubResult, LoadedEpubDocument,
};

use super::RuntimeDocument;

mod types;
mod wiring;

pub use types::{
    RuntimePinnedFontFaceInput, RuntimePinnedFontFaceSummary, RuntimePinnedFontGenericRole,
    RuntimePinnedFontLanguageTag, RuntimePinnedFontPolicyInput, RuntimePinnedFontPolicySummary,
    RUNTIME_PINNED_FONT_POLICY_SCHEMA_VERSION,
};

const PINNED_FONT_STYLE: &str = "normal";
const PINNED_FONT_WEIGHT: u16 = 400;

#[derive(Debug)]
pub(crate) struct RuntimePinnedFontFace {
    pub(crate) bytes: Vec<u8>,
    summary: RuntimePinnedFontFaceSummary,
    sha256_bytes: [u8; 32],
}

#[derive(Debug)]
pub(crate) struct RuntimePinnedFontPolicy {
    faces: Vec<RuntimePinnedFontFace>,
    identity: Vec<u8>,
    policy_id: String,
}

impl RuntimePinnedFontPolicy {
    pub(crate) fn empty() -> Self {
        Self::from_faces(Vec::new())
    }

    pub(crate) fn from_input(input: RuntimePinnedFontPolicyInput) -> EpubResult<Self> {
        if input.faces.is_empty() {
            return Err(EpubError::new(
                "pinned font policy must contain at least one face",
            ));
        }
        let mut faces = input
            .faces
            .into_iter()
            .map(validate_face)
            .collect::<EpubResult<Vec<_>>>()?;
        faces.sort_unstable_by(|left, right| face_sort_key(left).cmp(&face_sort_key(right)));
        reject_duplicate_faces(&faces)?;
        Ok(Self::from_faces(faces))
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.faces.is_empty()
    }

    pub(crate) fn identity(&self) -> &[u8] {
        &self.identity
    }

    pub(crate) fn summary(&self) -> RuntimePinnedFontPolicySummary {
        RuntimePinnedFontPolicySummary {
            schema_version: RUNTIME_PINNED_FONT_POLICY_SCHEMA_VERSION,
            policy_id: self.policy_id.clone(),
            faces: self
                .faces
                .iter()
                .map(|face| {
                    let mut summary = face.summary.clone();
                    summary.byte_length = face.bytes.len();
                    summary
                })
                .collect(),
        }
    }

    fn from_faces(faces: Vec<RuntimePinnedFontFace>) -> Self {
        let identity = policy_identity(&faces);
        let policy_id = sha256_hex(&identity);
        Self {
            faces,
            identity,
            policy_id,
        }
    }
}

impl RuntimeDocument {
    pub fn open_with_pinned_font_policy(
        bytes: &[u8],
        input: RuntimePinnedFontPolicyInput,
    ) -> EpubResult<Self> {
        let policy = RuntimePinnedFontPolicy::from_input(input)?;
        let document = open_runtime_document(bytes)?;
        Ok(Self::from_loaded_document_and_pinned_font_policy(
            document, policy,
        ))
    }

    pub fn open_owned_with_pinned_font_policy(
        bytes: Vec<u8>,
        input: RuntimePinnedFontPolicyInput,
    ) -> EpubResult<Self> {
        let policy = RuntimePinnedFontPolicy::from_input(input)?;
        let document = open_runtime_document_owned(bytes)?;
        Ok(Self::from_loaded_document_and_pinned_font_policy(
            document, policy,
        ))
    }

    pub fn from_loaded_document_with_pinned_font_policy(
        document: LoadedEpubDocument,
        input: RuntimePinnedFontPolicyInput,
    ) -> EpubResult<Self> {
        let policy = RuntimePinnedFontPolicy::from_input(input)?;
        Ok(Self::from_loaded_document_and_pinned_font_policy(
            document, policy,
        ))
    }

    pub fn pinned_font_policy_summary(&self) -> RuntimePinnedFontPolicySummary {
        self.pinned_font_policy.summary()
    }
}

fn validate_face(input: RuntimePinnedFontFaceInput) -> EpubResult<RuntimePinnedFontFace> {
    if input.bytes.is_empty() {
        return Err(EpubError::new("pinned font face bytes must not be empty"));
    }
    let expected = normalized_expected_sha256(&input.expected_sha256)?;
    let digest = Sha256::digest(&input.bytes);
    let sha256_bytes: [u8; 32] = digest.into();
    let actual = hex_bytes(&sha256_bytes);
    if expected != actual {
        return Err(EpubError::new(format!(
            "pinned font face SHA-256 mismatch: expected {expected}, got {actual}"
        )));
    }
    ttf_parser::Face::parse(&input.bytes, 0)
        .map_err(|_| EpubError::new("pinned font face is not a parseable TTF/OTF face 0"))?;
    if rustybuzz::Face::from_slice(&input.bytes, 0).is_none() {
        return Err(EpubError::new(
            "pinned font face is not shapeable as TTF/OTF face 0",
        ));
    }
    let language = input.language.unwrap_or_default().as_str().to_owned();
    let shape_fingerprint = hex_bytes(&sha256_bytes[..8]);
    let summary = RuntimePinnedFontFaceSummary {
        family_alias: format!("__RitoPinned_{actual}"),
        sha256: actual,
        shape_fingerprint,
        byte_length: input.bytes.len(),
        generic_role: input.generic_role,
        language,
        style: PINNED_FONT_STYLE.to_owned(),
        weight: PINNED_FONT_WEIGHT,
    };
    Ok(RuntimePinnedFontFace {
        bytes: input.bytes,
        summary,
        sha256_bytes,
    })
}

fn normalized_expected_sha256(value: &str) -> EpubResult<String> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(EpubError::new(
            "pinned font face expected SHA-256 must contain 64 hexadecimal digits",
        ));
    }
    Ok(value.to_ascii_lowercase())
}

fn face_sort_key(face: &RuntimePinnedFontFace) -> (RuntimePinnedFontGenericRole, &str, &str) {
    (
        face.summary.generic_role,
        &face.summary.language,
        &face.summary.sha256,
    )
}

fn reject_duplicate_faces(faces: &[RuntimePinnedFontFace]) -> EpubResult<()> {
    let mut selectors = BTreeSet::new();
    let mut hashes = BTreeSet::new();
    for face in faces {
        let selector = (face.summary.generic_role, face.summary.language.as_str());
        if !selectors.insert(selector) {
            return Err(EpubError::new(
                "pinned font policy contains a duplicate generic role and language",
            ));
        }
        if !hashes.insert(face.summary.sha256.as_str()) {
            return Err(EpubError::new(
                "pinned font policy contains a duplicate face SHA-256",
            ));
        }
    }
    Ok(())
}

fn policy_identity(faces: &[RuntimePinnedFontFace]) -> Vec<u8> {
    let mut identity = Vec::with_capacity(16 + faces.len() * 40);
    identity.extend_from_slice(b"RITO-PINNED-FONT-POLICY\0");
    identity.extend_from_slice(&RUNTIME_PINNED_FONT_POLICY_SCHEMA_VERSION.to_be_bytes());
    identity.extend_from_slice(&(faces.len() as u64).to_be_bytes());
    for face in faces {
        identity.push(role_identity(face.summary.generic_role));
        identity.push(face.summary.language.len() as u8);
        identity.extend_from_slice(face.summary.language.as_bytes());
        identity.push(0); // v1 style: normal
        identity.extend_from_slice(&PINNED_FONT_WEIGHT.to_be_bytes());
        identity.extend_from_slice(&face.sha256_bytes);
    }
    identity
}

fn role_identity(role: RuntimePinnedFontGenericRole) -> u8 {
    match role {
        RuntimePinnedFontGenericRole::Serif => 0,
        RuntimePinnedFontGenericRole::SansSerif => 1,
        RuntimePinnedFontGenericRole::Monospace => 2,
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex_bytes(&Sha256::digest(bytes))
}

fn hex_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

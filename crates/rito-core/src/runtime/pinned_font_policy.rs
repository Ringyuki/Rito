use std::collections::BTreeSet;

use sha2::{Digest, Sha256};

use crate::epub::{
    open_runtime_document, open_runtime_document_from_shards, open_runtime_document_owned,
    shard::ShardKey, EpubError, EpubResult, LoadedEpubDocument,
};

use super::RuntimeDocument;

mod types;

pub use types::{
    RuntimePinnedFontFaceInput, RuntimePinnedFontFaceSummary, RuntimePinnedFontGenericRole,
    RuntimePinnedFontLanguageTag, RuntimePinnedFontPolicyInput, RuntimePinnedFontPolicySummary,
    RUNTIME_PINNED_FONT_POLICY_SCHEMA_VERSION,
};

/// The scheme a pinned face's bytes are read back under: the face is the
/// host's, not the publication's, so it has no package href of its own.
pub const HOST_FONT_HREF_PREFIX: &str = "rito-host-font:";

fn host_font_href(sha256: &str) -> String {
    format!("{HOST_FONT_HREF_PREFIX}{sha256}")
}

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

    /// Adds host faces after the existing ones, in the order given: a face
    /// added at runtime never reorders the faces the policy opened with, so
    /// what every generic resolves to stays put until a list names the new
    /// family. All faces validate before any is added; a face whose bytes
    /// are already present is rejected.
    pub(crate) fn add_faces(&mut self, input: Vec<RuntimePinnedFontFaceInput>) -> EpubResult<()> {
        let added = input
            .into_iter()
            .map(validate_face)
            .collect::<EpubResult<Vec<_>>>()?;
        let mut hashes: BTreeSet<&str> = self
            .faces
            .iter()
            .map(|face| face.summary.sha256.as_str())
            .collect();
        if added
            .iter()
            .any(|face| !hashes.insert(face.summary.sha256.as_str()))
        {
            return Err(EpubError::new("host font face is already registered"));
        }
        let mut faces = std::mem::take(&mut self.faces);
        faces.extend(added);
        *self = Self::from_faces(faces);
        Ok(())
    }

    /// Removes the host faces with these SHA-256 digests; at least one face
    /// must remain, since the engine shapes with host faces only.
    pub(crate) fn remove_faces(&mut self, sha256s: &[String]) -> EpubResult<()> {
        let removed: BTreeSet<String> =
            sha256s.iter().map(|sha| sha.to_ascii_lowercase()).collect();
        if let Some(unknown) = removed
            .iter()
            .find(|sha| !self.faces.iter().any(|face| &face.summary.sha256 == *sha))
        {
            return Err(EpubError::new(format!(
                "no host font face has SHA-256 {unknown}"
            )));
        }
        if self
            .faces
            .iter()
            .all(|face| removed.contains(&face.summary.sha256))
        {
            return Err(EpubError::new("at least one host font face must remain"));
        }
        let mut faces = std::mem::take(&mut self.faces);
        faces.retain(|face| !removed.contains(&face.summary.sha256));
        *self = Self::from_faces(faces);
        Ok(())
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.faces.is_empty()
    }

    /// Every pinned face as the inline engine registers it: bytes, the
    /// generic role it serves, its language and its paint alias, in
    /// policy order.
    pub(crate) fn host_faces(&self) -> Vec<rito_inline::HostFontFace> {
        self.faces
            .iter()
            .map(|face| rito_inline::HostFontFace {
                bytes: face.bytes.clone(),
                family: face.summary.family_name.clone(),
                role: match face.summary.generic_role {
                    RuntimePinnedFontGenericRole::Serif => rito_inline::HostFontRole::Serif,
                    RuntimePinnedFontGenericRole::SansSerif => rito_inline::HostFontRole::SansSerif,
                    RuntimePinnedFontGenericRole::Monospace => rito_inline::HostFontRole::Monospace,
                },
                language: Some(face.summary.language.clone()).filter(|tag| tag != "und"),
                alias: face.summary.family_alias.clone(),
            })
            .collect()
    }

    /// Every pinned face as the required-face catalog lists it for paint:
    /// registered under its alias with its own descriptors, its bytes read
    /// back through its host-font href.
    pub(crate) fn required_faces(&self, first_order: usize) -> Vec<super::RuntimeRequiredFontFace> {
        self.faces
            .iter()
            .enumerate()
            .map(|(index, face)| super::RuntimeRequiredFontFace {
                family: face.summary.family_alias.clone(),
                href: host_font_href(&face.summary.sha256),
                style: face.summary.style.clone(),
                weight: face.summary.weight,
                shape_fingerprint: face.summary.shape_fingerprint.clone(),
                byte_length: face.bytes.len(),
                source_order: first_order + index,
            })
            .collect()
    }

    /// The bytes behind a host-font href.
    pub(crate) fn bytes_for_href(&self, href: &str) -> Option<&[u8]> {
        let sha256 = href.strip_prefix(HOST_FONT_HREF_PREFIX)?;
        self.faces
            .iter()
            .find(|face| face.summary.sha256 == sha256)
            .map(|face| face.bytes.as_slice())
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

    /// Opens a document pinned to the bundled serif text face, the way
    /// every host opens one: the fragment engine shapes with pinned faces
    /// only, so a test that paginates must pin at least one.
    #[cfg(test)]
    pub(crate) fn open_pinned_for_tests(bytes: &[u8]) -> EpubResult<Self> {
        let font = std::fs::read(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../apps/reader/src/assets/fonts/Tinos-Regular.ttf"),
        )
        .expect("bundled serif text font reads");
        let expected_sha256 = {
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            hasher.update(&font);
            hasher
                .finalize()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        };
        Self::open_with_pinned_font_policy(
            bytes,
            RuntimePinnedFontPolicyInput {
                faces: vec![RuntimePinnedFontFaceInput {
                    bytes: font,
                    expected_sha256,
                    generic_role: RuntimePinnedFontGenericRole::Serif,
                    language: None,
                }],
            },
        )
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

    /// Opens a publication from its skeleton shard; images, audio and video
    /// arrive later through [`RuntimeDocument::supply_shard`].
    pub fn open_shards_with_pinned_font_policy(
        skeleton: &[u8],
        key: Option<&ShardKey>,
        input: RuntimePinnedFontPolicyInput,
    ) -> EpubResult<Self> {
        let policy = RuntimePinnedFontPolicy::from_input(input)?;
        let document = open_runtime_document_from_shards(skeleton, key)?;
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
    let parsed = ttf_parser::Face::parse(&input.bytes, 0)
        .map_err(|_| EpubError::new("pinned font face is not a parseable TTF/OTF face 0"))?;
    if !parsed.variation_axes().is_empty() {
        return Err(EpubError::new(
            "the pinned font policy does not support variable font faces",
        ));
    }
    if rustybuzz::Face::from_slice(&input.bytes, 0).is_none() {
        return Err(EpubError::new(
            "pinned font face is not shapeable as TTF/OTF face 0",
        ));
    }
    let family_name = rito_inline::font_family_name(&input.bytes)
        .ok_or_else(|| EpubError::new("pinned font face declares no family name"))?;
    let language = input.language.unwrap_or_default().as_str().to_owned();
    let shape_fingerprint = hex_bytes(&sha256_bytes[..8]);
    let summary = RuntimePinnedFontFaceSummary {
        family_alias: format!("__RitoPinned_{actual}"),
        sha256: actual,
        family_name,
        shape_fingerprint,
        byte_length: input.bytes.len(),
        generic_role: input.generic_role,
        language,
        // The face's own weight and slope: paint registers it under its
        // alias with these, so the renderer synthesizes bold or italic
        // exactly where the requested style exceeds the face.
        style: if parsed.is_italic() {
            "italic"
        } else {
            "normal"
        }
        .to_owned(),
        weight: parsed.weight().to_number(),
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
        identity.push(u8::from(face.summary.style == "italic"));
        identity.extend_from_slice(&face.summary.weight.to_be_bytes());
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

//! The fonts a document shapes with, as a host sees them: the families a
//! `font-family` list can name, host faces added and removed at runtime,
//! and the names a list would skip because nothing answers to them.

use std::cell::OnceCell;

use serde::{Deserialize, Serialize};

use crate::epub::{parse_font_family_list, publication_font_face_catalog, EpubResult};

use super::{
    RuntimeDocument, RuntimePinnedFontFaceInput, RuntimePinnedFontGenericRole,
    RuntimePinnedFontPolicySummary,
};

/// Every family a `font-family` list can name in this document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFontCatalog {
    pub families: Vec<RuntimeFontFamily>,
}

/// One nameable family: where it comes from, the generic family and the
/// language a host face serves, and the faces it holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFontFamily {
    pub name: String,
    pub source: RuntimeFontSource,
    /// The generic family a host family serves; `None` for a publication's.
    pub generic_role: Option<RuntimePinnedFontGenericRole>,
    /// A host family's language (`und` serves every language); `None` for
    /// a publication's.
    pub language: Option<String>,
    pub faces: Vec<RuntimeFontFamilyFace>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeFontSource {
    /// A face the host registered (the pinned policy and later additions).
    Host,
    /// An `@font-face` binding of the publication.
    Publication,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeFontFamilyFace {
    pub weight: u16,
    pub style: String,
    /// A host face's SHA-256, the handle it is removed by.
    pub sha256: Option<String>,
}

const GENERIC_FAMILIES: &[&str] = &[
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "ui-serif",
    "ui-sans-serif",
    "ui-monospace",
    "ui-rounded",
    "emoji",
    "math",
    "fangsong",
];

impl RuntimeDocument {
    /// Every family a `font-family` list can name: the host's, by the
    /// family their name tables declare, then the publication's `@font-face`
    /// families (a publication family shadows a host family of its name).
    pub fn font_catalog(&self) -> RuntimeFontCatalog {
        let mut families: Vec<RuntimeFontFamily> = Vec::new();
        for face in self.pinned_font_policy.summary().faces {
            let entry = RuntimeFontFamilyFace {
                weight: face.weight,
                style: face.style.clone(),
                sha256: Some(face.sha256.clone()),
            };
            match families.iter_mut().find(|family| {
                family.source == RuntimeFontSource::Host
                    && family.name.eq_ignore_ascii_case(&face.family_name)
                    && family.generic_role == Some(face.generic_role)
                    && family.language.as_deref() == Some(face.language.as_str())
            }) {
                Some(family) => family.faces.push(entry),
                None => families.push(RuntimeFontFamily {
                    name: face.family_name,
                    source: RuntimeFontSource::Host,
                    generic_role: Some(face.generic_role),
                    language: Some(face.language),
                    faces: vec![entry],
                }),
            }
        }
        let publication =
            publication_font_face_catalog(&self.document, self.resolved_font_face_sources());
        for face in publication {
            let entry = RuntimeFontFamilyFace {
                weight: face.weight,
                style: face.style.clone(),
                sha256: None,
            };
            match families.iter_mut().find(|family| {
                family.source == RuntimeFontSource::Publication
                    && family
                        .name
                        .eq_ignore_ascii_case(face.declared_family.trim())
            }) {
                Some(family) => family.faces.push(entry),
                None => families.push(RuntimeFontFamily {
                    name: face.declared_family.trim().to_owned(),
                    source: RuntimeFontSource::Publication,
                    generic_role: None,
                    language: None,
                    faces: vec![entry],
                }),
            }
        }
        RuntimeFontCatalog { families }
    }

    /// The names in a CSS `font-family` list that no family in the catalog
    /// answers to, as written. Layout skips them like a browser skips an
    /// uninstalled family; a host checks a user's choice with this before
    /// applying it, so a typo is reported instead of silently ignored.
    pub fn unresolved_font_families(&self, family_list: &str) -> Vec<String> {
        let catalog = self.font_catalog();
        parse_font_family_list(family_list)
            .into_iter()
            .filter(|name| {
                let lower = name.trim().to_ascii_lowercase();
                !GENERIC_FAMILIES.contains(&lower.as_str())
                    && !catalog
                        .families
                        .iter()
                        .any(|family| family.name.eq_ignore_ascii_case(name.trim()))
            })
            .collect()
    }

    /// Adds host faces after the ones the document opened with. Every
    /// layout key changes, so the next layout request lays out again with
    /// the new faces nameable; nothing already laid out moves.
    pub fn add_host_font_faces(
        &mut self,
        faces: Vec<RuntimePinnedFontFaceInput>,
    ) -> EpubResult<RuntimePinnedFontPolicySummary> {
        self.pinned_font_policy.add_faces(faces)?;
        self.fragment_engine = OnceCell::new();
        Ok(self.pinned_font_policy.summary())
    }

    /// Removes host faces by SHA-256; at least one must remain.
    pub fn remove_host_font_faces(
        &mut self,
        sha256s: &[String],
    ) -> EpubResult<RuntimePinnedFontPolicySummary> {
        self.pinned_font_policy.remove_faces(sha256s)?;
        self.fragment_engine = OnceCell::new();
        Ok(self.pinned_font_policy.summary())
    }
}

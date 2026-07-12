use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};
use zip::ZipArchive;

use crate::runtime::{
    RuntimePinnedFontFaceInput, RuntimePinnedFontGenericRole, RuntimePinnedFontLanguageTag,
    RuntimePinnedFontPolicyInput,
};

pub(super) fn policy(faces: Vec<RuntimePinnedFontFaceInput>) -> RuntimePinnedFontPolicyInput {
    RuntimePinnedFontPolicyInput { faces }
}

pub(super) fn face(
    bytes: Vec<u8>,
    generic_role: RuntimePinnedFontGenericRole,
    language: Option<&str>,
) -> RuntimePinnedFontFaceInput {
    RuntimePinnedFontFaceInput {
        expected_sha256: sha256_hex(&bytes),
        bytes,
        generic_role,
        language: language.map(|value| {
            RuntimePinnedFontLanguageTag::parse(value).expect("fixture language is valid")
        }),
    }
}

pub(super) fn title_font() -> Vec<u8> {
    read_font_from_epub("apps/reader/src/assets/demo.epub", "OEBPS/Fonts/title.ttf")
}

pub(super) fn illustration_font() -> Vec<u8> {
    read_font_from_epub(
        "packages/rito/tests/fixtures/books/book-01.epub",
        "OEBPS/Fonts/illus5.ttf",
    )
}

fn read_font_from_epub(epub_path: &str, font_path: &str) -> Vec<u8> {
    let fixture = workspace_path(epub_path);
    let file = File::open(&fixture)
        .unwrap_or_else(|error| panic!("fixture opens at {}: {error}", fixture.display()));
    let mut archive = ZipArchive::new(file).expect("fixture is an EPUB archive");
    let mut font = archive.by_name(font_path).expect("fixture font exists");
    let mut bytes = Vec::new();
    font.read_to_end(&mut bytes).expect("fixture font reads");
    bytes
}

fn workspace_path(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

pub(super) fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(super) fn short_sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

use std::collections::BTreeSet;

use crate::resources::{detect_image_dimensions, hash_bytes, is_image_media_type};

use super::{archive, join_zip_path, BinaryResourceLoading, LoadedBinaryResource, PackageDocument};
use crate::epub::{archive::ArchiveEntryMetadata, paths::relative_zip_path};

pub(super) fn append_archive_image_resources(
    archive: &mut archive::EpubArchive<'_>,
    package: &PackageDocument,
    opf_dir: &str,
    loading: BinaryResourceLoading,
    images: &mut Vec<LoadedBinaryResource>,
) {
    let declared_entries = declared_image_entry_ids(archive, package, opf_dir);
    let mut logical_hrefs = images
        .iter()
        .map(|image| image.href.clone())
        .collect::<BTreeSet<_>>();

    for entry in archive.file_entries() {
        if declared_entries.contains(&entry.entry_id) {
            continue;
        }
        let Some(media_type) = image_media_type_from_path(&entry.path) else {
            continue;
        };
        let href = relative_zip_path(opf_dir, &entry.path);
        if href.is_empty() || !logical_hrefs.insert(href.clone()) {
            continue;
        }
        if let Some(resource) = load_archive_image(archive, &entry, href, media_type, loading) {
            images.push(resource);
        }
    }
}

fn declared_image_entry_ids(
    archive: &mut archive::EpubArchive<'_>,
    package: &PackageDocument,
    opf_dir: &str,
) -> BTreeSet<usize> {
    package
        .manifest
        .iter()
        .filter(|item| is_image_media_type(&item.media_type))
        .filter_map(|item| {
            archive
                .entry_metadata(&join_zip_path(opf_dir, &item.href))
                .ok()
                .map(|entry| entry.entry_id)
        })
        .collect()
}

fn load_archive_image(
    archive: &mut archive::EpubArchive<'_>,
    entry: &ArchiveEntryMetadata,
    href: String,
    media_type: &'static str,
    loading: BinaryResourceLoading,
) -> Option<LoadedBinaryResource> {
    let bytes = match loading {
        BinaryResourceLoading::Eager => archive.read_entry_bytes(entry).ok()?,
        BinaryResourceLoading::Indexed => Vec::new(),
    };
    let byte_length = if bytes.is_empty() {
        entry.byte_length
    } else {
        bytes.len()
    };
    let byte_hash = (!bytes.is_empty()).then(|| hash_bytes(&bytes));
    let dimensions = detect_image_dimensions(&bytes);
    Some(LoadedBinaryResource {
        href,
        media_type: media_type.to_owned(),
        byte_length,
        byte_hash,
        bytes,
        width: dimensions.map(|(width, _)| width),
        height: dimensions.map(|(_, height)| height),
        dimensions_loaded: dimensions.is_some(),
    })
}

fn image_media_type_from_path(path: &str) -> Option<&'static str> {
    let filename = path.rsplit('/').next()?;
    let (_, extension) = filename.rsplit_once('.')?;
    match extension.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "avif" => Some("image/avif"),
        "bmp" => Some("image/bmp"),
        "svg" => Some("image/svg+xml"),
        "tif" | "tiff" => Some("image/tiff"),
        "ico" => Some("image/x-icon"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::image_media_type_from_path;

    #[test]
    fn matches_the_reference_archive_image_extension_set() {
        for (path, expected) in [
            ("a.JPG", "image/jpeg"),
            ("a.jpeg", "image/jpeg"),
            ("a.png", "image/png"),
            ("a.gif", "image/gif"),
            ("a.webp", "image/webp"),
            ("a.avif", "image/avif"),
            ("a.bmp", "image/bmp"),
            ("a.svg", "image/svg+xml"),
            ("a.tif", "image/tiff"),
            ("a.tiff", "image/tiff"),
            ("a.ico", "image/x-icon"),
        ] {
            assert_eq!(image_media_type_from_path(path), Some(expected), "{path}");
        }
        assert_eq!(image_media_type_from_path("a.txt"), None);
        assert_eq!(image_media_type_from_path("png"), None);
    }
}

use std::collections::BTreeMap;

use crate::resources::BinaryResourceSummary;

#[derive(Debug, Clone, Copy)]
pub(crate) struct ImageSize {
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[derive(Debug)]
pub(crate) struct ImageSizeIndex {
    by_href: BTreeMap<String, ImageSize>,
    by_suffix: BTreeMap<String, Option<ImageSize>>,
    by_basename: BTreeMap<String, Option<ImageSize>>,
}

impl ImageSizeIndex {
    pub(crate) fn new(images: &[BinaryResourceSummary]) -> Self {
        let mut by_href = BTreeMap::new();
        let mut by_suffix = BTreeMap::new();
        let mut by_basename = BTreeMap::new();

        for image in images {
            let Some(width) = image.width else {
                continue;
            };
            let Some(height) = image.height else {
                continue;
            };
            let size = ImageSize {
                width: f64::from(width),
                height: f64::from(height),
            };
            by_href.insert(image.href.clone(), size);

            let parts = image.href.split('/').collect::<Vec<_>>();
            for index in 1..parts.len() {
                let suffix = parts[index..].join("/");
                insert_unique(&mut by_suffix, suffix, size);
            }

            if let Some(basename) = parts.last() {
                insert_unique(&mut by_basename, (*basename).to_owned(), size);
            }
        }

        Self {
            by_href,
            by_suffix,
            by_basename,
        }
    }

    pub(crate) fn resolve(&self, src: &str) -> Option<ImageSize> {
        if let Some(size) = self.by_href.get(src) {
            return Some(*size);
        }

        let normalized = strip_relative_prefix(src);
        if let Some(Some(size)) = self.by_suffix.get(normalized) {
            return Some(*size);
        }
        if normalized != src {
            if let Some(size) = self.by_href.get(normalized) {
                return Some(*size);
            }
        }

        let parts = normalized.split('/').collect::<Vec<_>>();
        for index in 1..parts.len() {
            let suffix = parts[index..].join("/");
            if let Some(size) = self.by_href.get(&suffix) {
                return Some(*size);
            }
        }

        parts
            .last()
            .and_then(|basename| self.by_basename.get(*basename))
            .and_then(|size| *size)
    }
}

fn insert_unique(values: &mut BTreeMap<String, Option<ImageSize>>, key: String, value: ImageSize) {
    use std::collections::btree_map::Entry;

    match values.entry(key) {
        Entry::Occupied(mut entry) => {
            entry.insert(None);
        }
        Entry::Vacant(entry) => {
            entry.insert(Some(value));
        }
    }
}

fn strip_relative_prefix(src: &str) -> &str {
    let mut result = src;
    while let Some(stripped) = result.strip_prefix("../") {
        result = stripped;
    }
    result
}

#[cfg(test)]
mod tests {
    use crate::{layout::image_size::ImageSizeIndex, resources::BinaryResourceSummary};

    fn image(href: &str, width: Option<u32>, height: Option<u32>) -> BinaryResourceSummary {
        BinaryResourceSummary {
            href: href.to_owned(),
            byte_length: 0,
            byte_hash: Some("0".to_owned()),
            width,
            height,
        }
    }

    #[test]
    fn resolves_href_suffix_and_relative_prefixes() {
        let index = ImageSizeIndex::new(&[image("OPS/images/cover.png", Some(300), Some(400))]);

        assert_eq!(
            index.resolve("OPS/images/cover.png").map(|size| size.width),
            Some(300.0)
        );
        assert_eq!(
            index.resolve("images/cover.png").map(|size| size.height),
            Some(400.0)
        );
        assert_eq!(
            index.resolve("../images/cover.png").map(|size| size.width),
            Some(300.0)
        );
    }

    #[test]
    fn rejects_ambiguous_basenames() {
        let index = ImageSizeIndex::new(&[
            image("OPS/a/cover.png", Some(300), Some(400)),
            image("OPS/b/cover.png", Some(600), Some(800)),
        ]);

        assert!(index.resolve("cover.png").is_none());
        assert_eq!(
            index.resolve("a/cover.png").map(|size| size.width),
            Some(300.0)
        );
    }
}

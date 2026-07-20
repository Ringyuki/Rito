use crate::resources::{BinaryResourceSummary, ResourceHrefIndex};

#[derive(Debug, Clone, Copy)]
pub(crate) struct ImageSize {
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[derive(Debug, Clone)]
pub(crate) struct ImageSizeIndex {
    hrefs: ResourceHrefIndex<ImageSize>,
}

impl ImageSizeIndex {
    pub(crate) fn new(images: &[BinaryResourceSummary]) -> Self {
        Self {
            hrefs: ResourceHrefIndex::new(images.iter().filter_map(|image| {
                Some((
                    image.href.as_str(),
                    ImageSize {
                        width: f64::from(image.width?),
                        height: f64::from(image.height?),
                    },
                ))
            })),
        }
    }

    pub(crate) fn resolve(&self, src: &str) -> Option<ImageSize> {
        self.hrefs.resolve(src)
    }

    pub(crate) fn extend_dimensions(
        &mut self,
        dimensions: impl IntoIterator<Item = (String, u32, u32)>,
    ) {
        for (href, width, height) in dimensions {
            self.hrefs.insert(
                &href,
                ImageSize {
                    width: f64::from(width),
                    height: f64::from(height),
                },
            );
        }
    }
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

    #[test]
    fn resolves_percent_encoded_sources_like_resource_transfers() {
        let index = ImageSizeIndex::new(&[image("Images/Cover One.png", Some(300), Some(400))]);

        assert_eq!(
            index
                .resolve("../Images/Cover%20One.png")
                .map(|size| size.width),
            Some(300.0)
        );
    }

    #[test]
    fn extends_a_live_index_without_rebuilding_publication_resources() {
        let mut index = ImageSizeIndex::new(&[]);

        index.extend_dimensions([
            ("OPS/images/first.png".to_owned(), 3, 5),
            ("OPS/images/second.png".to_owned(), 7, 11),
        ]);

        assert_eq!(
            index.resolve("../images/first.png").map(|size| size.width),
            Some(3.0)
        );
        assert_eq!(
            index.resolve("images/second.png").map(|size| size.height),
            Some(11.0)
        );
    }
}

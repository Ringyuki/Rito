use crate::{
    epub::{join_epub_href, opf_dir},
    resources::ResourceHrefIndex,
};

pub(super) struct HrefResolver {
    hrefs: Vec<String>,
    index: ResourceHrefIndex<usize>,
}

impl HrefResolver {
    pub(super) fn new(hrefs: impl IntoIterator<Item = String>) -> Self {
        let hrefs = hrefs.into_iter().collect::<Vec<_>>();
        let index = ResourceHrefIndex::new(
            hrefs
                .iter()
                .enumerate()
                .map(|(index, href)| (href.as_str(), index)),
        );
        Self { hrefs, index }
    }

    pub(super) fn resolve(&self, chapter_href: &str, src: &str) -> Option<&str> {
        let contextual = join_epub_href(opf_dir(chapter_href), src);
        let contextual = if contextual.is_empty() {
            chapter_href
        } else {
            &contextual
        };
        self.index
            .resolve(contextual)
            .and_then(|index| self.hrefs.get(index))
            .map(String::as_str)
    }
}

pub(super) fn decode_fragment(fragment: &str) -> String {
    let bytes = fragment.as_bytes();
    if !bytes.contains(&b'%') {
        return fragment.to_owned();
    }
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }
        let Some(high) = bytes.get(index + 1).copied().and_then(hex_value) else {
            return fragment.to_owned();
        };
        let Some(low) = bytes.get(index + 2).copied().and_then(hex_value) else {
            return fragment.to_owned();
        };
        decoded.push((high << 4) | low);
        index += 3;
    }
    String::from_utf8(decoded).unwrap_or_else(|_| fragment.to_owned())
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

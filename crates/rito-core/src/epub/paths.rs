pub(crate) fn opf_dir(rootfile_path: &str) -> &str {
    rootfile_path
        .rfind('/')
        .map(|index| &rootfile_path[..=index])
        .unwrap_or_default()
}

pub(crate) fn join_zip_path(base_dir: &str, href: &str) -> String {
    let mut parts = Vec::new();
    let path = if base_dir.is_empty() {
        href.to_owned()
    } else {
        format!("{base_dir}{href}")
    };

    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            value => parts.push(value),
        }
    }

    parts.join("/")
}

/// Join an EPUB URL-valued href while ignoring its query and fragment suffix.
pub(crate) fn join_epub_href(base_dir: &str, href: &str) -> String {
    let query = href.find('?').unwrap_or(href.len());
    let fragment = href.find('#').unwrap_or(href.len());
    let end = query.min(fragment);
    if end == 0 {
        return String::new();
    }
    join_zip_path(base_dir, &href[..end])
}

pub(crate) fn is_external_href(href: &str) -> bool {
    if href.starts_with("//") {
        return true;
    }
    let path_end = href.find(['?', '#']).unwrap_or(href.len());
    let path = &href[..path_end];
    path.find(':').is_some_and(|colon| {
        colon > 0
            && path[..colon].chars().enumerate().all(|(index, character)| {
                character.is_ascii_alphabetic()
                    || (index > 0
                        && (character.is_ascii_digit() || matches!(character, '+' | '-' | '.')))
            })
    })
}

pub(crate) fn relative_zip_path(base_dir: &str, path: &str) -> String {
    let base = base_dir
        .trim_end_matches('/')
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let target = path
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let common = base
        .iter()
        .zip(&target)
        .take_while(|(left, right)| left == right)
        .count();
    let mut relative = vec![".."; base.len() - common];
    relative.extend_from_slice(&target[common..]);
    relative.join("/")
}

pub(crate) fn relative_epub_href(base_dir: &str, path: &str) -> String {
    let relative = relative_zip_path(base_dir, path);
    let mut href = String::with_capacity(relative.len());
    for character in relative.chars() {
        match character {
            '%' => href.push_str("%25"),
            '?' => href.push_str("%3F"),
            '#' => href.push_str("%23"),
            value => href.push(value),
        }
    }
    href
}

pub(super) fn normalize_href_path(path: &str) -> String {
    let mut parts = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            value => parts.push(value),
        }
    }
    parts.join("/")
}

#[cfg(test)]
mod tests {
    use super::{
        is_external_href, join_epub_href, join_zip_path, relative_epub_href, relative_zip_path,
    };

    #[test]
    fn distinguishes_external_and_epub_relative_hrefs() {
        assert!(is_external_href("https://example.com/note#one"));
        assert!(is_external_href("mailto:reader@example.com"));
        assert!(is_external_href("//example.com/note"));
        assert!(!is_external_href("chapter.xhtml#one"));
        assert!(!is_external_href("../Text/chapter.xhtml#one"));
        assert!(!is_external_href("#one"));
    }

    #[test]
    fn expresses_archive_paths_relative_to_the_opf_directory() {
        for (base, path, expected) in [
            ("OPS/", "OPS/Images/cover.png", "Images/cover.png"),
            (
                "OPS/Package/",
                "OPS/Shared/cover.png",
                "../Shared/cover.png",
            ),
            ("", "Images/cover.png", "Images/cover.png"),
        ] {
            let relative = relative_zip_path(base, path);
            assert_eq!(relative, expected);
            assert_eq!(join_zip_path(base, &relative), path);
        }
    }

    #[test]
    fn strips_url_query_and_fragment_when_joining_epub_hrefs() {
        assert_eq!(
            join_epub_href("OPS/", "Text/chapter.xhtml?edition=1#start"),
            "OPS/Text/chapter.xhtml"
        );
        assert_eq!(
            join_epub_href("OPS/", "Images/a%3Fb.png#view"),
            "OPS/Images/a%3Fb.png"
        );
        assert_eq!(
            join_zip_path("OPS/", "Images/literal?name#part.png"),
            "OPS/Images/literal?name#part.png"
        );
        assert_eq!(join_epub_href("OPS/", "#fragment-only"), "");
    }

    #[test]
    fn encodes_url_delimiters_in_physical_archive_paths() {
        assert_eq!(
            relative_epub_href("OPS/", "OPS/Images/a?b#c%20.png"),
            "Images/a%3Fb%23c%2520.png"
        );
    }
}

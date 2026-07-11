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

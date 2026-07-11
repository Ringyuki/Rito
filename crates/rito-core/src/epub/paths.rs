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
    use super::{join_zip_path, relative_zip_path};

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
}

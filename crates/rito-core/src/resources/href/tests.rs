use super::{resolve_resource_href_index, ResourceHrefIndex};

#[test]
fn preserves_raw_exact_precedence_before_alias_resolution() {
    let hrefs = ["Images/My%20Pic.png", "Images/My Pic.png"];
    assert_resolves(&hrefs, "Images/My%20Pic.png", Some(0));
    assert_resolves(&hrefs, "Images/My Pic.png", Some(1));
}

#[test]
fn resolves_percent_aliases_in_both_directions() {
    let hrefs = ["Images/My%20Pic.png", "Images/中.png"];
    assert_resolves(&hrefs, "../Images/My Pic.png", Some(0));
    assert_resolves(&hrefs, "Images/%e4%b8%ad.png", Some(1));
}

#[test]
fn resolves_longest_exact_manifest_tail_from_source_paths() {
    assert_resolves(
        &["pic.png", "Images/pic.png"],
        "OPS/Images/pic.png",
        Some(1),
    );
}

#[test]
fn prefers_stripped_exact_paths_before_longer_resource_suffixes() {
    assert_resolves(
        &["Images/pic.png", "Other/Images/pic.png"],
        "../Images/pic.png",
        Some(0),
    );
}

#[test]
fn rejects_ambiguous_raw_suffixes_and_basenames() {
    let hrefs = ["OPS/a/Images/pic.png", "OPS/b/Images/pic.png"];
    assert_resolves(&hrefs, "Images/pic.png", None);
    assert_resolves(&hrefs, "pic.png", None);
}

#[test]
fn rejects_ambiguous_decoded_resource_aliases() {
    let hrefs = ["Images/My%20Pic.png", "Images/My Pic.png"];
    assert_resolves(&hrefs, "Images/My%20%50ic.png", None);
}

#[test]
fn ambiguous_aliases_do_not_fall_back_to_shorter_keys() {
    let hrefs = ["A%2Fpic.png", "A/pic.png", "pic.png"];
    assert_resolves(&hrefs, "A/%70ic.png", None);
}

#[test]
fn percent_aliases_are_decoded_only_once() {
    assert_resolves(&["Images/My%2520Pic.png"], "Images/My%20Pic.png", None);
}

#[test]
fn resolves_query_and_fragment_aliases_symmetrically() {
    assert_resolves(
        &["Images/pic.png"],
        "../Images/pic.png?size=2#view",
        Some(0),
    );
    assert_resolves(&["Images/pic.png"], "../Images/pic.png#view", Some(0));
    assert_resolves(
        &["Images/My%20Pic.png?manifest=%zz"],
        "../Images/My Pic.png?cache=%zz#view",
        Some(0),
    );
}

#[test]
fn preserves_raw_query_precedence_and_rejects_canonical_collisions() {
    let hrefs = ["A/pic.png", "A/pic.png?edition=2", "pic.png"];
    assert_resolves(&hrefs, "A/pic.png?edition=2", Some(1));
    assert_resolves(&hrefs, "A/pic.png#view", None);
}

#[test]
fn ignores_path_separators_inside_url_suffixes() {
    assert_resolves(
        &["Images/cover.png"],
        "missing.png?fallback=/Images/cover.png",
        None,
    );
    assert_resolves(
        &["Images/cover.png"],
        "missing.png#fallback/Images/cover.png",
        None,
    );
    assert_resolves(
        &["missing.png?fallback=/Images/cover.png"],
        "Images/cover.png",
        None,
    );
}

#[test]
fn does_not_strip_percent_encoded_url_delimiters_after_decoding() {
    assert_resolves(&["Images/a%3Fb.png"], "Images/a?b.png", None);
    assert_resolves(&["Images/a%23b.png"], "Images/a#b.png", None);
}

#[test]
fn malformed_sources_only_use_raw_resolution() {
    assert_resolves(&["Images/100%.png"], "Images/100%.png", Some(0));
    assert_resolves(&["Images/100%25.png"], "Images/100%.png", None);
    assert_resolves(&["Images/%ff.png"], "Images/%ff.png", Some(0));
    assert_resolves(&["Images/�.png"], "Images/%ff.png", None);
}

fn assert_resolves(hrefs: &[&str], src: &str, expected: Option<usize>) {
    let hrefs = hrefs
        .iter()
        .map(|href| (*href).to_owned())
        .collect::<Vec<_>>();
    let index = ResourceHrefIndex::new(
        hrefs
            .iter()
            .enumerate()
            .map(|(index, href)| (href.as_str(), index)),
    );

    assert_eq!(index.resolve(src), expected, "prebuilt index: {src}");
    assert_eq!(
        resolve_resource_href_index(&hrefs, src, String::as_str),
        expected,
        "linear lookup: {src}"
    );
}

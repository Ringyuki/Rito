use super::compare_fixture_href;

#[test]
fn sorts_fixture_hrefs_like_javascript_locale_compare_for_ascii_paths() {
    let mut hrefs = vec![
        "Images/LK-logo.png",
        "Images/chapter0.jpg",
        "Images/cover.jpg",
        "Images/zhu.png",
        "Images/001.jpg",
    ];

    hrefs.sort_by(|left, right| compare_fixture_href(left, right));

    assert_eq!(
        hrefs,
        vec![
            "Images/001.jpg",
            "Images/chapter0.jpg",
            "Images/cover.jpg",
            "Images/LK-logo.png",
            "Images/zhu.png",
        ]
    );
}

use std::io::Cursor;

use super::{compare_fixture_href, detect_image_dimensions_from_reader};

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

#[test]
fn streams_jpeg_dimensions_across_a_large_metadata_segment() {
    let metadata_length = u16::MAX;
    let mut jpeg = vec![0xff, 0xd8, 0xff, 0xe1];
    jpeg.extend_from_slice(&metadata_length.to_be_bytes());
    jpeg.resize(jpeg.len() + usize::from(metadata_length) - 2, 0x5a);
    jpeg.extend_from_slice(&[0xff, 0xc0, 0x00, 0x07, 0x08, 0x01, 0x2c, 0x02, 0x58]);

    let dimensions = detect_image_dimensions_from_reader(&mut Cursor::new(jpeg))
        .expect("streaming dimension read succeeds");

    assert_eq!(dimensions, Some((600, 300)));
}

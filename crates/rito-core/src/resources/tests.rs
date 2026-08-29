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
fn a_quarter_turned_exif_jpeg_swaps_its_stored_dimensions() {
    // APP1 Exif payload: big-endian TIFF, one IFD entry, orientation = 6
    // (rotate 90° CW). Browsers decode with `image-orientation:
    // from-image`, so the presented raster is portrait even though the
    // stored scan is landscape.
    let mut exif: Vec<u8> = b"Exif\0\0".to_vec();
    exif.extend_from_slice(b"MM\0\x2a\0\0\0\x08"); // TIFF header, IFD at 8
    exif.extend_from_slice(&1u16.to_be_bytes()); // one entry
    exif.extend_from_slice(&0x0112u16.to_be_bytes()); // orientation tag
    exif.extend_from_slice(&3u16.to_be_bytes()); // SHORT
    exif.extend_from_slice(&1u32.to_be_bytes()); // count
    exif.extend_from_slice(&6u16.to_be_bytes()); // value 6
    exif.extend_from_slice(&0u16.to_be_bytes()); // padding
    let mut jpeg = vec![0xff, 0xd8, 0xff, 0xe1];
    jpeg.extend_from_slice(&u16::try_from(exif.len() + 2).unwrap().to_be_bytes());
    jpeg.extend_from_slice(&exif);
    // SOF0: stored 600x300 landscape
    jpeg.extend_from_slice(&[0xff, 0xc0, 0x00, 0x07, 0x08, 0x01, 0x2c, 0x02, 0x58]);

    let streamed = detect_image_dimensions_from_reader(&mut Cursor::new(jpeg.clone()))
        .expect("streaming dimension read succeeds");
    assert_eq!(streamed, Some((300, 600)));
    assert_eq!(super::detect_image_dimensions(&jpeg), Some((300, 600)));
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

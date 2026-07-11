const UNITS_PER_EM: f64 = 2048.0;
const FIRST_PRINTABLE_ASCII: u32 = 0x20;

pub(super) fn ascii_advance(character: char, font_size: f64) -> Option<f64> {
    let index = u32::from(character).checked_sub(FIRST_PRINTABLE_ASCII)? as usize;
    let units = *ASCII_ADVANCES.get(index)?;
    Some(f64::from(units) * font_size / UNITS_PER_EM)
}

pub(super) fn unicode_advance(character: char, font_size: f64) -> Option<f64> {
    let units = match character {
        '\u{00d7}' => 1155,
        '\u{2014}' | '\u{2026}' => 2048,
        '\u{2013}' => 1024,
        '\u{2018}' | '\u{2019}' => 682,
        '\u{201c}' | '\u{201d}' => 909,
        '\u{00b7}' => 512,
        '\u{2022}' => 717,
        '\u{2500}' => 1451,
        _ => return None,
    };
    Some(f64::from(units) * font_size / UNITS_PER_EM)
}

pub(super) fn ascii_pair_adjustment(left: char, right: char, font_size: f64) -> f64 {
    f64::from(ascii_pair_adjustment_units(left, right)) * font_size / UNITS_PER_EM
}

// Times New Roman's 2048-unit printable-ASCII advances. These match the
// Chromium generic-serif metrics used by the browser reference measurer.
#[rustfmt::skip]
const ASCII_ADVANCES: [u16; 95] = [
     512,  682,  836, 1024, 1024, 1706, 1593,  369,  682,  682, 1024, 1155,  512,  682,  512,  569,
    1024, 1024, 1024, 1024, 1024, 1024, 1024, 1024, 1024, 1024,  569,  569, 1155, 1155, 1155,  909,
    1886, 1479, 1366, 1366, 1479, 1251, 1139, 1479, 1479,  682,  797, 1479, 1251, 1821, 1479, 1479,
    1139, 1479, 1366, 1139, 1251, 1479, 1479, 1933, 1479, 1479, 1251,  682,  569,  682,  961, 1024,
     682,  909, 1024,  909, 1024,  909,  682, 1024, 1024,  569,  569, 1024,  569, 1593, 1024, 1024,
    1024, 1024,  682,  797,  569, 1024, 1024, 1479, 1024, 1024,  909,  983,  410,  983, 1108,
];

fn ascii_pair_adjustment_units(left: char, right: char) -> i16 {
    match (left, right) {
        (' ', 'A') => -113,
        (' ', 'T' | 'V' | 'W') => -37,
        (' ', 'Y') => -76,
        ('1', '1') => -76,
        ('A', ' ') => -113,
        ('A', 'T') => -227,
        ('A', 'V') => -264,
        ('A', 'W') => -164,
        ('A', 'Y') => -188,
        ('A', 'v') => -152,
        ('A', 'w' | 'y') => -188,
        ('F', ',' | '.') => -164,
        ('F', 'A') => -152,
        ('L', ' ') => -76,
        ('L', 'T' | 'V') => -188,
        ('L', 'W') => -152,
        ('L', 'Y') => -205,
        ('L', 'y') => -113,
        ('P', ' ') => -76,
        ('P', ',' | '.') => -227,
        ('P', 'A') => -188,
        ('R', 'T') => -123,
        ('R', 'V') => -164,
        ('R', 'W' | 'Y') => -113,
        ('R', 'y') => -82,
        ('T', ' ') => -37,
        ('T', ',') => -152,
        ('T', '-') => -188,
        ('T', '.') => -152,
        ('T', ':') => -102,
        ('T', ';') => -113,
        ('T', 'A') => -164,
        ('T', 'O') => -37,
        ('T', 'a' | 'c' | 'e' | 'o' | 's' | 'w' | 'y') => -143,
        ('T', 'i' | 'r' | 'u') => -72,
        ('V', ' ') => -37,
        ('V', ',' | '.' | 'A' | 'o') => -264,
        ('V', '-') => -188,
        ('V', ':' | ';') => -152,
        ('V', 'a' | 'e' | 'y') => -227,
        ('V', 'i' | 'r' | 'u') => -123,
        ('W', ' ') => -37,
        ('W', ',' | '.') => -188,
        ('W', '-') => -113,
        ('W', ':' | ';') => -76,
        ('W', 'A') => -227,
        ('W', 'a' | 'e' | 'o') => -164,
        ('W', 'i' | 'r' | 'u') => -82,
        ('W', 'y') => -123,
        ('Y', ' ') => -76,
        ('Y', ',' | '.') => -264,
        ('Y', '-' | 'A' | 'q' | 'u') => -227,
        ('Y', ':' | ';' | 'p') => -188,
        ('Y', 'a' | 'e' | 'o' | 'v') => -205,
        ('Y', 'i') => -113,
        ('f', 'f') => -37,
        ('r', ',') => -82,
        ('r', '-') => -41,
        ('r', '.') => -113,
        ('r', 'g') => -37,
        ('v' | 'w' | 'y', ',' | '.') => -133,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::{ascii_advance, ascii_pair_adjustment, unicode_advance};

    #[test]
    fn exposes_times_roman_ascii_metrics_and_kerning() {
        assert_eq!(ascii_advance('A', 16.0), Some(11.554_687_5));
        assert_eq!(ascii_advance('\n', 16.0), None);
        assert_eq!(ascii_pair_adjustment('w', '.', 16.0), -1.039_062_5);
        assert_eq!(ascii_pair_adjustment('L', 'K', 16.0), 0.0);
    }

    #[test]
    fn exposes_chromium_serif_unicode_punctuation_metrics() {
        assert_eq!(unicode_advance('\u{2026}', 16.0), Some(16.0));
        assert_eq!(unicode_advance('\u{2014}', 16.0), Some(16.0));
        assert_eq!(unicode_advance('\u{2013}', 16.0), Some(8.0));
        assert_eq!(unicode_advance('\u{2018}', 16.0), Some(5.328_125));
        assert_eq!(unicode_advance('\u{201c}', 16.0), Some(7.101_562_5));
        assert_eq!(unicode_advance('\u{00b7}', 16.0), Some(4.0));
        assert_eq!(unicode_advance('\u{2022}', 16.0), Some(5.601_562_5));
    }

    #[test]
    fn exposes_chromium_serif_symbol_metrics_used_by_the_demo_book() {
        assert_eq!(unicode_advance('\u{00d7}', 16.0), Some(9.023_437_5));
        assert_eq!(unicode_advance('\u{2500}', 16.0), Some(11.335_937_5));
    }
}

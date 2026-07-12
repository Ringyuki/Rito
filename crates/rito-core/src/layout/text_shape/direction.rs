use unicode_bidi::{bidi_class, BidiClass};

pub(crate) fn requires_bidi_itemization(text: &str) -> bool {
    let mut has_left_to_right = false;
    let mut has_right_to_left = false;
    let mut has_number = false;

    for character in text.chars() {
        match bidi_class(character) {
            BidiClass::L => has_left_to_right = true,
            BidiClass::R | BidiClass::AL => has_right_to_left = true,
            BidiClass::EN | BidiClass::AN => has_number = true,
            BidiClass::LRE
            | BidiClass::LRI
            | BidiClass::LRO
            | BidiClass::RLE
            | BidiClass::RLI
            | BidiClass::RLO
            | BidiClass::FSI
            | BidiClass::PDI
            | BidiClass::PDF => return true,
            _ => {}
        }
    }

    has_right_to_left && (has_left_to_right || has_number)
}

#[cfg(test)]
mod tests {
    use super::requires_bidi_itemization;

    #[test]
    fn accepts_single_direction_text_and_ltr_numbers() {
        assert!(!requires_bidi_itemization("plain text 123"));
        assert!(!requires_bidi_itemization("العربية"));
    }

    #[test]
    fn rejects_mixed_strong_directions_and_rtl_numbers() {
        assert!(requires_bidi_itemization("abc العربية"));
        assert!(requires_bidi_itemization("العربية 123"));
        assert!(requires_bidi_itemization("العربية ١٢٣"));
    }

    #[test]
    fn rejects_explicit_bidi_controls_until_itemization_exists() {
        assert!(requires_bidi_itemization("abc\u{2067}العربية\u{2069}"));
    }
}

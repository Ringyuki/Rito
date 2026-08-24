use unicode_segmentation::UnicodeSegmentation;

pub(super) fn boundaries(characters: impl Iterator<Item = char>) -> Vec<usize> {
    let mut boundaries = vec![0];
    for character in characters {
        boundaries.push(boundaries.last().copied().unwrap_or(0) + character.len_utf16());
    }
    boundaries
}

pub(super) fn grapheme_boundaries(text: &str) -> Vec<usize> {
    let mut boundaries = vec![0];
    let mut offset = 0;
    for grapheme in text.graphemes(true) {
        offset += len(grapheme);
        boundaries.push(offset);
    }
    boundaries
}

pub(super) fn non_boundaries(text: &str) -> Vec<u32> {
    let mut offset = 0_u32;
    let mut non_boundaries = Vec::new();
    for character in text.chars() {
        if character.len_utf16() == 2 {
            non_boundaries.push(offset + 1);
        }
        offset += character.len_utf16() as u32;
    }
    non_boundaries
}

pub(super) fn append_metadata(
    text: &str,
    mut absolute_offset: u32,
    non_boundaries: &mut Vec<u32>,
) -> Result<u32, ()> {
    for character in text.chars() {
        let character_len = character.len_utf16() as u32;
        if character_len == 2 {
            non_boundaries.push(absolute_offset.checked_add(1).ok_or(())?);
        }
        absolute_offset = absolute_offset.checked_add(character_len).ok_or(())?;
    }
    Ok(absolute_offset)
}

pub(super) fn offset_to_byte(text: &str, target: u32) -> Option<usize> {
    if target == 0 {
        return Some(0);
    }
    let mut offset = 0_u32;
    for (byte, character) in text.char_indices() {
        offset += character.len_utf16() as u32;
        if offset == target {
            return Some(byte + character.len_utf8());
        }
        if offset > target {
            return None;
        }
    }
    (offset == target).then_some(text.len())
}

pub(super) fn len(text: &str) -> usize {
    text.encode_utf16().count()
}

use std::borrow::Cow;

pub(super) fn source_alias(value: &str) -> Option<Cow<'_, str>> {
    let path = source_path(value);
    match percent_decode_utf8(path) {
        Ok(Some(decoded)) => Some(Cow::Owned(decoded)),
        Ok(None) => Some(Cow::Borrowed(path)),
        Err(()) => None,
    }
}

pub(super) fn resource_alias(value: &str) -> Cow<'_, str> {
    let path = source_path(value);
    match percent_decode_utf8(path) {
        Ok(Some(decoded)) => Cow::Owned(decoded),
        Ok(None) | Err(()) => Cow::Borrowed(path),
    }
}

pub(super) fn source_path(value: &str) -> &str {
    let query = value.find('?').unwrap_or(value.len());
    let fragment = value.find('#').unwrap_or(value.len());
    &value[..query.min(fragment)]
}

pub(super) fn resource_path(value: &str) -> Cow<'_, str> {
    Cow::Borrowed(source_path(value))
}

fn percent_decode_utf8(value: &str) -> Result<Option<String>, ()> {
    if !value.as_bytes().contains(&b'%') {
        return Ok(None);
    }
    let source = value.as_bytes();
    let mut decoded = Vec::with_capacity(source.len());
    let mut index = 0;
    while index < source.len() {
        if source[index] != b'%' {
            decoded.push(source[index]);
            index += 1;
            continue;
        }
        let high = source
            .get(index + 1)
            .copied()
            .and_then(hex_value)
            .ok_or(())?;
        let low = source
            .get(index + 2)
            .copied()
            .and_then(hex_value)
            .ok_or(())?;
        decoded.push((high << 4) | low);
        index += 3;
    }
    String::from_utf8(decoded).map(Some).map_err(|_| ())
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

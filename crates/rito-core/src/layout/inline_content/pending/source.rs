use crate::layout::text_work::{
    AtomicTextOperationKind, TextWorkMeter, TextWorkPermitResult, TextWorkYield,
};

pub(super) fn admit_source_metadata(
    work: &mut TextWorkMeter,
    admitted: &mut bool,
    source_path: Option<&[usize]>,
    logical_utf16_len: usize,
    source_text_offset: usize,
) -> Result<(), TextWorkYield> {
    let Some(source_path) = source_path else {
        return Ok(());
    };
    if *admitted {
        return Ok(());
    }
    let source_utf16_len = logical_utf16_len
        .checked_add(source_text_offset)
        .expect("the retained source UTF-16 length fits usize");
    let operation_units = source_utf16_len.saturating_add(source_path.len());
    if matches!(
        work.try_permit_atomic(AtomicTextOperationKind::InlineCollection, operation_units),
        TextWorkPermitResult::Yield
    ) {
        return Err(TextWorkYield);
    }
    *admitted = true;
    Ok(())
}

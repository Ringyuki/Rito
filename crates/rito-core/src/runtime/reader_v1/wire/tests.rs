use super::*;
use crate::runtime::reader_v1::{
    ReaderAdjacentAvailabilityV1, ReaderAdjacentDirectionV1, ReaderAdjacentRequestV1,
    ReaderBackgroundAdvanceV1, ReaderBackgroundHandoffAckV1, ReaderBackgroundHandoffV1,
    ReaderBackgroundRequestV1, ReaderBackgroundStateV1, ReaderDisplayListV1, ReaderErrorKindV1,
    ReaderFontRefV1, ReaderForegroundHandoffAckV1, ReaderForegroundHandoffV1, ReaderHitEntryV1,
    ReaderLayoutV1, ReaderLocatorMatchV1, ReaderLocatorV1, ReaderNavigationV1, ReaderPageV1,
    ReaderPublicationMetadataV1, ReaderPublicationSpineItemV1, ReaderPublicationTocEntryV1,
    ReaderPublicationTocTargetV1, ReaderPublicationV1, ReaderRectV1, ReaderResourceKindV1,
    ReaderResourceRefV1, ReaderResourceV1, ReaderSemanticNodeV1, ReaderSemanticRoleV1,
    ReaderSourcePointV1, ReaderSourceRangeV1, ReaderSpreadModeV1, ReaderTextRenderingProfileV1,
    ReaderTextRunOffsetV1, ReaderWorkBudgetV1, READER_CAPABILITY_PROFILE_STRING_TEXT_V1,
    READER_DISPLAY_LIST_VERSION_V1, READER_EXTERNAL_ID_MAX_V1, READER_IMAGE_RESOURCE_BYTES_MAX_V1,
    READER_PROTOCOL_VERSION_V1,
};

#[test]
fn artifact_wire_is_deterministic_and_round_trips_every_section() {
    let artifact = artifact_fixture();
    let first = encode_reader_artifact_v1(&artifact).expect("encode artifact");
    let second = encode_reader_artifact_v1(&artifact).expect("encode artifact again");

    assert_eq!(first, second);
    assert_eq!(&first[..8], b"RITOART1");
    assert_eq!(decode_reader_artifact_v1(&first), Ok(artifact));
}

#[test]
fn request_wire_is_deterministic_and_round_trips_every_section() {
    let request = request_fixture();
    let first = encode_reader_artifact_request_v1(&request).expect("encode request");
    let second = encode_reader_artifact_request_v1(&request).expect("encode request again");

    assert_eq!(first, second);
    assert_eq!(&first[..8], b"RITOREQ1");
    assert_eq!(decode_reader_artifact_request_v1(&first), Ok(request));
}

#[test]
fn publication_wire_is_deterministic_and_round_trips_nested_toc() {
    let publication = publication_fixture();
    let first = encode_reader_publication_v1(&publication).expect("encode publication");
    let second = encode_reader_publication_v1(&publication).expect("encode publication again");

    assert_eq!(first, second);
    assert_eq!(&first[..8], b"RITOPUB1");
    assert_eq!(decode_reader_publication_v1(&first), Ok(publication));
}

#[test]
fn adjacent_request_is_fixed_width_deterministic_and_round_trips() {
    let request = adjacent_request_fixture();
    let first = encode_reader_adjacent_request_v1(&request).expect("encode adjacent request");
    let second = encode_reader_adjacent_request_v1(&request).expect("encode again");

    assert_eq!(first, second);
    assert_eq!(&first[..8], b"RITONAV1");
    assert_eq!(
        first.len(),
        usize::try_from(READER_ADJACENT_REQUEST_WIRE_BYTES_V1).unwrap()
    );
    assert_eq!(decode_reader_adjacent_request_v1(&first), Ok(request));
}

#[test]
fn foreground_handoff_messages_are_fixed_width_and_round_trip_none_and_some() {
    for expected_visible_artifact_id in [None, Some((1u64 << 57) + 4)] {
        let handoff = foreground_handoff_fixture(expected_visible_artifact_id);
        let first = encode_reader_foreground_handoff_v1(&handoff).expect("encode handoff");
        let second = encode_reader_foreground_handoff_v1(&handoff).expect("encode again");
        assert_eq!(first, second);
        assert_eq!(&first[..8], b"RITOFGH1");
        assert_eq!(
            first.len(),
            usize::try_from(READER_FOREGROUND_HANDOFF_WIRE_BYTES_V1).unwrap()
        );
        assert_eq!(decode_reader_foreground_handoff_v1(&first), Ok(handoff));

        let ack = foreground_handoff_ack_fixture(expected_visible_artifact_id);
        let first = encode_reader_foreground_handoff_ack_v1(&ack).expect("encode handoff ack");
        let second = encode_reader_foreground_handoff_ack_v1(&ack).expect("encode ack again");
        assert_eq!(first, second);
        assert_eq!(&first[..8], b"RITOFGA1");
        assert_eq!(
            first.len(),
            usize::try_from(READER_FOREGROUND_HANDOFF_ACK_WIRE_BYTES_V1).unwrap()
        );
        assert_eq!(decode_reader_foreground_handoff_ack_v1(&first), Ok(ack));
    }
}

#[test]
fn background_messages_are_fixed_width_or_length_framed_and_round_trip() {
    let request = background_request_fixture();
    let request_wire = encode_reader_background_request_v1(&request).expect("encode request");
    assert_eq!(&request_wire[..8], b"RITOBGQ1");
    assert_eq!(
        request_wire.len(),
        usize::try_from(READER_BACKGROUND_REQUEST_WIRE_BYTES_V1).unwrap()
    );
    assert_eq!(
        decode_reader_background_request_v1(&request_wire),
        Ok(request)
    );

    for state in [
        ReaderBackgroundStateV1::Indexing,
        ReaderBackgroundStateV1::Started,
        ReaderBackgroundStateV1::Advanced,
        ReaderBackgroundStateV1::Reused,
        ReaderBackgroundStateV1::CandidatePending,
        ReaderBackgroundStateV1::Complete,
    ] {
        let advance = ReaderBackgroundAdvanceV1 {
            state,
            moves_visible_content: false,
            intent_request_id: (1u64 << 55) + 2,
            replaces_artifact_id: (1u64 << 57) + 4,
            artifact: (state == ReaderBackgroundStateV1::Started).then(artifact_fixture),
        };
        let wire = encode_reader_background_advance_v1(&advance).expect("encode advance");
        assert_eq!(&wire[..8], b"RITOBGA1");
        assert!(
            wire.len() >= usize::try_from(READER_BACKGROUND_ADVANCE_WIRE_PREFIX_BYTES_V1).unwrap()
        );
        // The prefix is header + state + the two IDs + the
        // moves-visible-content flag + the nested blob's length.
        let prefix = usize::try_from(READER_BACKGROUND_ADVANCE_WIRE_PREFIX_BYTES_V1).unwrap();
        if advance.artifact.is_some() {
            let nested_length = u64::from_le_bytes(wire[prefix - 8..prefix].try_into().unwrap());
            assert_eq!(usize::try_from(nested_length).unwrap(), wire.len() - prefix);
            assert_eq!(&wire[prefix..prefix + 8], b"RITOART1");
        } else {
            assert_eq!(wire.len(), prefix);
        }
        assert_eq!(decode_reader_background_advance_v1(&wire), Ok(advance));
    }

    let handoff = background_handoff_fixture();
    let handoff_wire = encode_reader_background_handoff_v1(&handoff).expect("encode handoff");
    assert_eq!(&handoff_wire[..8], b"RITOHOF1");
    assert_eq!(
        handoff_wire.len(),
        usize::try_from(READER_BACKGROUND_HANDOFF_WIRE_BYTES_V1).unwrap()
    );
    assert_eq!(
        decode_reader_background_handoff_v1(&handoff_wire),
        Ok(handoff)
    );

    let ack = background_handoff_ack_fixture();
    let ack_wire = encode_reader_background_handoff_ack_v1(&ack).expect("encode handoff ack");
    assert_eq!(&ack_wire[..8], b"RITOHOA1");
    assert_eq!(
        ack_wire.len(),
        usize::try_from(READER_BACKGROUND_HANDOFF_ACK_WIRE_BYTES_V1).unwrap()
    );
    assert_eq!(decode_reader_background_handoff_ack_v1(&ack_wire), Ok(ack));
}

#[test]
fn resource_wire_is_deterministic_and_round_trips_every_field() {
    let resource = resource_fixture();
    let first = encode_reader_resource_v1(&resource).expect("encode resource");
    let second = encode_reader_resource_v1(&resource).expect("encode resource again");

    assert_eq!(first, second);
    assert_eq!(&first[..8], b"RITORES1");
    assert_eq!(decode_reader_resource_v1(&first), Ok(resource));
}

#[test]
fn artifact_wire_rejects_every_truncated_prefix() {
    let bytes = encode_reader_artifact_v1(&artifact_fixture()).expect("encode artifact");
    for end in 0..bytes.len() {
        assert_invalid(decode_reader_artifact_v1(&bytes[..end]));
    }
}

#[test]
fn resource_wire_rejects_every_truncated_prefix() {
    let bytes = encode_reader_resource_v1(&resource_fixture()).expect("encode resource");
    for end in 0..bytes.len() {
        assert_invalid(decode_reader_resource_v1(&bytes[..end]));
    }
}

#[test]
fn publication_wire_rejects_every_truncated_prefix_and_unknown_target() {
    let bytes = encode_reader_publication_v1(&publication_fixture()).expect("encode publication");
    for end in 0..bytes.len() {
        assert_invalid(decode_reader_publication_v1(&bytes[..end]));
    }

    let mut unknown_target = bytes;
    let target_offset = publication_first_toc_target_offset(&unknown_target);
    unknown_target[target_offset] = u8::MAX;
    assert_invalid(decode_reader_publication_v1(&unknown_target));
}

#[test]
fn publication_wire_rejects_invalid_semantics_versions_and_trailing_bytes() {
    let mut invalid = publication_fixture();
    invalid.spine[1].spine_index = 9;
    assert_invalid(encode_reader_publication_v1(&invalid));

    let mut invalid = publication_fixture();
    let ReaderPublicationTocTargetV1::Locator { locator, .. } = &mut invalid.toc[0].target else {
        panic!("fixture starts with a locator target");
    };
    locator.progression = Some(0.5);
    assert_invalid(encode_reader_publication_v1(&invalid));

    let mut version = encode_reader_publication_v1(&publication_fixture()).unwrap();
    version[8..12].copy_from_slice(&2u32.to_le_bytes());
    assert_invalid(decode_reader_publication_v1(&version));

    let mut trailing = encode_reader_publication_v1(&publication_fixture()).unwrap();
    trailing.push(0x7f);
    let total = u64::try_from(trailing.len()).expect("publication length");
    trailing[12..20].copy_from_slice(&total.to_le_bytes());
    assert_invalid(decode_reader_publication_v1(&trailing));
}

#[test]
fn adjacent_request_rejects_every_truncated_prefix_and_unknown_direction() {
    let bytes = encode_reader_adjacent_request_v1(&adjacent_request_fixture())
        .expect("encode adjacent request");
    for end in 0..bytes.len() {
        assert_invalid(decode_reader_adjacent_request_v1(&bytes[..end]));
    }

    let mut unknown = bytes;
    unknown[44..48].copy_from_slice(&u32::MAX.to_le_bytes());
    assert_invalid(decode_reader_adjacent_request_v1(&unknown));
}

#[test]
fn background_messages_reject_every_truncated_prefix_and_unknown_state() {
    let request =
        encode_reader_background_request_v1(&background_request_fixture()).expect("request");
    for end in 0..request.len() {
        assert_invalid(decode_reader_background_request_v1(&request[..end]));
    }

    let advance = encode_reader_background_advance_v1(&ReaderBackgroundAdvanceV1 {
        moves_visible_content: false,
        state: ReaderBackgroundStateV1::Started,
        intent_request_id: (1u64 << 55) + 2,
        replaces_artifact_id: (1u64 << 57) + 4,
        artifact: Some(artifact_fixture()),
    })
    .expect("advance");
    for end in 0..advance.len() {
        assert_invalid(decode_reader_background_advance_v1(&advance[..end]));
    }
    let mut unknown_state = advance;
    unknown_state[20..24].copy_from_slice(&u32::MAX.to_le_bytes());
    assert_invalid(decode_reader_background_advance_v1(&unknown_state));

    let handoff =
        encode_reader_background_handoff_v1(&background_handoff_fixture()).expect("handoff");
    for end in 0..handoff.len() {
        assert_invalid(decode_reader_background_handoff_v1(&handoff[..end]));
    }

    let ack = encode_reader_background_handoff_ack_v1(&background_handoff_ack_fixture())
        .expect("handoff ack");
    for end in 0..ack.len() {
        assert_invalid(decode_reader_background_handoff_ack_v1(&ack[..end]));
    }
}

#[test]
fn foreground_handoff_rejects_truncation_unknown_tags_and_noncanonical_none() {
    let handoff = encode_reader_foreground_handoff_v1(&foreground_handoff_fixture(None))
        .expect("foreground handoff");
    for end in 0..handoff.len() {
        assert_invalid(decode_reader_foreground_handoff_v1(&handoff[..end]));
    }
    let ack = encode_reader_foreground_handoff_ack_v1(&foreground_handoff_ack_fixture(None))
        .expect("foreground handoff ack");
    for end in 0..ack.len() {
        assert_invalid(decode_reader_foreground_handoff_ack_v1(&ack[..end]));
    }

    let mut unknown_tag = handoff.clone();
    unknown_tag[28..32].copy_from_slice(&u32::MAX.to_le_bytes());
    assert_invalid(decode_reader_foreground_handoff_v1(&unknown_tag));

    let mut noncanonical_none = handoff;
    noncanonical_none[32..40].copy_from_slice(&1u64.to_le_bytes());
    assert_invalid(decode_reader_foreground_handoff_v1(&noncanonical_none));

    let mut zero_some =
        encode_reader_foreground_handoff_v1(&foreground_handoff_fixture(Some(1))).unwrap();
    zero_some[32..40].copy_from_slice(&0u64.to_le_bytes());
    assert_invalid(decode_reader_foreground_handoff_v1(&zero_some));

    let mut unknown_ack_tag = ack.clone();
    unknown_ack_tag[28..32].copy_from_slice(&u32::MAX.to_le_bytes());
    assert_invalid(decode_reader_foreground_handoff_ack_v1(&unknown_ack_tag));

    let mut noncanonical_ack_none = ack;
    noncanonical_ack_none[32..40].copy_from_slice(&1u64.to_le_bytes());
    assert_invalid(decode_reader_foreground_handoff_ack_v1(
        &noncanonical_ack_none,
    ));

    let mut zero_ack_some =
        encode_reader_foreground_handoff_ack_v1(&foreground_handoff_ack_fixture(Some(1))).unwrap();
    zero_ack_some[32..40].copy_from_slice(&0u64.to_le_bytes());
    assert_invalid(decode_reader_foreground_handoff_ack_v1(&zero_ack_some));
}

#[test]
fn wire_rejects_unknown_versions_and_trailing_bytes() {
    let mut artifact = encode_reader_artifact_v1(&artifact_fixture()).expect("encode artifact");
    artifact[8..12].copy_from_slice(&2u32.to_le_bytes());
    assert_invalid(decode_reader_artifact_v1(&artifact));

    let mut request =
        encode_reader_artifact_request_v1(&request_fixture()).expect("encode request");
    request.push(0x7f);
    let total = u64::try_from(request.len()).expect("request length");
    request[12..20].copy_from_slice(&total.to_le_bytes());
    assert_invalid(decode_reader_artifact_request_v1(&request));

    let mut adjacent = encode_reader_adjacent_request_v1(&adjacent_request_fixture()).unwrap();
    adjacent.push(0x7f);
    let total = u64::try_from(adjacent.len()).expect("adjacent length");
    adjacent[12..20].copy_from_slice(&total.to_le_bytes());
    assert_invalid(decode_reader_adjacent_request_v1(&adjacent));

    let mut resource = encode_reader_resource_v1(&resource_fixture()).expect("encode resource");
    resource.push(0x7f);
    let total = u64::try_from(resource.len()).expect("resource length");
    resource[12..20].copy_from_slice(&total.to_le_bytes());
    assert_invalid(decode_reader_resource_v1(&resource));

    let mut background =
        encode_reader_background_request_v1(&background_request_fixture()).unwrap();
    background.push(0x7f);
    let total = u64::try_from(background.len()).expect("background length");
    background[12..20].copy_from_slice(&total.to_le_bytes());
    assert_invalid(decode_reader_background_request_v1(&background));

    let mut handoff = encode_reader_background_handoff_v1(&background_handoff_fixture()).unwrap();
    handoff.push(0x7f);
    let total = u64::try_from(handoff.len()).expect("handoff length");
    handoff[12..20].copy_from_slice(&total.to_le_bytes());
    assert_invalid(decode_reader_background_handoff_v1(&handoff));

    let mut foreground =
        encode_reader_foreground_handoff_v1(&foreground_handoff_fixture(None)).unwrap();
    foreground.push(0x7f);
    let total = u64::try_from(foreground.len()).expect("foreground handoff length");
    foreground[12..20].copy_from_slice(&total.to_le_bytes());
    assert_invalid(decode_reader_foreground_handoff_v1(&foreground));

    let mut advance = encode_reader_background_advance_v1(&ReaderBackgroundAdvanceV1 {
        moves_visible_content: false,
        state: ReaderBackgroundStateV1::Complete,
        intent_request_id: 1,
        replaces_artifact_id: 2,
        artifact: None,
    })
    .unwrap();
    advance.push(0x7f);
    let total = u64::try_from(advance.len()).expect("advance length");
    advance[12..20].copy_from_slice(&total.to_le_bytes());
    assert_invalid(decode_reader_background_advance_v1(&advance));

    let mut ack =
        encode_reader_background_handoff_ack_v1(&background_handoff_ack_fixture()).unwrap();
    ack.push(0x7f);
    let total = u64::try_from(ack.len()).expect("handoff ack length");
    ack[12..20].copy_from_slice(&total.to_le_bytes());
    assert_invalid(decode_reader_background_handoff_ack_v1(&ack));

    let mut foreground_ack =
        encode_reader_foreground_handoff_ack_v1(&foreground_handoff_ack_fixture(None)).unwrap();
    foreground_ack.push(0x7f);
    let total = u64::try_from(foreground_ack.len()).expect("foreground handoff ack length");
    foreground_ack[12..20].copy_from_slice(&total.to_le_bytes());
    assert_invalid(decode_reader_foreground_handoff_ack_v1(&foreground_ack));
}

#[test]
fn resource_wire_rejects_unknown_kinds_and_invalid_lengths() {
    let mut unknown_kind = encode_reader_resource_v1(&resource_fixture()).expect("encode resource");
    unknown_kind[28..32].copy_from_slice(&u32::MAX.to_le_bytes());
    assert_invalid(decode_reader_resource_v1(&unknown_kind));

    let mut oversized_href =
        encode_reader_resource_v1(&resource_fixture()).expect("encode resource");
    oversized_href[32..36].copy_from_slice(&u32::MAX.to_le_bytes());
    assert_invalid(decode_reader_resource_v1(&oversized_href));

    let mut oversized_blob =
        encode_reader_resource_v1(&resource_fixture()).expect("encode resource");
    let blob_length = resource_blob_length_offset(&oversized_blob);
    oversized_blob[blob_length..blob_length + 8]
        .copy_from_slice(&(READER_IMAGE_RESOURCE_BYTES_MAX_V1 + 1).to_le_bytes());
    assert_invalid(decode_reader_resource_v1(&oversized_blob));

    let mut unknown_width_tag =
        encode_reader_resource_v1(&resource_fixture()).expect("encode resource");
    let width_tag = resource_width_tag_offset(&unknown_width_tag);
    unknown_width_tag[width_tag] = u8::MAX;
    assert_invalid(decode_reader_resource_v1(&unknown_width_tag));

    let mut unknown_version =
        encode_reader_resource_v1(&resource_fixture()).expect("encode resource");
    unknown_version[8..12].copy_from_slice(&u32::MAX.to_le_bytes());
    assert_invalid(decode_reader_resource_v1(&unknown_version));
}

#[test]
fn identities_retain_exact_bigint_width_and_reject_the_sign_bit() {
    let mut artifact = artifact_fixture();
    artifact.session_id = READER_EXTERNAL_ID_MAX_V1;
    artifact.request_id = READER_EXTERNAL_ID_MAX_V1 - 1;
    artifact.revision_id = READER_EXTERNAL_ID_MAX_V1 - 2;
    artifact.artifact_id = READER_EXTERNAL_ID_MAX_V1 - 3;
    artifact.locator.source_point.as_mut().unwrap().text_offset = u64::MAX - 1;
    artifact.pages[0].text_runs[0].end = u64::MAX;

    let bytes = encode_reader_artifact_v1(&artifact).expect("encode wide identities");
    assert_eq!(decode_reader_artifact_v1(&bytes), Ok(artifact));

    let adjacent = ReaderAdjacentRequestV1 {
        session_id: READER_EXTERNAL_ID_MAX_V1,
        request_id: READER_EXTERNAL_ID_MAX_V1 - 1,
        from_artifact_id: READER_EXTERNAL_ID_MAX_V1 - 2,
        ..adjacent_request_fixture()
    };
    let bytes = encode_reader_adjacent_request_v1(&adjacent).expect("encode wide adjacent ids");
    assert_eq!(decode_reader_adjacent_request_v1(&bytes), Ok(adjacent));

    let mut invalid = bytes;
    invalid[20..28].copy_from_slice(&u64::MAX.to_le_bytes());
    assert_invalid(decode_reader_adjacent_request_v1(&invalid));
    let invalid = ReaderAdjacentRequestV1 {
        session_id: u64::MAX,
        ..adjacent_request_fixture()
    };
    assert_invalid(encode_reader_adjacent_request_v1(&invalid));

    let mut request = request_fixture();
    request.request_id = READER_EXTERNAL_ID_MAX_V1 + 1;
    assert_invalid(encode_reader_artifact_request_v1(&request));
    let mut request = encode_reader_artifact_request_v1(&request_fixture()).unwrap();
    request[20..28].copy_from_slice(&0u64.to_le_bytes());
    assert_invalid(decode_reader_artifact_request_v1(&request));

    let mut artifact = artifact_fixture();
    artifact.revision_id = READER_EXTERNAL_ID_MAX_V1 + 1;
    assert_invalid(encode_reader_artifact_v1(&artifact));
    let mut artifact = encode_reader_artifact_v1(&artifact_fixture()).unwrap();
    artifact[56..64].copy_from_slice(&0u64.to_le_bytes());
    assert_invalid(decode_reader_artifact_v1(&artifact));

    let mut resource = resource_fixture();
    resource.artifact_id = READER_EXTERNAL_ID_MAX_V1 + 1;
    assert_invalid(encode_reader_resource_v1(&resource));
    let mut resource = encode_reader_resource_v1(&resource_fixture()).unwrap();
    resource[20..28].copy_from_slice(&0u64.to_le_bytes());
    assert_invalid(decode_reader_resource_v1(&resource));

    let mut background = background_request_fixture();
    background.session_id = READER_EXTERNAL_ID_MAX_V1;
    background.expected_visible_artifact_id = READER_EXTERNAL_ID_MAX_V1 - 1;
    let bytes = encode_reader_background_request_v1(&background).expect("wide background ids");
    assert_eq!(decode_reader_background_request_v1(&bytes), Ok(background));
    let mut invalid = bytes;
    invalid[28..36].copy_from_slice(&u64::MAX.to_le_bytes());
    assert_invalid(decode_reader_background_request_v1(&invalid));

    let mut advance = encode_reader_background_advance_v1(&ReaderBackgroundAdvanceV1 {
        moves_visible_content: false,
        state: ReaderBackgroundStateV1::Advanced,
        intent_request_id: READER_EXTERNAL_ID_MAX_V1,
        replaces_artifact_id: READER_EXTERNAL_ID_MAX_V1 - 1,
        artifact: None,
    })
    .expect("wide advance ids");
    advance[24..32].copy_from_slice(&u64::MAX.to_le_bytes());
    assert_invalid(decode_reader_background_advance_v1(&advance));

    let mut handoff = background_handoff_fixture();
    handoff.candidate_artifact_id = READER_EXTERNAL_ID_MAX_V1 + 1;
    assert_invalid(encode_reader_background_handoff_v1(&handoff));

    let foreground = ReaderForegroundHandoffV1 {
        session_id: READER_EXTERNAL_ID_MAX_V1,
        expected_visible_artifact_id: Some(READER_EXTERNAL_ID_MAX_V1 - 1),
        candidate_artifact_id: READER_EXTERNAL_ID_MAX_V1 - 2,
    };
    let bytes =
        encode_reader_foreground_handoff_v1(&foreground).expect("wide foreground handoff ids");
    assert_eq!(decode_reader_foreground_handoff_v1(&bytes), Ok(foreground));
    let mut invalid = bytes;
    invalid[40..48].copy_from_slice(&u64::MAX.to_le_bytes());
    assert_invalid(decode_reader_foreground_handoff_v1(&invalid));

    let mut foreground = foreground_handoff_fixture(None);
    foreground.expected_visible_artifact_id = Some(READER_EXTERNAL_ID_MAX_V1 + 1);
    assert_invalid(encode_reader_foreground_handoff_v1(&foreground));

    let mut ack = encode_reader_background_handoff_ack_v1(&background_handoff_ack_fixture())
        .expect("handoff ack");
    ack[36..44].copy_from_slice(&u64::MAX.to_le_bytes());
    assert_invalid(decode_reader_background_handoff_ack_v1(&ack));
}

#[test]
fn wire_rejects_unknown_tags_and_non_finite_numbers() {
    let mut request =
        encode_reader_artifact_request_v1(&request_fixture()).expect("encode request");
    request[92..96].copy_from_slice(&u32::MAX.to_le_bytes());
    assert_invalid(decode_reader_artifact_request_v1(&request));

    let mut invalid_request = request_fixture();
    invalid_request.layout.viewport_width = f64::NAN;
    assert_invalid(encode_reader_artifact_request_v1(&invalid_request));

    let mut artifact_value = artifact_fixture();
    artifact_value.width = f64::INFINITY;
    assert_invalid(encode_reader_artifact_v1(&artifact_value));

    let mut artifact = encode_reader_artifact_v1(&artifact_fixture()).expect("encode artifact");
    let width_offset = artifact_geometry_offset(&artifact);
    artifact[width_offset..width_offset + 8]
        .copy_from_slice(&f64::NEG_INFINITY.to_bits().to_le_bytes());
    assert_invalid(decode_reader_artifact_v1(&artifact));

    let mut artifact = encode_reader_artifact_v1(&artifact_fixture()).expect("encode artifact");
    let previous_navigation_offset = artifact_geometry_offset(&artifact) + 17;
    artifact[previous_navigation_offset..previous_navigation_offset + 4]
        .copy_from_slice(&u32::MAX.to_le_bytes());
    assert_invalid(decode_reader_artifact_v1(&artifact));
}

fn assert_invalid<T>(result: Result<T, crate::runtime::ReaderErrorV1>) {
    match result {
        Err(error) => assert_eq!(error.kind, ReaderErrorKindV1::InvalidWire),
        Ok(_) => panic!("expected invalid wire error"),
    }
}

fn artifact_geometry_offset(bytes: &[u8]) -> usize {
    let locator_length = u64::from_le_bytes(bytes[64..72].try_into().unwrap());
    let after_locator = 72 + usize::try_from(locator_length).unwrap();
    let page_index_count_offset = after_locator + 12;
    let page_index_count = u32::from_le_bytes(
        bytes[page_index_count_offset..page_index_count_offset + 4]
            .try_into()
            .unwrap(),
    );
    page_index_count_offset + 4 + usize::try_from(page_index_count).unwrap() * 4
}

fn resource_width_tag_offset(bytes: &[u8]) -> usize {
    let blob_length_offset = resource_blob_length_offset(bytes);
    let blob_length = u64::from_le_bytes(
        bytes[blob_length_offset..blob_length_offset + 8]
            .try_into()
            .unwrap(),
    );
    blob_length_offset + 8 + usize::try_from(blob_length).unwrap()
}

fn resource_blob_length_offset(bytes: &[u8]) -> usize {
    let href_length = u32::from_le_bytes(bytes[32..36].try_into().unwrap());
    let media_length_offset = 36 + usize::try_from(href_length).unwrap();
    let media_length = u32::from_le_bytes(
        bytes[media_length_offset..media_length_offset + 4]
            .try_into()
            .unwrap(),
    );
    media_length_offset + 4 + usize::try_from(media_length).unwrap()
}

fn publication_first_toc_target_offset(bytes: &[u8]) -> usize {
    let metadata_length = u64::from_le_bytes(bytes[32..40].try_into().unwrap());
    let mut offset = 40 + usize::try_from(metadata_length).unwrap();
    let spine_count = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
    offset += 4;
    for _ in 0..spine_count {
        let record_length = u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap());
        offset += 8 + usize::try_from(record_length).unwrap();
    }
    let toc_count = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
    assert!(toc_count > 0);
    offset += 4;
    let _entry_length = u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap());
    offset += 8 + 4;
    let label_length = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
    offset + 4 + usize::try_from(label_length).unwrap()
}

fn request_fixture() -> ReaderArtifactRequestV1 {
    ReaderArtifactRequestV1 {
        session_id: (1u64 << 54) + 1,
        request_id: (1u64 << 55) + 2,
        layout: ReaderLayoutV1 {
            viewport_width: 834.5,
            viewport_height: 1_194.25,
            margin_top: 24.0,
            margin_right: 28.0,
            margin_bottom: 32.0,
            margin_left: 36.0,
            spread_mode: ReaderSpreadModeV1::Double,
            first_page_alone: true,
            spread_gap: 18.0,
            root_font_size: 17.5,
            line_height_override: Some(1.6),
            font_family_override: Some("Noto Serif CJK JP".into()),
        },
        locator: locator_fixture(),
        work: ReaderWorkBudgetV1 {
            max_top_level_nodes_per_quantum: 8,
            max_foreground_quanta: 4,
            local_page_cap: 16,
        },
        text_profile: ReaderTextRenderingProfileV1::PositionedGlyphRuns,
    }
}

fn adjacent_request_fixture() -> ReaderAdjacentRequestV1 {
    ReaderAdjacentRequestV1 {
        session_id: (1u64 << 54) + 1,
        request_id: (1u64 << 55) + 2,
        from_artifact_id: (1u64 << 56) + 3,
        direction: ReaderAdjacentDirectionV1::Next,
        work: ReaderWorkBudgetV1 {
            max_top_level_nodes_per_quantum: 8,
            max_foreground_quanta: 4,
            local_page_cap: 16,
        },
    }
}

fn background_request_fixture() -> ReaderBackgroundRequestV1 {
    ReaderBackgroundRequestV1 {
        session_id: (1u64 << 54) + 1,
        expected_visible_artifact_id: (1u64 << 57) + 4,
        max_top_level_nodes_per_quantum: u32::MAX,
    }
}

fn foreground_handoff_fixture(
    expected_visible_artifact_id: Option<u64>,
) -> ReaderForegroundHandoffV1 {
    ReaderForegroundHandoffV1 {
        session_id: (1u64 << 54) + 1,
        expected_visible_artifact_id,
        candidate_artifact_id: (1u64 << 57) + 5,
    }
}

fn foreground_handoff_ack_fixture(
    replaced_artifact_id: Option<u64>,
) -> ReaderForegroundHandoffAckV1 {
    ReaderForegroundHandoffAckV1 {
        intent_request_id: (1u64 << 55) + 2,
        replaced_artifact_id,
        visible_artifact_id: (1u64 << 57) + 5,
    }
}

fn background_handoff_fixture() -> ReaderBackgroundHandoffV1 {
    ReaderBackgroundHandoffV1 {
        session_id: (1u64 << 54) + 1,
        expected_visible_artifact_id: (1u64 << 57) + 4,
        candidate_artifact_id: (1u64 << 57) + 5,
    }
}

fn background_handoff_ack_fixture() -> ReaderBackgroundHandoffAckV1 {
    ReaderBackgroundHandoffAckV1 {
        intent_request_id: (1u64 << 55) + 2,
        replaced_artifact_id: (1u64 << 57) + 4,
        visible_artifact_id: (1u64 << 57) + 5,
    }
}

fn artifact_fixture() -> ReaderArtifactV1 {
    ReaderArtifactV1 {
        protocol_version: READER_PROTOCOL_VERSION_V1,
        capability_profile_id: READER_CAPABILITY_PROFILE_STRING_TEXT_V1,
        session_id: (1u64 << 54) + 1,
        request_id: (1u64 << 55) + 2,
        revision_id: (1u64 << 56) + 3,
        revision_version: u32::MAX - 1,
        artifact_id: (1u64 << 57) + 4,
        locator: locator_fixture(),
        matched_by: ReaderLocatorMatchV1::SourceRange,
        local_page_index: 9,
        local_spread_index: 5,
        local_page_indexes: vec![9, 10],
        width: 834.5,
        height: 1_194.25,
        terminal_extent: true,
        book_page_index: Some(140),
        book_page_count: Some(312),
        navigation: ReaderNavigationV1 {
            previous: ReaderAdjacentAvailabilityV1::Available,
            next: ReaderAdjacentAvailabilityV1::ChapterBoundary,
        },
        text_profile: ReaderTextRenderingProfileV1::PlatformStringRuns,
        display_list: ReaderDisplayListV1 {
            format_version: READER_DISPLAY_LIST_VERSION_V1,
            command_count: 3,
            semantic_digest: std::array::from_fn(|index| u8::try_from(index).unwrap()),
            bytes: vec![0, 1, 2, 127, 128, 255],
        },
        resources: vec![
            resource(ReaderResourceKindV1::Image, "images/cover.jpg"),
            resource(ReaderResourceKindV1::Font, "fonts/serif.woff2"),
            resource(ReaderResourceKindV1::Stylesheet, "styles/book.css"),
        ],
        fonts: vec![ReaderFontRefV1 {
            family: "Noto Serif CJK JP".into(),
            href: "fonts/serif.woff2".into(),
            style: "normal".into(),
            weight: 650,
            shape_fingerprint: "sha256:abcd".into(),
            byte_length: (1u64 << 40) + 7,
        }],
        pages: vec![page_fixture()],
    }
}

fn publication_fixture() -> ReaderPublicationV1 {
    ReaderPublicationV1 {
        protocol_version: READER_PROTOCOL_VERSION_V1,
        session_id: (1u64 << 54) + 7,
        metadata: ReaderPublicationMetadataV1 {
            title: "静かな海".into(),
            language: "ja".into(),
            identifier: "urn:rito:publication-wire".into(),
            creator: Some("Rito Reader".into()),
        },
        spine: vec![
            ReaderPublicationSpineItemV1 {
                spine_index: 0,
                linear_index: Some(0),
                idref: "chapter-1".into(),
                href: "Text/chapter-1.xhtml".into(),
            },
            ReaderPublicationSpineItemV1 {
                spine_index: 1,
                linear_index: None,
                idref: "notes".into(),
                href: "Text/notes.xhtml".into(),
            },
            ReaderPublicationSpineItemV1 {
                spine_index: 2,
                linear_index: Some(1),
                idref: "chapter-2".into(),
                href: "Text/chapter-2.xhtml".into(),
            },
        ],
        toc: vec![
            ReaderPublicationTocEntryV1 {
                toc_id: 0,
                label: "第一章".into(),
                target: ReaderPublicationTocTargetV1::Locator {
                    spine_index: 0,
                    locator: ReaderLocatorV1 {
                        href: "Text/chapter-1.xhtml".into(),
                        anchor_id: Some("開始".into()),
                        source_point: None,
                        source_range: None,
                        progression: None,
                    },
                },
                children: vec![ReaderPublicationTocEntryV1 {
                    toc_id: 1,
                    label: "参考資料".into(),
                    target: ReaderPublicationTocTargetV1::External {
                        href: "https://example.com/reference".into(),
                    },
                    children: Vec::new(),
                }],
            },
            ReaderPublicationTocEntryV1 {
                toc_id: 2,
                label: "未収録".into(),
                target: ReaderPublicationTocTargetV1::Unresolved {
                    href: "Text/missing.xhtml#lost".into(),
                },
                children: Vec::new(),
            },
        ],
    }
}

fn resource_fixture() -> ReaderResourceV1 {
    ReaderResourceV1 {
        artifact_id: (1u64 << 60) + 5,
        kind: ReaderResourceKindV1::Image,
        href: "OEBPS/Images/0005_s.jpg".into(),
        media_type: "image/jpeg".into(),
        bytes: vec![0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43],
        width: Some(1_000),
        height: Some(716),
    }
}

fn locator_fixture() -> ReaderLocatorV1 {
    let start = ReaderSourcePointV1 {
        node_path: vec![0, 3, u32::MAX],
        text_offset: (1u64 << 48) + 11,
    };
    let end = ReaderSourcePointV1 {
        node_path: vec![0, 4, 2],
        text_offset: (1u64 << 49) + 13,
    };
    ReaderLocatorV1 {
        href: "Text/chapter-01.xhtml".into(),
        anchor_id: Some("節-一".into()),
        source_point: Some(start.clone()),
        source_range: Some(ReaderSourceRangeV1 { start, end }),
        progression: Some(0.625),
    }
}

fn page_fixture() -> ReaderPageV1 {
    ReaderPageV1 {
        page_index: 9,
        width: 400.25,
        height: 1_194.25,
        hits: vec![ReaderHitEntryV1 {
            page_index: 9,
            bounds: rect(11.5, 12.5, 120.0, 24.0),
            text: "次へ".into(),
            href: Some("chapter-02.xhtml".into()),
            source_point: Some(ReaderSourcePointV1 {
                node_path: vec![1, 2, 3],
                text_offset: 5,
            }),
            image_src: Some("images/next.png".into()),
            image_alt: Some("次章".into()),
            footnote_key: Some("Text/chapter-02.xhtml#fn7".into()),
            footnote_pending: true,
        }],
        semantics: semantic_roles_fixture(),
        text: "吾輩は猫である。".into(),
        text_length: 9,
        text_runs: vec![ReaderTextRunOffsetV1 {
            start: 0,
            end: 9,
            block_index: u32::MAX,
            line_index: 2,
            run_index: 3,
        }],
    }
}

fn semantic_roles_fixture() -> Vec<ReaderSemanticNodeV1> {
    let roles = [
        ReaderSemanticRoleV1::Paragraph,
        ReaderSemanticRoleV1::List,
        ReaderSemanticRoleV1::ListItem,
        ReaderSemanticRoleV1::Image,
        ReaderSemanticRoleV1::Link,
        ReaderSemanticRoleV1::Blockquote,
        ReaderSemanticRoleV1::Table,
        ReaderSemanticRoleV1::Generic,
    ];
    vec![ReaderSemanticNodeV1 {
        role: ReaderSemanticRoleV1::Heading,
        level: Some(2),
        text: Some("章題".into()),
        alt: Some("heading".into()),
        href: Some("#title".into()),
        bounds: rect(10.0, 20.0, 300.0, 40.0),
        children: roles
            .into_iter()
            .map(|role| ReaderSemanticNodeV1 {
                role,
                level: None,
                text: None,
                alt: None,
                href: None,
                bounds: rect(1.0, 2.0, 3.0, 4.0),
                children: Vec::new(),
            })
            .collect(),
    }]
}

fn resource(kind: ReaderResourceKindV1, href: &str) -> ReaderResourceRefV1 {
    ReaderResourceRefV1 {
        kind,
        href: href.into(),
    }
}

const fn rect(x: f64, y: f64, width: f64, height: f64) -> ReaderRectV1 {
    ReaderRectV1 {
        x,
        y,
        width,
        height,
    }
}

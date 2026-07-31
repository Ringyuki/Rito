#ifndef RITO_FFI_H
#define RITO_FFI_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define RITO_ABI_VERSION_V1 UINT32_C(1)

#define RITO_STATUS_OK_V1 UINT32_C(0)
#define RITO_STATUS_INVALID_ARGUMENT_V1 UINT32_C(1)
#define RITO_STATUS_NOT_FOUND_V1 UINT32_C(2)
#define RITO_STATUS_ALREADY_EXISTS_V1 UINT32_C(3)
#define RITO_STATUS_ENGINE_ERROR_V1 UINT32_C(4)
#define RITO_STATUS_STALE_REQUEST_V1 UINT32_C(5)
#define RITO_STATUS_TARGET_NOT_PUBLISHED_V1 UINT32_C(6)
#define RITO_STATUS_UNSUPPORTED_PROFILE_V1 UINT32_C(7)
#define RITO_STATUS_BUSY_V1 UINT32_C(8)
#define RITO_STATUS_QUEUE_FULL_V1 RITO_STATUS_BUSY_V1
#define RITO_STATUS_EXACT_SEEK_PENDING_V1 UINT32_C(9)
#define RITO_STATUS_ADJACENT_PENDING_V1 UINT32_C(10)
#define RITO_STATUS_SESSION_TERMINATED_V1 UINT32_C(11)
#define RITO_STATUS_PANIC_V1 UINT32_C(255)

/*
 * SESSION_TERMINATED means the actor ended, or was fail-closed, before the
 * caller could receive an authoritative result. A mutation may already have
 * committed; callers must not retry work on that session ID.
 * rito_dispose_v1 remains idempotent for local bookkeeping cleanup.
 */

#define RITO_ACTOR_MAX_IN_FLIGHT_V1 UINT32_C(8)
#define RITO_FOREGROUND_HANDOFF_WIRE_BYTES_V1 UINT64_C(48)
#define RITO_FOREGROUND_HANDOFF_ACK_WIRE_BYTES_V1 UINT64_C(48)
#define RITO_BACKGROUND_REQUEST_WIRE_BYTES_V1 UINT64_C(40)
#define RITO_BACKGROUND_HANDOFF_WIRE_BYTES_V1 UINT64_C(44)
#define RITO_PUBLICATION_WIRE_BYTES_MAX_V1 UINT64_C(16777216)

#define RITO_RESOURCE_KIND_IMAGE_V1 UINT32_C(0)
#define RITO_RESOURCE_KIND_FONT_V1 UINT32_C(1)
#define RITO_RESOURCE_KIND_STYLESHEET_V1 UINT32_C(2)

/* All session, request, revision, and artifact IDs are in 1..=INT64_MAX. */

/*
 * Buffer allocated by Rito. `len` and `capacity` are always uint64_t at the
 * ABI even on 32-bit hosts. Every non-empty output must be released exactly
 * through rito_buffer_free_v1; that function also zeroes the descriptor so a
 * repeated call with the same descriptor is harmless.
 */
typedef struct rito_owned_buffer_v1 {
  uint8_t *data;
  uint64_t len;
  uint64_t capacity;
} rito_owned_buffer_v1;

/*
 * A ready session owns at most RITO_ACTOR_MAX_IN_FLIGHT_V1 operations, counting
 * the command currently executing in Core, every queued command, and calls
 * admitted while decoding/copying their input. Calls over that cap return
 * RITO_STATUS_BUSY_V1 (also named QUEUE_FULL) without queuing the command or
 * copying its variable-size request/href input. BUSY does not interrupt or
 * cancel a layout already executing in Core; callers should coalesce or retry
 * work they still need.
 *
 * Each session has at most one queued rito_request_artifact_v1 foreground
 * navigation. A newer valid foreground request replaces an older queued one;
 * the older call returns RITO_STATUS_STALE_REQUEST_V1 immediately. Replacement
 * never interrupts a request already executing in Core and never moves across
 * queued publication, resource, adjacent-turn, background, handoff, or release
 * commands.
 */

/*
 * Opens an owned EPUB and synchronously returns its first RITOART1 artifact.
 * `request_data` must contain one complete core-owned RITOREQ1 message.
 * Input bytes are copied before this function returns. Session state remains
 * on one dedicated Rito actor thread; no engine pointer crosses this ABI.
 *
 * On success, artifact_out owns an encoded foreground candidate and error_out
 * is empty. The candidate is not visible until it is committed through
 * rito_adopt_foreground_candidate_v1 with an expected visible artifact of
 * none for the initial frame.
 * If exact locator work is resumably pending, this call returns
 * RITO_STATUS_EXACT_SEEK_PENDING_V1 with an empty artifact_out. The session is
 * ready and retained. The caller must keep the same session ID and submit
 * the same locator/layout/local-page-cap through rito_request_artifact_v1 with
 * a strictly newer request ID. RITO_STATUS_TARGET_NOT_PUBLISHED_V1 is terminal
 * and does not retain a session when returned by open.
 *
 * On every other failure, artifact_out is empty, error_out owns a UTF-8
 * diagnostic, and no session is registered. Both output descriptors must be
 * zero-initialized (or previously freed) before each call.
 */
uint32_t rito_open_v1(const uint8_t *publication_data,
                      uint64_t publication_len,
                      const uint8_t *request_data,
                      uint64_t request_len,
                      rito_owned_buffer_v1 *artifact_out,
                      rito_owned_buffer_v1 *error_out);

/*
 * Reads the session's immutable publication snapshot as one complete
 * RITOPUB1 message. The output is capped at
 * RITO_PUBLICATION_WIRE_BYTES_MAX_V1 and contains only fixed-width numeric
 * fields plus length-framed UTF-8 data; no engine pointer or borrowed memory
 * crosses the ABI. Repeated reads are deterministic and do not create an
 * artifact or change its lifetime.
 *
 * On success, publication_out owns the encoded bytes and must be released by
 * rito_buffer_free_v1. A missing/disposed session returns NOT_FOUND, invalid
 * IDs return INVALID_ARGUMENT, and an admission-cap overflow returns BUSY.
 */
uint32_t rito_read_publication_v1(uint64_t session_id,
                                  rito_owned_buffer_v1 *publication_out,
                                  rito_owned_buffer_v1 *error_out);

/*
 * Requests another owned RITOART1 artifact from an existing session. The
 * complete RITOREQ1 message may describe a seek or reflow; adjacent turns use
 * rito_request_adjacent_v1. Its session_id must equal the explicit session_id
 * argument. This is the latest-wins foreground operation described above.
 * It is also the continuation entry point after rito_open_v1 reports a
 * resumably pending exact locator; every retry requires a newer request ID.
 * RITO_STATUS_EXACT_SEEK_PENDING_V1 means Core still owns that continuation.
 * RITO_STATUS_TARGET_NOT_PUBLISHED_V1 is terminal for the requested target.
 * A successful result is an owned candidate and does not become visible until
 * rito_adopt_foreground_candidate_v1 accepts its compare-and-swap request.
 */
uint32_t rito_request_artifact_v1(uint64_t session_id,
                                  const uint8_t *request_data,
                                  uint64_t request_len,
                                  rito_owned_buffer_v1 *artifact_out,
                                  rito_owned_buffer_v1 *error_out);

/*
 * Requests the previous or next RITOART1 artifact relative to a live artifact.
 * request_data must contain one complete core-owned RITONAV1 message. Its
 * session_id must equal the explicit session_id argument. Core resolves the
 * request with the message's bounded work budget and never exposes a cursor or
 * platform-sized integer through this ABI. A successful result remains an
 * invisible candidate until rito_adopt_foreground_candidate_v1 accepts it.
 * RITO_STATUS_ADJACENT_PENDING_V1 means Core retains resumable adjacent work;
 * retry the same source artifact, direction, and local-page cap with a strictly
 * newer request ID. TARGET_NOT_PUBLISHED without that status is terminal.
 */
uint32_t rito_request_adjacent_v1(uint64_t session_id,
                                  const uint8_t *request_data,
                                  uint64_t request_len,
                                  rito_owned_buffer_v1 *artifact_out,
                                  rito_owned_buffer_v1 *error_out);

/*
 * Atomically makes one foreground candidate visible if the current visible
 * artifact still matches the optional compare-and-swap expectation.
 * request_data must contain exactly one 48-byte RITOFGH1 message whose
 * session_id equals the explicit argument. On success, ack_out owns one fixed
 * 48-byte RITOFGA1 acknowledgement. A stale or malformed handoff leaves the
 * session and its existing visible artifact unchanged. Adoption does not
 * release the replaced artifact; its lifetime remains host-owned so page-turn
 * animation may continue painting it.
 */
uint32_t rito_adopt_foreground_candidate_v1(uint64_t session_id,
                                             const uint8_t *request_data,
                                             uint64_t request_len,
                                             rito_owned_buffer_v1 *ack_out,
                                             rito_owned_buffer_v1 *error_out);

/*
 * Runs exactly one host-scheduled publication-layout quantum. request_data
 * must contain one complete 40-byte RITOBGQ1 message whose session_id equals
 * the explicit argument. On success, advance_out owns one RITOBGA1 response;
 * its fixed prefix identifies the visible intent and artifact it may replace,
 * followed by an optional length-framed complete RITOART1 candidate.
 *
 * This command is FIFO with resource, adjacent, handoff, and release commands.
 * It is not a foreground-navigation replacement slot and creates no Core
 * thread or repeated background loop.
 * The initial foreground candidate must be adopted before this API has a
 * visible artifact against which to compare.
 */
uint32_t rito_advance_background_v1(uint64_t session_id,
                                    const uint8_t *request_data,
                                    uint64_t request_len,
                                    rito_owned_buffer_v1 *advance_out,
                                    rito_owned_buffer_v1 *error_out);

/*
 * Atomically adopts a publication candidate only if the visible artifact is
 * still the expected one. request_data must contain one complete 44-byte
 * RITOHOF1 message whose session_id equals the explicit argument. On success,
 * ack_out owns one fixed 44-byte RITOHOA1 acknowledgement. Adoption does not
 * release the replaced artifact; its lifetime remains host-owned.
 */
uint32_t rito_adopt_background_candidate_v1(uint64_t session_id,
                                             const uint8_t *request_data,
                                             uint64_t request_len,
                                             rito_owned_buffer_v1 *ack_out,
                                             rito_owned_buffer_v1 *error_out);

/*
 * Reads one resource referenced by a live RITOART1 artifact and returns a
 * complete RITORES1 message. kind_u32 must be one of the
 * RITO_RESOURCE_KIND_*_V1 constants. href_data is copied before this function
 * returns.
 */
uint32_t rito_read_resource_v1(uint64_t session_id,
                               uint64_t artifact_id,
                               uint32_t kind_u32,
                               const uint8_t *href_data,
                               uint64_t href_len,
                               rito_owned_buffer_v1 *resource_out,
                               rito_owned_buffer_v1 *error_out);

/*
 * Resolves where a text range sits on one of a live artifact's pages and
 * returns a complete RITOTRG1 message. request_data is a RITOTRQ1 message and
 * is copied before this function returns. The returned rects are in the
 * artifact's display-list space — the same space its hit bounds use — so a
 * host paints them directly onto the surface it drew the page on.
 */
uint32_t rito_get_text_range_geometry_v1(uint64_t session_id,
                                         const uint8_t *request_data,
                                         uint64_t request_len,
                                         rito_owned_buffer_v1 *geometry_out,
                                         rito_owned_buffer_v1 *error_out);

/*
 * Reads a footnote definition referenced by a live RITOART1 artifact and
 * returns a complete RITOFTN1 message. key_data is the hit's footnoteKey
 * verbatim — it is already canonical, so hosts must not normalize the link
 * href themselves — and is copied before this function returns. A definition
 * the publication footnote index has not reached yet returns
 * RITO_STATUS_TARGET_NOT_PUBLISHED_V1 and succeeds on a later retry.
 */
uint32_t rito_read_footnote_v1(uint64_t session_id,
                               uint64_t artifact_id,
                               const uint8_t *key_data,
                               uint64_t key_len,
                               rito_owned_buffer_v1 *footnote_out,
                               rito_owned_buffer_v1 *error_out);

/*
 * Idempotent for an artifact already released from this session. BUSY means
 * the release was not queued and the artifact remains live; retry it or dispose
 * the owning session.
 */
uint32_t rito_release_artifact_v1(uint64_t session_id,
                                  uint64_t artifact_id,
                                  rito_owned_buffer_v1 *error_out);

/*
 * Idempotent: disposing an absent or already-disposed session succeeds.
 * Dispose closes admission, drains commands that were already queued, then
 * releases Core state and joins the actor. It does not cancel Core work that
 * is already executing.
 */
uint32_t rito_dispose_v1(uint64_t session_id,
                         rito_owned_buffer_v1 *error_out);

/* Frees and zeroes a descriptor returned by any Rito FFI v1 function. */
void rito_buffer_free_v1(rito_owned_buffer_v1 *buffer);

#ifdef __cplusplus
}
#endif

#endif /* RITO_FFI_H */

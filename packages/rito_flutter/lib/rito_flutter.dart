/// High-level reader sessions, prepared artifacts, and Flutter page painting.
library;

export 'src/font/artifact_font_cache.dart'
    show
        RitoArtifactFontCache,
        RitoFontRegistrar,
        RitoFontResourceReader,
        RitoPreparedArtifact;
export 'src/image/artifact_image_cache.dart'
    show
        RitoArtifactImageCache,
        RitoArtifactImageLease,
        RitoArtifactImageResourceReader;
export 'src/image/image_decoder.dart'
    show RitoImageDecoder, RitoImageDecodeSource, RitoUiImageDecoder;
export 'src/image/image_limits.dart'
    show RitoArtifactImageLimits, RitoImageBudgetExceededException;
export 'src/native/bindings.dart'
    show
        RitoNativeException,
        ritoNativeStatusAdjacentPending,
        ritoNativeStatusAlreadyExists,
        ritoNativeStatusBusy,
        ritoNativeStatusEngineError,
        ritoNativeStatusInvalidArgument,
        ritoNativeStatusNotFound,
        ritoNativeStatusPanic,
        ritoNativeStatusSessionTerminated,
        ritoNativeStatusStaleRequest,
        ritoNativeStatusTargetNotPublished,
        ritoNativeStatusUnsupportedProfile;
export 'src/native/gateway.dart';
export 'src/protocol/annotation_target.dart'
    show
        RitoAnnotationLevel,
        RitoAnnotationQuery,
        RitoAnnotationRequest,
        RitoAnnotationResponse,
        RitoAnnotationTarget,
        RitoCreateAnnotationQuery,
        RitoResolveAnnotationQuery;
export 'src/protocol/artifact_models.dart';
export 'src/protocol/display_models.dart'
    show RitoPaintRuby, RitoPaintText, RitoTextPaintCommand;
export 'src/protocol/exact_source_range.dart'
    show
        RitoExactSourceRangeRequest,
        RitoExactSourceRangeResolution,
        RitoExactSourceRangeStatus,
        RitoExactSourceRect;
export 'src/protocol/footnote_decoder.dart' show RitoFootnote, RitoFootnoteKind;
export 'src/protocol/hit_resolver.dart';
export 'src/protocol/primitive_models.dart';
export 'src/protocol/request_models.dart';
export 'src/protocol/search.dart'
    show RitoSearchRequest, RitoSearchResponse, RitoSearchResult;
export 'src/protocol/text_geometry.dart'
    show
        RitoTextPosition,
        RitoTextRangeGeometry,
        RitoTextRangeRequest,
        RitoTextRect;
export 'src/protocol/text_interaction.dart'
    show
        RitoBoundaryResult,
        RitoCaret,
        RitoCaretAddress,
        RitoCaretAffinity,
        RitoCaretGeometry,
        RitoCaretQuery,
        RitoCaretResult,
        RitoMissResult,
        RitoMovementQuery,
        RitoPendingResult,
        RitoRangeFromPointsQuery,
        RitoRangeQuery,
        RitoRangeToPointQuery,
        RitoSelectionBoundary,
        RitoSelectionGranularity,
        RitoSelectionMovement,
        RitoSelectionResult,
        RitoTextInteractionQuery,
        RitoTextInteractionRequest,
        RitoTextInteractionResponse,
        RitoTextInteractionResult,
        RitoTextInteractionUnavailableReason,
        RitoTextPoint,
        RitoTextSelection,
        RitoUnavailableResult;
export 'src/reader_session.dart';
export 'src/render/font_envelope.dart'
    show RitoFontEnvelope, RitoFontEnvelopeStore;
export 'src/render/page_surface.dart'
    show
        RitoArtifactPainter,
        RitoCanvasColorOverride,
        RitoImageResolver,
        RitoPageSurface;
export 'src/render/typed_color.dart' show ritoUiColor;

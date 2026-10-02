import { decodeRitoReaderForegroundHandoffAck } from './reader-session-foreground-runtime.js';
import {
  decodeRitoReaderAnnotationResponse,
  decodeRitoReaderExactSourceRangeResolution,
  decodeRitoReaderFootnote,
  decodeRitoReaderNavigationResult,
  decodeRitoReaderSearchResponse,
  decodeRitoReaderTextInteractionResponse,
  decodeRitoReaderTextRangeGeometry,
} from './reader-session-query-decoder-runtime.js';

/**
 * The client half of the reader-session operations beyond pagination. `ctx`
 * exposes the owning client's state through closures, so these methods share
 * its artifact ownership, visible artifact and foreground lane.
 */
export function createRitoReaderSessionQueryMethods(ctx) {
  const query = async (kind, body, decode, artifactId) => {
    ctx.requireOpen();
    if (artifactId !== undefined && !ctx.liveArtifacts.has(artifactId)) {
      throw ctx.readerError('unknown-artifact', `${kind} artifact is not live`);
    }
    const payload = await ctx.send(kind, body);
    if (payload?.kind !== kind) throw ctx.invalidPayload(kind);
    const value = decode(payload.wire);
    if (artifactId !== undefined && value.artifactId !== artifactId) {
      throw ctx.readerError('invalid-wire', `${kind} response identity does not match request`);
    }
    return value;
  };
  const request = (fields) => ({ sessionId: ctx.sessionId, ...fields });

  const peekAdjacent = async (fromArtifactId, direction) => {
    ctx.requireOpen();
    if (!ctx.liveArtifacts.has(fromArtifactId)) {
      throw ctx.readerError('unknown-artifact', 'Peek source artifact is not live');
    }
    const message = request({ requestId: ctx.nextRequestId(), fromArtifactId, direction });
    try {
      const payload = await ctx.send('peek-adjacent', { request: message });
      const artifact = ctx.decodeArtifactPayload(payload, message);
      ctx.liveArtifacts.add(artifact.artifactId);
      ctx.peekedArtifacts.set(artifact.artifactId, artifact.requestId);
      return artifact;
    } catch (error) {
      ctx.failIfFatal(error);
      throw error;
    }
  };

  const commitPeekedArtifact = async (expectedVisibleArtifactId, candidateArtifactId) => {
    ctx.requireOpen();
    const peekRequestId = ctx.peekedArtifacts.get(candidateArtifactId);
    if (
      peekRequestId === undefined ||
      !ctx.liveArtifacts.has(candidateArtifactId) ||
      ctx.visibleArtifactId() !== expectedVisibleArtifactId
    ) {
      throw ctx.readerError('stale-request', 'Peeked artifact is not committable');
    }
    // A commit supersedes every foreground intent in flight, exactly as a
    // fresh navigation does.
    ctx.supersedeForeground();
    return ctx.runInForegroundLane(async () => {
      try {
        const handoff = request({ expectedVisibleArtifactId, candidateArtifactId });
        const payload = await ctx.send('commit-peeked-artifact', { request: handoff });
        if (payload?.kind !== 'foreground-handoff') throw ctx.invalidPayload('peek commit');
        const ack = decodeRitoReaderForegroundHandoffAck(payload.wire);
        if (
          ack.intentRequestId !== peekRequestId ||
          ack.replacedArtifactId !== expectedVisibleArtifactId ||
          ack.visibleArtifactId !== candidateArtifactId
        ) {
          throw ctx.readerError(
            'invalid-wire',
            'Peek commit acknowledgement does not match its request',
          );
        }
        ctx.setVisibleArtifact(candidateArtifactId);
        ctx.peekedArtifacts.delete(candidateArtifactId);
        return ack;
      } catch (error) {
        ctx.failIfFatal(error);
        throw error;
      }
    });
  };

  return {
    peekAdjacent,
    commitPeekedArtifact,
    readFootnote: (artifactId, key) =>
      query('read-footnote', { artifactId, key }, decodeRitoReaderFootnote, artifactId),
    search: (artifactId, options) =>
      query(
        'search',
        {
          request: request({
            artifactId,
            query: options.query,
            caseSensitive: options.caseSensitive ?? false,
            wholeWord: options.wholeWord ?? false,
            limit: options.limit ?? 0,
          }),
        },
        decodeRitoReaderSearchResponse,
        artifactId,
      ),
    textRangeGeometry: (artifactId, pageIndex, start, end) =>
      query(
        'text-range-geometry',
        { request: request({ artifactId, pageIndex, start, end }) },
        decodeRitoReaderTextRangeGeometry,
        artifactId,
      ),
    exactSourceRange: (artifactId, href, range) =>
      query(
        'exact-source-range',
        { request: request({ artifactId, href, range }) },
        decodeRitoReaderExactSourceRangeResolution,
        artifactId,
      ),
    textInteraction: (artifactId, interaction) =>
      query(
        'text-interaction',
        { request: request({ artifactId, query: interaction }) },
        decodeRitoReaderTextInteractionResponse,
        artifactId,
      ),
    annotation: (annotationQuery) =>
      query(
        'annotation',
        { request: request({ query: annotationQuery }) },
        decodeRitoReaderAnnotationResponse,
      ),
    navigation: async (navigationQuery) => {
      const owned =
        navigationQuery.kind === 'toc-entry-at-page' || navigationQuery.kind === 'locate'
          ? navigationQuery.artifactId
          : undefined;
      if (owned !== undefined && !ctx.liveArtifacts.has(owned)) {
        throw ctx.readerError('unknown-artifact', 'navigation artifact is not live');
      }
      return query(
        'navigation',
        { request: request({ query: navigationQuery }) },
        decodeRitoReaderNavigationResult,
      );
    },
  };
}

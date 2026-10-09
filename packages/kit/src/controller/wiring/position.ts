import type { DisposableCollection } from '../../utils/disposable';
import { showsChapterAlone } from '../core/spread-change';
import type { WiringDeps } from '../core/wiring-deps';

export function wirePositionTracker(deps: WiringDeps, disposables: DisposableCollection): void {
  const { engines, emitter } = deps;
  if (!engines.position) return;
  const tracker = engines.position;
  disposables.add(
    tracker.onPositionChange((position) => {
      // A position taken while a chapter is laid out alone projects onto
      // that chapter's own page numbers: hosts hear the one the whole book
      // gives, which follows its commit.
      if (showsChapterAlone(deps.reader)) return;
      deps.coordState.publishedPosition = position;
      emitter.emit('positionChange', { position });
      if (!deps.hasRestored()) return;
      const serialized = tracker.serialize();
      if (serialized !== undefined) {
        void deps.positionPersistence.save(serialized).catch((error: unknown) => {
          reportPositionStorageFailure(error, emitter);
        });
      }
    }),
  );
}

function reportPositionStorageFailure(error: unknown, emitter: WiringDeps['emitter']): void {
  try {
    emitter.emit('error', {
      message: error instanceof Error ? error.message : String(error),
      source: 'position-storage',
    });
  } catch {
    // Consumer error listeners must not create an unhandled storage rejection.
  }
}

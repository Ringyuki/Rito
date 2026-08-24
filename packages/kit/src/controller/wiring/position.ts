import type { DisposableCollection } from '../../utils/disposable';
import type { WiringDeps } from '../core/wiring-deps';

export function wirePositionTracker(deps: WiringDeps, disposables: DisposableCollection): void {
  const { engines, emitter } = deps;
  if (!engines.position) return;
  const tracker = engines.position;
  disposables.add(
    tracker.onPositionChange((position) => {
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

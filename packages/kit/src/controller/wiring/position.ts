import type { DisposableCollection } from '../../utils/disposable';
import type { WiringDeps } from '../core/wiring-deps';

export function wirePositionTracker(deps: WiringDeps, disposables: DisposableCollection): void {
  const { engines, emitter } = deps;
  if (!engines.position) return;
  const tracker = engines.position;
  disposables.add(() => {
    tracker.dispose();
  });
  disposables.add(
    tracker.onPositionChange((position) => {
      emitter.emit('positionChange', { position });
      if (!deps.hasRestored()) return;
      const serialized = tracker.serialize();
      if (serialized !== undefined) {
        void deps.positionPersistence.save(serialized).catch((error: unknown) => {
          emitter.emit('error', {
            message: error instanceof Error ? error.message : String(error),
            source: 'position-storage',
          });
        });
      }
    }),
  );
}

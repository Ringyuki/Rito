import type { DisposableCollection } from '../../utils/disposable';
import type { WiringDeps } from '../core/wiring-deps';

export function wirePositionTracker(deps: WiringDeps, disposables: DisposableCollection): void {
  const { engines, emitter, options } = deps;
  if (!engines.position) return;
  const tracker = engines.position;
  disposables.add(
    tracker.onPositionChange((position) => {
      emitter.emit('positionChange', { position });
      void options.positionStorage?.save(tracker.serialize());
    }),
  );
}

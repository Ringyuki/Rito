import type { DisplayList } from '../display-list';
import type { TextMeasurer } from '../../layout/text/text-measurer';

/**
 * Backend contract for executing a platform-neutral display list on a target surface.
 *
 * TypeScript's structural typing means backends do not need inheritance; an object
 * with this `render` method is a valid backend.
 */
export interface DisplayListRenderer<TTarget, TOptions = undefined> {
  render(displayList: DisplayList, target: TTarget, options?: TOptions): void;
}

/**
 * Backend contract for creating a platform text measurer from a platform target.
 *
 * Layout still depends only on `TextMeasurer`; this factory contract keeps the
 * platform-specific construction path injectable and backend-shaped.
 */
export interface TextMeasurementBackend<
  TTarget,
  TMeasurer extends TextMeasurer = TextMeasurer,
  TOptions = undefined,
> {
  createTextMeasurer(target: TTarget, options?: TOptions): TMeasurer;
}

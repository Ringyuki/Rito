import type { PaperTurnModel } from '@ritojs/core';

import type { TransitionPhysics } from '../physics';

/**
 * How a paper turn moves, as the engine's model has it. A whole turn
 * carries the held point from one side of the spine to the same distance
 * on the other, so the point stays under the finger; a leaf turned by no
 * finger starts at once and lands softly in well under half a second; and
 * the last frame drawn is the leaf lying exactly where it lands.
 *
 * A turn that cuts into another takes up the same leaf when it is that leaf
 * turned again, and otherwise lifts the next one from flat: the leaf it cut
 * into is the effect's to bring down, and no turn is over before every leaf
 * has come to rest. A page curled over is out of the frame, or lying flat
 * again, while its turn is still slowing down; the turn is over a frame
 * after it is. A turn's motion is stepped once a frame, at `now`.
 */
export function paperPhysics(model: PaperTurnModel, now: () => number): TransitionPhysics {
  return {
    travel: (touch, bounds) => model.travel(touch, bounds.width, bounds.spine),
    lands: (release) => model.lands(release),
    begins: ({ dx, velocity, sameSpreads }) => model.begins(dx, velocity, sameSpreads),
    settle(from, velocity, to) {
      const step = model.settle(from, velocity, to);
      return (seconds) => step(seconds, now());
    },
  };
}

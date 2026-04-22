/** Sliding window for velocity estimation. Keeps N most recent (dx, timestamp) samples. */
export const VELOCITY_WINDOW_SIZE = 5;

export interface VelocitySample {
  readonly dx: number;
  readonly timestamp: number;
}

export function estimateVelocity(samples: readonly VelocitySample[]): number {
  if (samples.length < 2) return 0;
  const newest = samples[samples.length - 1];
  const oldest = samples[0];
  if (!newest || !oldest) return 0;
  const dt = newest.timestamp - oldest.timestamp;
  if (dt < 1) return 0;

  let weightedVx = 0;
  let totalWeight = 0;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    if (!prev || !curr) continue;
    const segDt = Math.max(curr.timestamp - prev.timestamp, 1);
    const segVx = (curr.dx - prev.dx) / segDt;
    weightedVx += segVx * i;
    totalWeight += i;
  }
  return totalWeight > 0 ? weightedVx / totalWeight : 0;
}

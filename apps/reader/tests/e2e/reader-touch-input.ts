import type { CDPSession, Page } from '@playwright/test';

export interface TouchPoint {
  readonly x: number;
  readonly y: number;
}

export interface ReaderTouchInput {
  start(point: TouchPoint): Promise<void>;
  move(point: TouchPoint): Promise<void>;
  end(): Promise<void>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

/** Drives Chromium's native touch pipeline rather than constructing DOM TouchEvents. */
export async function createReaderTouchInput(page: Page): Promise<ReaderTouchInput> {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 1,
  });
  return createTouchInput(session);
}

export async function moveTouchAlongPath(
  input: ReaderTouchInput,
  start: TouchPoint,
  end: TouchPoint,
  steps = 12,
): Promise<void> {
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    await input.move({
      x: start.x + (end.x - start.x) * progress,
      y: start.y + (end.y - start.y) * progress,
    });
  }
}

function createTouchInput(session: CDPSession): ReaderTouchInput {
  return {
    start: (point) => dispatchActiveTouch(session, 'touchStart', point),
    move: (point) => dispatchActiveTouch(session, 'touchMove', point),
    end: () => dispatchReleasedTouch(session, 'touchEnd'),
    cancel: () => dispatchReleasedTouch(session, 'touchCancel'),
    dispose: async () => {
      try {
        await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      } finally {
        await session.detach();
      }
    },
  };
}

async function dispatchActiveTouch(
  session: CDPSession,
  type: 'touchStart' | 'touchMove',
  point: TouchPoint,
): Promise<void> {
  await session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: [{ ...point, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
  });
}

async function dispatchReleasedTouch(
  session: CDPSession,
  type: 'touchEnd' | 'touchCancel',
): Promise<void> {
  await session.send('Input.dispatchTouchEvent', { type, touchPoints: [] });
}

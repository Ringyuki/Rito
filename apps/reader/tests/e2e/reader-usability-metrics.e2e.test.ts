import { expect, test } from '@playwright/test';
import { evaluateReaderUsabilityCase } from './reader-usability-gate';
import {
  READER_GATE_TEST_SHA256 as SHA256,
  readerGateTestMetrics as metrics,
  readerGateTestProfile as profile,
} from './reader-usability-gate-test-data';

test('maps cached-turn first-frame and stable timings from separate stage durations', () => {
  const report = profile(1);
  const summary = evaluateReaderUsabilityCase(
    { id: 'fixture', epub: '/fixture.epub', sha256: SHA256, thresholds: metrics(400) },
    [
      {
        ...report,
        stages: {
          ...report.stages,
          cachedTurn: {
            ...report.stages.cachedTurn,
            durationMs: 17,
            observedDurationMs: 321,
          },
        },
      },
    ],
    1,
  );

  expect(summary.p95.cachedTurnFirstFrameMs).toBe(17);
  expect(summary.p95.cachedTurnStableMs).toBe(321);
});

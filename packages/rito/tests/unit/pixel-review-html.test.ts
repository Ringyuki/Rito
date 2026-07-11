import { describe, expect, it } from 'vitest';
import { renderPixelReviewHtml } from '../golden-pixel/helpers/pixel-review-html';

describe('pixel review HTML', () => {
  it('labels reader parity expected and actual engines without changing the default report', () => {
    const parity = renderPixelReviewHtml([], {
      heading: 'Reader Parity',
      expectedLabel: 'TypeScript reference',
      actualLabel: 'Rust production',
    });
    const defaultReview = renderPixelReviewHtml([]);

    expect(parity).toContain('<h1>Reader Parity</h1>');
    expect(parity).toContain('Expected: TypeScript reference · Actual: Rust production');
    expect(parity).toContain('data-view-mode="actual">Rust production</button>');
    expect(parity).toContain('data-view-mode="expected">TypeScript reference</button>');
    expect(parity).toContain('"expected":"TypeScript reference"');
    expect(parity).toContain('"actual":"Rust production"');
    expect(defaultReview).not.toContain('Expected: Expected · Actual: Actual');
    expect(defaultReview).toContain('"expected":"Expected"');
    expect(defaultReview).toContain('"actual":"Actual"');
  });
});

export type TransitionPreset = 'slide' | 'fade' | 'none';

export interface TransitionOptions {
  readonly preset: TransitionPreset;
  readonly duration: number;
  readonly easing: string;
  readonly swipeThreshold: number;
  readonly elasticFactor: number;
}

export const DEFAULT_TRANSITION_OPTIONS: TransitionOptions = {
  preset: 'slide',
  duration: 300,
  easing: 'ease-out',
  swipeThreshold: 50,
  elasticFactor: 0.3,
};

export interface TransitionEngine {
  /** Inject wrapper div containing both canvases into the container. */
  mount(container: HTMLElement): void;
  /** The main canvas — pass this to createReader(). */
  readonly mainCanvas: HTMLCanvasElement;
  /** Sync both canvas sizes with reader dimensions. */
  setSize(width: number, height: number, dpr: number): void;
  /** Execute a snapshot-based transition. renderFn renders new content to mainCanvas. */
  transitionTo(direction: 'forward' | 'backward', renderFn: () => void): Promise<void>;
  /** Update transition configuration. */
  configure(options: Partial<TransitionOptions>): void;
  /** Touch gesture handlers for swipe-to-turn. */
  handleTouchStart(e: TouchEvent): void;
  handleTouchMove(e: TouchEvent): void;
  handleTouchEnd(e: TouchEvent): void;
  /** Whether a transition or gesture is currently in progress. */
  readonly isAnimating: boolean;
  /** Callback for when a swipe gesture commits a page turn. */
  onSwipeCommit: ((direction: 'forward' | 'backward') => void) | null;
  /** Remove DOM elements and clean up. */
  dispose(): void;
}

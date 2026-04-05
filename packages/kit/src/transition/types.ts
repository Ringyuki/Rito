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

export type GesturePhase = 'idle' | 'pending' | 'tracking' | 'animating';

/**
 * Context provided by the controller so the transition engine can
 * pre-render adjacent spreads during a gesture (before commit).
 */
export interface NavigationContext {
  readonly currentSpread: number;
  readonly totalSpreads: number;
  /** Synchronously render a spread onto the main canvas. */
  renderSpread(index: number): void;
}

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
  /** Provide navigation context for gesture pre-rendering. */
  setNavigationContext(ctx: NavigationContext): void;
  /** Touch gesture handlers for swipe-to-turn. */
  handleTouchStart(e: TouchEvent): void;
  handleTouchMove(e: TouchEvent): void;
  handleTouchEnd(e: TouchEvent): void;
  /** Whether a transition or gesture animation is currently in progress. */
  readonly isAnimating: boolean;
  /** Current gesture phase for external observability. */
  readonly gesturePhase: GesturePhase;
  /** Callback for when a swipe gesture commits a page turn. */
  onSwipeCommit: ((direction: 'forward' | 'backward', targetSpreadIndex: number) => void) | null;
  /** Remove DOM elements and clean up. */
  dispose(): void;
}

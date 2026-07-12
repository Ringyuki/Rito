import type { ReaderLocator, ReaderLocatorResolution } from '../../../../reader';
import { copyReaderLocator } from '../interaction-capture';
import { resolveBrowserReaderLocator } from '../interaction';
import type {
  BrowserReaderLocatorNavigation,
  BrowserReaderQueuedReflow,
  BrowserReaderState,
} from '../types';
import { isStaleReflow, reportReflowError } from './reflow-state';
type State = BrowserReaderState;
type Intent = BrowserReaderLocatorNavigation;
type Request = BrowserReaderQueuedReflow;
type Resolution = ReaderLocatorResolution;
type Kind = 'preview' | 'full' | undefined;
interface Hooks {
  readonly clearDeferred: () => void;
  readonly scheduleDrain: () => void;
}
class LocatorNavigation implements Intent {
  readonly locator: ReaderLocator;
  phase: Intent['phase'] = 'probing';
  readonly promise: Promise<Resolution | undefined>;
  private settled = false;
  cleanup = (): void => undefined;
  private resolveTask = (_value: Resolution | undefined): void => undefined;
  private rejectTask = (_error: unknown): void => undefined;
  constructor(locator: ReaderLocator) {
    this.locator = copyReaderLocator(locator);
    this.promise = new Promise((resolve, reject) => {
      this.resolveTask = resolve;
      this.rejectTask = reject;
    });
  }
  complete(value: Resolution | undefined): void {
    if (this.finish()) this.resolveTask(value);
  }
  fail(error: unknown): void {
    if (this.finish()) this.rejectTask(error);
  }
  private finish(): boolean {
    if (this.settled) return false;
    this.settled = true;
    this.cleanup();
    return true;
  }
}
export function startLocatorNavigation(
  state: State,
  locator: ReaderLocator,
  signal: AbortSignal | undefined,
  hooks: Hooks,
): Promise<Resolution | undefined> {
  if (signal?.aborted) return Promise.resolve(undefined);
  const active = state.reflow.active;
  const takeOver = Boolean(
    state.reflow.locatorNavigation?.phase === 'full' ||
    (active && active.locatorNavigation?.phase !== 'settling') ||
    state.reflow.queued ||
    state.reflow.deferred ||
    state.visualPreview,
  );
  const navigation = beginNavigation(state, locator, signal);
  if (!ownsLocatorNavigation(state, navigation)) return navigation.promise;
  if (takeOver) queueFullReflow(state, navigation, hooks);
  else void probeNavigation(state, navigation, hooks);
  return navigation.promise;
}
export function continueLocatorNavigation(
  state: State,
  request: Request,
  committedKind: Kind,
): void {
  void settleNavigation(state, request, committedKind).catch((error: unknown) => {
    const current = request.locatorNavigation;
    if (!navigationIsCurrent(state, request, current)) return;
    const wrapped = reportReflowError(state, error, 'queued reader reflow');
    failLocatorNavigation(state, current, wrapped);
  });
}
function ownsLocatorNavigation(state: State, navigation: Intent): boolean {
  return !state.disposed && state.reflow.locatorNavigation === navigation;
}
export function failLocatorNavigation(state: State, navigation: Intent, error: unknown): void {
  if (releaseNavigation(state, navigation)) navigation.fail(error);
}
export function cancelLocatorNavigation(state: State): void {
  const navigation = state.reflow.locatorNavigation;
  if (navigation) completeNavigation(state, navigation, undefined);
}
async function settleNavigation(
  state: State,
  request: Request,
  committedKind: Kind,
): Promise<void> {
  const navigation = request.locatorNavigation;
  if (!navigationIsCurrent(state, request, navigation)) return;
  if (committedKind !== 'full') throw new Error('Reader locator navigation needs a full revision');
  const resolution = await resolveBrowserReaderLocator(state, navigation.locator);
  if (!navigationIsCurrent(state, request, navigation)) return;
  if (resolution?.status !== 'resolved') {
    throw new Error('Reader locator navigation full revision did not resolve its locator');
  }
  const spread = state.revisionBundle.navigation.spreads.find((candidate) =>
    candidate.pageIndexes.includes(resolution.pageIndex),
  );
  if (
    resolution.spreadIndex !== state.activeSpreadIndex ||
    spread?.spreadIndex !== resolution.spreadIndex
  ) {
    throw new Error('Reader locator navigation resolution does not match its selected spread');
  }
  completeNavigation(state, navigation, resolution);
}
async function probeNavigation(state: State, navigation: Intent, hooks: Hooks): Promise<void> {
  const revision = state.revisionHandle;
  try {
    const resolution = await resolveBrowserReaderLocator(state, navigation.locator);
    if (!ownsLocatorNavigation(state, navigation) || navigation.phase !== 'probing') return;
    if (resolution === undefined && state.revisionHandle !== revision) {
      void probeNavigation(state, navigation, hooks);
    } else if (resolution?.status === 'pending' && resolution.reason === 'notPaginated') {
      queueFullReflow(state, navigation, hooks);
    } else completeNavigation(state, navigation, resolution);
  } catch (error) {
    if (ownsLocatorNavigation(state, navigation) && navigation.phase === 'probing') {
      failLocatorNavigation(state, navigation, error);
    }
  }
}
function queueFullReflow(state: State, navigation: Intent, hooks: Hooks): void {
  if (!ownsLocatorNavigation(state, navigation)) return;
  navigation.phase = 'full';
  const pending = state.reflow.queued ?? state.reflow.active ?? state.reflow.deferred?.request;
  const policy = pending ?? state.visualPreview ?? state;
  state.reflow.queued = {
    config: policy.config,
    spreadMode: policy.spreadMode,
    lineBreaking: policy.lineBreaking,
    ...(pending?.onCommitted ? { onCommitted: pending.onCommitted } : {}),
    token: ++state.reflow.token,
    locatorNavigation: navigation,
  };
  hooks.clearDeferred();
  hooks.scheduleDrain();
}
function beginNavigation(
  state: State,
  locator: ReaderLocator,
  signal?: AbortSignal,
): LocatorNavigation {
  const navigation = new LocatorNavigation(locator);
  cancelLocatorNavigation(state);
  if (state.disposed) navigation.complete(undefined);
  else state.reflow.locatorNavigation = navigation;
  if (signal && !state.disposed) {
    const abort = (): void => {
      completeNavigation(state, navigation, undefined);
    };
    signal.addEventListener('abort', abort, { once: true });
    navigation.cleanup = () => {
      signal.removeEventListener('abort', abort);
    };
    if (signal.aborted) abort();
  }
  return navigation;
}
function completeNavigation(state: State, navigation: Intent, value: Resolution | undefined): void {
  if (releaseNavigation(state, navigation)) navigation.complete(value);
}
function releaseNavigation(state: State, navigation: Intent): boolean {
  if (state.reflow.locatorNavigation !== navigation) return false;
  state.reflow.locatorNavigation = undefined;
  return true;
}
function navigationIsCurrent(
  state: State,
  request: Request,
  navigation: Intent | undefined,
): navigation is Intent {
  return Boolean(
    navigation && !isStaleReflow(state, request) && ownsLocatorNavigation(state, navigation),
  );
}

import type { Logger } from '../utils/logger';
import type { ReaderRuntimeDispatcher, ReaderRuntimeMessagePort } from '../runtime/reader-session';
import {
  createReaderRuntimeWorkerEndpoint,
  type ReaderRuntimeWorkerEndpoint,
} from './reader-runtime-worker-endpoint';
import type {
  ReaderRuntimeWorkerDispatcher,
  ReaderRuntimeWorkerDispatcherFactory,
} from './reader-runtime-worker-dispatcher';
import {
  createWebWorkerReaderRuntimeMessagePort,
  type CreateWebWorkerReaderRuntimeMessagePortOptions,
  type WebWorkerReaderRuntimeMessageTarget,
} from './reader-runtime-worker-port';

export type ReaderRuntimeWorkerScope = WebWorkerReaderRuntimeMessageTarget;

export type CreateReaderRuntimeWorkerScopePortOptions =
  CreateWebWorkerReaderRuntimeMessagePortOptions;

export interface StartReaderRuntimeWorkerEndpointInput {
  readonly scope: ReaderRuntimeWorkerScope;
  readonly createDispatcher: () => ReaderRuntimeDispatcher;
  readonly logger?: Logger;
}

export interface StartReaderRuntimeWorkerDispatcherFactoryEndpointInput {
  readonly scope: ReaderRuntimeWorkerScope;
  readonly dispatcherFactory: ReaderRuntimeWorkerDispatcherFactory;
  readonly logger?: Logger;
}

export interface ReaderRuntimeWorkerDispatcherFactoryEndpoint extends ReaderRuntimeWorkerEndpoint {
  readonly resourceTransfers: ReaderRuntimeWorkerDispatcher['resourceTransfers'];
}

export function createReaderRuntimeWorkerScopePort(
  scope: ReaderRuntimeWorkerScope,
  options?: CreateReaderRuntimeWorkerScopePortOptions,
): ReaderRuntimeMessagePort {
  return createWebWorkerReaderRuntimeMessagePort(scope, options);
}

export function startReaderRuntimeWorkerEndpoint(
  input: StartReaderRuntimeWorkerEndpointInput,
): ReaderRuntimeWorkerEndpoint {
  const port = createReaderRuntimeWorkerScopePort(input.scope, {
    ...(input.logger !== undefined ? { logger: input.logger } : {}),
  });
  return createReaderRuntimeWorkerEndpoint({
    port,
    createDispatcher: input.createDispatcher,
    ...(input.logger !== undefined ? { logger: input.logger } : {}),
  });
}

export function startReaderRuntimeWorkerDispatcherFactoryEndpoint(
  input: StartReaderRuntimeWorkerDispatcherFactoryEndpointInput,
): ReaderRuntimeWorkerDispatcherFactoryEndpoint {
  let workerDispatcher: ReaderRuntimeWorkerDispatcher | undefined;
  const endpoint = startReaderRuntimeWorkerEndpoint({
    scope: input.scope,
    createDispatcher() {
      workerDispatcher = input.dispatcherFactory.createDispatcher();
      return workerDispatcher.dispatcher;
    },
    ...(input.logger !== undefined ? { logger: input.logger } : {}),
  });
  return {
    resourceTransfers: requireWorkerDispatcher(workerDispatcher).resourceTransfers,
    dispose() {
      endpoint.dispose();
    },
  };
}

function requireWorkerDispatcher(
  workerDispatcher: ReaderRuntimeWorkerDispatcher | undefined,
): ReaderRuntimeWorkerDispatcher {
  if (workerDispatcher !== undefined) return workerDispatcher;
  throw new Error('Reader runtime worker dispatcher factory did not create a dispatcher');
}

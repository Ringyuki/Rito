import type { Logger } from '../utils/logger';
import type {
  ReaderRuntimeDispatcher,
  ReaderRuntimeMessageHandler,
  ReaderRuntimeMessagePort,
} from '../runtime/reader-session';
import { createReaderRuntimeMessageHandler } from '../runtime/reader-session';

export interface ReaderRuntimeWorkerEndpoint {
  dispose(): void;
}

export interface CreateReaderRuntimeWorkerEndpointInput {
  readonly port: ReaderRuntimeMessagePort;
  readonly createDispatcher: () => ReaderRuntimeDispatcher;
  readonly logger?: Logger;
}

export class ReaderRuntimeWorkerEndpointSetupError extends Error {
  override readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'ReaderRuntimeWorkerEndpointSetupError';
    this.cause = cause;
  }
}

export function createReaderRuntimeWorkerEndpoint(
  input: CreateReaderRuntimeWorkerEndpointInput,
): ReaderRuntimeWorkerEndpoint {
  const dispatcher = createEndpointDispatcher(input);
  const handler = createEndpointHandler(input, dispatcher);

  return {
    dispose() {
      handler.dispose();
    },
  };
}

function createEndpointDispatcher(
  input: CreateReaderRuntimeWorkerEndpointInput,
): ReaderRuntimeDispatcher {
  try {
    return input.createDispatcher();
  } catch (error) {
    throw new ReaderRuntimeWorkerEndpointSetupError(
      'Reader runtime worker endpoint failed to create dispatcher',
      error,
    );
  }
}

function createEndpointHandler(
  input: CreateReaderRuntimeWorkerEndpointInput,
  dispatcher: ReaderRuntimeDispatcher,
): ReaderRuntimeMessageHandler {
  try {
    return createReaderRuntimeMessageHandler({
      port: input.port,
      dispatcher,
      disposeDispatcher: true,
      ...(input.logger !== undefined ? { logger: input.logger } : {}),
    });
  } catch (error) {
    disposeDispatcherAfterSetupFailure(dispatcher, input.logger);
    throw new ReaderRuntimeWorkerEndpointSetupError(
      'Reader runtime worker endpoint failed to create message handler',
      error,
    );
  }
}

function disposeDispatcherAfterSetupFailure(
  dispatcher: ReaderRuntimeDispatcher,
  logger: Logger | undefined,
): void {
  try {
    dispatcher.dispose();
  } catch (error) {
    logger?.error('Reader runtime worker endpoint dispatcher cleanup failed', error);
  }
}

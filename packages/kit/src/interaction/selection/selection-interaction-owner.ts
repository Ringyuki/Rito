export interface SelectionInteractionCapture {
  readonly generation: number;
  readonly readGeneration: () => number;
}

export interface SelectionGestureLease {
  readonly generation: number;
}

export interface SelectionGestureOwner {
  readonly capture: () => object | null;
  readonly owns: (token: object) => boolean;
  readonly supportsProjectionTransfer?: boolean;
}

interface SelectionInteractionRegistration {
  readonly readGeneration: () => number;
  readonly gesture: SelectionGestureOwner | undefined;
}

interface SelectionGestureLeaseRecord {
  readonly owner: object;
  readonly registration: SelectionInteractionRegistration;
  readonly token: object;
}

const registrations = new WeakMap<object, SelectionInteractionRegistration>();
const gestureLeases = new WeakMap<SelectionGestureLease, SelectionGestureLeaseRecord>();
const projectionTransfers = new WeakMap<object, SelectionGestureLease>();

/** Register a private lifecycle owner without widening SelectionEngine's public API. */
export function registerSelectionInteractionOwner<T extends object>(
  owner: T,
  readGeneration: () => number,
  gesture?: SelectionGestureOwner,
): T {
  registrations.set(owner, { readGeneration, gesture });
  return owner;
}

export function captureSelectionInteraction(owner: object): SelectionInteractionCapture | null {
  const readGeneration = registrations.get(owner)?.readGeneration;
  return readGeneration ? { generation: readGeneration(), readGeneration } : null;
}

export function ownsSelectionInteraction(capture: SelectionInteractionCapture): boolean {
  return capture.readGeneration() === capture.generation;
}

/** Capture the exact active native gesture, not only its lifecycle generation. */
export function captureSelectionGesture(owner: object): SelectionGestureLease | null {
  const registration = registrations.get(owner);
  const token = registration?.gesture?.capture();
  if (!registration || !token) return null;
  const lease: SelectionGestureLease = { generation: registration.readGeneration() };
  gestureLeases.set(lease, { owner, registration, token });
  return registration.gesture?.owns(token) === true ? lease : null;
}

export function ownsSelectionGesture(lease: SelectionGestureLease): boolean {
  const record = gestureLeases.get(lease);
  return (
    record !== undefined &&
    registrations.get(record.owner) === record.registration &&
    record.registration.readGeneration() === lease.generation &&
    record.registration.gesture?.owns(record.token) === true
  );
}

/** Whether this private owner can retain one exact gesture while its spread is reprojected. */
export function supportsSelectionGestureProjection(owner: object): boolean {
  return registrations.get(owner)?.gesture?.supportsProjectionTransfer === true;
}

/** Distinguish an inactive gesture that settled naturally from a replaced lifecycle. */
export function isSelectionGestureSuperseded(lease: SelectionGestureLease): boolean {
  const record = gestureLeases.get(lease);
  return (
    record === undefined ||
    registrations.get(record.owner) !== record.registration ||
    record.registration.readGeneration() !== lease.generation
  );
}

/** Authorize exactly one synchronous projection update for the captured gesture. */
export function withSelectionGestureProjection<T>(
  owner: object,
  lease: SelectionGestureLease,
  project: () => T,
): T {
  const record = gestureLeases.get(lease);
  if (
    !record ||
    record.owner !== owner ||
    record.registration.gesture?.supportsProjectionTransfer !== true ||
    !ownsSelectionGesture(lease)
  ) {
    return project();
  }
  projectionTransfers.set(owner, lease);
  try {
    return project();
  } finally {
    if (projectionTransfers.get(owner) === lease) projectionTransfers.delete(owner);
  }
}

/** Consume a projection authorization once; listener reentrancy cannot reuse it. */
export function consumeSelectionGestureProjection(owner: object): boolean {
  const lease = projectionTransfers.get(owner);
  if (!lease) return false;
  projectionTransfers.delete(owner);
  const record = gestureLeases.get(lease);
  return (
    record?.owner === owner &&
    record.registration.gesture?.supportsProjectionTransfer === true &&
    ownsSelectionGesture(lease)
  );
}

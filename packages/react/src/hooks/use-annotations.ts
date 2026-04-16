import { useCallback, useState } from 'react';
import type { ReaderController, AddAnnotationInput } from '@ritojs/kit';
import type {
  AnnotationRecord,
  AnnotationRecordPatch,
  ResolvedAnnotation,
} from '@ritojs/core/annotations';
import { useControllerEvent } from '../utils/use-controller-event';

export interface AnnotationHover {
  readonly annotation: ResolvedAnnotation;
  readonly x: number;
  readonly y: number;
}

export interface AnnotationsState {
  readonly annotations: readonly AnnotationRecord[];
  readonly clickedAnnotation: ResolvedAnnotation | null;
  readonly hover: AnnotationHover | null;
}

export function useAnnotations(controller: ReaderController | null): AnnotationsState & {
  add: (input: AddAnnotationInput) => AnnotationRecord | undefined;
  remove: (id: string) => boolean;
  update: (id: string, patch: AnnotationRecordPatch) => boolean;
  clearClicked: () => void;
} {
  const [annotations, setAnnotations] = useState<readonly AnnotationRecord[]>([]);
  const [clickedAnnotation, setClickedAnnotation] = useState<ResolvedAnnotation | null>(null);
  const [hover, setHover] = useState<AnnotationHover | null>(null);

  useControllerEvent(controller, 'annotationsChange', ({ annotations: anns }) => {
    setAnnotations(anns);
  });

  useControllerEvent(controller, 'annotationClick', ({ annotation }) => {
    setClickedAnnotation(annotation);
  });

  useControllerEvent(controller, 'annotationHover', ({ annotation, x, y }) => {
    setHover(annotation ? { annotation, x, y } : null);
  });

  const add = useCallback(
    (input: AddAnnotationInput) => controller?.addAnnotation(input),
    [controller],
  );
  const remove = useCallback(
    (id: string) => controller?.removeAnnotation(id) ?? false,
    [controller],
  );
  const update = useCallback(
    (id: string, patch: AnnotationRecordPatch) => controller?.updateAnnotation(id, patch) ?? false,
    [controller],
  );
  const clearClicked = useCallback(() => {
    setClickedAnnotation(null);
  }, []);

  return { annotations, clickedAnnotation, hover, add, remove, update, clearClicked };
}

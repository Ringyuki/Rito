import { useCallback, useState } from 'react';
import type { ReaderController } from '@rito/kit';
import type { Annotation, AnnotationInput, AnnotationPatch } from 'rito/annotations';
import { useControllerEvent } from '../utils/use-controller-event';

export interface AnnotationHover {
  readonly annotation: Annotation;
  readonly x: number;
  readonly y: number;
}

export interface AnnotationsState {
  readonly annotations: readonly Annotation[];
  readonly clickedAnnotation: Annotation | null;
  readonly hover: AnnotationHover | null;
}

export function useAnnotations(controller: ReaderController | null): AnnotationsState & {
  add: (input: Omit<AnnotationInput, 'pageIndex'>) => Annotation | undefined;
  remove: (id: string) => boolean;
  update: (id: string, patch: AnnotationPatch) => boolean;
  clearClicked: () => void;
} {
  const [annotations, setAnnotations] = useState<readonly Annotation[]>([]);
  const [clickedAnnotation, setClickedAnnotation] = useState<Annotation | null>(null);
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
    (input: Omit<AnnotationInput, 'pageIndex'>) => controller?.addAnnotation(input),
    [controller],
  );
  const remove = useCallback(
    (id: string) => controller?.removeAnnotation(id) ?? false,
    [controller],
  );
  const update = useCallback(
    (id: string, patch: AnnotationPatch) => controller?.updateAnnotation(id, patch) ?? false,
    [controller],
  );
  const clearClicked = useCallback(() => {
    setClickedAnnotation(null);
  }, []);

  return { annotations, clickedAnnotation, hover, add, remove, update, clearClicked };
}

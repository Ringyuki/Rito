import { useCallback, useState } from 'react';
import type { ReaderController } from '@rito/kit';
import type { Annotation, AnnotationInput, AnnotationPatch } from 'rito/annotations';
import { useControllerEvent } from '../utils/use-controller-event';

export interface AnnotationsState {
  readonly annotations: readonly Annotation[];
}

export function useAnnotations(controller: ReaderController | null): AnnotationsState & {
  add: (input: Omit<AnnotationInput, 'pageIndex'>) => Annotation | undefined;
  remove: (id: string) => boolean;
  update: (id: string, patch: AnnotationPatch) => boolean;
} {
  const [annotations, setAnnotations] = useState<readonly Annotation[]>([]);

  useControllerEvent(controller, 'annotationsChange', ({ annotations: anns }) => {
    setAnnotations(anns);
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

  return { annotations, add, remove, update };
}

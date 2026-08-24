export interface ImageSizeMap {
  getSize(src: string): { width: number; height: number } | undefined;
}

export {
  createCoordinateMapper,
  type CoordinateMapper,
  type LayoutGeometry,
  type PageGeometry,
} from './coordinate-mapper';
export { resolveSpreadPage } from './page-resolution';
export {
  pageContentRectToSpread,
  spreadContentRectToViewport,
  toViewport,
  scaleRect,
  toScreen,
} from './rect-projection';

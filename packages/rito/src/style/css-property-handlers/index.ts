import { BOX_PROPERTY_HANDLERS } from './box-handlers';
import { LAYOUT_PROPERTY_HANDLERS } from './layout-handlers';
import { SPACING_PROPERTY_HANDLERS } from './spacing-handlers';
import { TEXT_PROPERTY_HANDLERS } from './text-handlers';
import type { PropertyHandlers } from './types';

export const PROPERTY_HANDLERS: PropertyHandlers = {
  ...TEXT_PROPERTY_HANDLERS,
  ...SPACING_PROPERTY_HANDLERS,
  ...BOX_PROPERTY_HANDLERS,
  ...LAYOUT_PROPERTY_HANDLERS,
};

export type { PropertyHandler } from './types';

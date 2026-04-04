import type { Reader } from 'rito';
import type { LinkRegion } from 'rito/advanced';
import type { TypedEmitter } from '../utils/event-emitter';
import type { ReaderControllerEvents } from './types';

export function handleLinkClick(
  region: LinkRegion,
  reader: Reader,
  getCurrentSpread: () => number,
  setCurrentSpread: (idx: number) => void,
  emitter: TypedEmitter<ReaderControllerEvents>,
): void {
  const href = region.href;
  if (href.startsWith('http://') || href.startsWith('https://')) {
    window.open(href, '_blank', 'noopener');
    return;
  }
  const page = reader.findPage({ label: '', href, children: [] });
  if (page === undefined) return;
  const spreadIdx = reader.findSpread(page);
  if (spreadIdx === undefined) return;
  setCurrentSpread(spreadIdx);
  const spread = reader.spreads[spreadIdx];
  if (spread) emitter.emit('spreadChange', { spreadIndex: spreadIdx, spread });
  reader.renderSpread(spreadIdx);
}

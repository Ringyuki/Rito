import type { LayoutConfig, Page, Spread } from '../../layout/core/types';
import { buildPageDisplayList } from './page-display-list';
import type { DisplayList, DisplayListOptions, DrawCommand } from './types';

/** Convert a spread into a platform-neutral display list in logical pixels. */
export function buildSpreadDisplayList(
  spread: Spread,
  config: LayoutConfig,
  options?: DisplayListOptions,
): DisplayList {
  const commands: DrawCommand[] = [];
  appendViewportPaint(commands, config, options?.backgroundColor);

  const bodyBg = resolveSpreadBodyBackground(spread, config);
  appendViewportPaint(commands, config, bodyBg);

  const pageOptions = bodyBg ? { ...options, spreadBodyBg: bodyBg } : options;
  if (spread.left) appendPage(commands, spread.left, config, 0, pageOptions);
  if (config.spreadMode === 'double' && spread.right) {
    appendPage(commands, spread.right, config, config.pageWidth + config.spreadGap, pageOptions);
  }

  return {
    width: config.viewportWidth,
    height: config.viewportHeight,
    commands,
  };
}

function appendViewportPaint(
  commands: DrawCommand[],
  config: LayoutConfig,
  backgroundColor: string | undefined,
): void {
  if (!backgroundColor) return;
  commands.push({
    kind: 'paintPage',
    rect: { x: 0, y: 0, width: config.viewportWidth, height: config.viewportHeight },
    paint: { backgroundColor },
  });
}

function appendPage(
  commands: DrawCommand[],
  page: Page,
  config: LayoutConfig,
  offsetX: number,
  options: DisplayListOptions | undefined,
): void {
  commands.push({ kind: 'pushState' });
  commands.push({ kind: 'translate', dx: offsetX, dy: 0 });
  for (const command of buildPageDisplayList(page, config, options).commands) {
    commands.push(command);
  }
  commands.push({ kind: 'popState' });
}

function resolveSpreadBodyBackground(spread: Spread, config: LayoutConfig): string | undefined {
  if (config.spreadMode !== 'double') return spread.left?.paint?.backgroundColor;

  const leftBg = spread.left?.paint?.backgroundColor;
  const rightBg = spread.right?.paint?.backgroundColor;

  if (leftBg && rightBg && leftBg !== rightBg) return undefined;
  return leftBg ?? rightBg;
}

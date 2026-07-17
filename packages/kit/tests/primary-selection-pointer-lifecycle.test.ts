import { describe, expect, it, vi } from 'vitest';
import { bindPointerEvents } from '../src/controller/wiring/pointer';
import type {
  PrimarySelectionDragNavigation,
  PrimarySelectionDragSession,
} from '../src/controller/wiring/selection-drag';
import {
  createDomTarget,
  createSelectionHarness,
  mouseDown,
  pointer,
  pointerPosition,
} from './helpers/dom-input';

describe('primary pointer selection lifecycle', () => {
  it('resolves the anchor after the selection claim installs a new projection', () => {
    const dom = createDomTarget();
    const selection = createSelectionHarness();
    const session = primarySelectionDragSession(
      () => true,
      () => false,
      () => true,
    );
    let scale = 1;
    const input = { owns: () => true };
    const navigation: PrimarySelectionDragNavigation = {
      claim: () => {
        scale = 2;
        return input;
      },
      begin: (_input, start) => {
        start();
        return session;
      },
    };
    const dispose = bindPointerEvents(
      dom.target as HTMLCanvasElement,
      selection.engine,
      (event) => ({ x: event.clientX / scale, y: event.clientY / scale }),
      vi.fn(),
      navigation,
    );

    dom.emit('pointerdown', pointer(1, 10, 20));

    expect(selection.down).toHaveBeenCalledWith({ x: 5, y: 10 });
    dispose();
  });

  it('clears the exact character session when a semantic claim fails before start', () => {
    const dom = createDomTarget();
    const selection = createSelectionHarness();
    const character = primarySelectionDragSession(
      () => true,
      () => false,
      () => true,
    );
    const rejected = primarySelectionDragSession(
      () => false,
      () => true,
      () => false,
    );
    const input = { owns: () => true };
    const claim = vi.fn(() => input);
    const begin = vi
      .fn<PrimarySelectionDragNavigation['begin']>()
      .mockImplementationOnce((_input, start) => {
        start();
        return character;
      })
      .mockReturnValueOnce(rejected);
    const dispose = bindPointerEvents(
      dom.target as HTMLCanvasElement,
      selection.engine,
      pointerPosition,
      vi.fn(),
      { begin, claim },
    );

    dom.emit('pointerdown', pointer(7, 10, 20));
    dom.emit('mousedown', mouseDown(2));

    expect(selection.down).toHaveBeenCalledOnce();
    expect(claim).toHaveBeenCalledOnce();
    expect(character.cancel).toHaveBeenCalledTimes(2);
    expect(selection.clear).toHaveBeenCalledOnce();
    dispose();
  });

  it('clears a semantic session cancelled by synchronous input reentrancy', () => {
    const dom = createDomTarget();
    const selection = createSelectionHarness();
    const character = primarySelectionDragSession(
      () => true,
      () => false,
      () => true,
    );
    character.cancel.mockReturnValueOnce(true).mockReturnValue(false);
    const semantic = primarySelectionDragSession(
      () => true,
      () => false,
      () => true,
    );
    const input = { owns: () => true };
    const claim = vi.fn(() => input);
    const begin = vi
      .fn<PrimarySelectionDragNavigation['begin']>()
      .mockImplementationOnce((_input, start) => {
        start();
        return character;
      })
      .mockImplementationOnce((_input, start) => {
        start();
        dom.emit('pointercancel', pointer(7, 10, 20));
        return semantic;
      });
    const dispose = bindPointerEvents(
      dom.target as HTMLCanvasElement,
      selection.engine,
      pointerPosition,
      vi.fn(),
      { begin, claim },
    );

    dom.emit('pointerdown', pointer(7, 10, 20));
    dom.emit('mousedown', mouseDown(2));

    expect(semantic.cancel).toHaveBeenCalledOnce();
    expect(selection.clear).toHaveBeenCalledOnce();
    dispose();
  });

  it('clears the exact session superseded only by pending content navigation', () => {
    const fixture = pointerFixture();

    fixture.dom.emit('pointerdown', pointer(1, 10, 20));
    fixture.ownsIntent.value = false;
    fixture.dom.emit('pointermove', pointer(1, 30, 40));
    fixture.dom.emit('pointerup', pointer(1, 30, 40));

    expect(fixture.session.cancel).toHaveBeenCalledOnce();
    expect(fixture.selection.clear).toHaveBeenCalledOnce();
    expect(fixture.selection.move).not.toHaveBeenCalled();
    expect(fixture.selection.up).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it('clears the exact session when pending navigation wins at release', () => {
    const fixture = pointerFixture();

    fixture.dom.emit('pointerdown', pointer(1, 10, 20));
    fixture.ownsIntent.value = false;
    fixture.dom.emit('pointerup', pointer(1, 10, 20));

    expect(fixture.session.cancel).toHaveBeenCalledOnce();
    expect(fixture.selection.clear).toHaveBeenCalledOnce();
    expect(fixture.selection.up).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it('preserves a native click when its empty caret settles before pointerup', () => {
    const fixture = pointerFixture({ settledNaturally: true });

    fixture.dom.emit('pointerdown', pointer(1, 10, 20));
    fixture.ownsIntent.value = false;
    fixture.dom.emit('pointerup', pointer(1, 10, 20));

    expect(fixture.session.cancel).toHaveBeenCalledOnce();
    expect(fixture.selection.up).not.toHaveBeenCalled();
    expect(fixture.click).toHaveBeenCalledWith({ x: 10, y: 20 });
    fixture.dispose();
  });

  it('preserves a native click after sub-threshold movement of an empty caret', () => {
    const fixture = pointerFixture({ settledNaturally: true });

    fixture.dom.emit('pointerdown', pointer(1, 10, 20));
    fixture.ownsIntent.value = false;
    fixture.dom.emit('pointermove', pointer(1, 11, 21));
    fixture.dom.emit('pointerup', pointer(1, 11, 21));

    expect(fixture.selection.move).not.toHaveBeenCalled();
    expect(fixture.click).toHaveBeenCalledWith({ x: 11, y: 21 });
    fixture.dispose();
  });
});

function pointerFixture(options: { readonly settledNaturally?: boolean } = {}) {
  const dom = createDomTarget();
  const selection = createSelectionHarness();
  const click = vi.fn();
  const ownsIntent = { value: true };
  const session = primarySelectionDragSession(
    () => ownsIntent.value,
    () => options.settledNaturally !== true,
    () => options.settledNaturally !== true,
  );
  const navigation: PrimarySelectionDragNavigation = {
    claim: vi.fn(() => ({ owns: () => true })),
    begin: vi.fn<PrimarySelectionDragNavigation['begin']>((_input, start) => {
      start();
      return session;
    }),
  };
  const dispose = bindPointerEvents(
    dom.target as HTMLCanvasElement,
    selection.engine,
    pointerPosition,
    click,
    navigation,
  );
  return { click, dispose, dom, ownsIntent, selection, session };
}

function primarySelectionDragSession(
  owns: () => boolean,
  wasSuperseded: () => boolean,
  ownsCancellation: () => boolean,
) {
  return {
    update: vi.fn(),
    finish: vi.fn(owns),
    cancel: vi.fn(ownsCancellation),
    owns: vi.fn(owns),
    wasSuperseded: vi.fn(wasSuperseded),
    didNavigate: vi.fn(() => false),
  } satisfies PrimarySelectionDragSession;
}

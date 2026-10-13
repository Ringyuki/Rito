/**
 * How far over a curled page must be for the edge of its paper turned over
 * to be where a finger has it.
 *
 * A finger does not move the line the paper leaves the pages at: it moves
 * the edge of the paper turned over, which the line follows by the shape of
 * the roll. So a held page is laid out by asking how far over it must be
 * for its edge to have gone as far as the finger has it, at the height the
 * finger holds it. The edge goes round the roll before it runs on top of
 * it, so the line comes in fast as a page lifts and at half the finger's
 * pace after.
 *
 * Lengths are in the units a frame is drawn in.
 */
import { curlThrough, laidBack, lineAt, standsAt, type Curl, type CurlLine } from './curl';
import type { View } from './hold';
import type { LeafShape } from './leaf';

/** No line leans more than this, as a tangent: nearer a right angle the paper turned over runs along the line, and nothing says how far it has gone across. */
const LEANS_MOST = 0.8;
/** A finger counts as no nearer the corner a page is peeled from than this share of the page's width. */
const BY_THE_CORNER = 0.05;
/** The first of a finger's way is eased into, over this share of the page's width: a finger that has hardly moved lifts nothing. */
const EASES_IN = 0.008;

/** The least the edge counts as gone for each unit its line has come in, so that it comes in all the way. */
const STILL_COMES_IN = 1e-3;
/**
 * What a page's way to the finger that has set off with it is timed by,
 * seconds: nine tenths of the way in a tenth of a second.
 */
const COMES_IN = 0.027;

/** Where the line crosses the page at the height `y`, as x. */
function lineAcross(shape: LeafShape, line: CurlLine, y: number): number {
  const down = Math.min(1, Math.max(0, y / (shape.height || 1)));
  return line.top + (line.bottom - line.top) * down;
}

/**
 * How far past the line the paper lay whose edge shows at a height where
 * the line is `short` of the page's edge. That paper is laid back along the
 * roll's own direction, so on a leaning line its edge shows higher or lower
 * than it lay: the more the paper is laid back, the farther along the edge
 * the point comes from.
 */
function pastFor(curl: Curl, short: number): number {
  const { dx, radius } = curl;
  const leans = (curl.dy / dx) ** 2 * dx;
  const halfTurn = Math.PI * radius;
  const onTop = (short - leans * halfTurn) / (1 / dx - 2 * leans);
  if (onTop >= halfTurn) return onTop;
  let low = 0;
  let high = halfTurn;
  for (let pass = 0; pass < 24; pass += 1) {
    const middle = (low + high) / 2;
    if (middle / dx - leans * laidBack(middle, radius) < short) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/**
 * How far the edge of a page's paper has gone from where it lies flat, as
 * the eye sees it at the height `y`, with the page leaving the pages at
 * `line`. Where the paper has yet to lift at that height it is how far the
 * finger has still to go before it does, below zero: the edge is carried
 * through there without a step.
 */
export function edgeGone(shape: LeafShape, line: CurlLine, y: number, view: View): number {
  const curl = curlThrough(shape, line);
  const edge = shape.spine + shape.width;
  const short = edge - lineAcross(shape, line, y);
  if (short <= 0) return (2 * short) / (1 - (curl.dy / curl.dx) ** 2);
  // Paper in the air shows farther from the middle of the frame than it is: the edge that
  // shows at this height lies nearer the middle by how high it stands.
  const stands = standsAt(pastFor(curl, short), curl.radius);
  const lies = view.height / 2 + ((y - view.height / 2) * (view.eye - stands)) / view.eye;
  const there = edge - lineAcross(shape, line, lies);
  if (there <= 0) return STILL_COMES_IN * short;
  const past = pastFor(curl, there);
  const gone = curl.dx * laidBack(past, curl.radius);
  const middle = view.width / 2;
  const shows =
    middle + ((edge - gone - middle) * view.eye) / (view.eye - standsAt(past, curl.radius));
  // Barely lifted, it shows a hair outward of where it lay: it is counted as coming in all the same.
  return Math.max(STILL_COMES_IN * short, edge - shows);
}

/** How far the edge of a page's paper has gone, the page `shown` of the way over and leaning by `lean`. */
export function gotTo(
  shape: LeafShape,
  shown: number,
  lean: number,
  y: number,
  view: View,
): number {
  return edgeGone(shape, lineAt(shape, shown, lean), y, view);
}

/**
 * How far over a page leaning by `lean` must be for its edge to have gone
 * `to`, at the height `y`. The edge comes in as the page turns, so there is
 * one such place; short of lying flat it lies flat, and past turned it is
 * turned.
 */
export function shownFor(
  shape: LeafShape,
  to: number,
  lean: number,
  y: number,
  view: View,
): number {
  if (gotTo(shape, 0, lean, y, view) >= to) return 0;
  if (gotTo(shape, 1, lean, y, view) <= to) return 1;
  let low = 0;
  let high = 1;
  for (let pass = 0; pass < 30; pass += 1) {
    const middle = (low + high) / 2;
    if (gotTo(shape, middle, lean, y, view) < to) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/**
 * The share still to go of what a page was short of its finger, `seconds`
 * after the finger set off with it. It is off from rest, so the page
 * gathers speed where it would otherwise leap, and all but there in a tenth
 * of a second.
 */
export function stillShort(seconds: number): number {
  const through = Math.max(0, seconds) / COMES_IN;
  return (1 + through) * Math.exp(-through);
}

/** A finger's way as a page taken lying flat is drawn for it: the first of it eased into. */
export function easedIn(shape: LeafShape, gone: number): number {
  if (gone <= 0) return gone;
  return (gone * gone) / (gone + EASES_IN * shape.width);
}

/**
 * How much a page held at the height `y` leans, when `wanted` is what the
 * finger asks for and its edge has gone `gone`. Three things hold it back,
 * each from the shape of the paper alone. The paper at the finger's height
 * must be lifted: taken by a corner a page may lean at once, taken half way
 * up its edge it lifts upright and leans as it comes over. The corner it is
 * peeled from stays no farther over than the finger's height, so a page
 * drawn along its bottom edge stands upright as it goes. And no line leans
 * past `LEANS_MOST`. A page that leant more when it was taken, by `kept`,
 * goes on leaning so.
 */
export function leantBy(
  shape: LeafShape,
  wanted: number,
  gone: number,
  y: number,
  kept: number,
): number {
  const nearest = BY_THE_CORNER * shape.width;
  const within = (toCorner: number, asTaken: number): number => {
    const reach = Math.max(toCorner, nearest);
    const lifted = gone > 0 ? Math.min(gone / reach, reach / gone) : 0;
    return Math.max(Math.min(lifted, LEANS_MOST), Math.min(asTaken, LEANS_MOST));
  };
  const lowerLeads = within(shape.height - y, Math.max(kept, 0));
  const upperLeads = within(y, Math.max(-kept, 0));
  return Math.min(lowerLeads, Math.max(-upperLeads, wanted));
}

import type { BookFixture } from '../../golden-books/helpers/book-manifest';
import { readBookManifest } from '../../golden-books/helpers/book-manifest';
import {
  COMMITTED_PIXEL_PROFILES,
  PIXEL_LINE_BREAKING,
  PIXEL_PROFILES,
  lineBreakingForProfile,
  runTags,
} from './pixel-profile-config';
import type { PixelGoldenScope, PixelSpreadSelection } from './pixel-spread-selection';
import { spreadSelectionForBook } from './pixel-spread-selection';

export type PixelLineBreaking = 'greedy' | 'optimal';
export type PixelSpreadMode = 'single' | 'double';

export interface PixelGoldenProfile {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly margin: number;
  readonly spread: PixelSpreadMode;
  readonly spreadGap: number;
  readonly devicePixelRatio: number;
  readonly threshold: number;
  readonly maxDiffPixelRatio: number;
  readonly tags: readonly string[];
}

export interface PixelGoldenRun {
  readonly id: string;
  readonly bookId: string;
  readonly profile: PixelGoldenProfile;
  readonly lineBreaking: PixelLineBreaking;
  readonly tags: readonly string[];
  readonly spreadSelection: PixelSpreadSelection;
}

export interface PixelGoldenSpreadCase {
  readonly id: string;
  readonly runId: string;
  readonly bookId: string;
  readonly profileId: string;
  readonly spreadIndex: number;
  readonly totalSpreads: number;
  readonly width: number;
  readonly height: number;
  readonly margin: number;
  readonly spread: PixelSpreadMode;
  readonly spreadGap: number;
  readonly lineBreaking: PixelLineBreaking;
  readonly devicePixelRatio: number;
  readonly threshold: number;
  readonly maxDiffPixelRatio: number;
  readonly tags: readonly string[];
}

export interface PixelGoldenSummary {
  readonly bookId: string;
  readonly profileId: string;
  readonly lineBreaking: PixelLineBreaking;
  readonly totalSpreads: number;
  readonly width: number;
  readonly height: number;
  readonly margin: number;
  readonly spread: PixelSpreadMode;
  readonly spreadGap: number;
  readonly devicePixelRatio: number;
  readonly threshold: number;
  readonly maxDiffPixelRatio: number;
}

export interface ResolvedPixelGoldenRun {
  readonly run: PixelGoldenRun;
  readonly book: BookFixture;
}

export function getPixelGoldenRuns(): readonly ResolvedPixelGoldenRun[] {
  const scope = pixelGoldenScope();
  const selectedBooks = parseSelectedValues(process.env['RITO_PIXEL_BOOKS']);
  const selectedProfiles = parseSelectedValues(process.env['RITO_PIXEL_PROFILES']);
  const selectedLineBreaking = parseSelectedValues(process.env['RITO_PIXEL_LINE_BREAKING']);
  const selectedSpreads = parseSelectedSpreadIndexes(process.env['RITO_PIXEL_SPREADS']);
  const renderBooks = readRenderBooks().filter((book) => shouldSelect(book.id, selectedBooks));

  return renderBooks.flatMap((book) =>
    getAllPixelGoldenRunsForBook(book, scope, selectedSpreads).flatMap((run) => {
      if (!shouldSelect(run.profile.id, selectedProfiles)) return [];
      if (!shouldSelect(run.lineBreaking, selectedLineBreaking)) return [];
      return [{ run, book }];
    }),
  );
}

export function getAllPixelGoldenRuns(): readonly PixelGoldenRun[] {
  return readRenderBooks().flatMap((book) => getAllPixelGoldenRunsForBook(book, 'curated', []));
}

export function getAllFullPixelGoldenRuns(): readonly PixelGoldenRun[] {
  return readRenderBooks().flatMap((book) => getAllPixelGoldenRunsForBook(book, 'full', []));
}

export function getAllPixelGoldenProfiles(): readonly PixelGoldenProfile[] {
  return PIXEL_PROFILES;
}

export function getCommittedPixelGoldenProfiles(): readonly PixelGoldenProfile[] {
  return COMMITTED_PIXEL_PROFILES;
}

export function getCommittedPixelRunCountPerBook(): number {
  return COMMITTED_PIXEL_PROFILES.reduce(
    (count, profile) => count + lineBreakingForProfile(profile, 'curated').length,
    0,
  );
}

export function getAllPixelLineBreaking(): readonly PixelLineBreaking[] {
  return PIXEL_LINE_BREAKING;
}

export function createPixelSpreadCase(
  run: PixelGoldenRun,
  spreadIndex: number,
  totalSpreads: number,
): PixelGoldenSpreadCase {
  return {
    id: `${run.id}-spread-${padSpreadIndex(spreadIndex)}`,
    runId: run.id,
    bookId: run.bookId,
    profileId: run.profile.id,
    spreadIndex,
    totalSpreads,
    width: run.profile.width,
    height: run.profile.height,
    margin: run.profile.margin,
    spread: run.profile.spread,
    spreadGap: run.profile.spreadGap,
    lineBreaking: run.lineBreaking,
    devicePixelRatio: run.profile.devicePixelRatio,
    threshold: run.profile.threshold,
    maxDiffPixelRatio: run.profile.maxDiffPixelRatio,
    tags: run.tags,
  };
}

export function createPixelGoldenSummary(
  run: PixelGoldenRun,
  totalSpreads: number,
): PixelGoldenSummary {
  return {
    bookId: run.bookId,
    profileId: run.profile.id,
    lineBreaking: run.lineBreaking,
    totalSpreads,
    width: run.profile.width,
    height: run.profile.height,
    margin: run.profile.margin,
    spread: run.profile.spread,
    spreadGap: run.profile.spreadGap,
    devicePixelRatio: run.profile.devicePixelRatio,
    threshold: run.profile.threshold,
    maxDiffPixelRatio: run.profile.maxDiffPixelRatio,
  };
}

function getAllPixelGoldenRunsForBook(
  book: BookFixture,
  scope: PixelGoldenScope,
  selectedSpreadIndexes: readonly number[],
): readonly PixelGoldenRun[] {
  return pixelProfilesForScope(scope).flatMap((profile) =>
    lineBreakingForProfile(profile, scope).map((lineBreaking) => ({
      id: `${book.id}-${profile.id}-${lineBreaking}`,
      bookId: book.id,
      profile,
      lineBreaking,
      tags: runTags(profile, lineBreaking, scope),
      spreadSelection: spreadSelectionForBook(book, profile, scope, selectedSpreadIndexes),
    })),
  );
}

function parseSelectedValues(value: string | undefined): ReadonlySet<string> {
  if (value === undefined || value.length === 0) return new Set<string>();
  return new Set(
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  );
}

function parseSelectedSpreadIndexes(value: string | undefined): readonly number[] {
  if (value === undefined || value.length === 0) return [];
  return value
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((spreadIndex) => Number.isInteger(spreadIndex) && spreadIndex >= 0);
}

function shouldSelect(value: string, selectedValues: ReadonlySet<string>): boolean {
  return selectedValues.size === 0 || selectedValues.has(value);
}

function readRenderBooks(): readonly BookFixture[] {
  return readBookManifest().filter((book) => book.enabled && book.tiers.includes('render'));
}

function pixelGoldenScope(): PixelGoldenScope {
  return process.env['RITO_PIXEL_SCOPE'] === 'full' ? 'full' : 'curated';
}

function pixelProfilesForScope(scope: PixelGoldenScope): readonly PixelGoldenProfile[] {
  return scope === 'full' ? PIXEL_PROFILES : COMMITTED_PIXEL_PROFILES;
}

function padSpreadIndex(spreadIndex: number): string {
  return String(spreadIndex).padStart(4, '0');
}

export type RitoCoreWasmJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly RitoCoreWasmJsonValue[]
  | RitoCoreWasmJsonObject;

export interface RitoCoreWasmJsonObject {
  readonly [key: string]: RitoCoreWasmJsonValue;
}

export type RitoCoreWasmResourceKind = 'image' | 'font' | 'stylesheet';
export type RitoCoreWasmLineBreaking = 'greedy' | 'optimal';
export type RitoCoreWasmSpreadMode = 'single' | 'double';
export type RitoCoreWasmTextMeasurementMode = 'fixtureCompatible' | 'fontAware';

export interface RitoCoreWasmPaginationPolicy {
  readonly enabled?: boolean | undefined;
  readonly defaultOrphans?: number | undefined;
  readonly defaultWidows?: number | undefined;
}

export interface RitoCoreWasmLayoutConfig {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly marginTop: number;
  readonly marginRight: number;
  readonly marginBottom: number;
  readonly marginLeft: number;
  readonly spreadMode: RitoCoreWasmSpreadMode;
  readonly firstPageAlone: boolean;
  readonly spreadGap: number;
  readonly rootFontSize: number;
  readonly lineHeightOverride?: number | undefined;
  readonly lineHeightForce?: boolean | undefined;
  readonly fontFamilyOverride?: string | undefined;
  readonly fontFamilyForce?: boolean | undefined;
  readonly paginationPolicy?: RitoCoreWasmPaginationPolicy | undefined;
  readonly textMeasurement?: RitoCoreWasmTextMeasurementMode | undefined;
  /** Host Canvas advances in em units for generic-serif fallback characters. */
  readonly genericSerifAdvances?: Readonly<Record<string, number>> | undefined;
  /** Host Canvas pair adjustments in em units for generic-serif fallback runs. */
  readonly genericSerifPairAdjustments?: Readonly<Record<string, number>> | undefined;
  /** Host Canvas advances for missing glyph fallback under publication font families. */
  readonly fontFamilyAdvances?:
    | Readonly<Record<string, Readonly<Record<string, number>>>>
    | undefined;
  /** Host Canvas pair adjustments for fallback runs under publication font families. */
  readonly fontFamilyPairAdjustments?:
    | Readonly<Record<string, Readonly<Record<string, number>>>>
    | undefined;
}

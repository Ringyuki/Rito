export function requireFontVerticalMetricDemands(value, operation) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new Error(`${operation} returned malformed vertical font metric demands`);
  }
  const seen = new Set();
  for (const item of value) {
    const demand = requireDemandObject(item, operation);
    requireDemand(demand, `${operation} returned malformed vertical font metric demand`);
    const key = demandKey(demand);
    if (seen.has(key)) {
      throw new Error(`${operation} returned duplicate vertical font metric demands`);
    }
    seen.add(key);
  }
}

export function requireFontVerticalMetricSamples(value, operation) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${operation} requires at least one vertical font metric sample`);
  }
  const seen = new Set();
  return value.map((item) => {
    const sample = requireSampleObject(item, operation);
    const demand = requireDemand(
      sample,
      `${operation} received malformed vertical font metric sample`,
    );
    if (
      !validMetric(sample.topBaselineAscentPx) ||
      !validMetric(sample.topBaselineDescentPx) ||
      sample.topBaselineAscentPx + sample.topBaselineDescentPx <= 0
    ) {
      throw new Error(`${operation} received malformed vertical font metric sample`);
    }
    const key = demandKey(demand, true);
    if (seen.has(key)) {
      throw new Error(`${operation} received duplicate vertical font metric samples`);
    }
    seen.add(key);
    return {
      ...demand,
      topBaselineAscentPx: sample.topBaselineAscentPx,
      topBaselineDescentPx: sample.topBaselineDescentPx,
    };
  });
}

function requireDemand(value, errorMessage) {
  if (
    typeof value.fontFamily !== 'string' ||
    value.fontFamily.length === 0 ||
    (value.fontStyle !== 'normal' && value.fontStyle !== 'italic') ||
    !Number.isSafeInteger(value.fontWeight) ||
    value.fontWeight <= 0 ||
    value.fontWeight > 1000 ||
    !Number.isFinite(value.fontSizePx) ||
    value.fontSizePx <= 0
  ) {
    throw new Error(errorMessage);
  }
  return {
    fontFamily: value.fontFamily,
    fontStyle: value.fontStyle,
    fontWeight: value.fontWeight,
    fontSizePx: value.fontSizePx,
  };
}

function requireDemandObject(value, operation) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${operation} returned malformed vertical font metric demand`);
  }
  const fields = ['fontFamily', 'fontStyle', 'fontWeight', 'fontSizePx'];
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
    throw new Error(`${operation} returned malformed vertical font metric demand`);
  }
  return value;
}

function requireSampleObject(value, operation) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${operation} received malformed vertical font metric sample`);
  }
  const fields = [
    'fontFamily',
    'fontStyle',
    'fontWeight',
    'fontSizePx',
    'topBaselineAscentPx',
    'topBaselineDescentPx',
  ];
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
    throw new Error(`${operation} received malformed vertical font metric sample`);
  }
  return value;
}

function demandKey(demand, foldFamilyCase = false) {
  return JSON.stringify([
    foldFamilyCase ? asciiLowerCase(demand.fontFamily) : demand.fontFamily,
    demand.fontStyle,
    demand.fontWeight,
    demand.fontSizePx,
  ]);
}

function asciiLowerCase(value) {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function validMetric(value) {
  return Number.isFinite(value) && value >= 0;
}

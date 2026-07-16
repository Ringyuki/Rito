export function requireFontVerticalMetricDemands(value, operation) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new Error(`${operation} returned malformed vertical font metric demands`);
  }
  const seen = new Set();
  for (const item of value) {
    const demand = requireDemandObject(item, operation);
    if (
      typeof demand.fontFamily !== 'string' ||
      demand.fontFamily.length === 0 ||
      (demand.fontStyle !== 'normal' && demand.fontStyle !== 'italic') ||
      !Number.isSafeInteger(demand.fontWeight) ||
      demand.fontWeight <= 0 ||
      demand.fontWeight > 1000 ||
      !Number.isFinite(demand.fontSizePx) ||
      demand.fontSizePx <= 0
    ) {
      throw new Error(`${operation} returned malformed vertical font metric demand`);
    }
    const key = JSON.stringify([
      demand.fontFamily,
      demand.fontStyle,
      demand.fontWeight,
      demand.fontSizePx,
    ]);
    if (seen.has(key)) {
      throw new Error(`${operation} returned duplicate vertical font metric demands`);
    }
    seen.add(key);
  }
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

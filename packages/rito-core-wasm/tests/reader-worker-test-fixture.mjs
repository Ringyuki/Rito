const EMPTY_POLICY_ID = '01'.repeat(32);

export function emptyPinnedFontPolicySummary() {
  return { schemaVersion: 1, policyId: EMPTY_POLICY_ID, faces: [] };
}

export function readerOpenResult(publication = { title: 'Fixture' }) {
  return { publication, pinnedFontPolicy: emptyPinnedFontPolicySummary() };
}

export function pinnedFontPolicyJson() {
  return JSON.stringify(emptyPinnedFontPolicySummary());
}

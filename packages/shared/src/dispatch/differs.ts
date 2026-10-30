type Count = Record<string, number>;

/**
 * Does the dispatch the human chose differ from what the triage recommended (FR-S5-06)?
 * Only the unit types and how many of each count: sending a different unit of the same type is not a modification.
 * The one rule, shared by the dispatch form (to ask for a reason) and the server (to refuse without one).
 */
export function dispatchDiffers(
  recommended: readonly { type: string; count: number }[] | null,
  chosenTypes: readonly string[],
): boolean {
  const wanted: Count = {};
  for (const { type, count } of recommended ?? []) wanted[type] = (wanted[type] ?? 0) + count;
  const given: Count = {};
  for (const type of chosenTypes) given[type] = (given[type] ?? 0) + 1;
  return Object.keys({ ...wanted, ...given }).some((type) => (wanted[type] ?? 0) !== (given[type] ?? 0));
}

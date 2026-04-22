export function accumulateComplex(values: readonly number[]) {
  let total = 0;

  try {
    for (const value of values) {
      if (value < 0) {
        return total;
      }

      total += normalizeValue(value);
    }
  } catch (error) {
    return -1;
  }

  return total;
}

function normalizeValue(value: number) {
  return value * 2;
}

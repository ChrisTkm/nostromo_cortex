export function accumulate(limit: number) {
  let total = 0;

  if (limit <= 0) {
    return total;
  }

  for (let index = 0; index < limit; index += 1) {
    total += index;
  }

  return total;
}

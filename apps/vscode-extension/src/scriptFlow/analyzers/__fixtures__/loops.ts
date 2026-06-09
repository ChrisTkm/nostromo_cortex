function processItems(items: string[]): number {
  let count = 0;
  for (const item of items) {
    if (item.length > 0) {
      count += 1;
    }
  }
  return count;
}

function pollUntilReady(maxRetries: number): boolean {
  let done = false;
  let attempts = 0;
  while (!done && attempts < maxRetries) {
    done = Math.random() > 0.5;
    attempts += 1;
  }
  return done;
}

function retryOnce<T>(fn: () => T): T | undefined {
  let result: T | undefined;
  let ok = false;
  do {
    try {
      result = fn();
      ok = true;
    } catch {
      ok = false;
    }
  } while (!ok);
  return result;
}

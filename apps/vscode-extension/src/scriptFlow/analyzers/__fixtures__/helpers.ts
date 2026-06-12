import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

let _dir: string;

function getDir(): string {
  if (!_dir) {
    _dir = path.dirname(fileURLToPath(import.meta.url));
  }
  return _dir;
}

export function loadFixture(name: string): string {
  const fixturePath = path.join(getDir(), name);
  return readFileSync(fixturePath, "utf8");
}

export const FIXTURES_DIR = getDir();

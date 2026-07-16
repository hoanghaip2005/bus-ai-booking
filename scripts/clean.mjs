import { rm } from 'node:fs/promises';
import { glob } from 'node:fs/promises';

const removable = ['dist', '.next', '.turbo', 'coverage'];

for await (const entry of glob(['apps/*/*', 'services/*/*', 'packages/*/*'], {
  cwd: process.cwd(),
  withFileTypes: true,
})) {
  if (entry.isDirectory() && removable.includes(entry.name)) {
    await rm(entry.fullPath(), { recursive: true, force: true });
  }
}

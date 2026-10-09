/** Export only this standalone engine's source, with an auditable file manifest. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] ?? path.join(root, 'dist', 'nds-ts-source.tar.gz'));
const roots = [
  'LICENSE', 'README.md', 'package.json', 'package-lock.json', 'tsconfig.json',
  'Makefile', '.gitignore', 'vite.config.ts', 'index.html', 'sdk', 'native', 'web', 'examples', 'tools', 'tests', 'vendor',
];
const allowedExtension = /\.(?:c|h|cpp|hpp|ts|js|json|md|rst|py|sh|html|css|txt)$/i;
const ignored = new Set(['.DS_Store', '__pycache__', 'node_modules', 'dist', 'build', '.cache', 'captures']);
const staging = await mkdtemp(path.join(tmpdir(), 'nds-ts-source-'));
const destination = path.join(staging, 'nds-ts');
const files: { path: string; sha256: string; bytes: number }[] = [];

async function copySource(relative: string): Promise<void> {
  const source = path.join(root, relative);
  let info;
  try {
    info = await lstat(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (info.isSymbolicLink()) throw new Error(`Source export refuses symbolic link: ${relative}`);
  if (info.isDirectory()) {
    for (const name of (await readdir(source)).sort()) {
      if (!ignored.has(name) && !name.startsWith('.')) await copySource(path.join(relative, name));
    }
    return;
  }
  if (!info.isFile()) throw new Error(`Source export refuses non-regular file: ${relative}`);
  if (!roots.includes(relative) && !allowedExtension.test(relative)) {
    throw new Error(`Review this file type before adding it to the public export: ${relative}`);
  }
  const content = await readFile(source);
  const target = path.join(destination, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  files.push({ path: relative.replaceAll(path.sep, '/'),
    sha256: createHash('sha256').update(content).digest('hex'), bytes: content.length });
}

try {
  for (const entry of roots) await copySource(entry);
  for (const required of ['README.md', 'LICENSE', 'package.json', 'Makefile']) {
    if (!files.some(file => file.path === required)) throw new Error(`Missing required source: ${required}`);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  await writeFile(path.join(destination, 'SOURCE-MANIFEST.json'), JSON.stringify({
    format: 1,
    description: 'Standalone nds-ts sources. Original game files and Git history are excluded.',
    files,
  }, null, 2) + '\n');
  await mkdir(path.dirname(output), { recursive: true });
  const result = spawnSync('tar', ['-czf', output, '-C', staging, 'nds-ts'], {
    encoding: 'utf8', env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `tar exited with ${result.status}`);
  const archive = await readFile(output);
  console.log(JSON.stringify({ archive: output, files: files.length,
    bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex') }, null, 2));
} finally {
  await rm(staging, { recursive: true, force: true });
}

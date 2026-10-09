import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('public source archive is self-contained, hashed, and refuses external symlinks', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'nds-ts-export-test-'));
  const symlink = path.join(root, 'tests', `export-symlink-${process.pid}.ts`);
  try {
    const archive = path.join(temporary, 'source.tar.gz');
    const build = spawnSync(process.execPath, ['--import', 'tsx', 'tools/package-source.ts', archive], {
      cwd: root, encoding: 'utf8',
    });
    assert.equal(build.status, 0, build.stderr);
    const listing = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' });
    assert.equal(listing.status, 0, listing.stderr);
    const members = listing.stdout.trim().split('\n');
    for (const member of members) {
      assert.ok(member.startsWith('nds-ts/'), `Archive member escaped source root: ${member}`);
      assert.doesNotMatch(member, /(?:^|\/)(?:\.git|\.cache|node_modules|gen|build|captures|dist|\.DS_Store|\._[^/]*)(?:\/|$)/);
    }
    for (const required of ['README.md', 'LICENSE', 'Makefile', 'package.json',
      'sdk/index.d.ts', 'native/runtime.cpp', 'vendor/duktape/LICENSE.txt', 'vendor/duktape/AUTHORS.rst',
      'examples/dual-screen/main.ts', 'web/index.html', 'tools/verify-rom.py', 'tests/libretro_runner.py']) {
      assert.ok(members.includes(`nds-ts/${required}`), `Missing source package member: ${required}`);
    }
    const extract = spawnSync('tar', ['-xzf', archive, '-C', temporary], { encoding: 'utf8' });
    assert.equal(extract.status, 0, extract.stderr);
    const extracted = path.join(temporary, 'nds-ts');
    const manifest = JSON.parse(readFileSync(path.join(extracted, 'SOURCE-MANIFEST.json'), 'utf8')) as {
      format: number; files: { path: string; sha256: string; bytes: number }[];
    };
    assert.equal(manifest.format, 1);
    const actualFiles: string[] = [];
    function visit(relative: string): void {
      for (const entry of readdirSync(path.join(extracted, relative), { withFileTypes: true })) {
        const filename = path.join(relative, entry.name);
        if (entry.isDirectory()) visit(filename);
        else actualFiles.push(filename.replaceAll(path.sep, '/'));
      }
    }
    visit('');
    assert.deepEqual(actualFiles.sort(), [...manifest.files.map(file => file.path), 'SOURCE-MANIFEST.json'].sort());
    for (const file of manifest.files) {
      assert.ok(!file.path.startsWith('/') && !file.path.split('/').includes('..'));
      const contents = readFileSync(path.join(extracted, file.path));
      assert.equal(contents.length, file.bytes);
      assert.equal(createHash('sha256').update(contents).digest('hex'), file.sha256);
    }
    const outside = path.join(temporary, 'outside.ts');
    writeFileSync(outside, 'var privateTestMarker = "excluded";\n');
    symlinkSync(outside, symlink);
    const reject = spawnSync(process.execPath, ['--import', 'tsx', 'tools/package-source.ts', path.join(temporary, 'rejected.tar.gz')], {
      cwd: root, encoding: 'utf8',
    });
    assert.notEqual(reject.status, 0);
    assert.match(reject.stderr, /refuses symbolic link/);
  } finally {
    rmSync(symlink, { force: true });
    rmSync(temporary, { recursive: true, force: true });
  }
});

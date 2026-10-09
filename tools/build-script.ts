import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { FONT_BITMAPS } from '../sdk/font.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function printDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n',
  });
}

/** Compile one global TypeScript game and embed it without any filesystem at runtime. */
export function buildGame(entryArgument?: string, outputArgument?: string): { bytes: number; output: string } {
  const entry = entryArgument ? resolve(entryArgument) : resolve(packageRoot, 'examples/dual-screen/main.ts');
  const output = outputArgument ? resolve(outputArgument) : resolve(packageRoot, 'gen');
  const sdk = resolve(packageRoot, 'sdk/index.d.ts');
  const source = readFileSync(entry, 'utf8');
  const sourceFile = ts.createSourceFile(entry, source, ts.ScriptTarget.Latest, true);
  if (sourceFile.referencedFiles.some((reference) => resolve(dirname(entry), reference.fileName) !== sdk) ||
      sourceFile.typeReferenceDirectives.length || sourceFile.libReferenceDirectives.length) {
    throw new Error(`${entry}: v0.1 games may only reference sdk/index.d.ts; external source, type, and lib references are unsupported.`);
  }
  const invalid: ts.Node[] = [];
  function inspect(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isImportTypeNode(node) ||
        (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) ||
        ts.isExportDeclaration(node) || ts.isExportAssignment(node) ||
        (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) =>
          modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword))) {
      invalid.push(node);
    }
    ts.forEachChild(node, inspect);
  }
  inspect(sourceFile);
  if (invalid.length > 0) {
    const position = sourceFile.getLineAndCharacterOfPosition(invalid[0].getStart(sourceFile));
    throw new Error(`${entry}:${position.line + 1}:${position.character + 1}: v0.1 games are global scripts; imports and exports are unsupported.`);
  }

  // Restrict typechecking to ES5 + this SDK. Browser/Node globals never reach games.
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES5,
    module: ts.ModuleKind.None,
    moduleDetection: ts.ModuleDetectionKind.Legacy,
    lib: ['lib.es5.d.ts'],
    types: [],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };
  // Derive a distinct virtual path from the entry itself to prevent an arbitrary
  // entry path from colliding with (and being replaced by) this validation file.
  const validation = entry + '.__nds_validate__.ts';
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (filename, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (filename === validation) {
      return ts.createSourceFile(filename, 'game satisfies NDSGame;\n', languageVersion, true);
    }
    return originalGetSourceFile(filename, languageVersion, onError, shouldCreateNewSourceFile);
  };
  const program = ts.createProgram([sdk, entry, validation], options, host);
  const unembedded = program.getSourceFiles().find((file) => !file.isDeclarationFile && file.fileName !== entry && file.fileName !== validation);
  if (unembedded) throw new Error(`${unembedded.fileName}: external implementation would not be embedded; v0.1 requires one global game script.`);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0) throw new Error(printDiagnostics(diagnostics));

  const transpiled = ts.transpileModule(source, {
    fileName: entry,
    compilerOptions: {
      target: ts.ScriptTarget.ES5,
      // transpileModule requires a module option for ES5; with no import/export
      // and legacy detection it still emits this source as a plain global script.
      module: ts.ModuleKind.CommonJS,
      moduleDetection: ts.ModuleDetectionKind.Legacy,
      newLine: ts.NewLineKind.LineFeed,
      removeComments: true,
      alwaysStrict: true,
    },
    reportDiagnostics: true,
  });
  if (transpiled.diagnostics?.length) throw new Error(printDiagnostics(transpiled.diagnostics));
  const script = transpiled.outputText;
  const bytes = Buffer.from(script, 'utf8');
  const rows: string[] = [];
  for (let start = 0; start < bytes.length; start += 16) {
    rows.push('  ' + Array.from(bytes.subarray(start, start + 16), (byte) =>
      `0x${byte.toString(16).padStart(2, '0')}`).join(', ') + ',');
  }
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, 'game.js'), script);
  writeFileSync(resolve(output, 'script_gen.h'), [
    '// Generated by tools/build-script.ts. Do not edit.',
    '#pragma once',
    'static const unsigned char GAME_SCRIPT[] = {',
    ...rows,
    '  0x00',
    '};',
    `static const unsigned int GAME_SCRIPT_LENGTH = ${bytes.length};`,
    '',
  ].join('\n'));
  writeFileSync(resolve(output, 'font_gen.h'), [
    '// Original 3x5 font. Generated by tools/build-script.ts. Do not edit.',
    '#pragma once',
    '#include <stdint.h>',
    'struct FontGlyph { char character; uint16_t bits; };',
    'static constexpr FontGlyph FONT_GLYPHS[] = {',
    ...FONT_BITMAPS.map((bitmap, index) => `  { ${index + 32}, 0x${bitmap.toString(16).padStart(4, '0')} },`),
    '};',
    'static constexpr unsigned int FONT_GLYPH_COUNT = sizeof(FONT_GLYPHS) / sizeof(FONT_GLYPHS[0]);',
    '',
  ].join('\n'));
  return { bytes: bytes.length, output };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = buildGame(process.argv[2], process.argv[3]);
    console.log(`Compiled ES5 game (${result.bytes} bytes) → ${result.output}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

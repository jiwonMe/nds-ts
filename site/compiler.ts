/** In-browser copy of tools/build-script.ts: the same references check, the same
 * import/export ban, the same ES5 + SDK typecheck and the same transpile options.
 * TypeScript loads on first use, so the page itself stays small. */
import type * as TS from 'typescript';
import type { Watchdog } from './console.js';

export interface Diagnostic {
  line: number;
  column: number;
  message: string;
}

export type CompileResult =
  | { ok: true; script: string; guarded: string }
  | { ok: false; diagnostics: Diagnostic[] };

const ENTRY = '/examples/cartridge/main.ts';
const SDK = '/sdk/index.d.ts';
const VALIDATION = `${ENTRY}.__nds_validate__.ts`;

export interface Compiler {
  version: string;
  compile(source: string): CompileResult;
}

let loading: Promise<Compiler> | null = null;

/** Set VITE_TYPESCRIPT_URL at build time to load TypeScript's browser build from a
 * CDN (it defines a global `ts`) instead of bundling node_modules/typescript. */
function loadTypeScript(): Promise<typeof TS> {
  const url = import.meta.env.VITE_TYPESCRIPT_URL;
  if (url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.crossOrigin = 'anonymous';
      script.onload = () => {
        const ts = (globalThis as { ts?: typeof TS }).ts;
        if (ts) resolve(ts);
        else reject(new Error(`${url} did not define ts`));
      };
      script.onerror = () => reject(new Error(`could not load ${url}`));
      document.head.append(script);
    });
  }
  return import('typescript').then((module) => ((module as { default?: typeof TS }).default ?? module) as typeof TS);
}

export function loadCompiler(): Promise<Compiler> {
  loading ??= Promise.all([
    loadTypeScript(),
    import('typescript/lib/lib.es5.d.ts?raw'),
    import('typescript/lib/lib.decorators.d.ts?raw'),
    import('typescript/lib/lib.decorators.legacy.d.ts?raw'),
    import('../sdk/index.d.ts?raw'),
  ]).then(([ts, es5, decorators, legacy, sdk]) => {
    const files = new Map<string, string>([
      ['/lib.es5.d.ts', es5.default],
      ['/lib.decorators.d.ts', decorators.default],
      ['/lib.decorators.legacy.d.ts', legacy.default],
      [SDK, sdk.default],
    ]);
    return { version: ts.version, compile: (source: string) => compile(ts, files, source) };
  });
  loading.catch(() => { loading = null; });
  return loading;
}

function compile(ts: typeof TS, libraries: Map<string, string>, source: string): CompileResult {
  const sourceFile = ts.createSourceFile(ENTRY, source, ts.ScriptTarget.Latest, true);
  const at = (node: TS.Node | number, message: string): CompileResult => {
    const position = typeof node === 'number' ? node : node.getStart(sourceFile);
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(position);
    return { ok: false, diagnostics: [{ line: line + 1, column: character + 1, message }] };
  };
  for (const reference of sourceFile.referencedFiles) {
    if (resolvePath(ENTRY, reference.fileName) !== SDK) {
      return at(reference.pos, 'v0.1 games may only reference sdk/index.d.ts; external source, type, and lib references are unsupported.');
    }
  }
  const directive = sourceFile.typeReferenceDirectives[0] ?? sourceFile.libReferenceDirectives[0];
  if (directive) return at(directive.pos, 'v0.1 games may only reference sdk/index.d.ts; external source, type, and lib references are unsupported.');

  let invalid: TS.Node | null = null;
  const inspect = (node: TS.Node): void => {
    if (invalid) return;
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isImportTypeNode(node) ||
        (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) ||
        ts.isExportDeclaration(node) || ts.isExportAssignment(node) ||
        (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) =>
          modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword))) {
      invalid = node;
      return;
    }
    ts.forEachChild(node, inspect);
  };
  inspect(sourceFile);
  if (invalid) return at(invalid, 'v0.1 games are global scripts; imports and exports are unsupported.');

  const options: TS.CompilerOptions = {
    target: ts.ScriptTarget.ES5,
    module: ts.ModuleKind.None,
    moduleDetection: ts.ModuleDetectionKind.Legacy,
    lib: ['lib.es5.d.ts'],
    types: [],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };
  const files = new Map(libraries);
  files.set(ENTRY, source);
  files.set(VALIDATION, 'game satisfies NDSGame;\n');
  const host: TS.CompilerHost = {
    getSourceFile: (name, version) => {
      const text = files.get(name);
      return text === undefined ? undefined : name === ENTRY ? sourceFile : ts.createSourceFile(name, text, version, true);
    },
    getDefaultLibFileName: () => '/lib.es5.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (name) => files.has(name),
    readFile: (name) => files.get(name),
    directoryExists: () => true,
    getDirectories: () => [],
  };
  const program = ts.createProgram([SDK, ENTRY, VALIDATION], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: diagnostics.map((diagnostic) => {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
        if (!diagnostic.file || diagnostic.start === undefined) return { line: 0, column: 0, message };
        const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
        const where = diagnostic.file.fileName === ENTRY ? '' : `${diagnostic.file.fileName}: `;
        return { line: diagnostic.file.fileName === ENTRY ? line + 1 : 0, column: character + 1, message: where + message };
      }),
    };
  }

  const transpile = (guard: boolean) => ts.transpileModule(source, {
    fileName: ENTRY,
    compilerOptions: {
      target: ts.ScriptTarget.ES5,
      module: ts.ModuleKind.CommonJS,
      moduleDetection: ts.ModuleDetectionKind.Legacy,
      newLine: ts.NewLineKind.LineFeed,
      removeComments: true,
      alwaysStrict: true,
    },
    transformers: guard ? { before: [loopWatchdog(ts)] } : undefined,
  }).outputText;
  return { ok: true, script: transpile(false), guarded: transpile(true) };
}

function resolvePath(from: string, relative: string): string {
  const parts = from.split('/').slice(0, -1);
  for (const part of relative.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part !== '') parts.push(part);
  }
  return parts.join('/');
}

/** Inserts `__nds_watchdog()` at the top of every loop body. The browser cannot
 * interrupt a script the way Duktape can, so edited code checks in instead. */
function loopWatchdog(ts: typeof TS): TS.TransformerFactory<TS.SourceFile> {
  return (context) => {
    const factory = context.factory;
    const visit = (input: TS.Node): TS.Node => {
      const node = ts.visitEachChild(input, visit, context);
      if (!ts.isForStatement(node) && !ts.isWhileStatement(node) && !ts.isDoStatement(node) && !ts.isForInStatement(node)) return node;
      const check = factory.createExpressionStatement(factory.createCallExpression(factory.createIdentifier('__nds_watchdog'), undefined, []));
      const body = ts.isBlock(node.statement)
        ? factory.updateBlock(node.statement, [check, ...node.statement.statements])
        : factory.createBlock([check, node.statement], true);
      if (ts.isForStatement(node)) return factory.updateForStatement(node, node.initializer, node.condition, node.incrementor, body);
      if (ts.isWhileStatement(node)) return factory.updateWhileStatement(node, node.expression, body);
      if (ts.isDoStatement(node)) return factory.updateDoStatement(node, body, node.expression);
      return factory.updateForInStatement(node, node.initializer, node.expression, body);
    };
    return (file) => ts.visitNode(file, visit) as TS.SourceFile;
  };
}

/** Mirrors the native budgets: 500 ms for boot, 100 ms for each callback. */
export function createWatchdog(): Watchdog {
  let started = 0;
  let budget = 100;
  let count = 0;
  return {
    reset(milliseconds = 100) {
      started = performance.now();
      budget = milliseconds;
      count = 0;
    },
    check() {
      if ((++count & 1023) === 0 && performance.now() - started > budget) throw new RangeError('execution timeout');
    },
  };
}

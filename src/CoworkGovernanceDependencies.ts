import path from "node:path";
import ts from "typescript";
import type { CoworkGovernanceResult } from "./CoworkGovernanceContract.js";

export type CoworkDependencyRole =
  | "contract"
  | "kit"
  | "implementation"
  | "binary";

export interface CoworkDependencyFile {
  readonly file: string;
  readonly source: string;
  readonly component: string;
  readonly role: CoworkDependencyRole;
  readonly governed: boolean;
}

export interface CoworkDependencyViolation {
  readonly from: string;
  readonly to: string;
  readonly rule: string;
  readonly identity: string;
}

export interface CoworkDependencyResult extends CoworkGovernanceResult {
  readonly violations: readonly CoworkDependencyViolation[];
  readonly regressions: number;
}

export interface CoworkDependencyPolicy {
  readonly legacyBaseline: readonly string[];
  readonly compilerOptions?: ts.CompilerOptions;
}

/** Virtual compiler resolution: no repository/network reads or package execution. */
export function evaluateCoworkDependencies(
  files: readonly CoworkDependencyFile[],
  policy: CoworkDependencyPolicy = { legacyBaseline: [] },
): CoworkDependencyResult {
  const root = path.resolve("cowork-dependency-root");
  const validFile = (file: string): boolean =>
    /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,499}\.[cm]?[jt]sx?$/.test(file) &&
    !file
      .split("/")
      .some((part) => part === "" || part === "." || part === "..");
  const invalid =
    files.length === 0 ||
    files.length > 10000 ||
    new Set(files.map((file) => file.file)).size !== files.length ||
    files.some(
      (file) =>
        !validFile(file.file) ||
        !file.component ||
        !["contract", "kit", "implementation", "binary"].includes(file.role),
    ) ||
    new Set(policy.legacyBaseline).size !== policy.legacyBaseline.length;
  if (invalid) {
    return {
      state: "failed",
      evaluatedScope: 0,
      regressions: 1,
      violations: [],
      checks: [
        {
          name: "dependency-input",
          state: "failed",
          evidence: ["invalid-input"],
        },
      ],
    };
  }
  const inventory = new Map(
    files.map((file) => [path.resolve(root, file.file), file]),
  );
  const directories = new Set<string>();
  for (const name of inventory.keys()) {
    let parent = path.dirname(name);
    while (parent.startsWith(root)) {
      directories.add(parent);
      if (parent === root) break;
      parent = path.dirname(parent);
    }
  }
  const resolutionHost: ts.ModuleResolutionHost = {
    fileExists: (file) => inventory.has(path.resolve(file)),
    readFile: (file) => inventory.get(path.resolve(file))?.source,
    directoryExists: (directory) => directories.has(path.resolve(directory)),
    getCurrentDirectory: () => root,
    realpath: (file) => path.resolve(file),
  };
  const violations: CoworkDependencyViolation[] = [];
  const add = (from: string, to: string, rule: string): void => {
    const identity = JSON.stringify([from, to, rule]);
    if (!violations.some((violation) => violation.identity === identity)) {
      violations.push({ from, to, rule, identity });
    }
  };
  const options: ts.CompilerOptions = {
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    module: ts.ModuleKind.NodeNext,
    ...policy.compilerOptions,
    baseUrl: policy.compilerOptions?.baseUrl
      ? path.resolve(root, policy.compilerOptions.baseUrl)
      : root,
  };
  const compilerHost: ts.CompilerHost = {
    ...ts.createCompilerHost(options),
    ...resolutionHost,
    useCaseSensitiveFileNames: () => true,
    writeFile: () => {
      throw new Error("dependency-gate-is-read-only");
    },
    getSourceFile: (filename, languageVersion) => {
      const file = inventory.get(path.resolve(filename));
      return file
        ? ts.createSourceFile(filename, file.source, languageVersion, true)
        : undefined;
    },
  };
  const program = ts.createProgram(
    [...inventory.keys()],
    options,
    compilerHost,
  );
  for (const file of files) {
    const filename = path.resolve(root, file.file);
    const source = program.getSourceFile(filename)!;
    if (program.getSyntacticDiagnostics(source).length > 0) {
      add(file.file, file.file, "invalid-typescript-syntax");
    }
    const importedNames = new Set<string>();
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && statement.importClause) {
        const clause = statement.importClause;
        if (clause.name) importedNames.add(clause.name.text);
        if (clause.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings)) {
            importedNames.add(clause.namedBindings.name.text);
          } else {
            for (const binding of clause.namedBindings.elements) {
              importedNames.add(binding.name.text);
            }
          }
        }
      }
    }
    const edge = (specifier: ts.Expression): void => {
      if (!ts.isStringLiteralLike(specifier)) {
        add(file.file, "<computed>", "unresolved-computed-import");
        return;
      }
      const targetName = ts.resolveModuleName(
        specifier.text,
        filename,
        options,
        resolutionHost,
      ).resolvedModule?.resolvedFileName;
      const target = targetName
        ? inventory.get(path.resolve(targetName))
        : undefined;
      if (!target) {
        const alias = Object.keys(options.paths ?? {}).some((pattern) => {
          const [prefix, suffix = ""] = pattern.split("*");
          return pattern.includes("*")
            ? specifier.text.startsWith(prefix!) &&
                specifier.text.endsWith(suffix)
            : specifier.text === pattern;
        });
        if (
          specifier.text.startsWith(".") ||
          alias ||
          path.isAbsolute(specifier.text)
        ) {
          add(file.file, specifier.text, "unclassified-local-dependency");
        }
        return;
      }
      const permitted =
        target.role !== "binary" &&
        (file.role === "binary" ||
          (file.role === "implementation" &&
            ["contract", "kit"].includes(target.role)) ||
          (file.role === "kit" && ["contract", "kit"].includes(target.role)) ||
          (file.role === "contract" && target.role === "contract"));
      if (!permitted) add(file.file, target.file, "forbidden-role-edge");
    };
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier) edge(node.moduleSpecifier);
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression
      ) {
        edge(node.moduleReference.expression);
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      ) {
        if (node.arguments.length !== 1 || !node.arguments[0]) {
          add(file.file, "<computed>", "unresolved-computed-import");
        } else edge(node.arguments[0]);
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument)
      ) {
        if (ts.isStringLiteral(node.argument.literal))
          edge(node.argument.literal);
      }
      if (
        file.role === "binary" &&
        (ts.isExportAssignment(node) ||
          (ts.isExportDeclaration(node) &&
            (!node.exportClause ||
              !ts.isNamedExports(node.exportClause) ||
              node.exportClause.elements.length > 0)) ||
          ("modifiers" in node &&
            Array.isArray(node.modifiers) &&
            node.modifiers.some(
              (modifier: ts.Modifier) =>
                modifier.kind === ts.SyntaxKind.ExportKeyword,
            )))
      ) {
        add(file.file, file.file, "binary-exports-reusable-api");
      }
      if (
        file.role === "binary" &&
        (ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isArrowFunction(node) ||
          ts.isClassDeclaration(node) ||
          ts.isClassExpression(node) ||
          ts.isIfStatement(node) ||
          ts.isMethodDeclaration(node) ||
          ts.isGetAccessorDeclaration(node) ||
          ts.isSetAccessorDeclaration(node) ||
          ts.isBinaryExpression(node) ||
          ts.isConditionalExpression(node) ||
          ts.isSwitchStatement(node) ||
          ts.isTryStatement(node) ||
          ts.isForStatement(node) ||
          ts.isForOfStatement(node) ||
          ts.isForInStatement(node) ||
          ts.isWhileStatement(node) ||
          ts.isDoStatement(node))
      ) {
        add(file.file, file.file, "binary-must-only-wire");
      }
      if (
        file.role === "binary" &&
        (ts.isCallExpression(node) || ts.isNewExpression(node))
      ) {
        let target = node.expression;
        while (ts.isPropertyAccessExpression(target))
          target = target.expression;
        if (!ts.isIdentifier(target) || !importedNames.has(target.text)) {
          add(file.file, file.file, "binary-call-must-target-import");
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const reference of source.referencedFiles) {
      edge(
        ts.factory.createStringLiteral(
          reference.fileName.startsWith(".")
            ? reference.fileName
            : `./${reference.fileName}`,
        ),
      );
    }
  }
  const governed = new Set(
    files.filter((file) => file.governed).map((file) => file.file),
  );
  const baseline = new Set(policy.legacyBaseline);
  const regressions = violations.filter(
    (violation) =>
      governed.has(violation.from) ||
      governed.has(violation.to) ||
      !baseline.has(violation.identity),
  ).length;
  return {
    state: regressions === 0 ? "passed" : "failed",
    evaluatedScope: files.length,
    regressions,
    violations,
    checks: [
      {
        name: "dependency-role-ratchet",
        state: regressions === 0 ? "passed" : "failed",
        evidence: violations.map((violation) => violation.identity).sort(),
      },
    ],
  };
}

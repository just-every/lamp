import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';

export function testFiles(directory = 'tests') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? testFiles(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]).filter(path => path.endsWith('.mjs'));
}

function registrationNames(sourceFile) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const module = statement.moduleSpecifier.text;
    if (module === 'node:test' && statement.importClause.name) names.add(statement.importClause.name.text);
    const imports = statement.importClause.namedBindings;
    if (!imports || !ts.isNamedImports(imports)) continue;
    for (const element of imports.elements) {
      const name = element.propertyName?.text ?? element.name.text;
      if ((module === 'node:test' && name === 'test') || (module.endsWith('/contract.mjs') && name === 'contract') || (module.endsWith('/case.mjs') && name === 'baseline')) names.add(element.name.text);
    }
  }
  return names;
}

export function registrations(path, source = readFileSync(path, 'utf8')) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const names = registrationNames(file);
  const declarations = new Map();
  function variables(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text, node.initializer);
    ts.forEachChild(node, variables);
  }
  variables(file);
  function arraySize(expression) {
    if (ts.isArrayLiteralExpression(expression)) return expression.elements.length;
    if (ts.isIdentifier(expression) && declarations.has(expression.text)) return arraySize(declarations.get(expression.text));
    throw Error(`Cannot statically count parameterized registration in ${path}: ${expression.getText(file)}`);
  }
  const found = [];
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(file);
      if (names.has(name) || name === 't.test') {
        let count = 1;
        for (let parent = node.parent; parent; parent = parent.parent) if (ts.isForOfStatement(parent)) count *= arraySize(parent.expression);
        const titleArguments = name === 'contract' || name === 'baseline' ? node.arguments.slice(0, 2) : node.arguments.slice(0, 1);
        const title = titleArguments.map(argument => argument.getText(file)).join(' ');
        found.push({ count, title, ids: [...new Set([...title.matchAll(/\b(?:BASE-)?[A-Z][A-Z0-9]*-\d{3}\b/g)].map(match => match[0]))] });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

export function testInventory() {
  // Registration helpers themselves do not register tests until called. Include
  // nested t.test calls in journey helpers as well as ordinary test files.
  return testFiles().filter(path => path.endsWith('.test.mjs') || path.endsWith('/delivery-migration-order.mjs') || /\bt\.test\s*\(/.test(readFileSync(path, 'utf8')))
    .map(path => ({ path, count: registrations(path).reduce((total, entry) => total + entry.count, 0) }));
}

// These executable assertion gates are also part of routine verification. They
// count once each, separately from cases emitted by the Node test runner.
export const assertionScripts = [
  'scripts/edition-authoring/cli.mjs',
  'scripts/check-syntax.mjs',
  'scripts/validate-release.mjs',
  'scripts/verify-visual-edit.mjs',
  'src/base/contract-docs.mjs',
  'scripts/verification/check-plan.mjs',
  'scripts/chromium-probe.mjs',
  'scripts/verification/aggregate.mjs',
  'scripts/baseline/run.mjs',
  'scripts/baseline/reporter-probes.mjs',
];

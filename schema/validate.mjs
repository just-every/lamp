#!/usr/bin/env node
// Validates a seed's JSON documents against a schema in this directory, after
// checking that every rule that schema states is one the validator enforces.
//
//   node schema/validate.mjs                            the example release here
//   node schema/validate.mjs ../crisp/RELEASE.json ../notion/RELEASE.json
//   node schema/validate.mjs --schema SEED              the example manifest here
//   node schema/validate.mjs --schema SEED ../notion/seed.json
//   node schema/validate.mjs --schema SETUP
//   node schema/validate.mjs --schema SETUP --expect-invalid schema/SETUP.invalid.example.json
//
// --schema takes a name in this directory (RELEASE, SEED, COMPOSITION, SETUP) or a path to a schema
// file, and defaults to RELEASE. COMPOSITION validates author assembly plans. With no files, it validates the example that
// sits beside the chosen schema. Exits non-zero naming the file and the failing
// path.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import { checkSchema, validate } from './json-schema.mjs';
import { parseSetupManifestBytes, SETUP_SCHEMA_ID, validateSetupManifest } from './setup-validation.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// A bare name is one of this directory's schemas; anything else is a path.
const schemaFile = (value) =>
  /^[A-Za-z][A-Za-z0-9-]*$/.test(value) ? join(here, `${value}.schema.json`) : resolve(value);

const args = process.argv.slice(2);
const targets = [];
let schemaPath = join(here, 'RELEASE.schema.json');
let expectInvalid = false;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--expect-invalid') {
    expectInvalid = true;
    continue;
  }
  if (args[index] !== '--schema') {
    targets.push(args[index]);
    continue;
  }
  const value = args[index + 1];
  if (value === undefined) {
    console.error('--schema needs a schema name or path');
    process.exit(2);
  }
  schemaPath = schemaFile(value);
  index += 1;
}

const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
// Throws before any document is read if the schema uses a keyword, type, or
// format this validator does not enforce, anywhere in it — an unused $def included.
checkSchema(schema);

if (targets.length === 0) {
  if (!schemaPath.endsWith('.schema.json')) {
    console.error(`no files given and ${relative(process.cwd(), schemaPath)} has no example beside it`);
    process.exit(2);
  }
  targets.push(schemaPath.replace(/\.schema\.json$/, '.example.json'));
}

let failures = 0;
for (const target of targets) {
  const path = resolve(target);
  const shown = relative(process.cwd(), path) || target;
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${shown}\n  ${error.message}`);
    continue;
  }
  let data;
  try {
    data = schema.$id === SETUP_SCHEMA_ID
      ? parseSetupManifestBytes(bytes)
      : JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    if (expectInvalid) {
      console.log(`ok invalid ${shown}`);
      continue;
    }
    failures += 1;
    console.error(`FAIL ${shown}\n  ${error.message}`);
    continue;
  }
  const errors = schema.$id === SETUP_SCHEMA_ID
    ? validateSetupManifest(schema, data)
    : validate(schema, data);
  if (expectInvalid) {
    if (errors.length === 0) {
      failures += 1;
      console.error(`FAIL ${shown}\n  expected an invalid document`);
    } else {
      console.log(`ok invalid ${shown}`);
    }
    continue;
  }
  if (errors.length > 0) {
    failures += 1;
    console.error(`FAIL ${shown}`);
    for (const error of errors) console.error(`  ${error}`);
  } else {
    console.log(`ok   ${shown}`);
  }
}

const suffix = failures > 0 ? `, ${failures} invalid` : '';
console.log(`${targets.length - failures}/${targets.length} valid against ${relative(process.cwd(), schemaPath)}${suffix}`);
process.exit(failures > 0 ? 1 : 0);

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

export async function validateVendorCatalog() {
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve('wrangler'))('esbuild');
  const bundled = await build({ entryPoints: ['src/core/features/dependencies/formats/index.ts'], bundle: true, format: 'esm', platform: 'node', write: false });
  const { vendorCatalog, parseVendorStatus } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
  let checked = 0;
  for (const vendor of vendorCatalog) {
    assert.ok(vendor.mapping && Object.keys(vendor.mapping).length, `${vendor.name} needs a state mapping table.`);
    assert.ok(vendor.fixture, `${vendor.name} needs its recorded-format fixture.`);
    const fixture = JSON.parse(await readFile(vendor.fixture, 'utf8'));
    assert.equal(fixture.source, vendor.origin + vendor.path, `${vendor.name} fixture must identify the actual declared source.`);
    assert.ok(Array.isArray(fixture.cases) && fixture.cases.length, `${vendor.name} needs recorded native state cases.`);
    for (const row of fixture.cases) assert.ok(Object.hasOwn(vendor.mapping, row.sourceState), `${vendor.name} has no mapping for recorded native state ${row.sourceState}.`);
    for (const sourceState of Object.keys(vendor.mapping)) {
      const cases = fixture.cases.filter(row => row.sourceState === sourceState);
      assert.ok(cases.length, `${vendor.name} has no recorded-format case for ${sourceState}.`);
      for (const row of cases) {
        const observed = parseVendorStatus(vendor.format, row.body, row.options);
        assert.equal(observed.sourceState, sourceState, `${vendor.name} must read the fixture's native state.`);
        assert.equal(observed.state, row.expected, `${vendor.name} maps ${sourceState} to the expected component state.`);
        assert.equal(vendor.mapping[sourceState], row.expected, `${vendor.name} shown mapping agrees with its status reader.`);
        checked++;
      }
    }
  }
  console.log(`Vendor catalog: ${vendorCatalog.length} sources and ${checked} native state cases validated.`);
}

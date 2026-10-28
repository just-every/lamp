import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Derive the declaration from production definitions, without running tools or
// substituting an application implementation. Native fixtures live separately.
const require = createRequire(import.meta.resolve('wrangler/package.json'));
const { build } = require('esbuild');
const output = resolve('.seed/agent-declaration.mjs');
await mkdir(resolve('.seed'), { recursive: true });
try {
  await build({ stdin: { contents: `
    import { incidentTools } from './src/core/features/agent-door/incident-tools.ts';
    import { operationsTools } from './src/core/features/agent-door/operations-tools.ts';
    import { audienceTools } from './src/core/features/agent-door/audience-tools.ts';
    import { accessTools } from './src/core/features/agent-door/access-tools.ts';
    import { nativeWitness } from './src/core/features/agent-door/witness.ts';
    import { lampResources } from './src/core/features/agent-door/resources.ts';
    import { lampNotTools } from './src/core/features/agent-door/index.server.ts';
    const unavailable = new Proxy(function(){ throw Error('Declaration must not execute native work'); }, { get: () => unavailable });
    const bindings = { DB: unavailable, SNAPSHOTS: unavailable };
    const tools = [...incidentTools(bindings, unavailable), ...operationsTools(bindings, unavailable), ...audienceTools(bindings, unavailable), ...accessTools(bindings, unavailable), nativeWitness(bindings, unavailable)];
    export default {
      tools: [...tools.map(({name,scope,readOnly,classes,clauses,inputSchema,proof,proofKind,widens,narrowing}) => ({name,scope,readOnly,classes,clauses,...(widens === false ? {widens,narrowing,inputSchema} : {}),...(proof ? {proof,proofKind} : {})})),
        {name:'lamp.events.list',scope:'events:read',readOnly:true,classes:['standard'],clauses:['BASE-AGENT-010']}].sort((a,b)=>a.name.localeCompare(b.name)),
      resources: lampResources(bindings, unavailable).map(item=>item.uriTemplate).sort(), notTools: lampNotTools,
      schemas: Object.fromEntries(tools.map(({name,inputSchema,outputSchema})=>[name,{inputSchema,outputSchema}]))
    };
  `, resolveDir: process.cwd(), loader: 'ts' }, outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external',
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' }, logLevel: 'warning' });
  const declaration = (await import(pathToFileURL(output).href)).default;
  if (process.argv.includes('--schemas')) { console.log(JSON.stringify(declaration, null, 2)); }
  else {
    const fixture = JSON.parse(await readFile('tests/agent-door/surface-fixtures.json', 'utf8'));
    const surface = { schema: 'rer-agent-surface/1', seed: 'lamp', specialist: 'incident communicator',
      tools: declaration.tools, resources: declaration.resources, notTools: declaration.notTools, ...fixture };
    const text = JSON.stringify(surface, null, 2) + '\n';
    if (process.argv.includes('--write')) { await writeFile('agent-surface.json', text); console.log(`Agent surface: ${surface.tools.length} tools, ${surface.resources.length} resources generated.`); }
    else if (await readFile('agent-surface.json', 'utf8') !== text) throw Error('Agent surface differs from production registry; run node scripts/agent-surface.mjs --write');
    else console.log(`Agent surface: ${surface.tools.length} tools, ${surface.resources.length} resources match production registry.`);
  }
} finally { await rm(output, { force: true }); }

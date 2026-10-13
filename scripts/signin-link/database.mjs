import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

export function wranglerDatabase({ config, remote, persistence }) {
  return async sql => {
    try {
      // Remote --file uses D1 import and returns aggregate statistics, losing
      // the audit SELECT that confirms issuance. --command uses the query API
      // and preserves its rows. SQL contains the hash only, never the raw token.
      const { stdout } = await run('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB',
        remote ? '--remote' : '--local', '--config', config,
        ...(!remote ? ['--persist-to', persistence] : []), '--command', sql, '--json'],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 });
      const results = JSON.parse(stdout);
      if (!Array.isArray(results) || results.some(result => result.success === false)) throw new Error();
      return results.flatMap(result => result.results ?? []);
    } catch {
      // Provider/CLI diagnostics may contain credentials or private SQL. Do not
      // forward them, or the child-process error (which includes its output).
      throw new Error('The installation database could not be updated. Check your Wrangler credentials and configuration.');
    }
  };
}

// Adapt Wrangler's transactional SQL query API to Base's D1 interface. Tokens
// are generated and hashed exclusively by operator-auth; bound SQL has no raw credentials.
const literal=value=>value===null?'NULL':typeof value==='number'?String(value):`'${String(value).replaceAll("'","''")}'`;
export function sqlDatabase(execute) {
 function statement(sql,args=[]) {
  let index=0;
  const text=()=>sql.replace(/\?/g,()=>literal(args[index++]));
  return {bind:(...values)=>statement(sql,values),sql:text,
   async first(){return (await execute(text()))[0]??null;},
   async all(){return {results:await execute(text()),meta:{changes:0}};},
   async run(){const rows=await execute(text()+'; SELECT changes() AS __changes;');return {results:rows.filter(r=>!('__changes'in r)),meta:{changes:rows.find(r=>'__changes'in r)?.__changes??0}};},
  };
 }
 return {prepare:statement,async batch(statements){
  // One execute call is one D1 transaction, preserving Base's consume fences.
  const rows=await execute(statements.map((s,i)=>s.sql()+`; SELECT ${i} AS __statement,changes() AS __changes;`).join('\n'));
  const result=[];let values=[];for(const row of rows){if('__statement'in row){result[row.__statement]={results:values,meta:{changes:row.__changes}};values=[];}else values.push(row);}return result;
 }};
}

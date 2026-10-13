export function localPort(value = '4177') {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535) throw new Error('The local port must be an integer from 1 to 65535.');
  return String(Number(value));
}

export function devOptions(argv, env = process.env) {
  let port = env.PORT;
  let verbose = false;
  const forwarded = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--verbose') { verbose = true; continue; }
    if (argument === '--port') { port = argv[++index]; if (port === undefined) throw new Error('--port requires a value.'); continue; }
    if (argument.startsWith('--port=')) { port = argument.slice(7); continue; }
    if (argument === '--strictPort') continue;
    if (argument === '--host' || argument.startsWith('--host=') || argument.startsWith('--strictPort')) throw new Error('Local development uses strict loopback hosting and a strict port.');
    forwarded.push(argument);
  }
  return { port: localPort(port), verbose, forwarded };
}

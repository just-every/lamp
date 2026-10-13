import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { parseArgs } from './ops-config.mjs';
import { issueSignInLink, refusal } from './signin-link/issue.mjs';
import { wranglerDatabase } from './signin-link/database.mjs';
import { readSettings } from '@runeditrun/rer/adapter-settings';

const missingSecret = 'Set SESSION_SECRET in the environment for --remote: use the value this installation was deployed with.';

export async function runSignInLink(argv, { stdout = process.stdout, stderr = process.stderr, execute, settings } = {}) {
  try {
    const flags = parseArgs(argv);
    if ([...flags.keys()].some(key => !['email','remote','config','origin','port','persist-to'].includes(key)) || typeof flags.get('email') !== 'string') throw new Error('Use pnpm signin-link --email <operator> [--remote] [--config <wrangler.toml>] [--origin <app origin>].');
    const remote = flags.get('remote') === true;
    const config = resolve(flags.get('config') ?? (remote ? 'wrangler.toml' : 'wrangler.jsonc'));
    let origin = flags.get('origin');
    if (!origin && remote) {
      const text = await readFile(config, 'utf8');
      const host = /^LAMP_APP_HOST\s*=\s*"([^"\r\n]+)"\s*$/m.exec(text)?.[1];
      if (!host) throw new Error('Set --origin to the deployed operator origin, or use the generated wrangler.toml.');
      origin = `https://${host}`;
    }
    if (!origin) {
      let port = flags.get('port');
      if (port === undefined) {
        const saved = (await readSettings(process.cwd(), {})).values.LAMP_LOCAL_ORIGIN;
        port = saved ? new URL(saved).port || '80' : '8787';
      }
      origin = `http://127.0.0.1:${port}`;
    }
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password || (remote ? url.protocol !== 'https:' : !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || !['http:','https:'].includes(url.protocol))) throw new Error('Use the exact operator origin: HTTPS remotely, or a loopback origin locally.');
    const configured = settings ?? (remote ? process.env : {...process.env,...(await readSettings(process.cwd(), {})).values});
    if (remote && !configured.SESSION_SECRET) throw new Error(missingSecret);
    const link = await issueSignInLink({ sessionSecret: configured.SESSION_SECRET, email: flags.get('email'), origin, execute: execute ?? wranglerDatabase({ config, remote, persistence: resolve(flags.get('persist-to') ?? process.env.LAMP_WORKERS_STATE_PATH ?? '.wrangler/state') }) });
    stdout.write(`${link}\n`);
    return 0;
  } catch (error) {
    // Never emit unknown diagnostics; only our own static, value-free messages.
    const allowed = [refusal, missingSecret, 'The installation database could not be updated. Check your Wrangler credentials and configuration.', 'Set --origin to the deployed operator origin, or use the generated wrangler.toml.', 'Use the exact operator origin: HTTPS remotely, or a loopback origin locally.'];
    stderr.write(`${allowed.includes(error?.message) ? error.message : 'Use pnpm signin-link --email <operator> [--remote] with the installation configuration.'}\n`);
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await runSignInLink(process.argv.slice(2));

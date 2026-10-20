import { createComponent, probe, recordCheck, targets } from './checks.mjs';

export async function observe(api, prove = false) {
  const readings = await Promise.all(targets.map(target => probe(target.url)));
  const { components } = await api('/api/app/components');
  const results = [];
  for (const [index, target] of targets.entries()) {
    let component = components.find(row => row.name === target.name && row.description === target.url);
    if (components.some(row => row.name === target.name && row.description !== target.url)) {
      throw new Error(`A different ${target.name} component already exists; do not overwrite operator data.`);
    }
    component ??= await createComponent(api, target.name, target.url);
    results.push(await recordCheck(api, component, readings[index], { internal: false }));
  }
  const proof = [];
  if (prove) {
    const missing = `https://status-app.run-lamp.com/__lamp_check_proof_${crypto.randomUUID()}`;
    const temporary = await createComponent(api, `Check proof ${crypto.randomUUID()}`, missing);
    // Each step starts from the component as Lamp now holds it, claim included.
    const current = async () => (await api('/api/app/components')).components.find(row => row.id === temporary.id);
    try {
      proof.push(await recordCheck(api, await current(), await probe('https://run-lamp.com/')));
      const failed = await probe(missing);
      if (failed.status !== 404) throw new Error('The throwaway missing-path check did not return 404.');
      proof.push(await recordCheck(api, await current(), failed));
      proof.push(await recordCheck(api, await current(), await probe('https://run-lamp.com/')));
    } finally { await api(`/api/app/components/${temporary.id}`, { method: 'DELETE' }); }
    if ((await api('/api/app/components')).components.some(row => row.id === temporary.id)) {
      throw new Error('The throwaway check component was not removed.');
    }
  }
  return { source: 'Lamp HTTP check Worker using native operator APIs', results, proof,
    proofComponentRemoved: proof.length > 0 };
}

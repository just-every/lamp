import { createServer } from 'node:http';
import jpeg from 'jpeg-js';

// Workers AI, played by one loopback server at the network edge: a Lamp started with LAMP_DEV_WORKERS_AI_ORIGIN
// posts each run here as `/ai/run/<model>` and reads `{ success, result }` back, as Workers AI answers. Every call
// is told apart by what it asks for, never by its model id: a multipart picture, a picture to name, a subject to
// choose, or two names to compare. Nothing else in the install is faked.

/** One dark standing object with a lit face and a soft shadow, on pure white, as FLUX.2 draws for the house style. */
export function whiteGroundPicture(size = 1024) {
  const data = Buffer.alloc(size * size * 4, 255);
  const paint = (x, y, rgb, alpha = 1) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const at = (y * size + x) * 4;
    for (let channel = 0; channel < 3; channel += 1) data[at + channel] = Math.round(data[at + channel] * (1 - alpha) + rgb[channel] * alpha);
  };
  const centre = size / 2;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    // The shadow directly beneath, faint and soft; the body; a warm lit lens; three thin legs.
    const shadow = ((x - centre) / 170) ** 2 + ((y - 760) / 16) ** 2;
    if (shadow < 1) paint(x, y, [200, 200, 196], 0.5 * (1 - shadow));
    const body = ((x - centre) / 200) ** 2 + ((y - 430) / 70) ** 2;
    if (body < 1) paint(x, y, [38, 35, 72]);
    const lens = ((x - centre - 150) / 34) ** 2 + ((y - 430) / 34) ** 2;
    if (lens < 1) paint(x, y, [246, 205, 132]);
    for (const [from, to] of [[centre, centre - 120], [centre, centre], [centre, centre + 120]]) {
      const t = (y - 490) / 270;
      if (t >= 0 && t <= 1 && Math.abs(x - (from + (to - from) * t)) < 7) paint(x, y, [92, 64, 40]);
    }
  }
  return Buffer.from(jpeg.encode({ data, width: size, height: size }, 92).data);
}

const read = (request) => new Promise((resolve, reject) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => resolve(Buffer.concat(chunks)));
  request.on('error', reject);
});

const answer = (response, result) => response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ success: true, result, errors: [], messages: [] }));

/** Starts the fake edge. `subject` is the fixed subject answer; `seen` the fixed name the vision call gives. */
export async function startFakeWorkersAi({ subject, seen }) {
  const picture = whiteGroundPicture();
  const calls = [];
  const state = { seen, same: true, held: null };
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? '/', 'http://fake.invalid').pathname;
      if (request.method !== 'POST' || !path.startsWith('/ai/run/')) { response.writeHead(404).end(); return; }
      const model = path.slice('/ai/run/'.length);
      const body = await read(request);
      const type = request.headers['content-type'] ?? '';
      if (type.startsWith('multipart/form-data')) {
        const form = await new Request('http://fake.invalid', { method: 'POST', headers: { 'Content-Type': type }, body }).formData();
        const reference = form.get('input_image_0');
        calls.push({ kind: 'picture', model, at: Date.now(), prompt: String(form.get('prompt')), width: Number(form.get('width')), height: Number(form.get('height')), seed: Number(form.get('seed')), steps: Number(form.get('steps')), reference: reference instanceof Blob ? { type: reference.type, bytes: reference.size } : null });
        if (state.held) await state.held.promise;
        answer(response, { image: picture.toString('base64') });
        return;
      }
      const input = JSON.parse(body.toString('utf8'));
      const content = input.messages?.flatMap((message) => Array.isArray(message.content) ? message.content : []) ?? [];
      if (content.some((part) => part.type === 'image_url')) {
        calls.push({ kind: 'name', model, at: Date.now() });
        answer(response, { response: state.seen });
      } else if (input.response_format?.json_schema?.properties?.same) {
        calls.push({ kind: 'compare', model, at: Date.now(), asked: input.messages?.at(-1)?.content });
        answer(response, { response: { same: state.same } });
      } else {
        calls.push({ kind: 'subject', model, at: Date.now(), asked: input.messages?.at(-1)?.content });
        answer(response, { response: subject });
      }
    } catch (cause) {
      response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ success: false, errors: [{ message: String(cause) }] }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    calls,
    count: (kind) => calls.filter((call) => !kind || call.kind === kind).length,
    pictures: () => calls.filter((call) => call.kind === 'picture'),
    /** The vision call names `seen`, and the comparison says whether it is the object that was asked for. */
    answer(next) { Object.assign(state, next); },
    /** Holds every picture call until the returned release is called. */
    hold() {
      let release;
      state.held = { promise: new Promise((resolve) => { release = resolve; }) };
      return () => { state.held = null; release(); };
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

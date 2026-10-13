import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
export async function payload(manifestPath,descriptor){
 const bytes=await readFile(resolve(dirname(manifestPath),descriptor.payload));
 assert.equal(bytes.length,descriptor.size);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),descriptor.sha256);
 return bytes;
}

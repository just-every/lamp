import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {produceSeedArtifact} from './delivery/base/package.mjs';
const config=JSON.parse(await readFile(new URL('./delivery/base/packaging.json',import.meta.url)));
export const produceArtifact = options => produceSeedArtifact({...options,config});
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(await produceArtifact());

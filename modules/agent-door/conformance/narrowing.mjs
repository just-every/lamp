/** A closed target-only schema cannot encode a grant to add. Unknown schema
 * constructs fail closed, rather than hiding widening fields in a union/ref. */
export function narrowingContract(tool) {
 const schema = tool?.inputSchema, target = tool?.narrowing?.target;
 if (tool?.widens !== false || !['revoke', 'narrow'].includes(tool.narrowing?.effect) || typeof target !== 'string'
  || !/^(?:id|[a-z][a-z0-9_]*_id)$/.test(target) || !schema || schema.type !== 'object' || schema.additionalProperties !== false
  || Object.keys(schema).some(key => !['type', 'properties', 'required', 'additionalProperties'].includes(key))
  || !Array.isArray(schema.required) || schema.required.length !== 1 || schema.required[0] !== target
  || !schema.properties || Object.keys(schema.properties).length !== 1) return false;
 const field = schema.properties[target];
 return field?.type === 'string' && Object.keys(field).every(key => ['type', 'minLength', 'maxLength', 'pattern', 'enum', 'description', 'title'].includes(key));
}

export async function grantSet(c, witness, outputs) {
 const answer = await c.tool(witness.tool, c.resolve(witness.args, outputs));
 if (answer.result?.isError) throw new Error('Native grant witness refused');
 let value = answer.result?.structuredContent;
 for (const part of witness.pointer.split('/').slice(1)) value = value?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
 if (!Array.isArray(value) || value.some(grant => typeof grant !== 'string') || new Set(value).size !== value.length) throw new Error('Native grant witness must return a unique string grant set');
 return value;
}

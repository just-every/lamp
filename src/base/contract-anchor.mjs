import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

export const anchorPath = 'docs/contract/ANCHOR.json'
const sourceFiles = ['CONTRACT.md', 'ACCEPTANCE.md', 'docs/CLAIMS.md', 'CLAIMS.md']
const sha = /^[0-9a-f]{40}$/
const fail = message => { throw Error(`${anchorPath}: contract_anchor_invalid: ${message}`) }
const objectId = (type, bytes) => createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex')

// The commit authenticates the root tree, which authenticates each source blob
// (and absence of optional sources). No hash supplied only by the record is trusted.
function resolveSnapshot(commit, load) {
  if (!sha.test(commit)) fail('expected a full anchor commit SHA.')
  const object = (type, id) => {
    const bytes = load(type, id)
    if (objectId(type, bytes) !== id) fail(`${type} ${id} has mismatching bytes.`)
    return bytes
  }
  const treeId = /^tree ([0-9a-f]{40})\n/.exec(object('commit', commit).toString('utf8'))?.[1]
  if (!treeId) fail('anchor commit has no root tree.')
  const trees = new Map()
  function tree(id) {
    if (trees.has(id)) return trees.get(id)
    const bytes = object('tree', id), entries = new Map()
    let offset = 0
    while (offset < bytes.length) {
      const end = bytes.indexOf(0, offset)
      if (end < 0 || end + 21 > bytes.length) fail(`malformed tree ${id}.`)
      const entry = /^(40000|100644|100755|120000|160000) ([^/\0]+)$/.exec(bytes.subarray(offset, end).toString('utf8'))
      if (!entry || entries.has(entry[2])) fail(`malformed or duplicate entry in tree ${id}.`)
      entries.set(entry[2], { mode: entry[1], id: bytes.subarray(end + 1, end + 21).toString('hex') })
      offset = end + 21
    }
    trees.set(id, entries)
    return entries
  }
  const files = {}
  for (const name of sourceFiles) {
    const parts = name.split('/')
    let directory = treeId, entry
    for (const [index, part] of parts.entries()) {
      entry = tree(directory).get(part)
      if (!entry) break
      if (index < parts.length - 1) {
        if (entry.mode !== '40000') { entry = undefined; break }
        directory = entry.id
      }
    }
    if (!entry) continue
    if (!['100644', '100755', '120000'].includes(entry.mode)) fail(`${name} is not a blob.`)
    files[name] = object('blob', entry.id).toString('utf8')
  }
  if (!files['CONTRACT.md']) fail('anchor has no CONTRACT.md.')
  return { commit, files }
}

export function readAnchor(commit) {
  if (!fs.existsSync(anchorPath)) return undefined
  let record
  try { record = JSON.parse(fs.readFileSync(anchorPath, 'utf8')) }
  catch { fail('record must be valid JSON.') }
  if (record?.schema !== 1 || record.commit !== commit || !record.objects || typeof record.objects !== 'object' || Array.isArray(record.objects))
    fail(`expected schema 1 and anchor commit ${commit}.`)
  const used = new Set()
  const snapshot = resolveSnapshot(commit, (type, id) => {
    used.add(id)
    const entry = Object.hasOwn(record.objects, id) ? record.objects[id] : undefined
    if (entry?.type !== type || typeof entry.data !== 'string') fail(`missing ${type} ${id}.`)
    const bytes = Buffer.from(entry.data, 'base64')
    if (bytes.toString('base64') !== entry.data) fail(`${type} ${id} is not canonical base64.`)
    return bytes
  })
  if (Object.keys(record.objects).some(id => !used.has(id))) fail('record contains objects outside the anchor proof.')
  return snapshot
}

// Run once while the anchor is available, then commit this portable proof.
export function createAnchor(commit) {
  const objects = {}
  resolveSnapshot(commit, (type, id) => {
    const bytes = execFileSync('git', ['cat-file', type, id], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
    objects[id] = { type, data: bytes.toString('base64') }
    return bytes
  })
  return { schema: 1, commit, objects }
}

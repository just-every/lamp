#!/usr/bin/env node
// Kept beside seed-contract so a recorded copy runs without an installation.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { parseContract, clauseIdSource, plainText } from './seed-contract.mjs'

const marker = '<!-- Generated from CONTRACT.md by contract-docs. Edit CONTRACT.md, then regenerate. -->'
const idPattern = new RegExp(`^${clauseIdSource}$`)
const read = name => fs.existsSync(name) ? fs.readFileSync(name, 'utf8') : undefined
const put = (name, text) => { fs.mkdirSync(path.dirname(name), { recursive: true }); fs.writeFileSync(name, text) }
const git = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
const json = value => JSON.stringify(value, null, 2) + '\n'
const linesOf = text => text.replace(/\r\n?/g, '\n').split('\n')
const cells = line => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim())
const divider = line => /^\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{0,}:?\s*$/.test(line.trim())
const idsIn = text => [...text.matchAll(new RegExp(`(?<![A-Za-z0-9.-])(${clauseIdSource})(?![A-Za-z0-9.-])`, 'g'))].map(match => match[1])
const block = text => text.replace(/^\s*\n|\n\s*$/g, '').trim()
function outline(text) {
  const lines = linesOf(text), entries = []
  let fence
  lines.forEach((line, index) => {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (mark) { if (!fence) fence = mark[0]; else if (fence === mark[0]) fence = undefined; return }
    if (fence) return
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (match) entries.push({ level: match[1].length, title: plainText(match[2]), start: index })
  })
  return entries.map(entry => ({ ...entry, end: entries.find(next => next.start > entry.start && next.level <= entry.level)?.start ?? lines.length }))
}
function section(text, name) {
  const entry = outline(text).find(item => item.level === 2 && (item.title === name || (name === 'Product target' && /^Product target\b/.test(item.title))))
  return entry ? block(linesOf(text).slice(entry.start + 1, entry.end).join('\n')) : ''
}
function snapshot(reference) {
  if (!reference || reference.startsWith('-')) throw Error('Name an old Git reference or a tracked contract file.')
  let commit, contract
  if (fs.existsSync(reference) && fs.statSync(reference).isFile()) {
    const relative = path.relative(process.cwd(), path.resolve(reference)).split(path.sep).join('/')
    if (relative.startsWith('../') || path.isAbsolute(relative)) throw Error('An old contract file must be tracked in this checkout; otherwise use its Git reference.')
    commit = git(['log', '-1', '--format=%H', '--', relative]).trim()
    if (!commit) throw Error(`No commit records ${reference}; use a Git reference.`)
    contract = read(reference)
    if (git(['show', `${commit}:${relative}`]) !== contract) throw Error(`${reference} has uncommitted bytes; use a recorded old contract.`)
  } else commit = git(['rev-parse', '--verify', '--end-of-options', `${reference}^{commit}`]).trim()
  if (!/^[0-9a-f]{40}$/.test(commit)) throw Error(`Cannot resolve ${reference} to a full commit.`)
  const names = new Set(git(['ls-tree', '-r', '--name-only', commit]).trim().split('\n'))
  const files = {}
  for (const name of ['CONTRACT.md', 'ACCEPTANCE.md', 'docs/CLAIMS.md', 'CLAIMS.md'])
    if (names.has(name)) files[name] = git(['show', `${commit}:${name}`])
  if (contract !== undefined) files['CONTRACT.md'] = contract
  if (!files['CONTRACT.md']) throw Error(`${reference} has no CONTRACT.md.`)
  return { commit, files }
}
function summaryRange(text) {
  const lines = linesOf(text), start = lines.findIndex(line => cells(line).join('|') === 'Clauses|Done|Partial|Missing|Total')
  if (start < 0) return undefined
  let end = start + 2
  while (lines[end]?.trimStart().startsWith('|')) end++
  return { start, end }
}
function withoutSummary(text) {
  const range = summaryRange(text)
  if (!range) return text
  const lines = linesOf(text)
  lines.splice(range.start, range.end - range.start)
  return lines.join('\n')
}
const tally = clauses => ({ done: clauses.filter(c => c.status === 'done').length, partial: clauses.filter(c => c.status === 'partial').length, missing: clauses.filter(c => c.status === 'missing').length, total: clauses.length })
const countRow = (label, clauses) => `| ${label} | ${Object.values(tally(clauses)).join(' | ')} |`
function withSummary(text, contract) {
  const range = summaryRange(text)
  const rows = [countRow('Published', contract.clauses.filter(c => c.kind === 'published')), countRow('Target and push further', contract.clauses.filter(c => c.kind !== 'published')), countRow('All', contract.clauses)]
  if (!range) throw Error('CONTRACT.md needs the Status summary table; run convert for a legacy contract.')
  // Only the summary's rows are replaced; all other bytes, including CRLF, stay.
  const raw = text.split(/(?<=\n)/), newline = raw[range.start]?.endsWith('\r\n') ? '\r\n' : '\n'
  raw.splice(range.start + 2, range.end - range.start - 2, ...rows.map(row => row + newline))
  return raw.join('')
}
function metaLine(text) {
  const meta = {}
  for (const match of text.matchAll(/\*(Tier|From|Cites|Rules|Register):\*\s*([^·\n]+)/g)) meta[match[1]] = match[2].trim()
  return meta
}
function entries(text, parsed) {
  const lines = linesOf(text), headings = outline(text)
  const published = section(text, 'Published clauses').split(/^### /m)[0]
  return [...parsed.clauses].sort((a, b) => a.line - b.line).map(clause => {
    if (!lines[clause.line - 1].startsWith('#### ')) throw Error(`CONTRACT.md:${clause.line}: ${clause.id} needs a level-four clause heading; run convert.`)
    const end = headings.find(item => item.start >= clause.line)?.start ?? lines.length
    let body = block(lines.slice(clause.line, end).join('\n'))
    const metaText = clause.kind === 'published' ? published.split('\n').find(line => line.startsWith(`- \`${clause.id}\`:`)) : body.split('\n')[0]
    const meta = metaLine(metaText ?? '')
    if (!['Core', 'Agent surface', 'Later'].includes(meta.Tier)) throw Error(`CONTRACT.md:${clause.line}: ${clause.id} needs a Tier in its ${clause.kind === 'published' ? 'Published clauses list' : 'meta line'}.`)
    if (clause.kind !== 'published') body = block(body.slice(body.indexOf('\n') + 1))
    if (!body.startsWith('**Requirement.**')) throw Error(`CONTRACT.md:${clause.line}: ${clause.id} body must start **Requirement.**.`)
    const row = cells(lines[clause.row - 1])
    return { ...clause, meta, body, evidenceCell: row[4], gapCell: row[5] }
  })
}
function seedName(text) {
  return /^#\s+(.+?)\s*$/m.exec(text)?.[1].replace(/\s+target product contract$/i, '').replace(/\s+contract$/i, '') ?? 'Seed'
}
function generatedFiles(text) {
  const initial = parseContract(withoutSummary(text)), rewritten = withSummary(text, initial)
  const parsed = parseContract(rewritten), clauses = entries(rewritten, parsed), seed = seedName(text)
  const target = section(text, 'Product target')
  const journey = target.split('\n').find(line => /^The primary journey:/.test(line))
  if (!journey) throw Error('CONTRACT.md: Product target needs "The primary journey:".')
  const register = section(text, 'Field proof register')
  if (!register) throw Error('CONTRACT.md needs a Field proof register section.')
  const registerRows = register.split('\n').filter(line => /^R-\d+$/.test(plainText(cells(line)[0] ?? ''))).map(line => cells(line))
  const registerCount = state => registerRows.filter(row => row[3] === state).length
  const judged = section(text, 'Status').split('\n').find(line => line.startsWith('Judged from'))
  const acceptance = [marker, `# Accept a ${seed} installation`, journey, '## Progress', [
    '| Tier | Done | Partial | Missing | Total |', '| --- | ---: | ---: | ---: | ---: |',
    ...['Core', 'Agent surface', 'Later'].map(tier => countRow(tier, clauses.filter(clause => clause.meta.Tier === tier))), countRow('Full target', clauses),
  ].join('\n'), `${judged} Field proof register: ${registerRows.length} rows; ${registerCount('passed')} passed, ${registerCount('failed')} failed, ${registerCount('not run')} not run.`]
  for (const tier of ['Core', 'Agent surface', 'Later']) {
    acceptance.push(`## ${tier}`)
    const selected = clauses.filter(clause => clause.meta.Tier === tier)
    if (!selected.length) acceptance.push('None.')
    let area
    for (const clause of selected) {
      if (clause.area !== area) { area = clause.area; acceptance.push(`### ${area}`) }
      acceptance.push(`#### ${clause.id} — ${clause.title}`)
      const info = [tier, clause.kind, `**${clause.status}**`]
      for (const field of ['From', 'Cites', 'Rules', 'Register']) if (clause.meta[field]) info.push(`${field} ${clause.meta[field].split(/\s*,\s*/).join(', ')}`)
      acceptance.push(info.join(' · '), clause.body, `**Evidence.** ${clause.evidenceCell || 'None.'}\n**Gap.** ${clause.gapCell || 'None.'}`)
    }
  }
  acceptance.push('## Field proof register', register)
  const tables = homepageClaims(text), rows = tables.flatMap(table => table.rows.map(row => ({ ...row, header: table.header })))
  const claims = [marker, `# ${seed} homepage claims`]
  if (!rows.length) claims.push('No homepage claims are mapped yet.')
  else {
    claims.push('A claim is done when every clause behind it is done, missing when every one is missing, and partial otherwise.')
    const hasSection = rows.some(row => row.header.some(cell => /^Section$/i.test(plainText(cell))))
    const header = ['#', ...(hasSection ? ['Section'] : []), 'Claim', 'Clauses', 'Status']
    const table = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`], counts = { done: 0, partial: 0, missing: 0 }
    for (const [index, row] of rows.entries()) {
      const value = label => row.cells[row.header.findIndex(cell => new RegExp(`^${label}$`, 'i').test(plainText(cell).replace('(s)', 's')))] ?? ''
      const ids = idsIn(value('Clauses?')), linked = ids.map(id => clauses.find(clause => clause.id === id))
      if (!ids.length || linked.some(clause => !clause)) throw Error(`CONTRACT.md:${row.line}: Homepage claim needs existing clause ids.`)
      const state = linked.every(clause => clause.status === 'done') ? 'done' : linked.every(clause => clause.status === 'missing') ? 'missing' : 'partial'
      counts[state]++
      table.push(`| ${[value('#') || String(index + 1), ...(hasSection ? [value('Section')] : []), value('Claim'), linked.map(clause => `\`${clause.id}\` ${clause.status}`).join('; '), state].join(' | ')} |`)
    }
    claims.push(table.join('\n'), `Claims: ${rows.length}; ${counts.done} done, ${counts.partial} partial, ${counts.missing} missing.`)
  }
  return { 'CONTRACT.md': rewritten, 'ACCEPTANCE.md': acceptance.join('\n\n') + '\n', 'docs/CLAIMS.md': claims.join('\n\n') + '\n' }
}
function generate(check = false) {
  const text = read('CONTRACT.md')
  if (text === undefined) throw Error('CONTRACT.md does not exist.')
  const files = generatedFiles(text), changed = Object.entries(files).filter(([name, contents]) => read(name) !== contents)
  if (check && changed.length) throw Error(changed.map(([name]) => `${name}: generated content differs; run contract-docs write.`).join('\n'))
  if (!check) for (const [name, contents] of changed) put(name, contents)
  console.log(check ? 'Contract documents are current.' : `Wrote ${changed.length} contract documents.`)
}

// Lineage is derived from From and Retired clauses; old text never supplies a new answer.
function retiredRows(text) {
  return section(text, 'Retired clauses').split('\n').filter(line => line.trimStart().startsWith('|') && !divider(line)).map(line => cells(line)).filter(row => idPattern.test(plainText(row[0] ?? ''))).map(([id, now, reason]) => ({ id: plainText(id), now, reason }))
}
function idParts(id) {
  const match = /^(.*?)(\d+)$/.exec(id)
  return match && { prefix: match[1], width: match[2].length, number: Number(match[2]) }
}
function buildIdMap(old, text = read('CONTRACT.md')) {
  const previous = parseContract(old.files['CONTRACT.md']), current = parseContract(withoutSummary(text)), clauses = entries(text, current)
  const oldIds = new Set(previous.clauses.map(clause => clause.id)), kept = new Set(clauses.map(clause => clause.id)), retired = retiredRows(text), problems = [], sources = new Map()
  const oldRetired = new Set(retiredRows(old.files['CONTRACT.md']).map(row => row.id))
  const oldLines = linesOf(old.files['CONTRACT.md']), used = new Set(oldIds)
  for (const clause of previous.clauses) for (const id of idsIn(oldLines[clause.line - 1])) used.add(id)
  for (const entry of outline(old.files['CONTRACT.md']).filter(entry => /^(Retired|Superseded)\b/i.test(entry.title)))
    for (const id of idsIn(oldLines.slice(entry.start, entry.end).join('\n'))) { used.add(id); oldRetired.add(id) }
  for (const id of oldIds) oldRetired.delete(id)
  for (const row of retired) {
    if (!row.reason?.trim()) problems.push(`${row.id}: Retired reason is empty.`)
    if (retired.filter(other => other.id === row.id).length > 1) problems.push(`${row.id}: duplicate Retired row.`)
    if (kept.has(row.id)) problems.push(`${row.id}: retired id is reused as a clause.`)
    const merges = [...row.now.matchAll(/merged into\s+([^;]+)/g)]
    if (merges.length > 1 || merges.some(match => idsIn(match[1]).length !== 1 || plainText(match[1]).trim() !== idsIn(match[1])[0])) problems.push(`${row.id}: merged into must name exactly one clause.`)
    for (const match of merges) for (const target of idsIn(match[1])) {
      if (!kept.has(target)) problems.push(`${row.id}: merged destination ${target} does not exist.`)
    }
    for (const id of idsIn(row.id)) used.add(id)
  }
  const highest = new Map(), widths = new Map()
  for (const id of used) {
    const parts = idParts(id)
    if (!parts) continue
    highest.set(parts.prefix, Math.max(highest.get(parts.prefix) ?? 0, parts.number))
    if (!widths.has(parts.prefix)) widths.set(parts.prefix, parts.width)
  }
  for (const clause of clauses) {
    const from = clause.meta.From === undefined ? (oldIds.has(clause.id) ? [clause.id] : []) : clause.meta.From === 'new' ? [] : clause.meta.From.split(/\s*,\s*/)
    if (clause.meta.From === undefined && !oldIds.has(clause.id)) problems.push(`${clause.id}: a new clause needs From new or its old source ids.`)
    if (new Set(from).size !== from.length) problems.push(`${clause.id}: From repeats a source id.`)
    for (const source of from) {
      if (!idPattern.test(source) || !oldIds.has(source)) problems.push(`${clause.id}: From names ${source}, which the old Status table lacks.`)
      if (!sources.has(source)) sources.set(source, [])
      sources.get(source).push(clause.id)
    }
    if (oldIds.has(clause.id) && !from.includes(clause.id)) problems.push(`${clause.id}: a kept id's From omits itself.`)
    if (oldRetired.has(clause.id)) problems.push(`${clause.id}: an old retired id is reused.`)
    if (oldIds.has(clause.id)) continue
    const parts = idParts(clause.id), width = widths.get(parts.prefix) ?? 3, next = (highest.get(parts.prefix) ?? 0) + 1
    if (parts.width !== width || parts.number !== next) problems.push(`${clause.id}: new id is not the next free number; expected ${parts.prefix}${String(next).padStart(width, '0')}.`)
    highest.set(parts.prefix, Math.max(highest.get(parts.prefix) ?? 0, parts.number)); widths.set(parts.prefix, width)
  }
  const ids = {}
  for (const id of oldIds) {
    const targets = sources.get(id) ?? [], retirement = retired.find(row => row.id === id)
    if (targets.length >= 2) {
      if (targets[0] !== id || retirement) problems.push(`${id}: text goes to multiple clauses; keep the old id as the first part of a split, never retire it.`)
      ids[id] = { how: 'split', to: targets }
    } else if (kept.has(id)) ids[id] = { how: 'kept', to: [id] }
    else if (!retirement) problems.push(`${id}: old id is missing from both clauses and Retired clauses.`)
    else {
      const merged = /^merged into\s+(.+?)(?:;|$)/.exec(retirement.now), receiving = merged ? idsIn(merged[1]) : []
      if (targets.length && (!merged || receiving[0] !== targets[0])) problems.push(`${id}: From destination and Retired destination disagree.`)
      ids[id] = merged ? { how: 'merged', to: receiving } : { how: 'retired', to: [], now: retirement.now }
    }
  }
  if (problems.length) throw Error(problems.join('\n'))
  return { schema: 1, old: old.commit, ids }
}
function idMap(old) {
  const map = buildIdMap(old)
  put('docs/contract/ID-MAP.json', json(map))
  console.log(`Mapped ${Object.keys(map.ids).length} old clause ids.`)
}

// Conversion preserves old source text while giving a rewrite a mechanical shape.
function oldClauseBody(text, clause) {
  const lines = linesOf(text), start = clause.line - 1, first = lines[start]
  const bold = /^(-\s+)?\*\*[^*]+\*\*\s*/.exec(first)
  const body = [bold ? first.slice(bold[0].length) : '']
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]
    if (/^#{1,6}\s/.test(line) || new RegExp(`^(?:-\\s+)?\\*\\*${clauseIdSource}\\s+[—–-]\\s+`).test(line)) break
    if (bold?.[1] && line.trim() && !/^[ \t]/.test(line)) break
    body.push(bold?.[1] ? line.replace(/^ {1,2}/, '') : line)
  }
  return block(body.join('\n'))
}
function acceptanceEntries(text, ids) {
  const result = new Map(), lines = linesOf(text ?? '')
  const definition = new RegExp(`^(?:#{1,6}\\s+|(?:-\\s+)?\\*\\*)(${clauseIdSource})\\s+[—–-]\\s+`)
  for (let index = 0; index < lines.length; index++) {
    const match = definition.exec(lines[index])
    if (!match || !ids.has(match[1])) continue
    const first = lines[index], boldEnd = first.indexOf('**', match[0].length)
    let body = first.startsWith('#') ? [] : [boldEnd >= 0 ? first.slice(boldEnd + 2).trim() : '']
    for (let next = index + 1; next < lines.length && !definition.test(lines[next]) && !/^#{1,6}\s/.test(lines[next]); next++) body.push(lines[next])
    if (!result.has(match[1])) result.set(match[1], block(body.join('\n')))
  }
  return result
}
function requirementAndAcceptance(body, oldAcceptance) {
  const history = [], status = /\*{1,2}Status:\*{1,2}\s*(?:done|partial|missing)\b/i.exec(body)
  if (status) { history.push(body.slice(status.index)); body = body.slice(0, status.index).trim() }
  const markerPattern = /(?:\*{1,2}Acceptance(?: evidence)?[:.]\*{1,2}|\*\*Acceptance\*\*[:.]?)/i
  const acceptanceMarker = markerPattern.exec(body)
  let requirement = acceptanceMarker ? block(body.slice(0, acceptanceMarker.index)) : body
  let acceptance = acceptanceMarker ? block(body.slice(acceptanceMarker.index + acceptanceMarker[0].length)) : oldAcceptance
  requirement = requirement.replace(/^\*\*Requirement[.:]\*\*\s*/, '').trim()
  if (!requirement) throw Error('An old clause has no requirement prose to convert.')
  const result = [`**Requirement.** ${requirement}`]
  if (acceptance) {
    acceptance = acceptance.replace(markerPattern, '').trim()
    const numbered = /^1[.)]\s/m.test(acceptance)
    if (numbered) result.push(`**Acceptance.**\n${acceptance}`)
    else {
      const sentences = acceptance.replace(/\n+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9`*])/).filter(Boolean)
      result.push('**Acceptance.**\n' + sentences.slice(0, 8).map((sentence, index) => `${index + 1}. ${index === 7 ? sentences.slice(7).join(' ') : sentence}`).join('\n'))
    }
  }
  return { text: result.join('\n\n'), history }
}
function contractClaims(old) {
  const candidates = Object.entries(old.files).filter(([name, text]) => name === 'CONTRACT.md' || /(?:^|\/)CLAIMS\.md$/.test(name) && !text.startsWith('<!-- Generated from CONTRACT.md by contract-docs.')).map(([name, text]) => ({ name, tables: homepageClaims(text) }))
  const winner = candidates.sort((a, b) => b.tables.reduce((n, table) => n + table.rows.length, 0) - a.tables.reduce((n, table) => n + table.rows.length, 0))[0]
  if (!winner?.tables.some(table => table.rows.length)) return 'No homepage claims are mapped yet.'
  const rows = winner.tables.flatMap(table => table.rows.map(row => ({ ...row, header: table.header })))
  const hasSection = rows.some(row => row.header.some(label => /^section$/i.test(plainText(label))))
  const header = ['#', ...(hasSection ? ['Section'] : []), 'Claim', 'Clauses']
  const table = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`]
  for (const [index, row] of rows.entries()) {
    const value = label => row.cells[row.header.findIndex(cell => new RegExp(`^${label}$`, 'i').test(plainText(cell).replace('(s)', 's')))] ?? ''
    table.push(`| ${[value('#') || String(index + 1), ...(hasSection ? [value('Section')] : []), value('Claim'), value('Clauses?')].join(' | ')} |`)
  }
  return table.join('\n')
}
function convert(old, acceptanceOld) {
  const text = old.files['CONTRACT.md'], parsed = parseContract(text), lines = linesOf(text), seed = seedName(text), ids = new Set(parsed.clauses.map(clause => clause.id))
  const acceptanceSource = acceptanceOld?.files['ACCEPTANCE.md'] ?? old.files['ACCEPTANCE.md']
  const acceptances = acceptanceEntries(acceptanceSource, ids)
  const intro = block(lines.slice(1, lines.findIndex(line => /^##\s/.test(line))).join('\n')).split(/\n\s*\n/)[0]
  let target = section(text, 'Product target')
  if (!/^The primary journey:/m.test(target)) {
    const journey = /^The primary journey(?: is)?:\s*(.+)$/m.exec(text)?.[1]
    target += `\n\nThe primary journey: ${journey ?? 'Exercise the capabilities and acceptance journeys below.'}`
  }
  const output = [`# ${seed} target product contract`, intro, '## Product target', target, '## How to read this contract', [
    '- This follows the RER contract standard.',
    '- Core, Agent surface and Later are reported separately.',
    '- Done means every acceptance point has recorded proof.',
    '- Field proof is kept in its register.',
    '- ACCEPTANCE.md and the homepage claims document are generated from this file.',
  ].join('\n')]
  const doors = section(text, 'Door rules')
  if (doors) output.push('## Door rules', doors)
  output.push('## Shared duties (Base)', '| Base duty | Duty | Delta clauses | Base journey |\n| --- | --- | --- | --- |')
  const clauseContent = new Map(), extraHistory = []
  for (const clause of parsed.clauses) {
    const converted = requirementAndAcceptance(oldClauseBody(text, clause), acceptances.get(clause.id))
    clauseContent.set(clause.id, converted.text)
    extraHistory.push(...converted.history)
  }
  const areaNames = new Set()
  for (const [kind, title] of [['published', 'Published clauses'], ['target', 'Target clauses'], ['push-further', 'Push further']]) {
    const selected = [...parsed.clauses].filter(clause => clause.kind === kind).sort((a, b) => a.line - b.line)
    if (!selected.length && kind === 'push-further') continue
    output.push(`## ${title}`)
    if (kind === 'published' && selected.length) output.push(selected.map(clause => `- \`${clause.id}\`: *Tier:* Core`).join('\n'))
    const areas = [...new Set(selected.map(clause => clause.area))]
    if (kind === 'target') { const agent = areas.indexOf('Agent surface'); if (agent >= 0) areas.splice(agent, 1); areas.push('Agent surface') }
    for (const area of areas) {
      let name = area
      if (areaNames.has(name)) name = `${area} (${title.toLowerCase()})`
      areaNames.add(name)
      output.push(`### ${name}`)
      if (area === 'Agent surface') output.push('Inherits BASE-AGENT-001 to BASE-AGENT-013. The company\'s policy decides every call.', '| Tool | Core clauses | Classes this call can carry |\n| --- | --- | --- |')
      for (const clause of selected.filter(clause => clause.area === area)) {
        output.push(`#### ${clause.id} — ${clause.title}`)
        if (kind !== 'published') output.push('*Tier:* Core')
        output.push(clauseContent.get(clause.id))
      }
    }
  }
  output.push('## Field proof register', 'No field proof is recorded yet.', '## Boundaries', section(text, 'Boundaries') || section(text, 'Honest boundaries') || section(text, 'Honest boundaries and delivery responsibilities') || 'No additional boundaries are recorded.', '## Homepage claims', contractClaims(old))
  const retired = outline(text).filter(entry => entry.level === 2 && /^Retired\b/i.test(entry.title))
  if (retired.length) {
    const contents = retired.map(entry => block(lines.slice(entry.start + 1, entry.end).join('\n'))).join('\n\n')
    output.push('## Retired clauses', contents)
  }
  const statusText = section(text, 'Status'), statusLines = linesOf(statusText), table = statusLines.findIndex(line => cells(line).join('|') === 'Clause|Title|Kind|Status|Evidence|Gap')
  const judged = statusLines.find(line => line.startsWith('Judged from'))
  const rows = []
  for (let index = table + 2; index < statusLines.length && statusLines[index].trimStart().startsWith('|'); index++) {
    rows.push(statusLines[index].replace(/^(\s*\|\s*)`?([^`| ]+)`?(\s*\|)/, '$1`$2`$3'))
  }
  output.push('## Status', judged, '| Clauses | Done | Partial | Missing | Total |\n| --- | ---: | ---: | ---: | ---: |\n' + [countRow('Published', parsed.clauses.filter(c => c.kind === 'published')), countRow('Target and push further', parsed.clauses.filter(c => c.kind !== 'published')), countRow('All', parsed.clauses)].join('\n'), [statusLines[table], statusLines[table + 1], ...rows].join('\n'))
  const contract = output.join('\n\n') + '\n'
  // Validate all generated output and lineage before changing the source files.
  const generated = generatedFiles(contract), mapping = buildIdMap(old, contract)
  const history = [read('CHANGELOG.md')?.trim() || '# Changelog', `## Contract source before ${old.commit}`, text.trim(), ...extraHistory]
  for (const [name, contents] of Object.entries(old.files)) if (/(?:^|\/)CLAIMS\.md$/.test(name) && !contents.startsWith('<!-- Generated from CONTRACT.md by contract-docs.')) history.push(`### ${name}`, contents.trim())
  put('CHANGELOG.md', history.join('\n\n') + '\n')
  if (acceptanceSource && !acceptanceSource.startsWith('<!-- Generated from CONTRACT.md by contract-docs.')) put('docs/verify.md', acceptanceSource.trim() + '\n')
  for (const [name, contents] of Object.entries(generated)) put(name, contents)
  fs.rmSync('CLAIMS.md', { force: true })
  coverageInit(old)
  put('docs/contract/ID-MAP.json', json(mapping))
  generate()
  console.log(`Converted ${parsed.clauses.length} clauses; ${parsed.counts.done} done, ${parsed.counts.partial} partial, ${parsed.counts.missing} missing.`)
}
// Coverage tracks the original lines independently of the rewritten layout.
const covSections = new Set(['Product target', 'How to read this contract', 'How to read', 'Door rules', 'Boundaries', 'Homepage claims', 'Status']);
const covNames = ['CONTRACT.md', 'ACCEPTANCE.md', 'docs/CLAIMS.md', 'CLAIMS.md'];
const covMapPath = 'docs/contract/COVERAGE.json';
const covId = new RegExp(`^${clauseIdSource}$`);
const covHeading = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const covDefinition = new RegExp(`^(?:#{1,6}\\s+|(?:[-*+]\\s+)?\\*\\*)(${clauseIdSource})\\s+[—–-]\\s+`);
const covSplit = text => text.replace(/\r\n?/g, '\n').split('\n');
const covGenerated = text => /^\uFEFF?<!-- Generated from CONTRACT\.md by contract-docs\./.test(covSplit(text)[0]);
const covNormalize = text => typeof text === 'string' ? text.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, '').replace(/[`*_]/g, '').replace(/\s+/gu, '') : '';
const covKey = entry => JSON.stringify([entry.file, entry.line, entry.cell ?? '']);
const covLabel = entry => `${entry.file}:${entry.line}${entry.cell ? ` (${entry.cell})` : ''}`;

function covCells(text) {
  const body = text.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return body.split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
}
function covDivider(text) {
  return text.includes('|') && covCells(text).every(cell => /^:?-{3,}:?$/.test(cell));
}
function covVisibleLines(text) {
  let comment = false;
  return covSplit(text).map(raw => {
    let visible = '', at = 0;
    while (at < raw.length) {
      if (comment) {
        const end = raw.indexOf('-->', at);
        if (end < 0) break;
        at = end + 3;
        comment = false;
      } else {
        const start = raw.indexOf('<!--', at);
        if (start < 0) { visible += raw.slice(at); break; }
        visible += raw.slice(at, start);
        at = start + 4;
        comment = true;
      }
    }
    return { raw, text: visible };
  });
}
function covFence(line, current) {
  const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
  if (!marker) return { current, marker: false };
  if (!current) return { current: marker, marker: true };
  if (marker[0] === current[0] && marker.length >= current.length) return { current: undefined, marker: true };
  return { current, marker: false };
}

// A claims heading owns its descendants until a sibling or ancestor ends it.
// A more specific claims heading, such as Opt-out claims, owns its own tables.
function homepageClaims(text) {
  const lines = covVisibleLines(text), result = [], headings = [];
  let fence;
  for (let i = 0; i < lines.length; i++) {
    const value = lines[i].text;
    const state = covFence(value, fence);
    fence = state.current;
    if (state.marker || fence) continue;
    const heading = covHeading.exec(value);
    if (heading) {
      const level = heading[1].length;
      while (headings.length && headings.at(-1).level >= level) headings.pop();
      headings.push({ level, text: plainText(heading[2]) });
      continue;
    }
    const owner = [...headings].reverse().find(entry => /\bclaims?\b/i.test(entry.text));
    if (!owner || !/\bhomepage\s+claims\b/i.test(owner.text) || /\bopt[ -]?out\b/i.test(owner.text)) continue;
    if (!value.includes('|') || !covDivider(lines[i + 1]?.text ?? '')) continue;
    const header = covCells(value);
    if (!header.some(cell => /^claims?$/i.test(plainText(cell)))) continue;
    const rows = [];
    let next = i + 2;
    while (next < lines.length && lines[next].text.trim() && lines[next].text.includes('|') && !covHeading.test(lines[next].text)) {
      const row = lines[next];
      if (covDivider(row.text) || covCells(row.text).length !== header.length) break;
      rows.push({ line: next + 1, cells: covCells(row.text), raw: row.raw });
      next++;
    }
    result.push({ header, rows, heading: owner.text });
    i = next - 1;
  }
  return result;
}

function covFiles(old) {
  return covNames.filter(file => typeof old.files[file] === 'string' && (file === 'CONTRACT.md' || !covGenerated(old.files[file])));
}
function covScope(old) {
  const entries = [];
  for (const file of covFiles(old)) {
    const source = old.files[file], lines = covVisibleLines(source);
    const claims = new Set(homepageClaims(source).flatMap(table => table.rows.map(row => row.line)));
    const headings = [];
    let fence, clause, introStarted = false, introEnded = false;
    for (let index = 0; index < lines.length; index++) {
      const { text, raw } = lines[index], line = index + 1;
      const state = covFence(text, fence), insideFence = Boolean(fence);
      fence = state.current;
      if (state.marker) continue;
      const heading = insideFence ? null : covHeading.exec(text);
      const definition = insideFence ? null : covDefinition.exec(text);
      if (heading) {
        const level = heading[1].length;
        while (headings.length && headings.at(-1).level >= level) headings.pop();
        headings.push({ level, text: plainText(heading[2]) });
        clause = definition?.[1];
        if (level > 1 || introStarted) introEnded = true;
        continue;
      }
      if (!text.trim()) { if (introStarted) introEnded = true; continue; }
      if (covDivider(text)) continue;
      if (definition) clause = definition[1];
      const section = [...headings].reverse().find(entry => entry.level === 2)?.text ?? '';
      const inStatus = headings.some(entry => /^Status\b/i.test(entry.text));
      const cells = !insideFence && text.includes('|') ? covCells(text) : [];
      // Every Status table line is out of scope except a clause row's non-empty Gap cell.
      if (file === 'CONTRACT.md' && inStatus && !insideFence && text.trimStart().startsWith('|')) {
        if (cells.length === 6 && covId.test(plainText(cells[0])) && plainText(cells[5]).trim()) entries.push({ file, line, cell: 'gap', text: cells[5], raw, clause: plainText(cells[0]), section, homepage: false });
        continue;
      }
      const intro = !introEnded && !headings.some(entry => entry.level > 1) && !definition;
      if (intro) introStarted = true;
      entries.push({ file, line, text, raw, clause, section, intro, homepage: claims.has(line) });
    }
  }
  return entries;
}

function covCurrent(text) {
  const parsed = parseContract(text);
  const lines = covVisibleLines(text), sections = new Set(), from = new Map(), ids = new Set(parsed.clauses.map(clause => clause.id));
  const register = new Set(), base = new Set(), rules = new Set();
  let section = '', clause;
  const addSource = (oldId, id) => {
    if (!from.has(oldId)) from.set(oldId, []);
    if (!from.get(oldId).includes(id)) from.get(oldId).push(id);
  };
  for (const id of ids) addSource(id, id);
  for (const { text: value } of lines) {
    const heading = covHeading.exec(value), definition = covDefinition.exec(value);
    if (heading) {
      clause = definition?.[1];
      if (heading[1].length === 2) { section = plainText(heading[2]); sections.add(section); }
    }
    if (definition) clause = definition[1];
    const metadata = /^\s*-\s+`([^`]+)`:\s*\*Tier:\*/.exec(value);
    const owner = metadata?.[1] ?? clause;
    const sources = /\*From:\*\s*([^·\n]+)/.exec(value)?.[1];
    if (owner && ids.has(owner) && sources) for (const oldId of sources.match(new RegExp(clauseIdSource, 'g')) ?? []) addSource(oldId, owner);
    const firstCell = value.includes('|') ? plainText(covCells(value)[0]) : '';
    if (/^Field proof register$/i.test(section) && /^R-\d+$/.test(firstCell)) register.add(firstCell);
    if (/^Shared duties\b/i.test(section) && /^BASE-[A-Z0-9-]+$/.test(firstCell)) base.add(firstCell);
    if (/^Door rules$/i.test(section)) {
      const rule = /^\s*[-*+]\s+(?:\*\*|`)?(D-\d+)[.:`\s]/.exec(value)?.[1];
      if (rule) rules.add(rule);
    }
  }
  const rulings = new Set();
  for (const { text: value } of covVisibleLines(read('RULINGS.md') ?? '')) {
    const id = /^#{1,6}\s+(RL-\d+)\b/.exec(value)?.[1];
    if (id) rulings.add(id);
  }
  const intro = covScope({ files: { 'CONTRACT.md': text } }).some(entry => entry.intro);
  return { ids, gaps: new Set(parsed.clauses.filter(clause => clause.gap).map(clause => clause.id)), from, sections, register, base, rules, rulings, intro };
}
function covRepeated(entry, contractEntries) {
  const text = covNormalize(entry.text);
  return contractEntries.find(other => text && covNormalize(other.text) === text);
}
function covGeneratedStatement(text) {
  const value = plainText(text).trim();
  return /^(?:Judged from the code and tests at commit\b|(?:Claims|Clauses|Full target|Core|Agent surface|Later):\s*\d|\d+ clauses?:\s*\d+ done\b|(?:Evidence|Gap|Status)[.:]\s*|(?:Core|Agent surface|Later)\s*·)/i.test(value)
    || (value.includes('|') && covCells(value).some(cell => /^(?:done|partial|missing)$/i.test(cell)) && covCells(value).every(cell => /^(?:\d+|Tier|Clauses|Done|Partial|Missing|Total|Core|Agent surface|Later|Full target|All|Published|Target(?: and push further)?)$/i.test(cell)))
    || (value.includes('|') && covCells(value).slice(1).every(cell => /^\d+$/.test(cell)) && /^(?:Core|Agent surface|Later|Full target|All|Published|Target(?: and push further)?)$/i.test(covCells(value)[0]));
}
function covPlacement(entry, current, contractEntries) {
  if (entry.homepage) {
    const repeated = entry.file === 'CONTRACT.md' ? undefined : covRepeated(entry, contractEntries);
    return repeated ? { to: 'copy', of: repeated.line } : { to: 'section', section: 'Homepage claims' };
  }
  if (entry.file === 'ACCEPTANCE.md') {
    const repeated = covRepeated(entry, contractEntries);
    if (repeated) return { to: 'copy', of: repeated.line };
    if (entry.clause || covGeneratedStatement(entry.text)) return { to: 'generated', note: 'The contract generator writes this status or count.' };
    return { to: 'docs', path: 'docs/verify.md' };
  }
  if (entry.file !== 'CONTRACT.md') return { to: 'changelog' };
  if (entry.cell === 'gap') return { to: 'gap', ids: current.from.get(entry.clause) ?? [entry.clause] };
  if (entry.clause) return { to: 'clause', ids: current.from.get(entry.clause) ?? [entry.clause] };
  if (entry.intro) return { to: 'section', section: 'intro' };
  if (/^Product target\b/i.test(entry.section)) return { to: 'section', section: 'Product target' };
  if (current.sections.has(entry.section) && covSections.has(entry.section)) return { to: 'section', section: entry.section };
  return { to: 'changelog' };
}
function covWrite(map) {
  put(covMapPath, `${JSON.stringify(map, null, 2)}\n`);
  return map;
}
function covReadMap() {
  const source = read(covMapPath);
  if (source === undefined) throw new Error('Missing `docs/contract/COVERAGE.json`. Run coverage init first.');
  let map;
  try { map = JSON.parse(source); } catch (error) { throw new Error(`Invalid coverage JSON: ${error.message}`); }
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('The coverage map must be an object.');
  return map;
}
function coverageInit(old) {
  const current = covCurrent(read('CONTRACT.md'));
  const entries = covScope(old), contractEntries = entries.filter(entry => entry.file === 'CONTRACT.md');
  const fragments = entries.map(entry => ({ file: entry.file, line: entry.line, ...(entry.cell ? { cell: entry.cell } : {}), text: entry.text, ...covPlacement(entry, current, contractEntries) }));
  return covWrite({ schema: 1, seed: seedName(read('CONTRACT.md')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), old: { commit: old.commit, files: covFiles(old) }, fragments });
}

function covDestination(destination, fragment, source, context, problems, label) {
  const fail = message => problems.push(`${label}: ${message}`);
  if (!destination || typeof destination !== 'object' || Array.isArray(destination)) { fail('A destination must be an object.'); return; }
  const { current, old, expected, groups } = context;
  const note = () => { if (typeof destination.note !== 'string' || !destination.note.trim()) fail(`${destination.to} needs a note.`); };
  const ids = known => {
    if (!Array.isArray(destination.ids) || !destination.ids.length || destination.ids.some(id => typeof id !== 'string')) { fail(`${destination.to} needs a non-empty ids list.`); return; }
    if (new Set(destination.ids).size !== destination.ids.length) fail(`${destination.to} repeats a destination id.`);
    for (const id of destination.ids) if (!known.has(id)) fail(`Unknown ${destination.to} destination ${id}.`);
  };
  if (source?.homepage && !(destination.to === 'section' && destination.section === 'Homepage claims') && !['copy', 'deleted'].includes(destination.to)) fail('A homepage claim must go to Homepage claims or name the old row it repeats.');
  switch (destination.to) {
    case 'clause': ids(current.ids); break;
    case 'gap': ids(current.gaps); break;
    case 'register': ids(current.register); break;
    case 'base': ids(current.base); break;
    case 'door-rule': ids(current.rules); break;
    case 'rulings': ids(current.rulings); break;
    case 'section':
      if (destination.section === 'intro' ? !current.intro : !current.sections.has(destination.section) || !covSections.has(destination.section)) fail(`Unknown section destination ${JSON.stringify(destination.section)}.`);
      break;
    case 'docs': {
      const name = destination.path;
      let exists = false;
      if (typeof name === 'string' && name.startsWith('docs/') && !name.includes('\\') && !name.split('/').includes('..')) {
        try { exists = fs.statSync(name).isFile(); } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
      }
      if (!exists) fail('A docs destination must name an existing file beneath `docs`.');
      break;
    }
    case 'changelog':
      if (read('CHANGELOG.md') === undefined) fail('The changelog destination needs `CHANGELOG.md`.');
      break;
    case 'sibling':
      if (typeof destination.seed !== 'string' || !destination.seed.trim()) fail('A sibling destination needs a seed.');
      note();
      break;
    case 'copy': {
      if (!Number.isInteger(destination.of) || destination.of < 1) { fail('A copy needs the old CONTRACT line number in of.'); break; }
      const target = [...expected.values()].find(entry => entry.file === 'CONTRACT.md' && entry.line === destination.of);
      if (!target || !covNormalize(fragment.text) || !covNormalize(target.text).includes(covNormalize(fragment.text))) fail(`Copy reference CONTRACT.md:${destination.of} does not contain this text.`);
      else if (!groups.has(covKey(target))) fail(`Copy reference CONTRACT.md:${destination.of} is unplaced.`);
      if (fragment.file === 'CONTRACT.md' && fragment.line === destination.of) fail('A copy cannot refer to its own source line.');
      if (source?.homepage && target && !target.homepage) fail('A homepage copy must refer to an old homepage row.');
      break;
    }
    case 'generated': note(); break;
    case 'deleted':
      note();
      if (source?.homepage && (typeof destination.note !== 'string' || !/\b(?:duplicat\w*|repeat\w*)\b/i.test(destination.note) || !/\b(?:row|line)\s+\d+\b/i.test(destination.note))) fail('A deleted homepage claim must name the old row it repeats.');
      break;
    default: fail(`Unknown destination ${JSON.stringify(destination.to)}.`);
  }
}
function coverageCheck(old) {
  const map = covReadMap(), problems = [], entries = covScope(old), expected = new Map(entries.map(entry => [covKey(entry), entry])), groups = new Map();
  if (map.schema !== 1) problems.push('Coverage schema must be 1.');
  if (map.old?.commit !== old.commit) problems.push(`Coverage old.commit must equal ${old.commit}; found ${JSON.stringify(map.old?.commit)}.`);
  const files = covFiles(old);
  if (!Array.isArray(map.old?.files) || new Set(map.old.files).size !== files.length || map.old.files.length !== files.length || files.some(file => !map.old.files.includes(file))) problems.push('Coverage old.files must name every original hand-written source once.');
  if (!Array.isArray(map.fragments)) problems.push('Coverage fragments must be a list.');
  const fragments = Array.isArray(map.fragments) ? map.fragments : [];
  fragments.forEach((fragment, index) => {
    const label = `Fragment ${index + 1}`;
    if (!fragment || typeof fragment !== 'object' || Array.isArray(fragment)) { problems.push(`${label}: A fragment must be an object.`); return; }
    const key = covKey(fragment);
    if (!expected.has(key) || !Number.isInteger(fragment.line)) problems.push(`${label}: ${covLabel(fragment)} is outside the original scoped text.`);
    if (typeof fragment.text !== 'string' || !covNormalize(fragment.text)) problems.push(`${label}: A fragment needs non-empty text.`);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(fragment);
  });
  for (const [key, source] of expected) {
    const own = groups.get(key);
    if (!own) { problems.push(`${covLabel(source)}: Unplaced original text: ${source.text}`); continue; }
    if (own.some(fragment => typeof fragment.text !== 'string') || covNormalize(own.map(fragment => fragment.text).join(' ')) !== covNormalize(source.text)) problems.push(`${covLabel(source)}: Fragments must rebuild the whole original text once, in order: ${source.text}`);
  }
  const current = covCurrent(read('CONTRACT.md')), context = { current, old, expected, groups };
  fragments.forEach((fragment, index) => {
    if (!fragment || typeof fragment !== 'object' || Array.isArray(fragment)) return;
    const label = `${covLabel(fragment)} fragment ${index + 1}`, source = expected.get(covKey(fragment));
    covDestination(fragment, fragment, source, context, problems, label);
    if (fragment.also !== undefined && !Array.isArray(fragment.also)) problems.push(`${label}: also must be a list of destinations.`);
    for (const [offset, destination] of (Array.isArray(fragment.also) ? fragment.also : []).entries()) covDestination(destination, fragment, source, context, problems, `${label} also ${offset + 1}`);
  });
  const oldClaims = Math.max(0, ...files.map(file => homepageClaims(old.files[file]).reduce((sum, table) => sum + table.rows.length, 0)));
  const newClaims = homepageClaims(read('CONTRACT.md')).reduce((sum, table) => sum + table.rows.length, 0);
  if (oldClaims && oldClaims !== newClaims) problems.push(`Homepage claims have ${newClaims} rows; the largest original table has ${oldClaims}.`);
  if (problems.length) throw new Error(`${covMapPath}:\n${problems.join('\n')}`);
  console.log(`Coverage checked: ${entries.length} original lines placed.`);
}

// Git's explicit Myers diff gives stable unchanged-line moves without a quadratic matrix.
function covLineMoves(from, onto, file) {
  const before = covSplit(from.files[file] ?? ''), after = covSplit(onto.files[file] ?? ''), moves = new Map();
  const diff = git(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color', '--diff-algorithm=myers', '--unified=0', from.commit, onto.commit, '--', file]);
  let oldLine = 1, newLine = 1;
  const unchanged = end => {
    while (oldLine < end && oldLine <= before.length && newLine <= after.length) {
      if (before[oldLine - 1] !== after[newLine - 1]) throw new Error(`Git diff did not preserve ${file}:${oldLine}.`);
      moves.set(oldLine++, newLine++);
    }
  };
  for (const match of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const oldCount = match[2] === undefined ? 1 : Number(match[2]), newCount = match[4] === undefined ? 1 : Number(match[4]);
    const oldStart = Number(match[1]) + (oldCount === 0 ? 1 : 0), newStart = Number(match[3]) + (newCount === 0 ? 1 : 0);
    unchanged(oldStart);
    oldLine = oldStart + oldCount;
    newLine = newStart + newCount;
  }
  unchanged(before.length + 1);
  return moves;
}
function coverageRebase(from, onto) {
  const map = covReadMap();
  if (map.old?.commit !== from.commit) throw new Error(`Coverage old.commit must equal the rebase source ${from.commit}.`);
  if (!Array.isArray(map.fragments)) throw new Error('Coverage fragments must be a list.');
  const before = new Map(covScope(from).map(entry => [covKey(entry), entry])), entries = covScope(onto), after = new Map(entries.map(entry => [covKey(entry), entry]));
  const moves = new Map(covFiles(onto).map(file => [file, covLineMoves(from, onto, file)]));
  const fragments = [];
  for (const fragment of map.fragments) {
    if (!fragment || typeof fragment !== 'object' || !before.has(covKey(fragment))) continue;
    const line = moves.get(fragment.file)?.get(fragment.line);
    if (line === undefined) continue;
    const updated = { ...fragment, line };
    if (after.has(covKey(updated))) {
      const remapCopy = destination => {
        if (destination.to !== 'copy') return destination;
        const of = moves.get('CONTRACT.md')?.get(destination.of);
        return of === undefined ? undefined : { ...destination, of };
      };
      const placed = remapCopy(updated);
      if (!placed) continue;
      if (Array.isArray(placed.also)) {
        const also = placed.also.map(remapCopy);
        if (also.some(destination => destination === undefined)) continue;
        placed.also = also;
      }
      fragments.push(placed);
    }
  }
  const rebuilt = new Map();
  for (const fragment of fragments) {
    const key = covKey(fragment);
    if (!rebuilt.has(key)) rebuilt.set(key, []);
    rebuilt.get(key).push(fragment.text);
  }
  covWrite({ ...map, old: { commit: onto.commit, files: covFiles(onto) }, fragments });
  const unmapped = entries.filter(entry => !rebuilt.has(covKey(entry)) || covNormalize(rebuilt.get(covKey(entry)).join(' ')) !== covNormalize(entry.text));
  for (const entry of unmapped) console.log(`Newly unmapped ${covLabel(entry)}: ${entry.text}`);
  if (!unmapped.length) console.log('Coverage rebased: no newly unmapped original lines.');
  return { ...map, old: { commit: onto.commit, files: covFiles(onto) }, fragments };
}

function main(args) {
  const [command, ...rest] = args
  const option = name => {
    const index = rest.indexOf(name)
    if (index < 0 || !rest[index + 1] || rest[index + 1].startsWith('--')) throw Error(`Provide ${name} and its Git reference.`)
    return rest[index + 1]
  }
  if (command === 'write' && !rest.length) generate()
  else if (command === 'check' && !rest.length) generate(true)
  else if (command === 'id-map') idMap(snapshot(option('--old')))
  else if (command === 'coverage' && rest[0] === 'init') coverageInit(snapshot(option('--old')))
  else if (command === 'coverage' && rest[0] === 'check') coverageCheck(snapshot(option('--old')))
  else if (command === 'coverage' && rest[0] === 'rebase') coverageRebase(snapshot(option('--from')), snapshot(option('--onto')))
  else if (command === 'convert') convert(snapshot(option('--old')), rest.includes('--old-acceptance') ? snapshot(option('--old-acceptance')) : undefined)
  else throw Error('Usage: contract-docs.mjs write|check|id-map --old <ref>|coverage init|check --old <ref>|coverage rebase --from <ref> --onto <ref>|convert --old <ref> [--old-acceptance <ref>]')
}
try { main(process.argv.slice(2)) } catch (error) { console.error(error.message); process.exitCode = 1 }

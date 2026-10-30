import { clauseIdSource, plainText } from './seed-contract.mjs'
import { prosePatterns } from './contract-prose-patterns.mjs'

const families = { a: 'acceptance-generated', b: 'base-duty', c: 'tool-class', d: 'record-placement' }
const classes = /\b(?:standard|external|money|commitment|accounts|gated|access|security|destructive|sensitive|live)\b/i
const idsIn = text => [...text.matchAll(new RegExp(`(?<![A-Za-z0-9.-])(${clauseIdSource})(?![A-Za-z0-9.-])`, 'g'))].map(match => match[1])
const cells = line => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map(plainText)
const divider = line => line.includes('|') && cells(line).every(cell => /^:?-{3,}:?$/.test(cell))
const normalize = text => plainText(text).replace(/\s+/g, ' ').trim()

function visibleLines(text) {
  let comment = false, fence
  return text.replace(/\r\n?/g, '\n').split('\n').map(raw => {
    let value = ''
    for (let at = 0; at < raw.length;) {
      const end = raw.indexOf(comment ? '-->' : '<!--', at)
      if (end < 0) { if (!comment) value += raw.slice(at); break }
      if (!comment) value += raw.slice(at, end)
      at = end + (comment ? 3 : 4)
      comment = !comment
    }
    const mark = /^\s*(`{3,}|~{3,})/.exec(value)?.[1]
    if (mark) {
      if (!fence) fence = mark
      else if (mark[0] === fence[0] && mark.length >= fence.length) fence = undefined
      return ''
    }
    return fence ? '' : value
  })
}

export function contractProseFindings({ text, clauses, coverage, sources, generatedStatement }) {
  const findings = [], lines = visibleLines(text)
  const add = (family, ids, location, message) => {
    for (const id of new Set(ids.length ? ids : ['(no clause id)']))
      findings.push({ family, id, location, message, severity: family === 'a' || family === 'c' ? 'ERROR' : 'WARN' })
  }
  const owners = new Map()
  for (const clause of clauses) {
    const body = []
    for (let index = clause.line; index < lines.length && !/^#{1,6}\s/.test(lines[index]); index++) {
      body.push(lines[index])
      owners.set(index, clause.id)
    }
    const prose = normalize(body.join('\n'))
    const gap = normalize(clause.gap)
    for (const [family, phrase, source] of prosePatterns) {
      for (const [value, line] of [[prose, clause.line], [gap, clause.row]]) {
        const at = value.toLowerCase().indexOf(phrase.toLowerCase())
        if (at >= 0) add(family, [clause.id], `CONTRACT.md:${line}`, `matched ${JSON.stringify(value.slice(at, at + phrase.length))}; source: ${source}`)
      }
    }
  }

  for (let index = 0; index + 1 < lines.length; index++) {
    if (!lines[index].includes('|') || !divider(lines[index + 1])) continue
    const header = cells(lines[index]), tool = header.findIndex(cell => /^tools?\b/i.test(cell))
    if (tool < 0) continue
    const classColumn = header.findIndex(cell => /\bclass(?:es)?\b/i.test(cell))
    const clauseColumn = header.findIndex(cell => /\bclauses?\b/i.test(cell))
    for (let row = index + 2; row < lines.length && lines[row].trimStart().startsWith('|'); row++) {
      const values = cells(lines[row])
      if (!values[tool] || divider(lines[row])) continue
      if (classColumn >= 0 && classes.test(values[classColumn] ?? '')) continue
      const ids = idsIn(clauseColumn >= 0 ? values[clauseColumn] ?? '' : values.join(' '))
      if (!ids.length && owners.has(row)) ids.push(owners.get(row))
      add('c', ids, `CONTRACT.md:${row + 1}`, `tool ${JSON.stringify(values[tool])} declares no fleet class`)
    }
  }

  for (const [index, fragment] of (coverage?.fragments ?? []).entries()) {
    const destinations = [fragment, ...(fragment.also ?? [])]
    if (!destinations.some(destination => destination.to === 'generated')) continue
    const source = sources.find(entry => entry.file === fragment.file && entry.line === fragment.line && entry.cell === fragment.cell)
    if (!(fragment.file === 'ACCEPTANCE.md' || source?.clause) || generatedStatement(fragment.text)) continue
    const ids = fragment.ids?.length ? fragment.ids : source?.clause ? [source.clause] : idsIn(fragment.text)
    add('a', ids, `docs/contract/COVERAGE.json fragment ${index + 1} (${fragment.file}:${fragment.line})`, `acceptance prose mapped generated: ${JSON.stringify(fragment.text)}`)
  }
  return findings
}

export function printProseFindings(findings) {
  for (const finding of findings)
    console.log(`${finding.severity} ${finding.id} ${finding.family} ${families[finding.family]} ${finding.location}: ${finding.message}`)
  const errors = findings.filter(finding => finding.severity === 'ERROR').length
  console.log(`Contract prose: ${errors} errors, ${findings.length - errors} warnings.`)
  return errors
}

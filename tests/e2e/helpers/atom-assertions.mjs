import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// RFC 4287 checks for the text and HTML constructs Lamp emits. ElementTree
// independently parses namespaces and escaped text, rather than matching tags.
export function validateAtomFeed(xml) {
  return JSON.parse(execFileSync('python3', ['-c', String.raw`
import datetime, json, re, sys
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit

ns = '{http://www.w3.org/2005/Atom}'
root = ET.fromstring(sys.stdin.buffer.read())
assert root.tag == ns + 'feed', 'Atom 1.0 feed namespace'

def one(node, name):
    values = node.findall(ns + name)
    assert len(values) == 1, 'exactly one ' + name
    return values[0]

def text(node, name):
    value = one(node, name)
    assert not list(value) and value.text and value.text.strip(), 'nonempty text ' + name
    return value.text

def iri(value):
    assert not re.search(r'\s', value) and urlsplit(value).scheme, 'absolute Atom IRI'
    return value

def timestamp(node, name):
    value = text(node, name)
    assert re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})', value), 'RFC 3339 date construct'
    datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
    return value

def construct(node, name):
    value = one(node, name)
    assert value.get('type', 'text') in ('text', 'html'), 'supported Atom text construct'
    assert not list(value), 'HTML must be escaped inside Atom text constructs'
    assert value.text and value.text.strip(), 'nonempty Atom construct'
    return value.text

def authors(node):
    for person in node.findall(ns + 'author'):
        text(person, 'name')
    return bool(node.findall(ns + 'author'))

def links(node):
    seen = set()
    result = []
    for link in node.findall(ns + 'link'):
        iri(link.get('href', ''))
        relation = link.get('rel', 'alternate')
        if relation == 'alternate':
            key = (link.get('type'), link.get('hreflang'))
            assert key not in seen, 'unique alternate link type and language'
            seen.add(key)
        result.append(dict(link.attrib))
    return result

feed_id = iri(text(root, 'id'))
title = construct(root, 'title')
updated = timestamp(root, 'updated')
has_author = authors(root)
feed_links = links(root)
assert any(link.get('rel') == 'self' and link.get('type') == 'application/atom+xml' for link in feed_links), 'Atom self link'
entries = []
for entry in root.findall(ns + 'entry'):
    entry_id = iri(text(entry, 'id'))
    entry_author = authors(entry)
    assert has_author or entry_author, 'entry requires its own author or a feed author'
    entry_links = links(entry)
    alternate = [link for link in entry_links if link.get('rel', 'alternate') == 'alternate']
    assert len(alternate) == 1 and alternate[0].get('type') == 'text/html', 'one HTML permanent link'
    entries.append(dict(id=entry_id, title=construct(entry, 'title'), updated=timestamp(entry, 'updated'),
                        href=alternate[0]['href'], content=construct(entry, 'content'), summary=construct(entry, 'summary')))
ids = [entry['id'] for entry in entries]
assert len(set(ids)) == len(ids), 'unique Atom event identities'
assert feed_id not in ids, 'feed identity differs from event identities'
print(json.dumps(dict(id=feed_id, title=title, updated=updated, entries=entries)))
`], { input: xml, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
}

export function assertAtomInventory(feed, expected) {
  const times = feed.entries.map(entry => entry.updated);
  assert.deepEqual(times, [...times].sort().reverse(), 'newest first, allowing equal publication instants');
  const byId = (a, b) => a.id.localeCompare(b.id);
  assert.deepEqual(feed.entries.map(entry => ({ id: entry.id, updated: entry.updated, href: entry.href })).sort(byId),
    expected.map(event => ({ id: event.atomId, updated: event.publishedAt, href: event.href })).sort(byId),
    'exactly one entry for every independently retained eligible publication');
  for (const event of expected) {
    const entry = feed.entries.find(row => row.id === event.atomId);
    assert.equal(entry.title, event.title, 'the event retains its record and notice identity');
    assert.ok(entry.content.includes(event.wording), 'the matching entry carries the submitted customer wording');
  }
}

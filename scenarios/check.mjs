import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const catalog = JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url), 'utf8'))
assert.equal(catalog.schema, 'kanban-scenarios')
assert.equal(catalog.status, 'specification-only')
assert.equal(catalog.cases.length, 7)
assert.equal(new Set(catalog.cases.map(item => item.id)).size, catalog.cases.length)
for (const [index, item] of catalog.cases.entries()) {
  assert.match(item.id, /^kanban_c[1-7]_[a-z_]+$/)
  for (const sha of [item.base_commit, item.reference_commit]) assert.match(sha, /^[a-f0-9]{40}$/)
  const parent = execFileSync('git', ['show', '-s', '--format=%P', item.reference_commit], { cwd: root, encoding: 'utf8' }).trim()
  assert.equal(parent, item.base_commit, `${item.id}: reference must have exactly the base as parent`)
  if (index) assert.equal(item.base_commit, catalog.cases[index - 1].reference_commit)
  assert.ok(item.prompt.trim() && item.criteria.length > 0)
  assert.ok(item.criteria.every(criterion => typeof criterion === 'string' && criterion.trim()))
  assert.ok(!item.prompt.includes(item.reference_commit))
}

const args = process.argv.slice(2)
if (!args.length) {
  console.log(`PASS: ${catalog.cases.length} scenarios, exact commits and linear transitions verified.`)
} else {
  assert.equal(args.length, 2, 'Usage: node scenarios/check.mjs [--prompt <scenario-id>]')
  assert.equal(args[0], '--prompt')
  const item = catalog.cases.find(item => item.id === args[1])
  assert.ok(item, 'Unknown scenario')
  console.log(`${catalog.shared_prompt}\n\n${item.prompt}\n\nAcceptance criteria:\n${item.criteria.map(criterion => `- ${criterion}`).join('\n')}`)
}

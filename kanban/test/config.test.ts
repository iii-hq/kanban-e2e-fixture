import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parseConfiguration, projectRoot, resolveDataDirectory } from '../src/config.js'

test('uses the repository root for a relative data directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kanban-config-'))
  try {
    await writeFile(join(root, 'worker-compose.yaml'), 'containers: {}\n')
    const worker = join(root, 'kanban')
    assert.equal(projectRoot(worker), root)
    assert.equal(resolveDataDirectory({ data_dir: './data' }, root), join(root, 'data'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects an unusable data directory', () => {
  assert.throws(() => parseConfiguration({ data_dir: '' }), /data_dir/)
})

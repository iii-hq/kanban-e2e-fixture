import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startKanbanServer } from '../src/http.js'

test('serves the browser UI and configuration API on exact routes', async () => {
  const uiDirectory = await mkdtemp(join(tmpdir(), 'kanban-ui-'))
  await Promise.all([
    writeFile(join(uiDirectory, 'index.html'), '<main>Kanban</main>'),
    writeFile(join(uiDirectory, 'page.js'), 'console.log("kanban")'),
    writeFile(join(uiDirectory, 'styles.css'), 'main { display: block }'),
  ])
  let stored: Record<string, unknown> = { data_dir: './data', future_setting: true }
  const server = await startKanbanServer({
    uiDirectory,
    getConfiguration: async () => ({
      data_dir: stored.data_dir as string,
      resolved_data_dir: `/project/${stored.data_dir}`,
    }),
    setDataDirectory: async (dataDir) => {
      stored = { ...stored, data_dir: dataDir }
      return { data_dir: dataDir, resolved_data_dir: `/project/${dataDir}` }
    },
  }, 0)
  const port = (server.address() as AddressInfo).port
  const request = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${path}`, init)

  try {
    for (const [path, contentType, body] of [
      ['/', 'text/html', '<main>Kanban</main>'],
      ['/index.html', 'text/html', '<main>Kanban</main>'],
      ['/page.js', 'text/javascript', 'console.log("kanban")'],
      ['/styles.css', 'text/css', 'main { display: block }'],
    ]) {
      const response = await request(path)
      assert.equal(response.status, 200)
      assert.match(response.headers.get('content-type') ?? '', new RegExp(contentType))
      assert.equal(await response.text(), body)
    }

    const before = await request('/api/config')
    assert.deepEqual(await before.json(), { data_dir: './data', resolved_data_dir: '/project/./data' })

    const saved = await request('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data_dir: './tickets' }),
    })
    assert.equal(saved.status, 200)
    assert.deepEqual(await saved.json(), { data_dir: './tickets', resolved_data_dir: '/project/./tickets' })
    assert.deepEqual(stored, { data_dir: './tickets', future_setting: true })

    for (const path of ['/constructor', '/toString', '/__proto__', '/page.js/extra']) {
      assert.equal((await request(path)).status, 404)
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await rm(uiDirectory, { recursive: true, force: true })
  }
})

test('rejects invalid configuration and reports save errors', async () => {
  const server = await startKanbanServer({
    uiDirectory: '.',
    getConfiguration: async () => ({ data_dir: './data', resolved_data_dir: '/project/data' }),
    setDataDirectory: async () => { throw new Error('save failed') },
  }, 0)
  const port = (server.address() as AddressInfo).port
  const request = (body: string) => fetch(`http://127.0.0.1:${port}/api/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body,
  })

  try {
    assert.equal((await request('{')).status, 400)
    assert.equal((await request(JSON.stringify({ data_dir: ' ' }))).status, 400)
    const failed = await request(JSON.stringify({ data_dir: './other' }))
    assert.equal(failed.status, 500)
    assert.deepEqual(await failed.json(), { error: 'save failed' })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

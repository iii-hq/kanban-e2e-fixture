import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { type AddressInfo } from 'node:net'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startKanbanServer } from '../src/http.js'
import { createTicket, deleteTicket, getTicket, listTickets } from '../src/tickets.js'

test('serves the browser UI and configuration API on exact routes', async () => {
  const uiDirectory = await mkdtemp(join(tmpdir(), 'kanban-ui-'))
  await Promise.all([
    writeFile(join(uiDirectory, 'index.html'), '<main>Kanban</main>'),
    writeFile(join(uiDirectory, 'page.js'), 'console.log("kanban")'),
    writeFile(join(uiDirectory, 'styles.css'), 'main { display: block }'),
  ])
  let stored: Record<string, unknown> = { data_dir: './data', future_setting: true }
  const ticket = createTicket(uiDirectory, { title: 'Visible on the board', status: 'in_review' })
  const server = await startKanbanServer({
    uiDirectory,
    getTickets: async () => ({ tickets: listTickets(uiDirectory) }),
    createTicket: async (input) => createTicket(uiDirectory, input),
    getTicket: async (id) => getTicket(uiDirectory, id),
    deleteTicket: async (id) => deleteTicket(uiDirectory, id),
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
    const board = await request('/api/tickets')
    assert.equal(board.status, 200)
    assert.deepEqual(await board.json(), { tickets: [ticket] })

    const created = await request('/api/tickets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Created through HTTP', priority: 'high' }),
    })
    assert.equal(created.status, 201)
    const createdTicket = (await created.json() as { ticket: ReturnType<typeof createTicket> }).ticket
    assert.equal(createdTicket.title, 'Created through HTTP')
    assert.deepEqual(await (await request(`/api/tickets/${createdTicket.id}`)).json(), { ticket: createdTicket })
    const deleted = await request(`/api/tickets/${createdTicket.key}`, { method: 'DELETE' })
    assert.equal(deleted.status, 200)
    assert.equal((await deleted.json() as { ticket: { deleted_at?: string } }).ticket.deleted_at !== undefined, true)
    assert.equal((await request(`/api/tickets/${createdTicket.key}`)).status, 404)

    const unicode = Buffer.from(JSON.stringify({ title: 'ação' }))
    const split = unicode.indexOf(Buffer.from('ç')) + 1
    const received = await new Promise<string>((resolve, reject) => {
      const client = httpRequest(`http://127.0.0.1:${port}/api/tickets`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
      }, (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => { body += chunk })
        response.on('end', () => resolve(body))
        response.on('error', reject)
      })
      client.on('error', reject)
      client.write(unicode.subarray(0, split))
      setTimeout(() => client.end(unicode.subarray(split)), 20)
    })
    assert.equal(JSON.parse(received).ticket.title, 'ação')

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
    getTickets: async () => { throw new Error('INVALID_TICKET_STORE: store unavailable') },
    createTicket: async () => { throw new Error('Function failed: INVALID_TICKET: title must be a non-empty string') },
    getTicket: async () => { throw new Error('Function failed: TICKET_NOT_FOUND: KAN-404') },
    deleteTicket: async () => { throw new Error('Function failed: TICKET_NOT_FOUND: KAN-404') },
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
    const board = await fetch(`http://127.0.0.1:${port}/api/tickets`)
    assert.equal(board.status, 500)
    assert.deepEqual(await board.json(), { error: 'INVALID_TICKET_STORE: store unavailable' })
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/tickets`, {
      method: 'POST', body: '{', headers: { 'content-type': 'application/json' },
    })).status, 400)
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/tickets`, {
      method: 'POST', body: JSON.stringify({ title: 'Cross-origin creation' }),
      headers: { 'content-type': 'text/plain', origin: 'https://other.example' },
    })).status, 415)
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '' }),
    })).status, 400)
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/tickets/KAN-404`)).status, 404)
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/tickets/KAN-404`, { method: 'DELETE' })).status, 404)
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/tickets/`)).status, 404)
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/tickets/%`)).status, 400)
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/tickets/KAN-1`, { method: 'PATCH' })).status, 404)
    assert.equal((await request('{')).status, 400)
    assert.equal((await request(JSON.stringify({ data_dir: ' ' }))).status, 400)
    const failed = await request(JSON.stringify({ data_dir: './other' }))
    assert.equal(failed.status, 500)
    assert.deepEqual(await failed.json(), { error: 'save failed' })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

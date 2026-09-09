import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { type AddressInfo } from 'node:net'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startKanbanServer } from '../src/http.js'
import { addComment, createTicket, deleteTicket, getTicket, listTickets, updateTicket } from '../src/tickets.js'

async function connectEvents(url: string) {
  const controller = new AbortController()
  const response = await fetch(url, { signal: controller.signal })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  return {
    async next() {
      while (!buffer.includes('\n\n')) {
        const { done, value } = await reader.read()
        assert.equal(done, false)
        buffer += decoder.decode(value, { stream: true })
      }
      const end = buffer.indexOf('\n\n')
      const event = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      assert.match(event, /^event: change\ndata: /)
      return JSON.parse(event.slice(event.indexOf('data: ') + 6)) as { store: string }
    },
    async close() {
      controller.abort()
      await reader.cancel().catch(() => {})
    },
  }
}

test('serves the browser UI and configuration API on exact routes', async () => {
  const uiDirectory = await mkdtemp(join(tmpdir(), 'kanban-ui-'))
  await Promise.all([
    writeFile(join(uiDirectory, 'index.html'), '<main>Kanban</main>'),
    writeFile(join(uiDirectory, 'page.js'), 'console.log("kanban")'),
    writeFile(join(uiDirectory, 'styles.css'), 'main { display: block }'),
  ])
  let stored: Record<string, unknown> = { data_dir: './data', future_setting: true }
  const listeners = new Set<(store: string) => void>()
  const ticket = createTicket(uiDirectory, { title: 'Visible on the board', status: 'in_review' })
  const server = await startKanbanServer({
    uiDirectory,
    getEventStore: () => uiDirectory,
    subscribeEvents: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getTickets: async () => ({ tickets: listTickets(uiDirectory) }),
    createTicket: async (input) => createTicket(uiDirectory, input),
    getTicket: async (id) => getTicket(uiDirectory, id),
    updateTicket: async (id, input) => updateTicket(uiDirectory, id, input),
    deleteTicket: async (id) => deleteTicket(uiDirectory, id),
    addComment: async (id, input) => addComment(uiDirectory, id, input),
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
    const updated = await request(`/api/tickets/${createdTicket.key}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'done', assignee: 'Taylor' }),
    })
    assert.equal(updated.status, 200)
    assert.deepEqual(await updated.json(), { ticket: { ...createdTicket, status: 'done', assignee: 'Taylor', updated_at: getTicket(uiDirectory, createdTicket.id).updated_at } })
    const commented = await request(`/api/tickets/${createdTicket.key}/comments`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ author: 'Taylor', body: 'Ready for review' }),
    })
    assert.equal(commented.status, 201)
    assert.equal((await commented.json() as { ticket: { comments: unknown[] } }).ticket.comments.length, 1)
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
    getEventStore: () => '/project/data',
    subscribeEvents: () => () => {},
    getTickets: async () => { throw new Error('INVALID_TICKET_STORE: store unavailable') },
    createTicket: async () => { throw new Error('Function failed: INVALID_TICKET: title must be a non-empty string') },
    getTicket: async () => { throw new Error('Function failed: TICKET_NOT_FOUND: KAN-404') },
    updateTicket: async () => { throw new Error('Function failed: INVALID_TICKET: invalid status') },
    deleteTicket: async () => { throw new Error('Function failed: TICKET_NOT_FOUND: KAN-404') },
    addComment: async () => { throw new Error('Function failed: INVALID_COMMENT: body must be a non-empty string') },
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
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/tickets/KAN-1`, { method: 'PATCH' })).status, 415)
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/tickets/KAN-1`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{',
    })).status, 400)
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/tickets/KAN-1`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'closed' }),
    })).status, 400)
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/tickets/KAN-1/comments`, { method: 'POST' })).status, 415)
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/tickets/KAN-1/comments`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    })).status, 400)
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/tickets/KAN-1/comments`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ author: 'Sam', body: '' }),
    })).status, 400)
    assert.equal((await request('{')).status, 400)
    assert.equal((await request(JSON.stringify({ data_dir: ' ' }))).status, 400)
    const failed = await request(JSON.stringify({ data_dir: './other' }))
    assert.equal(failed.status, 500)
    assert.deepEqual(await failed.json(), { error: 'save failed' })
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('streams initial, persisted mutation and configuration events to connected clients', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kanban-events-'))
  let store = directory
  const listeners = new Set<(nextStore: string) => void>()
  let resolveDisconnected!: () => void
  const disconnected = new Promise<void>((resolve) => { resolveDisconnected = resolve })
  const emit = () => {
    for (const listener of listeners) listener(store)
  }
  const server = await startKanbanServer({
    uiDirectory: '.',
    getEventStore: () => store,
    subscribeEvents: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) resolveDisconnected()
      }
    },
    getTickets: async () => ({ tickets: listTickets(store) }),
    createTicket: async (input) => {
      const ticket = createTicket(store, input)
      emit()
      return ticket
    },
    getTicket: async (id) => getTicket(store, id),
    updateTicket: async (id, input) => {
      const ticket = updateTicket(store, id, input)
      emit()
      return ticket
    },
    deleteTicket: async (id) => {
      const ticket = deleteTicket(store, id)
      emit()
      return ticket
    },
    addComment: async (id, input) => {
      const ticket = addComment(store, id, input)
      emit()
      return ticket
    },
    getConfiguration: async () => ({ data_dir: store, resolved_data_dir: store }),
    setDataDirectory: async (dataDirectory) => {
      store = dataDirectory
      emit()
      return { data_dir: store, resolved_data_dir: store }
    },
  }, 0)
  const port = (server.address() as AddressInfo).port
  const base = `http://127.0.0.1:${port}`
  const [first, second] = await Promise.all([
    connectEvents(`${base}/api/events`),
    connectEvents(`${base}/api/events`),
  ])

  try {
    assert.deepEqual(await Promise.all([first.next(), second.next()]), [{ store: directory }, { store: directory }])

    const created = await fetch(`${base}/api/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Live ticket' }),
    })
    assert.equal(created.status, 201)
    assert.deepEqual(await Promise.all([first.next(), second.next()]), [{ store: directory }, { store: directory }])

    const invalid = await fetch(`${base}/api/tickets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '' }),
    })
    assert.equal(invalid.status, 400)

    const nextStore = join(directory, 'other')
    const configured = await fetch(`${base}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data_dir: nextStore }),
    })
    assert.equal(configured.status, 200)
    assert.deepEqual(await Promise.all([first.next(), second.next()]), [{ store: nextStore }, { store: nextStore }])
  } finally {
    await Promise.all([first.close(), second.close()])
    let timeout: NodeJS.Timeout | undefined
    await Promise.race([
      disconnected,
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('SSE clients did not unsubscribe')), 5_000) }),
    ])
    if (timeout) clearTimeout(timeout)
    assert.equal(listeners.size, 0)
    assert.equal((await fetch(`${base}/api/config`)).status, 200)
    const closed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    server.closeAllConnections()
    await closed
    await rm(directory, { recursive: true, force: true })
  }
})

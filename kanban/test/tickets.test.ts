import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { addComment, createTicket, deleteTicket, getTicket, listTickets, updateTicket } from '../src/tickets.js'

async function directory() {
  return mkdtemp(join(tmpdir(), 'kanban-tickets-'))
}

test('persists tickets with defaults and finds them by UUID or human-readable key', async () => {
  const root = await directory()
  try {
    const first = createTicket(root, { title: '  First ticket  ' })
    const second = createTicket(root, {
      title: 'Second ticket',
      description: 'Details',
      status: 'in_progress',
      priority: 'high',
      assignee: 'Taylor',
    })

    assert.equal(first.key, 'KAN-1')
    assert.equal(first.title, 'First ticket')
    assert.equal(first.description, '')
    assert.equal(first.status, 'backlog')
    assert.equal(first.priority, 'medium')
    assert.equal(first.assignee, null)
    assert.equal(first.created_at, first.updated_at)
    assert.deepEqual(getTicket(root, first.id), first)
    assert.deepEqual(getTicket(root, second.key), second)
    assert.deepEqual(listTickets(root), [first, second])
    assert.deepEqual(JSON.parse(await readFile(join(root, 'tickets.json'), 'utf8')), [first, second])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('serial calls keep keys unique and stores remain isolated when directories switch', async () => {
  const firstRoot = await directory()
  const secondRoot = await directory()
  try {
    const created = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      Promise.resolve().then(() => createTicket(firstRoot, { title: `Ticket ${index}` })),
    ))
    assert.equal(new Set(created.map(({ id }) => id)).size, 20)
    assert.deepEqual(created.map(({ key }) => key), Array.from({ length: 20 }, (_, index) => `KAN-${index + 1}`))

    const other = createTicket(secondRoot, { title: 'Other store' })
    assert.equal(other.key, 'KAN-1')
    assert.equal(listTickets(firstRoot).length, 20)
    assert.deepEqual(listTickets(secondRoot), [other])
  } finally {
    await Promise.all([
      rm(firstRoot, { recursive: true, force: true }),
      rm(secondRoot, { recursive: true, force: true }),
    ])
  }
})

test('soft-deletes tickets without reusing keys', async () => {
  const root = await directory()
  try {
    const first = createTicket(root, { title: 'Remove me' })
    const deleted = deleteTicket(root, first.key)

    assert.equal(deleted.id, first.id)
    assert.equal(deleted.deleted_at, deleted.updated_at)
    assert.deepEqual(listTickets(root), [])
    assert.throws(() => getTicket(root, first.id), /TICKET_NOT_FOUND/)
    assert.throws(() => deleteTicket(root, first.key), /TICKET_NOT_FOUND/)

    const stored = JSON.parse(await readFile(join(root, 'tickets.json'), 'utf8'))
    assert.deepEqual(stored, [deleted])
    assert.equal(createTicket(root, { title: 'After restart' }).key, 'KAN-2')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('partially updates editable fields and persists them', async () => {
  const root = await directory()
  try {
    const original = createTicket(root, { title: 'Original', description: 'Keep me', assignee: 'Taylor' })
    await new Promise((resolve) => setTimeout(resolve, 2))
    const partial = updateTicket(root, original.key, { title: '  Updated  ', status: 'in_progress' })
    assert.equal(partial.title, 'Updated')
    assert.equal(partial.status, 'in_progress')
    assert.equal(partial.description, original.description)
    assert.equal(partial.priority, original.priority)
    assert.equal(partial.assignee, original.assignee)
    assert.equal(partial.id, original.id)
    assert.equal(partial.key, original.key)
    assert.equal(partial.created_at, original.created_at)
    assert.notEqual(partial.updated_at, original.updated_at)

    const updated = updateTicket(root, original.id, {
      title: 'Everything', description: 'Changed', status: 'done', priority: 'urgent', assignee: null,
    })
    assert.deepEqual(getTicket(root, original.key), updated)
    assert.deepEqual(JSON.parse(await readFile(join(root, 'tickets.json'), 'utf8')), [updated])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects invalid updates without writing or resurrecting tickets', async () => {
  const root = await directory()
  try {
    const ticket = createTicket(root, { title: 'Unchanged' })
    const file = join(root, 'tickets.json')
    const before = await readFile(file, 'utf8')
    for (const changes of [
      null, {}, { id: 'replacement' }, { key: 'KAN-9' }, { created_at: new Date().toISOString() },
      { updated_at: new Date().toISOString() }, { deleted_at: null }, { status: 'closed' },
      { priority: 'normal' }, { assignee: 1 }, { title: ' ' }, { description: null },
    ]) {
      assert.throws(() => updateTicket(root, ticket.id, changes), /INVALID_TICKET/)
      assert.equal(await readFile(file, 'utf8'), before)
    }
    assert.throws(() => updateTicket(root, 'KAN-404', { title: 'Missing' }), /TICKET_NOT_FOUND/)
    assert.equal(await readFile(file, 'utf8'), before)

    deleteTicket(root, ticket.id)
    const deleted = await readFile(file, 'utf8')
    assert.throws(() => updateTicket(root, ticket.key, { title: 'Resurrected' }), /TICKET_NOT_FOUND/)
    assert.equal(await readFile(file, 'utf8'), deleted)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('persists comments and replies while edits and deletion preserve them', async () => {
  const root = await directory()
  try {
    const ticket = createTicket(root, { title: 'Discuss me' })
    const other = createTicket(root, { title: 'Other ticket' })
    const commented = addComment(root, ticket.key, { author: '  Taylor  ', body: '  First note  ' })
    const first = commented.comments![0]
    assert.equal(first.author, 'Taylor')
    assert.equal(first.body, 'First note')
    const replied = addComment(root, ticket.id, { author: 'Sam', body: 'Reply', parent_id: first.id })
    const reply = replied.comments![1]
    const nested = addComment(root, ticket.key, { author: 'Taylor', body: 'Nested', parent_id: reply.id })
    assert.deepEqual(nested.comments?.map(({ parent_id }) => parent_id), [undefined, first.id, reply.id])

    const file = join(root, 'tickets.json')
    const beforeInvalid = await readFile(file, 'utf8')
    for (const input of [null, {}, { author: '', body: 'Note' }, { author: 'Sam', body: ' ' }, { author: 'Sam', body: 'Note', extra: true }]) {
      assert.throws(() => addComment(root, ticket.id, input), /INVALID_COMMENT/)
      assert.equal(await readFile(file, 'utf8'), beforeInvalid)
    }
    assert.throws(() => addComment(root, other.id, { author: 'Sam', body: 'Wrong ticket', parent_id: first.id }), /COMMENT_NOT_FOUND/)
    assert.equal(await readFile(file, 'utf8'), beforeInvalid)

    const edited = updateTicket(root, ticket.id, { status: 'done' })
    assert.deepEqual(edited.comments, nested.comments)
    const deleted = deleteTicket(root, ticket.id)
    assert.deepEqual(deleted.comments, nested.comments)
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).find(({ id }: { id: string }) => id === ticket.id), deleted)
    assert.throws(() => addComment(root, ticket.id, { author: 'Sam', body: 'Too late' }), /TICKET_NOT_FOUND/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects invalid inputs', async () => {
  const root = await directory()
  try {
    for (const input of [
      null,
      {},
      { title: ' ' },
      { title: 'Ticket', extra: true },
      { title: 'Ticket', description: 1 },
      { title: 'Ticket', status: 'closed' },
      { title: 'Ticket', priority: 'normal' },
      { title: 'Ticket', assignee: 1 },
    ]) {
      assert.throws(() => createTicket(root, input), /INVALID_TICKET/)
    }
    assert.throws(() => getTicket(root, null), /INVALID_TICKET_ID/)
    assert.throws(() => getTicket(root, 'KAN-404'), /TICKET_NOT_FOUND/)
    assert.throws(() => deleteTicket(root, null), /INVALID_TICKET_ID/)
    assert.deepEqual(listTickets(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('fails closed without overwriting a malformed store', async () => {
  const root = await directory()
  const file = join(root, 'tickets.json')
  try {
    await writeFile(file, '{broken')
    assert.throws(() => listTickets(root), /INVALID_TICKET_STORE/)
    assert.throws(() => createTicket(root, { title: 'Must not overwrite' }), /INVALID_TICKET_STORE/)
    assert.equal(await readFile(file, 'utf8'), '{broken')

    await writeFile(file, JSON.stringify([{ id: 'not-a-ticket' }]))
    assert.throws(() => createTicket(root, { title: 'Still must not overwrite' }), /INVALID_TICKET_STORE/)
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), [{ id: 'not-a-ticket' }])

    await writeFile(file, '[]')
    const ticket = createTicket(root, { title: 'Duplicate' })
    await writeFile(file, JSON.stringify([ticket, ticket]))
    assert.throws(() => listTickets(root), /INVALID_TICKET_STORE/)

    for (const comments of [
      [{ id: crypto.randomUUID(), author: 'Sam', body: 'Note', created_at: new Date().toISOString(), extra: true }],
      [{ id: crypto.randomUUID(), author: 'Sam', body: 'Note', created_at: 'not-a-date' }],
      [{ id: crypto.randomUUID(), author: 'Sam', body: 'Reply', created_at: new Date().toISOString(), parent_id: crypto.randomUUID() }],
    ]) {
      await writeFile(file, JSON.stringify([{ ...ticket, comments }]))
      assert.throws(() => listTickets(root), /INVALID_TICKET_STORE/)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const statuses = ['backlog', 'todo', 'in_progress', 'in_review', 'done'] as const
const priorities = ['low', 'medium', 'high', 'urgent'] as const

export const createTicketSchema = {
  type: 'object' as const,
  properties: {
    title: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    status: { type: 'string', enum: [...statuses] },
    priority: { type: 'string', enum: [...priorities] },
    assignee: { type: ['string', 'null'] },
  },
  required: ['title'],
  additionalProperties: false,
}

export const updateTicketSchema = {
  type: 'object' as const,
  properties: createTicketSchema.properties,
  additionalProperties: false,
  minProperties: 1,
}

export const addCommentSchema = {
  type: 'object' as const,
  properties: {
    author: { type: 'string', minLength: 1 },
    body: { type: 'string', minLength: 1 },
    parent_id: { type: 'string', format: 'uuid' },
  },
  required: ['author', 'body'],
  additionalProperties: false,
}

export const ticketCommentSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'string', format: 'uuid' },
    ...addCommentSchema.properties,
    created_at: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'author', 'body', 'created_at'],
  additionalProperties: false,
}

export const ticketSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'string', format: 'uuid' },
    key: { type: 'string', pattern: '^KAN-[1-9][0-9]*$' },
    ...createTicketSchema.properties,
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
    deleted_at: { type: 'string', format: 'date-time' },
    comments: { type: 'array', items: ticketCommentSchema },
  },
  required: ['id', 'key', 'title', 'description', 'status', 'priority', 'assignee', 'created_at', 'updated_at'],
  additionalProperties: false,
}

export type TicketComment = {
  id: string
  author: string
  body: string
  created_at: string
  parent_id?: string
}

export type Ticket = {
  id: string
  key: string
  title: string
  description: string
  status: typeof statuses[number]
  priority: typeof priorities[number]
  assignee: string | null
  created_at: string
  updated_at: string
  deleted_at?: string
  comments?: TicketComment[]
}

type EditableTicket = Pick<Ticket, 'title' | 'description' | 'status' | 'priority' | 'assignee'>

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validComments(value: unknown): boolean {
  if (value === undefined) return true
  if (!Array.isArray(value)) return false
  const seen = new Set<string>()
  return value.every((comment) => {
    if (!object(comment)
      || !Object.keys(comment).every((key) => Object.hasOwn(ticketCommentSchema.properties, key))
      || !ticketCommentSchema.required.every((key) => Object.hasOwn(comment, key))
      || typeof comment.id !== 'string' || !uuid.test(comment.id) || seen.has(comment.id)
      || typeof comment.author !== 'string' || !comment.author.length || comment.author.trim() !== comment.author
      || typeof comment.body !== 'string' || !comment.body.length || comment.body.trim() !== comment.body
      || typeof comment.created_at !== 'string' || Number.isNaN(Date.parse(comment.created_at))
      || (comment.parent_id !== undefined && (typeof comment.parent_id !== 'string' || !seen.has(comment.parent_id)))) return false
    seen.add(comment.id)
    return true
  })
}

function validTicket(value: unknown): value is Ticket {
  if (!object(value)) return false
  const keys = Object.keys(value)
  return keys.every((key) => Object.hasOwn(ticketSchema.properties, key))
    && ticketSchema.required.every((key) => keys.includes(key))
    && typeof value.id === 'string'
    && uuid.test(value.id)
    && typeof value.key === 'string' && /^KAN-[1-9][0-9]*$/.test(value.key)
    && typeof value.title === 'string' && value.title.trim() === value.title && value.title.length > 0
    && typeof value.description === 'string'
    && statuses.includes(value.status as Ticket['status'])
    && priorities.includes(value.priority as Ticket['priority'])
    && (typeof value.assignee === 'string' || value.assignee === null)
    && typeof value.created_at === 'string' && !Number.isNaN(Date.parse(value.created_at))
    && typeof value.updated_at === 'string' && !Number.isNaN(Date.parse(value.updated_at))
    && (value.deleted_at === undefined
      || typeof value.deleted_at === 'string' && !Number.isNaN(Date.parse(value.deleted_at)))
    && validComments(value.comments)
}

function writeTickets(directory: string, tickets: Ticket[]) {
  mkdirSync(directory, { recursive: true })
  const file = join(directory, 'tickets.json')
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(tickets, null, 2)}\n`)
  renameSync(temporary, file)
}

function readTickets(directory: string): Ticket[] {
  let raw: string
  try {
    raw = readFileSync(join(directory, 'tickets.json'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('INVALID_TICKET_STORE: tickets.json is not valid JSON')
  }
  if (!Array.isArray(value) || !value.every(validTicket)
    || new Set(value.map(({ id }) => id)).size !== value.length
    || new Set(value.map(({ key }) => key)).size !== value.length) {
    throw new Error('INVALID_TICKET_STORE: tickets.json must contain valid tickets')
  }
  return value
}

function parseCreateTicket(input: unknown) {
  if (!object(input)) throw new Error('INVALID_TICKET: expected an object')
  const allowed = new Set(Object.keys(createTicketSchema.properties))
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new Error('INVALID_TICKET: unexpected field')
  }
  if (typeof input.title !== 'string' || !input.title.trim()) {
    throw new Error('INVALID_TICKET: title must be a non-empty string')
  }
  if (input.description !== undefined && typeof input.description !== 'string') {
    throw new Error('INVALID_TICKET: description must be a string')
  }
  if (input.status !== undefined && !statuses.includes(input.status as Ticket['status'])) {
    throw new Error('INVALID_TICKET: invalid status')
  }
  if (input.priority !== undefined && !priorities.includes(input.priority as Ticket['priority'])) {
    throw new Error('INVALID_TICKET: invalid priority')
  }
  if (input.assignee !== undefined && input.assignee !== null && typeof input.assignee !== 'string') {
    throw new Error('INVALID_TICKET: assignee must be a string or null')
  }
  return {
    title: input.title.trim(),
    description: input.description ?? '',
    status: input.status ?? 'backlog',
    priority: input.priority ?? 'medium',
    assignee: input.assignee ?? null,
  } as EditableTicket
}

function parseTicketChanges(input: unknown): Partial<EditableTicket> {
  if (!object(input) || Object.keys(input).length === 0) {
    throw new Error('INVALID_TICKET: changes must be a non-empty object')
  }
  const parsed = parseCreateTicket({ title: '_', ...input })
  return Object.fromEntries(Object.keys(input).map((key) => [key, parsed[key as keyof EditableTicket]]))
}

function parseComment(input: unknown): Pick<TicketComment, 'author' | 'body' | 'parent_id'> {
  if (!object(input)
    || Object.keys(input).some((key) => !Object.hasOwn(addCommentSchema.properties, key))
    || typeof input.author !== 'string' || !input.author.trim()
    || typeof input.body !== 'string' || !input.body.trim()
    || (input.parent_id !== undefined && typeof input.parent_id !== 'string')) {
    throw new Error('INVALID_COMMENT: expected non-empty author and body with an optional parent_id')
  }
  return { author: input.author.trim(), body: input.body.trim(), ...(input.parent_id === undefined ? {} : { parent_id: input.parent_id }) }
}

export function createTicket(directory: string, input: unknown): Ticket {
  const tickets = readTickets(directory)
  const now = new Date().toISOString()
  const ticket: Ticket = {
    id: randomUUID(),
    key: `KAN-${tickets.reduce((max, item) => Math.max(max, Number(item.key.slice(4))), 0) + 1}`,
    ...parseCreateTicket(input),
    created_at: now,
    updated_at: now,
  }
  writeTickets(directory, [...tickets, ticket])
  return ticket
}

export function listTickets(directory: string): Ticket[] {
  return readTickets(directory).filter((ticket) => !ticket.deleted_at)
}

export function getTicket(directory: string, id: unknown): Ticket {
  if (typeof id !== 'string' || !id.trim()) throw new Error('INVALID_TICKET_ID: expected a non-empty string')
  const ticket = readTickets(directory).find((item) => !item.deleted_at && (item.id === id || item.key === id))
  if (!ticket) throw new Error(`TICKET_NOT_FOUND: ${id}`)
  return ticket
}

export function updateTicket(directory: string, id: unknown, input: unknown): Ticket {
  if (typeof id !== 'string' || !id.trim()) throw new Error('INVALID_TICKET_ID: expected a non-empty string')
  const changes = parseTicketChanges(input)
  const tickets = readTickets(directory)
  const index = tickets.findIndex((item) => !item.deleted_at && (item.id === id || item.key === id))
  if (index === -1) throw new Error(`TICKET_NOT_FOUND: ${id}`)
  const ticket = { ...tickets[index], ...changes, updated_at: new Date().toISOString() }
  tickets[index] = ticket
  writeTickets(directory, tickets)
  return ticket
}

export function addComment(directory: string, id: unknown, input: unknown): Ticket {
  if (typeof id !== 'string' || !id.trim()) throw new Error('INVALID_TICKET_ID: expected a non-empty string')
  const parsed = parseComment(input)
  const tickets = readTickets(directory)
  const index = tickets.findIndex((item) => !item.deleted_at && (item.id === id || item.key === id))
  if (index === -1) throw new Error(`TICKET_NOT_FOUND: ${id}`)
  const comments = tickets[index].comments ?? []
  if (parsed.parent_id !== undefined && !comments.some((comment) => comment.id === parsed.parent_id)) {
    throw new Error(`COMMENT_NOT_FOUND: ${parsed.parent_id}`)
  }
  const now = new Date().toISOString()
  const ticket = {
    ...tickets[index],
    comments: [...comments, { id: randomUUID(), ...parsed, created_at: now }],
    updated_at: now,
  }
  tickets[index] = ticket
  writeTickets(directory, tickets)
  return ticket
}

export function deleteTicket(directory: string, id: unknown): Ticket {
  if (typeof id !== 'string' || !id.trim()) throw new Error('INVALID_TICKET_ID: expected a non-empty string')
  const tickets = readTickets(directory)
  const index = tickets.findIndex((item) => !item.deleted_at && (item.id === id || item.key === id))
  if (index === -1) throw new Error(`TICKET_NOT_FOUND: ${id}`)
  const deletedAt = new Date().toISOString()
  const ticket = { ...tickets[index], updated_at: deletedAt, deleted_at: deletedAt }
  tickets[index] = ticket
  writeTickets(directory, tickets)
  return ticket
}

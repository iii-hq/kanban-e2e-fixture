import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Ticket } from './tickets.js'

type ConfigurationInfo = {
  data_dir: string
  resolved_data_dir: string
}

type HttpOptions = {
  uiDirectory: string
  getEventStore: () => string
  subscribeEvents: (listener: (store: string) => void) => () => void
  getConfiguration: () => Promise<ConfigurationInfo>
  setDataDirectory: (dataDirectory: string) => Promise<ConfigurationInfo>
  getTickets: () => Promise<{ tickets: Ticket[] }>
  createTicket: (input: unknown) => Promise<Ticket>
  getTicket: (id: string) => Promise<Ticket>
  updateTicket: (id: string, input: unknown) => Promise<Ticket>
  deleteTicket: (id: string) => Promise<Ticket>
  addComment: (id: string, input: unknown) => Promise<Ticket>
}

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/page.js', ['page.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
])

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  request.setEncoding('utf8')
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > 65_536) throw new Error('REQUEST_TOO_LARGE')
  }
  try {
    return JSON.parse(body)
  } catch {
    throw new Error('INVALID_JSON')
  }
}

function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('REQUEST_TOO_LARGE')) return 413
  if (error instanceof URIError || message.includes('INVALID_JSON') || /INVALID_(?:TICKET(?:_ID)?|COMMENT):/.test(message)) return 400
  if (/(?:TICKET|COMMENT)_NOT_FOUND/.test(message)) return 404
  return 500
}

export function createKanbanServer(options: HttpOptions): Server {
  const clients = new Set<() => void>()
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')

      if (request.method === 'GET' && url.pathname === '/api/events') {
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        })
        let closed = false
        let heartbeat: NodeJS.Timeout | undefined
        let unsubscribe = () => {}
        const cleanup = () => {
          if (closed) return
          closed = true
          if (heartbeat) clearInterval(heartbeat)
          unsubscribe()
          clients.delete(cleanup)
        }
        const send = (store: string) => {
          if (!closed && !response.write(`event: change\ndata: ${JSON.stringify({ store })}\n\n`)) {
            cleanup()
            response.destroy()
          }
        }
        unsubscribe = options.subscribeEvents(send)
        clients.add(cleanup)
        request.once('close', cleanup)
        response.once('close', cleanup)
        response.once('error', cleanup)
        send(options.getEventStore())
        if (!closed) {
          heartbeat = setInterval(() => {
            if (!response.write(': heartbeat\n\n')) {
              cleanup()
              response.destroy()
            }
          }, 15_000)
          heartbeat.unref()
        }
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/tickets') {
        json(response, 200, await options.getTickets())
        return
      }

      if (request.method === 'POST' && url.pathname === '/api/tickets') {
        if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
          json(response, 415, { error: 'UNSUPPORTED_MEDIA_TYPE' })
          return
        }
        json(response, 201, { ticket: await options.createTicket(await readJson(request)) })
        return
      }

      const commentRoute = url.pathname.match(/^\/api\/tickets\/([^/]+)\/comments$/)
      if (commentRoute && request.method === 'POST') {
        if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
          json(response, 415, { error: 'UNSUPPORTED_MEDIA_TYPE' })
          return
        }
        json(response, 201, { ticket: await options.addComment(decodeURIComponent(commentRoute[1]), await readJson(request)) })
        return
      }

      const ticketRoute = url.pathname.match(/^\/api\/tickets\/([^/]+)$/)
      if (ticketRoute && request.method === 'PATCH') {
        if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
          json(response, 415, { error: 'UNSUPPORTED_MEDIA_TYPE' })
          return
        }
        json(response, 200, { ticket: await options.updateTicket(decodeURIComponent(ticketRoute[1]), await readJson(request)) })
        return
      }
      if (ticketRoute && (request.method === 'GET' || request.method === 'DELETE')) {
        const id = decodeURIComponent(ticketRoute[1])
        const ticket = request.method === 'GET'
          ? await options.getTicket(id)
          : await options.deleteTicket(id)
        json(response, 200, { ticket })
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/config') {
        json(response, 200, await options.getConfiguration())
        return
      }

      if (request.method === 'PUT' && url.pathname === '/api/config') {
        const input = await readJson(request)
        const dataDirectory = input && typeof input === 'object' && !Array.isArray(input)
          ? (input as Record<string, unknown>).data_dir
          : undefined
        if (typeof dataDirectory !== 'string' || !dataDirectory.trim()) {
          json(response, 400, { error: 'INVALID_DATA_DIRECTORY' })
          return
        }

        json(response, 200, await options.setDataDirectory(dataDirectory))
        return
      }

      const asset = request.method === 'GET' ? assets.get(url.pathname) : undefined
      if (asset) {
        const [file, contentType] = asset
        const content = await readFile(join(options.uiDirectory, file))
        response.writeHead(200, { 'content-type': contentType })
        response.end(content)
        return
      }

      json(response, 404, { error: 'NOT_FOUND' })
    } catch (error) {
      json(response, errorStatus(error), { error: error instanceof Error ? error.message : String(error) })
    }
  })
  server.on('close', () => {
    for (const cleanup of clients) cleanup()
  })
  return server
}

export async function startKanbanServer(options: HttpOptions, port: number): Promise<Server> {
  const server = createKanbanServer(options)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return server
}

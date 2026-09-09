import { readFile } from 'node:fs/promises'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Ticket } from './tickets.js'

type ConfigurationInfo = {
  data_dir: string
  resolved_data_dir: string
}

type HttpOptions = {
  uiDirectory: string
  getConfiguration: () => Promise<ConfigurationInfo>
  setDataDirectory: (dataDirectory: string) => Promise<ConfigurationInfo>
  getTickets: () => Promise<{ tickets: Ticket[] }>
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

export function createKanbanServer(options: HttpOptions): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')

      if (request.method === 'GET' && url.pathname === '/api/tickets') {
        json(response, 200, await options.getTickets())
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/config') {
        json(response, 200, await options.getConfiguration())
        return
      }

      if (request.method === 'PUT' && url.pathname === '/api/config') {
        let body = ''
        for await (const chunk of request) {
          body += chunk
          if (body.length > 65_536) {
            json(response, 413, { error: 'REQUEST_TOO_LARGE' })
            return
          }
        }

        let input: unknown
        try {
          input = JSON.parse(body)
        } catch {
          json(response, 400, { error: 'INVALID_JSON' })
          return
        }
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
      json(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  })
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

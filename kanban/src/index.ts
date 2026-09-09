import { fileURLToPath } from 'node:url'
import { registerWorker } from 'iii-sdk'
import {
  CONFIGURATION_ID,
  DEFAULT_CONFIGURATION,
  parseConfiguration,
  projectRoot,
  resolveDataDirectory,
  type KanbanConfiguration,
} from './config.js'
import { startKanbanServer } from './http.js'
import { addComment, addCommentSchema, createTicket, createTicketSchema, deleteTicket, getTicket, listTickets, ticketSchema, updateTicket, updateTicketSchema } from './tickets.js'

const WORKER = 'kanban'
const CONFIG_RELOAD_FUNCTION = 'kanban::config::reload'
const workerDirectory = fileURLToPath(new URL('..', import.meta.url))
const root = projectRoot(workerDirectory)
const uiDirectory = fileURLToPath(new URL('./ui', import.meta.url))
const iii = registerWorker(process.env.III_ENGINE_URL ?? process.env.III_URL, {
  workerName: WORKER,
  workerDescription: 'A reactive iii Kanban application.',
})

let configuration = DEFAULT_CONFIGURATION
let dataDirectory = resolveDataDirectory(configuration, root)

async function configurationCall<T>(functionId: string, payload: Record<string, unknown>): Promise<T> {
  return iii.trigger({ function_id: functionId, namespace: 'default', payload, timeoutMs: 10_000 }) as Promise<T>
}

function isMissingConfiguration(error: unknown): boolean {
  return /not registered|not found/i.test(String(error))
}

async function storedConfiguration(): Promise<KanbanConfiguration | null> {
  try {
    const response = await configurationCall<{ value?: unknown }>('configuration::get', {
      id: CONFIGURATION_ID,
      raw: false,
    })
    return response.value == null ? null : parseConfiguration(response.value)
  } catch (error) {
    if (isMissingConfiguration(error)) return null
    throw error
  }
}

async function rawConfiguration(): Promise<Record<string, unknown> | null> {
  try {
    const response = await configurationCall<{ value?: unknown }>('configuration::get', {
      id: CONFIGURATION_ID,
      raw: true,
    })
    if (response.value == null) return null
    parseConfiguration(response.value)
    return response.value as Record<string, unknown>
  } catch (error) {
    if (isMissingConfiguration(error)) return null
    throw error
  }
}

async function reloadConfiguration(): Promise<{ data_dir: string; resolved_data_dir: string }> {
  const stored = await storedConfiguration()
  if (!stored) throw new Error('CONFIGURATION_NOT_FOUND: kanban is not registered')
  configuration = stored
  dataDirectory = resolveDataDirectory(configuration, root)
  return { data_dir: configuration.data_dir, resolved_data_dir: dataDirectory }
}

async function initializeConfiguration(): Promise<void> {
  const current = await storedConfiguration()
  await configurationCall('configuration::register', {
    id: CONFIGURATION_ID,
    name: 'Kanban',
    description: 'Configures the directory where Kanban ticket data is stored.',
    schema: {
      type: 'object',
      properties: { data_dir: { type: 'string', minLength: 1 } },
      required: ['data_dir'],
      additionalProperties: true,
    },
    ...(current ? {} : { initial_value: DEFAULT_CONFIGURATION }),
  })
  await reloadConfiguration()
}

async function configurationInfo(): Promise<{ data_dir: string; resolved_data_dir: string }> {
  const raw = await rawConfiguration()
  if (!raw) throw new Error('CONFIGURATION_NOT_FOUND: kanban is not registered')
  return { data_dir: parseConfiguration(raw).data_dir, resolved_data_dir: dataDirectory }
}

async function setDataDirectory(nextDataDirectory: string) {
  const current = await rawConfiguration()
  if (!current) throw new Error('CONFIGURATION_NOT_FOUND: kanban is not registered')
  await configurationCall('configuration::set', {
    id: CONFIGURATION_ID,
    value: { ...current, data_dir: nextDataDirectory },
  })
  await reloadConfiguration()
  return configurationInfo()
}

iii.registerFunction(
  CONFIG_RELOAD_FUNCTION,
  async () => reloadConfiguration(),
  {
    description: 'Reload Kanban configuration after it changes.',
    metadata: { internal: true },
    request_format: { type: 'object', properties: {} },
    response_format: {
      type: 'object',
      properties: {
        data_dir: { type: 'string' },
        resolved_data_dir: { type: 'string' },
      },
      required: ['data_dir', 'resolved_data_dir'],
    },
  },
)

iii.registerFunction(
  'kanban::config::info',
  async () => configurationInfo(),
  {
    description: 'Return the configured and resolved Kanban data directory.',
    request_format: { type: 'object', properties: {} },
    response_format: {
      type: 'object',
      properties: {
        data_dir: { type: 'string' },
        resolved_data_dir: { type: 'string' },
      },
      required: ['data_dir', 'resolved_data_dir'],
    },
  },
)

iii.registerTrigger({
  type: 'configuration',
  function_id: CONFIG_RELOAD_FUNCTION,
  config: { configuration_id: CONFIGURATION_ID, event_types: ['configuration:updated'] },
})

await initializeConfiguration()

iii.registerFunction('kanban::tickets::create', async (payload: unknown) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return createTicket(dataDirectory, payload)
  const { _caller_worker_id, ...input } = payload as Record<string, unknown>
  return createTicket(dataDirectory, input)
}, {
  description: 'Create and persist a ticket with a UUID and a human-readable KAN-number key.',
  request_format: createTicketSchema,
  response_format: ticketSchema,
})
iii.registerFunction('kanban::tickets::list', async () => ({ tickets: listTickets(dataDirectory) }), {
  description: 'List tickets from the configured data directory in creation order.',
  request_format: { type: 'object', properties: {} },
  response_format: {
    type: 'object',
    properties: { tickets: { type: 'array', items: ticketSchema } },
    required: ['tickets'],
  },
})
iii.registerFunction('kanban::tickets::get', async ({ id }: { id: unknown }) => getTicket(dataDirectory, id), {
  description: 'Get a persisted ticket by its internal UUID or human-readable key, such as KAN-1.',
  request_format: { type: 'object', properties: { id: { type: 'string', minLength: 1 } }, required: ['id'] },
  response_format: ticketSchema,
})
iii.registerFunction('kanban::tickets::update', async (payload: unknown) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('INVALID_TICKET: expected an update envelope')
  }
  const { id, changes } = payload as { id: unknown; changes: unknown }
  return updateTicket(dataDirectory, id, changes)
}, {
  description: 'Update editable fields on a persisted ticket by its UUID or human-readable key.',
  request_format: {
    type: 'object',
    properties: { id: { type: 'string', minLength: 1 }, changes: updateTicketSchema },
    required: ['id', 'changes'],
    additionalProperties: false,
  },
  response_format: ticketSchema,
})
iii.registerFunction('kanban::tickets::delete', async ({ id }: { id: unknown }) => deleteTicket(dataDirectory, id), {
  description: 'Soft-delete a persisted ticket by its internal UUID or human-readable key.',
  request_format: { type: 'object', properties: { id: { type: 'string', minLength: 1 } }, required: ['id'] },
  response_format: ticketSchema,
})
iii.registerFunction('kanban::tickets::comment', async (payload: unknown) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('INVALID_COMMENT: expected a comment envelope')
  }
  const { id, comment } = payload as { id: unknown; comment: unknown }
  return addComment(dataDirectory, id, comment)
}, {
  description: 'Add a comment or reply to a persisted ticket.',
  request_format: {
    type: 'object',
    properties: { id: { type: 'string', minLength: 1 }, comment: addCommentSchema },
    required: ['id', 'comment'],
    additionalProperties: false,
  },
  response_format: ticketSchema,
})

const server = await startKanbanServer(
  {
    uiDirectory,
    getConfiguration: configurationInfo,
    setDataDirectory,
    getTickets: () => iii.trigger({ function_id: 'kanban::tickets::list', payload: {}, timeoutMs: 10_000 }),
    createTicket: (input) => iii.trigger({ function_id: 'kanban::tickets::create', payload: input, timeoutMs: 10_000 }),
    getTicket: (id) => iii.trigger({ function_id: 'kanban::tickets::get', payload: { id }, timeoutMs: 10_000 }),
    updateTicket: (id, input) => iii.trigger({ function_id: 'kanban::tickets::update', payload: { id, changes: input }, timeoutMs: 10_000 }),
    deleteTicket: (id) => iii.trigger({ function_id: 'kanban::tickets::delete', payload: { id }, timeoutMs: 10_000 }),
    addComment: (id, input) => iii.trigger({ function_id: 'kanban::tickets::comment', payload: { id, comment: input }, timeoutMs: 10_000 }),
  },
  Number(process.env.PORT ?? 3000),
)

const shutdown = async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  await iii.shutdown()
  process.exit(0)
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

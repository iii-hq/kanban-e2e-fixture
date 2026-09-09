import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

export const CONFIGURATION_ID = 'kanban'

export type KanbanConfiguration = {
  data_dir: string
}

export const DEFAULT_CONFIGURATION: KanbanConfiguration = {
  data_dir: './data',
}

export function parseConfiguration(value: unknown): KanbanConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_CONFIGURATION: expected an object')
  }
  const dataDir = (value as Record<string, unknown>).data_dir
  if (typeof dataDir !== 'string' || !dataDir.trim()) {
    throw new Error('INVALID_CONFIGURATION: data_dir must be a non-empty string')
  }
  return { data_dir: dataDir }
}

export function projectRoot(workerDirectory: string): string {
  let candidate = resolve(workerDirectory, '..')
  while (!existsSync(resolve(candidate, 'worker-compose.yaml'))) {
    const parent = resolve(candidate, '..')
    if (parent === candidate) throw new Error('PROJECT_ROOT_NOT_FOUND: worker-compose.yaml is required')
    candidate = parent
  }
  return candidate
}

export function resolveDataDirectory(configuration: KanbanConfiguration, root: string): string {
  return isAbsolute(configuration.data_dir)
    ? configuration.data_dir
    : resolve(root, configuration.data_dir)
}

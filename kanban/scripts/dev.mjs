import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const node = process.execPath
const tsc = resolve('node_modules/typescript/bin/tsc')
const children = new Set()
let shuttingDown = false

function spawnNode(args) {
  const child = spawn(node, args, { env: process.env, stdio: 'inherit' })
  children.add(child)
  child.once('exit', () => children.delete(child))
  return child
}

async function runOnce(label, args) {
  console.log(`[dev] ${label}`)
  const child = spawnNode(args)
  const result = await new Promise((resolveResult, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolveResult({ code, signal }))
  })
  if (result.code !== 0) throw new Error(`${label} failed (${result.signal ?? `exit ${result.code}`})`)
}

function watch(label, args) {
  console.log(`[dev] watching ${label}`)
  const child = spawnNode(args)
  child.once('error', (error) => {
    if (!shuttingDown) {
      console.error(`[dev] ${label} failed to start:`, error)
      shutdown(1)
    }
  })
  child.once('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`[dev] ${label} stopped (${signal ?? `exit ${code}`})`)
      shutdown(code || 1)
    }
  })
}

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) child.kill('SIGTERM')
  setTimeout(() => {
    for (const child of children) child.kill('SIGKILL')
    process.exit(code)
  }, 1_500)
}

process.once('SIGINT', () => shutdown(0))
process.once('SIGTERM', () => shutdown(0))

try {
  await runOnce('building backend', [tsc, '-p', 'tsconfig.json'])
  await runOnce('checking UI types', [tsc, '-p', 'ui/tsconfig.json', '--noEmit'])
  await runOnce('building UI', ['ui/build.mjs'])
  watch('backend TypeScript', [tsc, '-p', 'tsconfig.json', '--watch', '--preserveWatchOutput'])
  watch('UI TypeScript', [tsc, '-p', 'ui/tsconfig.json', '--noEmit', '--watch', '--preserveWatchOutput'])
  watch('UI bundle', ['ui/build.mjs', '--watch'])
  watch('kanban worker', ['--watch', '--watch-path=dist', '--watch-preserve-output', 'dist/index.js'])
} catch (error) {
  console.error('[dev]', error instanceof Error ? error.message : error)
  shutdown(1)
}

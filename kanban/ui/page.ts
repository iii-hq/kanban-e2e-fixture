import type { Ticket } from '../src/tickets.js'

const form = document.querySelector<HTMLFormElement>('#settings')!
const input = document.querySelector<HTMLInputElement>('#data-dir')!
const save = document.querySelector<HTMLButtonElement>('#save')!
const retry = document.querySelector<HTMLButtonElement>('#retry')!
const status = document.querySelector<HTMLElement>('#status')!
const resolved = document.querySelector<HTMLOutputElement>('#resolved-path')!
let configRequest = 0
let saving = false

async function request(method: 'GET' | 'PUT') {
  const current = ++configRequest
  saving = method === 'PUT'
  form.setAttribute('aria-busy', 'true')
  save.disabled = true
  input.disabled = true
  retry.hidden = true
  status.textContent = method === 'GET' ? 'Loading settings…' : 'Saving…'
  try {
    const response = await fetch('/api/config', method === 'PUT' ? {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_dir: input.value }),
    } : {})
    if (!response.ok) throw new Error(`Unable to ${method === 'GET' ? 'load' : 'save'} settings (${response.status}).`)
    const config = await response.json()
    if (method === 'PUT' && !boardView.hidden) void loadBoard()
    if (current !== configRequest) return
    input.value = config.data_dir
    resolved.textContent = config.resolved_data_dir
    status.textContent = method === 'PUT' ? 'Settings saved.' : ''
  } catch (error) {
    if (current !== configRequest) return
    status.textContent = error instanceof Error ? error.message : 'Unable to reach the application.'
    retry.hidden = false
  } finally {
    if (method === 'PUT') saving = false
    if (current === configRequest) {
      form.setAttribute('aria-busy', 'false')
      input.disabled = false
      save.disabled = !input.value.trim()
    }
  }
}

input.addEventListener('input', () => { save.disabled = !input.value.trim() })
form.addEventListener('submit', (event) => {
  event.preventDefault()
  void request('PUT')
})
retry.addEventListener('click', () => { void request('GET') })
function showView() {
  const settings = location.hash === '#settings'
  boardView.hidden = settings
  settingsView.hidden = !settings
  document.title = `Kanban · ${settings ? 'Settings' : 'Board'}`
  document.querySelector(settings ? '#board-link' : '#settings-link')!.removeAttribute('aria-current')
  document.querySelector(settings ? '#settings-link' : '#board-link')!.setAttribute('aria-current', 'page')
  if (settings) {
    ++boardRequest
    if (!saving) void request('GET')
  } else {
    if (!saving) ++configRequest
    void loadBoard()
  }
}

const boardView = document.querySelector<HTMLElement>('#board-view')!
const settingsView = document.querySelector<HTMLElement>('#settings-view')!
const board = document.querySelector<HTMLElement>('#board')!
const boardStatus = document.querySelector<HTMLElement>('#board-status')!
const ticketCount = document.querySelector<HTMLElement>('#ticket-count')!
const refresh = document.querySelector<HTMLButtonElement>('#refresh')!
const boardRetry = document.querySelector<HTMLButtonElement>('#board-retry')!
const lanes = [
  ['backlog', 'Backlog'], ['todo', 'To do'], ['in_progress', 'In progress'],
  ['in_review', 'In review'], ['done', 'Done'],
] as const
let boardRequest = 0

function renderBoard(tickets: Ticket[] | null) {
  board.replaceChildren()
  for (const [status, label] of lanes) {
    const lane = document.createElement('section')
    lane.className = 'lane'
    lane.dataset.status = status
    lane.setAttribute('aria-labelledby', `lane-${status}`)
    const heading = document.createElement('h2')
    heading.id = `lane-${status}`
    heading.textContent = label
    const items = tickets?.filter((ticket) => ticket.status === status)
    const count = document.createElement('span')
    count.className = 'lane-count'
    count.textContent = items ? String(items.length) : '—'
    heading.append(count)
    lane.append(heading)
    for (const ticket of items ?? []) {
      const card = document.createElement('article')
      card.className = 'ticket'
      card.dataset.ticketId = ticket.id
      const key = document.createElement('p')
      key.className = 'ticket-key'
      key.textContent = ticket.key
      const title = document.createElement('h3')
      title.textContent = ticket.title
      const metadata = document.createElement('div')
      metadata.className = 'ticket-meta'
      const priority = document.createElement('span')
      priority.className = 'priority'
      priority.dataset.priority = ticket.priority
      priority.textContent = ticket.priority
      priority.setAttribute('aria-label', `${ticket.priority} priority`)
      const assignee = document.createElement('span')
      assignee.className = 'assignee'
      assignee.textContent = ticket.assignee ?? 'Unassigned'
      metadata.append(priority, assignee)
      card.append(key, title, metadata)
      lane.append(card)
    }
    if (items?.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'lane-empty'
      empty.textContent = 'No tickets'
      lane.append(empty)
    }
    board.append(lane)
  }
}

async function loadBoard() {
  const current = ++boardRequest
  board.setAttribute('aria-busy', 'true')
  refresh.disabled = true
  boardRetry.hidden = true
  boardStatus.textContent = 'Loading tickets…'
  ticketCount.textContent = '— tickets'
  renderBoard(null)
  try {
    const response = await fetch('/api/tickets')
    if (!response.ok) throw new Error(`Unable to load tickets (${response.status}).`)
    const { tickets }: { tickets: Ticket[] } = await response.json()
    if (current !== boardRequest) return
    renderBoard(tickets)
    ticketCount.textContent = `${tickets.length} ${tickets.length === 1 ? 'ticket' : 'tickets'}`
    boardStatus.textContent = tickets.length ? 'Board up to date.' : 'No tickets yet.'
  } catch (error) {
    if (current !== boardRequest) return
    boardStatus.textContent = error instanceof Error ? error.message : 'Unable to reach the application.'
    boardRetry.hidden = false
  } finally {
    if (current === boardRequest) {
      board.setAttribute('aria-busy', 'false')
      refresh.disabled = false
    }
  }
}

refresh.addEventListener('click', () => { void loadBoard() })
boardRetry.addEventListener('click', () => { void loadBoard() })
window.addEventListener('hashchange', showView)
showView()

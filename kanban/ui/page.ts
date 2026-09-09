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
    if (method === 'PUT' && !ticketView.hidden) void loadTicket()
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
  const leavingTicket = !ticketView.hidden
  const settings = location.hash === '#settings'
  const ticket = location.hash.startsWith('#ticket/')
  boardView.hidden = settings || ticket
  settingsView.hidden = !settings
  ticketView.hidden = !ticket
  ++detailRequest
  document.title = `Kanban · ${settings ? 'Settings' : ticket ? 'Ticket' : 'Board'}`
  document.querySelector(settings ? '#board-link' : '#settings-link')!.removeAttribute('aria-current')
  document.querySelector(settings ? '#settings-link' : '#board-link')!.setAttribute('aria-current', 'page')
  if (ticket) {
    ++boardRequest
    if (!saving) ++configRequest
    void loadTicket()
  } else if (settings) {
    ++boardRequest
    if (!saving) void request('GET')
  } else {
    if (!saving) ++configRequest
    void loadBoard()
    if (leavingTicket) document.querySelector<HTMLButtonElement>('#new-ticket')!.focus()
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
      const card = document.createElement('a')
      card.className = 'ticket'
      card.href = `#ticket/${ticket.id}`
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

const ticketView = document.querySelector<HTMLElement>('#ticket-view')!
const detailTitle = document.querySelector<HTMLElement>('#detail-title')!
const detailStatus = document.querySelector<HTMLElement>('#detail-status')!
const detailContent = document.querySelector<HTMLElement>('#detail-content')!
const detailRetry = document.querySelector<HTMLButtonElement>('#detail-retry')!
const deleteTicket = document.querySelector<HTMLButtonElement>('#delete-ticket')!
let detailRequest = 0
let selectedTicket: Ticket | undefined

async function loadTicket() {
  const current = ++detailRequest
  selectedTicket = undefined
  detailContent.hidden = true
  detailRetry.hidden = true
  detailTitle.textContent = 'Ticket'
  document.querySelector('#detail-key')!.textContent = ''
  detailStatus.textContent = 'Loading ticket…'
  ticketView.setAttribute('aria-busy', 'true')
  detailTitle.focus()
  try {
    const response = await fetch(`/api/tickets/${encodeURIComponent(decodeURIComponent(location.hash.slice(8)))}`)
    if (!response.ok) throw new Error(response.status === 404 ? 'Ticket not found.' : `Unable to load ticket (${response.status}).`)
    const { ticket }: { ticket: Ticket } = await response.json()
    if (current !== detailRequest) return
    selectedTicket = ticket
    document.title = `Kanban · ${ticket.key}`
    document.querySelector('#detail-key')!.textContent = ticket.key
    detailTitle.textContent = ticket.title
    document.querySelector('#detail-description')!.textContent = ticket.description || 'No description.'
    document.querySelector('#detail-ticket-status')!.textContent = lanes.find(([status]) => status === ticket.status)![1]
    document.querySelector('#detail-priority')!.textContent = ticket.priority
    document.querySelector('#detail-assignee')!.textContent = ticket.assignee ?? 'Unassigned'
    detailContent.hidden = false
    deleteTicket.disabled = false
    detailStatus.textContent = ''
  } catch (error) {
    if (current !== detailRequest) return
    detailStatus.textContent = error instanceof Error ? error.message : 'Unable to reach the application.'
    detailRetry.hidden = false
  } finally {
    if (current === detailRequest) ticketView.setAttribute('aria-busy', 'false')
  }
}

detailRetry.addEventListener('click', () => { void loadTicket() })
deleteTicket.addEventListener('click', async () => {
  if (!selectedTicket || deleteTicket.disabled) return
  const current = detailRequest
  deleteTicket.disabled = true
  detailStatus.textContent = 'Deleting ticket…'
  try {
    const response = await fetch(`/api/tickets/${encodeURIComponent(selectedTicket.id)}`, { method: 'DELETE' })
    if (!response.ok) throw new Error(`Unable to delete ticket (${response.status}).`)
    if (current === detailRequest) {
      location.hash = '#board'
    } else if (!boardView.hidden) {
      void loadBoard()
    }
  } catch (error) {
    if (current !== detailRequest) return
    detailStatus.textContent = error instanceof Error ? error.message : 'Unable to reach the application.'
    deleteTicket.disabled = false
  }
})

const createDialog = document.querySelector<HTMLDialogElement>('#create-dialog')!
const createForm = document.querySelector<HTMLFormElement>('#create-ticket')!
const createFields = document.querySelector<HTMLFieldSetElement>('#create-fields')!
const createStatus = document.querySelector<HTMLElement>('#create-status')!
document.querySelector('#new-ticket')!.addEventListener('click', () => {
  createForm.reset()
  createStatus.textContent = ''
  createDialog.showModal()
})
document.querySelector('#create-cancel')!.addEventListener('click', () => { createDialog.close() })
createDialog.addEventListener('cancel', (event) => { if (createFields.disabled) event.preventDefault() })
createForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (createFields.disabled) return
  const data = Object.fromEntries(new FormData(createForm))
  if (!String(data.title).trim()) {
    createStatus.textContent = 'Enter a title.'
    document.querySelector<HTMLInputElement>('#ticket-title')!.focus()
    return
  }
  createFields.disabled = true
  createForm.setAttribute('aria-busy', 'true')
  createStatus.textContent = 'Creating ticket…'
  try {
    const response = await fetch('/api/tickets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, assignee: String(data.assignee).trim() || null }),
    })
    if (!response.ok) throw new Error(`Unable to create ticket (${response.status}).`)
    const { ticket }: { ticket: Ticket } = await response.json()
    createDialog.close()
    location.hash = `#ticket/${ticket.id}`
  } catch (error) {
    createStatus.textContent = error instanceof Error ? error.message : 'Unable to reach the application.'
  } finally {
    createFields.disabled = false
    createForm.setAttribute('aria-busy', 'false')
  }
})

refresh.addEventListener('click', () => { void loadBoard() })
boardRetry.addEventListener('click', () => { void loadBoard() })
window.addEventListener('hashchange', showView)
showView()

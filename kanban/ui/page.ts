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
    if (method === 'PUT') void refreshLive()
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
  ++viewVersion
  ++commentRequest
  commentForm.reset()
  commentFields.disabled = false
  commentForm.setAttribute('aria-busy', 'false')
  commentStatus.textContent = ''
  resetReply()
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
let viewVersion = 0
let changeVersion = 0
let store = ''
let storeVersion = 0
let refreshPending = false
let refreshing = false

async function refreshLive() {
  refreshPending = true
  if (refreshing || draggedId || movingTicket) return
  refreshing = true
  try {
    while (refreshPending && !draggedId && !movingTicket) {
      refreshPending = false
      if (!boardView.hidden) await loadBoard(true)
      else if (!ticketView.hidden) await loadTicket(true)
    }
  } finally { refreshing = false }
}

function renderBoard(tickets: Ticket[] | null) {
  const focused = document.activeElement as HTMLElement | null
  const focusedId = focused?.closest<HTMLElement>('.ticket')?.dataset.ticketId
  const cards = new Map([...board.querySelectorAll<HTMLAnchorElement>('.ticket')].map((card) => [card.dataset.ticketId, card]))
  if (!tickets) board.replaceChildren()
  for (const [status, label] of lanes) {
    const lane = board.querySelector<HTMLElement>(`.lane[data-status="${status}"]`) ?? document.createElement('section')
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
    lane.querySelector('h2')?.remove()
    lane.prepend(heading)
    lane.querySelector('.lane-empty')?.remove()
    for (const ticket of items ?? []) {
      const card = cards.get(ticket.id) ?? document.createElement('a')
      cards.delete(ticket.id)
      card.className = 'ticket'
      card.href = `#ticket/${ticket.id}`
      card.dataset.ticketId = ticket.id
      card.draggable = true
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
      card.replaceChildren(key, title, metadata)
      if (card.parentElement !== lane) lane.append(card)
    }
    if (items?.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'lane-empty'
      empty.textContent = 'No tickets'
      lane.append(empty)
    }
    if (lane.parentElement !== board) board.append(lane)
  }
  for (const card of cards.values()) card.remove()
  if (focusedId && focused && document.activeElement !== focused) {
    (focused.isConnected ? focused : board).focus({ preventScroll: true })
  }
}

let draggedId = ''
let movingTicket = false
board.addEventListener('dragstart', (event) => {
  const card = (event.target as Element).closest<HTMLElement>('.ticket')
  if (!card || movingTicket) { event.preventDefault(); return }
  draggedId = card.dataset.ticketId!
  event.dataTransfer!.setData('text/plain', draggedId)
  event.dataTransfer!.effectAllowed = 'move'
})
board.addEventListener('dragover', (event) => {
  if (!draggedId || movingTicket) return
  const lane = (event.target as Element).closest('.lane')
  if (!lane) return
  event.preventDefault()
  event.dataTransfer!.dropEffect = 'move'
  board.querySelectorAll('.drop-target').forEach((item) => item.classList.remove('drop-target'))
  lane.classList.add('drop-target')
})
board.addEventListener('dragend', () => {
  draggedId = ''
  board.querySelectorAll('.drop-target').forEach((item) => item.classList.remove('drop-target'))
  if (refreshPending) void refreshLive()
})
board.addEventListener('drop', async (event) => {
  const lane = (event.target as Element).closest<HTMLElement>('.lane')
  if (!draggedId || !lane || movingTicket) return
  event.preventDefault()
  const id = draggedId
  const current = boardRequest
  const source = board.querySelector(`[data-ticket-id="${id}"]`)?.closest<HTMLElement>('.lane')
  if (source === lane) return
  movingTicket = true
  refresh.disabled = true
  boardStatus.textContent = 'Moving ticket…'
  try {
    const response = await fetch(`/api/tickets/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: lane.dataset.status }),
    })
    if (!response.ok) throw new Error(`Unable to move ticket (${response.status}). Try again.`)
    void refreshLive()
  } catch (error) {
    if (current === boardRequest) boardStatus.textContent = error instanceof Error ? error.message : 'Unable to reach the application. Try again.'
  } finally {
    movingTicket = false
    if (refreshPending) void refreshLive()
    if (current === boardRequest) refresh.disabled = false
  }
})

async function loadBoard(quiet = false) {
  const current = ++boardRequest
  const version = changeVersion
  board.setAttribute('aria-busy', 'true')
  refresh.disabled = true
  boardRetry.hidden = true
  if (!quiet) {
    boardStatus.textContent = 'Loading tickets…'
    ticketCount.textContent = '— tickets'
    renderBoard(null)
  }
  try {
    const response = await fetch('/api/tickets')
    if (!response.ok) throw new Error(`Unable to load tickets (${response.status}).`)
    const { tickets }: { tickets: Ticket[] } = await response.json()
    if (current !== boardRequest || version !== changeVersion) return
    if (draggedId) { refreshPending = true; return }
    renderBoard(tickets)
    ticketCount.textContent = `${tickets.length} ${tickets.length === 1 ? 'ticket' : 'tickets'}`
    boardStatus.textContent = tickets.length ? 'Board up to date.' : 'No tickets yet.'
  } catch (error) {
    if (current !== boardRequest || version !== changeVersion) return
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
const editForm = document.querySelector<HTMLFormElement>('#edit-form')!
const editFields = document.querySelector<HTMLFieldSetElement>('#edit-fields')!
let detailRequest = 0
let selectedTicket: Ticket | undefined
let editBaseline: Ticket | undefined

function renderTicket(ticket: Ticket, preserveDraft = false) {
  if (selectedTicket?.id !== ticket.id) document.querySelector('#activity-list')!.replaceChildren()
  selectedTicket = ticket
  document.title = `Kanban · ${ticket.key}`
  document.querySelector('#detail-key')!.textContent = ticket.key
  detailTitle.textContent = ticket.title
  document.querySelector('#detail-description')!.textContent = ticket.description || 'No description.'
  document.querySelector('#detail-ticket-status')!.textContent = lanes.find(([status]) => status === ticket.status)![1]
  document.querySelector('#detail-priority')!.textContent = ticket.priority
  document.querySelector('#detail-assignee')!.textContent = ticket.assignee ?? 'Unassigned'
  if (!preserveDraft) {
    detailContent.hidden = false
    editForm.hidden = true
    deleteTicket.disabled = false
    detailStatus.textContent = ''
  }
  renderActivity(ticket)
}

const commentForm = document.querySelector<HTMLFormElement>('#comment-form')!
const commentFields = document.querySelector<HTMLFieldSetElement>('#comment-fields')!
const commentBody = document.querySelector<HTMLTextAreaElement>('#comment-body')!
const commentStatus = document.querySelector<HTMLElement>('#comment-status')!
const replyContext = document.querySelector<HTMLElement>('#reply-context')!
const replyCancel = document.querySelector<HTMLButtonElement>('#reply-cancel')!
let replyId: string | undefined
let commentRequest = 0

function resetReply() {
  replyId = undefined
  replyContext.hidden = true
  replyCancel.hidden = true
}

function renderActivity(ticket: Ticket) {
  const list = document.querySelector<HTMLOListElement>('#activity-list')!
  document.querySelector<HTMLElement>('#activity-empty')!.hidden = !!ticket.comments?.length
  for (const comment of ticket.comments ?? []) {
    if (document.getElementById(`comment-${comment.id}`)) continue
    const item = document.createElement('li')
    item.id = `comment-${comment.id}`
    item.dataset.commentId = comment.id
    item.tabIndex = -1
    const author = document.createElement('strong')
    author.textContent = comment.author
    const time = document.createElement('time')
    time.dateTime = comment.created_at
    time.textContent = new Date(comment.created_at).toLocaleString()
    item.append(author, time)
    if (comment.parent_id) {
      const parent = ticket.comments!.find((entry) => entry.id === comment.parent_id)!
      const reference = document.createElement('button')
      reference.type = 'button'
      reference.className = 'comment-reference'
      reference.textContent = `Reply to ${parent.author}: ${parent.body}`
      reference.addEventListener('click', () => {
        const target = document.getElementById(`comment-${parent.id}`)!
        target.focus({ preventScroll: true })
        target.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
      item.append(reference)
    }
    const body = document.createElement('p')
    body.className = 'comment-body'
    body.textContent = comment.body
    const reply = document.createElement('button')
    reply.type = 'button'
    reply.className = 'comment-reply'
    reply.textContent = 'Reply'
    reply.setAttribute('aria-label', `Reply to ${comment.author}`)
    reply.addEventListener('click', () => {
      if (commentFields.disabled) return
      replyId = comment.id
      replyContext.textContent = `Replying to ${comment.author}: ${comment.body}`
      replyContext.hidden = false
      replyCancel.hidden = false
      commentBody.focus()
    })
    item.append(body, reply)
    list.append(item)
  }
}

replyCancel.addEventListener('click', () => { resetReply(); commentBody.focus() })
commentForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!selectedTicket || commentFields.disabled) return
  const data = Object.fromEntries(new FormData(commentForm))
  if (!String(data.author).trim() || !String(data.body).trim()) {
    commentStatus.textContent = 'Enter your name and a comment.'
    return
  }
  const id = selectedTicket.id
  const current = commentRequest
  commentFields.disabled = true
  commentForm.setAttribute('aria-busy', 'true')
  commentStatus.textContent = 'Posting comment…'
  try {
    const response = await fetch(`/api/tickets/${encodeURIComponent(id)}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, parent_id: replyId }),
    })
    if (!response.ok) throw new Error(`Unable to post comment (${response.status}). Try again.`)
    if (current !== commentRequest || selectedTicket?.id !== id) return
    commentBody.value = ''
    resetReply()
    commentStatus.textContent = 'Comment posted.'
    void refreshLive()
  } catch (error) {
    if (current === commentRequest) commentStatus.textContent = error instanceof Error ? error.message : 'Unable to reach the application. Try again.'
  } finally {
    if (current === commentRequest) {
      commentFields.disabled = !selectedTicket
      commentForm.setAttribute('aria-busy', 'false')
      if (!detailContent.hidden) commentBody.focus()
    }
  }
})

async function loadTicket(quiet = false) {
  const current = ++detailRequest
  const version = changeVersion
  if (!quiet) {
    selectedTicket = undefined
    detailContent.hidden = true
    editForm.hidden = true
    detailTitle.textContent = 'Ticket'
    document.querySelector('#detail-key')!.textContent = ''
    detailStatus.textContent = 'Loading ticket…'
    detailTitle.focus()
  }
  detailRetry.hidden = true
  ticketView.setAttribute('aria-busy', 'true')
  try {
    const response = await fetch(`/api/tickets/${encodeURIComponent(decodeURIComponent(location.hash.slice(8)))}`)
    if (current !== detailRequest || version !== changeVersion) return
    if (response.status === 404) {
      selectedTicket = undefined
      editBaseline = undefined
      ++commentRequest
      commentFields.disabled = true
      editFields.disabled = true
      deleteTicket.disabled = true
      detailContent.hidden = true
      editForm.hidden = true
      resetReply()
    }
    if (!response.ok) throw new Error(response.status === 404 ? 'Ticket not found.' : `Unable to load ticket (${response.status}).`)
    const { ticket }: { ticket: Ticket } = await response.json()
    if (current !== detailRequest || version !== changeVersion) return
    renderTicket(ticket, quiet && !!selectedTicket)
  } catch (error) {
    if (current !== detailRequest || version !== changeVersion) return
    detailStatus.textContent = error instanceof Error ? error.message : 'Unable to reach the application.'
    detailRetry.hidden = false
  } finally {
    if (current === detailRequest) ticketView.setAttribute('aria-busy', 'false')
  }
}

detailRetry.addEventListener('click', () => { void loadTicket() })
document.querySelector('#edit-ticket')!.addEventListener('click', () => {
  if (!selectedTicket) return
  editBaseline = selectedTicket
  for (const field of ['title', 'description', 'status', 'priority', 'assignee'] as const) {
    (editForm.elements.namedItem(field) as HTMLInputElement | HTMLSelectElement).value = selectedTicket[field] ?? ''
  }
  editFields.disabled = false
  editForm.setAttribute('aria-busy', 'false')
  detailContent.hidden = true
  editForm.hidden = false
  detailStatus.textContent = ''
  document.querySelector<HTMLInputElement>('#edit-title')!.focus()
})
document.querySelector('#edit-cancel')!.addEventListener('click', () => {
  editForm.hidden = true
  detailContent.hidden = false
  detailStatus.textContent = ''
  document.querySelector<HTMLButtonElement>('#edit-ticket')!.focus()
})
editForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!selectedTicket || editFields.disabled) return
  const current = viewVersion
  const data = Object.fromEntries(new FormData(editForm))
  if (!String(data.title).trim()) {
    detailStatus.textContent = 'Enter a title.'
    document.querySelector<HTMLInputElement>('#edit-title')!.focus()
    return
  }
  editFields.disabled = true
  editForm.setAttribute('aria-busy', 'true')
  detailStatus.textContent = 'Saving changes…'
  try {
    const values = { ...data, assignee: String(data.assignee).trim() || null }
    const changes = Object.fromEntries(Object.entries(values).filter(([field, value]) => value !== editBaseline![field as keyof Ticket]))
    if (!Object.keys(changes).length) {
      renderTicket(selectedTicket)
      document.querySelector<HTMLButtonElement>('#edit-ticket')!.focus()
      return
    }
    const response = await fetch(`/api/tickets/${encodeURIComponent(selectedTicket.id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    })
    if (!response.ok) throw new Error(`Unable to save ticket (${response.status}).`)
    if (current === viewVersion && selectedTicket) {
      renderTicket(selectedTicket)
      detailStatus.textContent = 'Changes saved.'
      document.querySelector<HTMLButtonElement>('#edit-ticket')!.focus()
    }
    void refreshLive()
  } catch (error) {
    if (current !== viewVersion) return
    detailStatus.textContent = error instanceof Error ? error.message : 'Unable to reach the application.'
  } finally {
    if (current === viewVersion) {
      editFields.disabled = !selectedTicket
      editForm.setAttribute('aria-busy', 'false')
    }
  }
})
deleteTicket.addEventListener('click', async () => {
  if (!selectedTicket || deleteTicket.disabled) return
  const current = viewVersion
  deleteTicket.disabled = true
  detailStatus.textContent = 'Deleting ticket…'
  try {
    const response = await fetch(`/api/tickets/${encodeURIComponent(selectedTicket.id)}`, { method: 'DELETE' })
    if (!response.ok) throw new Error(`Unable to delete ticket (${response.status}).`)
    if (current === viewVersion) {
      location.hash = '#board'
    } else if (!boardView.hidden) {
      void loadBoard()
    }
  } catch (error) {
    if (current !== viewVersion) return
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
  const currentStore = storeVersion
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
    if (currentStore !== storeVersion) return
    createDialog.close()
    location.hash = `#ticket/${ticket.id}`
  } catch (error) {
    if (currentStore === storeVersion) createStatus.textContent = error instanceof Error ? error.message : 'Unable to reach the application.'
  } finally {
    if (currentStore === storeVersion) {
      createFields.disabled = false
      createForm.setAttribute('aria-busy', 'false')
    }
  }
})

refresh.addEventListener('click', () => { void loadBoard() })
boardRetry.addEventListener('click', () => { void loadBoard() })
window.addEventListener('hashchange', showView)
showView()

const liveStatus = document.querySelector<HTMLElement>('#live-status')!
const events = new EventSource('/api/events')
events.addEventListener('open', () => { liveStatus.textContent = 'Live updates connected' })
events.addEventListener('error', () => { liveStatus.textContent = 'Live updates disconnected. Reconnecting…' })
events.addEventListener('change', (event) => {
  const nextStore: string = JSON.parse((event as MessageEvent).data).store
  ++changeVersion
  if (store && store !== nextStore) {
    draggedId = ''
    ++storeVersion
    ++viewVersion
    ++commentRequest
    selectedTicket = undefined
    editBaseline = undefined
    commentForm.reset()
    commentFields.disabled = false
    commentForm.setAttribute('aria-busy', 'false')
    commentStatus.textContent = ''
    resetReply()
    editForm.reset()
    editForm.hidden = true
    detailContent.hidden = true
    createDialog.close()
    createForm.reset()
    createFields.disabled = false
    createForm.setAttribute('aria-busy', 'false')
    board.replaceChildren()
    ticketCount.textContent = '— tickets'
    detailStatus.textContent = 'Storage changed. Loading current ticket…'
    if (!settingsView.hidden && !saving) void request('GET')
  }
  store = nextStore
  void refreshLive()
})

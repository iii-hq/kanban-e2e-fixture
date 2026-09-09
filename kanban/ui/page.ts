const form = document.querySelector<HTMLFormElement>('#settings')!
const input = document.querySelector<HTMLInputElement>('#data-dir')!
const save = document.querySelector<HTMLButtonElement>('#save')!
const retry = document.querySelector<HTMLButtonElement>('#retry')!
const status = document.querySelector<HTMLElement>('#status')!
const resolved = document.querySelector<HTMLOutputElement>('#resolved-path')!

async function request(method: 'GET' | 'PUT') {
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
    input.value = config.data_dir
    resolved.textContent = config.resolved_data_dir
    status.textContent = method === 'PUT' ? 'Settings saved.' : ''
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Unable to reach the application.'
    retry.hidden = false
  } finally {
    form.setAttribute('aria-busy', 'false')
    input.disabled = false
    save.disabled = !input.value.trim()
  }
}

input.addEventListener('input', () => { save.disabled = !input.value.trim() })
form.addEventListener('submit', (event) => {
  event.preventDefault()
  void request('PUT')
})
retry.addEventListener('click', () => { void request('GET') })
void request('GET')

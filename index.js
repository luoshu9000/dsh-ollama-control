/**
 * Host half of the local Ollama control.  The browser can only read status or
 * request a toggle; it cannot select an executable, working directory, or
 * command line.  Both actions run the already-audited fixed scripts.
 */
import { execFile } from 'node:child_process'
import { access, constants, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const STATUS_ROUTE = '/ollama-control/status'
const TOGGLE_ROUTE = '/ollama-control/toggle'
const MODELS_ROUTE = '/ollama-control/models'
const LOAD_ROUTE = '/ollama-control/load'
const IMPORTS_ROUTE = '/ollama-control/imports'
const IMPORT_ROUTE = '/ollama-control/import'
const DEFAULT_CATALOG = []
const DEFAULT_LOCAL_MODELS = [{
  model: 'minicpm5-2b:q4km',
  displayName: 'MiniCPM5-2B Q4_K_M',
  manifestPath: 'registry.ollama.ai/library/minicpm5-2b/q4km',
}]

export const name = 'ollama-control'
export const inject = ['webServer', 'connection']

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

function rejectIfUntrusted(ctx, req, res) {
  const rejection = ctx.connection.requestRejection(req)
  if (rejection === undefined) return false
  res.statusCode = rejection
  res.end()
  return true
}

async function ollamaReady() {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 1_500)
  try {
    const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: abort.signal })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function managedOllama(root) {
  try {
    const raw = (await readFile(join(root, 'run', 'ollama.pid'), 'utf8')).trim()
    if (!/^[1-9]\d*$/.test(raw)) return false
    const pid = Number(raw)
    process.kill(pid, 0)
    const [executable, argument] = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0')
    return executable === join(root, 'bin', 'ollama') && argument === 'serve'
  } catch {
    // A stale or unrelated PID file does not grant permission to stop a process.
    return false
  }
}

async function serviceState(root) {
  if (!await ollamaReady()) return 'stopped'
  return await managedOllama(root) ? 'managed' : 'external'
}

async function runScript(path, timeout) {
  await access(path, constants.X_OK)
  await execFileAsync(path, [], {
    timeout,
    maxBuffer: 64 * 1024,
    // The scripts establish the service environment themselves; inheriting
    // the DSH process environment is only needed for standard utilities.
    env: process.env,
  })
}

async function readJson(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 4_096) throw new Error('Request body is too large.')
  }
  return JSON.parse(body)
}

function normalizeCatalog(config) {
  const models = config?.models ?? DEFAULT_CATALOG
  if (!Array.isArray(models)) throw new Error('ollama-control config.models must be an array')
  return models.map(item => {
    if (!item || typeof item !== 'object' || typeof item.fileName !== 'string' || typeof item.model !== 'string' || typeof item.displayName !== 'string') {
      throw new Error('Every ollama-control model needs fileName, model, and displayName strings')
    }
    if (basename(item.fileName) !== item.fileName || !item.fileName.toLowerCase().endsWith('.gguf')) {
      throw new Error('ollama-control model fileName must be a GGUF basename')
    }
    return item
  })
}

function normalizeLocalModels(config) {
  const models = config?.localModels ?? DEFAULT_LOCAL_MODELS
  if (!Array.isArray(models)) throw new Error('ollama-control config.localModels must be an array')
  return models.map(item => {
    if (!item || typeof item !== 'object' || typeof item.model !== 'string' || typeof item.displayName !== 'string' || typeof item.manifestPath !== 'string') {
      throw new Error('Every local model needs model, displayName, and manifestPath strings')
    }
    if (item.manifestPath.startsWith('/') || item.manifestPath.split('/').includes('..')) {
      throw new Error('ollama-control local model manifestPath must stay below the manifests directory')
    }
    return item
  })
}

async function availableImports(importRoot, catalog, tags) {
  const imported = new Set(Array.isArray(tags?.models) ? tags.models.map(item => item.name) : [])
  const entries = await readdir(importRoot, { withFileTypes: true }).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))
  const files = new Set(entries.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.gguf')).map(entry => entry.name))
  return Promise.all(catalog.filter(item => files.has(item.fileName)).map(async item => {
    const details = await stat(join(importRoot, item.fileName))
    return { ...item, bytes: details.size, imported: imported.has(item.model) }
  }))
}

async function ollamaTags() {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 2_500)
  try {
    const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: abort.signal })
    if (!response.ok) throw new Error('Ollama tags request failed')
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

async function ollamaPs() {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 2_500)
  try {
    const response = await fetch('http://127.0.0.1:11434/api/ps', { signal: abort.signal })
    if (!response.ok) throw new Error('Ollama process request failed')
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

async function localModelStates(root, localModels, service) {
  const tags = service === 'stopped' ? null : await ollamaTags()
  const processes = service === 'stopped' ? { models: [] } : await ollamaPs().catch(() => ({ models: [] }))
  const registered = new Set(Array.isArray(tags?.models) ? tags.models.map(item => item.name) : [])
  const loaded = new Set(Array.isArray(processes?.models) ? processes.models.map(item => item.name) : [])
  return Promise.all(localModels.map(async item => {
    const manifest = join(root, 'models', 'manifests', item.manifestPath)
    const onDisk = await access(manifest, constants.R_OK).then(() => true, () => false)
    const isRegistered = registered.has(item.model)
    return {
      model: item.model, displayName: item.displayName,
      installed: onDisk || isRegistered, registered: isRegistered,
      canLoad: service === 'stopped' ? onDisk : service === 'managed' && isRegistered,
      loaded: loaded.has(item.model),
    }
  }))
}

async function loadModel(model) {
  const response = await fetch('http://127.0.0.1:11434/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt: '', stream: false, keep_alive: '5m' }),
    signal: AbortSignal.timeout(180_000),
  })
  if (!response.ok) throw new Error('Ollama model load failed')
  await response.text()
}

async function importModel({ root, importRoot, binary, entry }) {
  const source = resolve(importRoot, entry.fileName)
  if (!source.startsWith(`${resolve(importRoot)}/`)) throw new Error('Invalid model source')
  const scratch = await mkdtemp(join(root, 'run', 'ollama-import-'))
  const modelfile = join(scratch, 'Modelfile')
  try {
    await writeFile(modelfile, `FROM ${source}\n`, { mode: 0o600 })
    await execFileAsync(binary, ['create', entry.model, '--file', modelfile], {
      timeout: 15 * 60_000,
      maxBuffer: 64 * 1024,
      env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' },
    })
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

export function apply(ctx, config) {
  const root = config?.root ?? join(homedir(), 'devtools', 'ollama')
  if (typeof root !== 'string' || !root.startsWith('/')) {
    throw new Error('ollama-control requires an absolute config.root')
  }
  const startScript = join(root, 'scripts/start.sh')
  const stopScript = join(root, 'scripts/stop.sh')
  const binary = join(root, 'bin', 'ollama')
  const importRoot = config?.importRoot ?? join(root, 'import')
  if (typeof importRoot !== 'string' || !importRoot.startsWith('/')) throw new Error('ollama-control requires an absolute config.importRoot')
  const catalog = normalizeCatalog(config)
  const localModels = normalizeLocalModels(config)
  let operation = null
  const reserve = () => {
    if (operation !== null) return null
    const token = {}
    operation = token
    return token
  }
  const release = token => { if (operation === token) operation = null }
  const serviceSnapshot = async () => ({ state: await serviceState(root), busy: operation !== null })

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STATUS_ROUTE,
    handler: async (req, res) => {
      if (rejectIfUntrusted(ctx, req, res)) return
      if (req.method !== 'GET') {
        res.statusCode = 405
        res.setHeader('allow', 'GET')
        res.end()
        return
      }
      sendJson(res, 200, { service: await serviceSnapshot() })
    },
  }), `ollama-control: GET ${STATUS_ROUTE}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: TOGGLE_ROUTE,
    handler: async (req, res) => {
      if (rejectIfUntrusted(ctx, req, res)) return
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('allow', 'POST')
        res.end()
        return
      }
      // There is intentionally no request body or browser-supplied command.
      req.resume()
      const token = reserve()
      if (token === null) {
        sendJson(res, 409, { service: await serviceSnapshot(), message: 'Ollama operation already in progress.' })
        return
      }
      try {
        const before = await serviceState(root)
        if (before === 'external') {
          sendJson(res, 409, { service: await serviceSnapshot(), message: 'Port 11434 is served by an unmanaged Ollama process.' })
          return
        }
        await runScript(before === 'managed' ? stopScript : startScript, before === 'managed' ? 25_000 : 35_000)
        const after = await serviceState(root)
        if (after === before) throw new Error('Ollama service did not change state')
        sendJson(res, 200, { service: { state: after, busy: false } })
      } catch {
        sendJson(res, 500, { service: await serviceSnapshot(), message: 'Unable to change local Ollama status.' })
      } finally {
        release(token)
      }
    },
  }), `ollama-control: POST ${TOGGLE_ROUTE}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: MODELS_ROUTE,
    handler: async (req, res) => {
      if (rejectIfUntrusted(ctx, req, res)) return
      if (req.method !== 'GET') {
        res.statusCode = 405
        res.setHeader('allow', 'GET')
        res.end()
        return
      }
      try {
        const service = await serviceState(root)
        sendJson(res, 200, { service: { state: service, busy: operation !== null }, models: await localModelStates(root, localModels, service) })
      } catch {
        sendJson(res, 500, { message: 'Unable to inspect installed local models.' })
      }
    },
  }), `ollama-control: GET ${MODELS_ROUTE}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: LOAD_ROUTE,
    handler: async (req, res) => {
      if (rejectIfUntrusted(ctx, req, res)) return
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('allow', 'POST')
        res.end()
        return
      }
      let body
      try {
        body = await readJson(req)
      } catch {
        sendJson(res, 400, { message: 'Invalid model load request.' })
        return
      }
      const entry = localModels.find(item => item.model === body?.model)
      if (!entry) {
        sendJson(res, 400, { message: 'That local model is not approved.' })
        return
      }
      const token = reserve()
      if (token === null) {
        sendJson(res, 409, { message: 'An Ollama operation is already in progress.' })
        return
      }
      try {
        const service = await serviceState(root)
        if (service === 'external') {
          sendJson(res, 409, { message: 'Port 11434 is served by an unmanaged Ollama process.' })
          return
        }
        if (service === 'stopped') {
          const manifest = join(root, 'models', 'manifests', entry.manifestPath)
          try { await access(manifest, constants.R_OK) } catch {
            sendJson(res, 409, { message: 'The selected model is not installed in the managed Ollama directory.' })
            return
          }
          await runScript(startScript, 35_000)
        }
        const tags = await ollamaTags()
        if (!tags.models?.some(item => item.name === entry.model)) {
          sendJson(res, 409, { message: 'The selected model is not registered in the managed Ollama service.' })
          return
        }
        await loadModel(entry.model)
        sendJson(res, 200, { service: { state: 'managed', busy: false }, model: entry.model, message: 'Model loaded into Ollama.' })
      } catch {
        sendJson(res, 500, { message: 'Unable to load the selected model. Check the local Ollama log.' })
      } finally {
        release(token)
      }
    },
  }), `ollama-control: POST ${LOAD_ROUTE}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: IMPORTS_ROUTE,
    handler: async (req, res) => {
      if (rejectIfUntrusted(ctx, req, res)) return
      if (req.method !== 'GET') {
        res.statusCode = 405
        res.setHeader('allow', 'GET')
        res.end()
        return
      }
      try {
        const tags = await ollamaReady() ? await ollamaTags() : null
        sendJson(res, 200, { importRoot, models: await availableImports(importRoot, catalog, tags) })
      } catch {
        sendJson(res, 500, { message: 'Unable to inspect the local model import directory.' })
      }
    },
  }), `ollama-control: GET ${IMPORTS_ROUTE}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: IMPORT_ROUTE,
    handler: async (req, res) => {
      if (rejectIfUntrusted(ctx, req, res)) return
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('allow', 'POST')
        res.end()
        return
      }
      let body
      try {
        body = await readJson(req)
      } catch {
        sendJson(res, 400, { message: 'Invalid import request.' })
        return
      }
      const entry = catalog.find(item => item.fileName === body?.fileName)
      if (!entry) {
        sendJson(res, 400, { message: 'That model is not approved for import.' })
        return
      }
      const token = reserve()
      if (token === null) {
        sendJson(res, 409, { message: 'An Ollama operation is already in progress.' })
        return
      }
      try {
        const service = await serviceState(root)
        if (service === 'external') {
          sendJson(res, 409, { message: 'Port 11434 is served by an unmanaged Ollama process.' })
          return
        }
        if (service === 'stopped') await runScript(startScript, 35_000)
        const isRegistered = tags => tags.models?.some(item => item.name === entry.model) === true
        if (!isRegistered(await ollamaTags())) {
          await access(join(importRoot, entry.fileName), constants.R_OK)
          await access(binary, constants.X_OK)
          try {
            await importModel({ root, importRoot, binary, entry })
          } catch (error) {
            // `ollama create` can finish registering the model before its CLI
            // process reports a local output/cleanup error. The registry is
            // authoritative, so do not falsely tell the user it failed.
            if (!isRegistered(await ollamaTags().catch(() => null))) throw error
          }
        }
        if (!isRegistered(await ollamaTags())) throw new Error('Imported model is missing from Ollama tags')
        sendJson(res, 200, { model: entry.model, message: 'Model imported into Ollama.' })
      } catch {
        sendJson(res, 500, { message: 'Unable to import the selected model. Check the local Ollama log.' })
      } finally {
        release(token)
      }
    },
  }), `ollama-control: POST ${IMPORT_ROUTE}`)
}

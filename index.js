/**
 * Host half of the local Ollama control.  The browser can only read status or
 * request a toggle; it cannot select an executable, working directory, or
 * command line.  Both actions run the already-audited fixed scripts.
 */
import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const STATUS_ROUTE = '/ollama-control/status'
const TOGGLE_ROUTE = '/ollama-control/toggle'

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

/** One operation at a time protects the scripts' PID-file protocol. */
let operation = null

export function apply(ctx, config) {
  const root = config?.root ?? join(homedir(), 'devtools', 'ollama')
  if (typeof root !== 'string' || !root.startsWith('/')) {
    throw new Error('ollama-control requires an absolute config.root')
  }
  const startScript = join(root, 'scripts/start.sh')
  const stopScript = join(root, 'scripts/stop.sh')

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
      sendJson(res, 200, { running: await ollamaReady() })
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
      if (operation !== null) {
        sendJson(res, 409, { running: await ollamaReady(), message: 'Ollama operation already in progress.' })
        return
      }
      const wasRunning = await ollamaReady()
      operation = (async () => {
        if (wasRunning) await runScript(stopScript, 25_000)
        else await runScript(startScript, 35_000)
      })()
      try {
        await operation
        sendJson(res, 200, { running: await ollamaReady() })
      } catch {
        // Script diagnostics remain in the local Ollama log; do not echo them
        // to the browser or turn them into a command-output disclosure.
        sendJson(res, 500, { running: await ollamaReady(), message: 'Unable to change local Ollama status.' })
      } finally {
        operation = null
      }
    },
  }), `ollama-control: POST ${TOGGLE_ROUTE}`)
}

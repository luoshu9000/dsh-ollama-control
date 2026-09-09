import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
let registration
globalThis.window = { __ModuleLoader__: { load: entry => { registration = entry } } }
await import(`${new URL('../lib/client.js', import.meta.url).href}?check=${Date.now()}`)
if (registration?.id !== 'dsh-ollama-control' || typeof registration.factory !== 'function') throw new Error('client artifact did not register the expected DSH module factory')
const artifact = await readFile(resolve(root, 'lib/client.js'), 'utf8')
if (!artifact.includes("require('react')") && !artifact.includes('require("react")')) throw new Error('client artifact does not request React from the DSH module table')
console.log('DSH client factory artifact is valid.')

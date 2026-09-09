import { createElement, useEffect, useRef, useState } from 'react'

const STATUS_ROUTE = '/ollama-control/status'
const TOGGLE_ROUTE = '/ollama-control/toggle'

function Icon({ state }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }
  if (state === 'running') return createElement('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true }, createElement('rect', { x: 3.1, y: 3.1, width: 9.8, height: 9.8, rx: 1.4, fill: 'currentColor' }))
  if (state === 'busy') return createElement('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true }, createElement('g', null, createElement('animateTransform', { attributeName: 'transform', type: 'rotate', from: '0 8 8', to: '360 8 8', dur: '0.8s', repeatCount: 'indefinite' }), createElement('path', { d: 'M13.2 8a5.2 5.2 0 1 1-1.52-3.68', ...common }), createElement('path', { d: 'M11.68 1.9v2.9H8.78', ...common })))
  return createElement('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': true }, createElement('circle', { cx: 8, cy: 8, r: 6.2, ...common }), createElement('path', { d: 'm6.6 5.55 4.05 2.45-4.05 2.45z', fill: 'currentColor', stroke: 'none' }))
}

async function status() {
  const response = await fetch(STATUS_ROUTE, { cache: 'no-store' })
  if (!response.ok) throw new Error('status request failed')
  return (await response.json()).running === true
}

function OllamaControlAction() {
  const [running, setRunning] = useState(false)
  const [known, setKnown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const refresh = () => status().then(value => { if (mounted.current) { setRunning(value); setKnown(true); setError(false) } }, () => { if (mounted.current) { setKnown(true); setError(true) } })
    void refresh()
    const timer = setInterval(() => { void refresh() }, 10_000)
    return () => { mounted.current = false; clearInterval(timer) }
  }, [])
  const toggle = async () => {
    if (busy) return
    setBusy(true); setError(false)
    try {
      const response = await fetch(TOGGLE_ROUTE, { method: 'POST', cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || typeof body.running !== 'boolean') throw new Error('toggle request failed')
      if (mounted.current) { setRunning(body.running); setKnown(true) }
    } catch { if (mounted.current) setError(true) } finally { if (mounted.current) setBusy(false) }
  }
  const state = busy ? 'busy' : known && running ? 'running' : 'stopped'
  const label = busy ? (running ? '正在停止 Ollama' : '正在启动 Ollama') : error ? 'Ollama 操作失败；请查看日志' : running ? 'Ollama 已运行，点击停止' : 'Ollama 已停止，点击启动'
  const color = busy ? 'var(--dsw-alias-label-secondary)' : running ? 'var(--dsw-alias-state-success-primary, #32a467)' : 'var(--dsw-alias-state-error-primary, #e5484d)'
  return createElement('button', { type: 'button', disabled: busy, onClick: () => { void toggle() }, 'aria-label': label, title: label, style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px', padding: 0, border: '0.5px solid var(--dsw-alias-border-l4)', borderRadius: '13px', background: 'transparent', color, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.65 : 1 } }, createElement(Icon, { state }))
}

export const inject = ['slots']
export function apply(ctx) {
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({ name: 'conversation.session.header.utilities', id: 'ollama-control', order: -20 }, OllamaControlAction))
}

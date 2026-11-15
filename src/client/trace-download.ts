/** Separate trace download: never rewrites the canonical Session log. */
import { createElement, useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { HintTraceSnapshot } from '../trace-record.ts'

interface DownloadProps extends Pick<PropsRuntime<'conversation.session.header.utilities'>, 'sessionId'> {
  download: (sessionId: string, signal: AbortSignal) => Promise<void>
}
export function TraceDownload({ sessionId, download }: DownloadProps) {
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle')
  const active = useRef<AbortController | undefined>(undefined)
  useEffect(() => { setState('idle'); return () => active.current?.abort() }, [sessionId])
  const click = async () => {
    if (active.current && !active.current.signal.aborted) return
    const attempt = active.current = new AbortController()
    setState('busy')
    try { await download(String(sessionId), attempt.signal); if (!attempt.signal.aborted) setState('idle') }
    catch { if (!attempt.signal.aborted) setState('error') }
    finally { if (active.current === attempt) active.current = undefined }
  }
  const label = state === 'error' ? 'Hint trace 下载失败，点击重试' : state === 'busy' ? '正在下载 Hint trace…' : '下载 Hint trace'
  return createElement('button', { type: 'button', onClick: () => { void click() },
    disabled: state === 'busy', title: label, 'aria-label': label, 'aria-busy': state === 'busy',
    style: { appearance: 'none', font: 'inherit', fontSize: 12, color: 'inherit', background: 'transparent',
      border: '1px solid rgba(127,127,127,.25)', borderRadius: 6, padding: '4px 8px',
      whiteSpace: 'nowrap', cursor: state === 'busy' ? 'wait' : 'pointer' } }, label)
}

export function installTraceDownload(ctx: Context, connection: ConnectionHandle, lifetime: AbortSignal): void {
  let generation: ReturnType<ConnectionHandle['generation']['getSnapshot']>
  let probe: AbortController | undefined
  let withdraw: (() => void) | undefined
  const refresh = () => {
    const next = connection.generation.getSnapshot()
    if (next === generation || lifetime.aborted) return
    generation = next
    probe?.abort(); withdraw?.(); withdraw = undefined
    if (next === undefined) return
    const attempt = probe = new AbortController()
    const signal = AbortSignal.any([lifetime, attempt.signal, AbortSignal.timeout(5000)])
    void connection.rpc.call('/api', 'agentHintTrace/available', { args: {} }, signal).then(result => {
      if (signal.aborted || generation !== next || !result.ok || result.value !== true) return
      const download = async (sessionId: string, consumer: AbortSignal) => {
        const downloadSignal = AbortSignal.any([lifetime, attempt.signal, consumer, AbortSignal.timeout(10_000)])
        const response = await connection.rpc.call('/api', 'agentHintTrace/snapshot', { args: { request: { sessionId } } }, downloadSignal)
        downloadSignal.throwIfAborted()
        if (!response.ok) throw new Error('Trace download failed')
        const snapshot = response.value as HintTraceSnapshot
        if (snapshot?.schemaVersion !== 1 || snapshot.sessionId !== sessionId || !Array.isArray(snapshot.records)) {
          throw new Error('Invalid trace response')
        }
        const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }))
        const anchor = document.createElement('a')
        anchor.href = url; anchor.download = 'agent-hint-trace.json'
        document.body.appendChild(anchor)
        try { anchor.click() } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
      }
      withdraw = ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities', id: 'agent-hint-trace-download',
        inject: () => ({ download }),
      }, TraceDownload))
    }).catch(() => undefined)
  }
  ctx.effect(() => {
    const unsubscribe = connection.generation.subscribe(refresh)
    refresh()
    return () => { probe?.abort(); unsubscribe(); withdraw?.() }
  }, 'agent-hint: trace export capability and RPC lifetime')
}

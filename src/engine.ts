// Main-thread handle on the processing worker.
import type { EngineRequest, EngineResponse } from './worker/protocol.ts'

type Pending = { resolve: (r: EngineResponse) => void; reject: (e: Error) => void; progress?: (done: number) => void }

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./worker/engine.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<EngineResponse>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    if (e.data.t === 'progress') { p.progress?.(e.data.done); return }
    pending.delete(e.data.id)
    if (e.data.t === 'error') p.reject(new Error(e.data.message))
    else p.resolve(e.data)
  }
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || '처리 중 오류가 났어요'))
    pending.clear()
  }
  return worker
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export function request(
  msg: DistributiveOmit<EngineRequest, 'id'>, transfer: Transferable[] = [], progress?: (done: number) => void,
): Promise<EngineResponse> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, progress })
    getWorker().postMessage({ ...msg, id }, transfer)
  })
}

/** Start loading OpenCV.js in the background so the first photo is processed sooner. */
export function warmup() {
  void request({ t: 'warmup' }).catch(() => {})
}

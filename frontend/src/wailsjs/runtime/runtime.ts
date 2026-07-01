/**
 * Wails v3 런타임 이벤트 스텁.
 * wails3 build 시 실제 런타임으로 교체된다.
 */

type EventCallback = (...args: unknown[]) => void

const _listeners: Map<string, EventCallback[]> = new Map()

export function EventsOn(event: string, callback: EventCallback): void {
  if (typeof window !== 'undefined' && (window as unknown as { runtime?: { EventsOn: typeof EventsOn } }).runtime?.EventsOn) {
    ;(window as unknown as { runtime: { EventsOn: typeof EventsOn } }).runtime.EventsOn(event, callback)
    return
  }
  const existing = _listeners.get(event) ?? []
  _listeners.set(event, [...existing, callback])
}

export function EventsOff(...events: string[]): void {
  if (typeof window !== 'undefined' && (window as unknown as { runtime?: { EventsOff: typeof EventsOff } }).runtime?.EventsOff) {
    ;(window as unknown as { runtime: { EventsOff: typeof EventsOff } }).runtime.EventsOff(...events)
    return
  }
  for (const event of events) {
    _listeners.delete(event)
  }
}

export function EventsEmit(event: string, ...args: unknown[]): void {
  if (typeof window !== 'undefined' && (window as unknown as { runtime?: { EventsEmit: typeof EventsEmit } }).runtime?.EventsEmit) {
    ;(window as unknown as { runtime: { EventsEmit: typeof EventsEmit } }).runtime.EventsEmit(event, ...args)
    return
  }
  const cbs = _listeners.get(event) ?? []
  cbs.forEach((cb) => cb(...args))
}

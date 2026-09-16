// A minimal client for Lume's plugin protocol (docs/plugin-api.md, section 5),
// the seed of the SDK. A classic script rather than a module: a sandboxed
// frame has an opaque origin, and module scripts would need CORS headers.
//
//   const host = await LumeClient.connect()
//   await host.call('ui.notify', { text: 'Hi' })
;(function () {
  const SDK_VERSION = '0.0.1'

  class LumeError extends Error {
    constructor(code, message) {
      super(message)
      this.code = code
    }
  }

  function connect() {
    return new Promise((resolve) => {
      function onConnect(event) {
        const data = event.data
        if (event.source !== window.parent || !data || data.type !== 'lume:connect' || !event.ports[0]) return
        window.removeEventListener('message', onConnect)
        const port = event.ports[0]
        let nextId = 1
        const pending = new Map()
        const subs = new Map()
        const handlers = new Map()
        let ready = false

        const host = {
          info: null,
          /** a host method; rejects with a LumeError carrying .code */
          call(method, params) {
            const id = nextId++
            return new Promise((res, rej) => {
              pending.set(id, { res, rej })
              port.postMessage({ type: 'call', id, method, params })
            })
          },
          /** a subscribing method; `cb` gets each event, the result unsubscribes */
          async subscribe(method, params, cb) {
            const sub = await host.call(method, params)
            subs.set(sub, cb)
            return () => {
              subs.delete(sub)
              return host.call('unsubscribe', { sub })
            }
          },
          onLifecycle(event, cb) {
            return host.subscribe('lifecycle.on', { event }, cb)
          },
          /** registers an RPC handler under `name` */
          async register(name, handler) {
            handlers.set(name, handler)
            await host.call('rpc.register', { name })
            return () => {
              handlers.delete(name)
              return host.call('rpc.unregister', { name })
            }
          },
        }

        port.onmessage = async (e) => {
          const msg = e.data
          if (!msg || typeof msg !== 'object') return
          if (msg.type === 'lume:ready' && !ready) {
            ready = true
            host.info = msg.info
            applyTheme(msg.info.theme)
            resolve(host)
          } else if (msg.type === 'result' || msg.type === 'error') {
            const p = pending.get(msg.id)
            if (!p) return
            pending.delete(msg.id)
            if (msg.type === 'result') p.res(msg.value)
            else p.rej(new LumeError(msg.code, msg.message))
          } else if (msg.type === 'event') {
            const cb = subs.get(msg.sub)
            if (cb) cb(msg.data)
          } else if (msg.type === 'invoke') {
            try {
              if (msg.method !== 'rpc') throw new LumeError('unsupported', 'Unknown invoke ' + msg.method)
              const handler = handlers.get(msg.params.name)
              if (!handler) throw new LumeError('not_found', 'No handler for ' + msg.params.name)
              const value = await handler(msg.params.args, msg.params.ctx)
              port.postMessage({ type: 'result', id: msg.id, value: value === undefined ? null : value })
            } catch (err) {
              port.postMessage({
                type: 'error',
                id: msg.id,
                code: err.code || 'provider_error',
                message: String(err.message || err),
              })
            }
          }
        }
        port.postMessage({ type: 'lume:hello', apiVersion: 1, sdkVersion: SDK_VERSION })
      }
      window.addEventListener('message', onConnect)
    })
  }

  function applyTheme(theme) {
    for (const [name, value] of Object.entries(theme || {})) {
      document.documentElement.style.setProperty(name, value)
    }
  }

  window.LumeClient = { connect, LumeError }
})()

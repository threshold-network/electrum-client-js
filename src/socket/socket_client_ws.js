'use strict'

const MAX_MESSAGE_SIZE = 8 * 1024 * 1024

function createWebSocket(url, options) {
  const hasOptions = options && Object.keys(options).length > 0

  // Native Node WebSocket cannot bound incoming messages before assembly or
  // express HTTP/TLS request options. Preserve the old 8 MiB message bound and
  // certificate/proxy settings using a maintained transport.
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    const NodeWebSocket = require('ws')
    return new NodeWebSocket(url, Object.assign({}, options, {
      perMessageDeflate: false,
      maxPayload: MAX_MESSAGE_SIZE,
    }))
  }

  if (!hasOptions && typeof WebSocket !== 'undefined') {
    return new WebSocket(url)
  }

  throw new Error('WebSocket requires a native browser implementation; custom request options are supported only in Node.js')
}

class WebSocketClient {
  constructor(self, host, port, protocol, options, path) {
    this.self = self
    this.host = host
    this.port = port
    this.protocol = protocol
    this.options = options
    this.path = path || ''
    this.client = null
  }

  async connect() {
    const url = `${this.protocol}://${this.host}:${this.port}${this.path}`

    const client = createWebSocket(url, this.options)
    // Match the previous W3C adapter rather than the native Blob default.
    client.binaryType = 'arraybuffer'

    this.client = client

    return new Promise((resolve, reject) => {
      client.onerror = (error) => {
        if (this.client !== client) return
        this.self.onError(error)
        reject(error.error || new Error('websocket connection failed'))
      }

      client.onclose = (event) => {
        if (this.client !== client) return
        this.self.onClose(event)
        reject(new Error(`websocket connection closed: code: [${event.code}], reason: [${event.reason}]`))
      }

      client.onmessage = (message) => {
        if (this.client !== client) return
        this.self.onMessage(message.data)
      }

      client.onopen = () => {
        if (this.client !== client) return
        if (client.readyState === client.OPEN) {
          this.self.onConnect()
          resolve()
        }
      }
    })
  }

  async close() {
    if (this.client) {
      this.client.close(1000, 'close connection')
    }
  }

  // string
  send(data) {
    this.client.send(data)
  }
}

module.exports = WebSocketClient

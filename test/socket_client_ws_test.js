const assert = require('node:assert/strict')
const EventEmitter = require('node:events')
const {once} = require('node:events')
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const path = require('node:path')
const vm = require('node:vm')
const {WebSocket: NodeWebSocket, WebSocketServer} = require('ws')
const WebSocketClient = require('../src/socket/socket_client_ws')
const SocketClient = require('../src/socket/socket_client')
const ElectrumClient = require('..')

function parent() {
  const events = new EventEmitter()
  return Object.assign(events, {
    onConnect: () => events.emit('connected'),
    onMessage: (data) => events.emit('message', data),
    onClose: (event) => events.emit('closed', event),
    onError: (error) => events.emit('socketError', error),
  })
}

describe('WebSocket transport (local servers)', () => {
  let server
  let webSockets
  let connections

  async function listen(tlsOptions) {
    server = tlsOptions ? https.createServer(tlsOptions) : http.createServer()
    connections = new Set()
    server.on('connection', (socket) => {
      connections.add(socket)
      socket.on('close', () => connections.delete(socket))
    })
    webSockets = new WebSocketServer({server})
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    return server.address().port
  }

  afterEach(async () => {
    if (!server) return
    for (const socket of webSockets.clients) socket.terminate()
    for (const socket of connections) socket.destroy()
    await new Promise((resolve) => webSockets.close(resolve))
    await new Promise((resolve) => server.close(resolve))
    server = null
  })

  for (const transport of ['default', 'custom-options']) {
    const options = transport === 'default' ? undefined : {headers: {'x-electrum-test': 'present'}}

    it(`${transport}: preserves paths, text, binary data and close events`, async () => {
      const port = await listen()
      const self = parent()
      const client = new WebSocketClient(self, '127.0.0.1', port, 'ws', options, '/rpc?token=test')
      const connection = once(webSockets, 'connection')
      const opened = once(self, 'connected')
      await client.connect()
      await opened
      const [peer, request] = await connection

      assert.equal(request.url, '/rpc?token=test')
      assert.ok(client.client instanceof NodeWebSocket)
      if (transport === 'custom-options') {
        assert.equal(request.headers['x-electrum-test'], 'present')
      }
      assert.equal(request.headers['sec-websocket-extensions'], undefined)

      const received = once(peer, 'message')
      client.send('{"id":1,"method":"server.ping"}\n')
      const [body, binary] = await received
      assert.equal(body.toString(), '{"id":1,"method":"server.ping"}\n')
      assert.equal(binary, false)

      const text = once(self, 'message')
      peer.send('{"id":1,"result":null}')
      assert.equal((await text)[0], '{"id":1,"result":null}')

      const inboundBinary = once(self, 'message')
      peer.send(Buffer.from([0, 127, 255]))
      const [data] = await inboundBinary
      assert.ok(data instanceof ArrayBuffer)
      assert.deepEqual(Buffer.from(data), Buffer.from([0, 127, 255]))

      const outboundBinary = once(peer, 'message')
      client.send(Buffer.from([255, 128, 0]))
      const [sent, isBinary] = await outboundBinary
      assert.deepEqual(sent, Buffer.from([255, 128, 0]))
      assert.equal(isBinary, true)

      const closed = once(self, 'closed')
      await client.close()
      const [event] = await closed
      assert.equal(event.code, 1000)
      assert.equal(event.reason, 'close connection')
    })

    it(`${transport}: rejects failed handshakes and permits another attempt`, async () => {
      const port = await listen()
      const upgrade = server.listeners('upgrade')[0]
      server.removeAllListeners('upgrade')
      let accept = false
      server.on('upgrade', (request, socket, head) => {
        if (accept) {
          upgrade.call(server, request, socket, head)
        } else {
          socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        }
      })
      const client = new SocketClient('127.0.0.1', port, 'ws', options)
      client.onError = () => {}
      await assert.rejects(client.connect())
      assert.equal(client.status, 0)
      await assert.rejects(client.connect())
      assert.equal(client.status, 0)
      accept = true
      await client.connect()
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(client.status, 1)
      client.close()
    })

    it(`${transport}: closes a pending handshake`, async () => {
      const port = await listen()
      server.removeAllListeners('upgrade')
      const upgrade = once(server, 'upgrade')
      const client = new SocketClient('127.0.0.1', port, 'ws', options)
      client.onError = () => {}
      const rejected = assert.rejects(client.connect())
      await upgrade
      client.close()
      await rejected
      assert.equal(client.status, 0)
    })
  }

  it('uses custom CA and headers on a verified TLS connection', async () => {
    const cert = fs.readFileSync(path.join(__dirname, 'fixtures/localhost-cert.pem'))
    const key = fs.readFileSync(path.join(__dirname, 'fixtures/localhost-key.pem'))
    const port = await listen({cert, key})
    const connection = once(webSockets, 'connection')
    const self = parent()
    const client = new WebSocketClient(self, '127.0.0.1', port, 'wss', {
      ca: cert,
      headers: {'x-electrum-test': 'verified'},
    })
    await client.connect()
    const [, request] = await connection
    assert.equal(request.headers['x-electrum-test'], 'verified')
    const closed = once(self, 'closed')
    client.close()
    await closed
  })

  it('rejects an untrusted TLS certificate by default', async () => {
    const cert = fs.readFileSync(path.join(__dirname, 'fixtures/localhost-cert.pem'))
    const key = fs.readFileSync(path.join(__dirname, 'fixtures/localhost-key.pem'))
    const port = await listen({cert, key})
    const client = new SocketClient('127.0.0.1', port, 'wss')
    client.onError = () => {}
    await assert.rejects(client.connect())
    assert.equal(client.status, 0)
  })

  it('preserves a custom HTTP agent', async () => {
    const port = await listen()
    const agent = new http.Agent()
    const createConnection = agent.createConnection
    let calls = 0
    agent.createConnection = (...args) => {
      calls++
      return createConnection.apply(agent, args)
    }
    const self = parent()
    const client = new WebSocketClient(self, '127.0.0.1', port, 'ws', {agent})
    try {
      await client.connect()
      assert.equal(calls, 1)
      const closed = once(self, 'closed')
      client.close()
      await closed
    } finally {
      agent.destroy()
    }
  })

  for (const fragmented of [false, true]) {
    it(`rejects oversized ${fragmented ? 'fragmented messages' : 'frames'} before delivery`, async () => {
      const port = await listen()
      const connection = once(webSockets, 'connection')
      const self = parent()
      // A request option must not disable the fixed receive bound.
      const client = new WebSocketClient(self, '127.0.0.1', port, 'ws', {maxPayload: 0})
      let delivered = false
      self.on('message', () => {
        delivered = true
      })
      await client.connect()
      const [peer] = await connection
      const closed = once(peer, 'close')
      if (fragmented) {
        for (let i = 0; i < 17; i++) {
          peer.send(Buffer.alloc(512 * 1024), {fin: i === 16})
        }
      } else {
        peer.send(Buffer.alloc(8 * 1024 * 1024 + 1))
      }
      assert.equal((await closed)[0], 1009)
      assert.equal(delivered, false)
    })
  }

  it('preserves Electrum negotiation, notifications, request failure and reconnect', async () => {
    const port = await listen()
    const methods = []
    webSockets.on('connection', (peer) => {
      peer.on('message', (data) => {
        const request = JSON.parse(data)
        methods.push(request.method)
        if (request.method === 'wait-for-disconnect') {
          peer.close(1011, 'restart')
          return
        }
        const result = request.method === 'server.version' ? ['local', '1.4.2'] : 'ok'
        peer.send(JSON.stringify({id: request.id, result}))
      })
    })
    const client = new ElectrumClient('127.0.0.1', port, 'ws')
    client.onError = () => {}
    try {
      await client.connect('test', '1.4.2')
      assert.deepEqual(methods.slice(0, 2), ['server.version', 'server.banner'])
      assert.equal(await client.server_ping(), 'ok')
      const notification = once(client.events, 'blockchain.headers.subscribe')
      for (const peer of webSockets.clients) {
        peer.send(JSON.stringify({method: 'blockchain.headers.subscribe', params: [{height: 10}]}))
      }
      assert.deepEqual((await notification)[0], [{height: 10}])
      await assert.rejects(client.request('wait-for-disconnect', []), /close connect/)
      assert.equal(client.status, 0)
      await client.connect('test', '1.4.2')
      assert.equal(await client.server_ping(), 'ok')
      assert.equal(client.status, 1)
    } finally {
      client.close()
    }
  })

  it('resets connection state when URL construction fails', async () => {
    const client = new SocketClient('not a host', 1, 'ws')
    await assert.rejects(client.connect())
    assert.equal(client.status, 0)
  })

  it('uses the browser API without loading a Node transport', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/socket/socket_client_ws.js'), 'utf8')
    const context = {
      module: {exports: {}},
      WebSocket,
      require: () => assert.fail('Node transport must not be loaded in a browser'),
    }
    vm.runInNewContext(source, context)
    const BrowserClient = context.module.exports
    const port = await listen()
    const self = parent()
    const client = new BrowserClient(self, '127.0.0.1', port, 'ws', {})
    await client.connect()
    const closed = once(self, 'closed')
    client.close()
    await closed
    const unsupported = new BrowserClient(self, '127.0.0.1', port, 'ws', {ca: 'unsupported'})
    await assert.rejects(unsupported.connect(), /custom request options are supported only in Node.js/)
  })
})

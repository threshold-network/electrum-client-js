# electrum-client-js

JavaScript implementation of [Electrum Protocol] Client.

This is a library that can communicate with the [ElectrumX Server]
on `tcp`, `ssl`, `ws` and `wss` protocols. 

Works in Node.js 22.4 or newer and browsers with native WebSocket support.

Implements methods described in [Electrum Protocol methods] documentation.

Subscriptions and notifications are also supported, please see [example](example/subscribe.js).

## Continuous Integration

Latest build status:
[![CI](https://github.com/keep-network/electrum-client-js/actions/workflows/node.yml/badge.svg?branch=main)](https://github.com/keep-network/electrum-client-js/actions/workflows/node.yml)

## Install

```
npm install --save @keep-network/electrum-client-js
```

## Usage

```js
const ElectrumClient = require('@keep-network/electrum-client-js')

async function main() {
  const client = new ElectrumClient(
    'electrum.bitaroo.net',
    50002,
    'ssl'
  )

  try {
    await client.connect(
      'electrum-client-js', // optional client name
      '1.4.2' // optional protocol version
    )

    const header = await client.blockchain_headers_subscribe()
    console.log('Current header:', header)

    await client.close()
  } catch (err) {
    console.error(err)
  }
}

main()
```
See more [examples](example/).

## WebSocket transport and compatibility

Browsers use their native WebSocket implementation for `ws` and `wss`.
The adapter preserves text messages, ArrayBuffer
binary messages, connection paths, and open/error/close events.

In Node.js, connections use the maintained `ws` transport so HTTP/TLS request
options such as `ca`, `cert`, `key`, `headers`,
`agent`, and `rejectUnauthorized` are not silently discarded. Prefer supplying a
trusted CA instead of disabling certificate verification. Compression is disabled
for this transport. Incoming messages are bounded at 8 MiB, including fragmented
messages, before delivery. This preserves the old Node transport's aggregate
message bound; the old separate 1 MiB frame bound is replaced by the 8 MiB total
bound. Request options cannot disable this limit or enable compression.

Native Node WebSocket currently exposes no configurable pre-assembly receive-size
limit or Node HTTP/TLS options, so replacing the Node transport with it would
weaken this boundary. It is deliberately not selected. Browser receive buffering
continues to be controlled by the browser, as with the previous browser transport.

Browsers cannot configure Node HTTP/TLS options. A nonempty options argument now
fails explicitly in a browser; omit the argument or pass `{}` for ordinary native
WebSocket connections. TCP and TLS sockets remain Node-only.

This replaces the former Node >=6 support promise. Consumers must use Node
>=22.4.0 before adopting this change; the minimum version is tested in CI. The
`websocket` package and its runtime dependency tree are removed, while `ws` remains
as the single required runtime dependency for bounded Node transport.

## Tests

`npm ci --ignore-scripts` installs the locked dependencies. `npm test` runs local
WebSocket and TLS tests without public servers or API credentials, including
custom CA/header/agent settings, oversized messages, handshake failure, cancellation, binary data,
Electrum negotiation, notifications, and reconnect behavior.

`npm run test:integration` runs the existing public Electrum-server tests. These
require network access and `ELECTRUM_API_KEY`; CI runs them only on manual dispatch.


[Electrum Protocol]: https://electrumx.readthedocs.io/en/latest/protocol.html
[Electrum Protocol methods]: https://electrumx.readthedocs.io/en/latest/protocol-methods.html
[ElectrumX Server]: https://electrumx.readthedocs.io/en/latest/

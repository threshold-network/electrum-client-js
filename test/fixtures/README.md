# Local TLS fixture

`localhost-cert.pem` is a self-signed test certificate for localhost and
127.0.0.1. `localhost-key.pem` is its deliberately public test key, generated
solely for the local TLS tests. Do not use either file for deployed services.

The tests supply this certificate as a custom CA and separately verify that the
default transport rejects it without that trust configuration.

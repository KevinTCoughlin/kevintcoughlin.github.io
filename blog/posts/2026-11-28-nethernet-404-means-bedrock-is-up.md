---
published: 2026-11-28T16:00:00Z
tags:
  - github-actions
  - minecraft
  - tips
---

# A 404 from NetherNet meant Bedrock was up

The server-health check treated Bedrock as down on every run while Java stayed up. NetherNet on TCP 19132 answers HTTP 404, and that 404 is the port being up.

I required a RakNet unconnected pong on UDP 19132. The check runs every 15 minutes. This Geyser is 2.12.1 with `transport: nethernet`: signaling is the built-in HTTP server on TCP 19132 (it answers `HTTP/1.1 404 Not Found`) and the game is on UDP 19132. There is no RakNet, so a RakNet unconnected ping never comes back. Every run opened or updated [#135](https://github.com/KevinTCoughlin/minecraft-server/issues/135). The port lines were:

- 25565 up: Paper 26.3, players 0/20
- 19132 down: no RakNet unconnected pong

That issue said Java Edition is TCP 25565 (server-list status). Bedrock/Geyser is UDP 19132 (RakNet unconnected ping). The change is [minecraft-server#137](https://github.com/KevinTCoughlin/minecraft-server/pull/137) ([`51db676`](https://github.com/KevinTCoughlin/minecraft-server/commit/51db676e14c29bbdbd1620eef3c18044ddfe049c)).

## Any HTTP status on TCP 19132 is up

Bedrock counts as up when that TCP port accepts a connection and answers HTTP with any status. `http_fields` in `.github/workflows/server-health.yml` reads the status code from the first line. `HTTP/1.0` and `HTTP/1.1` both count:

```python
def http_fields(data):
    line = data.split(b"\n", 1)[0].rstrip(b"\r")
    parts = line.split(b" ")
    if len(parts) < 2:
        return None
    version, status = parts[0], parts[1]
    if version not in (b"HTTP/1.0", b"HTTP/1.1"):
        return None
    if len(status) != 3 or not status.isdigit():
        return None
    return {
        "name": "NetherNet",
        "extra": f"HTTP {status.decode('ascii')}",
        "via": "nethernet",
    }
```

The probe is this GET:

```python
request = (
    "GET / HTTP/1.1\r\n"
    f"Host: {host}\r\n"
    "Connection: close\r\n"
    "\r\n"
).encode("ascii")
```

`MC_HEALTH_BEDROCK_MODE` accepts `nethernet` (the default), `raknet`, or `either`. An unset `MC_HEALTH_BEDROCK_MODE` defaults to `nethernet` in the workflow. `nethernet` and `either` try signaling first. A RakNet pong is still a fallback and also counts as up. A TCP accept that is not HTTP falls back to RakNet. `raknet` never opens TCP:

```python
def query_bedrock(host, port, timeout, mode):
    # nethernet is this server's Geyser transport. Signaling answers HTTP
    # on TCP, and any status is up. either is the same rule, named for
    # "either protocol". Both fall back to RakNet when signaling does not
    # answer, and that pong also counts as up. raknet never opens TCP.
    if mode != "raknet":
        http = query_nethernet(host, port, timeout)
        if http is not None:
            return http
    return query_raknet(host, port, timeout)
```

The workflow's down-issue text now says:

```text
Bedrock/Geyser signaling is TCP ${MC_HEALTH_BEDROCK_PORT} (NetherNet HTTP, any status). A RakNet unconnected ping on UDP ${MC_HEALTH_BEDROCK_PORT} also counts as up.
```

## The live probe

One live probe of the configured host: `nethernet` reported `19132 up: NetherNet, HTTP 404` with Java still up. `raknet` still reported `19132 down: no RakNet unconnected pong`.

`tests/server-health-driver.py` covers HTTP 404, 200, and 500, a TCP accept that is not HTTP, and all three modes. The driver says why 404 is in that list:

```python
    # NetherNet signaling: any HTTP status on TCP is up, and RakNet is not asked.
    # 404 is what Geyser's built-in server answers for GET /.
    for status in (404, 200, 500):
```

For each of those statuses the stdout has to contain `up: NetherNet, HTTP {status}`, and the RakNet peer's ping count stays 0. The non-HTTP peer sends `b"OK\n"` and is not signaling. With no RakNet pong the port stays down, and the detail contains `no NetherNet HTTP response or RakNet unconnected pong`. `raknet` ignores signaling: HTTP 404 alone is down, and a pong is still up. `either` counts the HTTP answer, and it counts a pong when signaling does not answer.

## What I would repeat

- **Count the 404.** Geyser's built-in server answers `GET /` with `HTTP/1.1 404 Not Found`. Any HTTP status on TCP 19132 is up, and 404 is the status this transport returns.
- **NetherNet has no RakNet pong.** There is no RakNet, the unconnected ping never comes back, and the check opened or updated #135 on every run while Java was up.
- **Keep the pong as a fallback.** `nethernet` and `either` fall back when signaling does not answer, and that pong counts as up. `raknet` sends only the ping. A TCP accept that is not HTTP falls back to RakNet too.

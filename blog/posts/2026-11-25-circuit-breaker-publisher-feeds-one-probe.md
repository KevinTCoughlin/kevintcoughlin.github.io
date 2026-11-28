---
published: 2026-11-25T16:10:00Z
description: Five broken publisher feeds used to open podr-service's breaker for 30 seconds, so search, top podcasts, and podcast pages returned 500 or a stale cache.
tags:
  - python
  - tips
---

# Bad publisher feeds were opening the circuit breaker for iTunes

Five broken publisher feeds in a row used to open the circuit breaker in [podr-service](https://github.com/cascadiacollections/podr-service) for 30 seconds. Search (`/?q=`), top podcasts (`/?q=toppodcasts`), and `/podcast/{id}` share that breaker with iTunes and Podcast Index, so they returned 500, or a cached entry still inside `ttl + STALE_SECONDS`. The log called the publisher failure an iTunes API error.

One `CircuitBreaker` lives on the Worker isolate. `/health` reports it as `circuitBreaker`. `failure()` opens it at `failures >= 5`, and the open state rests for 30 seconds. With `podcastSummaries` on, detail also fetches the iTunes `feedUrl` through `rss_description()`, on the same cached upstream as search, top, and detail. `get()` defaults `proxy` to `True`, so a status of 400 or more was raised as `iTunes API error`. `rss_description()` logs that and returns no summary. `except Exception` still called `failure()`, and a 200 called `success()`, which cleared the counter and closed the breaker. `feed()` already skipped `CachedUpstream`. Its docstring says a caller-supplied URL must not take iTunes down with it.

## Only count failures of the dependency the breaker protects

I stopped counting those fetches in [podr-service#719](https://github.com/cascadiacollections/podr-service/pull/719) ([`bed0cd3`](https://github.com/cascadiacollections/podr-service/commit/bed0cd30dd4dcecbb7927c44db0f20dabc5b2c6a)). They still use the cache. `breaker=False` skips `failure()` and `success()`.

Before:

```python
response, _ = await self.upstream.get(url, TTL_DETAIL, header_only=True)
```

```python
provider = "iTunes" if proxy else "Podcast Index"
raise UpstreamError(f"{provider} API error: {response.status} {response.reason}")
```

```python
except Exception:
    self.circuit.failure()
    raise
self.circuit.success()
```

After, same commit. The comment is on the call in `rss_description()`:

```python
# The URL belongs to the publisher. Counting it on the shared breaker
# would let a few broken feeds rest iTunes and Podcast Index, and the
# failure is not an error from either API.
response, _ = await self.upstream.get(url, TTL_DETAIL, header_only=True, breaker=False)
```

```python
if breaker:
    provider = "iTunes" if proxy else "Podcast Index"
    label = f"{provider} API error"
else:
    label = "Feed error"
raise UpstreamError(f"{label}: {response.status} {response.reason}")
```

```python
except asyncio.CancelledError:
    if probe:
        self.circuit.cancel_probe()
    raise
except Exception:
    if breaker:
        self.circuit.failure()
    raise
if breaker:
    self.circuit.success()
```

`breaker` defaults to `True`, so search, top, and detail still move it. A publisher 404 is now `Feed error: 404`. A connect error or a read timeout raises as itself, and `rss_description()` still logs `RSS description unavailable`. The new test sends 404, 500, 503, a connect error, a read timeout, and 502, then checks the breaker is `"closed"`, `failures` is 0, and `/?q=python` returns 200. A successful fetch leaves a count of 4 where it was, and leaves an open breaker open. iTunes and Podcast Index still share the field `/health` reports, so an outage on either side can still rest the other.

## Half-open should admit one probe

The old `is_open()` checked the rest and let callers through. `get()` fetches when it returns false:

```python
def is_open(self):
    if self.state == "open" and time.time() - self.last_failure >= 30:
        self.state = "half-open"
    return self.state == "open"
```

The call that ends the 30 seconds sets `"half-open"` and gets false back. Every later caller does too, because the return is `self.state == "open"`. They hit upstream together.

`is_open()` now only answers. `"half-open"` stays off upstream, and so does `"open"` while `time.time() - self.last_failure < 30`. A fresh cache hit returns from `get()` before `_fetch`, so the probe stays available. The test uses a fresh entry with `last_failure` 31 seconds ago and checks the state is still `"open"` with no upstream call. The next miss is the probe.

`admit()` reserves that one attempt, and it does not await:

```python
def admit(self):
    """Reserve one upstream attempt. Half-open keeps the rest waiting."""
    if self.state == "closed":
        return True
    if self.state == "open" and time.time() - self.last_failure >= 30:
        self.state = "half-open"
        return True
    return False
```

A second request during the probe gets 500 and `Service temporarily unavailable`, with one upstream call. `failure()` on a failed probe sets `last_failure` to now and opens the breaker again, because the state is `"half-open"`. The following request does not call upstream. The pull request's 503 case checks that.

A cancelled probe has no result to count. `cancel_probe()` returns the state to `"open"` and leaves `last_failure` where it was:

```python
def cancel_probe(self):
    """The probe ended without a result. Leave the rest window where it was."""
    if self.state == "half-open":
        self.state = "open"
```

Otherwise the breaker would sit in `"half-open"`. `is_open()` keeps later callers off upstream there, and `admit()` only starts a probe from `"open"`.

The docstring on `is_open()` says this needs no lock. `admit()` does not await, and a Worker isolate has one event loop, so a second caller cannot pass `admit()` before the state is `"half-open"`. On a cache miss, `get()` calls `admit()` before it awaits the fetch. While the breaker is `"closed"`, `admit()` returns immediately and concurrent misses each still fetch. `refreshing` de-duplicates revalidation only on the `Podcasts` object `fetch()` builds per request.

Only count failures of the dependency the breaker protects. Half-open should admit one probe.

---
published: 2026-11-25T17:18:00Z
tags:
  - golang
  - tips
---

# http.Server.Shutdown doesn't cancel request contexts, so my graceful quit leaked subprocesses

I shut down [lazydeck](https://github.com/KevinTCoughlin/lazydeck) `serve` and the uv, python, ssh, and rsync children were still running. One 30s deadline covered both the HTTP drain and the job reap. [`http.Server.Shutdown`](https://pkg.go.dev/net/http#Server.Shutdown) does not cancel request contexts. It only waits for handlers to return. An open `GET /v1/jobs/{id}/events` stream held that wait, the reap saw an already-expired context, and it cancelled the job without waiting for `execute` to leave `cmd.Run`. Those children are in their own process group, so they outlived the server.

## The stream spends the shared deadline

`shutdownBudget` is 30 seconds. Before [lazydeck#125](https://github.com/KevinTCoughlin/lazydeck/pull/125), `Run` spent it on `Shutdown` and then passed the same context to `jobs.Shutdown`:

```go
case <-ctx.Done():
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownBudget)
	defer cancel()
	for _, srv := range servers {
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("lazydeck serve: graceful HTTP shutdown failed: %v", err)
		}
	}
	// Cancel and wait for in-flight jobs even if HTTP shutdown above
	// didn't finish cleanly: otherwise a deploy's rsync/ssh could keep
	// running detached after this process has already returned/exited.
	if err := apiServer.jobs.Shutdown(shutdownCtx); err != nil {
		log.Printf("lazydeck serve: in-flight job(s) did not finish before shutdown timed out: %v", err)
		return err
	}
```

That comment is the wait I wanted, including after a dirty HTTP shutdown. When the stream holds the drain for the whole 30s, the shared context is already expired, so `jobs.Shutdown` returns `ctx.Err()` and the wait never runs.

`handleJobEvents` stays in the handler until the job is terminal or the request context ends:

```go
if wait == nil {
	return // job is terminal and every event has been sent
}
select {
case <-wait:
case <-r.Context().Done():
	return
}
```

The servers did not set `BaseContext`. When it is nil, [the default is `context.Background()`](https://pkg.go.dev/net/http#Server.BaseContext), so cancelling serve does not cancel `r.Context()`. `Shutdown` closes listeners and idle connections, then waits for active ones to finish. The client holding the event stream is still connected, so the handler does not return, and `Shutdown` sits until `shutdownCtx` expires.

`jobs.Shutdown` still cancels every tracked job. The wait is a `select` on the job goroutines and on `ctx`. An expired context takes the second branch and returns `ctx.Err()`:

```go
for _, j := range jobs {
	j.cancel()
}
done := make(chan struct{})
go func() {
	m.wg.Wait()
	close(done)
}()
select {
case <-done:
	return nil
case <-ctx.Done():
	return ctx.Err()
}
```

That cancel is what kills the process group. `configureCancellation` in `internal/client/process_unix.go` starts `uv` in its own group. `uv` execs Python, which shells out to `ssh` and `rsync`. On cancel, the command `SIGKILL`s the group and then waits, with a 10s `WaitDelay` so a descendant holding a pipe cannot hang the call:

```go
cmd.SysProcAttr.Setpgid = true
cmd.WaitDelay = cancelWaitDelay
cmd.Cancel = func() error {
	return killProcessGroup(cmd)
}
```

`killProcessGroup` is `syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)`. That runs inside `cmd.Run`. `execute` was still blocked there when the process exited, and a child in another process group is not reaped by that exit.

## Give the reap its own 30s, and cancel the stream

[lazydeck#125](https://github.com/KevinTCoughlin/lazydeck/pull/125) ([`408c5ca`](https://github.com/KevinTCoughlin/lazydeck/commit/408c5cacdb8df8292426b45cd9ba5312a3ee3606)) parents every request context on the serve context, on the loopback server and on the optional network server. Cancelling serve ends `r.Context()`, the event handler returns, and the drain is no longer stuck on the stream.

```go
// Parent every request context on the serve context.
// http.Server.Shutdown does not cancel handlers; it only waits for them
// to return. Job SSE streams block in that wait until the request
// context ends, so without this they hold Shutdown until the deadline.
requestBase := func(net.Listener) context.Context { return ctx }
loopbackSrv := &http.Server{
	Handler:           apiServer.Handler(),
	ReadHeaderTimeout: 10 * time.Second,
	BaseContext:       requestBase,
}
```

HTTP still drains first, on its own 30s context, so a handler inside `Submit` publishes the job before the reap waits. The reap then gets a new 30s context. A handler that ignores cancellation can still use up the HTTP budget. That budget is not the one passed to `jobs.Shutdown`, so the wait for `cmd.Run` still happens. The wait is what lets the process-group kill finish before exit.

```go
httpCtx, httpCancel := context.WithTimeout(context.Background(), shutdownBudget)
defer httpCancel()
for _, srv := range servers {
	if err := srv.Shutdown(httpCtx); err != nil {
		log.Printf("lazydeck serve: graceful HTTP shutdown failed: %v", err)
	}
}
jobCtx, jobCancel := context.WithTimeout(context.Background(), shutdownBudget)
defer jobCancel()
if err := apiServer.jobs.Shutdown(jobCtx); err != nil {
	log.Printf("lazydeck serve: in-flight job(s) did not finish before shutdown timed out: %v", err)
	return err
}
```

`TestRunShutdownWaitsForInFlightJobWithEventStreamOpen` holds `GET /v1/jobs/{id}/events` open. Its client blocks in `Deploy` until the job context is cancelled, then sleeps 200ms. `Run` has to return within 5s, and only after that sleep. The old path can sit in `Shutdown` for the full 30s while the stream is open, so the test fails on the previous shutdown code and passes with this change. The pull request's `go test -race ./...` was clean with a stub `uv` on `PATH`. That environment has no `uv`.

## Quitting the TUI leaked the same processes

[lazydeck#126](https://github.com/KevinTCoughlin/lazydeck/pull/126) ([`c8a1fab`](https://github.com/KevinTCoughlin/lazydeck/commit/c8a1fab2c3257681ad5ecf9b1c63cc24bdd8bb6e)) is the quit path. Status, register, deploy, sync-logs, delete, list-games, discover, connection info, and custom commands each used `context.WithTimeout(context.Background(), ...)`. Bubble Tea returns from `Run` without joining those goroutines. The children sit in their own process group, so they kept running after the process exited. Custom commands already set `Setpgid` and `SIGKILL` the group on cancel, same as the client. Their `WaitDelay` is 2s. The client's is 10s.

`q` and Ctrl+C cancel one shared context. Each command's timeout is now a child of it. After the program returns, `main` cancels again and waits:

```go
_, err = p.Run()
// Bubble Tea returns without joining command goroutines. Cancel any
// still in flight and wait until their process groups exit.
m.Shutdown()
return err
```

`Shutdown` waits up to 15s, past the client's 10s `WaitDelay` after `SIGKILL`. Spinner ticks and auto-refresh ticks are not in that wait. `TestQuitTerminatesCustomCommandProcessGroup` runs a shell that backgrounds `sleep 120` and checks the grandchild is gone after quit and `Shutdown`.

## A panic skipped finish

The same pull request covers a job whose run function panics. `finish` is the only path to a terminal state. The panic skipped it, so the job stayed `running`, prune never saw it, and a client on `GET /v1/jobs/{id}/events` waited forever. `releaseDevice` still ran, so the device lock was dropped.

`execute` recovers, logs the panic value, and finishes the job as failed. The job error is a generic internal message. The panic text stays in the serve log. `finish` still runs the completion hook, and it now prunes, so a burst that was still in flight when it was submitted does not sit in memory after it completes. The cap is still 500.

```go
log.Printf("lazydeck: job %s panicked: %v", job.ID, rec)
m.finish(job, Failed, "failed", &Error{
	Kind:    "internal",
	Message: "the devkit operation failed unexpectedly; see the lazydeck serve process log for details",
})
```

`TestRunPanicFinishesAndReleasesTheDevice` panics with `boom secret` and checks that neither word is in the job error.

The shutdown path has to wait until `cmd.Run` returns, on a clock the HTTP drain cannot expire. The children are in another process group, so exiting without that wait leaves them running.

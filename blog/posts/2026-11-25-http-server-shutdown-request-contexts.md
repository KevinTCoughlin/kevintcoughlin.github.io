---
published: 2026-11-25T17:18:00Z
tags:
  - golang
  - tips
---

# http.Server.Shutdown doesn't cancel request contexts

In [lazydeck](https://github.com/KevinTCoughlin/lazydeck), I gave `serve` one 30 second deadline for the HTTP drain and for reaping in-flight jobs. [`http.Server.Shutdown`](https://pkg.go.dev/net/http#Server.Shutdown) waits until handlers return. It leaves their request contexts alone. An open `GET /v1/jobs/{id}/events` stream sat in that wait long enough to expire the deadline, so the job reap cancelled the job and returned without waiting. `execute` was still blocked in `cmd.Run`. The uv, python, ssh, and rsync children are in their own process group, so they kept running after the process exited.

## One deadline, two waits

`shutdownBudget` was the whole shutdown, drain and then reap:

```go
// shutdownBudget bounds how long Run waits, in total, for the HTTP server's
// graceful shutdown and then for in-flight jobs to actually cancel their
// SSH/rsync subprocess (see internal/client/process_unix.go's own 10s
// WaitDelay backstop) before Run returns anyway.
const shutdownBudget = 30 * time.Second
```

`Run` built one context from it and passed that context to both steps:

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

The reap does cancel every tracked job. Then it waits for the goroutines, or for the context, whichever comes first:

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

When that context is already expired, the `select` takes `ctx.Done()` while `execute` is still inside `cmd.Run`. The cancel has been signaled. The process is free to exit.

## The stream that held the drain

[Shutdown](https://pkg.go.dev/net/http#Server.Shutdown) closes listeners, closes idle connections, and waits for the rest to return to idle. A job event stream is in the middle of a response. Its handler returns when the request context ends.

[`BaseContext`](https://pkg.go.dev/net/http#Server.BaseContext) is the parent of incoming request contexts. Left nil, that parent is `context.Background()`. Cancelling the serve context does not reach the stream, so the stream holds `Shutdown` until the 30 second context expires. The reap then runs on that same context.

Both servers now derive request contexts from the serve context:

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

The network server sets the same `BaseContext`. Cancelling serve cancels the stream's request context, the handler returns, and the connection can go idle.

HTTP still drains first, on its own 30 second budget, so a handler inside `Submit` publishes the job before `jobs.Shutdown` waits. A handler that ignores cancellation can still consume that whole budget. The reap gets a new one, and it waits:

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

That wait is what lets the process-group kill finish before exit. `configureCancellation` in `internal/client/process_unix.go` starts the child in its own group and, on cancel, signals the group:

```go
func configureCancellation(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
	cmd.WaitDelay = cancelWaitDelay
	cmd.Cancel = func() error {
		return killProcessGroup(cmd)
	}
}
```

`cancelWaitDelay` is 10 seconds. `killProcessGroup` sends `SIGKILL` to `-pid`, the group. `uv` execs Python, which shells out to `ssh` and `rsync`. Those grandchildren survive the serve process exiting, because they are not in its group. Waiting until `cmd.Run` returns is what reaps them.

`TestRunShutdownWaitsForInFlightJobWithEventStreamOpen` holds the event stream open, cancels serve, and fails if `Run` returns while deploy is still unwinding. The fake deploy sleeps 200 milliseconds after its context is cancelled, so a shutdown that only signals cancel is visible.

The fix is [lazydeck#125](https://github.com/KevinTCoughlin/lazydeck/pull/125) ([`408c5ca`](https://github.com/KevinTCoughlin/lazydeck/commit/408c5cacdb8df8292426b45cd9ba5312a3ee3606)).

## Quitting the TUI leaked the same way

I started the TUI's device commands from `context.Background()`: status, register, deploy, sync-logs, delete, list-games, discover, connection info, and custom commands. Deploy looked like this:

```go
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
defer cancel()
err := cli.Deploy(ctx, dev.Machine, dev.Login, name, dir, false, nil)
```

`q` and Ctrl+C returned from Bubble Tea's `Run` without cancelling those contexts and without waiting. The children sit in their own process group, so they outlived the process too.

They now share one context, created with `context.WithCancel` and stored on the model. `q` and Ctrl+C cancel it, then quit:

```go
case "ctrl+c", "q":
	if m.gate != nil {
		m.gate.cancel()
	}
	return m, tea.Quit
```

Bubble Tea still returns without joining the command goroutines. `main` waits after `Run`:

```go
_, err = p.Run()
// Bubble Tea returns without joining command goroutines. Cancel any
// still in flight and wait until their process groups exit.
m.Shutdown()
return err
```

`Shutdown` cancels that context again and waits. Spinner and auto-refresh ticks are not in the wait, or it would sit on a timer. The cap is 15 seconds, past the client's 10 second `WaitDelay` after `SIGKILL`:

```go
// commandShutdownBudget outlasts the client's 10s WaitDelay after SIGKILL,
// so a descendant holding a pipe open is reaped before the process exits.
const commandShutdownBudget = 15 * time.Second
```

`TestQuitTerminatesCustomCommandProcessGroup` runs a shell that backgrounds `sleep` and checks the grandchild is gone after quit and `Shutdown`.

## A panic skipped finish

In the same change, a panic inside a job's run function skipped `finish`. The job stayed `running`, so it was never pruned, and a client watching its event stream waited. The device lock was still released, because `releaseDevice` is deferred.

`execute` now recovers, logs the panic value, and finishes the job as failed. The job error is a fixed internal message. The panic text stays in the log:

```go
defer func() {
	rec := recover()
	if rec == nil {
		return
	}
	log.Printf("lazydeck: job %s panicked: %v", job.ID, rec)
	m.finish(job, Failed, "failed", &Error{
		Kind:    "internal",
		Message: "the devkit operation failed unexpectedly; see the lazydeck serve process log for details",
	})
}()
```

`finish` also prunes terminal jobs. Queued and running jobs cannot be evicted, so a burst past the cap used to sit until some later `Submit`. The cap is still 500.

`TestRunPanicFinishesAndReleasesTheDevice` panics, checks the job is failed with kind `internal`, and checks the panic text is absent from the job error. `TestPruneOnFinishDropsTerminalJobsWithoutAnotherSubmit` fills the manager past the cap, lets the jobs finish, and expects only 500 to remain with no further submit.

This is [lazydeck#126](https://github.com/KevinTCoughlin/lazydeck/pull/126) ([`c8a1fab`](https://github.com/KevinTCoughlin/lazydeck/commit/c8a1fab2c3257681ad5ecf9b1c63cc24bdd8bb6e)).

If a handler can outlive the deadline you also use to reap subprocesses, give the reap its own context and wait until the goroutine that owns the process has returned. Parent long-lived request contexts on a context you cancel when those handlers should leave. `Shutdown` will keep waiting until they do.

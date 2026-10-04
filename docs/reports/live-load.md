# Load report — the LIVE RELEASES

Status: measured 2026-10-04 · Owner: the LIVE RELEASE lot (step L7) · Source: `genome/scripts/live-load.ts` ·
Raw figures: `genome/out/live-load/results.json`, with the app's log for each level beside it as `server-<N>.log`
(git-ignored, rewritten by every run).

## Summary

The plan sets its targets for **1 000 people in the room on the VPS profile** (app container: 1.5 CPU, 768 MB). All
of them were met in every run. Figures in bold are what the VPS would see, worked out under §2.

| Target (plan, Architecture › Load) | At 1 000 in the room, runs 1 / 2 / 3 | Verdict |
|---|---|---|
| Customer actions (ENTER, PRESS, SECURE, add-ons, PAY, RELEASE), p95 < 200 ms | **78.5 / 86.6 / 91.2 ms** (measured 56.1 / 64.3 / 67.3 ms) | Met |
| Fan-out, from the room in memory to the last phone, p95 < 100 ms | **32 / 32 / 46 ms** (measured 16 / 16 / 23 ms) | Met |
| Memory < 60 % of 768 MB (460.8 MiB), GeoIP database included (+125 MiB) | **367.3 / 357.6 / 352.7 MiB** (the app's own peak: 242.3 / 232.6 / 227.7 MiB) | Met |
| The app's CPU over its busiest five seconds < one core | **0.4 / 0.4 / 0.5 of a core** (measured 0.20 / 0.21 / 0.23) | Met |
| Every answer a 200, no stream refused or dropped, no error in the app's log, the release sold out | 0 · 0 · 0 · 0; SOLD OUT, 25 of 25 confirmed | Met |

**Measured capacity: 1 000 people in the room.** This is the largest level that met every target in every run:

- 500 and 1 000 met them in all three runs.
- 1 500 met them in two runs of three.
- 2 000 met them in none, because memory is over the limit in all three.

`LIVE_ROOM_CAPACITY.inRoom` in `genome/src/server/services/live-insights.ts` is set to 1 000. The console's audience forecast says when the upper end of its range is above that figure. It no longer calls the figure provisional.

## 1. The test

`scripts/live-load.ts` is Node code with no dependency. Each level N runs three processes, as on the VPS:

- **The app.** It is the server's own `createContext`, `buildApp`, logger and LIVE engine, started the way `src/server/index.ts` starts them.
  - It runs with `ORBES_ENV=development`, so the production rate limits apply. That includes the `live` group, which counts per network and per account.
  - It sits behind a trusted proxy. Each phone sends its own `X-Forwarded-For` address on a /24 of its own, so each phone counts as a separate network.
- **The database.** PGlite runs alone in its own process. The app reaches it over a socket, as it reaches PostgreSQL's container on the VPS.
- **The phones.** The test process itself, sending real HTTP through Node's `http` client.

The scenario is the same at every level and uses a fixed seed:

1. **The accounts and the release.**
   - There are N signed-in accounts. A fifth of them own pieces of the model (TITANE, PLATINE, PALLADIUM), so the line's tier order and the club standings read at T0 do real work.
   - The release has 25 pieces in three sizes (9, 8, 8) and two add-ons, at €4 800. It is created and published through the console's service.
   - Its room opens one minute before T0.
2. **The streams.** N viewer streams, one per account, plus the console's live board stream and a boutique board stream. They open over the seconds after the announcement.
3. **The host message.** A new one every second from the announcement to T0. Every pulse then sends every viewer a new room, which is the worst case for the fan-out.
4. **A burst of entries.**
   - Every account ENTERs, each with a size, at a random moment in the first 10 s of the room.
   - For 1 000 that is 100 entries a second. A crowd spread over a five-minute room would arrive thirty times more slowly.
5. **T0.**
   - The door opens and the line is drawn.
   - Each turn is taken on its phone as soon as the stream brings it: PRESS, then SECURE 1.5 s later. Half of the holders add an add-on.
   - Then seven in ten PAY and three in ten RELEASE MY PLACE, which sends the piece at once to the next in line.
   - This goes on until the release is **SOLD OUT** and every stream has ended, 8 to 16 s after T0.

What is measured:

- **Action latency.** From the moment the request is sent to the moment the answer is read, for every customer action.
- **Fan-out.**
  - Every event of a pulse carries the same server time. That time is stamped once the room and the viewers' entries are in memory (`http/live-stream.ts`).
  - The fan-out runs from that stamp to the moment the last phone read the room event. It counts only pulses that reached at least 95 % of the viewers.
  - The whole pulse on the server, database reads included, is reported alongside.
- **Memory.** The app process's peak resident memory, sampled every 250 ms.
- **CPU.** The app's CPU use, second by second.
- **Also reported:**
  - the event loop's delay;
  - the engine's passes;
  - the line drawn at T0;
  - how long each turn took to reach its phone;
  - how long the streams took to connect;
  - the database process's memory.

## 2. The VPS profile on this machine

### CPU

A VPS vCPU is assumed to be **half as fast** as the core used here (`--vps-factor 2`). The basis for that is an Apple
M2 Pro performance core compared with a shared 2–3 GHz server vCPU.

Only what runs on the app's thread is multiplied by 2 before it is compared with its target:

- the fan-out;
- the CPU;
- the app's share of an action. That share is the event loop's p99 delay (how long a request waits for the thread) plus the app's CPU per action. The CPU per action is all of the app's CPU over the run divided by the number of actions, which is an upper bound: 20–24 ms here.

The rest of an action's time is waiting for the database. That part is taken as measured. The factor describes the app's core, not PostgreSQL, and PGlite is already a pessimistic stand-in (below).

Each run prints a calibration figure: a fixed piece of work timed in the app's process (374–461 ms here). It lets other machines be compared with this one.

Restricting the app to the efficiency cores (`taskpolicy -c background`, about 2.4× slower) was tried first and dropped. That restriction is the lowest scheduling class, so anything else running on the machine starves the app. With another workflow's test suites running, the same run swung from met to answers taking 20 s.

### Memory

The app runs with the heap the image's Node 22 would have in a 768 MB container:

- `--max-old-space-size=384`: Node sizes V8's heap from the cgroup limit.
- `--max-semi-space-size=16`: the most V8 12 gives its young generation on 64-bit. Node 24 on this machine would let it grow to 192 MiB, most of it empty.

Before the streams open, the garbage left by seeding the data is collected. The run has no GeoIP database, so the ≈ 125 MiB the VPS app holds for it (DEPLOYMENT §3.4) is added.

### Database

- PGlite has one connection, which every transaction takes in turn; PostgreSQL has a pool of ten. The actions and the pulse's reads wait for that one connection.
- The app itself stays almost idle: event loop p99 at 13–15 ms, its busiest CPU at 0.13–0.34 of a core. It is the database's share of the times that varies, from run to run and with the machine's load.
- PGlite's own process (430–980 MiB) tells nothing about PostgreSQL's memory, and is not compared with any target.
- `--database-url postgres://…` runs the same test on a throwaway PostgreSQL database.

## 3. Results

Three series of four levels were run, under the lock shared with the other workflow's browser suites, so no Chromium suite ran at the same time. Series 3 ran the final script. Series 1 and 2, and the single run below, ran it before two changes. One settled its action rule; their verdicts were worked out again from their recorded figures under it. The other wrote the same owners and pieces through the test support.

The figures were measured on this machine. The bold figures are what the VPS would see, under §2.

| In the room | Actions p95 (app share) → VPS | Fan-out p95 → VPS | Pulse p95, reads included | App peak / with GeoIP | App CPU, busiest 5 s → VPS | Verdict |
|---|---|---|---|---|---|---|
| 500 (run 1) | 79.3 ms (21.0) → **100.3 ms** | 17 → **34 ms** | 68.7 ms | 189.4 / **314.4 MiB** | 0.12 → **0.2** | met |
| 500 (run 2) | 77.5 ms (20.1) → **97.6 ms** | 12 → **24 ms** | 67.5 ms | 191.8 / **316.8 MiB** | 0.12 → **0.2** | met |
| 500 (run 3) | 80 ms (20.7) → **100.7 ms** | 12 → **24 ms** | 61.8 ms | 198.6 / **323.6 MiB** | 0.13 → **0.3** | met |
| **1 000 (run 1)** | 56.1 ms (22.4) → **78.5 ms** | 16 → **32 ms** | 91.9 ms | 242.3 / **367.3 MiB** | 0.20 → **0.4** | **met** |
| **1 000 (run 2)** | 64.3 ms (22.3) → **86.6 ms** | 16 → **32 ms** | 95.1 ms | 232.6 / **357.6 MiB** | 0.21 → **0.4** | **met** |
| **1 000 (run 3)** | 67.3 ms (23.9) → **91.2 ms** | 23 → **46 ms** | 115 ms | 227.7 / **352.7 MiB** | 0.23 → **0.5** | **met** |
| 1 500 (run 1) | 404.2 ms (21.8) → **426 ms** | 29 → **58 ms** | 397 ms | 303.1 / **428.1 MiB** | 0.25 → **0.5** | actions missed |
| 1 500 (run 2) | 72.2 ms (21.8) → **94 ms** | 41 → **82 ms** | 157.2 ms | 288.2 / **413.2 MiB** | 0.26 → **0.5** | met |
| 1 500 (run 3) | 76.4 ms (21.3) → **97.7 ms** | 28 → **56 ms** | 129 ms | 288.2 / **413.2 MiB** | 0.25 → **0.5** | met |
| 2 000 (run 1) | 130.9 ms (23.1) → **154 ms** | 34 → **68 ms** | 170.7 ms | 344.1 / **469.1 MiB** | 0.34 → **0.7** | memory missed |
| 2 000 (run 2) | 759.2 ms (23.6) → **782.8 ms** | 43 → **86 ms** | 235.7 ms | 371.4 / **496.4 MiB** | 0.34 → **0.7** | actions and memory missed |
| 2 000 (run 3) | 161.6 ms (22.8) → **184.4 ms** | 33 → **66 ms** | 174.9 ms | 378.4 / **503.4 MiB** | 0.34 → **0.7** | memory missed |

There was also a single run at 1 000 between series 2 and 3, on a busier machine: load average 6.3 at its start. It also met every target. Actions were 128.9 ms (app share 23.0 ms), so **151.9 ms** on the VPS. The fan-out was 22 ms and the app's peak 238.8 MiB, so **363.8 MiB** with GeoIP.

At every level and in every run:

- every stream opened, at p95 in 6–22 ms (once 170 ms);
- no stream was refused or dropped, and every answer was a 200;
- the app's log has no error;
- the release sold out, with all 25 pieces confirmed;
- the event loop's p99 delay stayed between 11.8 and 15.4 ms.

At 1 000 people:

- One engine pass of 83–106 ms drew the line.
- A turn reached its phone within one pulse of being given: p95 960–1 060 ms. That is the stream's one-second pulse, as designed.
- The app started at 167–187 MiB of memory and peaked 41–73 KiB per viewer above that. At the peak, V8's heap was 98–100 MiB, with 63–68 MiB in use. The other 129–142 MiB are the code, `tsx`'s module cache and the sockets' buffers.

**Where the limit lies.** Above 1 000 people the misses come from two places:

- **Memory.** It grows by 85–100 KiB per viewer at 1 500 and 2 000. At 2 000, with GeoIP, it reaches 469–503 MiB, above the 460.8 MiB limit in every run.
- **The burst of entries.** In one run at 1 500 and one at 2 000, the 150 to 200 ENTERs a second queued on PGlite's single connection, and ENTER p95 rose to 412 and 766 ms. In both runs the app's busiest CPU stayed at 0.25 and 0.34 of a core.

The fan-out is never the limit: at most 43 ms at 2 000, which is 86 ms on the VPS.

## 4. What the test changed in the app

The first measurements showed where the app's own time went: to `deliver` in `http/live-stream.ts`. On every pulse it serialised the same room once or twice per viewer, and wrote two chunks to each viewer.

The hub now does two things differently:

- It builds the room's event, and the board's, **once per pulse**, and stamps the same server time on every event of that pulse.
- It sends each stream **one write** per pulse: the room, plus that viewer's own entry when it has changed.

The bytes a phone receives are unchanged. `test/api/live.test.ts` checks this with six viewers: one serialisation of the room, six chunks, the same room event in each, and one `you` event. The same test fails on the previous hub, which serialised the room 12 times.

## 5. The edge

`deploy/vps/Caddyfile` makes one change. It will be proposed to "AI Stack Atlas planning" before deployment D and is **not deployed**.

- **The streams are kept out of `encode`.** The three stream routes are `/api/v1/live/:id/stream`, `/api/v1/live/:id/board/stream` and `/api/admin/live/:id/stream`, listed in `LIVE_STREAM_ROUTES`. Every other response is still compressed.
- **The streams are flushed at once** (`flush_interval -1`) by a `reverse_proxy` of their own.
- **Both proxies share one upstream snippet**, `app_upstream`. There is no `handle` block, so the admin allowlist still runs before the console's stream.

`genome/test/ops/vps-stack.test.ts` checks:

- the matcher and its complement;
- that there is a single `encode`;
- the flush;
- that the pattern matches exactly `LIVE_STREAM_ROUTES`;
- that `LIVE_STREAM_ROUTES` is exactly the list of routes the app registers whose path ends in `/stream`.

The silhouette upload already belongs to `MEDIA_UPLOAD_ROUTES` and to the upload rule (step L4).

## 6. Running it again

```bash
cd genome
npx tsx scripts/live-load.ts                                   # 500, 1 000, 1 500, 2 000; about 7 minutes
npx tsx scripts/live-load.ts --levels 1000 --vps-factor 2.5    # one level, assuming a slower VPS
npx tsx scripts/live-load.ts --database-url postgres://user:pass@127.0.0.1:5432/orbes_load   # a THROWAWAY database
```

Close other heavy work first: every figure depends on what else the machine is running.

## Machine and conditions

| | |
|---|---|
| CPU | Apple M2 Pro, 10 cores (6 performance, 4 efficiency) |
| Memory | 16 GiB |
| OS | macOS 15.1 (Darwin 24.1.0) |
| Runtime | Node v24.16.0. The image runs Node 22; the heap flags of §2 stand in for it |
| Database | PGlite 0.5.8, in its own process, over a Unix socket |
| Code | branch `orbes-live` at step L7 (after `fc0771c`) |
| Runs | 2026-10-04 (CEST): series 1 at 23:19, series 2 at 23:26, the single run at 1 000 at 23:33, series 3 at 23:36 |
| Machine load | Another workflow's work ran at the same time, except its Chromium suites (shared lock); load averages 2.7–6.9 |

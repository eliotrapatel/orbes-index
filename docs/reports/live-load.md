# Load report — the LIVE RELEASES

Status: measured 2026-10-05 · Owner: LIVE RELEASE+ (its completeness audit, step PLUS-A) · first measured 2026-10-04
by the LIVE RELEASE lot (step L7) · Source: `genome/scripts/live-load.ts` · Raw figures:
`genome/out/live-load/results-<series>.json`, with the app's log of the last series' levels beside them as
`server-<N>.log` (git-ignored, rewritten by every run).

## Summary

LIVE RELEASE+ changed what the room does at each step: the access rules read at each check (the releases taken part in,
a segment read live), the orders made at PAY (a piece held in stock under its reference's lock, or a piece to make that
reserves an ORBES identity), the doors of the after-room read with the room's last entries, and the after-room itself, a
second door that opens for all its guests at the same second. The test was extended to all of them (§1) and run again
against the plan's targets for **1 000 people in the room on the VPS profile** (app container: 1.5 CPU, 768 MB).

| Target (plan, Architecture › Load) | At 500, runs 1 / 2 / 3 | At 1 000, runs 1 / 2 / 3 |
|---|---|---|
| Customer actions (I'LL BE THERE, ENTER, PRESS, SECURE, add-ons, PAY, RELEASE, in both rooms), p95 < 200 ms | **111.8 / 72.7 / 106.9 ms**: met | **1 972.9 / 1 798.1 / 858.3 ms**: not met |
| Fan-out, from the room in memory to the last phone, p95 < 100 ms | **28 / 26 / 30 ms**: met | **44 / 50 / 74 ms**: met |
| Memory < 60 % of 768 MB (460.8 MiB), GeoIP database included (+125 MiB) | **325.3 / 323.9 / 323.4 MiB**: met | **403.3 / 361.7 / 380.1 MiB**: met |
| The app's CPU over its busiest five seconds < one core | **0.4 / 0.4 / 0.5 of a core**: met | **0.9 / 0.8 / 0.7 of a core**: met |
| Every answer a 200, no stream refused or dropped, no error in the app's log, both rooms sold out, one order per piece | met in every run | met in every run |

**Measured capacity: 500 people in the room.** This is the largest level that met every target in every run:

- 500 met them in all three runs.
- 750 met them in two runs of three: in the first, the after-room's door put the actions' p95 at 1 043 ms.
- 1 000 met them in none: the after-room's door every time. **The room itself held 1 000 in two runs of three** (its
  own actions at p95 99 and 113 ms); in the first, the announcement's I'LL BE THERE and streams queued on the database.
- 1 500 met them in none, its app's CPU at one core or more on the VPS in all three.

The LIVE RELEASE lot measured **1 000 people in the room** for the LIVE RELEASE alone on 2026-10-04 (deployment D's
runbook states it). `LIVE_ROOM_CAPACITY.inRoom` in `genome/src/server/services/live-insights.ts` is now
set to 500: the console's audience forecast says when the upper end of its range is above it. Deployment E's runbook
states it (§1.0).

**Where the limit is.** Not the app: its CPU stays under one core on the VPS up to 1 000 people, its memory far under
its limit, the fan-out under its target. It is the database's single connection in this test (§2), at the
after-room's door: at its T0 every guest reads the after-room's page, opens its stream, then ENTERs, about forty
statements for one guest against about twenty for an entry in the room, all within seconds. At 1 000 people the door's
page read waited 0.75 to 1.5 s at p95. PostgreSQL, with its pool of ten, runs the page reads and the streams beside the
entries; this test cannot show by how much, and the figure stays the conservative one until it is measured on
PostgreSQL (`--database-url`, §6).

## 1. The test

`scripts/live-load.ts` is Node code with no dependency. Each level N runs three processes, as on the VPS:

- **The app.** It is the server's own `createContext`, `buildApp`, logger and LIVE engine, started the way `src/server/index.ts` starts them.
  - It runs with `ORBES_ENV=development`, so the production rate limits apply. That includes the `live` group, which counts per network and per account.
  - It sits behind a trusted proxy. Each phone sends its own `X-Forwarded-For` address on a /24 of its own, so each phone counts as a separate network.
- **The database.** PGlite runs alone in its own process. The app reaches it over a socket, as it reaches PostgreSQL's container on the VPS.
- **The phones.** The test process itself, sending real HTTP through Node's `http` client.

The scenario is the same at every level and uses a fixed seed:

1. **The accounts, the release and its rules.**
   - There are N signed-in accounts. A fifth of them own pieces of the model (TITANE, PLATINE, PALLADIUM), so the line's tier order and the club standings read at T0 do real work.
   - Every account entered a draw that was drawn before: each has taken part in one release.
   - A segment holds the collectors who took part in a release and were active in the last 30 days.
   - The release has 25 pieces in three sizes (9, 8, 8) and two add-ons, at €4 800, created and published through the console's service, its room opening one minute before T0. It admits the collectors who have taken part in a release **and** are members of the segment: both rules are read at every check (the stream, I'LL BE THERE, ENTER, SECURE). It has a surprise in every box and the question after.
   - **Its stock**: at its location, size 52 has its 9 pieces made in advance, size 54 4 of its 8, size 56 none. PAY then holds a piece in stock under its reference's lock (13 orders), or makes a piece to make that reserves an ORBES identity (12).
   - **Its after-room**: a model of its own, 25 pieces in three sizes and an add-on, none in stock (25 pieces to make), opening one minute after the sell-out (the console's least) for five minutes.
2. **The streams.** N viewer streams, one per account, plus the console's live board stream and a boutique board stream. They open over the seconds after the announcement. **Half of the accounts say I'LL BE THERE** over the same seconds.
3. **The host message.** A new one every second from the announcement to T0. Every pulse then sends every viewer a new room, which is the worst case for the fan-out.
4. **A burst of entries.**
   - Every account ENTERs, each with a size, at a random moment in the first 10 s of the room.
   - For 1 000 that is 100 entries a second. A crowd spread over a five-minute room would arrive thirty times more slowly.
5. **T0.**
   - The door opens and the line is drawn.
   - Each turn is taken on its phone as soon as the stream brings it: PRESS, then SECURE 1.5 s later. Half of the holders add an add-on.
   - Then seven in ten PAY and three in ten RELEASE MY PLACE, which sends the piece at once to the next in line.
   - This goes on until the release is **SOLD OUT** and every stream has ended, 8 to 18 s after T0.
6. **The after-room.**
   - The entries the sell-out ended read its second door in their last frame: each pulse reads the doors of the room's ENDED entries.
   - At its T0, every guest opens it at a random moment of the next 10 s, as the door appears to all of them at once: the after-room's page (`GET /api/v1/live/:id/after-room`), then its stream.
   - Each ENTERs with a size 2 to 8 s later, the time to read a page it had not seen: another model, its price, its sizes to choose from.
   - The turns run as in the room until the after-room is **SOLD OUT**, 10 to 29 s after its T0. A guest who comes after its size, or the after-room, sold out is answered so (409 `LIVE_SIZE_SOLD_OUT` or `LIVE_OVER`, or a stream's 204): it is counted as late, not as a failure.

What is measured:

- **Action latency.** From the moment the request is sent to the moment the answer is read, for every customer action in both rooms, and for each room apart. The after-room's page read is reported beside them.
- **Fan-out.**
  - Every event of a pulse carries the same server time. That time is stamped once the room and the viewers' entries are in memory (`http/live-stream.ts`).
  - The fan-out runs from that stamp to the moment the last phone read the room event. It counts only pulses that reached at least 95 % of the room's viewers, in each room.
  - The whole pulse on the server, database reads included, is reported alongside.
- **Memory.** The app process's peak resident memory, sampled every 250 ms.
- **CPU.** The app's CPU use, second by second.
- **What the rooms left in the database**, read once they are over: the orders (one per piece confirmed, 25 and 25; 13 held in stock, 37 pieces to make, each with its reserved identity), the after-room's guests, the event journal's rows.
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
- the app's share of an action. That share is the event loop's p99 delay (how long a request waits for the thread) plus the app's CPU per action. The CPU per action is all of the app's CPU over the run divided by the number of actions and page reads, which is an upper bound: 15.5–20.3 ms here.

The rest of an action's time is waiting for the database. That part is taken as measured. The factor describes the app's core, not PostgreSQL, and PGlite is already a pessimistic stand-in (below).

Each run prints a calibration figure: a fixed piece of work timed in the app's process (430–511 ms here). It lets other machines be compared with this one.

Restricting the app to the efficiency cores (`taskpolicy -c background`, about 2.4× slower) was tried first and dropped. That restriction is the lowest scheduling class, so anything else running on the machine starves the app. With another workflow's test suites running, the same run swung from met to answers taking 20 s.

### Memory

The app runs with the heap the image's Node 22 would have in a 768 MB container:

- `--max-old-space-size=384`: Node sizes V8's heap from the cgroup limit.
- `--max-semi-space-size=16`: the most V8 12 gives its young generation on 64-bit. Node 24 on this machine would let it grow to 192 MiB, most of it empty.

Before the streams open, the garbage left by seeding the data is collected. The run has no GeoIP database, so the ≈ 125 MiB the VPS app holds for it (DEPLOYMENT §3.4) is added.

### Database

- PGlite has one connection, which every transaction takes in turn; PostgreSQL has a pool of ten. The actions and the pulse's reads wait for that one connection.
- The app itself stays almost idle: event loop p99 at 11.5–14 ms, its busiest CPU at 0.19–0.44 of a core up to 1 000 people. It is the database's share of the times that varies, from run to run and with the machine's load.
- PGlite's own process (650–935 MiB) tells nothing about PostgreSQL's memory, and is not compared with any target.
- `--database-url postgres://…` runs the same test on a throwaway PostgreSQL database.

## 3. Results

Three series of four levels were run on 2026-10-05, under the lock shared with the other workflow's browser suites, so no Chromium suite ran at the same time; that workflow's other work did (load averages 4.2–7.5). Series 3 ran the final script. Series 1 and 2 ran it before one change to how a guest is counted who finds the after-room over at its page (late, not refused): neither had such a guest.

The figures were measured on this machine. The bold figures are what the VPS would see, under §2. The room and the after-room are their own actions' p95, as measured.

| In the room | Actions p95 (app share) → VPS | The room / the after-room / its page | Fan-out p95 → VPS | App peak / with GeoIP | App CPU, busiest 5 s → VPS | Verdict |
|---|---|---|---|---|---|---|
| 500 (run 1) | 95.5 ms (16.3) → **111.8 ms** | 95.4 / 113.8 / 112 ms | 14 → **28 ms** | 200.3 / **325.3 MiB** | 0.22 → **0.4** | met |
| 500 (run 2) | 57.2 ms (15.5) → **72.7 ms** | 76.6 / 55.9 / 29.1 ms | 13 → **26 ms** | 198.9 / **323.9 MiB** | 0.19 → **0.4** | met |
| 500 (run 3) | 89.8 ms (17.1) → **106.9 ms** | 129.3 / 83.6 / 42.6 ms | 15 → **30 ms** | 198.4 / **323.4 MiB** | 0.23 → **0.5** | met |
| 750 (run 1) | 1 026.7 ms (16.7) → **1 043.4 ms** | 65.6 / 1 146.4 / 935.9 ms | 20 → **40 ms** | 222.2 / **347.2 MiB** | 0.36 → **0.7** | actions missed |
| 750 (run 2) | 177.6 ms (16.1) → **193.7 ms** | 140.5 / 198.9 / 180.7 ms | 20 → **40 ms** | 219.7 / **344.7 MiB** | 0.25 → **0.5** | met |
| 750 (run 3) | 135.5 ms (16.0) → **151.5 ms** | 64.9 / 178.5 / 172 ms | 14 → **28 ms** | 243.7 / **368.7 MiB** | 0.25 → **0.5** | met |
| 1 000 (run 1) | 1 956.4 ms (16.5) → **1 972.9 ms** | 2 089.6 / 1 713.9 / 1 350.2 ms | 22 → **44 ms** | 278.3 / **403.3 MiB** | 0.44 → **0.9** | actions missed |
| 1 000 (run 2) | 1 781.9 ms (16.2) → **1 798.1 ms** | 99.3 / 1 874.3 / 1 476.6 ms | 25 → **50 ms** | 236.7 / **361.7 MiB** | 0.42 → **0.8** | actions missed |
| 1 000 (run 3) | 840.7 ms (17.6) → **858.3 ms** | 112.9 / 938.7 / 754.7 ms | 37 → **74 ms** | 255.1 / **380.1 MiB** | 0.36 → **0.7** | actions missed |
| 1 500 (run 1) | 9 460.2 ms (20.3) → **9 480.5 ms** | 3 677.1 / 9 568.8 / 6 978.6 ms | 47 → **94 ms** | 332.2 / **457.2 MiB** | 0.59 → **1.2** | actions and CPU missed |
| 1 500 (run 2) | 5 671.3 ms (18.8) → **5 690.1 ms** | 2 011.7 / 5 747.2 / 4 454.1 ms | 33 → **66 ms** | 277.6 / **402.6 MiB** | 0.55 → **1.1** | actions and CPU missed |
| 1 500 (run 3) | 5 911.3 ms (17.7) → **5 929 ms** | 2 274.1 / 6 012.1 / 3 477.9 ms | 43 → **86 ms** | 273.8 / **398.8 MiB** | 0.50 → **1.0** | actions and CPU missed |

At every level and in every run:

- every stream opened, in the room and in the after-room; none was refused or dropped;
- every answer was a 200, but the after-room's late guests' (above);
- the app's log has no error;
- the release sold out with all 25 pieces confirmed, and so did its after-room;
- the orders were exactly the pieces confirmed: 25 and 25, 13 held in stock, 37 pieces to make, each with its reserved ORBES identity, none other; the event journal holds 126 rows for them;
- the after-room remembered every entry the sell-out ended (462 to 465 at 500, 967 or 968 at 1 000) and only they read its door.

**At 1 000 people**, the room alone:

- One engine pass of 81–130 ms drew the line.
- A turn reached its phone within one pulse of being given: p95 763–1 099 ms.
- I'LL BE THERE answered at p95 84–92 ms in runs 2 and 3. In run 1, the 500 I'LL BE THERE and the 1 000 streams of the announcement waited on the database: I'LL BE THERE at p95 2.1 s, the streams connecting at p95 2.2 s, and the burst of entries after them.

**The after-room's door.** Its page read, its stream and its ENTER are each light, but they come together: at 750 the page read stayed at p95 172–181 ms twice and reached 936 ms once; at 1 000, 755–1 477 ms. The after-room's own fan-out stayed at 9–64 ms.

## 4. What the test changed in the app

### The LIVE RELEASE (step L7)

The first measurements showed where the app's own time went: to `deliver` in `http/live-stream.ts`. On every pulse it serialised the same room once or twice per viewer, and wrote two chunks to each viewer.

The hub now does two things differently:

- It builds the room's event, and the board's, **once per pulse**, and stamps the same server time on every event of that pulse.
- It sends each stream **one write** per pulse: the room, plus that viewer's own entry when it has changed.

The bytes a phone receives are unchanged. `test/api/live.test.ts` checks this with six viewers: one serialisation of the room, six chunks, the same room event in each, and one `you` event. The same test fails on the previous hub, which serialised the room 12 times.

### LIVE RELEASE+ (this measurement)

The first runs at 1 000 put the after-room's door at 3 s. The database's process was then timed statement by statement during the door (how long each held PGlite), and three reads of the hot path changed:

- **A guest's place in the after-room** (`afterRoomPlace`, `services/after-room.ts`), read by the door, the stream and every action of a guest. It joined the after-room's guests to their entries, a pass over every guest. It now goes from the account's entry in the release (`live_entries_drop_account_key`) to its guest row (`after_room_guests_entry_key`): two lookups whatever the number of guests, 0.48 → 0.24 ms a read on PGlite.
- **The line ahead of an entry** (`liveEntryViews`, `services/live.ts`), read with an entry after each of its actions. It numbered every QUEUED entry of the release for one entry; it now reads only the sizes of the entries asked about, up to the last of their places. The same figures; 0.57 → 0.36 ms a read.
- **The access read before the release's row** (`accessAhead`, `services/live.ts`). I'LL BE THERE, ENTER and SECURE read the account against the release's rules, the releases taken part in and the segment included, before they take the release's row (FOR NO KEY UPDATE for every ENTER): an announced release's rules no longer change, and a segment is read live either way. The row is held for three to five statements fewer, and on PostgreSQL the entries of one release wait less for each other.

Their behaviour is the same: the suites of the LIVE RELEASES (`test/services/live*.test.ts`, `test/api/live*.test.ts`, `test/services/segments.test.ts`) pass unchanged.

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
npx tsx scripts/live-load.ts                                   # 500, 1 000, 1 500, 2 000; about 14 minutes
npx tsx scripts/live-load.ts --levels 500,750,1000,1500       # the levels of this report
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
| Code | branch `orbes-plus` at step PLUS-A (after `4ea1a11`) |
| Runs | 2026-10-05 (CEST): series 1 at 18:01, series 2 at 18:12, series 3 at 18:37 |
| Machine load | Another workflow's work ran at the same time, except its Chromium suites (shared lock); load averages 4.2–7.5 |

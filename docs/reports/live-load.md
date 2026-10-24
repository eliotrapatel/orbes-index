# Load report — the LIVE RELEASES

Status: measured 2026-10-05; a paced release of 5 000 measured 2026-10-21 (§7), its queue page lightened the same day (§7.5); ONE QUEUE's 5 000 measured 2026-10-23 (§8) · Owner: LIVE RELEASE+ (its
completeness audit, step PLUS-A), the macro lot M1 for §7 (step M1.6), and lot Q1 for §8 (step Q1.4) · first measured 2026-10-04
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

**With a pace (§7, 2026-10-21).** A LIVE release can now admit X buyers every Y minutes; the others wait on the queue
page. A local run of **5 000 people with a pace of 250 every minute**, twice on PGlite, held the queue exactly: 20 batches
of 250, each on its minute, the TEST REPORT's PACE check passed, all 4 750 people who waited let in by their own batch
at the time their page first gave them, no answer other than 200, no stream lost. It did not hold the VPS profile's
targets for one app container: the app's memory reached 964 and 1 149 MiB with 5 000 streams open, above the
container's 768 MB, its CPU about 1.9 cores on the VPS, and the queue's frames reached the last waiting phone at
p95 270 and 266 ms on the VPS profile, above the 100 ms fan-out target. The measured capacity of the room above (500) is unchanged.
The real check is the TEST ENTRANTS run of 5 000 on production (§7.4).

**The queue page lightened (§7.5, the same day).** Only the entry whose batch is the next one now keeps its stream; the
others read their state every 10 s to a minute. Three more runs of 5 000 held the queue exactly, with no answer other
than 200 and no stream lost; after T0 the app held at most 454 to 786 streams, its CPU 1.1 to 1.4 cores on the VPS. Its
footprint, what macOS charges the process, stayed at 380–567 MiB (**505–692 MiB with GeoIP: under the 768 MB
container**, above the 60 % margin); its resident size, which also counts memory already given back, still read
857–930 MiB. The state reads now weigh on PGlite's one connection instead: the actions behind the pace at p95 0.5 to
1.5 s.

**ONE QUEUE (§8, 2026-10-23).** Since lot Q1 every LIVE release has a pace and a hold, its batches give the turns
themselves, and each phone reads only its own figures. A local run of **5 000 people at 250 turns every minute after
a hold of 2 minutes**, on PGlite, held the queue exactly: 20 batches of exactly 250, each on its minute from T0 + the
hold, the PACE check passed, all 5 000 served, every turn to a phone that had read it was next, no reading with a
figure of the pace, no answer other than 200. It did not hold the VPS profile's targets: the actions behind the pace
at p95 2.6 s (250 SECUREs arriving together on PGlite's one connection, where §7's batches gave 25 turns), the
fan-out at p95 230 ms on the VPS, the memory 731 MiB resident (591 MiB footprint), the CPU 1.5 cores on the VPS.

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
npx tsx scripts/live-load.ts --one-queue --pace 250,1 --hold 2 --levels 5000   # ONE QUEUE (§8); about 28 minutes
```

Close other heavy work first: every figure depends on what else the machine is running.

## 7. With a pace: 5 000 people in the queue

*Since lot Q1 (§8) the admission and the queue frame described here are gone, and `--pace` alone runs the one queue.*

The macro lot M1 (scope W2 and W4, 2026-10-20) gives a LIVE release a pace: **X buyers admitted every Y minutes**,
counted across the whole release. From T0, the people not yet admitted wait on the queue page, which shows their place
and an estimated time of entry, until their batch lets them into the room.

`--pace X,Y` runs the test of §1 with a pace, as the plan asks: `--pace 250,1 --levels 5000`. **This is a local
measurement, on PGlite, on this machine.** It is not a measurement of the VPS.

### 7.1 What the paced run does differently

- **The release** has a pace of 250 every minute. For 5 000 people that is 20 batches: the first at T0, the last at
  T0 + 19 minutes.
- **The door.** The room opens 5 minutes before T0, the console's default. The streams and I'LL BE THERE come over the
  2 minutes before the room opens. The entries come over the room's first 4 minutes.
  - The first try used the door of §1 (10 seconds of entries, a room of one minute). At 5 000 it collapsed before T0
    on PGlite's one connection: every ENTER timed out after 30 s, 3 399 of the 5 000 streams were refused, and only 64
    entries were placed. The pace meters the room, not the door, so the door was given the minutes the house gives it.
- **The turns.** Until the last batch, each turn is taken (PRESS, SECURE, an add-on for half) and then given back with
  RELEASE MY PLACE, so the release lasts until every batch is in. From the last batch on, the phones act as in §1
  (seven in ten PAY) and the release sells out.
- **No after-room.** A paced release is published without one. The pace meters the release's line, not the
  after-room's door, which would open to the thousands the sell-out ended at the same second. That door was measured
  without a pace (§3).
- **Measured besides:**
  - **the queue's frames:** from each frame's time on the server to the last waiting phone that read it;
  - **every batch on the server,** against the plan: exactly 250, each at T0 + (k − 1) minutes to the millisecond, and
    the TEST REPORT's own PACE check run on the release's entries and audit log;
  - **the queue on the phones:** every phone that waited was let in, none from a place beyond 250, at the time its
    page first estimated, and how long its admission took to reach it.
- **The action target** is held against the actions behind the pace (the turns, PAY, RELEASE). The door's actions,
  before T0, are reported beside them.

### 7.2 Results

Two runs on 2026-10-21, at 05:35 and 06:03 Paris, under the lock shared with the other workflow's browser suites.
That workflow's other work ran at the same time (one-minute load averages 2.8–8.2 in run 1, 3.5–12.3 in run 2).

**The queue.** It held exactly in both runs. The tool's row "The queue held" judges that exactness only (the
batches, the PACE check, the phones) and reads met for both; the queue's frames have their own row against the fan-out
target, below. Both runs printed NOT MET on "The queue held", because the tool then folded the frames' fan-out into it;
it has since been split, and the figures in their results.json read met for the exactness.

| | Run 1 | Run 2 |
|---|---|---|
| Batches on the server | 20 of 20, each 250, each on its minute to the millisecond | the same |
| The engine wrote each batch after its time | p95 349 ms · max 702 ms | p95 308 ms · max 480 ms |
| The TEST REPORT's PACE check | passed | passed |
| People who waited / let in by their batch | 4 750 / 4 750 | 4 750 / 4 750 |
| Let in from a place beyond 250 | 0 | 0 |
| Let in at the time their page first gave | 4 750 | 4 750 |
| Their admission on the phone, after the batch's time | p50 683 · p95 1 082 · max 1 257 ms | p50 629 · p95 1 063 · max 1 114 ms |
| Streams | 5 000 open · 0 refused · 0 dropped | the same |
| Answers other than 200 · errors in the app's log | 0 · 0 | 0 · 0 |
| The end | SOLD OUT 19 min 12 s after T0, 25 confirmed | SOLD OUT 19 min 16 s after T0, 25 confirmed |
| The orders | 25: 13 held in stock, 12 waiting for stock | the same |

**The targets of one app container (1.5 CPU, 768 MB), on the VPS profile of §2.** The bold figures are what the VPS
would see under §2: the app's thread taken twice as slow, and the GeoIP database added to the memory.

| Target | Run 1 | Run 2 | Verdict |
|---|---|---|---|
| Actions behind the pace, p95 < 200 ms | 556.6 → **640.2 ms** | 544.3 → **627.7 ms** | not met |
| The door before T0 (I'LL BE THERE, ENTER), for information | p95 175.9 ms | p95 176.2 ms | |
| Fan-out of the room, p95 < 100 ms | 94 → **188 ms** | 93 → **186 ms** | not met |
| Fan-out of the queue's frames, p95 < 100 ms | 135 → **270 ms** | 133 → **266 ms** | not met |
| Memory with GeoIP, < 460.8 MiB | 964 → **1 089 MiB** | 1 149 → **1 274 MiB** | not met |
| CPU, busiest five seconds, < 1 core | 0.97 → **1.9** | 0.93 → **1.9** | not met |

### 7.3 What it means

- **The pace works at 5 000.** The batches are exact, the line's order is kept, the estimated times are right, and
  nobody is lost. This is the scope's "Done when" for W2 and W4, measured locally.
- **One app container is not shown to hold 5 000 open streams.** The pace lets people into the room in batches. Every
  person on the queue page still holds a stream for the whole release.
  - **Memory.** 149.6 and 186.8 KiB per viewer. At the peak, 787 and 963 MiB were outside V8's heap: the process's
    native memory, which grew with the 5 000 connections. That is above the 768 MB container. The run measures macOS; Linux in the
    container is not measured here. (§7.5 measured it again: the resident size did not follow the streams, and most of
    it was memory the allocator had already given back, which macOS still counts as resident.)
  - **The pulse.** Once a second, the server reads the entries of every viewer of the release in one read: the pulse
    took 513 and 509 ms at p50 for 5 000 viewers, against PGlite's one connection. The number of reads stays the same
    whatever the audience, but that read's rows grow with it, and at 5 000 they weigh.
  - **The actions.** A batch lets 250 people in at the same second, and the 25 pieces give 25 turns at once. Their 25
    SECUREs arrive together 1.5 s later, and on one connection the last waits for the other 24: SECURE p95 621 and
    593 ms. The same wave showed at 150 people (SECURE p95 226 ms).
- **Not measured here:**
  - PostgreSQL and its pool of ten (`--database-url`);
  - the VPS's own memory accounting;
  - an after-room behind a paced release.

### 7.4 The real check

The production run is a **TEST ENTRANTS run of 5 000 on a test LIVE release with a pace**, followed by END TEST. It
belongs to the deployment's runbook. It checks the pace on PostgreSQL: the batches at exactly X every Y, the PACE
check in the TEST REPORT, and the box's figures during the run.

Its bots follow their turns by reading `GET /state` through the app's own routes (`services/test-entrants.ts`). **They
open no stream.** That run does not check the memory of 5 000 open streams, which §7.3 found above one container.
Since §7.5, a phone behind the next batch opens no stream either: it reads `GET /state` as the state's `pollMs` says,
as the bots do, so that run now also checks the reads of a queue of 5 000 on PostgreSQL. It still does not check the
room before T0, where every phone holds a stream (§7.5: measured here).

### 7.5 The queue page lightened (the completeness audit of lot M1)

The audit of lot M1 found §7.3's result short of the scope's "Done when" (the queue page holding 5 000) and of the
owner's note (*"to not overload the server"*). The waiting viewer was made lighter:

- **Only the next batch holds a stream.** An entry whose batch is the next one (its place within X) keeps its stream, to
  be let in at the batch's second. The server sends one further behind its place and the queue's frame, then ends its
  stream, and answers `204` to a new one until its batch is the next (`http/live-stream.ts`).
- **The page reads its state instead.** As often as the state's `pollMs` says: half the time until its batch becomes the
  next one, within 10 s and a minute (30 s while the pace is held; 10 s for the next batch whose stream is lost). Its
  first read comes at a moment of its own within a minute of the stream's end, so a queue of thousands ended at the
  same pulse does not read at once. Between two reads the page counts the batches due itself: its place goes down by X
  at each, and its estimated time stays the one it was given (`queuePlace`, `queueEta`). Its batch the next one, it
  opens its stream again, a batch ahead of its own.
- **The phones of this test do what the page does:** they read their state behind the next batch, and close their
  stream once their entry is over (`done` on the page). The first run of the change, at 16:21, still kept every stream
  until the end of the release: up to 4 511 streams after T0, its state reads waiting on the database, 16 turns passed.
  It is not counted.

Three runs on 2026-10-21, at 16:50, 17:19 and 17:47 Paris, under the same lock and the same other work (one-minute load
averages 1.9–8.7). The 17:19 run read macOS's `footprint` of the app every 15 s, which stops the process while it walks
its memory: its times are slower for it, and only its memory is used below. The 17:47 run read it twice (just before T0
and at the end).

| | 16:50 | 17:19 | 17:47 |
|---|---|---|---|
| Batches on the server, the PACE check | 20 of 20, each 250 on its minute · passed | the same | the same |
| People who waited / let in by their batch, at the time first given | 4 750 / 4 750 / 4 750 | the same | the same |
| Their admission on the phone, after the batch's time, p95 | 949 ms | 2 627 ms | 2 033 ms |
| Answers other than 200 · streams dropped | 0 · 0 | 0 · 0 | 0 · 0 |
| Streams after T0 + 10 s, at most | 454 | 786 | 591 |
| State reads behind the next batch | 58 773 · p50 39 · p95 1 199 ms | 56 094 · p50 528 · p95 13 043 ms | 57 010 · p50 969 · p95 3 879 ms |
| The pulse on the server, p50 · p95 | 202 · 596 ms | 224 · 1 115 ms | 242 · 1 440 ms |
| The app's CPU, busiest five seconds → VPS | 0.64 → **1.3** | 0.56 → **1.1** | 0.69 → **1.4** |
| Actions behind the pace, p95 → VPS | 506 → **542 ms** | 1 503 → **1 542 ms** | 1 484 → **1 523 ms** |
| Fan-out of the room · of the queue's frames, p95 → VPS | 84 → **168** · 106 → **212 ms** | 92 → **184** · 131 → **262 ms** | 93 → **186** · 114 → **228 ms** |
| Resident memory, before T0 / after | 504 / 930 MiB | 496 / 920 MiB | 498 / 857 MiB |
| **Footprint**, before T0 / after (with GeoIP) | not read | 380 / 382 MiB (**505 / 507**) | 393 / 567 MiB (**518 / 692**) |

**What it means.**

- **The queue held 5 000, exactly, three times.** Every batch on its minute, the PACE check passed, every one of the
  4 750 who waited let in by its own batch at the time its page first gave, no answer other than 200, no stream lost.
- **The streams follow the next batch, not the queue.** After T0 the app held at most 454 to 786 streams (the next
  batch, those admitted still in the line, the console and the board), against 5 000 for the whole release before.
  Before T0 everyone is in the room on a stream, as in any LIVE RELEASE.
- **Memory: under the container, above the house's margin.** The resident size (RSS) still rose to 857–930 MiB after T0
  with a few hundred streams: it did not follow them. macOS's `footprint`, what the system charges the process, read
  380–393 MiB before T0 with 5 002 streams open and 382–567 MiB at most over the run, with 594 MiB listed as
  reclaimable: memory the allocator had given back, which RSS still counts until the system takes it. §7.3's 964 and
  1 149 MiB were resident sizes too. With the GeoIP database, **505–692 MiB: under the 768 MB container**, above the
  60 % margin (460.8 MiB) of §2. Linux in the container, whose allocator gives memory back otherwise, is not measured
  here.
- **The database is where the time goes.** Instead of one read a second for every viewer, a queue of 4 500 makes about
  50 state reads a second (each reads the account against the release's rules, its entry and its place), on PGlite's
  one connection: the state reads took 39 ms to 1 s at p50 from run to run, and the actions behind the pace
  0.5 to 1.5 s at p95, against 0.54–0.56 s before. The CPU went down (1.1–1.4 cores on the VPS, from 1.9), the pulse
  too (p50 about 0.2 s, from 0.5). PostgreSQL's pool of ten runs these reads side by side; it is not measured here.
- **Not met, as before:** the actions' 200 ms, the fan-outs' 100 ms and one core of CPU on the VPS profile. The production
  run of §7.4 now reads the queue as these phones do.

## 8. ONE QUEUE: 5 000 in the one queue

Lot Q1 (ONE QUEUE, 2026-10-24) replaced the admission of §7. Every LIVE release now has a pace and a hold after the
opening, and **each batch gives up to X turns itself**, in the line's order, only where a piece of the size is free,
from T0 + the hold. A phone reads only its own figures: its place in its size, its estimated wait, what holds the
batches, whether a batch can reach it next, whether its size can still serve it. Only the phones a batch can reach next
keep a stream; the others read their state as their `pollMs` says. The shared queue frame of §7 is gone.

`--one-queue` measures it: `--one-queue --pace 250,1 --hold 2 --levels 5000`. **This is a local measurement, on
PGlite, on this machine.** It is not a measurement of the VPS.

### 8.1 What the run does

- **The release** has a pace of 250 every minute after a hold of 2 minutes, and three sizes, each stocked with 40 % of
  the level (`ONE_QUEUE_STOCK_SHARE`): more pieces than entrants in every size, as the runbook's run A, so every batch
  can give exactly 250. For 5 000 people that is 20 batches: the first at T0 + 2 minutes, the last at T0 + 21.
- **The door** is §7.1's: the room opens 5 minutes before T0; the streams and I'LL BE THERE come over the 2 minutes
  before it, the entries over the room's first 4 minutes.
- **The turns.** Each is taken (PRESS, SECURE, an add-on for half) and the place given back (RELEASE MY PLACE, as the
  runbook's run A): nothing is sold and every entrant is served once. The run ends once every entrant has had its turn.
- **The phones** do what the page does: from T0 each reads its own figures only, from its `you` events and
  `GET /state`; a phone a batch cannot reach next has its stream ended by the server and reads its state instead, first
  at a moment of its own within a minute, then as `pollMs` says (10 s to a minute), until a batch can reach it.
- **No after-room**: the run measures the queue.
- **Measured besides:**
  - **every batch on the server:** exactly X, the k-th at T0 + the hold + (k − 1) × Y on its logical time, and the
    TEST REPORT's own PACE check on the release's entries and audit log;
  - **the queue on the phones:** every phone that waited had its turn; after the first batch, none was given a turn
    before it had read « next » (G2); none read a figure of the pace or a queue frame (D8); how far its first estimate
    fell from its turn; how long its turn took to reach it;
  - **the state reads** behind the next ones, and the streams the server ended and opened again;
  - **the app's memory** before T0, with every phone on a stream, and from T0 + 10 s, with the streams then open.

### 8.2 Results

One run on 2026-10-23 at 15:30 Paris (T0 at 15:37:36, the first batch at 15:39:36), on the build's step Q1.4, under the
lock shared with the build's browser suites.

**The queue.** It held exactly.

| | |
|---|---|
| Batches on the server | 20 of 20, each 250, the first at T0 + the hold of 2 min, each 1 min after the last on its logical time; the engine wrote each p95 331 ms · max 394 ms after its time |
| The TEST REPORT's PACE check | passed: *20 batches gave 5000 turns at 250 every 1 min, the first on the pace at 15:39:36 PARIS, each on its time and in the line’s order; none gave more than the pace, and none left anyone waiting while a piece of their size was free.* |
| People who waited / had their turn | 5 000 / 5 000 |
| A turn after the first batch to a phone that had not read « next » (G2) | 0 |
| Readings with more than their own five figures · queue frames sent (D8) | 0 · 0 |
| Their first estimate, from their turn | p50 137 · p95 279 · max 333 ms |
| Their turn on the phone, after it began | p50 521 · p95 879 · max 1 001 ms |
| Streams | 5 000 open · 0 refused · 0 dropped; 4 500 ended by the server behind the next ones, 4 500 opened again once a batch could reach them |
| State reads behind the next ones | 53 603 · p50 36.5 · p95 922.5 · max 4 710 ms; at most 209 in a second; none other than 200 |
| Answers other than 200 · errors in the app's log | 0 · 0 |
| The end | every entrant served, 5 000 places released, nothing confirmed (run A's behaviour) |

**The targets of one app container (1.5 CPU, 768 MB), on the VPS profile of §2.** The bold figures are what the VPS
would see under §2.

| Target | Measured → VPS | Verdict |
|---|---|---|
| Actions behind the pace (the turns, RELEASE), p95 < 200 ms | 2 633 → **2 677 ms** (the app's own share 44.3 ms, twice as slow) | not met |
| The door before T0 (I'LL BE THERE, ENTER), for information | p95 226.5 ms | |
| Fan-out of the room, p95 < 100 ms | 115 → **230 ms** | not met |
| Memory with GeoIP, < 460.8 MiB | 730.8 → **855.8 MiB** resident | not met |
| CPU, busiest five seconds, < 1 core | 0.76 → **1.5** | not met |

**Memory, before and after T0.** Before T0, with 5 002 streams open: 442 MiB resident at its peak, macOS's footprint
439 MiB at most (198 MiB reclaimable then). From T0 + 10 s, with at most 620 streams open: 717.8 MiB resident at its
peak, the footprint 591 MiB at most (479.4 MiB reclaimable then). The pulse took p50 268.8 ms and p95 423.8 ms; the
engine's passes p95 200.5 ms.

### 8.3 What it means

- **The one queue holds 5 000, exactly.** Every batch gave exactly 250 turns on its minute from T0 + the hold, the
  PACE check passed, each of the 5 000 was served once, each turn went to a phone that had read it was next, no phone
  read more than its own figures, and the first estimates fell within a third of a second of the turns.
- **The actions are slower than §7's, by design of the pace, not by a slower action.** A batch now gives 250 turns at
  once, where §7's gave 25 (its 25 pieces). Their 250 SECUREs arrive together and wait on PGlite's one connection:
  SECURE p95 2.95 s, against 0.6 s in §7. PostgreSQL's pool of ten runs them side by side; it is not measured here.
- **The streams follow the next ones.** After T0 the app held at most 620 streams; the 4 500 behind read their state
  a few times a minute, at most 209 reads in a second.
- **Memory: resident above the house's margin, its footprint under the container**, as in §7.5: 591 MiB charged at
  most, most of the rest memory the allocator had given back. Linux in the container is not measured here.
- **Not met, as in §7:** the actions' 200 ms, the fan-out's 100 ms, one core of CPU and the memory margin on the VPS
  profile. **Not measured here:** PostgreSQL, the VPS, and fewer pieces than entrants (the second of the owner's two
  checks, proved by `test/services/one-queue-proof.test.ts` on 300 pieces, and by the runbook's run B).

### 8.4 The real check

The deployment's runbook for lot Q1 runs **two TEST ENTRANTS runs of 5 000** on a test LIVE release on production, one
at a time, each followed by END TEST: run A with more pieces than entrants (exactly X turns every Y, the hold
respected) and run B with 25 pieces (at most X a batch, in the line's order, nobody eligible left waiting while a piece
of their size was free). Their bots read `GET /state` as these phones do, on PostgreSQL.

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
| Paced runs (§7) | 2026-10-21 (CEST): 05:35 and 06:03, branch `orbes-macro` at step M1.6 (after `f57a0cf`), `--pace 250,1 --levels 5000`; calibration 475 and 445 ms; PGlite 0.5.8 |
| Paced runs (§7.5) | 2026-10-21 (CEST): 16:50, 17:19 and 17:47, branch `orbes-macro` at its completeness audit (after `bdaaead`), the same arguments; calibration 454, 399 and 444 ms; load averages 1.9–8.7 |
| ONE QUEUE's run (§8) | 2026-10-23 (CEST): 15:30, branch `orbes-one-queue` at step Q1.4 (`c1d2673`), `--one-queue --pace 250,1 --hold 2 --levels 5000`; calibration 452 ms; PGlite 0.5.8; a VPS vCPU taken as twice as slow |
| Machine load | Another workflow's work ran at the same time, except its Chromium suites (shared lock); load averages 4.2–7.5 |

# NEXT DAQ Web Control

Operator console for the NEXT experiment's DAQ electronics. It configures the
trigger, PMT, energy-plane and SiPM front-end cards over UDP, controls runs, and
programs FPGA firmware from Intel HEX images.

Browsers cannot open UDP sockets, so a Node server owns the detector link and the
React console talks to it over HTTP and a WebSocket. Run the server on a machine
with access to the detector network; open the console from anywhere that can reach
the server.

```
shared/   Protocol: register schema, packet encoder, frame decoder, Intel-HEX
          parser, unit conversions, and the operator panels
server/   UDP link, run control, card monitoring, flash sessions, HTTP + WS API
web/      React console
```

`shared/` has no server or UI dependencies, so the protocol can be used and tested
on its own.

## Quick start

Requires Node 20 or newer.

```bash
npm install
npm run build

# Dry run: encodes, validates and logs everything, transmits nothing.
NEXT_DAQ_DRY_RUN=1 npm start
```

Open <http://127.0.0.1:8080>. Dry-run mode is the way to explore the console, try a
configuration, or check what a panel would send, on a machine with no detector
attached.

To talk to real hardware, point it at your topology and drop the dry-run flag:

```bash
NEXT_DAQ_CONFIG=./topology.json npm start
```

| Variable | Default | Meaning |
|---|---|---|
| `NEXT_DAQ_CONFIG` | built-in defaults | Path to the topology file |
| `NEXT_DAQ_DRY_RUN` | unset | `1` encodes and logs but transmits nothing |
| `PORT` / `HOST` | `8080` / `127.0.0.1` | Where the console is served |
| `LOG_LEVEL` | `info` | Server log level |

## Configuration

Everything site-specific lives in one JSON file — card addresses, ports, timeouts,
where data is written, and any external commands. Copy
[`topology.example.json`](topology.example.json) and edit it.

```json
{
  "ports": { "java": 6009, "fec": 6022, "fe": 6038, "feCmd": 6039 },
  "broadcastAddress": "10.0.255.255",
  "cards": [
    { "id": "TRG",   "label": "Trigger FEC", "host": "10.0.0.3",  "plane": "trg" },
    { "id": "PMT1",  "label": "PMT FEC 1",   "host": "10.0.86.2", "plane": "pmt" },
    { "id": "BF1",   "label": "BF FEC 1",    "host": "10.0.88.2", "plane": "bf" },
    { "id": "BF2",   "label": "BF FEC 2",    "host": "10.0.66.2", "plane": "bf" },
    { "id": "BF3",   "label": "BF FEC 3",    "host": "10.0.74.2", "plane": "bf" },
    { "id": "SIPM1", "label": "SiPM FEC 1",  "host": "10.0.90.2", "plane": "sipm" }
  ],
  "feBoards": { "template": "10.0.{}.1", "offset": 128, "maxBoard": 55 },
  "paths": { "dataDir": "./data" },
  "timing": { "ackTimeoutMs": 2000, "maxRetries": 3, "powerUpMs": 400 },
  "hooks": {
    "onRunStart": ["/home/next/scripts/elog_client.sh", "start"],
    "onRunStop":  ["/home/next/scripts/stopDate.sh"]
  }
}
```

The file is validated on load: malformed addresses, out-of-range ports, duplicate
card IDs and two cards sharing an address are all refused at startup rather than
surfacing later as a card that never replies. Any field you omit falls back to the
built-in default, including inside nested groups.

`feBoards` maps a SiPM front-end board number to its address — board 7 becomes
`10.0.135.1` with the settings above. The console derives every front-end address
this way, so a crate with a different layout needs only this entry changed.

**Hooks** are external commands run at run boundaries — typically to start and stop
the surrounding DAQ. Each is `[program, ...arguments]`, run directly with no shell,
so quoting and substitution are not interpreted. Only what this file names can ever
run; nothing from an HTTP request reaches a command line. A deployment that
configures no hooks cannot run anything.

### Where things are saved

Everything the console persists goes under `paths.dataDir`:

| File | Contents |
|---|---|
| `current-settings.json` | Live panel state — what each panel holds, what was last applied and when, and per-channel values. This is what survives a restart. |
| `<name>.txt` | Named setups from **Save current setup**, one `key:value` line per setting |
| `run.log.jsonl` | Run log, one JSON object per line |

The default `./data` is relative to the directory the server is started from, so
starting it from elsewhere gives a different, empty data directory and saved setups
appear to have vanished. Use an absolute path for anything long-lived:

```json
"paths": { "dataDir": "/var/lib/next-daq" }
```

## The console

**Overview** carries the controls you reach for without hunting — Start Run, Stop
Run, RST SOFT, RST HARD and Auto-stop DUCK — above the pre-run checklist, run
state, link counters and card table. Hard reset is confirmed before it runs.

**Setup** holds 35 configuration panels grouped by subsystem:

| Section | Panels |
|---|---:|
| Run | 4 |
| Trigger | 3 |
| PMT plane | 6 |
| Energy plane (BF) | 4 |
| SiPM plane | 9 |
| Cards & links | 7 |
| Test & calibration | 2 |

Each panel takes parameters in the units the detector is discussed in —
microseconds, nanoseconds, hertz, counts — and its **Apply** button issues the
whole sequence of register writes that follow from them. The exact packets are
shown, and update as you type, before anything is sent.

**Registers** gives direct access to all 53 individual registers when you need to
send one by hand. **Configuration** saves and restores complete setups.
**Flash** programs firmware. **Log** is the run history.

### Panels remember what they hold

Panel values persist across navigation, browser reloads and server restarts.
A panel holding edits that have not been sent is marked — an amber dot in the
navigator, a count on its category, a banner in the panel, and a highlighted Apply
button — alongside the time it was last sent to the cards.

### Per-channel settings

Trigger and BLR channels are configured independently, so the console keeps values
per card and channel:

- Selecting one channel shows that channel's settings.
- Selecting several shows the values they share, and **Mixed** where they differ.
  Editing a field sets it for every selected channel.
- A **Channel settings** table lists every channel that differs from the panel, one
  row each, with a column per parameter.

## Taking a run

1. **Setup → Run → General configuration.** Set the buffer and pre-trigger in
   microseconds, and pick the RUN code — a drop-down of the 23 codes with what the
   detector is set up for, such as `20 — Kr-83` or `41 — Th-228 (source at lateral
   port)`. Press Apply.
2. **Setup → Trigger → Trigger configuration.** Set the trigger sources, rate and
   the coincidence windows for triggers 1 and 2. Press Apply.
3. Configure the planes you are using — PMT data channels, energy-plane trigger
   sum, SiPM front-end. These are listed as advisory on the checklist: a plane you
   never configured will not produce data even though the run starts.
4. **Overview → Start Run.**

Start Run is disabled until the two required panels have been applied; the
checklist on Overview says which are outstanding. There is a "Start anyway"
override.

A soft reset, hard reset or flash recovery clears the applied record, so the
checklist must be satisfied again — after a reset the cards no longer hold what
they were told.

### Saving a setup

**Configuration → Save current setup** writes every panel's values to a named file
in a readable `key:value` format (236 settings across the 35 panels). **Load into
panels** restores it. Values that cannot be read are listed rather than silently
dropped.

### Programming firmware

**Flash** parses and checksum-verifies the whole `.mcs` image before the card is
put into programming mode, then reports progress. Every acknowledgement wait has a
deadline, frames are retried a bounded number of times, and the session can be
cancelled — it always reaches a reported outcome rather than hanging.

## HTTP API

Everything the console does is available over HTTP. Useful for scripted runs,
scans, and checking what a change would send.

### Encode a register without sending it

```bash
curl -s localhost:8080/api/encode -H 'content-type: application/json' \
  -d '{"register":"TrgConfReg1","params":{"cards":[true,false,true]}}'
```

```json
{"id":"TrgConfReg1","hexWords":["0001","0202","0001","fffa"],"nw":2,"regAddr":1}
```

Word 0 is the sequence counter, word 1 the header, word 2 the register address, and
`fffa` the card mask with FECs 0 and 2 selected — this register is active-low, so a
connected card *clears* its bit.

### See what a panel would do

```bash
curl -s localhost:8080/api/actions/run.general/plan \
  -H 'content-type: application/json' \
  -d '{"params":{"buffer_us":1300,"pretrigger_us":650,"run_code":20}}'
```

```json
{ "writes": [ {
    "register": "GenConfReg0J",
    "note": "Buffers, pre-triggers and run mode, broadcast to every card",
    "params": { "pretrigger": 26000, "buff_size": 52000, "run_code": 20, "mode": 1 },
    "hexWords": ["0001","0702","0000","0141","6590","cb20","6590","cb20","0000"],
    "targets": ["255.255.255.255:6009"]
} ] }
```

The microsecond values became sample counts — 1300 µs × 40 = 52000 — and the run
code landed in bits 4-11 of the flags word.

### Apply it

```bash
curl -s localhost:8080/api/actions/run.general/apply \
  -H 'content-type: application/json' -d '{"params":{"run_code":20}}'
```

```json
{ "applied": [ { "register": "GenConfReg0J",
                 "hexWords": ["0001","0702","0000","0141","6590","cb20","6590","cb20","0000"],
                 "targets": ["255.255.255.255:6009"] } ],
  "dryRun": true }
```

Applying stops at the first failure and reports how many writes landed.

### Configure individual channels

Channels carry their own values. Set two of them, then plan the panel:

```bash
curl -s -X PUT localhost:8080/api/settings/pmt.channelTrigger/channels \
  -H 'content-type: application/json' \
  -d '{"keys":["0:0","0:5"],"params":{"on1":true,"athr1":250}}'
```

```
PMTDaqConfReg4_19  Card 1, channel 0   10.0.86.2:6009   0002 0f02 0004 80fa …
PMTDaqConfReg4_19  Card 1, channel 5   10.0.86.2:6009   0002 0f02 0009 80fa …
```

Each channel gets its own write, addressed to its own card, at register `0x0004 +
channel`. Word 3 is `80fa`: the trigger-1-enable bit plus a threshold of 250.

### Check whether a run can start

```bash
curl -s localhost:8080/api/readiness
```

```json
{ "ready": false,
  "missing": ["General configuration", "Trigger configuration"],
  "items": [
    { "id": "run.general", "title": "General configuration", "required": true,
      "applied": false, "note": "Buffer, pre-trigger and run mode" },
    { "id": "trigger.config", "title": "Trigger configuration", "required": true,
      "applied": false, "note": "Trigger sources, rate and coincidence windows" }
  ] }
```

### Start and stop a run

```bash
curl -s localhost:8080/api/actions/run.acquisition/apply \
  -H 'content-type: application/json' -d '{"params":{"on_off":1}}'

curl -s localhost:8080/api/actions/run.acquisition/apply \
  -H 'content-type: application/json' -d '{"params":{"on_off":0,"stop_external":true}}'
```

`stop_external` is Auto-stop DUCK: it also runs the configured `onRunStop` hook.

### Validate a firmware image

```bash
python3 - <<'EOF'
import json, urllib.request
text = open('Spartan.mcs').read()
req = urllib.request.Request('http://localhost:8080/api/flash/inspect',
                             data=json.dumps({'text': text}).encode(),
                             headers={'content-type': 'application/json'})
print(json.load(urllib.request.urlopen(req)))
EOF
```

```json
{"recordCount": 21313, "totalBytes": 340884, "blocks": [{"address": 0, "length": 340884}]}
```

A malformed image is rejected with the offending line number, before any card is
touched.

### Watch what is happening

`GET /ws` streams run-state changes, received datagrams, rejected datagrams, panel
progress and flash progress as JSON messages.

### Endpoints

| | |
|---|---|
| `GET /api/status` | Run state, cards, link counters, panels with unsent edits |
| `GET /api/topology` · `/api/hooks` | Loaded configuration |
| `GET /api/readiness` | Pre-run checklist |
| `GET /api/actions` · `/api/registers` | Panel and register catalogues |
| `POST /api/actions/:id/plan` · `/apply` | Expand a panel, and send it |
| `POST /api/encode` · `/api/send` | One register, without and with sending |
| `GET`/`PUT` `/api/settings/:id` · `/channels` | Panel and per-channel values |
| `GET /api/settings/:id/applied` | What was last sent |
| `GET /api/configs` · `POST /api/configs/save-current` · `/:name/restore` | Saved setups |
| `POST /api/flash/inspect` · `/start` · `/cancel` · `GET /progress` | Firmware |
| `GET /api/log` | Run log |
| `POST /api/state/acknowledge` | Clear a fault |

## Run state

The state is shown, not set — it follows what you do:

| Event | State |
|---|---|
| Link open, awaiting configuration | `CONFIGURING` |
| Required panels applied | `READY` |
| Start Run | `RUNNING` |
| Stop Run | `STOPPING`, then `READY` |
| Soft reset, hard reset, flash recovery | `DISCONNECTED` |
| A datagram could not be transmitted | `ERROR` |

`ERROR` is reachable from anywhere and leaves only by acknowledging it, so a fault
has to be seen rather than run through. Applying a panel during a run does not drop
the state out of `RUNNING`.

`STOPPING` settles straight back to `READY`: the cards are told to stop, but nothing
reports when they have drained, so the state does not wait on a signal that does not
exist.

## The protocol

Every command is a sequence of big-endian 16-bit words in one UDP datagram:

```
word 0   sequence counter
word 1   (nw << 8) | command code        nw = total words - 2
word 2   register address                (register writes only)
word 3+  payload
```

Command codes: `0x00` acquisition, `0x02` register write, `0x04` status read,
`0x06` PRBS.

### Units

| Panel value | On the wire |
|---|---|
| Buffer, pre-trigger, µs | samples — µs × 40, at the 40 MHz / 25 ns clock |
| Time thresholds, ns | 25 ns time bins |
| Trigger frequency, Hz | mask period — 40 MHz ÷ Hz |
| Throughput, MBytes/s | bytes per second |

### Details that are easy to get wrong

These are properties of the hardware protocol, not conveniences, and normalising
them would change what reaches the cards:

- **Card-mask polarity is not uniform.** `TrgConfReg1` and `SiPMDaqConfReg1` are
  active-low — a connected card *clears* its bit, and the word starts at `0xFFFF`.
  `PMTDaqConfReg1` and `BFDaqConfReg1` are active-high, despite meaning the same
  thing. Each register declares its own polarity.
- **`mau_size` is encoded two ways.** `PMTDaqConfReg16` sends the raw field;
  `PMTDaqConfReg21_36` maps the sample counts 128/256/512/1024 onto the same bits.
- **`GenConfReg2` bit 0 is ACK-*off***, set when waiting for ACKs is disabled.
- **Trigger 1 and trigger 2 time thresholds have different widths.** Trigger 1's
  share their register words with other values and are 12 bits; trigger 2's occupy
  whole words and are 16 bits.
- **The run code is 8 bits**, in bits 4-11 of the flags word, so codes up to 62 fit.
- **SiPM front-end registers use three addressing modes and two ports** — broadcast
  on 6038, unicast on 6038, unicast on 6039, and one (`SiPMFEConfReg5`, the LED)
  addressed by board number on 6039.

### Front-end and per-card addressing

Registers written to a single card are addressed to that card. The energy plane has
three FECs of twelve trigger channels each, and every write goes to one card with a
channel number inside it — so the console selects a card, or a card and channel,
rather than blanketing a plane.

LED control is per board: one command per selected front-end board, addressed to
that board.

## Development

```bash
npm test            # 540 tests
npm run typecheck
npm run build       # clean rebuild of all three packages
npm run dev         # server with reload, Vite on 5173 proxying to 8080
```

The suite covers packet encoding against known-good vectors, frame decoding,
Intel-HEX parsing, unit conversions, panel expansion, per-card and per-channel
addressing, the run-state machine, socket lifecycle, flash timeout and retry
behaviour, and configuration round-tripping.

Two tests exist to catch whole classes of mistake rather than specific bugs:

- **`no-dead-params`** perturbs every declared parameter of every panel and asserts
  the encoded packets change. A control that looks functional and reaches nothing
  fails the build.
- **Header word counts** are derived rather than written down, and pinned against
  the value each register is known to carry.

## Limitations

- **Not validated against hardware.** The encoders are built from the register
  specifications and covered by unit tests, but have not been differentially tested
  against a detector. Check against captured packets or a card before a physics run.
- **Configured state is what this console sent**, not a hardware readback. A card
  power-cycled outside the console still shows as configured until a reset.
- **No authentication.** Commands travel as unauthenticated UDP and the HTTP API has
  no login; both assume an isolated detector network. The server binds `127.0.0.1`
  by default.
- **The flash write framing** is unit-tested for structure, not confirmed against a
  card.

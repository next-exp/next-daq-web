# NEXT DAQ Web Control

A web rewrite of the two NetBeans Swing/JNLP applications in this repository:

| Original | Java lines | Replaced by |
|---|---:|---|
| `Envio_Comandos_NEXT_JULIETT_vDHDALL` — DAQ run control and configuration | 87,536 | `shared/` register schema + `server/` control plane + `web/` console |
| `ATCAFlashProgramming_v1` — FPGA flash programmer | 3,937 | `shared/mcs.ts` + `server/src/control/flash.ts` + the Flash tab |

Browsers cannot open UDP sockets, so the Node server owns the detector link and
the React console talks to it over HTTP and a WebSocket. This is the same
deployment shape as before — the application runs on the DAQ machine — except the
operator interface is now a browser rather than a Java Web Start client.

## Layout

```
shared/   Pure protocol module: register schema, encoder, frame decoder, Intel-HEX
          parser, unit conversions, and the operator panels (configuration actions)
server/   UDP link, run-control state machine, card monitor, flash session, HTTP/WS API
web/      React operator console, generated from the register schema
```

`shared/` has no Node-server or UI dependencies, so the protocol can be tested and
reused on its own.

## Running

```bash
npm install
npm run build

# Dry run: encodes, validates and logs commands without transmitting.
NEXT_DAQ_DRY_RUN=1 npm start

# Against the detector, with the real topology:
NEXT_DAQ_CONFIG=./topology.json npm start
```

Then open <http://127.0.0.1:8080>. Development uses `npm run dev` (Vite on 5173
proxying the API to 8080).

`npm test` runs the full suite; `npm run typecheck` builds the TypeScript projects.

## Configuration

Card addresses, UDP ports, timeouts and file paths were compiled into the Java —
and several were read out of Swing text fields during `Global`'s static
initialiser, which made the configuration depend on GUI construction order. They
now live in one JSON file (see `topology.example.json`), validated on load:
malformed addresses, duplicate card IDs and two cards sharing an address are
rejected at startup rather than surfacing later as a card that never replies.

`NEXT_DAQ_DRY_RUN=1` encodes and logs every command without putting anything on
the network — useful for training, for reviewing a configuration change, and for
running the console on a machine with no detector attached.

## The console

**Overview** carries the controls an operator reaches for without hunting: Start
Run, Stop Run, RST SOFT and RST HARD, above the run state, link counters and card
table. These were plain buttons on the Swing main window, always visible, and they
are always visible here for the same reason. Each uses the parameters set in its
Setup panel, so the two never disagree. Hard reset is confirmed before it runs,
because it takes the whole detector down for about a minute.

Both navigators group their entries into collapsible categories, each showing how
many it holds, with a collapse-all toggle. The state is remembered per list, so a
console set up for one plane comes back that way. A category holding the current
selection stays open regardless, so choosing an entry never leaves it hidden.

**Setup** holds the configuration panels; **Registers** gives direct
single-register access; **Configuration**, **Flash** and **Log** cover saved
setups, firmware and history.

## Operator panels

The console's **Setup** tab reproduces the task-oriented panels of the Swing
application: 33 panels grouped into Run, Trigger, PMT plane, Energy plane, SiPM
plane, Cards & links, and Test. Each is listed with the original tab it comes
from — "BLR Conf tab", "CH TRG Conf A / B / Ext tabs", "Muon Veto Conf tab" — so
an operator who knows the old interface can find the equivalent.

A panel gathers parameters in the units the detector is actually discussed in and
its Apply button issues the whole sequence of register writes, exactly as the
"Config Registers" buttons did. `shared/src/units.ts` holds the conversions that
were previously scattered inline through the `Adjust*` classes:

| Panel value | Register value |
|---|---|
| Circular buffer / pre-trigger, µs | samples — µs × 40 at the 40 MHz, 25 ns clock |
| Time thresholds, ns | 25 ns time bins |
| Trigger frequency, Hz | mask period — 40 MHz ÷ Hz (the Java's bare `40000000 / 10`) |
| Throughput, MBytes/s | bytes per second |

Ranges come from the original labels, which carried the real operating limits —
"Circular Buffer Size (us) [20-3200]", "Coincidence Window Size (25 ns Tbin)
[1-63]", "# Events for trigger [1-40]".

### Per-channel state

Trigger and BLR channels are configured independently — the Swing UI gave each
channel its own row of spinners. The console keeps per-channel values, keyed by
card and channel, so:

- Selecting one channel shows **that channel's** settings.
- Selecting several shows the values they share, and **Mixed** for any field they
  disagree on. Editing a field sets it for every selected channel.
- The grid marks channels that are enabled according to their own stored state, so
  you can see at a glance which are on rather than only which are ticked for the
  next write.
- Values persist across reloads and restarts, and are included in a saved
  configuration.

An earlier version applied one shared threshold set to every ticked channel, which
silently overwrote per-channel configuration and could display values belonging to
no channel at all.

A grid means one of two things, and each panel declares which:

- **`settings`** — each ticked channel gets its own register write and its own
  values, so the panel's other fields are per channel (channel trigger, BLR).
- **`mask`** — the ticked bits are a channel mask inside a per-card write, so the
  other fields are card-level and shared (the trigger sum, where `BFDaqConfReg16`
  carries the mask and the flags in one word).

Getting this wrong is invisible: the trigger-sum "on" toggle routed its edits into
per-channel storage that its plan never reads, so the register writes did not
change when it was flipped. `no-dead-params.test.ts` now perturbs every declared
parameter of every panel and asserts the encoded packets change, so a field that
does nothing fails the build.

The preview re-plans whenever a value changes, including a per-channel one. That
needs care: the plan is computed server-side from the *stored* channel values, and
a per-channel edit deliberately leaves the panel values untouched, so the preview
has to be refreshed after the edit is stored rather than when the form state
changes. Edits are also coalesced before being sent — one write per keystroke
leaves several in flight whose completion order is not guaranteed, so a slower
earlier write could land last and win — and flushed before Apply.

Below the form, a **Channel settings** table lists every channel that has its own
values, one row each, with a column per parameter and differences from the panel
value highlighted. A channel counts as customised when its values actually **differ** from the panel's,
not merely when it has something stored: toggling a flag on and then off again
leaves the field stored with the panel's own value, and testing for presence would
mark the channel forever while it is identical to every other one.

The grid marker deliberately means "this channel has settings
of its own" rather than tracking one particular field — singling out, say, the
trigger-1 enable would misrepresent the other nineteen. Clicking a row selects
that channel.

Panels group their parameters into declared sections, rendered as labelled blocks.
Without that, the fields flow in declaration order into whatever row fits, and a
panel carrying per-trigger copies of the same nine settings interleaves them —
"Trigger 1 pulse valid extension" ends up beside "Trigger 2 baseline deviation".
The panels that carry repeated or unrelated settings are grouped this way:

| Panel | Sections |
|---|---|
| General configuration | Run · Buffer — TRG1/Ext · Buffer — TRG2 · Test modes |
| Trigger configuration | Sources and rate · Trigger 1 · Trigger 2 · Lost-trigger masks |
| Channel trigger | Common · Trigger 1 · Trigger 2 |
| SiPM front-end | Baseline (BS register) · Zero suppression (ZS register) |

matching the boxes the Swing tabs drew. Field labels drop the redundant prefix because the
heading carries it; the channel table re-qualifies them since it has no heading.

Note the two triggers are not equally constrained: trigger 1's time thresholds
share their register words with other values and are 12 bits, while trigger 2's
occupy whole words and are 16 bits, so the panel maxima differ (102,375 ns against
1,638,375 ns).

Forms pack several fields to a row, and Apply sits in the panel header rather than
below the form, so a twenty-field panel stays on one screen and the button is
reachable without scrolling.

The marker reflects the last configuration this console sent, not a hardware
readback — a card power-cycled since will not be reflected.

### Values owned by one panel

A plan can read another panel's values, so a setting lives in exactly one place.
The number of triggers is the case that forced this: the Swing main window had a
single spinner that Start Run, Stop Run, RST SOFT and RST HARD all read. An
earlier version of this rewrite gave each of those four panels its own copy,
which meant a soft reset could send a different trigger count than the run was
configured with. It is now owned by **General configuration** and read from
there; the resets expose no trigger count at all.

### Reset and recovery

The main window's three reset buttons are separate panels, because they are
genuinely different operations:

| Panel | What it does | Original |
|---|---|---|
| **Soft reset** (Run) | Stops acquisition with the reset bit set (`AcqCmd` with `on_off=0, rst=1`) and clears the configured state | RST SOFT |
| **Recover — reload cards from flash** (Cards & links) | `ProgCmd` with `flash_sel` and `prog_on` set, so cards reload their FPGA image. Scoped to all cards, one plane, or selected front-end boards | Ext PMT / SiPM / FEBs RCV windows |
| **Hard reset** (Run) | Soft reset → broadcast reload → wait for the cards → second soft reset | RST HARD |

The hard reset's wait was a blocking `manymasec(60000)` on the Swing event
thread, which froze the interface for a minute with nothing shown. Here a plan
can carry a `waitAfterMs`, and any plan that waits more than five seconds runs
detached with per-step progress pushed over the WebSocket; the wait is also
adjustable for a slower crate.

Recovery never sets the flash write-enable bit — it reloads an existing image
rather than putting the card into a writable state. That is asserted by test.

### SiPM front-end addressing

The ten SiPM front-end registers do not share one destination, and this matters
for anything addressed at a single board. Transcribed from each original class:

| Registers | Destination | Port |
|---|---|---|
| Reg2, Reg3, Reg4, Reg6, Reg7, Reg10 | broadcast | 6038 |
| Reg8, Reg9 | caller-supplied board address | 6038 |
| Reg1 | caller-supplied board address | 6039 |
| Reg5 (LED) | derived from the board number | 6039 |

`SiPMFEConfReg5` computed its destination as `"10.0." + (fenum + 128) + ".1"`.
That mapping is configuration here (`feBoards` in the topology file) rather than a
literal in the register class, and board numbers are range-checked.

**LED control is per board, not per LED.** The LED Conf tab had one checkbox per
front-end board and its handler looped calling `SendFE5Cmd(board)` for each ticked
one, with a single on/off (`calon`) applied to all of them. The `pulsemaskon` /
`pulsemaskoff` arguments that would have selected individual LEDs within a board
are commented out in the shipped Java and never reach the wire, so there is no
per-LED addressing to reproduce.

Two panels differ usefully from the original:

- **Per-channel settings are applied to a channel selection** rather than laid out
  as one row of spinners per channel. "CH TRG Conf A" alone had 133 labels and 28
  fields; here you pick the channels and the panel emits one
  `PMTDaqConfReg4_19`/`BFDaqConfReg4_19` write each — which is what
  `AdjustTRGAChannels` did in its loop.
- **The plan is shown before it is sent.** Every panel lists the registers it will
  write, their addresses, destinations and the exact words, updating as you type.
  Applying stops at the first failure and reports how many writes landed, instead
  of firing and leaving the operator to guess.

The **Registers** tab remains underneath for direct single-register access.

## External hooks — "AutoStop DUCK"

Stopping acquisition in the original also stopped the DATE run, by shelling out to
`/home/next/scripts/stopDate.sh` when the "AutoStop DUCK" checkbox was ticked; a
run start similarly ran `elog_client.sh start`. Both are configuration here:

```json
"hooks": {
  "onRunStart": ["/home/next/scripts/elog_client.sh", "start"],
  "onRunStop":  ["/home/next/scripts/stopDate.sh"]
}
```

The **Start / stop acquisition** panel carries the checkbox as *"Also stop the
external DAQ"*, on by default as it was. A deployment that configures no hooks
cannot run anything, and the option then has no effect.

Two differences from the original, both because this console is reachable over
HTTP rather than being a local Swing window:

- **Only what the configuration file names can run.** Nothing from a request
  reaches a command line; the API decides *whether* to invoke a hook, never *what*.
- **No shell.** Each hook is `[program, ...arguments]` run with `execFile`, so
  quoting and substitution are not interpreted. A malformed hook is rejected when
  the configuration loads, not when a run ends.

A failing hook is reported and logged but does not fail the run — an external
script that exits non-zero must not take down run control.

## Run state

The state is shown, not set. It follows what the operator does:

| Event | State |
|---|---|
| Link open, awaiting configuration | CONFIGURING |
| Required panels applied | READY |
| Start Run | RUNNING |
| Stop Run | STOPPING, then READY |
| Soft reset, hard reset, flash recovery | DISCONNECTED |
| A datagram could not be transmitted | ERROR |

ERROR is reachable from anywhere and leaves only by acknowledging it, so a fault
has to be seen rather than run through. A reset likewise always lands in
DISCONNECTED, including from RUNNING, because it stops acquisition and discards
the configured state. Applying a panel mid-run does not drop the state out of
RUNNING.

An earlier version let the operator click the states directly and nothing else
moved them, so RUNNING meant "someone pressed RUNNING" rather than "acquisition is
under way" — misleading for the most prominent indicator in the console. They are
now read-only, with acknowledging an error the one transition still asked for.

STOPPING settles straight back to READY: the cards are told to stop, but nothing
reports when they have drained, so the state does not wait on a signal that does
not exist.

## Unapplied changes

A panel can be edited without being sent, so the console marks the difference
between what a panel holds and what was last applied to the cards:

- an amber dot beside the panel in the navigator,
- a count on its category, so a collapsed category still shows it has work,
- a banner in the panel itself and a highlighted Apply button,
- and "last sent to the cards" with the time, or a note that it never has been.

The comparison covers per-channel values too, and an edit that restores the
applied value clears the mark rather than leaving it stuck.

A panel that has never been applied is compared against its declared defaults,
not against whether anything is stored for it. Opening a panel loads its values
and would otherwise write them straight back, marking every panel an operator
merely looked at; the console also skips that write when nothing has changed since
the load. Resets clear the applied record, so everything that was
configured shows as unapplied again, which is accurate: the cards no longer hold
it.

## Before starting a run

The Swing application would not enable Start Run until the operator had pressed
"Config Registers" on its panels, and cleared that state on a soft reset. Overview
carries the same interlock as a checklist:

- **General configuration** and **Trigger configuration** are required. Start Run
  is disabled until both have been applied, with a "Start anyway" override.
- The plane panels — PMT data channels, energy-plane trigger sum, SiPM front-end —
  are listed as advisory with their applied time, since a plane that was never
  configured will not produce data even though the run starts.
- A soft reset, hard reset or flash recovery clears the applied state, so the
  checklist has to be satisfied again. Panel *values* are kept; only the record of
  what the cards were told is discarded.

Only two of the original's three interlock counters actually worked. `jButton1_var8`
(trigger) and `jButton1_var10` (general) gated the button; the third,
`jButton1_var4`, is read and reset but never incremented, and the `setup_PMT == 1`
branch that consults it is unreachable because `setup_PMT` is only ever assigned 0.
So that arm never had any effect, and only the two that did are required here.

This tracks what the console has sent, not the hardware — a card power-cycled
outside the console will still show as configured until a reset.

## Saving and restoring a configuration

Panel values live server-side, so a setup survives navigating between tabs, a
browser reload, and a server restart. Editing a panel records the value; applying
one records the values that actually reached the detector.

In the **Configuration** tab:

- **Save current setup** writes every panel's values to a named file (236 settings
  across the 33 panels) in the same `key:value` form the detector configuration
  files use, so it is readable and diffable. Keys are `<panel id>:<parameter>`,
  masks are written as a run of `0`/`1` per channel.
- **Load into panels** restores a saved file. Values that cannot be read are
  listed rather than silently dropped.
- **Inspect** shows the raw file for hand edits.

The original's "Save Configuration" checkbox appended each setting to a file as it
was applied, so the saved file reflected what had been pressed rather than the
state of the panels; a save here is a snapshot of the whole configuration.

## The protocol module

Every command is a sequence of big-endian 16-bit words in one UDP datagram:

```
word 0   sequence counter
word 1   (nw << 8) | command code        nw = total words - 2
word 2   register address                (register writes only)
word 3+  payload
```

The original implemented this as ~50 near-identical classes, each hand-packing
bytes with `(byte)((palabra3 << 16) >> 24)` and opening its own socket. Here one
encoder handles the framing and each register contributes only its payload, so
`nw` is derived rather than copied — and `shared/test/encode.test.ts` pins the
derived value against the literal every original class shipped.

### Details deliberately preserved

Several inconsistencies in the wire format are load-bearing, and normalising them
would change what reaches the hardware:

- **Card-mask polarity is not uniform.** `TrgConfReg1` and `SiPMDaqConfReg1` are
  active-low (a connected card *clears* its bit, word starts at `0xFFFF`), while
  `PMTDaqConfReg1` and `BFDaqConfReg1` are active-high — despite all four meaning
  "FEC connected". Polarity is declared per register.
- **`mau_size` is encoded two ways.** `PMTDaqConfReg16` sends the raw field;
  `PMTDaqConfReg21_36` maps the sample counts 128/256/512/1024 onto the same bits.
- **`GenConfReg2` bit 0 is ACK-*off*,** set when "wait for ACK" is disabled.
- **`SiPMFEConfReg9` lets `TimeShd >> 6` collide with the `SafeEn` bit** for
  `TimeShd >= 0x200000`. The original ORs them without masking; so does this.
- **Calibration trigger counts are divided by 16** before transmission
  (`TrgConfReg3`, `TrgConfReg3A`).

Each is covered by a test naming the behaviour, so a future cleanup has to be
deliberate rather than accidental.

## Fixes carried out from the static evaluation

The rewrite addresses the findings in `java_daq_evaluation.md`.

**Confirmed logic defects**

1. **BF2 replies were dropped.** The classifier at `NewJFrame.java:850-859` tested
   BF1, BF3 and BF3 again, so no BF2 packet could reach the block that counted it.
   Classification is now table-driven from the configured topology, so a card
   cannot be omitted by a copy/paste slip. Regression test:
   `server/test/monitor.test.ts`.
2. **The trigger-failure debounce could never fire.** The branch at
   `NewJFrame.java:960-990` required `cnt_failure > 2` but incremented
   `cnt_failure` only inside itself, while the `else` reset it — so the counter
   never left zero and `trg_failure` was never raised. The counter now advances on
   every invalid sample and the failure is asserted at the threshold, with the
   valid → three invalid → valid sequence covered by test.
3. **The flash receiver shared a mutable `ByteBuffer` across threads.** Each
   datagram is now an independent buffer, decoded by length, with no shared
   parsing state.
4. **Flash programming could wait forever.** `FlashSession` is an explicit state
   machine: every ACK wait has a deadline, frames are retried a bounded number of
   times, the session can be cancelled, and it always reaches a terminal
   `done`/`failed`/`cancelled` state that is reported to the operator.
5. **Unsafe cross-thread state.** Run state lives in one `RunControl` with
   validated transitions and a recorded history; the UI receives immutable
   snapshots over a WebSocket instead of reading shared statics.
6. **Leaked UDP sockets.** The original constructed 59 `DatagramSocket`s in the
   DAQ application and closed none. `CardLink` owns exactly one socket for the
   process lifetime and closes it deterministically on shutdown.
7. **Unvalidated datagrams.** `decodeStatusFrame` works from `(data, length)` and
   rejects frames that are too short, too long or an odd number of bytes, counting
   each rejection by reason. The original used `Arrays.copyOfRange` on a reused
   1024-byte array with no length check, so a truncated reply decoded as valid
   zero-valued fields — covered by a test that puts stale bytes past the reported
   length.
8. **Swallowed exceptions.** Intel-HEX parsing verifies each record's checksum and
   raises `McsParseError` with the offending line number; the original caught
   `IOException | NumberFormatException` with an empty body.

**Engineering findings**

- 529 tests covering encoding, decoding, unit conversions, panel expansion, front-end
  addressing, configuration round-tripping, the two
  fixed defects, the state machine, socket lifecycle, flash timeout/retry/cancel,
  and config round-tripping. The originals had none.
- Reproducible build: pinned npm dependencies and a supported runtime, replacing
  the NetBeans/Ant projects that referenced IDE libraries and Windows-local JARs.
- Topology, ports, paths and thresholds moved into validated configuration with a
  dry-run profile.
- Control logic separated from presentation: `shared/` and `server/` have no UI
  dependency, and the console is generated from the schema — which is most of why
  the four largest Swing classes ran to ~43,000 lines between them.
- Structured JSON-lines run log recording every command with the exact words sent.

### Not addressed

- **Hardware-in-the-loop qualification.** No detector was available, and the
  review host has no JDK, so the encoders could not be differentially tested
  against the running Java. The golden vectors are transcribed from the Java
  source by hand. Validate against captured packets or a card before a physics
  run.
- **The flash write framing** is transcribed from the Java writer's arithmetic
  (`Word_num = Size_tot/2 + 4`, one 9-word group per record). It is unit-tested
  for structure, not confirmed against hardware.
- **Authentication.** Commands still travel as unauthenticated UDP, and the HTTP
  API has no login. Both assume an isolated detector network, as before; the
  server binds `127.0.0.1` by default.

## Validation performed

- All six `.mcs` firmware images in `ATCAFlashProgramming_v1` parse with correct
  checksums (341,646 records / 5.46 MB for the ATCA images) in about 0.6 s.
- The real `Config.txt` and ATCA `config.txt` round-trip through the parser and
  serialiser with no entries lost and nothing unparsed.
- The real `gains.txt` parses to the expected first row.
- The server was run end to end in dry-run mode and driven through the console:
  register encoding, validation errors, sending, logging and flash inspection.

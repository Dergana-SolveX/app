# Signed device command queue

Issue #17 adds the command portion of the device protocol. It uses the existing
`vehicles` provisioning records and `device_commands` audit table; no migration is
needed. The command consumer is an emulation, not physical firmware or the full
crash detection/state machine from FR-S8-02.

## Admin interface

Authenticated Better Auth sessions with the `admin` application role can call:

- `POST /devices/:deviceId/commands` with `{ "cmd": "arm", "args": ["on"] }`.
  Returns the audited command with status 201. Unknown devices return 404;
  malformed input returns 400. Anonymous requests return 401 and other roles 403.
- `GET /devices/:deviceId/commands` returns the audit history in sequence order,
  including issuer, timestamps, status, and device result.

Sequences begin at 1 and increase per device, including after timeout. Allocation
locks the vehicle row in a transaction, and the existing unique constraint is a
second guard against duplicate sequences. Do not delete command history while a
device remains provisioned: that history determines the next sequence.

## Device wire protocol

Use the provisioned 32-byte HKDF device key, never the master secret, on the device.
Every heartbeat and acknowledgement carries:

- `X-SVX-Timestamp`: decimal Unix milliseconds, within five minutes of server time.
- `X-SVX-Signature`: lowercase hex HMAC-SHA256 of the raw UTF-8 JSON body,
  matching the existing issue #14 device protocol. The simulator includes `t`
  (Unix milliseconds) inside that signed body and sends the same timestamp header.
  Serialize the body once, then sign and send those exact bytes.

Request authentication and crash-event ingestion remain owned by the existing
`createDeviceApp` routes; the queue extends their heartbeat and acknowledgement
behavior. Command sequence checks prevent duplicate command execution. This change
does not add a request-nonce store or change issue #14's request-replay policy.

`POST /devices/:deviceId/heartbeat` takes `{ "deviceId": "SVX-CHIP-001",
"emulated": true }` plus optional telemetry. The server records that telemetry and
returns `{ "commands": [{ "seq": 1, "cmd": "arm", "args": ["on"], "hmac": "…" }] }`.
Each command HMAC signs `JSON.stringify([deviceId, seq, cmd, args])`, encoded as
UTF-8. The device must verify the signature and enforce increasing sequences before
execution. The shared command consumer implements this protocol.

`POST /devices/:deviceId/events` accepts command acknowledgements:

```json
{
  "deviceId": "SVX-CHIP-001",
  "t": 1793361600000,
  "type": "command_ack",
  "data": { "seq": 1, "result": { "ok": true } },
  "emulated": true
}
```

Command acknowledgements are handled alongside the existing crash/event pipeline.
Acknowledgement results persist the authenticated request's `emulated` flag.
Unknown and still-queued sequences return 409. A result received after timeout is
retained with its acknowledgement time while the command remains `timeout`, so a
late execution is visible in the audit. Duplicate acknowledgements return success
without replacing the first result.

Commands progress `queued → delivered → acked`. Queued or delivered commands
expire 60 seconds after issue, even if the device is offline. A five-second server
sweep persists timeouts; heartbeat, acknowledgement, and audit reads also enforce
the deadline immediately. Lost heartbeat responses cause redelivery. Lost
acknowledgements cause the simulator to resend its cached result before fetching
more commands, including after a restart beyond the deadline, without executing
the command again.

## Run the simulated consumer

Start the server and seed its vehicles using the existing setup, then run from the
repository root:

```sh
bun run --cwd apps/server simulate:device SVX-CHIP-001
```

The runner uses the server's environment configuration, polls every two seconds,
and prints emulated state. Queue commands using an admin session. Supported effects:

| Command | Arguments | Simulated effect |
| --- | --- | --- |
| `arm` | `on` or `off` | Sets the demo-arm switch |
| `force_channel` | `auto`, `http`, or `sms` | Sets the selected channel |
| `inject_trace` | `frontal_40`, `rollover`, `fire_parked`, or `pothole` | Selects a trace; refused unless demo-arm is on |
| `selftest` | none | Reports the current arm/channel state |

These effects expose state for the future crash simulator; selecting a trace does
not synthesize an incident or claim a physical sensor test passed. Invalid command
arguments produce an audited failure result.

The runner atomically saves state and the latest command result under
`apps/server/.device-simulator/` before acknowledgement, restoring the sequence
guard on restart. Run one consumer per device and retain its checkpoint across
restarts. The directory is gitignored. Library consumers should supply `initialState`
and `saveState` for the same durability; without them replay protection lasts for
the instance's lifetime.

## Verification

`bun run --cwd apps/server test` exercises the HTTP interface against a database
created from the real migrations, plus the simulated chip against those endpoints.
Coverage includes authorization, concurrent sequencing and simulator polls, late results, independent Node-crypto
signature verification, delivery/retry, timeout, acknowledgement audit, forged and
stale requests, command effects, replay rejection, and checkpoint restoration.

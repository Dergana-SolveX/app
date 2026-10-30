# apps/gateway: SMS gateway over a USB GSM modem

Our own AT-command driver (PLAN.md S3.4-A, PRD FR-S3-08). Not used on stage (PRD FR-S3-10): the stage default is the
emulated GSM network. This is the real path.

```
phone ──SMS──▶ modem ──AT──▶ gateway ──POST /internal/sms──▶ server
server ──POST /send──▶ gateway ──AT──▶ modem ──SMS──▶ phone
modem ──delivery report──▶ gateway ──POST /internal/sms/status──▶ server
```

## Run it

1. Plug in the modem (SIM7600-class, with a SIM) and find its **AT-command port** (Windows: Device Manager → Ports,
   e.g. `COM3`; Linux: `/dev/ttyUSB2`).
2. Create `apps/gateway/.env`:
   ```
   MODEM_PORT=COM3
   GATEWAY_SHARED_SECRET=<same value as in apps/server/.env>
   ```
3. In `apps/server/.env` set `SMS_TRANSPORT=modem` (and `GATEWAY_URL` if the gateway is not on `localhost:3002`).
4. `bun run dev:gateway` (or `bun run dev`). With `MODEM_PORT` empty the gateway just idles.

`GET /health` answers `{"modem":"connected" | "connecting" | "stopped"}`.

## What it does

- **Start-up:** `AT`, echo off, text mode, `CSCS="UCS2"`, `CNMI=2,1,0,1,0`, then a sweep of everything on the SIM.
- **Receiving:** `+CMTI` → `AT+CMGR` → hand to the server → `AT+CMGD`. A message is deleted **only after** the server
  accepted it, so a distress signal is never lost; what stays on the SIM is handed over again by the next sweep
  (on every reconnect, and every minute).
- **Sending:** `AT+CMGS` with delivery reports. Arabic goes out as UCS2 (70 characters), everything else as the GSM
  alphabet (160). A longer text is refused, never silently cut: no concatenated SMS.
- **One command at a time**, each with a timeout. A modem that stops answering is treated as lost: everything queued
  fails, the link is closed and reopened, and start-up runs again.
- **Unplugging** the USB modem does the same, with growing waits (1, 2, 5, 10, 30 s).

## Honesty note: the tests

`src/testing/transcripts.ts` holds the modem conversations the tests replay. They were **written from the SIM7600 AT
command manual**, not captured from a real modem. They prove the driver follows the documented protocol, not that a
given dongle behaves exactly like the manual. `src/modem/serial.ts` (the serial port itself) is not covered by tests
either. Before relying on this for real: capture a session from the actual dongle, replace the transcripts, and check
in particular how it prints Arabic messages (`UCS2` hex) and its delivery reports (`+CDS`).

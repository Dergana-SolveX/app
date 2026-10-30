# Troubleshooting

## `getaddrinfo ENOTFOUND ep-…neon.tech` (server 500 errors, `db:migrate` fails)

**Symptom:** the API logs `DNSException: getaddrinfo ENOTFOUND ep-xxxx(-pooler).c-6.us-east-2.aws.neon.tech`,
every request that touches the database returns 500 (sign-in, `/trpc/*`), and `bun run db:migrate` fails with
`Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"`.

**Cause:** not the code. The DNS server of the network you are on (router, hotspot, campus or content filter)
cannot resolve Neon's hostnames, or returns wrong addresses for them. Public DNS (1.1.1.1, 8.8.8.8) answers
correctly. Windows resets its DNS server every time you join a different network, so this comes back.

**Check:**

```powershell
Resolve-DnsName ep-xxxx.c-6.us-east-2.aws.neon.tech -DnsOnly              # your DNS
Resolve-DnsName ep-xxxx.c-6.us-east-2.aws.neon.tech -Server 1.1.1.1 -DnsOnly  # public DNS
```

If the two answers differ (or the first fails), it is the network's DNS.

**Fix** (PowerShell **as Administrator**):

```powershell
Set-DnsClientServerAddress -InterfaceAlias "WiFi" -ServerAddresses 1.1.1.1,8.8.8.8
ipconfig /flushdns
```

Undo: `Set-DnsClientServerAddress -InterfaceAlias "WiFi" -ResetServerAddresses`.
Another way out is a phone hotspot. IPv6 is often unavailable on these networks; that is fine.

**Demo day:** set public DNS on the presentation laptop and sign in once on the venue network before presenting.

**Tests never need Neon:** they run on an in-process Postgres (PGlite), so `bun run test` works offline.

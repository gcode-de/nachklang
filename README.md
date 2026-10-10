# Nachklang

Worte, die bleiben. A small self-hosted app for personal messages, delivered after a missed monthly life check.

Next.js · Better Auth · SQLite · SMTP. One container image for the web app and scheduled worker. No cloud backend, Redis, uploads, friend confirmation or legacy giving.

## What it does

- Email/password registration, email verification, login/logout and password reset.
- Autosaved text messages with recipient name/address, explicit release checkbox and optional earliest delivery date.
- Monthly calendar-based check, with seven days to reply by email link or dashboard. Confirmation starts a new month; dates clamp at month-end.
- The check starts disabled. Drafts never send. Each message sends once unless the owner explicitly rearms a failed/ambiguous attempt.
- Lifecycle and SMTP acceptance events, profile name changes and account deletion.
- AES-256-GCM encryption of message text and recipient data in SQLite. The server holds the key; this is **not end-to-end encryption**. Auth data and scheduling metadata are not encrypted by this mechanism.
- A missed response is **not proof of death**. Recipient emails explain this.

## Local development

Use Node.js 24 LTS and Docker (only needed for the local test mailbox).

```sh
npm ci
cp .env.example .env
openssl rand -hex 32 # put output in BETTER_AUTH_SECRET
openssl rand -hex 32 # put a different output in MESSAGE_ENCRYPTION_KEY
docker compose -f compose.dev.yml up -d
npm run migrate
npm run dev
```

Open http://localhost:3000. Mailpit at http://localhost:8025 catches all local emails; verification/reset links are available there. `SMTP_ALLOW_INSECURE=true` is only for this local mailbox.

```sh
npm run worker
npm run typecheck
npm test
npm run build
```

The worker must run regularly, independently of website traffic. In development, invoke it manually or with a local timer. Never put real recipients into accelerated tests. To stop local Mailpit: `docker compose -f compose.dev.yml down`.

## GitHub → Docker Hub

The workflow tests types, lifecycle/security logic and the production build. On main, version tags and manual runs, it publishes `linux/amd64` and `linux/arm64` images after the tests pass.

Add these repository **Actions secrets**:

- `DOCKERHUB_USER`: your Docker Hub username
- `DOCKERHUB_TOKEN`: a Docker Hub access token with permission to push to `nachklang`

Without the secrets, tests run and publishing is skipped with an explanation in the workflow summary. Once added, run **Test and publish → Run workflow**. Published tags include `latest`, `sha-<commit>` and a version for `v*` Git tags. Create `v0.2.0` after configuration to publish `0.2.0`; use a version or digest in the homelab, rather than silently updating `latest`.

SMTP credentials, database and encryption keys belong only on the runtime host, never in Git or the image. CI builds/publishes the image; it does not access your homelab or automatically replace its running version.

## Podman in the homelab

The `deploy/` directory contains rootless Podman Quadlet and systemd timer examples. Check `/usr/bin/podman` matches your host's binary path. Quadlet support is required.

1. Copy `deploy/nachklang.container` and `deploy/nachklang-data.volume` to `~/.config/containers/systemd/`.
2. Replace `DOCKERHUB_USER` and select an existing release tag or image digest in `nachklang.container`.
3. Copy `deploy/nachklang-worker.service` and `.timer` to `~/.config/systemd/user/`.
4. Create `~/.config/nachklang.env` with mode `600`:

```ini
BETTER_AUTH_URL=https://nachklang.samuelgesang.de
BETTER_AUTH_SECRET=YOUR_RANDOM_64_HEX_CHARACTERS
MESSAGE_ENCRYPTION_KEY=YOUR_DIFFERENT_RANDOM_64_HEX_CHARACTERS
DATABASE_PATH=/data/nachklang.sqlite
SMTP_HOST=YOUR_SMTP_HOST
SMTP_PORT=587
SMTP_FROM=Nachklang <nachklang@samuelgesang.de>
SMTP_USER=YOUR_SMTP_USER
SMTP_PASS=YOUR_SMTP_PASSWORD
```

Use port 465 for implicit TLS or 587 for STARTTLS. Omit `SMTP_ALLOW_INSECURE` in production. Set up the sender domain's SPF/DKIM/DMARC with your mail provider.

```sh
chmod 600 ~/.config/nachklang.env
systemctl --user daemon-reload
systemctl --user start nachklang.service
systemctl --user enable --now nachklang-worker.timer
systemctl --user list-timers nachklang-worker.timer
journalctl --user -u nachklang.service -u nachklang-worker.service
```

Enable lingering for your service user (`loginctl enable-linger YOUR_USER`) if it should run after logout and at boot. Quadlet generates the web service with `WantedBy=default.target`; start it immediately as above. Schema initialization runs at web-container startup. The worker runs inside that container every five minutes and uses the same data volume.

## Cloudflare Tunnel

Create the public hostname `nachklang.samuelgesang.de` in your tunnel and route it to `http://127.0.0.1:3000` when cloudflared runs on the same host. If cloudflared runs in a container, use a private shared network and route to the app container instead; its own loopback is not the host's loopback.

Only expose the web app through the tunnel. Login routes, password-reset and verification URLs must use the same public `BETTER_AUTH_URL`. No Cloudflare Access login gate is required because the app has its own login. The app trusts Cloudflare's client-IP header for auth rate limiting; keep the origin bound to loopback or a private network.

## Delivery guarantees and operation

- The response window starts only when the check is successfully accepted by SMTP. Acceptance does not guarantee inbox delivery; spam filtering and bounces still matter.
- Confirmation links use random, hashed, single-use tokens. GET requests only show a page; an explicit POST confirms life, avoiding accidental confirmation by email link scanners.
- An outage longer than one hour resets awaiting/released users and requires a new check before remaining recipient messages can send. Already sent messages stay sent.
- The worker uses a database lease to prevent overlap and rechecks user state before claiming each recipient message.
- Once SMTP dispatch begins, confirmation/deactivation/account deletion cannot retract that email. The UI communicates this limit.
- If SMTP fails or the worker crashes during a send, that message is marked failed/ambiguous and is **not automatically retried**. SMTP cannot provide exactly-once delivery. A stable Message-ID helps identification but is not a deduplication guarantee. Explicit rearming acknowledges the duplicate risk.
- Optional delivery dates are evaluated as UTC calendar dates. A date in the past sends at the next run after lifecycle release. Sent messages cannot be edited; write a new one.
- Limits: one app instance, local SQLite filesystem, 100 messages/account, 100,000 characters/message. Not designed for multiple replicas or SQLite on network storage.
- A synthetic SMTP test verifies authentication, message ownership, release, confirmation and delivery without emailing real people. Run tests and check the job timer before enabling real checks.

Back up the database **and the separate encryption key**. For a consistent SQLite backup while running:

```sh
podman exec nachklang node --import tsx scripts/backup.ts
podman cp nachklang:/data/backup.sqlite ./nachklang-backup.sqlite
```

Move backups to a protected location outside the homelab and test restoration. Losing the encryption key makes stored messages unreadable. To restore, stop the app and worker, restore the database to the data volume, retain the key and permissions, remove stale WAL/SHM files, then restart. Account deletion does not retroactively change existing backups.

Before inviting public users, supply the operator's contact details and an appropriate privacy notice; `/about` documents technical behavior but is not a complete operator-specific policy. Public source code does not require opening registration to the world. Protect or restrict the deployment according to your intended audience.

## Development approach

Follows [Ponytail](https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail/SKILL.md): the smallest complete implementation, built-in capabilities first, meaningful checks retained. SQLite is used directly instead of adding a second ORM alongside Better Auth's database adapter.

MIT licensed. No content, branding or code from GoodbyeMemo is included.

## Countdown visibility and mail diagnostics (0.2.0)

The dashboard shows the timer prominently above messages: paused, active, awaiting a reply (start, deadline and live remaining time), or released. It refreshes server state every 15 seconds and on window focus. **Ich bin da – Versand stoppen** cancels unclaimed dispatch and starts the next monthly cycle; **Sofort stoppen & Prüfung pausieren** disables checks. Already begun SMTP sends cannot be recalled.

A check has no deadline while SMTP is in progress. The countdown is committed only after acceptance, conditional on the user not having stopped it meanwhile. Interrupted check sends restart safely with a fresh check. Reminder emails follow at days 3 and 6; known reminder failures pause the timer instead of releasing recipient messages. SMTP failures are visible on the dashboard and in its events.

**Testmail senden** sends only to the signed-in account, at most once per minute. An explicit confirmation link (24-hour validity, single use, POST only) records receipt independently of the life check. SMTP acceptance alone is labelled as such. This is an inbox test, not a guarantee of future delivery: configure SPF/DKIM/DMARC, check spam, and monitor provider bounces. Automated bounce processing is not included.

Upgrading from 0.1.0 adds columns and a mail-test table without deleting messages. Existing awaiting/released timers are paused once during migration, because the previous schema cannot prove a safely committed check send. Review your dashboard, test your mail route, then reactivate monthly checks. Back up the database and encryption key before updating. The default UI is dark with a persistent light-mode switch; fonts are local system sans-serif fonts.

## Admin alerts and private registration (0.3.0)

Runtime configuration (not CI secrets):

```ini
TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN
TELEGRAM_CHAT_ID=YOUR_CHAT_ID
ALLOW_REGISTRATION=false
```

Every direct SMTP error queues an admin alert, including missing SMTP configuration, verification/reset emails, checks, reminders, mailtests and recipient messages. Telegram receives only a failure count, time and dashboard URL; no recipient addresses, message contents or exception text. Pending alerts persist in SQLite. The first alert is attempted immediately, further attempts are limited to one per ten minutes and the regular worker retries pending alerts. A Telegram failure cannot turn an SMTP failure into success or change a life timer. Missing Telegram configuration retains pending alerts for later delivery. A process crash during an ambiguous recipient send still cannot prove SMTP delivery. Later provider bounces are not automatically detected.

Start the bot conversation in Telegram and run `podman exec nachklang node --import tsx scripts/test-telegram.ts` after configuring and restarting the container. The Telegram Bot API token is never logged. This test sends one explicit admin-channel test message and does not modify life checks.

`ALLOW_REGISTRATION=false` disables signup on both the API and login page. Existing accounts can log in, verify their address and reset their password. For first setup, open registration briefly, create/verify your account and close it again. No production account or password is automatically created.

The checked-in `deploy/homelab/` units target the existing rootful Podman LXC 114 (192.168.68.194) via Proxmox pve1 (192.168.68.211). Install the Quadlet files under `/etc/containers/systemd/` and the worker units under `/etc/systemd/system/`. Secrets live in `/etc/nachklang.env` with mode 600; the data is in the `nachklang-data` Podman volume. The cloudflared connector is LXC 119 (192.168.68.242), so its route points to `http://192.168.68.194:4176`, not localhost. No router port forwarding is needed. An exact release tag is pinned; deployment updates remain deliberate.

The homelab's existing backup system is used, without an additional backup job. Ensure that it actually includes the persistent data volume and `/etc/nachklang.env` (which contains the encryption key).

# Existing homelab deployment

Deployed 2026-10-10 with `docker.io/sgesang/nachklang:0.3.0`.

- App: Proxmox pve1 (`192.168.68.211`), Podman LXC 114 (`192.168.68.194`).
- Public URL: https://nachklang.samuelgesang.de
- Private origin: http://192.168.68.194:4176
- Runtime secrets: `/etc/nachklang.env` inside LXC 114, mode 600.
- Persistent volume: `nachklang-data`. The existing homelab backup is used; its coverage was not changed or audited, and no additional backup job was installed.
- Web startup: `/etc/containers/systemd/nachklang.container` and `.volume` generate the systemd service and boot dependency.
- Worker: `/etc/systemd/system/nachklang-worker.service` and `.timer`, every five minutes.
- Tunnel replicas: LXC 119 on pve1 and LXC 121 on pve3 (`192.168.68.213`). Both existing `/etc/cloudflared/config.yml` files contain the new hostname route. Future route changes must reach both replicas.

The Quadlet healthcheck is explicit because the OCI image's Docker healthcheck was not imported by this Podman version. A healthy check is required before systemd reports startup complete. Three failed checks kill the container and systemd restarts it. The live healthcheck and a container restart were verified; the entire Proxmox host was not rebooted.

## Finish credentials and account setup

Use the Proxmox console for LXC 114, or SSH into pve1 and run `pct enter 114`. Edit `/etc/nachklang.env` there. Preserve the two generated application keys.

Fill `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and, if needed, `SMTP_FROM`. Fill `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` after starting the Telegram bot conversation. Do not paste credentials into the repository or GitHub Actions.

Then, inside LXC 114:

```sh
systemctl restart nachklang.service
podman exec nachklang node --import tsx scripts/test-telegram.ts
```

For first account setup only, change `ALLOW_REGISTRATION=false` to `true`, restart the service, create your account at the public login page and confirm its verification email. Set it back to `false` and restart again. No production account or password has been created automatically. No real messages are present.

Run the dashboard mailtest and explicitly confirm receipt. Keep monthly checks disabled until this works. Test recipient dispatch only with your own test recipient. Real SMTP delivery, Telegram delivery and later provider bounces cannot be validated before credentials are supplied.

## Operations

```sh
systemctl status nachklang.service nachklang-worker.timer
systemctl list-timers nachklang-worker.timer
journalctl -u nachklang.service -u nachklang-worker.service
podman healthcheck run nachklang
curl --fail https://nachklang.samuelgesang.de/api/health
```

Update deliberately by changing the release tag in the Quadlet, reloading systemd and restarting the app. Preserve the data volume and both keys. The worker automatically retries pending Telegram alerts, throttled to ten-minute intervals. Successful SMTP acceptance is not proof of inbox delivery; later bounces still require provider-side observation.

Verified on the public URL: health returns 200, login renders in Safari with no signup action, unauthenticated dashboard API returns 401, and signup API rejects the synthetic probe with `EMAIL_PASSWORD_SIGN_UP_DISABLED` (400). Both existing tunnel connectors are active with the new route.

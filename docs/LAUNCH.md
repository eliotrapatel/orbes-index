# ORBES GENOME CODE™ — Launch runbook

This is the step-by-step path from this repository to a live `https://verify.theorbes.com`, with `theorbes.com` staying on Vercel.

Details for every step are in [DEPLOYMENT.md §15](DEPLOYMENT.md) and [deploy/vps/README.md](../deploy/vps/README.md).

---

## 0. Before you start

- [ ] **Code is green.** On GitHub → *Actions*, the latest commit of branch `claude/orbes-genome-code-system-o8bmnk` must show a green `genome-ci` run. Commits tagged `[skip ci]` are work-in-progress checkpoints and are not tested.
  - If the newest real run is red, do not deploy that commit.
  - Either deploy the last green commit (`scripts/deploy.sh <commit-sha>`), or open a new Claude Code session on this repo and ask it to "make genome-ci green on the branch and finish the open items in docs/COMPLIANCE.md".
- [ ] **Accounts and tools:** the OVH VPS (Ubuntu 26.04, ≥ 2 vCPU, 4 GB RAM, 40 GB disk, EU region), its public IPv4, SSH key login working, and access to the place where the `theorbes.com` DNS is managed (Vercel → *Domains*, or your registrar).
- [ ] **Password manager entries:** a password manager (or offline vault) ready for 5 secrets: `COOKIE_SECRET`, `IP_HASH_PEPPER`, `KEY_ENCRYPTION_KEY`, the backup private key, and the first admin password plus its TOTP secret.

## 1. DNS (do it first; propagation takes minutes to hours)

1. In the DNS for `theorbes.com`, add an **A record**: name `verify`, value = the VPS IPv4, TTL 300. Do **not** add an AAAA (IPv6) record: the stack is published on IPv4 only, so every visitor keeps their own identity for rate limiting and anomaly detection.
2. Wait until `dig +short verify.theorbes.com` (or <https://dnschecker.org>) shows the VPS IP.

## 2. Prepare the server (once, ~10 min)

SSH in as `ubuntu`, OVH's default user, which has sudo:

```bash
sudo apt-get update && sudo apt-get install -y git
sudo git clone --branch claude/orbes-genome-code-system-o8bmnk \
  https://github.com/eliotrapatel/orbes-index.git /opt/orbes/orbes-index
sudo /opt/orbes/orbes-index/deploy/vps/scripts/bootstrap-ubuntu.sh --dry-run   # read the plan
sudo /opt/orbes/orbes-index/deploy/vps/scripts/bootstrap-ubuntu.sh             # do it
```

The script does the following:

- installs Docker;
- opens only ports 22, 80 and 443 (ufw);
- enables automatic security updates, fail2ban and time sync;
- adds swap if needed;
- creates the `orbes` user;
- installs the nightly backup timer and the weekly GeoIP timer.

**Optional hardening.** Once you have confirmed you can log in with your SSH key, run the script again with `--harden-ssh`. That disables password and root SSH logins. The script refuses to do this if it would lock you out.

**OVH firewall (optional).** In the OVH control panel you can also enable the *Network Firewall* with the same rules: 22, 80 and 443 in, everything else denied.

## 3. First deployment (~10–15 min, mostly the image build)

```bash
sudo -iu orbes
cd /opt/orbes/orbes-index/deploy/vps
scripts/setup.sh --domain verify.theorbes.com \
  --acme-email <your email for Let's Encrypt> \
  --admin-email <first admin email>
```

`setup.sh` does the following:

1. writes `.env` with freshly generated secrets (file mode 0600);
2. creates the encrypted-backup key pair;
3. downloads the GeoIP database;
4. builds and starts Caddy, the app and PostgreSQL;
5. runs the database migrations;
6. creates the Ed25519 signing key;
7. smoke-tests HTTPS.

**It prints the secrets and the backup private key ONCE.** Copy them into your password manager immediately. Without `KEY_ENCRYPTION_KEY` and the backup private key, backups cannot be restored.

## 4. Secure the admin account

The admin console requires 2-factor authentication in production.

1. Create the TOTP secret:

   ```bash
   docker compose exec app node --import tsx scripts/admin.ts totp-setup --email <first admin>
   ```

2. Add the printed secret (or `otpauth://` link) to an authenticator app (1Password, Google Authenticator, …), then confirm with a current code:

   ```bash
   docker compose exec app node --import tsx scripts/admin.ts totp-enable --email <first admin> --secret <SECRET> --code <6-digit code>
   ```

3. Remove the bootstrap credentials:
   - edit `.env` and delete the `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` lines;
   - then run `scripts/deploy.sh` to apply the change.

**Optional:** to restrict `/admin` to your office or home IPs, set `ADMIN_ALLOWED_IPS` in `.env` (space-separated IPs or CIDRs, no commas), then run `scripts/deploy.sh`, which validates the Caddy configuration before applying it.

## 5. Smoke test

```bash
curl -s https://verify.theorbes.com/api/v1/health                # {"ok":true,...}
curl -s https://verify.theorbes.com/.well-known/orbes-keys.json  # one ACTIVE Ed25519 key
docker compose ps                                                # caddy, app, postgres: healthy
```

- Open `https://verify.theorbes.com/verify` on a phone. The ORBES landing page should appear, and the camera opens when you tap *Scan ORBES Code*.
- Open `https://verify.theorbes.com/admin` and sign in (password + TOTP). The dashboard should load.

## 6. Backups (do not skip)

1. **Local backup and restore drill.** Run `scripts/backup.sh`. The archive appears in `/var/backups/orbes`. Then rehearse a restore once on a test VM, or follow the drill in DEPLOYMENT.md §15. The restore script needs the backup private key from your vault.
2. **Off-site copy (recommended).**
   - In OVH → *Object Storage*, create a bucket and S3 credentials.
   - Run `rclone config` as `orbes` to add the remote.
   - Set `BACKUP_RCLONE_DEST=<remote>:<bucket>/orbes` in `.env`.
3. **Check the timer.** `systemctl list-timers 'orbes-*'` should list the nightly backup and the weekly GeoIP refresh.

## 7. Catalogue and first products (admin console)

1. **Catalogue:** create the categories (e.g. J Jewelry, L Leather Goods, W Watches, F Fragrance, A Accessories). Category letters and indices are permanent. Then create collections and models (e.g. MONOLITHE · RING · 925 STERLING SILVER).
2. **Generator:** issue a product, choosing category, model, material, batch and production date. Tick "claim code" if the certificate card will carry a scratch-off claim code.
3. **Download the artifact:**
   - **PDF** for print, **SVG** for engraving or foil vendors, **PNG** for previews.
   - Recommended minimum size: **30 mm**, or **20 mm** for small tags if customers can zoom.
   - Leave the 2 u quiet zone around the code.
4. **Claim code:** it is shown **once**. While it is on screen, click **Download certificate card**: the server checks the code against its hash and returns the card (PDF, 85 × 55 mm) with the code under its scratch-off panel. Nobody copies the 12 characters by hand. For a print run, `POST /api/admin/certificates` also gives A4 sheets of ten and a CSV for the print shop's variable-data printing (API §15.7). Ask the shop to lay the scratch-off ink on the **ORBES SCRATCH-OFF** spot plate. Until the brand validates the card layout (BRAND §7), every card says **PROOF**: do not print final cards before that.

## 8. Validate on real phones before the public launch

1. Print `docs/assets/test-sheets/orbes-code-test-sheets.pdf` at **100 % scale** (no "fit to page").
2. Scan the codes with a few iPhones (including a Pro) and Android phones at 10–25 cm, on each real material you will use: card, leather tag, engraved silver.
3. Keep the smallest size that reads reliably on every phone. The simulator's estimate is 30 mm without zoom and 20 mm with zoom.
4. Scan one real issued product end to end. Expect AUTHENTIC — FIRST REGISTRATION after you activate its warranty in the admin; register it with a test customer account; check the ownership tab.

## 9. Switch on `theorbes.com/verify`

1. On GitHub, open a pull request from `claude/orbes-genome-code-system-o8bmnk` into `main`, review it and merge it.
   - Vercel redeploys `theorbes.com`.
   - The only visible change is that `theorbes.com/verify` redirects to `https://verify.theorbes.com/verify` (`vercel.json`).
   - `.vercelignore` keeps `genome/`, `docs/`, `deploy/`, `.github/`, `node_modules/`, `README.md` and `NOTICE.md` off the website.
2. Check:
   - `https://theorbes.com` looks exactly as before;
   - `https://theorbes.com/verify` lands on the scanner.
3. On the VPS, follow `main` from now on:

   ```bash
   cd /opt/orbes/orbes-index && git fetch && git checkout main && git pull && cd deploy/vps && scripts/deploy.sh
   ```

## 10. Legal and content (before announcing)

- [ ] Privacy policy covering scan data:
  - pseudonymised IP and device hashes;
  - approximate location (country / ~10 km);
  - account data;
  - retention.
- [ ] Terms for ORBES accounts, ownership registration and transfers.
- [ ] Attribution for the GeoIP data: "IP Geolocation by DB-IP" (CC BY 4.0), see `NOTICE.md`. It can live in the privacy policy.
- [ ] Customer copy reviewed by legal. The system never claims a scan proves an object is genuine; keep it that way in packaging and marketing.
- [ ] Packaging and website text: "Verify only at theorbes.com/verify".

## 11. Running it

| When | What |
|---|---|
| Continuously | An uptime monitor (UptimeRobot, Better Stack…) on `https://verify.theorbes.com/api/v1/health` |
| Weekly | Admin → *Anomalies*: review OPEN items. Nothing is ever revoked automatically. |
| Each update | `git pull && scripts/deploy.sh`. It takes a backup first and rolls back automatically on failure. |
| Monthly | Check `/var/backups/orbes` and the off-site bucket; look at disk usage (`df -h`). |
| Yearly / on staff change | Rotate the signing key: Admin → *Keys* → *Rotate*. Old products stay verifiable. |
| Suspected key compromise | Admin → *Keys* → *Revoke* with the compromise time, then rotate. See DEPLOYMENT.md, key compromise runbook. |
| Lost admin authenticator | Another ADMIN resets it in the console, or on the VPS run `node --import tsx scripts/admin.ts reset-totp --email … --yes` |

## 12. Optional

- **Repository visibility:** the GitHub repository is currently **public**. Make it private if you don't want the sources and internal specifications visible (GitHub → *Settings* → *Danger Zone*).
- **Cloudflare in front of `verify.theorbes.com`:** set `EDGE_MODE=cloudflare` and `GEO_MODE=cloudflare`. See DEPLOYMENT.md §15.
- **Local demo, no server needed:** `cd genome && npm ci && npm run demo`, then open `http://localhost:8080/verify` and `/admin`. The demo admin login is printed once.

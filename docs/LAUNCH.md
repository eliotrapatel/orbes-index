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
   read -rs ADMIN_TOTP_SECRET && export ADMIN_TOTP_SECRET   # paste the secret: nothing shows, nothing enters the shell history
   clear                                                    # the secret leaves the screen
   docker compose exec -e ADMIN_TOTP_SECRET app node --import tsx scripts/admin.ts totp-enable --email <first admin> --code <6-digit code>
   unset ADMIN_TOTP_SECRET
   ```

3. Remove the bootstrap credentials:
   - edit `.env` and delete the `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` lines;
   - then run `scripts/deploy.sh` to apply the change.

4. Replace the bootstrap password, which was written in `.env`: sign in at `https://<origin>/admin`, click **CHANGE PASSWORD** at the foot of the sidebar, and store the new password in your password manager. Every other session of the account ends.

5. Add a second ADMIN, so that one can act when the other is away (an ADMIN cannot disable, unlock or change its own account, and the last active ADMIN can be neither demoted nor disabled). ADMIN accounts are created from the shell only, with their second factor:

   ```bash
   read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD   # type their password: nothing shows, nothing enters the shell history
   docker compose exec -e ADMIN_PASSWORD app node --import tsx scripts/admin.ts create --email <second admin> --role ADMIN
   unset ADMIN_PASSWORD
   docker compose exec app node --import tsx scripts/admin.ts totp-setup --email <second admin>
   read -rs ADMIN_TOTP_SECRET && export ADMIN_TOTP_SECRET   # paste the secret printed above, then clear the screen
   clear
   docker compose exec -e ADMIN_TOTP_SECRET app node --import tsx scripts/admin.ts totp-enable --email <second admin> --code <6-digit code>
   unset ADMIN_TOTP_SECRET
   ```

   The person stores their password in their own password manager and never pastes it in a conversation; they can replace it from the console at any time (step 4).

6. Staff accounts (workshop, client services, auditors, boutique sellers) are created in the console, on the **TEAM** page (Security group of the sidebar, ADMIN only):
   - **NEW STAFF ACCOUNT**: their email and the role, OPERATOR (issues and maintains pieces), AUDITOR (reads) or RETAIL (a seller: the sale mode on a phone, nothing else, §7 step 5);
   - the console shows a **temporary password once**: copy it, hand it over in person or over a trusted channel (it is typed exactly as shown, capitals and dashes included), then click *I have handed it over — hide*;
   - at their first sign-in they must choose their own password before anything else, then enrol their authenticator app (the console asks for it in production);
   - check that their row no longer says TEMPORARY PASSWORD.

7. When someone leaves: **TEAM**, their row, **DISABLE**. They can no longer sign in and every open session of theirs ends at once; the account and its history stay. The same page changes a role, lifts a lockout (*Unlock*), ends the sessions of a lost laptop (*Sessions*) and resets a lost second factor. Every action is in the audit log, with the email of the ADMIN who did it. Without any ADMIN able to sign in: `scripts/admin.ts disable --email <e> --yes` (and `enable`, `role`).

**Optional:** to restrict `/admin` to your office or home IPs, set `ADMIN_ALLOWED_IPS` in `.env` (space-separated IPs or CIDRs, no commas), then run `scripts/deploy.sh`, which validates the Caddy configuration before applying it. The sale mode (§7 step 5) runs on the boutiques' phones, which open `/admin` too: with the allowlist on, add every boutique's fixed IP or CIDR, or leave it off while counter phones use mobile data or a shop Wi-Fi whose address changes, or the sale mode answers 403 at the counter.

## 5. Smoke test

```bash
curl -s https://verify.theorbes.com/api/v1/health                # {"ok":true,...}
curl -s https://verify.theorbes.com/.well-known/orbes-keys.json  # one ACTIVE Ed25519 key
docker compose ps                                                # caddy, app, postgres: healthy
```

- Open `https://verify.theorbes.com/verify` on a phone. NOW should appear, and the camera opens when you tap SCAN ORBES CODE or the SCAN ring.
- Open `https://verify.theorbes.com/admin` and sign in (password + TOTP). The dashboard should load.

## 6. Backups (do not skip)

1. **Local backup and restore drill.** Run `scripts/backup.sh`. The archive appears in `/var/backups/orbes`. Then rehearse a restore once on a test VM, or follow the drill in DEPLOYMENT.md §15. The restore script needs the backup private key from your vault.
2. **Off-site copy (recommended).**
   - In OVH → *Object Storage*, create a bucket and S3 credentials.
   - Run `rclone config` as `orbes` to add the remote.
   - Set `BACKUP_RCLONE_DEST=<remote>:<bucket>/orbes` in `.env`.
3. **Check the timer.** `systemctl list-timers 'orbes-*'` should list the nightly backup and the weekly GeoIP refresh.

## 7. Catalogue and first products (admin console)

1. **Catalogue:** create the categories (e.g. J Jewelry, L Leather Goods, W Watches, F Fragrance, A Accessories). Category letters and indices are permanent. Then create collections and models (e.g. MONOLITHE · RING · 925 STERLING SILVER). Later, **Edit** on a model's row changes its name, default material, care instructions, collection and status, and **Rename** a collection's name: every result of the pieces already issued reads them at once, so the dialog says how many pieces it touches and shows the care block as the client reads it. A model's category and SKU prefix never change. A model retired from the range is made **inactive** (the generator stops offering it), and an ADMIN can **Deactivate** a category: no new piece, the pieces already issued verify as before (API §13).
2. **Generator:** issue a product, choosing category, model, material, batch and production date. Tick "claim code" if the certificate card will carry the claim code. For a production run, use **BATCH**: the same template, then a quantity or the workshop's CSV (one row per piece: `variant`, `sku`, `serial`, each optional), checked line by line and previewed before *SIGN 120 PRODUCTS*. Save the certificate cards or the results file before leaving the result: the claim codes are shown once (API §14.11).
3. **Download the artifact:**
   - **PDF** for print, **SVG** for engraving or foil vendors, **PNG** for previews.
   - Recommended minimum size: **30 mm**, or **20 mm** for small tags if customers can zoom.
   - Leave the 2 u quiet zone around the code.
4. **Claim code:** it is shown **once**. While it is on screen, click **Download certificate card**: the server checks the code against its hash and returns the card 79t (PDF, 95 × 62 mm, one side) with the piece's ORBES CODE and the claim code in plain sight, with no scratch-off panel. Nobody copies the 12 characters by hand. For a print run, `POST /api/admin/certificates` also gives A4 sheets of eight and a CSV for the print shop's variable-data printing (API §15.7); the PDF is K only, with no spot colour, so an office or digital printer prints it as it is. The card layout is validated (BRAND §7, 2026-10-07): no card or file name says PROOF. Before the first card goes into a box, print one A4 sheet on the chosen card stock, cut it, scan its ORBES CODE with a phone, and check that the box takes a 95 × 62 mm card.
5. **Points of sale and the sale mode** (A-08): on **POINTS OF SALE** (Clients group, ADMIN), add every boutique, department store and the online shop (name, city, two-letter country; the online shop without a country). A warranty's point of sale is then chosen from this list, in the product page's *Activate warranty* and in the sale mode; a closed boutique is deactivated, never deleted. Give each seller a nominative **RETAIL** account (§4 step 6). On the counter phone, the seller opens `https://<origin>/admin` (with `ADMIN_ALLOWED_IPS` set, the boutique's network must be in the list, §4), signs in (password, then the authenticator in production) and lands on **SALE MODE**: choose the point of sale once (the phone remembers it), **SCAN THE PIECE**, check the piece shown (READY TO SELL), **ACTIVATE WARRANTY**, then hand over the certificate card and tell the client the sentence on the screen: *Register your piece with its card at theorbes.com/verify*. Every scan is recorded under the seller's name (Verification events, event ADMIN TEST) and every activation in the audit log with the point of sale. Check stock the same way, from a phone or browser signed in to the console: a scan of a piece not sold yet from anywhere else raises **UNSOLD PIECE SCANNED** in *Anomalies* (S-07, the first sign of diverted stock). A member of the team who buys a piece scans and registers it from a browser that is **not** signed in to the console: with a console session, the scan is a staff test and registration is not offered.
6. **Before the first sale: the sales playbook** (J-09). The [sales and shipping playbook](launch/SALES-PLAYBOOK.md), in French, gives one sheet per situation, each with the gesture in the console and the sentence to say: a sale in a boutique (sale mode or console) and an online order (console, before the parcel leaves), a worried client (every result of API §9.3), a resale (the transfer code), a loss or a theft, a forgotten password (with the identity check, to finalise with counsel), the staff's own pieces and the forbidden words. Everyone who will sell or answer clients runs its 30-minute checklist on a test piece once, alone, before the first sale; its §10 creates their nominative OPERATOR account, the second factor enrolled from the shell.

## 8. Validate on real phones before the public launch

1. Print `docs/assets/test-sheets/orbes-code-test-sheets.pdf` at **100 % scale** (no "fit to page").
2. Scan the codes with a few iPhones (including a Pro) and Android phones at 10–25 cm, on each real material you will use: card, leather tag, engraved silver.
3. Keep the smallest size that reads reliably on every phone. The simulator's estimate is 30 mm without zoom and 20 mm with zoom.
4. Scan one real issued product end to end. Expect AUTHENTIC — FIRST REGISTRATION after you activate its warranty in the admin (or from the sale mode on a phone with a test RETAIL account: under 20 seconds from SCAN THE PIECE to WARRANTY ACTIVE); register it with a test customer account, from a browser that is not signed in to the console (signed in, the OWNERSHIP tab says STAFF SCAN and offers no registration); check the ownership tab.

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

**The legal pages are online** (J-06), by the owner's decision before counsel's review: the verification service serves them in French and English, versioned with the code (`LEGAL_VERSION`, `genome/src/web/legal/content/`), at

| Page | Address | Written from |
|---|---|---|
| Privacy policy | `https://verify.theorbes.com/legal/privacy` | The code: what a verification records (the code, the result, the time; pseudonyms of the IP address and of the device cookie, keyed with `IP_HASH_PEPPER`; the country and coordinates rounded to about 10 km from the DB-IP file; the browser family; signed in, the account and a pseudonym of the session), the account (email, scrypt hash, sessions of 30 days), the three cookies, the retention (scans kept without a time limit while `SCAN_RETENTION_DAYS` is unset, as the page says), the backups (about two months), the hosts (OVHcloud in Canada, Vercel Inc.), DB-IP, the rights |
| Terms of use | `https://verify.theorbes.com/legal/terms` | The drafts of [docs/legal](legal/README.md), word for word |
| Legal notice | `https://verify.theorbes.com/legal/notice` | The drafts of [docs/legal](legal/README.md), word for word |
| FAQ | `https://verify.theorbes.com/legal/faq` | The code and the customer's copy: what a result proves, UNUSUAL ACTIVITY DETECTED, buying second-hand (the sentence of J-02), a lost claim code, the transfer, a loss or a theft, a forgotten password, the data |

`/legal` is their index; `?lang=fr` or `?lang=en` chooses the language, else the browser's. `/verify` links them in the footer of every screen (NOW, a result, MY PIECES, THE COLLECTION, THE RELEASES, THE CIRCLE) and in the account sheet (PRIVACY · TERMS · LEGAL · HELP, then *IP Geolocation by DB-IP* in the footer), and links the terms and the privacy policy under CREATE ACCOUNT, where the account's data is collected. Until ORBES gives its legal identity, the pages read "ORBES" where the company is named and show no empty field. `genome/test/web/legal.content.test.ts` holds the terms and the notice to their drafts and the privacy policy and the FAQ to the code: a draft or a rule that changes fails it until the pages follow. After a deployment, open `/legal/faq` on a phone and check that it reads in its language.

- [ ] Privacy policy covering scan data, **online** at `/legal/privacy` (above): counsel validates it, settles the transfer basis for the server in Canada (COMPLIANCE §7, H2) and, with the owner, the retention of scans (`SCAN_RETENTION_DAYS`; then change the policy's retention line and `LEGAL_VERSION`). It covers the verification service and the ORBES account, not the other pages of theorbes.com (`index.html`, outside this system), which keep a cookie (`orbes_code`) and forms of their own: before theorbes.com links its legal mentions to these pages, its own data needs a section or a policy of its own.
  - pseudonymised IP and device hashes;
  - approximate location (country / ~10 km);
  - account data;
  - retention.
- [ ] Terms for ORBES accounts, ownership registration and transfers, and the legal notice of theorbes.com and verify.theorbes.com, **online** at `/legal/terms` and `/legal/notice` (above). Drafts in French and English are in [docs/legal](legal/README.md), each clause tied to the rule of the code it describes ([TERMS-FACTS](legal/TERMS-FACTS.md), held to the code by `genome/test/docs/terms-facts.test.ts`). Counsel completes the `[À COMPLÉTER]` fields (company name, RCS, share capital, publication director, the hosts' details, the consumer mediator) and settles the questions of the [note for counsel](legal/counsel-note.fr.md): the Toubon law (warranty, care and instructions in English only) and the consumer mediator. Then the drafts are filled in, and the pages after them (`genome/src/web/legal/content/terms.ts`, `notice.ts` and its `LEGAL_IDENTITY`, with a new `LEGAL_VERSION`).
- [x] Attribution for the GeoIP data: "IP Geolocation by DB-IP" (CC BY 4.0), see `NOTICE.md`: in the footer of every screen of `/verify` (NOW, a result, MY PIECES, THE COLLECTION, THE RELEASES, THE CIRCLE), at the foot of every legal page, in the privacy policy and in the credits of the legal notice, each a link to db-ip.com (J-06).
- [ ] Privacy text and consent: wishlist and tastes (plan CUSTOMER INTELLIGENCE §3.2; the one legal line of its §0.12): the privacy policy to say that YOUR WISHLIST (the models marked with the heart, removed ones kept 13 months, then only monthly counts per model) and YOUR TASTES (the favourite pieces and finishes) are kept and read by ORBES, and the consent to ask. No legal page is changed by this lot and `LEGAL_VERSION` does not move until then.
- [ ] Customer copy reviewed by legal. The system never claims a scan proves an object is genuine; keep it that way in packaging and marketing.
- [ ] ORBES Client Services contact, from the brand: set `CLIENT_SERVICES_EMAIL`, `CLIENT_SERVICES_PHONE` and `CLIENT_SERVICES_HOURS` in `.env` ([DEPLOYMENT §3.1](DEPLOYMENT.md#31-variables)), then run `scripts/deploy.sh`. Until then, FORGOTTEN PASSWORD? offers no email and the legal pages no contact. Check with a test piece: void its warranty in the console, scan it on a phone, open the WARRANTY tab: it shows WRITE TO ORBES CLIENT SERVICES (CS-01); signed out, FORGOTTEN PASSWORD? shows CONTACT ORBES CLIENT SERVICES.
- [ ] Packaging and website text: "Verify only at verify.theorbes.com" on the packaging and the certificate card, "Verify only at theorbes.com/verify" on the website (it opens the same scanner). The words are in the [packaging kit](launch/PACKAGING-KIT.md), in French and English:
  - the three steps of the packaging, the same as on the certificate card;
  - the card's copy and the claim code rules;
  - the second-hand sentence;
  - the French lexicon of BRAND §4.5;
  - a draft announcement for the website, social media and e-mail.

  The brand validates the kit before anything is printed (its §6). The announcement is published only after the H1/H2 review of COMPLIANCE §7.

## 11. Running it

| When | What |
|---|---|
| Continuously | An uptime monitor (UptimeRobot, Better Stack…) on `https://verify.theorbes.com/api/v1/health` |
| Daily | Admin → *Cases*: customers' answers to WHERE DID YOU SEE OR BUY THIS PIECE? on results that were not authentic. Follow each from its scan, anomaly and piece, then close it with a note (OPERATOR). Their words are personal data and go with the scan. |
| Weekly | Admin → *Anomalies*: review OPEN items. Nothing is ever revoked automatically. An UNSOLD PIECE SCANNED finding is a piece still in stock scanned outside the console (with the country, once a day): find the piece in stock, or treat it as diverted (LOST / STOLEN); dismiss a boutique's own stock check with a note. |
| Weekly (disk) | The photographs' line of the nightly backup, `journalctl -u orbes-backup \| grep 'photos:' \| tail`, then `df -h /` and `du -sh /var/backups/orbes`. The shared server's thresholds ([DEPLOYMENT §15.12](DEPLOYMENT.md#1512-monitoring-and-routine-checks)): `/` above 75 %, or the photographs above 300 MB, tell the host owner before acting and choose a lever together; `/` above 80 % is the alert. |
| Each update | `git pull && scripts/deploy.sh`, not between 03:00 and 05:30 UTC. It takes a backup first. On a failure, it rolls back automatically only a release that applied no migration (and only to an image that knows every migration of the database). A release whose migrations committed is kept, started on the new image, and repaired forward: `scripts/deploy.sh --image <new tag>` after a transient incident, otherwise a corrective commit, deployed normally. Never `restore.sh` on the shared server: its `.env` says `RESTORE_ALLOWED=false`, and the script refuses ([DEPLOYMENT §15.7](DEPLOYMENT.md#157-updates-and-rollback-deploysh), §15.9). |
| Monthly | Check `/var/backups/orbes` and the off-site bucket; look at disk usage (`df -h /`, `du -sh /var/backups/orbes`). |
| Yearly / on staff change | Rotate the signing key: Admin → *Keys* → *Rotate*. Old products stay verifiable. |
| Suspected key compromise | Admin → *Keys* → *Revoke* with the compromise time, then rotate. See DEPLOYMENT.md, key compromise runbook. |
| Lost admin authenticator | Another ADMIN resets it in the console, or on the VPS run `node --import tsx scripts/admin.ts reset-totp --email … --yes` |
| A client forgot the password | After checking the client's identity (outlined for staff in the [sales playbook](launch/SALES-PLAYBOOK.md), §6; to finalise with counsel): Admin → *Owners* → *Recovery code* on the client's row (ADMIN). Read the code to the client, who enters it on `/verify` under FORGOTTEN PASSWORD? within 30 minutes, with a new password. Never write it down or send it on. The recovery ends every session of the account and pauses transfers out of it for 72 hours. |
| A client asks to lock the account, or for the data held about it | After the same identity check: Admin → *Owners* → the client's sheet → *Lock account* (sessions end, pending transfers are cancelled, links to ownership certificates are withdrawn, the open recovery code is revoked) or *Export data* (a JSON file of everything held about the account, to hand over under the right of access). Both ADMIN, both audited. |
| A client cannot receive a piece with its transfer code | The code is accepted only for the piece the client scans, signed in to their ORBES account, within 15 minutes of that scan (F-03): *This transfer code is not for this piece* means the seller gave the code of another piece; ask the seller for the code of this one. Signed in after the scan, or past the 15 minutes, the client verifies or scans the piece again (the 15 minutes run on the phone's own clock from the result, so a phone set to the wrong time is no obstacle). A result *UNUSUAL ACTIVITY DETECTED* caused only by many scans elsewhere (a code shown in a listing) does not block the client: signed in, the result offers *DO YOU HOLD A TRANSFER CODE?* with the same form. A browser signed in to the console says *STAFF SCAN*: the client (or a member of staff buying for themselves) scans in a browser that is not. A phone without a camera reads the code from a photo (UPLOAD A PHOTO). A code too damaged to read is replaced as any damaged code: Admin → the piece → *Re-issue code* (OPERATOR), then the new code is put on the piece and the client scans it. Do not set `TRANSFER_ACCEPT_REQUIRE_PRODUCT=false` for a client who cannot scan: it only lets `POST /api/v1/ownership/transfers/accept` take a code without the piece and the scan; the verify app still offers RECEIVE THIS PIECE only after a signed-in scan of the piece, neither the console nor a script accepts a transfer for a client (the switch has no client in this release, a declared deviation of the plan), and while it is set the check is off for every pending transfer of the platform. |

## 12. Optional

- **Repository visibility:** the GitHub repository is currently **public**. Make it private if you don't want the sources and internal specifications visible (GitHub → *Settings* → *Danger Zone*).
- **Cloudflare in front of `verify.theorbes.com`:** set `EDGE_MODE=cloudflare` and `GEO_MODE=cloudflare`. See DEPLOYMENT.md §15.
- **Local demo, no server needed:** `cd genome && npm ci && npm run demo`, then open `http://localhost:8080/verify` and `/admin`. The demo admin login is printed once.

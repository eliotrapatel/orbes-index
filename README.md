# ORBES

This repository holds two independent things:

| Path | What it is |
|---|---|
| [`index.html`](index.html) | **The ORBES website** (theorbes.com). A single static page with its assets embedded. It has no build step, and nothing in this repository changes it. |
| [`genome/`](genome/) | **ORBES GENOME CODE**, the product identity and authentication system: Ed25519-signed orbital codes (ORBES CODE) carrying a unique visual identity (ORBES GENOME), a Fastify + PostgreSQL verification service, the mobile scanner at `/verify` and the admin console. It is deployed as a container, separately from the website ([deployment](docs/DEPLOYMENT.md#11-mapping-theorbescomverify-to-the-service)). |
| [`docs/`](docs/) | Specifications, reports and reference assets for ORBES GENOME CODE. |

## Start here

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): audit, architecture, threat summary, technology choices and implementation plan.
- [genome/README.md](genome/README.md): developer guide (setup, commands, tests, conventions).
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): production deployment and operations runbook.

## Specifications

1. [ORBES-GENOME-SPEC](docs/ORBES-GENOME-SPEC.md): GENOME-01 visual identity
2. [ORBES-CODE-SPEC](docs/ORBES-CODE-SPEC.md): CODE-01 machine-readable code
3. [CRYPTOGRAPHY](docs/CRYPTOGRAPHY.md): payload, signatures, key management
4. [SECURITY-MODEL](docs/SECURITY-MODEL.md): security principles and controls
5. [THREAT-MODEL](docs/THREAT-MODEL.md): threats, protections and residual risks
6. [API](docs/API.md): HTTP API reference
7. [DATABASE](docs/DATABASE.md): schema, migrations, retention and backups
8. [BRAND-DESIGN-SYSTEM](docs/BRAND-DESIGN-SYSTEM.md): visual language of the code, scanner and console
9. [FUTURE-HARDWARE](docs/FUTURE-HARDWARE.md): secure NFC and secure-element roadmap

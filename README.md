# Geo Relief Network

**Descriptive name:** Red Geoespacial de Respuesta Vecinal (Geospatial Neighborhood Relief Network)
**Product scope:** Global community emergency coordination
**Demo dataset:** Lima, Peru

Geo Relief Network connects emergency donors, aid seekers, and neighborhood collection points. Muse Spark helps interpret text and voice; deterministic services and PostgreSQL transactions enforce inventory, identity, permissions, and FIFO allocation.

The product is designed for communities in different regions. Lima is the current demonstration dataset, not a geographic restriction. The web interface supports English and Spanish. It uses the browser language only as an initial suggestion, defaults to English for other languages, and provides a visible selector that remembers the user's choice. Neither country nor location determines language.

## Project status

The repository contains a working vertical slice for conversation, recommendations, confirmation drafts, donation manifests, and collection point operations, alongside features that remain incomplete or unverified. English/Spanish localization is integrated on the Vercel Preview branch `codex/grn-mvp-preview-20261104`; its deployment and visual review are the next checks. GitHub `main` remains the production source; pushing to `main` triggers the Vercel production deployment.

- Production: https://geo-relief-network.vercel.app/
- Repository: https://github.com/CCuetoC/geo-relief-network
- Product specification: [SPEC.md](SPEC.md)
- Technical stack: [TECH_STACK.md](TECH_STACK.md)
- Agent instructions: [AGENTS.md](AGENTS.md)
- Architecture decisions: [docs/adr/README.md](docs/adr/README.md)
- Migration guide: [migrations/README.md](migrations/README.md)
- Evidence-based progress: [PROGRESS.md](PROGRESS.md)

## Main workflows

- **Web conversation:** collects intent, products and quantities, area, mobility or donation preference, pickup window, and photos as needed. Muse Spark asks for missing information; the backend checks the catalog and collection points.
- **Voice:** Muse Spark transcribes audio in memory and extracts structured fields in a second call. WAV and MP3 are accepted; unsupported WhatsApp OGG audio asks the person to continue with text. Raw audio is not retained.
- **Aid requests:** the person reviews a preview and confirms using an opaque server-issued draft ID. Idempotency prevents duplicate submissions. Each product line is reserved in full or waits in full; when available stock is insufficient, the person adjusts the quantity before submitting.
- **FIFO:** allocations are serialized by collection point and product. Temporary offers last 30 minutes; confirming one issues a pickup code and keeps the reservation until that local day's closing time. Without a cron job, expiry reconciliation and follow-up notifications are opportunistic.
- **Donations:** the donor prepares a manifest with quantities and private photos for each product. A collection point manager checks the physical items and validates accepted quantities. Only human validation of a physical handoff increases confirmed stock.
- **WhatsApp:** a signed webhook, message deduplication, verified account linking, interactive replies, and a post-commit notification outbox are implemented in code. The real provider integration still requires environment configuration and end-to-end verification.
- **Privacy:** exact user coordinates are used for the Haversine lookup and are not stored in conversation context. Public maps do not expose aid seekers' precise locations. Muse Spark receives `photo_attached: boolean`, never the image or its storage key.

## Localization model

- English and Spanish dictionaries share the same message keys.
- A manual language choice is saved in the `grn_locale` cookie and takes precedence over the browser's `Accept-Language` preference.
- The chosen locale is sent to the shared conversation service. WhatsApp stores the locale selected when linked and updates it from subsequent incoming messages.
- Product IDs and slugs remain stable across languages. Localized names, units, and aliases are stored in the versioned Neon catalog migration so “water” and “agua” resolve to the same product.
- Dates and quantities use the chosen locale; collection point times use that point's configured IANA time zone.

## Current limitations

- `vercel-dev` contains a Lima demo point and two demo products. There is no production catalog or admin UI for creating points, products, capacity rules, or manager permissions.
- Pickup availability is captured as a user-provided time window and daily capacity; discrete overlapping appointment slots are not implemented.
- The public page queries points and availability from Neon, filters by area/product, can sort by locally calculated distance, and opens directions in Google Maps. The interactive Google map has been verified locally; Vercel configuration and a real mobile viewport still need review.
- Neon Auth with Google and development account permissions were verified in `vercel-dev`. This does not configure production OAuth.
- WhatsApp Cloud API, Muse audio transcription, and private object storage need end-to-end checks with their target environment credentials.
- There is no statistical demand forecast. Recommendations use confirmed stock, waiting demand, announced supply, acceptance rules, hours, capacity, and distance.
- The bilingual catalog and WhatsApp locale migration `0004` passed the automated suite against a disposable Neon branch and is applied to `vercel-dev` and the Neon branch linked to Vercel Preview. Production remains on the previously deployed schema until a reviewed merge to `main`.

## Stack

Next.js App Router, React, TypeScript, Tailwind CSS 4, shadcn/ui, Neon Postgres, Neon Auth, `@neondatabase/serverless`, Neon Object Storage, Vercel Node.js Functions, GitHub, Google Maps Platform, Meta Model API (Muse Spark), and WhatsApp Cloud API.

GitHub stores the source code. A push to `main` triggers Vercel's build and deployment; this workflow does not run a manual `vercel deploy`.

## Known infrastructure

- Neon project `geo-relief-network`, AWS `us-east-2` (Ohio), with `production` and `vercel-dev` branches.
- Vercel project `geo-relief-network`; the observed production deployment used `iad1` (Ashburn, Virginia).
- Migrations are ordered, immutable SQL files. Migrations `0001`–`0004` are applied in `vercel-dev` and the branch-specific Neon Preview database; production has not been changed. See [SPEC.md](SPEC.md) and [PROGRESS.md](PROGRESS.md) for observed evidence.

## Local development

Requirements: Node.js 20.9 or later and npm.

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Open http://localhost:3000. The production build is designed to work without external credentials; individual integrations require their corresponding environment variables. Do not commit `.env.local` or secrets.

### Checks and migrations

```powershell
npm run typecheck
npm run build
npm run test:unit
```

Integration tests require an explicit disposable Neon branch URL through `GRN_TEST_DATABASE_URL`. The test runner does not read `.env.local` or fall back to application database URLs.

To apply an approved migration, set `DATABASE_URL_UNPOOLED` to a direct connection (without `-pooler`) for a disposable development branch and run `npm run db:migrate`. The runner verifies checksums, takes an advisory lock, and applies each migration in a transaction. It is not run from application requests or Vercel builds.

## Main routes

| Route | Purpose |
|---|---|
| `/` | Public collection point map/list, search, stock, needs, and directions. The map SDK requires a configured Google Maps key. |
| `/chat` | Web chat with text, voice, photos, action confirmation, and optional WhatsApp linking. |
| `/donate`, `/request` | Shortcuts to the shared chat. |
| `/manager` | Authenticated interface to validate manifests, review photos, process FIFO, and confirm pickups. Requires manager permission in Neon. |
| `POST /api/chat` | Web conversation service and authenticated confirmation of drafts. |
| `GET/POST /api/whatsapp/webhook` | Webhook verification and signed message processing. |
| `GET/POST/DELETE /api/whatsapp/link` | Read, create, and remove a consented WhatsApp link. |
| `POST /api/media/upload` | Validate and store private photos. |
| `/api/manager/*` | Authorized manager reads and operations; only physical validation adds stock. |
| `GET/POST /api/notifications` | Read and acknowledge the current user's web notifications. |

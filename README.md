# Geo Relief Network

**Red Geoespacial de Respuesta Vecinal (Geospatial Neighborhood Relief Network)** is a global community emergency coordination prototype. It helps donors, people seeking aid, and local collection points coordinate supplies using human-verified inventory and geospatial recommendations.

**Meta Global AI Developer Hackathon** · **Indie Developer** · **Build for Your World**<br>
**Scope:** Global · **Demo data:** Lima, Peru · **Languages:** English and Spanish

[GitHub repository](https://github.com/CCuetoC/geo-relief-network)

[Production demo](https://geo-relief-network.vercel.app/)

## The idea

During a disaster, one neighborhood may receive more donations than it can use while a nearby area runs short. Geo Relief Network is designed to make local needs and confirmed supplies easier to coordinate, while helping collection points manage arrivals and pickup demand.

1. **Donors prepare a manifest** with items, quantities, and private photos before drop-off.
2. **Collection point staff validate the physical delivery** against that manifest. Announced donations remain expected supply; only human validation adds confirmed stock.
3. **People submit aid requests** and can reserve available supplies or wait for a complete product line through a FIFO queue.
4. **Geospatial recommendations** help connect donors and aid seekers with suitable collection points. Public views do not expose aid seekers’ precise locations.

## AI and operational safeguards

Muse Spark is the conversational layer: it helps interpret messages, collect missing details, and explain recommendations. Deterministic backend services and PostgreSQL enforce identity, permissions, availability, idempotency, and queue order. Muse Spark cannot approve a physical delivery or change inventory; collection point staff validate handoffs.

## Demo and current status

The production deployment is available at [geo-relief-network.vercel.app](https://geo-relief-network.vercel.app/). Its public page loads the Lima demo point and two catalog items, both with confirmed stock at zero. The interactive map still shows its setup fallback because the production Google Maps key is not configured, and authentication has not been verified in production. Lima is only demo data; the product is intended for communities in different regions.

The repository contains an inventory engine, bilingual interface, and initial web flows for conversation, donation, and collection point operations. The interface was reviewed at 1440px and 390px browser viewport widths. This does not verify all flows end to end: the interactive map still shows its setup fallback in Preview, and authenticated manager operations have not had a complete UI end-to-end review.

The latest recorded automated run passed **16/16 tests** on 2026-11-04: 10 unit tests and 6 integration tests against a disposable Neon branch. These tests cover service and database behavior, not the full UI or live OAuth, Muse, WhatsApp, voice, Google Maps, and private object storage integrations. See [PROGRESS.md](PROGRESS.md) for the evidence and limitations.

## Technology

Next.js App Router, React, TypeScript, Tailwind CSS 4, shadcn/ui, Neon Postgres with `@neondatabase/serverless`, Neon Auth, Neon Object Storage, Vercel Node.js Functions, Google Maps Platform, and Meta Model API (Muse Spark). WhatsApp Cloud API adapters are present in the codebase; live provider behavior still needs end-to-end verification.

## Run locally

Requirements: Node.js 24 and npm.

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

On macOS or Linux, use `cp .env.example .env.local` instead of `Copy-Item`. Configure only the integrations you want to run in `.env.local`; never commit that file or share its secrets.

### Checks

```sh
npm run typecheck
npm run build
npm run test:unit
```

The full `npm test` suite includes database integration tests and requires `GRN_TEST_DATABASE_URL` to point explicitly to a disposable Neon branch. The test runner does not fall back to `.env.local` or the application database URL.

## Known limitations

- Google Maps is not configured in production; the page shows the map setup fallback while the public point list and direct Google Maps directions are available. A physical-device review remains outstanding.
- Google authentication was verified in the development environment, not production; the live page could not verify the current session. The manager console requires manager permission and has not received a full end-to-end UI verification.
- Live Muse, WhatsApp, audio transcription, and private object storage flows still need verification in their target environment.
- There is no self-service administration for collection points, catalog items, capacity rules, or manager permissions, and no statistical demand forecast.
- Pickup availability is collected as a time window; discrete overlapping appointment slots are not implemented.

## Project documentation

- [Product specification](SPEC.md)
- [Technical stack](TECH_STACK.md)
- [Design guidelines](DESIGN.md)
- [Evidence-based progress](PROGRESS.md)
- [Architecture decision records](docs/adr/README.md)
- [Database migrations](migrations/README.md)
- [Agent contribution instructions](AGENTS.md)
- [MIT License](LICENSE)

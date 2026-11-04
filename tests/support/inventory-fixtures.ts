import { randomUUID } from "node:crypto";
import { withTransaction } from "@/core/server/db";

export interface InventoryFixture {
  pointId: string;
  productId: string;
  productName: string;
  managerId: string;
  timezone: string;
}

export interface InventorySnapshot {
  onHand: number;
  expectedInbound: number;
  available: number;
  requests: number;
  manifests: number;
  commitments: number;
  waitingEntries: number;
  movements: number;
  outbox: number;
}

const fixturePrefix = `grn-test-${randomUUID()}`;

function timezoneForCurrentClock() {
  // Keep the synthetic point well before closing even when the suite runs late in UTC.
  return new Date().getUTCHours() >= 21 ? "Etc/GMT+12" : "UTC";
}

export function createActor(label: string) {
  return `${fixturePrefix}-${label}-${randomUUID()}`;
}

export async function createInventoryFixture(options: {
  initialStock?: number;
  maxOnHand?: number;
  maxPerRequest?: number;
  intakeCapacity?: number;
  pickupCapacity?: number;
} = {}): Promise<InventoryFixture> {
  const pointId = randomUUID();
  const productId = randomUUID();
  const managerId = createActor("manager");
  const productName = `Test water ${randomUUID().slice(0, 8)}`;
  const slug = `test-water-${randomUUID()}`;
  const timezone = timezoneForCurrentClock();

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO grn_collection_points
         (id, name, neighborhood, city, country_code, latitude, longitude, timezone,
          intake_capacity, pickup_capacity, same_day_cutoff_minutes, active)
       VALUES ($1, $2, 'Fixture', 'Lima', 'PE', -12.0464, -77.0428, $3, $4, $5, 0, true)`,
      [pointId, `${fixturePrefix}-${pointId.slice(0, 8)}`, timezone, options.intakeCapacity ?? 100, options.pickupCapacity ?? 100],
    );

    for (let weekday = 0; weekday <= 6; weekday += 1) {
      await client.query(
        `INSERT INTO grn_collection_point_hours (collection_point_id, weekday, opens_at, closes_at)
         VALUES ($1, $2, TIME '00:00', TIME '23:59')`,
        [pointId, weekday],
      );
    }

    await client.query(
      `INSERT INTO grn_products (id, slug, name, unit, suggested_units_per_person, active)
       VALUES ($1, $2, $3, 'unit', 1, true)`,
      [productId, slug, productName],
    );
    await client.query(
      `INSERT INTO grn_collection_point_products
         (collection_point_id, product_id, max_per_request, max_on_hand)
       VALUES ($1, $2, $3, $4)`,
      [pointId, productId, options.maxPerRequest ?? 100, options.maxOnHand ?? 1_000],
    );
    await client.query(
      `INSERT INTO grn_inventory_controls (collection_point_id, product_id, confirmed_on_hand)
       VALUES ($1, $2, $3)`,
      [pointId, productId, options.initialStock ?? 0],
    );
    await client.query(
      `INSERT INTO grn_collection_point_managers (collection_point_id, user_id, active)
       VALUES ($1, $2, true)`,
      [pointId, managerId],
    );
  });

  return { pointId, productId, productName, managerId, timezone };
}

export async function currentAvailabilityWindow(timezone: string) {
  const result = await withTransaction((client) => client.query<{ start: string }>(
    `SELECT to_char(
              date_trunc('minute', transaction_timestamp() AT TIME ZONE $1)::time + interval '5 minutes',
              'HH24:MI'
            ) AS start`,
    [timezone],
  ));
  return { start: result.rows[0].start, end: "23:59" };
}

export async function setClosingInMinutes(fixture: InventoryFixture, minutes: number) {
  await withTransaction(async (client) => {
    const clock = await client.query<{ weekday: number; closes_at: string }>(
      `SELECT EXTRACT(DOW FROM transaction_timestamp() AT TIME ZONE $1)::int AS weekday,
              to_char(
                date_trunc('minute', transaction_timestamp() AT TIME ZONE $1)::time
                  + make_interval(mins => $2),
                'HH24:MI'
              ) AS closes_at`,
      [fixture.timezone, minutes],
    );
    await client.query(
      `UPDATE grn_collection_point_hours
          SET closes_at = $3::time
        WHERE collection_point_id = $1 AND weekday = $2`,
      [fixture.pointId, clock.rows[0].weekday, clock.rows[0].closes_at],
    );
    await client.query(
      `UPDATE grn_collection_points SET same_day_cutoff_minutes = 60 WHERE id = $1`,
      [fixture.pointId],
    );
  });
}

export async function insertTestPhoto(ownerId: string) {
  const id = randomUUID();
  await withTransaction((client) => client.query(
    `INSERT INTO grn_private_media (id, owner_id, storage_key, content_type, byte_size)
     VALUES ($1, $2, $3, 'image/png', 68)`,
    [id, ownerId, `test-only/${fixturePrefix}/${id}.png`],
  ).then(() => undefined));
  return id;
}

export async function readInventorySnapshot(fixture: InventoryFixture, requesters: string[] = []): Promise<InventorySnapshot> {
  return withTransaction(async (client) => {
    const result = await client.query<{
      on_hand: number;
      expected_inbound: number;
      available: number;
      requests: number;
      manifests: number;
      commitments: number;
      waiting_entries: number;
      movements: number;
      outbox: number;
    }>(
      `SELECT ic.confirmed_on_hand AS on_hand,
              grn_expected_inbound($1, $2, transaction_timestamp(), NULL)::int AS expected_inbound,
              grn_available_stock($1, $2, transaction_timestamp())::int AS available,
              (SELECT COUNT(*)::int FROM grn_aid_requests WHERE requester_id = ANY($3::text[])) AS requests,
              (SELECT COUNT(*)::int FROM grn_donation_manifests WHERE collection_point_id = $1) AS manifests,
              (SELECT COUNT(*)::int FROM grn_reservation_commitments WHERE collection_point_id = $1 AND product_id = $2) AS commitments,
              (SELECT COUNT(*)::int FROM grn_waitlist_entries WHERE collection_point_id = $1 AND product_id = $2) AS waiting_entries,
              (SELECT COUNT(*)::int FROM grn_inventory_movements WHERE collection_point_id = $1 AND product_id = $2) AS movements,
              (SELECT COUNT(*)::int FROM grn_notification_outbox WHERE recipient_user_id = ANY($3::text[])) AS outbox
         FROM grn_inventory_controls ic
        WHERE ic.collection_point_id = $1 AND ic.product_id = $2`,
      [fixture.pointId, fixture.productId, requesters],
    );
    const row = result.rows[0];
    if (!row) throw new Error("No se encontró el control de inventario de la fixture.");
    return {
      onHand: Number(row.on_hand),
      expectedInbound: Number(row.expected_inbound),
      available: Number(row.available),
      requests: Number(row.requests),
      manifests: Number(row.manifests),
      commitments: Number(row.commitments),
      waitingEntries: Number(row.waiting_entries),
      movements: Number(row.movements),
      outbox: Number(row.outbox),
    };
  });
}

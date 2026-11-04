-- Geo Relief Network: first application schema. Applied through scripts/migrate.mjs.
-- Keep this file immutable after it is recorded in grn_schema_migrations.

CREATE TABLE grn_collection_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  neighborhood text NOT NULL,
  city text NOT NULL DEFAULT 'Lima',
  country_code char(2) NOT NULL DEFAULT 'PE',
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  timezone text NOT NULL DEFAULT 'America/Lima',
  intake_capacity integer NOT NULL DEFAULT 0 CHECK (intake_capacity >= 0),
  pickup_capacity integer NOT NULL DEFAULT 0 CHECK (pickup_capacity >= 0),
  same_day_cutoff_minutes integer NOT NULL DEFAULT 60 CHECK (same_day_cutoff_minutes >= 0),
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE grn_collection_point_hours (
  collection_point_id uuid NOT NULL REFERENCES grn_collection_points(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_at time NOT NULL,
  closes_at time NOT NULL,
  PRIMARY KEY (collection_point_id, weekday),
  CHECK (opens_at < closes_at)
);

CREATE TABLE grn_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  unit text NOT NULL,
  suggested_units_per_person integer CHECK (suggested_units_per_person IS NULL OR suggested_units_per_person > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE grn_collection_point_products (
  collection_point_id uuid NOT NULL REFERENCES grn_collection_points(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES grn_products(id),
  max_per_request integer NOT NULL CHECK (max_per_request > 0),
  max_on_hand integer NOT NULL CHECK (max_on_hand > 0),
  PRIMARY KEY (collection_point_id, product_id)
);

-- Manager grants are provisioned only through an authorized administrative path.
CREATE TABLE grn_collection_point_managers (
  collection_point_id uuid NOT NULL REFERENCES grn_collection_points(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  granted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (collection_point_id, user_id)
);

-- Lock this row for every stock or FIFO mutation of a point/product pair.
CREATE TABLE grn_inventory_controls (
  collection_point_id uuid NOT NULL,
  product_id uuid NOT NULL,
  confirmed_on_hand integer NOT NULL DEFAULT 0 CHECK (confirmed_on_hand >= 0),
  next_fifo_sequence bigint NOT NULL DEFAULT 1 CHECK (next_fifo_sequence > 0),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (collection_point_id, product_id),
  FOREIGN KEY (collection_point_id, product_id)
    REFERENCES grn_collection_point_products(collection_point_id, product_id) ON DELETE CASCADE
);

CREATE TABLE grn_conversation_contexts (
  id uuid PRIMARY KEY,
  actor_id text,
  channel text NOT NULL CHECK (channel IN ('WEB', 'WHATSAPP')),
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE INDEX grn_conversation_context_expiry_idx ON grn_conversation_contexts (expires_at);

CREATE TABLE grn_aid_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id text NOT NULL,
  idempotency_key text NOT NULL,
  zone text NOT NULL,
  mobility text NOT NULL CHECK (mobility IN ('NEARBY_ONLY', 'CAN_TRAVEL')),
  availability_window jsonb NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (requester_id, idempotency_key)
);

CREATE TABLE grn_aid_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES grn_aid_requests(id) ON DELETE CASCADE,
  collection_point_id uuid NOT NULL,
  product_id uuid NOT NULL,
  requested_quantity integer NOT NULL CHECK (requested_quantity > 0),
  waiting_quantity integer NOT NULL CHECK (waiting_quantity >= 0),
  fifo_sequence bigint NOT NULL CHECK (fifo_sequence > 0),
  submitted_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (request_id, product_id),
  FOREIGN KEY (collection_point_id, product_id)
    REFERENCES grn_collection_point_products(collection_point_id, product_id)
);
CREATE INDEX grn_aid_request_items_fifo_idx
  ON grn_aid_request_items (collection_point_id, product_id, fifo_sequence)
  WHERE waiting_quantity > 0;

-- Queue segments are separate from request lines so an expired partial offer can
-- return to the tail without changing the priority of the remaining quantity.
CREATE TABLE grn_waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_item_id uuid NOT NULL REFERENCES grn_aid_request_items(id),
  collection_point_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  fifo_sequence bigint NOT NULL CHECK (fifo_sequence > 0),
  status text NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING', 'OFFERED', 'FULFILLED', 'CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  FOREIGN KEY (collection_point_id, product_id)
    REFERENCES grn_collection_point_products(collection_point_id, product_id)
);
CREATE INDEX grn_waitlist_fifo_idx
  ON grn_waitlist_entries (collection_point_id, product_id, fifo_sequence, id)
  WHERE status = 'WAITING';

CREATE TABLE grn_reservation_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_item_id uuid NOT NULL REFERENCES grn_aid_request_items(id),
  waitlist_entry_id uuid REFERENCES grn_waitlist_entries(id),
  collection_point_id uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL CHECK (status IN ('PENDING_CONFIRMATION', 'ACTIVE', 'PICKED_UP', 'CANCELLED', 'EXPIRED')),
  expires_at timestamptz NOT NULL,
  pickup_window_start timestamptz,
  pickup_window_end timestamptz,
  pickup_code text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  FOREIGN KEY (collection_point_id, product_id)
    REFERENCES grn_collection_point_products(collection_point_id, product_id),
  CHECK ((status = 'ACTIVE' AND pickup_code IS NOT NULL) OR status <> 'ACTIVE')
);
CREATE INDEX grn_commitments_live_idx
  ON grn_reservation_commitments (collection_point_id, product_id, expires_at)
  WHERE status IN ('PENDING_CONFIRMATION', 'ACTIVE');

CREATE TABLE grn_donation_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id text NOT NULL,
  collection_point_id uuid NOT NULL REFERENCES grn_collection_points(id),
  idempotency_key text NOT NULL,
  code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VALIDATED', 'REJECTED', 'CANCELLED')),
  estimated_delivery_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (donor_id, idempotency_key)
);

CREATE TABLE grn_private_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'ATTACHED', 'DELETED')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE grn_donation_manifest_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id uuid NOT NULL REFERENCES grn_donation_manifests(id) ON DELETE CASCADE,
  collection_point_id uuid NOT NULL,
  product_id uuid NOT NULL,
  declared_quantity integer NOT NULL CHECK (declared_quantity > 0),
  photo_media_ids uuid[] NOT NULL CHECK (cardinality(photo_media_ids) >= 1),
  validated_quantity integer CHECK (validated_quantity IS NULL OR validated_quantity >= 0),
  FOREIGN KEY (collection_point_id, product_id)
    REFERENCES grn_collection_point_products(collection_point_id, product_id)
);

CREATE TABLE grn_action_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  actor_id text NOT NULL,
  conversation_id uuid NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('AID_REQUEST', 'DONATION_MANIFEST', 'WAITLIST_CONFIRMATION')),
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  preview jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONSUMED', 'STALE', 'EXPIRED', 'CANCELLED')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  consumed_at timestamptz
);
CREATE INDEX grn_action_drafts_pending_idx ON grn_action_drafts (actor_id, expires_at) WHERE status = 'PENDING';

CREATE TABLE grn_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL CHECK (aggregate_type IN ('AID_REQUEST', 'REQUEST_ITEM', 'RESERVATION', 'MANIFEST', 'INVENTORY')),
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  actor_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE INDEX grn_lifecycle_events_aggregate_idx ON grn_lifecycle_events (aggregate_type, aggregate_id, occurred_at);

CREATE TABLE grn_inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_point_id uuid NOT NULL,
  product_id uuid NOT NULL,
  manifest_line_id uuid REFERENCES grn_donation_manifest_lines(id),
  reservation_id uuid REFERENCES grn_reservation_commitments(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  kind text NOT NULL CHECK (kind IN ('DONATION_IN', 'PICKUP_OUT', 'AUTHORIZED_ADJUSTMENT')),
  actor_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  FOREIGN KEY (collection_point_id, product_id)
    REFERENCES grn_collection_point_products(collection_point_id, product_id)
);

CREATE TABLE grn_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('WHATSAPP', 'WEB')),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE grn_notification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id uuid NOT NULL REFERENCES grn_notification_outbox(id),
  succeeded boolean NOT NULL,
  provider_message_id text,
  error_code text,
  attempted_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE grn_whatsapp_links (
  user_id text PRIMARY KEY,
  sender_lookup_hash text NOT NULL UNIQUE,
  destination_ciphertext bytea NOT NULL,
  destination_nonce bytea NOT NULL,
  destination_tag bytea NOT NULL,
  consented_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE grn_whatsapp_link_tokens (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE grn_channel_inbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel = 'WHATSAPP'),
  user_id text,
  provider_message_id text NOT NULL UNIQUE,
  received_at timestamptz NOT NULL,
  processed_at timestamptz,
  status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED')),
  lease_until timestamptz
);

CREATE TABLE grn_whatsapp_conversations (
  user_id text PRIMARY KEY,
  conversation_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

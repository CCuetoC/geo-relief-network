-- Enforce the product-line allocation rule from ADR-0010 at the database boundary.
-- Each reservation or FIFO entry represents the complete quantity a requester submitted.

CREATE FUNCTION grn_enforce_full_request_line_quantity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  requested integer;
BEGIN
  SELECT requested_quantity
    INTO requested
    FROM grn_aid_request_items
   WHERE id = NEW.request_item_id;

  IF requested IS NULL THEN
    RAISE EXCEPTION 'Request item % does not exist', NEW.request_item_id;
  END IF;

  IF NEW.quantity <> requested THEN
    RAISE EXCEPTION 'Reservation and waitlist entries must match the full requested quantity (%)', requested;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER grn_waitlist_full_quantity_guard
BEFORE INSERT OR UPDATE OF request_item_id, quantity ON grn_waitlist_entries
FOR EACH ROW EXECUTE FUNCTION grn_enforce_full_request_line_quantity();

CREATE TRIGGER grn_commitment_full_quantity_guard
BEFORE INSERT OR UPDATE OF request_item_id, quantity ON grn_reservation_commitments
FOR EACH ROW EXECUTE FUNCTION grn_enforce_full_request_line_quantity();

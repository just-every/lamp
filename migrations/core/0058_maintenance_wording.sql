-- Existing native and imported windows retain title-only notices. New native
-- scheduling validates the required pair; no historical wording is invented.
ALTER TABLE maintenance ADD COLUMN affected_audience TEXT
  CHECK(affected_audience IS NULL OR length(trim(affected_audience)) BETWEEN 1 AND 250);
ALTER TABLE maintenance ADD COLUMN customer_impact TEXT
  CHECK(customer_impact IS NULL OR length(trim(customer_impact)) BETWEEN 1 AND 250)
  CHECK((affected_audience IS NULL) = (customer_impact IS NULL));

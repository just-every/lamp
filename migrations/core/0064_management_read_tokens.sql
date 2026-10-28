-- Existing tokens retain their exact scopes; read access is explicit and opt-in.
ALTER TABLE management_tokens ADD COLUMN read_scope INTEGER NOT NULL DEFAULT 0 CHECK(read_scope IN (0,1));

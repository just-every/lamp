-- L14: the owner sets up Google and Okta sign-in in Settings. Lamp keeps each
-- registration here; the client secret is sealed (AES-GCM, bound to
-- sign-in:<provider>) and never leaves in an archive, so a restore asks for it
-- again. Okta signs in only the people paired here, by their Okta user ID.
CREATE TABLE sign_in_providers (
  provider_id TEXT PRIMARY KEY CHECK (provider_id IN ('google','okta')),
  client_id TEXT NOT NULL,
  issuer TEXT,
  sealed_secret TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE sign_in_people (
  provider_id TEXT NOT NULL REFERENCES sign_in_providers(provider_id),
  subject TEXT NOT NULL,
  operator_id TEXT NOT NULL REFERENCES oa_operators(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider_id, subject),
  UNIQUE (provider_id, operator_id)
);

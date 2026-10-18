-- Base importDoorScopesMigration (rer 0.2.61, modules/import-kit/src/door/schema.ts): binds each door
-- namespace to its product destination for erasure scoping. Additive.
CREATE TABLE IF NOT EXISTS ik_door_scopes (
    installation_id TEXT NOT NULL, namespace TEXT NOT NULL, destination TEXT NOT NULL,
    PRIMARY KEY(installation_id,namespace));

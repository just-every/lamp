-- A provider consumer can audit both approval creation and replacement.
CREATE TABLE test_dependency_writes (table_name TEXT NOT NULL, row_key TEXT NOT NULL);
CREATE TRIGGER test_pending_insert AFTER INSERT ON rer_dependency_pending BEGIN
 INSERT INTO test_dependency_writes VALUES('rer_dependency_pending',NEW.attempt_id);
END;
CREATE TRIGGER test_pending_update AFTER UPDATE ON rer_dependency_pending BEGIN
 INSERT INTO test_dependency_writes VALUES('rer_dependency_pending',NEW.attempt_id);
END;
CREATE TRIGGER test_code_insert AFTER INSERT ON rer_dependency_codes BEGIN
 INSERT INTO test_dependency_writes VALUES('rer_dependency_codes',NEW.digest);
END;

-- Extra product audit writes must not change auth's own write receipts.
CREATE TABLE test_auth_writes (table_name TEXT NOT NULL, row_key TEXT NOT NULL, event TEXT NOT NULL);
CREATE TRIGGER test_operator_insert AFTER INSERT ON oa_operators BEGIN
 INSERT INTO test_auth_writes VALUES('oa_operators',NEW.id,'insert');
END;
CREATE TRIGGER test_operator_email AFTER UPDATE OF email ON oa_operators BEGIN
 INSERT INTO test_auth_writes VALUES('oa_operators',NEW.id,'email');
END;
CREATE TRIGGER test_token_insert AFTER INSERT ON oa_tokens BEGIN
 INSERT INTO test_auth_writes VALUES('oa_tokens',NEW.id,'insert');
END;
CREATE TRIGGER test_step_up_insert AFTER INSERT ON oa_step_up_challenges BEGIN
 INSERT INTO test_auth_writes VALUES('oa_step_up_challenges',NEW.id,'insert');
END;
CREATE TRIGGER test_credential_insert AFTER INSERT ON oa_credentials BEGIN
 INSERT INTO test_auth_writes VALUES('oa_credentials',NEW.id,'insert');
END;
CREATE TRIGGER test_settings_insert AFTER INSERT ON oa_auth_settings BEGIN
 INSERT INTO test_auth_writes VALUES('oa_auth_settings',NEW.singleton,'insert');
END;
CREATE TRIGGER test_settings_update AFTER UPDATE ON oa_auth_settings BEGIN
 INSERT INTO test_auth_writes VALUES('oa_auth_settings',NEW.singleton,'update');
END;

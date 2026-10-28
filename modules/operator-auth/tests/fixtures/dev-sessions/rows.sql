-- Static prior-data rows for a store migrated through default-seed 0001-0006
-- (current main before 0007). Credentials are public test-only values; see README.md.
INSERT INTO oa_bootstrap(singleton,claim_id,claimed_at) VALUES(1,'owner',1700000000000);
INSERT INTO oa_operators(id,email,display_name,role,status,version,created_at) VALUES
 ('owner','owner@example.com','Owner','owner','active',1,1700000000000),
 ('admin','admin@example.com','Admin','admin','active',1,1700000000001),
 ('member','member@example.com','Member','member','active',2,1700000000002),
 ('gone','gone@example.com','Gone','member','inactive',2,1700000000003);
INSERT INTO oa_tokens(id,token_hash,kind,operator_id,operator_version,issuer_id,issuer_version,return_to,created_at,expires_at,consumed_at,revoked_at) VALUES
 ('t-magic','11b75c8d396489f6442d0ea92aeac059405c84fd85cb00bfbaba718b8b142a51','magic','owner',1,NULL,NULL,'/app',1700000001000,1700000901000,1700000002000,NULL),
 ('t-invite','a64fdb4153dfc36c3e40625e9667805db337308b85f290d351766772d92fbdd7','invite','member',1,'owner',1,'/app',1700000003000,1700000903000,1700000004000,NULL);
INSERT INTO oa_sessions(id,token_hash,operator_id,operator_version,kind,source_token_id,created_at,expires_at,revoked_at) VALUES
 ('s-native','787f311127e1912e03a02b962386eeffae503795728e951f554d6f5dc3fbff50','owner',1,'native','t-magic',1700000010000,4102444800000,NULL),
 ('s-review','196eecdda3a746c764004f1233b6bd882f7ad5179a948471a9656ed82d651715','owner',1,'review',NULL,1700000010001,4102444800000,NULL),
 ('s-oidc','bc460506a80b46740910eed642d5a4c76b47862d7df377b8bb65f9885719193a','admin',1,'oidc',NULL,1700000010002,4102444800000,NULL),
 ('s-verifier','d1626f3b5a9f56a57795da38ec497fb9f899281afabe0b1e54017f18516aa65f','member',2,'password','t-invite',1700000010003,4102444800000,NULL),
 ('s-revoked','fb97ddd4a088bf44a75f74cb7f15f9e3df63c412ff57a853bbdbe98d87d04168','owner',1,'native',NULL,1700000010004,4102444800000,1800000000000),
 ('s-expired','e090e293cb32060b3032ca887e09c14dba17dd0a620bca2c778e392a521e7049','admin',1,'native',NULL,1700000010005,1000,NULL),
 ('s-fenced','f8312806e286bf71e164922614aee89ad25b8a42991bd99a6c38b811b1bb504f','gone',1,'native',NULL,1700000010006,4102444800000,NULL);
INSERT INTO oa_external_identities(issuer,subject,operator_id) VALUES('https://idp.example.com','admin-subject','admin');
INSERT INTO oa_limits(key,window,count) VALUES('fixture-limit',1,1);
INSERT INTO oa_first_run(singleton,completed_by,completed_at) VALUES(1,'owner',1700000020000);

-- Static synthetic old-store rows; see README.md for provenance and chronology.
INSERT INTO oa_operators (id,email,display_name,role,status,version,created_at) VALUES
('owner','owner@example.com','Owner','owner','active',1,1899996400000),
('active','active@example.com','Active','member','active',2,1899996400000),
('inactive','inactive@example.com','Inactive','member','inactive',3,1899996400000),
('pending','pending@example.com','Pending','member','invited',1,1899996400000),
('expired','expired@example.com','Expired','member','invited',1,1899996400000),
('cancelled','cancelled@example.com','Cancelled','member','inactive',2,1899996400000),
('guarded','guarded@example.com','Guarded','member','invited',1,1899996400000);
INSERT INTO oa_bootstrap (singleton,claim_id,claimed_at) VALUES
(1,'owner',1899996400000);
INSERT INTO oa_tokens (id,token_hash,kind,operator_id,operator_version,issuer_id,issuer_version,return_to,created_at,expires_at,consumed_at,revoked_at) VALUES
('active-invitation','3d19adf3f9cb331fe845c41ad904c9402c3367e90fb93cd6bc10c75c553c402b','invite','active',1,'owner',1,'/original/active?view=invitation',1899998200000,1900000600000,1899999100000,NULL),
('inactive-invitation','5e91f0c77025111bbfa48b642a7d14238769bd33f5dc7bdcf17b8c26909d2d75','invite','inactive',1,'owner',1,'/original/inactive?view=invitation',1899998200000,1900000600000,1899999100000,NULL),
('pending-invitation','c19b5498876554bfd781568dc6318e7a2e967a1dd1e2740efef1385821978ffc','invite','pending',1,'owner',1,'/original/pending?view=invitation',1899998200000,1900000600000,NULL,NULL),
('expired-invitation','cd39aea2d064bc9a4f3c295715df5f6b17085a65a20847348ce024e042da897d','invite','expired',1,'owner',1,'/original/expired?view=invitation',1899998200000,1899999999999,NULL,NULL),
('cancelled-invitation','8c0f3eefe7b74ebbf9ce44d85039fca8bf6cffb92be34a401ccc135e180c3cc9','invite','cancelled',1,'owner',1,'/original/cancelled?view=invitation',1899998200000,1900000600000,NULL,NULL),
('guarded-invitation','da1435801cdb4125ee28832423a1c01df79d0a9c4dc916e34ce7effe5eb2b51f','invite','guarded',1,'owner',1,'/original/guarded?view=invitation',1899998200000,1900000600000,NULL,NULL);
INSERT INTO oa_sessions (id,token_hash,operator_id,operator_version,kind,source_token_id,created_at,expires_at,revoked_at) VALUES
('owner-session','b98a016926dc6d053532ef24b629972f53b8566c4f7f7c01eec48287b354175e','owner',1,'native',NULL,1899996400000,1900086400000,NULL),
('active-session','1e072f2f776f4b05f5f2ef40657ef4a368910aa6f14f5f7a12d511612b0372f2','active',2,'native','active-invitation',1899999100000,1900086400000,NULL),
('inactive-session','d6bbb29386dbbde3da2647fa1709918ff89dbb8e37321fad6fcb171a0e51c7cb','inactive',2,'native','inactive-invitation',1899999100000,1900086400000,NULL);
INSERT INTO oa_external_identities (issuer,subject,operator_id) VALUES
('https://old-idp.example.com','old-owner-subject','owner'),
('https://old-idp.example.com','old-active-subject','active');
INSERT INTO oa_limits (key,window,count) VALUES
('old-ip-bucket',2111111,4),
('old-email-bucket',2111110,2);
INSERT INTO oa_oidc_transactions (state_hash,binding_hash,config_hash,payload,expires_at) VALUES
('old-state-hash','old-binding-hash','old-config-hash','opaque-old-encrypted-transaction',1900000300000);
INSERT INTO oa_oidc_limits (bucket,count,expires_at) VALUES
('old-oidc-bucket',3,1900000300000);

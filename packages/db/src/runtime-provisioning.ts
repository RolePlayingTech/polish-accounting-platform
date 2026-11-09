import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import type { connectDatabase } from './client.js';

type Database = ReturnType<typeof connectDatabase>['db'];

const WAVE2_BFF_SESSION_PROVISIONING_SQL = `
CREATE TABLE IF NOT EXISTS pap_oidc_auth_state (
  state_hash text PRIMARY KEY,
  encrypted_payload text NOT NULL,
  expires_at timestamptz(3) NOT NULL,
  consumed_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
  CONSTRAINT pap_oidc_auth_state_hash_check CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT pap_oidc_auth_state_payload_check CHECK (
    btrim(encrypted_payload) <> '' AND char_length(encrypted_payload) <= 16384
  ),
  CONSTRAINT pap_oidc_auth_state_time_check CHECK (
    isfinite(expires_at) AND isfinite(created_at) AND (consumed_at IS NULL OR isfinite(consumed_at))
  )
);

CREATE INDEX IF NOT EXISTS pap_oidc_auth_state_expires_idx ON pap_oidc_auth_state (expires_at);

CREATE TABLE IF NOT EXISTS pap_bff_session (
  session_id_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user(id),
  issuer text NOT NULL,
  subject text NOT NULL,
  display_name text NOT NULL,
  email text NOT NULL,
  tenant_id uuid,
  legal_entity_id uuid,
  period text NOT NULL,
  encrypted_tokens text NOT NULL,
  access_token_expires_at timestamptz(3) NOT NULL,
  refresh_generation integer NOT NULL DEFAULT 0,
  previous_encrypted_tokens text,
  previous_access_token_expires_at timestamptz(3),
  previous_grace_until timestamptz(3),
  expires_at timestamptz(3) NOT NULL,
  revoked_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
  updated_at timestamptz(3) NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
  CONSTRAINT pap_bff_session_hash_check CHECK (session_id_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT pap_bff_session_issuer_check CHECK (
    btrim(issuer) <> '' AND issuer = btrim(issuer) AND char_length(issuer) <= 512
  ),
  CONSTRAINT pap_bff_session_subject_check CHECK (
    btrim(subject) <> '' AND subject = btrim(subject) AND char_length(subject) <= 256
  ),
  CONSTRAINT pap_bff_session_display_name_check CHECK (
    btrim(display_name) <> '' AND char_length(display_name) <= 160
  ),
  CONSTRAINT pap_bff_session_email_check CHECK (
    btrim(email) <> '' AND char_length(email) <= 254
  ),
  CONSTRAINT pap_bff_session_context_pair_check CHECK (
    tenant_id IS NOT NULL OR legal_entity_id IS NULL
  ),
  CONSTRAINT pap_bff_session_period_check CHECK (
    period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  ),
  CONSTRAINT pap_bff_session_tokens_check CHECK (
    btrim(encrypted_tokens) <> '' AND char_length(encrypted_tokens) <= 32768
  ),
  CONSTRAINT pap_bff_session_gen_check CHECK (refresh_generation >= 0),
  CONSTRAINT pap_bff_session_time_check CHECK (
    isfinite(access_token_expires_at)
    AND isfinite(expires_at)
    AND isfinite(created_at)
    AND isfinite(updated_at)
    AND (revoked_at IS NULL OR isfinite(revoked_at))
    AND (previous_access_token_expires_at IS NULL OR isfinite(previous_access_token_expires_at))
    AND (previous_grace_until IS NULL OR isfinite(previous_grace_until))
  )
);

CREATE INDEX IF NOT EXISTS pap_bff_session_user_idx ON pap_bff_session (user_id);
CREATE INDEX IF NOT EXISTS pap_bff_session_expires_idx ON pap_bff_session (expires_at);

CREATE TABLE IF NOT EXISTS pap_user_profile (
  user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  display_name text NOT NULL,
  email text NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
  updated_at timestamptz(3) NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
  CONSTRAINT pap_user_profile_display_name_check CHECK (
    btrim(display_name) <> '' AND char_length(display_name) <= 160
  ),
  CONSTRAINT pap_user_profile_email_check CHECK (
    btrim(email) <> '' AND char_length(email) <= 254
  ),
  CONSTRAINT pap_user_profile_time_check CHECK (
    isfinite(created_at) AND isfinite(updated_at) AND updated_at >= created_at
  )
);

CREATE TABLE IF NOT EXISTS pap_identity_lifecycle_event (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE,
  kind text NOT NULL,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  target_user_id uuid REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  tenant_id uuid REFERENCES tenant(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  invitation_id uuid,
  issuer text,
  subject text,
  reason text NOT NULL,
  request_key text NOT NULL,
  receipt jsonb NOT NULL,
  occurred_at timestamptz(3) NOT NULL,
  transaction_id text NOT NULL DEFAULT pg_current_xact_id()::text,
  CONSTRAINT pap_identity_lifecycle_event_kind_check CHECK (
    kind IN (
      'bootstrap_owner',
      'provision_unassigned_user',
      'create_invitation',
      'accept_invitation',
      'reject_invitation',
      'revoke_invitation'
    )
  ),
  CONSTRAINT pap_identity_lifecycle_event_reason_check CHECK (
    btrim(reason) <> '' AND char_length(reason) <= 400
  ),
  CONSTRAINT pap_identity_lifecycle_event_request_key_check CHECK (
    btrim(request_key) <> ''
  ),
  CONSTRAINT pap_identity_lifecycle_event_receipt_check CHECK (
    jsonb_typeof(receipt) = 'object'
  ),
  CONSTRAINT pap_identity_lifecycle_event_time_check CHECK (
    isfinite(occurred_at)
  )
);

CREATE INDEX IF NOT EXISTS pap_identity_lifecycle_tenant_idx
  ON pap_identity_lifecycle_event (tenant_id, occurred_at);

DROP TRIGGER IF EXISTS pap_identity_lifecycle_append_only ON pap_identity_lifecycle_event;
CREATE TRIGGER pap_identity_lifecycle_append_only
  BEFORE UPDATE OR DELETE ON pap_identity_lifecycle_event
  FOR EACH ROW EXECUTE FUNCTION protect_access_management_event();

CREATE TABLE IF NOT EXISTS pap_tenant_invitation (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE,
  tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  token_sha256 text NOT NULL UNIQUE,
  invitee_email text NOT NULL,
  invitee_display_name text,
  intended_role text NOT NULL,
  initial_company_grants jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  invited_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reason text NOT NULL,
  created_at timestamptz(3) NOT NULL,
  expires_at timestamptz(3) NOT NULL,
  accepted_at timestamptz(3),
  accepted_by_user_id uuid REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  revoked_at timestamptz(3),
  revoked_by_user_id uuid REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  rejected_at timestamptz(3),
  rejected_by_user_id uuid REFERENCES app_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT pap_tenant_invitation_token_hash_check CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT pap_tenant_invitation_email_check CHECK (
    btrim(invitee_email) <> ''
    AND invitee_email = lower(btrim(invitee_email))
    AND position('@' IN invitee_email) >= 2
    AND char_length(invitee_email) <= 254
  ),
  CONSTRAINT pap_tenant_invitation_display_name_check CHECK (
    invitee_display_name IS NULL
    OR (btrim(invitee_display_name) <> '' AND char_length(invitee_display_name) <= 160)
  ),
  CONSTRAINT pap_tenant_invitation_role_check CHECK (
    intended_role IN ('tenant_admin', 'tenant_member')
  ),
  CONSTRAINT pap_tenant_invitation_grants_check CHECK (
    jsonb_typeof(initial_company_grants) = 'array'
  ),
  CONSTRAINT pap_tenant_invitation_status_check CHECK (
    status IN ('pending', 'accepted', 'revoked', 'rejected')
  ),
  CONSTRAINT pap_tenant_invitation_reason_check CHECK (
    btrim(reason) <> '' AND char_length(reason) <= 400
  ),
  CONSTRAINT pap_tenant_invitation_time_check CHECK (
    isfinite(created_at)
    AND isfinite(expires_at)
    AND expires_at > created_at
    AND (accepted_at IS NULL OR isfinite(accepted_at))
    AND (revoked_at IS NULL OR isfinite(revoked_at))
    AND (rejected_at IS NULL OR isfinite(rejected_at))
  ),
  CONSTRAINT pap_tenant_invitation_terminal_state_check CHECK (
    (status = 'pending' AND accepted_at IS NULL AND accepted_by_user_id IS NULL AND revoked_at IS NULL AND rejected_at IS NULL)
    OR (status = 'accepted' AND accepted_at IS NOT NULL AND accepted_by_user_id IS NOT NULL AND revoked_at IS NULL AND rejected_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL AND accepted_at IS NULL AND rejected_at IS NULL)
    OR (status = 'rejected' AND rejected_at IS NOT NULL AND accepted_at IS NULL AND revoked_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS pap_tenant_invitation_tenant_created_idx
  ON pap_tenant_invitation (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION pap_bff_session_op(cmd jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET timezone = 'UTC'
SET datestyle = 'ISO, YMD'
AS $fn$
DECLARE
  c jsonb := pap_context();
  signed_cmd jsonb;
  op_kind text;
  now_ts timestamptz(3);
  state_row pap_oidc_auth_state%ROWTYPE;
  sess_row pap_bff_session%ROWTYPE;
  expected_gen integer;
  grace_ms integer;
  next_expires_at timestamptz(3);
  affected_rows integer := 0;
BEGIN
  IF c IS NULL
    OR c->>'purpose' IS DISTINCT FROM 'bff_session'
    OR jsonb_typeof(c->'command') IS DISTINCT FROM 'object'
    OR cmd IS NULL
    OR jsonb_typeof(cmd) IS DISTINCT FROM 'object'
  THEN
    RAISE EXCEPTION 'Brak autoryzowanego kontekstu magazynu sesji BFF' USING ERRCODE = '42501';
  END IF;

  signed_cmd := c->'command';
  op_kind := cmd->>'kind';

  IF op_kind IS NULL OR signed_cmd IS DISTINCT FROM cmd THEN
    RAISE EXCEPTION 'Niezgodność podpisanej komendy magazynu sesji BFF' USING ERRCODE = '42501';
  END IF;

  now_ts := COALESCE(
    (cmd->>'nowIso')::timestamptz(3),
    date_trunc('milliseconds', clock_timestamp())::timestamptz(3)
  );
  IF NOT isfinite(now_ts) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_session_input');
  END IF;

  IF op_kind = 'create_auth_state' THEN
    IF (cmd->>'stateHash') IS NULL
      OR (cmd->>'stateHash') !~ '^[0-9a-f]{64}$'
      OR btrim(COALESCE(cmd->>'encryptedPayload', '')) = ''
      OR (cmd->>'expiresAtIso') IS NULL
      OR (cmd->>'expiresAtIso')::timestamptz(3) <= now_ts
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_auth_state_input');
    END IF;

    DELETE FROM pap_oidc_auth_state
    WHERE state_hash IN (
      SELECT state_hash
      FROM pap_oidc_auth_state
      WHERE expires_at <= now_ts - interval '1 hour'
      LIMIT 64
    );

    IF EXISTS (
      SELECT 1 FROM pap_oidc_auth_state WHERE state_hash = (cmd->>'stateHash')
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'state_already_exists');
    END IF;

    INSERT INTO pap_oidc_auth_state (state_hash, encrypted_payload, expires_at, created_at)
    VALUES (
      cmd->>'stateHash',
      cmd->>'encryptedPayload',
      (cmd->>'expiresAtIso')::timestamptz(3),
      now_ts
    );

    RETURN jsonb_build_object('ok', true);

  ELSIF op_kind = 'consume_auth_state' THEN
    IF (cmd->>'stateHash') IS NULL OR (cmd->>'stateHash') !~ '^[0-9a-f]{64}$' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_state_hash');
    END IF;

    SELECT * INTO state_row
    FROM pap_oidc_auth_state
    WHERE state_hash = (cmd->>'stateHash')
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'state_not_found');
    END IF;

    IF state_row.consumed_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'state_already_consumed');
    END IF;

    IF state_row.expires_at <= now_ts THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'state_expired');
    END IF;

    UPDATE pap_oidc_auth_state
    SET consumed_at = now_ts
    WHERE state_hash = state_row.state_hash
    RETURNING * INTO state_row;

    RETURN jsonb_build_object(
      'ok', true,
      'state', jsonb_build_object(
        'stateHash', state_row.state_hash,
        'encryptedPayload', state_row.encrypted_payload,
        'expiresAt', to_char(state_row.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'consumedAt', to_char(state_row.consumed_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'createdAt', to_char(state_row.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    );

  ELSIF op_kind = 'create_session' THEN
    IF (cmd->>'sessionIdHash') IS NULL
      OR (cmd->>'sessionIdHash') !~ '^[0-9a-f]{64}$'
      OR (cmd->>'userId') IS NULL
      OR btrim(COALESCE(cmd->>'issuer', '')) = ''
      OR btrim(COALESCE(cmd->>'subject', '')) = ''
      OR btrim(COALESCE(cmd->>'displayName', '')) = ''
      OR btrim(COALESCE(cmd->>'email', '')) = ''
      OR btrim(COALESCE(cmd->>'encryptedTokens', '')) = ''
      OR (cmd->>'period') IS NULL
      OR (cmd->>'period') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      OR (cmd->>'accessTokenExpiresAtIso') IS NULL
      OR (cmd->>'expiresAtIso') IS NULL
      OR (cmd->>'expiresAtIso')::timestamptz(3) <= now_ts
      OR ((cmd->>'tenantId') IS NULL AND (cmd->>'legalEntityId') IS NOT NULL)
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_session_input');
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM app_user u
      JOIN user_oidc_identity i ON i.user_id = u.id
      WHERE u.id = (cmd->>'userId')::uuid
        AND u.status = 'active'
        AND u.disabled_at IS NULL
        AND i.issuer = (cmd->>'issuer')
        AND i.subject = (cmd->>'subject')
        AND i.status = 'active'
        AND i.revoked_at IS NULL
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'user_disabled_or_identity_revoked');
    END IF;

    DELETE FROM pap_bff_session
    WHERE session_id_hash IN (
      SELECT session_id_hash
      FROM pap_bff_session
      WHERE expires_at <= now_ts - interval '24 hours'
      LIMIT 64
    );

    IF EXISTS (
      SELECT 1 FROM pap_bff_session WHERE session_id_hash = (cmd->>'sessionIdHash')
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'session_already_exists');
    END IF;

    INSERT INTO pap_bff_session (
      session_id_hash,
      user_id,
      issuer,
      subject,
      display_name,
      email,
      tenant_id,
      legal_entity_id,
      period,
      encrypted_tokens,
      access_token_expires_at,
      refresh_generation,
      expires_at,
      created_at,
      updated_at
    ) VALUES (
      cmd->>'sessionIdHash',
      (cmd->>'userId')::uuid,
      cmd->>'issuer',
      cmd->>'subject',
      cmd->>'displayName',
      cmd->>'email',
      (cmd->>'tenantId')::uuid,
      (cmd->>'legalEntityId')::uuid,
      cmd->>'period',
      cmd->>'encryptedTokens',
      (cmd->>'accessTokenExpiresAtIso')::timestamptz(3),
      0,
      (cmd->>'expiresAtIso')::timestamptz(3),
      now_ts,
      now_ts
    )
    RETURNING * INTO sess_row;

    RETURN jsonb_build_object(
      'ok', true,
      'session', jsonb_build_object(
        'sessionIdHash', sess_row.session_id_hash,
        'userId', sess_row.user_id,
        'issuer', sess_row.issuer,
        'subject', sess_row.subject,
        'displayName', sess_row.display_name,
        'email', sess_row.email,
        'tenantId', sess_row.tenant_id,
        'legalEntityId', sess_row.legal_entity_id,
        'period', sess_row.period,
        'encryptedTokens', sess_row.encrypted_tokens,
        'accessTokenExpiresAt', to_char(sess_row.access_token_expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'refreshGeneration', sess_row.refresh_generation,
        'previousEncryptedTokens', sess_row.previous_encrypted_tokens,
        'previousAccessTokenExpiresAt', CASE WHEN sess_row.previous_access_token_expires_at IS NULL THEN NULL ELSE to_char(sess_row.previous_access_token_expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
        'previousGraceUntil', CASE WHEN sess_row.previous_grace_until IS NULL THEN NULL ELSE to_char(sess_row.previous_grace_until, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
        'expiresAt', to_char(sess_row.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'revokedAt', CASE WHEN sess_row.revoked_at IS NULL THEN NULL ELSE to_char(sess_row.revoked_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
        'createdAt', to_char(sess_row.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt', to_char(sess_row.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    );

  ELSIF op_kind = 'get_session' THEN
    IF (cmd->>'sessionIdHash') IS NULL OR (cmd->>'sessionIdHash') !~ '^[0-9a-f]{64}$' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_session_input');
    END IF;

    SELECT * INTO sess_row
    FROM pap_bff_session
    WHERE session_id_hash = (cmd->>'sessionIdHash');

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'session_not_found');
    END IF;

    IF sess_row.revoked_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'session_revoked');
    END IF;

    IF sess_row.expires_at <= now_ts THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'session_expired');
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM app_user u
      JOIN user_oidc_identity i ON i.user_id = u.id
      WHERE u.id = sess_row.user_id
        AND u.status = 'active'
        AND u.disabled_at IS NULL
        AND i.issuer = sess_row.issuer
        AND i.subject = sess_row.subject
        AND i.status = 'active'
        AND i.revoked_at IS NULL
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'user_disabled_or_identity_revoked');
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'session', jsonb_build_object(
        'sessionIdHash', sess_row.session_id_hash,
        'userId', sess_row.user_id,
        'issuer', sess_row.issuer,
        'subject', sess_row.subject,
        'displayName', sess_row.display_name,
        'email', sess_row.email,
        'tenantId', sess_row.tenant_id,
        'legalEntityId', sess_row.legal_entity_id,
        'period', sess_row.period,
        'encryptedTokens', sess_row.encrypted_tokens,
        'accessTokenExpiresAt', to_char(sess_row.access_token_expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'refreshGeneration', sess_row.refresh_generation,
        'previousEncryptedTokens', sess_row.previous_encrypted_tokens,
        'previousAccessTokenExpiresAt', CASE WHEN sess_row.previous_access_token_expires_at IS NULL THEN NULL ELSE to_char(sess_row.previous_access_token_expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
        'previousGraceUntil', CASE WHEN sess_row.previous_grace_until IS NULL THEN NULL ELSE to_char(sess_row.previous_grace_until, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
        'expiresAt', to_char(sess_row.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'revokedAt', NULL,
        'createdAt', to_char(sess_row.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt', to_char(sess_row.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    );

  ELSIF op_kind = 'update_session_context' THEN
    IF (cmd->>'sessionIdHash') IS NULL
      OR (cmd->>'sessionIdHash') !~ '^[0-9a-f]{64}$'
      OR (cmd->>'period') IS NULL
      OR (cmd->>'period') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      OR ((cmd->>'tenantId') IS NULL AND (cmd->>'legalEntityId') IS NOT NULL)
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_session_input');
    END IF;

    SELECT * INTO sess_row
    FROM pap_bff_session
    WHERE session_id_hash = (cmd->>'sessionIdHash')
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'session_not_found');
    END IF;
    IF sess_row.revoked_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'session_revoked');
    END IF;
    IF sess_row.expires_at <= now_ts THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'session_expired');
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM app_user u
      JOIN user_oidc_identity i ON i.user_id = u.id
      WHERE u.id = sess_row.user_id
        AND u.status = 'active'
        AND u.disabled_at IS NULL
        AND i.issuer = sess_row.issuer
        AND i.subject = sess_row.subject
        AND i.status = 'active'
        AND i.revoked_at IS NULL
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'user_disabled_or_identity_revoked');
    END IF;

    UPDATE pap_bff_session
    SET tenant_id = (cmd->>'tenantId')::uuid,
        legal_entity_id = (cmd->>'legalEntityId')::uuid,
        period = cmd->>'period',
        updated_at = now_ts
    WHERE session_id_hash = sess_row.session_id_hash
    RETURNING * INTO sess_row;

    RETURN jsonb_build_object(
      'ok', true,
      'session', jsonb_build_object(
        'sessionIdHash', sess_row.session_id_hash,
        'userId', sess_row.user_id,
        'issuer', sess_row.issuer,
        'subject', sess_row.subject,
        'displayName', sess_row.display_name,
        'email', sess_row.email,
        'tenantId', sess_row.tenant_id,
        'legalEntityId', sess_row.legal_entity_id,
        'period', sess_row.period,
        'encryptedTokens', sess_row.encrypted_tokens,
        'accessTokenExpiresAt', to_char(sess_row.access_token_expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'refreshGeneration', sess_row.refresh_generation,
        'previousEncryptedTokens', sess_row.previous_encrypted_tokens,
        'previousAccessTokenExpiresAt', CASE WHEN sess_row.previous_access_token_expires_at IS NULL THEN NULL ELSE to_char(sess_row.previous_access_token_expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
        'previousGraceUntil', CASE WHEN sess_row.previous_grace_until IS NULL THEN NULL ELSE to_char(sess_row.previous_grace_until, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
        'expiresAt', to_char(sess_row.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'revokedAt', NULL,
        'createdAt', to_char(sess_row.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt', to_char(sess_row.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    );

  ELSIF op_kind = 'rotate_session_tokens' THEN
    IF (cmd->>'sessionIdHash') IS NULL
      OR (cmd->>'sessionIdHash') !~ '^[0-9a-f]{64}$'
      OR (cmd->>'expectedGeneration') IS NULL
      OR btrim(COALESCE(cmd->>'encryptedTokens', '')) = ''
      OR (cmd->>'accessTokenExpiresAtIso') IS NULL
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_session_input');
    END IF;

    expected_gen := (cmd->>'expectedGeneration')::integer;
    IF expected_gen < 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_session_input');
    END IF;

    SELECT * INTO sess_row
    FROM pap_bff_session
    WHERE session_id_hash = (cmd->>'sessionIdHash')
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'session_not_found');
    END IF;
    IF sess_row.revoked_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'session_revoked');
    END IF;
    IF sess_row.expires_at <= now_ts THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'session_expired');
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM app_user u
      JOIN user_oidc_identity i ON i.user_id = u.id
      WHERE u.id = sess_row.user_id
        AND u.status = 'active'
        AND u.disabled_at IS NULL
        AND i.issuer = sess_row.issuer
        AND i.subject = sess_row.subject
        AND i.status = 'active'
        AND i.revoked_at IS NULL
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'user_disabled_or_identity_revoked');
    END IF;

    IF sess_row.refresh_generation <> expected_gen THEN
      IF expected_gen = sess_row.refresh_generation - 1
        AND sess_row.previous_grace_until IS NOT NULL
        AND now_ts <= sess_row.previous_grace_until
      THEN
        RETURN jsonb_build_object(
          'ok', true,
          'rotated', false,
          'alreadyAdvanced', true,
          'session', jsonb_build_object(
            'sessionIdHash', sess_row.session_id_hash,
            'userId', sess_row.user_id,
            'issuer', sess_row.issuer,
            'subject', sess_row.subject,
            'displayName', sess_row.display_name,
            'email', sess_row.email,
            'tenantId', sess_row.tenant_id,
            'legalEntityId', sess_row.legal_entity_id,
            'period', sess_row.period,
            'encryptedTokens', sess_row.encrypted_tokens,
            'accessTokenExpiresAt', to_char(sess_row.access_token_expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'refreshGeneration', sess_row.refresh_generation,
            'previousEncryptedTokens', sess_row.previous_encrypted_tokens,
            'previousAccessTokenExpiresAt', CASE WHEN sess_row.previous_access_token_expires_at IS NULL THEN NULL ELSE to_char(sess_row.previous_access_token_expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
            'previousGraceUntil', CASE WHEN sess_row.previous_grace_until IS NULL THEN NULL ELSE to_char(sess_row.previous_grace_until, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
            'expiresAt', to_char(sess_row.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'revokedAt', NULL,
            'createdAt', to_char(sess_row.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'updatedAt', to_char(sess_row.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          )
        );
      END IF;
      RETURN jsonb_build_object('ok', false, 'reason', 'generation_conflict');
    END IF;

    next_expires_at := COALESCE(
      (cmd->>'sessionExpiresAtIso')::timestamptz(3),
      sess_row.expires_at
    );
    IF next_expires_at <= now_ts THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'session_expired');
    END IF;

    grace_ms := LEAST(GREATEST(COALESCE((cmd->>'gracePeriodMs')::integer, 30000), 0), 120000);

    UPDATE pap_bff_session
    SET previous_encrypted_tokens = sess_row.encrypted_tokens,
        previous_access_token_expires_at = sess_row.access_token_expires_at,
        previous_grace_until = now_ts + (grace_ms || ' milliseconds')::interval,
        encrypted_tokens = cmd->>'encryptedTokens',
        access_token_expires_at = (cmd->>'accessTokenExpiresAtIso')::timestamptz(3),
        expires_at = next_expires_at,
        refresh_generation = sess_row.refresh_generation + 1,
        updated_at = now_ts
    WHERE session_id_hash = sess_row.session_id_hash
    RETURNING * INTO sess_row;

    RETURN jsonb_build_object(
      'ok', true,
      'rotated', true,
      'alreadyAdvanced', false,
      'session', jsonb_build_object(
        'sessionIdHash', sess_row.session_id_hash,
        'userId', sess_row.user_id,
        'issuer', sess_row.issuer,
        'subject', sess_row.subject,
        'displayName', sess_row.display_name,
        'email', sess_row.email,
        'tenantId', sess_row.tenant_id,
        'legalEntityId', sess_row.legal_entity_id,
        'period', sess_row.period,
        'encryptedTokens', sess_row.encrypted_tokens,
        'accessTokenExpiresAt', to_char(sess_row.access_token_expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'refreshGeneration', sess_row.refresh_generation,
        'previousEncryptedTokens', sess_row.previous_encrypted_tokens,
        'previousAccessTokenExpiresAt', CASE WHEN sess_row.previous_access_token_expires_at IS NULL THEN NULL ELSE to_char(sess_row.previous_access_token_expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
        'previousGraceUntil', CASE WHEN sess_row.previous_grace_until IS NULL THEN NULL ELSE to_char(sess_row.previous_grace_until, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
        'expiresAt', to_char(sess_row.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'revokedAt', NULL,
        'createdAt', to_char(sess_row.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt', to_char(sess_row.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    );

  ELSIF op_kind = 'revoke_session' THEN
    IF (cmd->>'sessionIdHash') IS NULL OR (cmd->>'sessionIdHash') !~ '^[0-9a-f]{64}$' THEN
      RETURN jsonb_build_object('ok', true, 'revoked', false);
    END IF;

    UPDATE pap_bff_session
    SET revoked_at = COALESCE(revoked_at, now_ts),
        updated_at = now_ts
    WHERE session_id_hash = (cmd->>'sessionIdHash');
    GET DIAGNOSTICS affected_rows = ROW_COUNT;

    RETURN jsonb_build_object('ok', true, 'revoked', affected_rows > 0);

  ELSIF op_kind = 'revoke_user_sessions' THEN
    IF (cmd->>'userId') IS NULL THEN
      RETURN jsonb_build_object('ok', true, 'revokedCount', 0);
    END IF;

    UPDATE pap_bff_session
    SET revoked_at = COALESCE(revoked_at, now_ts),
        updated_at = now_ts
    WHERE user_id = (cmd->>'userId')::uuid
      AND revoked_at IS NULL;
    GET DIAGNOSTICS affected_rows = ROW_COUNT;

    RETURN jsonb_build_object('ok', true, 'revokedCount', affected_rows);
  ELSE
    RAISE EXCEPTION 'Nieobsługiwana operacja magazynu sesji BFF' USING ERRCODE = '42501';
  END IF;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN jsonb_build_object('ok', false, 'reason', 'invalid_session_input');
END;
$fn$;

CREATE OR REPLACE FUNCTION pap_wave2_identity_op(cmd jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET timezone = 'UTC'
SET datestyle = 'ISO, YMD'
AS $fn$
DECLARE
  c jsonb := pap_context();
  signed_cmd jsonb;
  op_kind text;
  now_ts timestamptz(3);
  eval_now_ts timestamptz(3);
  op_id uuid;
  issuer_val text;
  subject_val text;
  display_name_val text;
  email_val text;
  tenant_name_val text;
  reason_val text;
  canonical_req_json jsonb;
  prev_event pap_identity_lifecycle_event%ROWTYPE;
  ident_row user_oidc_identity%ROWTYPE;
  user_row app_user%ROWTYPE;
  prof_row pap_user_profile%ROWTYPE;
  inv_row pap_tenant_invitation%ROWTYPE;
  actor_member_row tenant_membership%ROWTYPE;
  target_member_row tenant_membership%ROWTYPE;
  inviter_member_row tenant_membership%ROWTYPE;
  inviter_user_row app_user%ROWTYPE;
  tenant_row tenant%ROWTYPE;
  resolved_user_id uuid;
  resolved_tenant_id uuid;
  initial_entity_id uuid;
  audit_event_id uuid;
  receipt_json jsonb;
  memberships_json jsonb;
  profile_json jsonb;
  token_hash_val text;
  intended_role_val text;
  invitee_display_val text;
  expires_at_val timestamptz(3);
  inv_id_val uuid;
  actor_id_val uuid;
  scope_tenant_id uuid;
  grant_elem jsonb;
  action_elem text;
  grant_entity_id uuid;
  seen_entities uuid[] := ARRAY[]::uuid[];
  grant_actions text[];
  normalized_grants_json jsonb := '[]'::jsonb;
  granted_company_ids_json jsonb := '[]'::jsonb;
  inviter_display_val text;
  masked_email_val text;
  invitation_json jsonb;
  invitations_json jsonb;
  membership_json jsonb;
  member_until_ts timestamptz(3);
  needs_reactivation boolean := false;
  existing_member_status text := NULL;
BEGIN
  IF c IS NULL
    OR c->>'purpose' IS DISTINCT FROM 'identity_lifecycle'
    OR jsonb_typeof(c->'command') IS DISTINCT FROM 'object'
    OR cmd IS NULL
    OR jsonb_typeof(cmd) IS DISTINCT FROM 'object'
  THEN
    RAISE EXCEPTION 'Brak autoryzowanego kontekstu cyklu życia tożsamości' USING ERRCODE = '42501';
  END IF;

  signed_cmd := c->'command';
  op_kind := cmd->>'kind';
  IF op_kind IS NULL OR signed_cmd IS DISTINCT FROM cmd THEN
    RAISE EXCEPTION 'Niezgodność podpisanej komendy cyklu życia tożsamości' USING ERRCODE = '42501';
  END IF;

  now_ts := COALESCE(
    (cmd->>'nowIso')::timestamptz(3),
    date_trunc('milliseconds', clock_timestamp())::timestamptz(3)
  );
  eval_now_ts := COALESCE(
    (cmd->>'evalNowIso')::timestamptz(3),
    now_ts
  );
  IF NOT isfinite(now_ts) OR NOT isfinite(eval_now_ts) THEN
    RETURN jsonb_build_object(
      'ok',
      false,
      'reason',
      CASE
        WHEN op_kind IN ('upsert_user_profile', 'get_actor_session_directory', 'provision_or_resolve_oidc_user')
          THEN 'invalid_identity_input'
        WHEN op_kind IN ('create_invitation', 'list_tenant_invitations', 'revoke_invitation', 'accept_invitation', 'reject_invitation')
          THEN 'invalid_invitation_input'
        ELSE 'invalid_bootstrap_input'
      END
    );
  END IF;

  IF op_kind = 'bootstrap_initial_owner' THEN
    PERFORM pg_advisory_xact_lock(hashtext('pap:wave2:bootstrap_initial_owner'));

    IF (cmd->>'operationId') IS NULL
      OR (cmd->>'issuer') IS NULL
      OR (cmd->>'subject') IS NULL
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_bootstrap_input');
    END IF;

    op_id := (cmd->>'operationId')::uuid;
    issuer_val := btrim(cmd->>'issuer');
    subject_val := btrim(cmd->>'subject');
    display_name_val := btrim(COALESCE(cmd->>'displayName', ''));
    email_val := lower(btrim(COALESCE(cmd->>'email', '')));
    tenant_name_val := btrim(COALESCE(cmd->>'tenantName', ''));
    reason_val := btrim(COALESCE(cmd->>'reason', ''));

    IF op_id IS NULL
      OR issuer_val = ''
      OR issuer_val IS DISTINCT FROM (cmd->>'issuer')
      OR char_length(issuer_val) > 512
      OR subject_val = ''
      OR subject_val IS DISTINCT FROM (cmd->>'subject')
      OR char_length(subject_val) > 256
      OR char_length(display_name_val) < 2
      OR char_length(display_name_val) > 160
      OR char_length(email_val) < 3
      OR char_length(email_val) > 254
      OR position('@' IN email_val) < 2
      OR char_length(tenant_name_val) < 2
      OR char_length(tenant_name_val) > 240
      OR char_length(reason_val) < 3
      OR char_length(reason_val) > 400
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_bootstrap_input');
    END IF;

    canonical_req_json := cmd - ARRAY['nowIso', 'initialLegalEntityId'];

    SELECT * INTO prev_event
    FROM pap_identity_lifecycle_event
    WHERE operation_id = op_id;

    IF FOUND THEN
      IF prev_event.kind <> 'bootstrap_owner'
        OR prev_event.request_key::jsonb IS DISTINCT FROM canonical_req_json
      THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'operation_conflict');
      END IF;
      RETURN jsonb_build_object(
        'ok', true,
        'idempotentReplay', true,
        'receipt', prev_event.receipt
      );
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pap_identity_lifecycle_event
      WHERE kind = 'bootstrap_owner'
    ) OR EXISTS (
      SELECT 1
      FROM tenant_membership m
      JOIN app_user u ON u.id = m.user_id
      WHERE m.role = 'tenant_owner'
        AND m.status = 'active'
        AND m.valid_from <= now_ts
        AND (m.valid_until IS NULL OR m.valid_until > now_ts)
        AND u.status = 'active'
        AND u.disabled_at IS NULL
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'owner_already_bootstrapped');
    END IF;

    SELECT * INTO ident_row
    FROM user_oidc_identity
    WHERE issuer = issuer_val
      AND subject = subject_val
    FOR UPDATE;

    IF FOUND THEN
      IF ident_row.status <> 'active' OR ident_row.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'identity_revoked');
      END IF;
      SELECT * INTO user_row
      FROM app_user
      WHERE id = ident_row.user_id
      FOR UPDATE;
      IF NOT FOUND OR user_row.status <> 'active' OR user_row.disabled_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'user_disabled');
      END IF;
      IF (cmd->>'userId') IS NOT NULL AND (cmd->>'userId')::uuid <> ident_row.user_id THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'identity_already_linked');
      END IF;
      resolved_user_id := ident_row.user_id;
    ELSE
      resolved_user_id := COALESCE((cmd->>'userId')::uuid, gen_random_uuid());
      IF EXISTS (SELECT 1 FROM app_user WHERE id = resolved_user_id) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'user_already_exists');
      END IF;

      INSERT INTO app_user (id, status, created_at, disabled_at)
      VALUES (resolved_user_id, 'active', now_ts, NULL);

      INSERT INTO user_oidc_identity (id, user_id, issuer, subject, status, linked_at, revoked_at)
      VALUES (gen_random_uuid(), resolved_user_id, issuer_val, subject_val, 'active', now_ts, NULL);
    END IF;

    INSERT INTO pap_user_profile (user_id, display_name, email, created_at, updated_at)
    VALUES (resolved_user_id, display_name_val, email_val, now_ts, now_ts)
    ON CONFLICT (user_id) DO UPDATE
      SET display_name = EXCLUDED.display_name,
          email = EXCLUDED.email,
          updated_at = GREATEST(pap_user_profile.created_at, EXCLUDED.updated_at);

    resolved_tenant_id := COALESCE((cmd->>'tenantId')::uuid, gen_random_uuid());
    IF EXISTS (SELECT 1 FROM tenant WHERE id = resolved_tenant_id) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'tenant_already_exists');
    END IF;

    INSERT INTO tenant (id, name, created_at)
    VALUES (resolved_tenant_id, tenant_name_val, now_ts);

    INSERT INTO tenant_membership (tenant_id, user_id, role, status, valid_from, valid_until)
    VALUES (resolved_tenant_id, resolved_user_id, 'tenant_owner', 'active', now_ts, NULL);

    audit_event_id := gen_random_uuid();
    initial_entity_id := (cmd->>'initialLegalEntityId')::uuid;

    receipt_json := jsonb_build_object(
      'userId', resolved_user_id,
      'issuer', issuer_val,
      'subject', subject_val,
      'displayName', display_name_val,
      'email', email_val,
      'tenantId', resolved_tenant_id,
      'tenantName', tenant_name_val,
      'role', 'tenant_owner',
      'legalEntityId', initial_entity_id,
      'operationId', op_id,
      'auditEventId', audit_event_id,
      'occurredAt', to_char(now_ts, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );

    INSERT INTO pap_identity_lifecycle_event (
      id,
      operation_id,
      kind,
      actor_user_id,
      target_user_id,
      tenant_id,
      invitation_id,
      issuer,
      subject,
      reason,
      request_key,
      receipt,
      occurred_at
    ) VALUES (
      audit_event_id,
      op_id,
      'bootstrap_owner',
      resolved_user_id,
      resolved_user_id,
      resolved_tenant_id,
      NULL,
      issuer_val,
      subject_val,
      reason_val,
      canonical_req_json::text,
      receipt_json,
      now_ts
    );

    RETURN jsonb_build_object(
      'ok', true,
      'idempotentReplay', false,
      'receipt', receipt_json
    );

  ELSIF op_kind = 'upsert_user_profile' THEN
    IF (cmd->>'userId') IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_identity_input');
    END IF;
    resolved_user_id := (cmd->>'userId')::uuid;
    display_name_val := btrim(COALESCE(cmd->>'displayName', ''));
    email_val := lower(btrim(COALESCE(cmd->>'email', '')));

    IF resolved_user_id IS NULL
      OR display_name_val = ''
      OR char_length(display_name_val) > 160
      OR char_length(email_val) < 3
      OR char_length(email_val) > 254
      OR position('@' IN email_val) < 2
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_identity_input');
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM app_user u
      WHERE u.id = resolved_user_id
        AND u.status = 'active'
        AND u.disabled_at IS NULL
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'user_inactive_or_missing');
    END IF;

    INSERT INTO pap_user_profile (user_id, display_name, email, created_at, updated_at)
    VALUES (resolved_user_id, display_name_val, email_val, now_ts, now_ts)
    ON CONFLICT (user_id) DO UPDATE
      SET display_name = EXCLUDED.display_name,
          email = CASE
            WHEN (
              EXCLUDED.email LIKE '%.invalid'
              OR EXCLUDED.email = 'uzytkownik@pap.example'
              OR position('***@' IN EXCLUDED.email) > 0
            )
              AND pap_user_profile.email NOT LIKE '%.invalid'
              AND pap_user_profile.email <> 'uzytkownik@pap.example'
              AND position('***@' IN pap_user_profile.email) = 0
              THEN pap_user_profile.email
            ELSE EXCLUDED.email
          END,
          updated_at = GREATEST(pap_user_profile.created_at, EXCLUDED.updated_at)
    RETURNING * INTO prof_row;

    RETURN jsonb_build_object(
      'ok', true,
      'profile', jsonb_build_object(
        'userId', prof_row.user_id,
        'displayName', prof_row.display_name,
        'email', prof_row.email,
        'createdAt', to_char(prof_row.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt', to_char(prof_row.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    );

  ELSIF op_kind = 'get_actor_session_directory' THEN
    IF (cmd->>'userId') IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_identity_input');
    END IF;
    resolved_user_id := (cmd->>'userId')::uuid;

    IF NOT EXISTS (
      SELECT 1 FROM app_user u
      WHERE u.id = resolved_user_id
        AND u.status = 'active'
        AND u.disabled_at IS NULL
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'user_inactive_or_missing');
    END IF;

    SELECT * INTO prof_row
    FROM pap_user_profile
    WHERE user_id = resolved_user_id;

    IF FOUND THEN
      profile_json := jsonb_build_object(
        'userId', prof_row.user_id,
        'displayName', prof_row.display_name,
        'email', prof_row.email,
        'createdAt', to_char(prof_row.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt', to_char(prof_row.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      );
    ELSE
      profile_json := NULL;
    END IF;

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'tenantId', m.tenant_id,
          'tenantName', t.name,
          'role', m.role,
          'status', CASE
            WHEN m.status = 'active'
              AND m.valid_from <= now_ts
              AND (m.valid_until IS NULL OR m.valid_until > now_ts)
            THEN 'active'
            ELSE 'revoked'
          END,
          'validFrom', to_char(m.valid_from, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'validUntil', CASE
            WHEN m.valid_until IS NULL THEN NULL
            ELSE to_char(m.valid_until, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          END
        )
        ORDER BY t.created_at, t.id
      ),
      '[]'::jsonb
    )
    INTO memberships_json
    FROM tenant_membership m
    JOIN tenant t ON t.id = m.tenant_id
    WHERE m.user_id = resolved_user_id;

    RETURN jsonb_build_object(
      'ok', true,
      'userId', resolved_user_id,
      'profile', profile_json,
      'memberships', memberships_json
    );

  ELSIF op_kind = 'provision_or_resolve_oidc_user' THEN
    IF (cmd->>'issuer') IS NULL OR (cmd->>'subject') IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_identity_input');
    END IF;
    issuer_val := btrim(cmd->>'issuer');
    subject_val := btrim(cmd->>'subject');
    IF issuer_val = ''
      OR issuer_val IS DISTINCT FROM (cmd->>'issuer')
      OR char_length(issuer_val) > 512
      OR subject_val = ''
      OR subject_val IS DISTINCT FROM (cmd->>'subject')
      OR char_length(subject_val) > 256
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_identity_input');
    END IF;

    display_name_val := left(btrim(COALESCE(cmd->>'displayName', '')), 160);
    IF display_name_val = '' THEN
      display_name_val := left(subject_val, 160);
    END IF;

    email_val := lower(btrim(COALESCE(cmd->>'email', '')));
    IF char_length(email_val) < 3
      OR char_length(email_val) > 254
      OR position('@' IN email_val) < 2
    THEN
      email_val := 'uzytkownik@pap.example';
    END IF;

    SELECT * INTO ident_row
    FROM user_oidc_identity
    WHERE issuer = issuer_val
      AND subject = subject_val
    FOR UPDATE;

    IF FOUND THEN
      IF ident_row.status <> 'active' OR ident_row.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'identity_revoked');
      END IF;
      SELECT * INTO user_row
      FROM app_user
      WHERE id = ident_row.user_id
      FOR UPDATE;
      IF NOT FOUND OR user_row.status <> 'active' OR user_row.disabled_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'user_disabled');
      END IF;

      resolved_user_id := ident_row.user_id;
      INSERT INTO pap_user_profile (user_id, display_name, email, created_at, updated_at)
      VALUES (resolved_user_id, display_name_val, email_val, now_ts, now_ts)
      ON CONFLICT (user_id) DO UPDATE
        SET display_name = CASE
              WHEN btrim(COALESCE(cmd->>'displayName', '')) = '' THEN pap_user_profile.display_name
              ELSE EXCLUDED.display_name
            END,
            email = CASE
              WHEN (
                EXCLUDED.email LIKE '%.invalid'
                OR EXCLUDED.email = 'uzytkownik@pap.example'
                OR position('***@' IN EXCLUDED.email) > 0
              )
                AND pap_user_profile.email NOT LIKE '%.invalid'
                AND pap_user_profile.email <> 'uzytkownik@pap.example'
                AND position('***@' IN pap_user_profile.email) = 0
              THEN pap_user_profile.email
              ELSE EXCLUDED.email
            END,
            updated_at = GREATEST(pap_user_profile.created_at, EXCLUDED.updated_at)
      RETURNING * INTO prof_row;

      RETURN jsonb_build_object(
        'ok', true,
        'userId', resolved_user_id,
        'created', false,
        'profile', jsonb_build_object(
          'userId', prof_row.user_id,
          'displayName', prof_row.display_name,
          'email', prof_row.email,
          'createdAt', to_char(prof_row.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'updatedAt', to_char(prof_row.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
      );
    END IF;

    resolved_user_id := gen_random_uuid();
    op_id := COALESCE((cmd->>'operationId')::uuid, gen_random_uuid());
    IF EXISTS (SELECT 1 FROM pap_identity_lifecycle_event WHERE operation_id = op_id) THEN
      op_id := gen_random_uuid();
    END IF;

    INSERT INTO app_user (id, status, created_at, disabled_at)
    VALUES (resolved_user_id, 'active', now_ts, NULL);

    INSERT INTO user_oidc_identity (id, user_id, issuer, subject, status, linked_at, revoked_at)
    VALUES (gen_random_uuid(), resolved_user_id, issuer_val, subject_val, 'active', now_ts, NULL);

    INSERT INTO pap_user_profile (user_id, display_name, email, created_at, updated_at)
    VALUES (resolved_user_id, display_name_val, email_val, now_ts, now_ts)
    RETURNING * INTO prof_row;

    audit_event_id := gen_random_uuid();
    INSERT INTO pap_identity_lifecycle_event (
      id,
      operation_id,
      kind,
      actor_user_id,
      target_user_id,
      tenant_id,
      invitation_id,
      issuer,
      subject,
      reason,
      request_key,
      receipt,
      occurred_at
    ) VALUES (
      audit_event_id,
      op_id,
      'provision_unassigned_user',
      resolved_user_id,
      resolved_user_id,
      NULL,
      NULL,
      issuer_val,
      subject_val,
      'Rejestracja zweryfikowanej tożsamości OIDC bez członkostwa w organizacji',
      jsonb_build_object('issuer', issuer_val, 'subject', subject_val)::text,
      jsonb_build_object('userId', resolved_user_id, 'issuer', issuer_val, 'subject', subject_val),
      now_ts
    );

    RETURN jsonb_build_object(
      'ok', true,
      'userId', resolved_user_id,
      'created', true,
      'profile', jsonb_build_object(
        'userId', prof_row.user_id,
        'displayName', prof_row.display_name,
        'email', prof_row.email,
        'createdAt', to_char(prof_row.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'updatedAt', to_char(prof_row.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    );

  ELSIF op_kind = 'create_invitation' THEN
    IF (cmd->>'operationId') IS NULL
      OR (cmd->>'actorUserId') IS NULL
      OR (cmd->>'tenantId') IS NULL
      OR (cmd->>'tokenSha256') IS NULL
      OR (cmd->>'expiresAtIso') IS NULL
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_invitation_input');
    END IF;

    op_id := (cmd->>'operationId')::uuid;
    actor_id_val := (cmd->>'actorUserId')::uuid;
    scope_tenant_id := (cmd->>'tenantId')::uuid;
    token_hash_val := cmd->>'tokenSha256';
    email_val := lower(btrim(COALESCE(cmd->>'inviteeEmail', '')));
    invitee_display_val := NULLIF(btrim(COALESCE(cmd->>'inviteeDisplayName', '')), '');
    intended_role_val := COALESCE(cmd->>'intendedRole', '');
    reason_val := btrim(COALESCE(cmd->>'reason', ''));
    expires_at_val := (cmd->>'expiresAtIso')::timestamptz(3);

    IF op_id IS NULL
      OR actor_id_val IS NULL
      OR scope_tenant_id IS NULL
      OR token_hash_val !~ '^[0-9a-f]{64}$'
      OR char_length(email_val) < 3
      OR char_length(email_val) > 254
      OR position('@' IN email_val) < 2
      OR position('@' IN email_val) = char_length(email_val)
      OR (invitee_display_val IS NOT NULL AND (char_length(invitee_display_val) < 2 OR char_length(invitee_display_val) > 160))
      OR intended_role_val NOT IN ('tenant_owner', 'tenant_admin', 'tenant_member')
      OR char_length(reason_val) < 3
      OR char_length(reason_val) > 400
      OR NOT isfinite(expires_at_val)
      OR expires_at_val <= eval_now_ts
      OR expires_at_val <= now_ts
      OR (cmd->'initialCompanyGrants' IS NOT NULL AND jsonb_typeof(cmd->'initialCompanyGrants') <> 'array')
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_invitation_input');
    END IF;

    IF EXISTS (SELECT 1 FROM pap_identity_lifecycle_event WHERE operation_id = op_id)
      OR EXISTS (SELECT 1 FROM pap_tenant_invitation WHERE operation_id = op_id OR token_sha256 = token_hash_val)
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'operation_conflict');
    END IF;

    SELECT * INTO user_row
    FROM app_user
    WHERE id = actor_id_val
    FOR SHARE;

    IF NOT FOUND OR user_row.status <> 'active' OR user_row.disabled_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'user_disabled');
    END IF;

    SELECT * INTO tenant_row
    FROM tenant
    WHERE id = scope_tenant_id
    FOR SHARE;

    SELECT * INTO actor_member_row
    FROM tenant_membership
    WHERE tenant_id = scope_tenant_id
      AND user_id = actor_id_val
    FOR SHARE;

    IF tenant_row.id IS NULL
      OR actor_member_row.user_id IS NULL
      OR actor_member_row.status <> 'active'
      OR actor_member_row.valid_from > eval_now_ts
      OR (actor_member_row.valid_until IS NOT NULL AND actor_member_row.valid_until <= eval_now_ts)
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'active_admin_membership_required');
    END IF;

    IF actor_member_row.role NOT IN ('tenant_owner', 'tenant_admin') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'admin_role_required');
    END IF;

    IF intended_role_val = 'tenant_owner'
      OR (actor_member_row.role = 'tenant_admin' AND intended_role_val <> 'tenant_member')
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'target_role_not_delegable');
    END IF;

    seen_entities := ARRAY[]::uuid[];
    normalized_grants_json := '[]'::jsonb;

    FOR grant_elem IN
      SELECT * FROM jsonb_array_elements(COALESCE(cmd->'initialCompanyGrants', '[]'::jsonb))
    LOOP
      IF jsonb_typeof(grant_elem) <> 'object'
        OR (grant_elem->>'legalEntityId') IS NULL
        OR jsonb_typeof(grant_elem->'actions') <> 'array'
        OR jsonb_array_length(grant_elem->'actions') < 1
        OR jsonb_array_length(grant_elem->'actions') > 2
      THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_invitation_input');
      END IF;

      grant_entity_id := (grant_elem->>'legalEntityId')::uuid;
      IF grant_entity_id IS NULL OR grant_entity_id = ANY(seen_entities) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_invitation_input');
      END IF;
      seen_entities := array_append(seen_entities, grant_entity_id);

      grant_actions := ARRAY[]::text[];
      FOR action_elem IN
        SELECT jsonb_array_elements_text(grant_elem->'actions')
      LOOP
        IF action_elem NOT IN ('read', 'write') OR action_elem = ANY(grant_actions) THEN
          RETURN jsonb_build_object('ok', false, 'reason', 'invalid_invitation_input');
        END IF;
        grant_actions := array_append(grant_actions, action_elem);
      END LOOP;

      IF 'write' = ANY(grant_actions) AND NOT ('read' = ANY(grant_actions)) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_invitation_input');
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM legal_entity
        WHERE id = grant_entity_id AND tenant_id = scope_tenant_id
        FOR SHARE
      ) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'grant_scope_not_delegable');
      END IF;

      IF actor_member_row.role = 'tenant_admin' THEN
        FOREACH action_elem IN ARRAY grant_actions
        LOOP
          IF NOT EXISTS (
            SELECT 1
            FROM company_access_grant g
            WHERE g.tenant_id = scope_tenant_id
              AND g.user_id = actor_id_val
              AND g.legal_entity_id = grant_entity_id
              AND g.action = action_elem
              AND g.valid_from <= eval_now_ts
              AND (g.valid_until IS NULL OR g.valid_until > eval_now_ts)
              AND (g.revoked_at IS NULL OR g.revoked_at > eval_now_ts)
          ) THEN
            RETURN jsonb_build_object('ok', false, 'reason', 'grant_scope_not_delegable');
          END IF;
        END LOOP;
      END IF;

      normalized_grants_json := normalized_grants_json || jsonb_build_array(
        jsonb_build_object(
          'legalEntityId', grant_entity_id,
          'actions', to_jsonb(grant_actions)
        )
      );
    END LOOP;

    PERFORM pg_advisory_xact_lock(
      hashtext('pap:wave2:invite:' || scope_tenant_id::text),
      hashtext(email_val)
    );

    IF EXISTS (
      SELECT 1
      FROM pap_tenant_invitation
      WHERE tenant_id = scope_tenant_id
        AND invitee_email = email_val
        AND status = 'pending'
        AND expires_at > eval_now_ts
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_pending_invitation');
    END IF;

    inv_id_val := gen_random_uuid();
    audit_event_id := gen_random_uuid();

    INSERT INTO pap_tenant_invitation (
      id,
      operation_id,
      tenant_id,
      token_sha256,
      invitee_email,
      invitee_display_name,
      intended_role,
      initial_company_grants,
      status,
      invited_by_user_id,
      reason,
      created_at,
      expires_at
    ) VALUES (
      inv_id_val,
      op_id,
      scope_tenant_id,
      token_hash_val,
      email_val,
      invitee_display_val,
      intended_role_val,
      normalized_grants_json,
      'pending',
      actor_id_val,
      reason_val,
      now_ts,
      expires_at_val
    ) RETURNING * INTO inv_row;

    SELECT COALESCE(p.display_name, 'Administrator organizacji')
    INTO inviter_display_val
    FROM app_user u
    LEFT JOIN pap_user_profile p ON p.user_id = u.id
    WHERE u.id = actor_id_val;

    masked_email_val := left(
      CASE
        WHEN position('@' IN inv_row.invitee_email) <= 1 THEN '***@***'
        WHEN position('@' IN inv_row.invitee_email) - 1 <= 2
          THEN left(inv_row.invitee_email, 1) || '***@' || substring(inv_row.invitee_email FROM position('@' IN inv_row.invitee_email) + 1)
        ELSE
          left(inv_row.invitee_email, 2) || '***@' || substring(inv_row.invitee_email FROM position('@' IN inv_row.invitee_email) + 1)
      END,
      160
    );

    invitation_json := jsonb_build_object(
      'invitationId', inv_row.id,
      'tenantId', inv_row.tenant_id,
      'tenantName', tenant_row.name,
      'inviteeMaskedEmail', masked_email_val,
      'inviteeDisplayName', inv_row.invitee_display_name,
      'intendedRole', inv_row.intended_role,
      'initialCompanyGrants', inv_row.initial_company_grants,
      'status', 'pending',
      'invitedByUserId', inv_row.invited_by_user_id,
      'invitedByDisplayName', inviter_display_val,
      'createdAt', to_char(inv_row.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'expiresAt', to_char(inv_row.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'acceptedAt', NULL,
      'acceptedByUserId', NULL,
      'revokedAt', NULL,
      'rejectedAt', NULL
    );

    INSERT INTO pap_identity_lifecycle_event (
      id,
      operation_id,
      kind,
      actor_user_id,
      target_user_id,
      tenant_id,
      invitation_id,
      issuer,
      subject,
      reason,
      request_key,
      receipt,
      occurred_at
    ) VALUES (
      audit_event_id,
      op_id,
      'create_invitation',
      actor_id_val,
      NULL,
      scope_tenant_id,
      inv_id_val,
      NULL,
      NULL,
      reason_val,
      jsonb_build_object(
        'actorUserId', actor_id_val,
        'tenantId', scope_tenant_id,
        'tokenSha256', token_hash_val,
        'intendedRole', intended_role_val
      )::text,
      jsonb_build_object('invitation', invitation_json, 'auditEventId', audit_event_id),
      now_ts
    );

    RETURN jsonb_build_object(
      'ok', true,
      'invitation', invitation_json,
      'auditEventId', audit_event_id
    );

  ELSIF op_kind = 'list_tenant_invitations' THEN
    IF (cmd->>'actorUserId') IS NULL OR (cmd->>'tenantId') IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_invitation_input');
    END IF;

    actor_id_val := (cmd->>'actorUserId')::uuid;
    scope_tenant_id := (cmd->>'tenantId')::uuid;

    SELECT * INTO user_row FROM app_user WHERE id = actor_id_val;
    IF NOT FOUND OR user_row.status <> 'active' OR user_row.disabled_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'user_disabled');
    END IF;

    SELECT * INTO tenant_row FROM tenant WHERE id = scope_tenant_id;
    SELECT * INTO actor_member_row
    FROM tenant_membership
    WHERE tenant_id = scope_tenant_id AND user_id = actor_id_val;

    IF tenant_row.id IS NULL
      OR actor_member_row.user_id IS NULL
      OR actor_member_row.status <> 'active'
      OR actor_member_row.valid_from > eval_now_ts
      OR (actor_member_row.valid_until IS NOT NULL AND actor_member_row.valid_until <= eval_now_ts)
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'active_admin_membership_required');
    END IF;

    IF actor_member_row.role NOT IN ('tenant_owner', 'tenant_admin') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'admin_role_required');
    END IF;

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'invitationId', inv.id,
          'tenantId', inv.tenant_id,
          'tenantName', tenant_row.name,
          'inviteeMaskedEmail', left(
            CASE
              WHEN position('@' IN inv.invitee_email) <= 1 THEN '***@***'
              WHEN position('@' IN inv.invitee_email) - 1 <= 2
                THEN left(inv.invitee_email, 1) || '***@' || substring(inv.invitee_email FROM position('@' IN inv.invitee_email) + 1)
              ELSE
                left(inv.invitee_email, 2) || '***@' || substring(inv.invitee_email FROM position('@' IN inv.invitee_email) + 1)
            END,
            160
          ),
          'inviteeDisplayName', inv.invitee_display_name,
          'intendedRole', inv.intended_role,
          'initialCompanyGrants', inv.initial_company_grants,
          'status', CASE
            WHEN inv.status = 'pending' AND inv.expires_at <= eval_now_ts THEN 'expired'
            ELSE inv.status
          END,
          'invitedByUserId', inv.invited_by_user_id,
          'invitedByDisplayName', COALESCE(p.display_name, 'Administrator organizacji'),
          'createdAt', to_char(inv.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'expiresAt', to_char(inv.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'acceptedAt', CASE WHEN inv.accepted_at IS NULL THEN NULL ELSE to_char(inv.accepted_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
          'acceptedByUserId', inv.accepted_by_user_id,
          'revokedAt', CASE WHEN inv.revoked_at IS NULL THEN NULL ELSE to_char(inv.revoked_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
          'rejectedAt', CASE WHEN inv.rejected_at IS NULL THEN NULL ELSE to_char(inv.rejected_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
        )
        ORDER BY inv.created_at DESC, inv.id DESC
      ),
      '[]'::jsonb
    )
    INTO invitations_json
    FROM pap_tenant_invitation inv
    LEFT JOIN pap_user_profile p ON p.user_id = inv.invited_by_user_id
    WHERE inv.tenant_id = scope_tenant_id;

    RETURN jsonb_build_object(
      'ok', true,
      'tenantId', scope_tenant_id,
      'invitations', invitations_json
    );

  ELSIF op_kind = 'revoke_invitation' THEN
    IF (cmd->>'operationId') IS NULL
      OR (cmd->>'actorUserId') IS NULL
      OR (cmd->>'tenantId') IS NULL
      OR (cmd->>'invitationId') IS NULL
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_invitation_input');
    END IF;

    op_id := (cmd->>'operationId')::uuid;
    actor_id_val := (cmd->>'actorUserId')::uuid;
    scope_tenant_id := (cmd->>'tenantId')::uuid;
    inv_id_val := (cmd->>'invitationId')::uuid;
    reason_val := btrim(COALESCE(cmd->>'reason', ''));

    IF op_id IS NULL
      OR actor_id_val IS NULL
      OR scope_tenant_id IS NULL
      OR inv_id_val IS NULL
      OR char_length(reason_val) < 3
      OR char_length(reason_val) > 400
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_invitation_input');
    END IF;

    SELECT * INTO user_row FROM app_user WHERE id = actor_id_val FOR SHARE;
    IF NOT FOUND OR user_row.status <> 'active' OR user_row.disabled_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'user_disabled');
    END IF;

    SELECT * INTO tenant_row FROM tenant WHERE id = scope_tenant_id FOR SHARE;
    SELECT * INTO actor_member_row
    FROM tenant_membership
    WHERE tenant_id = scope_tenant_id AND user_id = actor_id_val
    FOR SHARE;

    IF tenant_row.id IS NULL
      OR actor_member_row.user_id IS NULL
      OR actor_member_row.status <> 'active'
      OR actor_member_row.valid_from > eval_now_ts
      OR (actor_member_row.valid_until IS NOT NULL AND actor_member_row.valid_until <= eval_now_ts)
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'active_admin_membership_required');
    END IF;

    IF actor_member_row.role NOT IN ('tenant_owner', 'tenant_admin') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'admin_role_required');
    END IF;

    canonical_req_json := jsonb_build_object(
      'actorUserId', actor_id_val,
      'tenantId', scope_tenant_id,
      'invitationId', inv_id_val,
      'reason', reason_val
    );

    SELECT * INTO prev_event
    FROM pap_identity_lifecycle_event
    WHERE operation_id = op_id;

    IF FOUND THEN
      IF prev_event.kind <> 'revoke_invitation'
        OR prev_event.request_key::jsonb IS DISTINCT FROM canonical_req_json
      THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'operation_conflict');
      END IF;
      RETURN jsonb_build_object(
        'ok', true,
        'idempotentReplay', true,
        'invitation', prev_event.receipt->'invitation',
        'auditEventId', prev_event.id
      );
    END IF;

    SELECT * INTO inv_row
    FROM pap_tenant_invitation
    WHERE id = inv_id_val AND tenant_id = scope_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invitation_not_found');
    END IF;

    IF actor_member_row.role = 'tenant_admin' THEN
      IF inv_row.intended_role <> 'tenant_member' THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'target_role_not_delegable');
      END IF;
      FOR grant_elem IN
        SELECT * FROM jsonb_array_elements(inv_row.initial_company_grants)
      LOOP
        grant_entity_id := (grant_elem->>'legalEntityId')::uuid;
        FOR action_elem IN
          SELECT jsonb_array_elements_text(grant_elem->'actions')
        LOOP
          IF NOT EXISTS (
            SELECT 1
            FROM company_access_grant g
            WHERE g.tenant_id = scope_tenant_id
              AND g.user_id = actor_id_val
              AND g.legal_entity_id = grant_entity_id
              AND g.action = action_elem
              AND g.valid_from <= eval_now_ts
              AND (g.valid_until IS NULL OR g.valid_until > eval_now_ts)
              AND (g.revoked_at IS NULL OR g.revoked_at > eval_now_ts)
          ) THEN
            RETURN jsonb_build_object('ok', false, 'reason', 'grant_scope_not_delegable');
          END IF;
        END LOOP;
      END LOOP;
    END IF;

    IF inv_row.status <> 'pending' OR inv_row.expires_at <= eval_now_ts THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invitation_not_pending');
    END IF;

    UPDATE pap_tenant_invitation
    SET status = 'revoked',
        revoked_at = GREATEST(inv_row.created_at, now_ts),
        revoked_by_user_id = actor_id_val
    WHERE id = inv_row.id
    RETURNING * INTO inv_row;

    SELECT COALESCE(p.display_name, 'Administrator organizacji')
    INTO inviter_display_val
    FROM app_user u
    LEFT JOIN pap_user_profile p ON p.user_id = u.id
    WHERE u.id = inv_row.invited_by_user_id;

    masked_email_val := left(
      CASE
        WHEN position('@' IN inv_row.invitee_email) <= 1 THEN '***@***'
        WHEN position('@' IN inv_row.invitee_email) - 1 <= 2
          THEN left(inv_row.invitee_email, 1) || '***@' || substring(inv_row.invitee_email FROM position('@' IN inv_row.invitee_email) + 1)
        ELSE
          left(inv_row.invitee_email, 2) || '***@' || substring(inv_row.invitee_email FROM position('@' IN inv_row.invitee_email) + 1)
      END,
      160
    );

    invitation_json := jsonb_build_object(
      'invitationId', inv_row.id,
      'tenantId', inv_row.tenant_id,
      'tenantName', tenant_row.name,
      'inviteeMaskedEmail', masked_email_val,
      'inviteeDisplayName', inv_row.invitee_display_name,
      'intendedRole', inv_row.intended_role,
      'initialCompanyGrants', inv_row.initial_company_grants,
      'status', 'revoked',
      'invitedByUserId', inv_row.invited_by_user_id,
      'invitedByDisplayName', inviter_display_val,
      'createdAt', to_char(inv_row.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'expiresAt', to_char(inv_row.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'acceptedAt', NULL,
      'acceptedByUserId', NULL,
      'revokedAt', to_char(inv_row.revoked_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'rejectedAt', NULL
    );

    audit_event_id := gen_random_uuid();
    INSERT INTO pap_identity_lifecycle_event (
      id,
      operation_id,
      kind,
      actor_user_id,
      target_user_id,
      tenant_id,
      invitation_id,
      issuer,
      subject,
      reason,
      request_key,
      receipt,
      occurred_at
    ) VALUES (
      audit_event_id,
      op_id,
      'revoke_invitation',
      actor_id_val,
      NULL,
      scope_tenant_id,
      inv_row.id,
      NULL,
      NULL,
      reason_val,
      canonical_req_json::text,
      jsonb_build_object('invitation', invitation_json, 'auditEventId', audit_event_id),
      now_ts
    );

    RETURN jsonb_build_object(
      'ok', true,
      'idempotentReplay', false,
      'invitation', invitation_json,
      'auditEventId', audit_event_id
    );

  ELSIF op_kind = 'accept_invitation' THEN
    IF (cmd->>'operationId') IS NULL
      OR (cmd->>'tokenSha256') IS NULL
      OR (cmd->>'issuer') IS NULL
      OR (cmd->>'subject') IS NULL
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_invitation_input');
    END IF;

    op_id := (cmd->>'operationId')::uuid;
    token_hash_val := cmd->>'tokenSha256';
    issuer_val := btrim(cmd->>'issuer');
    subject_val := btrim(cmd->>'subject');

    IF op_id IS NULL
      OR token_hash_val !~ '^[0-9a-f]{64}$'
      OR issuer_val = ''
      OR issuer_val IS DISTINCT FROM (cmd->>'issuer')
      OR char_length(issuer_val) > 512
      OR subject_val = ''
      OR subject_val IS DISTINCT FROM (cmd->>'subject')
      OR char_length(subject_val) > 256
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_invitation_input');
    END IF;

    SELECT * INTO ident_row
    FROM user_oidc_identity
    WHERE issuer = issuer_val
      AND subject = subject_val
    FOR UPDATE;

    IF FOUND THEN
      IF ident_row.status <> 'active' OR ident_row.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'identity_revoked');
      END IF;
      SELECT * INTO user_row
      FROM app_user
      WHERE id = ident_row.user_id
      FOR UPDATE;
      IF NOT FOUND OR user_row.status <> 'active' OR user_row.disabled_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'user_disabled');
      END IF;
      resolved_user_id := ident_row.user_id;
    ELSE
      resolved_user_id := NULL;
    END IF;

    IF (cmd->>'actorUserId') IS NOT NULL THEN
      actor_id_val := (cmd->>'actorUserId')::uuid;
      SELECT * INTO user_row FROM app_user WHERE id = actor_id_val FOR SHARE;
      IF NOT FOUND OR user_row.status <> 'active' OR user_row.disabled_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'user_disabled');
      END IF;
      IF resolved_user_id IS DISTINCT FROM actor_id_val THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_invitation_input');
      END IF;
    END IF;

    canonical_req_json := jsonb_build_object(
      'tokenSha256', token_hash_val,
      'issuer', issuer_val,
      'subject', subject_val
    );

    SELECT * INTO prev_event
    FROM pap_identity_lifecycle_event
    WHERE operation_id = op_id;

    IF FOUND THEN
      IF prev_event.kind <> 'accept_invitation'
        OR prev_event.request_key::jsonb IS DISTINCT FROM canonical_req_json
      THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'operation_conflict');
      END IF;
      RETURN jsonb_build_object(
        'ok', true,
        'idempotentReplay', true,
        'userId', prev_event.receipt->>'userId',
        'invitation', prev_event.receipt->'invitation',
        'membership', prev_event.receipt->'membership',
        'grantedCompanyIds', prev_event.receipt->'grantedCompanyIds',
        'auditEventId', prev_event.id,
        'needsMembershipReactivation', false
      );
    END IF;

    SELECT * INTO inv_row
    FROM pap_tenant_invitation
    WHERE token_sha256 = token_hash_val
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invitation_not_found');
    END IF;
    IF inv_row.status = 'revoked' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invitation_revoked');
    END IF;
    IF inv_row.status = 'rejected' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invitation_rejected');
    END IF;
    IF inv_row.status = 'accepted' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invitation_already_used');
    END IF;
    IF inv_row.expires_at <= eval_now_ts THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invitation_expired');
    END IF;

    SELECT * INTO tenant_row FROM tenant WHERE id = inv_row.tenant_id FOR SHARE;
    SELECT * INTO inviter_user_row FROM app_user WHERE id = inv_row.invited_by_user_id FOR SHARE;
    SELECT * INTO inviter_member_row
    FROM tenant_membership
    WHERE tenant_id = inv_row.tenant_id
      AND user_id = inv_row.invited_by_user_id
    FOR SHARE;

    IF tenant_row.id IS NULL
      OR inviter_user_row.id IS NULL
      OR inviter_user_row.status <> 'active'
      OR inviter_user_row.disabled_at IS NOT NULL
      OR inviter_member_row.user_id IS NULL
      OR inviter_member_row.status <> 'active'
      OR inviter_member_row.valid_from > eval_now_ts
      OR inviter_member_row.valid_from > clock_timestamp()
      OR (inviter_member_row.valid_until IS NOT NULL AND (inviter_member_row.valid_until <= eval_now_ts OR inviter_member_row.valid_until <= clock_timestamp()))
      OR inviter_member_row.role NOT IN ('tenant_owner', 'tenant_admin')
      OR (inviter_member_row.role = 'tenant_admin' AND inv_row.intended_role <> 'tenant_member')
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'inviter_authority_revoked');
    END IF;

    IF resolved_user_id = inv_row.invited_by_user_id THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'self_invitation_acceptance_forbidden');
    END IF;

    display_name_val := left(
      btrim(COALESCE(NULLIF(btrim(cmd->>'displayName'), ''), inv_row.invitee_display_name, subject_val)),
      160
    );
    IF display_name_val = '' THEN
      display_name_val := left(subject_val, 160);
    END IF;

    email_val := lower(btrim(COALESCE(NULLIF(btrim(cmd->>'email'), ''), inv_row.invitee_email)));
    IF char_length(email_val) < 3
      OR char_length(email_val) > 254
      OR position('@' IN email_val) < 2
    THEN
      email_val := inv_row.invitee_email;
    END IF;

    IF resolved_user_id IS NULL THEN
      resolved_user_id := gen_random_uuid();
      INSERT INTO app_user (id, status, created_at, disabled_at)
      VALUES (resolved_user_id, 'active', now_ts, NULL);

      INSERT INTO user_oidc_identity (id, user_id, issuer, subject, status, linked_at, revoked_at)
      VALUES (gen_random_uuid(), resolved_user_id, issuer_val, subject_val, 'active', now_ts, NULL);

      INSERT INTO pap_user_profile (user_id, display_name, email, created_at, updated_at)
      VALUES (resolved_user_id, display_name_val, email_val, now_ts, now_ts);
    ELSE
      INSERT INTO pap_user_profile (user_id, display_name, email, created_at, updated_at)
      VALUES (resolved_user_id, display_name_val, email_val, now_ts, now_ts)
      ON CONFLICT (user_id) DO UPDATE
        SET display_name = CASE
              WHEN NULLIF(btrim(cmd->>'displayName'), '') IS NOT NULL THEN EXCLUDED.display_name
              ELSE pap_user_profile.display_name
            END,
            email = CASE
              WHEN NULLIF(btrim(cmd->>'email'), '') IS NULL
                OR (
                  (
                    EXCLUDED.email LIKE '%.invalid'
                    OR EXCLUDED.email = 'uzytkownik@pap.example'
                    OR position('***@' IN EXCLUDED.email) > 0
                  )
                  AND pap_user_profile.email NOT LIKE '%.invalid'
                  AND pap_user_profile.email <> 'uzytkownik@pap.example'
                  AND position('***@' IN pap_user_profile.email) = 0
                )
              THEN pap_user_profile.email
              ELSE EXCLUDED.email
            END,
            updated_at = GREATEST(pap_user_profile.created_at, EXCLUDED.updated_at);
    END IF;

    member_until_ts := inviter_member_row.valid_until;
    needs_reactivation := false;
    existing_member_status := NULL;

    SELECT * INTO target_member_row
    FROM tenant_membership
    WHERE tenant_id = inv_row.tenant_id
      AND user_id = resolved_user_id
    FOR UPDATE;

    IF FOUND THEN
      IF target_member_row.status = 'active'
        AND target_member_row.valid_from <= eval_now_ts
        AND (target_member_row.valid_until IS NULL OR target_member_row.valid_until > eval_now_ts)
      THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'already_tenant_member');
      END IF;
      IF target_member_row.role <> inv_row.intended_role THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'membership_role_change_not_supported');
      END IF;
      needs_reactivation := true;
      existing_member_status := target_member_row.status;
    ELSE
      INSERT INTO tenant_membership (tenant_id, user_id, role, status, valid_from, valid_until)
      VALUES (inv_row.tenant_id, resolved_user_id, inv_row.intended_role, 'active', now_ts, member_until_ts);
    END IF;

    UPDATE pap_tenant_invitation
    SET status = 'accepted',
        accepted_at = now_ts,
        accepted_by_user_id = resolved_user_id
    WHERE id = inv_row.id
    RETURNING * INTO inv_row;

    SELECT COALESCE(p.display_name, 'Administrator organizacji')
    INTO inviter_display_val
    FROM app_user u
    LEFT JOIN pap_user_profile p ON p.user_id = u.id
    WHERE u.id = inv_row.invited_by_user_id;

    masked_email_val := left(
      CASE
        WHEN position('@' IN inv_row.invitee_email) <= 1 THEN '***@***'
        WHEN position('@' IN inv_row.invitee_email) - 1 <= 2
          THEN left(inv_row.invitee_email, 1) || '***@' || substring(inv_row.invitee_email FROM position('@' IN inv_row.invitee_email) + 1)
        ELSE
          left(inv_row.invitee_email, 2) || '***@' || substring(inv_row.invitee_email FROM position('@' IN inv_row.invitee_email) + 1)
      END,
      160
    );

    SELECT COALESCE(jsonb_agg(elem->>'legalEntityId'), '[]'::jsonb)
    INTO granted_company_ids_json
    FROM jsonb_array_elements(inv_row.initial_company_grants) elem;

    invitation_json := jsonb_build_object(
      'invitationId', inv_row.id,
      'tenantId', inv_row.tenant_id,
      'tenantName', tenant_row.name,
      'inviteeMaskedEmail', masked_email_val,
      'inviteeDisplayName', inv_row.invitee_display_name,
      'intendedRole', inv_row.intended_role,
      'initialCompanyGrants', inv_row.initial_company_grants,
      'status', 'accepted',
      'invitedByUserId', inv_row.invited_by_user_id,
      'invitedByDisplayName', inviter_display_val,
      'createdAt', to_char(inv_row.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'expiresAt', to_char(inv_row.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'acceptedAt', to_char(inv_row.accepted_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'acceptedByUserId', inv_row.accepted_by_user_id,
      'revokedAt', NULL,
      'rejectedAt', NULL
    );

    membership_json := jsonb_build_object(
      'tenantId', inv_row.tenant_id,
      'tenantName', tenant_row.name,
      'role', inv_row.intended_role,
      'status', 'active',
      'validFrom', to_char(now_ts, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'validUntil', CASE WHEN member_until_ts IS NULL THEN NULL ELSE to_char(member_until_ts, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
    );

    audit_event_id := gen_random_uuid();
    receipt_json := jsonb_build_object(
      'userId', resolved_user_id,
      'invitation', invitation_json,
      'membership', membership_json,
      'grantedCompanyIds', granted_company_ids_json
    );

    INSERT INTO pap_identity_lifecycle_event (
      id,
      operation_id,
      kind,
      actor_user_id,
      target_user_id,
      tenant_id,
      invitation_id,
      issuer,
      subject,
      reason,
      request_key,
      receipt,
      occurred_at
    ) VALUES (
      audit_event_id,
      op_id,
      'accept_invitation',
      resolved_user_id,
      resolved_user_id,
      inv_row.tenant_id,
      inv_row.id,
      issuer_val,
      subject_val,
      'Akceptacja zaproszenia do organizacji',
      canonical_req_json::text,
      receipt_json,
      now_ts
    );

    RETURN jsonb_build_object(
      'ok', true,
      'idempotentReplay', false,
      'userId', resolved_user_id,
      'invitation', invitation_json,
      'membership', membership_json,
      'grantedCompanyIds', granted_company_ids_json,
      'auditEventId', audit_event_id,
      'needsMembershipReactivation', needs_reactivation,
      'existingMembershipStatus', existing_member_status,
      'inviterUserId', inv_row.invited_by_user_id,
      'inviterRole', inviter_member_row.role,
      'inviterMembershipValidFrom', to_char(inviter_member_row.valid_from, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'inviterMembershipValidUntil', CASE WHEN inviter_member_row.valid_until IS NULL THEN NULL ELSE to_char(inviter_member_row.valid_until, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
      'initialCompanyGrants', inv_row.initial_company_grants
    );

  ELSIF op_kind = 'reject_invitation' THEN
    IF (cmd->>'operationId') IS NULL
      OR (cmd->>'tokenSha256') IS NULL
      OR (cmd->>'issuer') IS NULL
      OR (cmd->>'subject') IS NULL
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_invitation_input');
    END IF;

    op_id := (cmd->>'operationId')::uuid;
    token_hash_val := cmd->>'tokenSha256';
    issuer_val := btrim(cmd->>'issuer');
    subject_val := btrim(cmd->>'subject');
    reason_val := COALESCE(NULLIF(btrim(COALESCE(cmd->>'reason', '')), ''), 'Odrzucenie zaproszenia przez użytkownika');

    IF op_id IS NULL
      OR token_hash_val !~ '^[0-9a-f]{64}$'
      OR issuer_val = ''
      OR issuer_val IS DISTINCT FROM (cmd->>'issuer')
      OR char_length(issuer_val) > 512
      OR subject_val = ''
      OR subject_val IS DISTINCT FROM (cmd->>'subject')
      OR char_length(subject_val) > 256
      OR char_length(reason_val) < 3
      OR char_length(reason_val) > 400
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_invitation_input');
    END IF;

    SELECT * INTO ident_row
    FROM user_oidc_identity
    WHERE issuer = issuer_val
      AND subject = subject_val
    FOR UPDATE;

    IF FOUND THEN
      IF ident_row.status <> 'active' OR ident_row.revoked_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'identity_revoked');
      END IF;
      SELECT * INTO user_row
      FROM app_user
      WHERE id = ident_row.user_id
      FOR UPDATE;
      IF NOT FOUND OR user_row.status <> 'active' OR user_row.disabled_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'user_disabled');
      END IF;
      resolved_user_id := ident_row.user_id;
    ELSE
      resolved_user_id := NULL;
    END IF;

    IF (cmd->>'actorUserId') IS NOT NULL THEN
      actor_id_val := (cmd->>'actorUserId')::uuid;
      SELECT * INTO user_row FROM app_user WHERE id = actor_id_val FOR SHARE;
      IF NOT FOUND OR user_row.status <> 'active' OR user_row.disabled_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'user_disabled');
      END IF;
      IF resolved_user_id IS DISTINCT FROM actor_id_val THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_invitation_input');
      END IF;
    END IF;

    canonical_req_json := jsonb_build_object(
      'tokenSha256', token_hash_val,
      'issuer', issuer_val,
      'subject', subject_val,
      'reason', NULLIF(btrim(COALESCE(cmd->>'reason', '')), '')
    );

    SELECT * INTO prev_event
    FROM pap_identity_lifecycle_event
    WHERE operation_id = op_id;

    IF FOUND THEN
      IF prev_event.kind <> 'reject_invitation'
        OR prev_event.request_key::jsonb IS DISTINCT FROM canonical_req_json
      THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'operation_conflict');
      END IF;
      RETURN jsonb_build_object(
        'ok', true,
        'idempotentReplay', true,
        'userId', prev_event.receipt->>'userId',
        'invitation', prev_event.receipt->'invitation',
        'auditEventId', prev_event.id
      );
    END IF;

    SELECT * INTO inv_row
    FROM pap_tenant_invitation
    WHERE token_sha256 = token_hash_val
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invitation_not_found');
    END IF;
    IF inv_row.status = 'revoked' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invitation_revoked');
    END IF;
    IF inv_row.status = 'rejected' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invitation_rejected');
    END IF;
    IF inv_row.status = 'accepted' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invitation_already_used');
    END IF;
    IF inv_row.expires_at <= eval_now_ts THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invitation_expired');
    END IF;

    SELECT * INTO tenant_row FROM tenant WHERE id = inv_row.tenant_id FOR SHARE;

    UPDATE pap_tenant_invitation
    SET status = 'rejected',
        rejected_at = GREATEST(inv_row.created_at, now_ts),
        rejected_by_user_id = resolved_user_id
    WHERE id = inv_row.id
    RETURNING * INTO inv_row;

    SELECT COALESCE(p.display_name, 'Administrator organizacji')
    INTO inviter_display_val
    FROM app_user u
    LEFT JOIN pap_user_profile p ON p.user_id = u.id
    WHERE u.id = inv_row.invited_by_user_id;

    masked_email_val := left(
      CASE
        WHEN position('@' IN inv_row.invitee_email) <= 1 THEN '***@***'
        WHEN position('@' IN inv_row.invitee_email) - 1 <= 2
          THEN left(inv_row.invitee_email, 1) || '***@' || substring(inv_row.invitee_email FROM position('@' IN inv_row.invitee_email) + 1)
        ELSE
          left(inv_row.invitee_email, 2) || '***@' || substring(inv_row.invitee_email FROM position('@' IN inv_row.invitee_email) + 1)
      END,
      160
    );

    invitation_json := jsonb_build_object(
      'invitationId', inv_row.id,
      'tenantId', inv_row.tenant_id,
      'tenantName', tenant_row.name,
      'inviteeMaskedEmail', masked_email_val,
      'inviteeDisplayName', inv_row.invitee_display_name,
      'intendedRole', inv_row.intended_role,
      'initialCompanyGrants', inv_row.initial_company_grants,
      'status', 'rejected',
      'invitedByUserId', inv_row.invited_by_user_id,
      'invitedByDisplayName', inviter_display_val,
      'createdAt', to_char(inv_row.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'expiresAt', to_char(inv_row.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'acceptedAt', NULL,
      'acceptedByUserId', NULL,
      'revokedAt', NULL,
      'rejectedAt', to_char(inv_row.rejected_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );

    audit_event_id := gen_random_uuid();
    INSERT INTO pap_identity_lifecycle_event (
      id,
      operation_id,
      kind,
      actor_user_id,
      target_user_id,
      tenant_id,
      invitation_id,
      issuer,
      subject,
      reason,
      request_key,
      receipt,
      occurred_at
    ) VALUES (
      audit_event_id,
      op_id,
      'reject_invitation',
      resolved_user_id,
      resolved_user_id,
      inv_row.tenant_id,
      inv_row.id,
      issuer_val,
      subject_val,
      reason_val,
      canonical_req_json::text,
      jsonb_build_object(
        'userId', resolved_user_id,
        'invitation', invitation_json,
        'auditEventId', audit_event_id
      ),
      now_ts
    );

    RETURN jsonb_build_object(
      'ok', true,
      'idempotentReplay', false,
      'userId', resolved_user_id,
      'invitation', invitation_json,
      'auditEventId', audit_event_id
    );

  ELSIF op_kind = 'list_tenant_member_directory' THEN
    IF (cmd->>'actorUserId') IS NULL OR (cmd->>'tenantId') IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_identity_input');
    END IF;

    actor_id_val := (cmd->>'actorUserId')::uuid;
    scope_tenant_id := (cmd->>'tenantId')::uuid;
    IF actor_id_val IS NULL OR scope_tenant_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_identity_input');
    END IF;

    SELECT * INTO user_row FROM app_user WHERE id = actor_id_val;
    IF NOT FOUND OR user_row.status <> 'active' OR user_row.disabled_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'user_disabled');
    END IF;

    SELECT * INTO actor_member_row
    FROM tenant_membership
    WHERE tenant_id = scope_tenant_id
      AND user_id = actor_id_val;

    IF NOT FOUND
      OR actor_member_row.status <> 'active'
      OR actor_member_row.valid_from > eval_now_ts
      OR (actor_member_row.valid_until IS NOT NULL AND actor_member_row.valid_until <= eval_now_ts)
    THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'membership_inactive');
    END IF;

    IF actor_member_row.role NOT IN ('tenant_owner', 'tenant_admin') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'admin_role_required');
    END IF;

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'userId', m.user_id,
          'displayName', COALESCE(p.display_name, m.user_id::text),
          'maskedEmail', CASE
            WHEN p.email IS NULL OR position('@' IN p.email) <= 1 THEN 'u***@pap.example'
            ELSE lower(left(p.email, 1)) || '***@' || lower(substring(p.email FROM position('@' IN p.email) + 1))
          END,
          'userActive', (u.status = 'active' AND u.disabled_at IS NULL)
        )
        ORDER BY m.valid_from ASC, m.user_id ASC
      ),
      '[]'::jsonb
    )
    INTO memberships_json
    FROM tenant_membership m
    JOIN app_user u ON u.id = m.user_id
    LEFT JOIN pap_user_profile p ON p.user_id = m.user_id
    WHERE m.tenant_id = scope_tenant_id;

    RETURN jsonb_build_object(
      'ok', true,
      'tenantId', scope_tenant_id,
      'members', memberships_json
    );

  ELSE
    RAISE EXCEPTION 'Nieobsługiwana operacja cyklu życia tożsamości' USING ERRCODE = '42501';
  END IF;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN jsonb_build_object(
    'ok',
    false,
    'reason',
    CASE
      WHEN op_kind IN ('upsert_user_profile', 'get_actor_session_directory', 'provision_or_resolve_oidc_user', 'list_tenant_member_directory')
        THEN 'invalid_identity_input'
      WHEN op_kind IN ('create_invitation', 'list_tenant_invitations', 'revoke_invitation', 'accept_invitation', 'reject_invitation')
        THEN 'invalid_invitation_input'
      ELSE 'invalid_bootstrap_input'
    END
  );
END;
$fn$;

DO $$
DECLARE
  runtime_name text := current_setting('pap.provision_runtime_role');
  data_schema text := current_schema();
  t text;
  fn_sig text;
  column_record record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pap_oidc_auth_state',
    'pap_bff_session',
    'pap_user_profile',
    'pap_identity_lifecycle_event',
    'pap_tenant_invitation'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', data_schema, t);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', data_schema, t);
    EXECUTE format('DROP POLICY IF EXISTS pap_migrator ON %I.%I', data_schema, t);
    EXECUTE format(
      'CREATE POLICY pap_migrator ON %I.%I FOR ALL TO PUBLIC USING (current_user = %L) WITH CHECK (current_user = %L)',
      data_schema,
      t,
      current_user,
      current_user
    );
    EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM PUBLIC, %I', data_schema, t, runtime_name);
    FOR column_record IN
      SELECT a.attname
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relnamespace = data_schema::regnamespace
        AND c.relname = t
        AND a.attnum > 0
        AND NOT a.attisdropped
    LOOP
      EXECUTE format(
        'REVOKE ALL (%I) ON %I.%I FROM PUBLIC, %I',
        column_record.attname,
        data_schema,
        t,
        runtime_name
      );
    END LOOP;
  END LOOP;

  FOREACH fn_sig IN ARRAY ARRAY['pap_bff_session_op(jsonb)', 'pap_wave2_identity_op(jsonb)']
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%s SET search_path = pg_catalog, %I, pg_temp',
      data_schema,
      fn_sig,
      data_schema
    );
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%s FROM PUBLIC', data_schema, fn_sig);
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %I.%s TO %I',
      data_schema,
      fn_sig,
      runtime_name
    );
  END LOOP;
END;
$$;
`;

/** Jawna operacja administracyjna; nie jest wywoływana przy starcie ani migracji. */
export async function configureRuntimePrivileges(
  db: Pick<Database, 'transaction'>,
  runtimeRole: 'pap_local_app' | 'pap_test_app' | 'pap_staging_app',
): Promise<void> {
  const privileges = readFileSync(
    new URL('../sql/runtime-privileges.sql', import.meta.url),
    'utf8',
  );
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('pap.provision_runtime_role', ${runtimeRole}, true)`);
    await tx.execute(sql.raw(privileges));
    await tx.execute(sql.raw(WAVE2_BFF_SESSION_PROVISIONING_SQL));
  });
}

/** Klucz przekazany z chronionego kanału operatora, bez drukowania i bez generowania w migracji. */
export async function provisionDatabaseContextKey(
  db: Pick<Database, 'execute'>,
  input: { readonly keyId: string; readonly keyHex: string; readonly runtimeRole: string },
): Promise<void> {
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(input.keyId) || !/^[a-f0-9]{64}$/i.test(input.keyHex)) {
    throw new Error('Niepoprawna konfiguracja klucza kontekstu.');
  }
  try {
    await db.execute(sql`INSERT INTO security_context_key (key_id, secret_hex, runtime_role)
      VALUES (${input.keyId}, ${input.keyHex.toLowerCase()}, ${input.runtimeRole})`);
  } catch {
    // Błąd sterownika może zawierać parametry INSERT, w tym klucz.
    throw new Error('Nie udało się zapisać klucza kontekstu DB.');
  }
}

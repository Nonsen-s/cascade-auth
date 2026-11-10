REVOKE ALL ON SCHEMA accounts FROM PUBLIC;
-- statement-breakpoint
CREATE TABLE accounts.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  password_hash text NOT NULL CHECK (length(password_hash) BETWEEN 40 AND 1024),
  verified_at timestamptz,
  auth_version integer NOT NULL DEFAULT 1 CHECK (auth_version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
-- statement-breakpoint
CREATE TABLE accounts.sessions (
  digest text PRIMARY KEY CHECK (digest ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES accounts.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('access', 'recovery')),
  auth_version integer NOT NULL CHECK (auth_version > 0),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);
-- statement-breakpoint
CREATE INDEX sessions_user_idx ON accounts.sessions(user_id);
-- statement-breakpoint
CREATE INDEX sessions_expiry_idx ON accounts.sessions(expires_at);
-- statement-breakpoint
CREATE TABLE accounts.tokens (
  digest text PRIMARY KEY CHECK (digest ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES accounts.users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('email', 'recovery')),
  auth_version integer NOT NULL CHECK (auth_version > 0),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  UNIQUE(user_id, purpose)
);
-- statement-breakpoint
CREATE INDEX tokens_expiry_idx ON accounts.tokens(expires_at);
-- statement-breakpoint
CREATE TABLE accounts.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_digest text NOT NULL UNIQUE REFERENCES accounts.tokens(digest) ON DELETE CASCADE,
  ciphertext text NOT NULL CHECK (length(ciphertext) < 4096),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  lease_owner uuid,
  lease_expires_at timestamptz,
  failed boolean NOT NULL DEFAULT false,
  CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL))
);
-- statement-breakpoint
CREATE INDEX outbox_pending_idx ON accounts.email_outbox(available_at) WHERE NOT failed;
-- statement-breakpoint
CREATE TABLE accounts.rate_limits (
  key text PRIMARY KEY CHECK (key ~ '^[0-9a-f]{64}$'),
  hits integer NOT NULL CHECK (hits > 0),
  expires_at timestamptz NOT NULL
);
-- statement-breakpoint
CREATE INDEX rate_limit_expiry_idx ON accounts.rate_limits(expires_at);
-- statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA accounts FROM PUBLIC;

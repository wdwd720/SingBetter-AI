-- Platform hardening tables (Postgres)
CREATE TABLE IF NOT EXISTS user_settings (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'user',
  locale TEXT NOT NULL DEFAULT 'en',
  consent_version TEXT,
  consent_given_at TIMESTAMP,
  onboarding_completed_at TIMESTAMP,
  email_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  in_app_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS user_settings_user_id_idx ON user_settings(user_id);
CREATE INDEX IF NOT EXISTS user_settings_role_idx ON user_settings(role);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_at_idx ON password_reset_tokens(expires_at);

CREATE TABLE IF NOT EXISTS user_mfa_factors (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  secret TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  recovery_codes JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS user_mfa_factors_user_id_idx ON user_mfa_factors(user_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS analytics_events (
  id SERIAL PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  properties JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS analytics_events_user_id_idx ON analytics_events(user_id);
CREATE INDEX IF NOT EXISTS analytics_events_name_idx ON analytics_events(name);
CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx ON analytics_events(created_at);

CREATE TABLE IF NOT EXISTS feedback_reports (
  id SERIAL PRIMARY KEY,
  user_id TEXT,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS feedback_reports_user_id_idx ON feedback_reports(user_id);
CREATE INDEX IF NOT EXISTS feedback_reports_status_idx ON feedback_reports(status);

CREATE TABLE IF NOT EXISTS notification_items (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notification_items_user_id_idx ON notification_items(user_id);
CREATE INDEX IF NOT EXISTS notification_items_read_at_idx ON notification_items(read_at);
CREATE INDEX IF NOT EXISTS notification_items_created_at_idx ON notification_items(created_at);

CREATE TABLE IF NOT EXISTS privacy_requests (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  request_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  payload JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS privacy_requests_user_id_idx ON privacy_requests(user_id);
CREATE INDEX IF NOT EXISTS privacy_requests_type_idx ON privacy_requests(request_type);
CREATE INDEX IF NOT EXISTS privacy_requests_status_idx ON privacy_requests(status);

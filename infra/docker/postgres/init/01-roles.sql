-- DEV ONLY. Runs once, as the container superuser, when the postgres volume is first created.
-- Creates the four cluster roles ReMix expects (ADR 0005) and the `remix` database owned by
-- remix_owner. Tables, RLS and grants come from the migrations (pnpm --filter @remix/db migrate).
-- Passwords are obviously-dev values; production roles are created by the operator with real
-- secrets (packages/db/README.md → "Production roles").

CREATE ROLE remix_owner LOGIN PASSWORD 'remix_owner_dev_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
CREATE ROLE remix_app LOGIN PASSWORD 'remix_app_dev_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
CREATE ROLE remix_platform LOGIN PASSWORD 'remix_platform_dev_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
CREATE ROLE remix_readonly LOGIN PASSWORD 'remix_readonly_dev_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;

-- ADR 0007: the API's roles work in UTC; business dates use tenants.timezone explicitly.
ALTER ROLE remix_owner SET timezone = 'UTC';
ALTER ROLE remix_app SET timezone = 'UTC';
ALTER ROLE remix_platform SET timezone = 'UTC';
ALTER ROLE remix_readonly SET timezone = 'UTC';

CREATE DATABASE remix OWNER remix_owner;

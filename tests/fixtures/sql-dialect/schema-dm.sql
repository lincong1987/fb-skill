-- Minimal synthetic dialect fixture for release validation (DM8 variant).
-- Only synthetic tables with fbx_validation_* names; no business DDL, no credentials.
-- Status: PREPARED-BUT-NOT-EXECUTED. DM execution is blocked for this validation
-- slice because no loopback-only listening could be confirmed for the local DM
-- install (no bind-address style dm.ini parameter, no dmserver option, no
-- pre-existing DM docker image); a loopback-only instance is a hard requirement.
-- Kept as accurate prepared material for a later approved environment.
CREATE TABLE fbx_validation_device (
  id BIGINT IDENTITY(1,1) NOT NULL,
  device_code VARCHAR(64) NOT NULL,
  device_name VARCHAR(128) NOT NULL,
  status CHAR(1) DEFAULT '0' NOT NULL,
  score DECIMAL(8,2) NULL,
  alt_code VARCHAR(32) NULL,
  created_at DATETIME NOT NULL,
  updated_at TIMESTAMP(3) NULL,
  occurred_on DATE NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_fbx_device_code UNIQUE (device_code),
  CONSTRAINT uq_fbx_device_alt UNIQUE (alt_code)
);

CREATE INDEX idx_fbx_device_status ON fbx_validation_device (status);

CREATE TABLE fbx_validation_event (
  id BIGINT IDENTITY(1,1) NOT NULL,
  device_id BIGINT NOT NULL,
  amount DECIMAL(12,2) DEFAULT 0.00 NOT NULL,
  happened_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_fbx_event UNIQUE (device_id, happened_at)
);

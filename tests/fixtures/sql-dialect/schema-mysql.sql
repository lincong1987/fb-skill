-- Minimal synthetic dialect fixture for release validation.
-- Only synthetic tables with fb_validation_* names; no business DDL, no credentials.
-- Target: real MySQL 5.7 (verified 5.7.26 local binary), loopback 127.0.0.1:18735.
CREATE TABLE IF NOT EXISTS fbx_validation_device (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_code VARCHAR(64) NOT NULL,
  device_name VARCHAR(128) NOT NULL,
  status CHAR(1) NOT NULL DEFAULT '0',
  score DECIMAL(8,2) NULL,
  alt_code VARCHAR(32) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME(3) NULL,
  occurred_on DATE NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_fbx_device_code UNIQUE (device_code),
  CONSTRAINT uq_fbx_device_alt UNIQUE (alt_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fbx_validation_event (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id BIGINT UNSIGNED NOT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  happened_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_fbx_event UNIQUE (device_id, happened_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

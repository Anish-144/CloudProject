-- CloudGuard Migration: Add cloud_resources table for FinOps resource monitoring
-- Run this on an existing database that was initialized before this table was added.

CREATE TABLE IF NOT EXISTS cloud_resources (
    resource_id      VARCHAR(255) PRIMARY KEY,
    type             VARCHAR(20)  NOT NULL CHECK (type IN ('ec2', 's3', 'lambda')),
    name             VARCHAR(255),
    state            VARCHAR(50)  NOT NULL DEFAULT 'unknown',
    region           VARCHAR(50),
    cpu              FLOAT,
    size_mb          FLOAT,
    last_activity    TIMESTAMPTZ,
    estimated_cost   FLOAT        DEFAULT 0,
    idle             BOOLEAN      NOT NULL DEFAULT FALSE,
    recommendation   TEXT,
    iam_user         VARCHAR(100),
    ownership_source VARCHAR(50)  DEFAULT 'credentials',
    last_updated     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cloud_resources_type     ON cloud_resources(type);
CREATE INDEX IF NOT EXISTS idx_cloud_resources_idle     ON cloud_resources(idle);
CREATE INDEX IF NOT EXISTS idx_cloud_resources_iam_user ON cloud_resources(iam_user);
CREATE INDEX IF NOT EXISTS idx_cloud_resources_updated  ON cloud_resources(last_updated);

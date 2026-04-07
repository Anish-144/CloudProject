-- CloudGuard Database Initialization
-- PostgreSQL Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'viewer',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- ROLE MIGRATION (idempotent)
-- Updates CHECK constraint to include new roles, migrates legacy roles
-- ============================================
DO $$
BEGIN
    -- Drop old check constraint (PostgreSQL auto-names it tablename_columnname_check)
    BEGIN
        ALTER TABLE users DROP CONSTRAINT users_role_check;
    EXCEPTION WHEN undefined_object THEN
        NULL;
    END;

    -- Add updated constraint with all valid roles
    BEGIN
        ALTER TABLE users ADD CONSTRAINT users_role_check
            CHECK (role IN (
                'admin',
                'cloud_admin',
                'finops_manager',
                'compliance_manager',
                'compliance_officer',
                'it_admin',
                'viewer'
            ));
    EXCEPTION WHEN duplicate_object THEN
        NULL;
    END;

    -- Migrate compliance_officer → compliance_manager
    UPDATE users SET role = 'compliance_manager' WHERE role = 'compliance_officer';

EXCEPTION WHEN others THEN
    RAISE NOTICE 'Role migration skipped: %', SQLERRM;
END $$;

-- ============================================
-- RESOURCES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS resources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cloud_provider VARCHAR(50) NOT NULL CHECK (cloud_provider IN ('aws', 'azure', 'gcp')),
    resource_type VARCHAR(100) NOT NULL,
    region VARCHAR(100) NOT NULL,
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    tags JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resources_owner ON resources(owner_id);
CREATE INDEX IF NOT EXISTS idx_resources_provider ON resources(cloud_provider);

-- ============================================
-- USAGE LOGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS usage_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    cpu_usage FLOAT NOT NULL CHECK (cpu_usage >= 0 AND cpu_usage <= 100),
    memory_usage FLOAT NOT NULL CHECK (memory_usage >= 0 AND memory_usage <= 100),
    cost FLOAT NOT NULL CHECK (cost >= 0),
    network_in_gb FLOAT DEFAULT 0,
    network_out_gb FLOAT DEFAULT 0,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_resource_id ON usage_logs(resource_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_timestamp ON usage_logs(timestamp);

-- ============================================
-- COMPLIANCE RULES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS compliance_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    weight INTEGER NOT NULL DEFAULT 10 CHECK (weight > 0),
    condition_json JSONB NOT NULL,
    category VARCHAR(100) DEFAULT 'general',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- VIOLATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS violations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    rule_id UUID NOT NULL REFERENCES compliance_rules(id) ON DELETE CASCADE,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_violations_resource_id ON violations(resource_id);
CREATE INDEX IF NOT EXISTS idx_violations_severity ON violations(severity);
CREATE INDEX IF NOT EXISTS idx_violations_status ON violations(status);
CREATE INDEX IF NOT EXISTS idx_violations_created_at ON violations(created_at);

-- ============================================
-- ALERTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL CHECK (type IN ('finops', 'compliance', 'combined')),
    source_id UUID,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    message TEXT NOT NULL,
    details JSONB DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved')),
    priority FLOAT DEFAULT 0,
    dedupe_key VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_dedupe_key ON alerts(dedupe_key) WHERE dedupe_key IS NOT NULL;

-- ============================================
-- RESOURCE METRICS CACHE TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS resource_metrics (
    resource_id UUID PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
    avg_cpu_7d FLOAT DEFAULT 0,
    avg_cpu_30d FLOAT DEFAULT 0,
    avg_cost_30d FLOAT DEFAULT 0,
    avg_cost_prev_30d FLOAT DEFAULT 0,
    total_cost_30d FLOAT DEFAULT 0,
    peak_cpu FLOAT DEFAULT 0,
    peak_memory FLOAT DEFAULT 0,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resource_metrics_updated ON resource_metrics(last_updated);

-- ============================================
-- SEED: ALL ROLE USERS
-- Password for all: admin123 (bcrypt hashed)
-- ============================================
INSERT INTO users (email, password_hash, role) VALUES
    ('admin@test.com',           '$2b$12$lwxXKkvHh5xlSR.TfLRlU.RS4rdg2wfYdjZ44V48pLrMs5gTz5lZW', 'admin'),
    ('admin@cloudguard.io',      '$2b$12$lwxXKkvHh5xlSR.TfLRlU.RS4rdg2wfYdjZ44V48pLrMs5gTz5lZW', 'cloud_admin'),
    ('finops@cloudguard.io',     '$2b$12$lwxXKkvHh5xlSR.TfLRlU.RS4rdg2wfYdjZ44V48pLrMs5gTz5lZW', 'finops_manager'),
    ('compliance@cloudguard.io', '$2b$12$lwxXKkvHh5xlSR.TfLRlU.RS4rdg2wfYdjZ44V48pLrMs5gTz5lZW', 'compliance_manager'),
    ('itadmin@cloudguard.io',    '$2b$12$lwxXKkvHh5xlSR.TfLRlU.RS4rdg2wfYdjZ44V48pLrMs5gTz5lZW', 'it_admin'),
    ('viewer@cloudguard.io',     '$2b$12$lwxXKkvHh5xlSR.TfLRlU.RS4rdg2wfYdjZ44V48pLrMs5gTz5lZW', 'viewer')
ON CONFLICT (email) DO UPDATE SET
    role = EXCLUDED.role,
    password_hash = EXCLUDED.password_hash;

-- ============================================
-- SEED: DEFAULT COMPLIANCE RULES
-- ============================================
INSERT INTO compliance_rules (name, description, weight, condition_json, category) VALUES
    (
        'No Public S3 Buckets',
        'S3 buckets must not have public access enabled',
        15,
        '{"field": "public_access", "operator": "equals", "value": false}',
        'data_protection'
    ),
    (
        'Encryption at Rest Required',
        'All storage resources must have encryption at rest enabled',
        20,
        '{"field": "encryption_at_rest", "operator": "equals", "value": true}',
        'data_protection'
    ),
    (
        'MFA Required for IAM',
        'All IAM users must have MFA enabled',
        25,
        '{"field": "mfa_enabled", "operator": "equals", "value": true}',
        'access_control'
    ),
    (
        'No Root Account Usage',
        'Root account should not be used for day-to-day operations',
        30,
        '{"field": "is_root_account", "operator": "equals", "value": false}',
        'access_control'
    ),
    (
        'Logging Enabled',
        'Resource access logging must be enabled',
        10,
        '{"field": "logging_enabled", "operator": "equals", "value": true}',
        'audit'
    ),
    (
        'Network Isolation Required',
        'Resources should be deployed in private subnets',
        15,
        '{"field": "in_private_subnet", "operator": "equals", "value": true}',
        'network'
    ),
    (
        'Cost Anomaly Threshold',
        'Daily cost must not exceed threshold',
        10,
        '{"field": "daily_cost", "operator": "less_than", "value": 1000}',
        'cost'
    ),
    (
        'CPU Utilization Reasonable',
        'Average CPU should be between 5% and 90% for healthy operation',
        5,
        '{"field": "cpu_usage", "operator": "greater_than", "value": 5}',
        'performance'
    )
ON CONFLICT DO NOTHING;

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
    aws_account_id UUID, -- Foreign key managed manually or via later constraint
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- AWS ACCOUNTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS aws_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    aws_account_id VARCHAR(12) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add foreign key constraints separately for safety
ALTER TABLE users ADD CONSTRAINT fk_user_account FOREIGN KEY (aws_account_id) REFERENCES aws_accounts(id) ON DELETE SET NULL;


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
    aws_account_id UUID REFERENCES aws_accounts(id) ON DELETE SET NULL,
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
-- SEED: AWS ACCOUNTS
-- ============================================
INSERT INTO aws_accounts (id, name, aws_account_id) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'Alpha Cluster', '123456789012'),
    ('b0000000-0000-0000-0000-000000000002', 'Beta Production', '987654321098')
ON CONFLICT (aws_account_id) DO NOTHING;

-- ============================================
-- SEED: ALL ROLE USERS
-- Password for all: admin123 (bcrypt hashed)
-- ============================================
INSERT INTO users (email, password_hash, role, aws_account_id) VALUES
    ('admin@test.com',           '$2b$12$lwxXKkvHh5xlSR.TfLRlU.RS4rdg2wfYdjZ44V48pLrMs5gTz5lZW', 'admin', 'a0000000-0000-0000-0000-000000000001'),
    ('admin@cloudguard.io',      '$2b$12$lwxXKkvHh5xlSR.TfLRlU.RS4rdg2wfYdjZ44V48pLrMs5gTz5lZW', 'cloud_admin', 'a0000000-0000-0000-0000-000000000001'),
    ('finops@cloudguard.io',     '$2b$12$lwxXKkvHh5xlSR.TfLRlU.RS4rdg2wfYdjZ44V48pLrMs5gTz5lZW', 'finops_manager', 'a0000000-0000-0000-0000-000000000001'),
    ('compliance@cloudguard.io', '$2b$12$lwxXKkvHh5xlSR.TfLRlU.RS4rdg2wfYdjZ44V48pLrMs5gTz5lZW', 'compliance_manager', 'b0000000-0000-0000-0000-000000000002'),
    ('itadmin@cloudguard.io',    '$2b$12$lwxXKkvHh5xlSR.TfLRlU.RS4rdg2wfYdjZ44V48pLrMs5gTz5lZW', 'it_admin', 'b0000000-0000-0000-0000-000000000002'),
    ('viewer@cloudguard.io',     '$2b$12$lwxXKkvHh5xlSR.TfLRlU.RS4rdg2wfYdjZ44V48pLrMs5gTz5lZW', 'viewer', 'b0000000-0000-0000-0000-000000000002')
ON CONFLICT (email) DO UPDATE SET
    role = EXCLUDED.role,
    password_hash = EXCLUDED.password_hash,
    aws_account_id = EXCLUDED.aws_account_id;

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
<<<<<<< HEAD

-- ============================================
-- AWS RESOURCES TABLE (Boto3 Integration)
-- ============================================
CREATE TABLE IF NOT EXISTS aws_resources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    aws_resource_id VARCHAR(255) UNIQUE NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    cloud_provider VARCHAR(10) DEFAULT 'aws',
    region VARCHAR(50),
    metadata JSONB DEFAULT '{}',
    status VARCHAR(50),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resource_id UUID REFERENCES resources(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_aws_resources_type ON aws_resources(resource_type);
CREATE INDEX IF NOT EXISTS idx_aws_resources_aws_id ON aws_resources(aws_resource_id);
CREATE INDEX IF NOT EXISTS idx_aws_resources_last_seen ON aws_resources(last_seen);

-- ============================================
-- AWS METRICS TABLE (CloudWatch data)
-- ============================================
CREATE TABLE IF NOT EXISTS aws_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    aws_resource_id VARCHAR(255) NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    metric_value FLOAT NOT NULL,
    unit VARCHAR(50),
    period_seconds INT DEFAULT 300,
    timestamp TIMESTAMPTZ NOT NULL,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(aws_resource_id, metric_name, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_aws_metrics_resource ON aws_metrics(aws_resource_id);
CREATE INDEX IF NOT EXISTS idx_aws_metrics_timestamp ON aws_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_aws_metrics_name ON aws_metrics(metric_name);

-- ============================================
-- AWS COMPLIANCE CHECKS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS aws_compliance_checks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    aws_resource_id VARCHAR(255) NOT NULL,
    check_type VARCHAR(100) NOT NULL,
    check_passed BOOLEAN NOT NULL,
    details JSONB DEFAULT '{}',
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_checks_resource ON aws_compliance_checks(aws_resource_id);
CREATE INDEX IF NOT EXISTS idx_compliance_checks_passed ON aws_compliance_checks(check_passed);

-- ============================================
-- EXTEND EXISTING TABLES (data_source tag)
-- ============================================
DO $$
BEGIN
    BEGIN
        ALTER TABLE resources ADD COLUMN aws_resource_id VARCHAR(255);
    EXCEPTION WHEN duplicate_column THEN NULL;
    END;
    BEGIN
        ALTER TABLE resources ADD COLUMN data_source VARCHAR(20) DEFAULT 'simulated';
    EXCEPTION WHEN duplicate_column THEN NULL;
    END;
    BEGIN
        ALTER TABLE usage_logs ADD COLUMN data_source VARCHAR(20) DEFAULT 'simulated';
    EXCEPTION WHEN duplicate_column THEN NULL;
    END;
END $$;

-- ============================================
-- AWS ACCOUNTS TABLE (STS Multi-Account)
-- Stores Role ARN only — NEVER stores access keys
-- ============================================
CREATE TABLE IF NOT EXISTS aws_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_name VARCHAR(255) NOT NULL,
    account_id VARCHAR(12) NOT NULL,
    role_arn VARCHAR(255) NOT NULL,
    external_id VARCHAR(255),
    regions TEXT[] DEFAULT '{us-east-1}',
    is_active BOOLEAN DEFAULT TRUE,
    last_scanned TIMESTAMPTZ,
    scan_status VARCHAR(20) DEFAULT 'pending'
        CHECK (scan_status IN ('pending', 'scanning', 'success', 'failed')),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aws_accounts_active ON aws_accounts(is_active);
CREATE INDEX IF NOT EXISTS idx_aws_accounts_status ON aws_accounts(scan_status);

-- Add account linkage to aws_resources
DO $$
BEGIN
    BEGIN
        ALTER TABLE aws_resources ADD COLUMN account_id UUID REFERENCES aws_accounts(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END;
END $$;

CREATE INDEX IF NOT EXISTS idx_aws_resources_account ON aws_resources(account_id);

-- ============================================
-- SEED: Default AWS Account (current setup)
-- Uses the same account that was configured via .env
-- Role ARN must be updated after creating the IAM role
-- ============================================
INSERT INTO aws_accounts (account_name, account_id, role_arn, regions) VALUES
    ('Primary Account', '310997740799', 'arn:aws:iam::310997740799:role/CloudGuardReadOnlyRole', '{ap-south-1, eu-north-1}')
ON CONFLICT DO NOTHING;

-- ============================================
-- INCOMING LOGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS incoming_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    log_data JSONB NOT NULL,
    processed_finops BOOLEAN DEFAULT FALSE,
    processed_compliance BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incoming_logs_finops ON incoming_logs(processed_finops) WHERE processed_finops = false;
CREATE INDEX IF NOT EXISTS idx_incoming_logs_compliance ON incoming_logs(processed_compliance) WHERE processed_compliance = false;

-- ============================================
-- USER ACTIVITY LOGS TABLE (Normalized IAM events)
-- ============================================
CREATE TABLE IF NOT EXISTS user_activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    iam_user VARCHAR(255) NOT NULL,
    service VARCHAR(100) NOT NULL,
    action VARCHAR(255) NOT NULL,
    resource_id VARCHAR(255),
    source_ip VARCHAR(45),
    region VARCHAR(50),
    details JSONB DEFAULT '{}',
    event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(iam_user, service, action, resource_id, event_time)
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user ON user_activity_logs(iam_user);
CREATE INDEX IF NOT EXISTS idx_user_activity_service ON user_activity_logs(service);
CREATE INDEX IF NOT EXISTS idx_user_activity_time ON user_activity_logs(event_time);

-- ============================================
-- THRESHOLDS TABLE (IT Admin budget/spike rules)
-- ============================================
CREATE TABLE IF NOT EXISTS thresholds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL CHECK (type IN ('budget', 'cost_spike', 'cpu_usage', 'custom')),
    metric VARCHAR(100) NOT NULL DEFAULT 'total_cost',
    value FLOAT NOT NULL CHECK (value >= 0),
    iam_user VARCHAR(255),
    description TEXT,
    active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thresholds_type ON thresholds(type);
CREATE INDEX IF NOT EXISTS idx_thresholds_user ON thresholds(iam_user);
CREATE INDEX IF NOT EXISTS idx_thresholds_active ON thresholds(active) WHERE active = true;

-- ============================================
-- SEED: Default Thresholds
-- ============================================
INSERT INTO thresholds (type, metric, value, description) VALUES
    ('budget', 'total_cost', 1000, 'Global monthly budget limit ($1000)'),
    ('cost_spike', 'cost_change_pct', 20, 'Alert on >20% cost increase month-over-month'),
    ('cpu_usage', 'avg_cpu', 5, 'Alert when avg CPU < 5% (idle resource)')
ON CONFLICT DO NOTHING;

-- ============================================
-- ADD target_roles TO ALERTS (role-based routing)
-- ============================================
DO $$
BEGIN
    BEGIN
        ALTER TABLE alerts ADD COLUMN target_roles TEXT[] DEFAULT '{}';
    EXCEPTION WHEN duplicate_column THEN NULL;
    END;
    BEGIN
        ALTER TABLE alerts ADD COLUMN iam_user VARCHAR(255);
    EXCEPTION WHEN duplicate_column THEN NULL;
    END;
END $$;

CREATE INDEX IF NOT EXISTS idx_alerts_target_roles ON alerts USING GIN(target_roles);
CREATE INDEX IF NOT EXISTS idx_alerts_iam_user ON alerts(iam_user);

-- ============================================
-- CLOUD RESOURCES TABLE (Unified FinOps view)
-- Populated by cloud_collector with idle flags
-- and FinOps recommendations per resource.
-- ============================================
CREATE TABLE IF NOT EXISTS cloud_resources (
    resource_id      VARCHAR(255) PRIMARY KEY,
    type             VARCHAR(20)  NOT NULL CHECK (type IN ('ec2', 's3', 'lambda', 'iam')),
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
    last_seen        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_updated     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    account_name     VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_cloud_resources_type     ON cloud_resources(type);
CREATE INDEX IF NOT EXISTS idx_cloud_resources_idle     ON cloud_resources(idle);
CREATE INDEX IF NOT EXISTS idx_cloud_resources_iam_user ON cloud_resources(iam_user);
CREATE INDEX IF NOT EXISTS idx_cloud_resources_updated  ON cloud_resources(last_updated);
CREATE INDEX IF NOT EXISTS idx_cloud_resources_account  ON cloud_resources(account_name);

-- ============================================
-- MIGRATIONS: cloud_resources
-- ============================================
DO $$
BEGIN
    BEGIN
        ALTER TABLE cloud_resources ADD COLUMN account_name VARCHAR(255);
    EXCEPTION WHEN duplicate_column THEN NULL;
    END;
END $$;

=======
>>>>>>> f79aacfd0bc790d68202603431c151319038c798

-- 1. Correct existing tables
ALTER TABLE resources ADD COLUMN IF NOT EXISTS aws_resource_id VARCHAR(255);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS data_source VARCHAR(50) DEFAULT 'simulated';
CREATE UNIQUE INDEX IF NOT EXISTS idx_resources_aws_id ON resources(aws_resource_id) WHERE aws_resource_id IS NOT NULL;

ALTER TABLE aws_accounts ADD COLUMN IF NOT EXISTS account_name VARCHAR(255);
UPDATE aws_accounts SET account_name = name WHERE account_name IS NULL;

-- ============================================
-- 1. UPDATE AWS_ACCOUNTS SCHEMA
-- ============================================
ALTER TABLE aws_accounts ADD COLUMN IF NOT EXISTS scan_status VARCHAR(50) DEFAULT 'pending';
ALTER TABLE aws_accounts ADD COLUMN IF NOT EXISTS last_scanned TIMESTAMPTZ;
ALTER TABLE aws_accounts ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE aws_accounts ADD COLUMN IF NOT EXISTS role_arn VARCHAR(255);
ALTER TABLE aws_accounts ADD COLUMN IF NOT EXISTS external_id VARCHAR(255);
ALTER TABLE aws_accounts ADD COLUMN IF NOT EXISTS regions JSONB DEFAULT '[]';
ALTER TABLE aws_accounts ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- ============================================
-- 2. CREATE COLLECTOR TABLES
-- ============================================

-- aws_resources: Detailed Boto3 sync data
CREATE TABLE IF NOT EXISTS aws_resources (
    aws_resource_id VARCHAR(255) PRIMARY KEY,
    resource_id UUID REFERENCES resources(id) ON DELETE SET NULL,
    resource_type VARCHAR(100) NOT NULL,
    region VARCHAR(100) NOT NULL,
    metadata JSONB DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'unknown',
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    account_id UUID REFERENCES aws_accounts(id) ON DELETE SET NULL
);

-- cloud_resources: Unified table for FinOps/Admin dashboards
CREATE TABLE IF NOT EXISTS cloud_resources (
    resource_id VARCHAR(255) PRIMARY KEY,
    type VARCHAR(100) NOT NULL,
    name VARCHAR(255),
    state VARCHAR(50),
    region VARCHAR(100),
    cpu FLOAT,
    size_mb FLOAT,
    last_activity TIMESTAMPTZ,
    estimated_cost FLOAT DEFAULT 0.0,
    idle BOOLEAN DEFAULT false,
    recommendation TEXT,
    iam_user VARCHAR(255) DEFAULT 'unknown',
    ownership_source VARCHAR(50) DEFAULT 'credentials',
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- incoming_logs: Raw log buffer for ingestion engine
CREATE TABLE IF NOT EXISTS incoming_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    log_data JSONB NOT NULL,
    processed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- aws_metrics: History of resource metrics (CPU, etc)
CREATE TABLE IF NOT EXISTS aws_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    aws_resource_id VARCHAR(255) NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    metric_value FLOAT NOT NULL,
    unit VARCHAR(50),
    timestamp TIMESTAMPTZ NOT NULL,
    UNIQUE (aws_resource_id, metric_name, timestamp)
);

-- aws_compliance_checks: History of compliance scans
CREATE TABLE IF NOT EXISTS aws_compliance_checks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    aws_resource_id VARCHAR(255) NOT NULL,
    check_type VARCHAR(100) NOT NULL,
    check_passed BOOLEAN NOT NULL,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 3. CREATE RAW ANALYTICS TABLES (for Clear Data)
-- ============================================

CREATE TABLE IF NOT EXISTS raw_finops_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw_compliance_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    log_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw_infrastructure_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    alert_info JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_aws_metrics_res_time ON aws_metrics(aws_resource_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_cloud_resources_type ON cloud_resources(type);
CREATE INDEX IF NOT EXISTS idx_cloud_resources_idle ON cloud_resources(idle) WHERE idle = true;

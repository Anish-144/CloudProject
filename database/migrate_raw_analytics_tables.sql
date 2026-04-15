-- CloudGuard Migration: Create raw data and analytics tables for governance
-- Separates raw logs from analytics data to enable selective cleanup

-- ============================================
-- RAW DATA TABLES (can be purged)
-- ============================================

-- Raw FinOps Events - logs every cost change and resource activity
CREATE TABLE IF NOT EXISTS raw_finops_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('cost_change', 'usage_spike', 'idle_detected', 'resource_created', 'resource_modified')),
    cost_delta FLOAT NOT NULL DEFAULT 0,
    cpu_usage FLOAT,
    memory_usage FLOAT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    INDEX idx_raw_finops_resource_id (resource_id),
    INDEX idx_raw_finops_created_at (created_at)
);

-- Raw Compliance Logs - detailed compliance check records
CREATE TABLE IF NOT EXISTS raw_compliance_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_id UUID NOT NULL,
    resource_id VARCHAR(255) NOT NULL,
    check_type VARCHAR(100) NOT NULL,
    passed BOOLEAN NOT NULL,
    evidence JSONB DEFAULT '{}',
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    INDEX idx_raw_compliance_rule_id (rule_id),
    INDEX idx_raw_compliance_resource_id (resource_id),
    INDEX idx_raw_compliance_created_at (created_at)
);

-- Raw Infrastructure Alerts - raw monitoring alerts
CREATE TABLE IF NOT EXISTS raw_infrastructure_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_id VARCHAR(255) NOT NULL,
    alert_type VARCHAR(100) NOT NULL CHECK (alert_type IN ('cpu_high', 'memory_high', 'disk_full', 'network_issue', 'health_check_failed')),
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    message TEXT NOT NULL,
    threshold_value FLOAT,
    current_value FLOAT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    INDEX idx_raw_infra_resource_id (resource_id),
    INDEX idx_raw_infra_severity (severity),
    INDEX idx_raw_infra_created_at (created_at)
);


-- ============================================
-- ANALYTICS TABLES (preserved on cleanup)
-- ============================================

-- Analytics: Cost trends aggregated daily
CREATE TABLE IF NOT EXISTS analytics_cost_trends (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL,
    total_cost FLOAT NOT NULL DEFAULT 0,
    avg_daily_increase FLOAT DEFAULT 0,
    resource_count INT DEFAULT 0,
    idle_resource_count INT DEFAULT 0,
    cost_spike_count INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(date),
    INDEX idx_analytics_cost_date (date)
);

-- Analytics: Compliance violation summary aggregated daily
CREATE TABLE IF NOT EXISTS analytics_violation_summary (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL,
    total_violations INT DEFAULT 0,
    critical_count INT DEFAULT 0,
    high_count INT DEFAULT 0,
    medium_count INT DEFAULT 0,
    low_count INT DEFAULT 0,
    compliance_score FLOAT DEFAULT 0,
    by_category JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(date),
    INDEX idx_analytics_violation_date (date)
);

-- Analytics: Infrastructure resource metrics aggregated hourly
CREATE TABLE IF NOT EXISTS analytics_resource_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_id VARCHAR(255) NOT NULL,
    metric_hour TIMESTAMPTZ NOT NULL,
    avg_cpu_usage FLOAT DEFAULT 0,
    peak_cpu_usage FLOAT DEFAULT 0,
    avg_memory_usage FLOAT DEFAULT 0,
    peak_memory_usage FLOAT DEFAULT 0,
    alert_count INT DEFAULT 0,
    uptime_percentage FLOAT DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    INDEX idx_analytics_metrics_resource (resource_id),
    INDEX idx_analytics_metrics_hour (metric_hour)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_raw_finops_events_resource_created ON raw_finops_events(resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_compliance_logs_resource_created ON raw_compliance_logs(resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_infra_alerts_resource_created ON raw_infrastructure_alerts(resource_id, created_at DESC);

-- Migration: Add missing last_seen column to cloud_resources
-- This column is required by the latest cloud_collector service

DO $$
BEGIN
    BEGIN
        ALTER TABLE cloud_resources ADD COLUMN last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW();
    EXCEPTION WHEN duplicate_column THEN
        NULL;
    END;
END $$;

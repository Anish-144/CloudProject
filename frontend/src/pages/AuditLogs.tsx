import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Shield, Calendar, User, Filter } from 'lucide-react';

const API_BASE = 'http://localhost:8000/api/v1';

const fetchAlerts = (limit = 200) => axios.get(`${API_BASE}/alerts?limit=${limit}`).then(r => r.data);

const Spinner = () => (
  <div className="flex justify-center items-center py-16">
    <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-brand" />
  </div>
);

const SeverityBadge = ({ severity }: { severity: string }) => {
  const s: Record<string, string> = {
    critical: 'bg-red-500/20 text-red-400 border-red-500/40',
    high:     'bg-orange-500/20 text-orange-400 border-orange-500/40',
    medium:   'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
    low:      'bg-gray-500/20 text-gray-400 border-gray-500/40',
  };
  return <span className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${s[severity] ?? s.low}`}>{severity}</span>;
};

export const AuditLogs = () => {
  const { data: alerts, isLoading } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => fetchAlerts(200)
  });

  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Get unique values for filters
  const types = useMemo(() => {
    return [...new Set((alerts ?? []).map((a: any) => a.type))] as string[];
  }, [alerts]);

  const severities = useMemo(() => {
    return [...new Set((alerts ?? []).map((a: any) => a.severity))] as string[];
  }, [alerts]);

  // Filter alerts
  const filteredAlerts = useMemo(() => {
    return (alerts ?? []).filter((a: any) => {
      if (filterSeverity && a.severity !== filterSeverity) return false;
      if (filterStatus && a.status !== filterStatus) return false;
      if (filterType && a.type !== filterType) return false;
      
      if (startDate) {
        const alertDate = new Date(a.created_at);
        if (alertDate < new Date(startDate)) return false;
      }
      
      if (endDate) {
        const alertDate = new Date(a.created_at);
        const end = new Date(endDate);
        end.setHours(23, 59, 59);
        if (alertDate > end) return false;
      }
      
      return true;
    });
  }, [alerts, filterSeverity, filterStatus, filterType, startDate, endDate]);

  const resetFilters = () => {
    setFilterSeverity('');
    setFilterStatus('');
    setFilterType('');
    setStartDate('');
    setEndDate('');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-1 flex items-center gap-3">
            <Shield size={32} className="text-purple-400" /> Audit Logs
          </h1>
          <p className="text-gray-400 text-sm">System activity and event tracking</p>
        </div>
        <span className="text-sm bg-purple-500/20 text-purple-400 border border-purple-500/30 px-4 py-2 rounded-full font-semibold">
          {filteredAlerts.length} Events
        </span>
      </div>

      {/* Filters */}
      <div className="glass-panel rounded-2xl p-6 border border-dark-700">
        <div className="flex items-center gap-2 mb-6">
          <Filter size={18} className="text-brand" />
          <span className="font-semibold text-sm">Filter Results</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-wider mb-2">Event Type</label>
            <select 
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="w-full bg-dark-800 border border-dark-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand/50"
            >
              <option value="">All Types</option>
              {types.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-wider mb-2">Severity</label>
            <select 
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
              className="w-full bg-dark-800 border border-dark-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand/50"
            >
              <option value="">All Severity</option>
              {severities.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-wider mb-2">Status</label>
            <select 
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full bg-dark-800 border border-dark-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand/50"
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Calendar size={14} /> Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-dark-800 border border-dark-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand/50"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Calendar size={14} /> End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-dark-800 border border-dark-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand/50"
            />
          </div>

          <div className="flex items-end">
            <button 
              onClick={resetFilters}
              className="w-full px-4 py-2.5 bg-dark-700 hover:bg-dark-600 rounded-xl text-gray-300 text-sm font-medium transition-all"
            >
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="glass-panel rounded-2xl overflow-hidden shadow-lg border border-dark-700/50">
        {isLoading ? <Spinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-xs text-gray-400 bg-dark-800/60 uppercase tracking-widest">
                <tr>
                  <th className="px-6 py-4 font-bold">Timestamp</th>
                  <th className="px-6 py-4 font-bold">Type</th>
                  <th className="px-6 py-4 font-bold">Severity</th>
                  <th className="px-6 py-4 font-bold">Message</th>
                  <th className="px-6 py-4 font-bold">Status</th>
                  <th className="px-6 py-4 font-bold">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700/50">
                {filteredAlerts.map((log: any, i: number) => (
                  <tr key={i} className="hover:bg-dark-800/50 transition-colors">
                    <td className="px-6 py-4 text-xs text-gray-500 font-mono">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs bg-dark-700 text-gray-300 px-2.5 py-1 rounded border border-dark-600 font-medium uppercase tracking-wider">
                        {log.type}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <SeverityBadge severity={log.severity} />
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-300 max-w-sm truncate">
                      {log.message}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2.5 py-1 rounded-lg border font-bold uppercase tracking-wider ${
                        log.status === 'active' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                        log.status === 'acknowledged' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30' :
                        'bg-green-500/10 text-green-400 border-green-500/30'
                      }`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs">
                      <button className="text-brand hover:text-blue-400 font-semibold">View</button>
                    </td>
                  </tr>
                ))}
                {!filteredAlerts.length && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-gray-500">
                      {alerts?.length ? 'No logs match the selected filters' : 'No logs found'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Stats */}
      {!isLoading && alerts?.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="glass-panel rounded-2xl p-4 border border-dark-700">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Total Events</p>
            <p className="text-2xl font-bold text-white">{alerts.length}</p>
          </div>
          <div className="glass-panel rounded-2xl p-4 border border-dark-700">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Critical</p>
            <p className="text-2xl font-bold text-red-400">{alerts.filter((a: any) => a.severity === 'critical').length}</p>
          </div>
          <div className="glass-panel rounded-2xl p-4 border border-dark-700">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Active</p>
            <p className="text-2xl font-bold text-yellow-400">{alerts.filter((a: any) => a.status === 'active').length}</p>
          </div>
          <div className="glass-panel rounded-2xl p-4 border border-dark-700">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Resolved</p>
            <p className="text-2xl font-bold text-green-400">{alerts.filter((a: any) => a.status === 'resolved').length}</p>
          </div>
        </div>
      )}
    </div>
  );
};

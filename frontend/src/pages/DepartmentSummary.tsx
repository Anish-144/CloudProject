import React from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { DollarSign, AlertTriangle, Activity, TrendingDown, ShieldCheck, Server } from 'lucide-react';

const API_BASE = 'http://localhost:8000/api/v1';

const fetchFinOps = () => axios.get(`${API_BASE}/finops/summary`).then(r => r.data);
const fetchCompliance = () => axios.get(`${API_BASE}/compliance/score`).then(r => r.data);
const fetchAlerts = (limit = 20) => axios.get(`${API_BASE}/alerts?limit=${limit}`).then(r => r.data);

const Spinner = () => (
  <div className="flex justify-center items-center py-16">
    <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-brand" />
  </div>
);

const StatCard = ({ title, value, sub, icon: Icon, color }: any) => (
  <div className="glass-panel rounded-2xl p-6 border border-dark-700 hover:border-dark-600 transition-all">
    <div className="flex items-center justify-between mb-4">
      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">{title}</p>
        <p className="text-3xl font-bold text-white">{value}</p>
      </div>
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon size={24} />
      </div>
    </div>
    <p className="text-xs text-gray-500">{sub}</p>
  </div>
);

export const DepartmentSummary = () => {
  const { data: fp, isLoading: fpLoad } = useQuery({ queryKey: ['finops-summary'], queryFn: fetchFinOps });
  const { data: comp, isLoading: cpLoad } = useQuery({ queryKey: ['compliance-summary'], queryFn: fetchCompliance });
  const { data: alerts, isLoading: alLoad } = useQuery({ queryKey: ['alerts-summary'], queryFn: fetchAlerts });

  const criticalAlerts = alerts?.filter((a: any) => a.severity === 'critical').length ?? 0;
  const activeAlerts = alerts?.filter((a: any) => a.status === 'active').length ?? 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold mb-1">Department Summary</h1>
        <p className="text-gray-400 text-sm">Aggregated cross-department statistics</p>
      </div>

      {/* FinOps Section */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold flex items-center gap-2 text-brand">
          <TrendingDown size={24} /> FinOps Intelligence
        </h2>
        {fpLoad ? <Spinner /> : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <StatCard 
              title="Savings Potential" 
              value={`$${(fp?.total_savings_potential ?? 0).toLocaleString()}`}
              sub="Total estimated savings across all resources"
              icon={DollarSign}
              color="bg-emerald-500/20 text-emerald-400"
            />
            <StatCard 
              title="Idle Resources" 
              value={fp?.idle_resources ?? 0}
              sub="Resources running at minimal capacity"
              icon={Activity}
              color="bg-yellow-500/20 text-yellow-400"
            />
          </div>
        )}
      </div>

      {/* Compliance Section */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold flex items-center gap-2 text-purple-400">
          <ShieldCheck size={24} /> Compliance Posture
        </h2>
        {cpLoad ? <Spinner /> : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <StatCard 
              title="Total Violations" 
              value={comp?.active_violations ?? 0}
              sub="Open compliance violations across all frameworks"
              icon={AlertTriangle}
              color="bg-orange-500/20 text-orange-400"
            />
            <StatCard 
              title="Critical Alerts" 
              value={comp?.critical_violations ?? 0}
              sub="Violations requiring immediate attention"
              icon={AlertTriangle}
              color="bg-red-500/20 text-red-400"
            />
          </div>
        )}
      </div>

      {/* Infrastructure Section */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold flex items-center gap-2 text-cyan-400">
          <Server size={24} /> Infrastructure Health
        </h2>
        {alLoad ? <Spinner /> : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <StatCard 
              title="Active Alerts" 
              value={activeAlerts}
              sub="Currently open infrastructure alerts"
              icon={Activity}
              color="bg-blue-500/20 text-blue-400"
            />
            <StatCard 
              title="Critical Issues" 
              value={criticalAlerts}
              sub="Critical severity infrastructure alerts"
              icon={AlertTriangle}
              color="bg-red-500/20 text-red-400"
            />
          </div>
        )}
      </div>

      {/* Recent Alerts */}
      <div className="glass-panel rounded-2xl p-6 border border-dark-700">
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
          <AlertTriangle size={20} className="text-yellow-400" /> Recent System Alerts
        </h3>
        {alLoad ? <Spinner /> : (
          <div className="space-y-3">
            {(alerts ?? []).slice(0, 5).map((alert: any, i: number) => (
              <div key={i} className="p-4 bg-dark-800/50 rounded-lg border border-dark-700 hover:border-dark-600 transition-all">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-bold uppercase px-2 py-1 rounded border ${
                    alert.severity === 'critical' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                    alert.severity === 'high' ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' :
                    'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                  }`}>{alert.severity}</span>
                  <span className="text-xs text-gray-500">{new Date(alert.created_at).toLocaleTimeString()}</span>
                </div>
                <p className="text-sm text-gray-300">{alert.message}</p>
              </div>
            ))}
            {!alerts?.length && <p className="text-center text-gray-500 py-8">No alerts at this time</p>}
          </div>
        )}
      </div>
    </div>
  );
};

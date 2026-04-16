import React from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { BarChart2, DollarSign, AlertTriangle, Activity, ShieldCheck } from 'lucide-react';
import { Line, Bar } from 'react-chartjs-2';

const API_BASE = 'http://localhost:8000/api/v1';

const defaultCostTrend = [
  { date: "2026-03-17", cost: 120 },
  { date: "2026-03-18", cost: 140 },
  { date: "2026-03-19", cost: 110 }
];

const defaultComplianceSummary = [
  { category: "security", compliance_percentage: 100 },
  { category: "cost_optimization", compliance_percentage: 95 },
  { category: "reliability", compliance_percentage: 98 },
  { category: "performance", compliance_percentage: 90 }
];

const defaultResourceMetrics = [
  { date: "2026-03-17", idle_count: 5 },
  { date: "2026-03-18", idle_count: 8 },
  { date: "2026-03-19", idle_count: 3 }
];

// Fetchers
const fetchFinOps = () => axios.get(`${API_BASE}/finops/summary`).then(r => r.data).catch(() => ({ total_savings_potential: 0, idle_resources: 0 }));
const fetchCompliance = () => axios.get(`${API_BASE}/compliance/score`).then(r => r.data).catch(() => ({ overall_score: 0, active_violations: 0, critical_violations: 0 }));
const fetchTrends = () => axios.get(`${API_BASE}/finops/cost-trends`).then(r => r.data).catch(() => ([]));
const fetchAccountStats = () => axios.get(`${API_BASE}/admin/stats/by-account`).then(r => r.data).catch(() => ([]));
const fetchCostTrend = () => axios.get(`${API_BASE}/analytics/cost-trend`).then(r => r.data).catch(() => defaultCostTrend);
const fetchComplianceSummary = () => axios.get(`${API_BASE}/analytics/compliance-summary`).then(r => r.data).catch(() => defaultComplianceSummary);
const fetchResourceMetrics = () => axios.get(`${API_BASE}/analytics/resource-metrics`).then(r => r.data).catch(() => defaultResourceMetrics);

// Shared UI Components
const Spinner = () => (
  <div className="flex justify-center items-center py-16">
    <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-brand" />
  </div>
);

const MetricCard = ({ title, value, sub, icon: Icon, color }: any) => (
  <div className="glass-panel rounded-2xl p-5 relative overflow-hidden group hover:-translate-y-1 transition-all duration-300 cursor-default">
    <div className={`absolute top-0 right-0 p-3 opacity-10 transform translate-x-4 -translate-y-4 group-hover:scale-110 transition-transform ${color}`}>
      <Icon size={80} />
    </div>
    <div className="relative z-10">
      <p className="text-xs text-gray-400 font-medium mb-1 uppercase tracking-wider">{title}</p>
      <p className="text-3xl font-bold text-white mb-1">{value}</p>
      <p className={`text-xs font-medium ${color}`}>{sub}</p>
    </div>
    <div className={`absolute bottom-0 left-0 h-0.5 w-full bg-gradient-to-r from-transparent ${color.replace('text-', 'via-').replace('400', '500')} to-transparent opacity-30`} />
  </div>
);

export const AdminOverview = () => {
  const { data: fp, isLoading: fpLoad } = useQuery({ queryKey: ['finops'], queryFn: fetchFinOps });
  const { data: comp, isLoading: cpLoad } = useQuery({ queryKey: ['compliance'], queryFn: fetchCompliance });
  const { data: trends, isLoading: tdLoad } = useQuery({ queryKey: ['trends'], queryFn: fetchTrends });
  const { data: accStats, isLoading: asLoad } = useQuery({ queryKey: ['account-stats'], queryFn: fetchAccountStats });
  const { data: costTrend, isLoading: ctLoad } = useQuery({ queryKey: ['cost-trend'], queryFn: fetchCostTrend });
  const { data: complianceSummary, isLoading: csLoad } = useQuery({ queryKey: ['compliance-summary'], queryFn: fetchComplianceSummary });
  const { data: resourceMetrics, isLoading: rmLoad } = useQuery({ queryKey: ['resource-metrics'], queryFn: fetchResourceMetrics });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold mb-1">Admin Overview</h1>
        <p className="text-gray-400 text-sm">Platform governance · Cross-department insights · Real-time metrics</p>
      </div>

      {fpLoad || cpLoad ? <Spinner /> : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="Savings Potential" value={`$${(fp?.total_savings_potential ?? 0).toLocaleString()}`} sub="Cloud waste detected" icon={DollarSign} color="text-emerald-400" />
          <MetricCard title="Compliance Score" value={`${comp?.overall_score ?? 0}%`} sub={`${comp?.active_violations ?? 0} violations`} icon={ShieldCheck} color={comp?.overall_score > 80 ? 'text-emerald-400' : 'text-orange-400'} />
          <MetricCard title="Critical Violations" value={comp?.critical_violations ?? 0} sub="Requires immediate action" icon={AlertTriangle} color="text-red-400" />
          <MetricCard title="Idle Resources" value={fp?.idle_resources ?? 0} sub="Running < 5% CPU" icon={Activity} color="text-yellow-400" />
        </div>
      )}

      {/* Cost Trend Chart */}
      <div className="glass-panel rounded-2xl p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2"><BarChart2 size={18} className="text-brand" /> Cost Trend — Last 30 Days</h3>
        {ctLoad ? <Spinner /> : costTrend && costTrend.length > 0 ? (
          <div className="h-52">
            <Line 
              data={{
                labels: costTrend.map((t: any) => t.date),
                datasets: [{
                  label: 'Daily Cost ($)',
                  data: costTrend.map((t: any) => t.cost),
                  borderColor: '#3b82f6',
                  backgroundColor: 'rgba(59,130,246,0.08)',
                  borderWidth: 2,
                  fill: true,
                  tension: 0.4,
                  pointRadius: 3
                }]
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
                  x: { grid: { display: false }, ticks: { color: '#9ca3af', maxTicksLimit: 8 } }
                }
              }}
            />
          </div>
        ) : (
          <p className="text-gray-500 text-center py-8">No analytics data available.</p>
        )}
      </div>

      {/* Compliance Breakdown */}
      <div className="glass-panel rounded-2xl p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2"><ShieldCheck size={18} className="text-purple-400" /> Compliance by Category</h3>
        {csLoad ? <Spinner /> : complianceSummary && complianceSummary.length > 0 ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {complianceSummary.map((item: any) => (
              <div key={item.category} className="p-4 bg-dark-800 rounded-xl border border-dark-600">
                <div className="flex justify-between mb-2">
                  <span className="text-sm text-gray-300 capitalize">{item.category.replace(/_/g, ' ')}</span>
                  <span className={`text-sm font-bold ${item.compliance_percentage > 80 ? 'text-emerald-400' : 'text-orange-400'}`}>{item.compliance_percentage}%</span>
                </div>
                <div className="w-full bg-dark-900 rounded-full h-1.5">
                  <div className={`h-1.5 rounded-full ${item.compliance_percentage > 80 ? 'bg-emerald-500' : 'bg-orange-500'}`} style={{ width: `${item.compliance_percentage}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-center py-8">No analytics data available.</p>
        )}
      </div>

      {/* Idle Resource Trend */}
      <div className="glass-panel rounded-2xl p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2"><Activity size={18} className="text-yellow-400" /> Idle Resource Trend</h3>
        {rmLoad ? <Spinner /> : resourceMetrics && resourceMetrics.length > 0 ? (
          <div className="h-52">
            <Line 
              data={{
                labels: resourceMetrics.map((t: any) => t.date),
                datasets: [{
                  label: 'Idle Resources',
                  data: resourceMetrics.map((t: any) => t.idle_count),
                  borderColor: '#f59e0b',
                  backgroundColor: 'rgba(245,158,11,0.08)',
                  borderWidth: 2,
                  fill: true,
                  tension: 0.4,
                  pointRadius: 3
                }]
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
                  x: { grid: { display: false }, ticks: { color: '#9ca3af', maxTicksLimit: 8 } }
                }
              }}
            />
          </div>
        ) : (
          <p className="text-gray-500 text-center py-8">No analytics data available.</p>
        )}
      </div>

      {/* Department Stats Cards */}
      {asLoad ? <Spinner /> : (
        <div className="glass-panel rounded-2xl overflow-hidden shadow-lg border border-dark-700/50">
          <div className="p-4 border-b border-dark-700 bg-dark-800/80 flex items-center justify-between">
            <h3 className="font-semibold text-white">AWS Account Portfolio</h3>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
            {(accStats ?? []).map((acc: any, i: number) => (
              <div key={acc.account_id} className={`p-6 ${i === 0 ? 'lg:border-r border-dark-700' : ''} hover:bg-dark-800/30 transition-colors`}>
                <h4 className="text-lg font-bold text-white mb-4">{acc.account_name}</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 bg-dark-700/50 rounded-xl border border-dark-600">
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Users</p>
                    <p className="text-lg font-bold text-white">{acc.user_count}</p>
                  </div>
                  <div className="p-3 bg-dark-700/50 rounded-xl border border-dark-600">
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Resources</p>
                    <p className="text-lg font-bold text-white">{acc.resource_count}</p>
                  </div>
                  <div className="p-3 bg-dark-700/50 rounded-xl border border-dark-600">
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Cost</p>
                    <p className="text-lg font-bold text-emerald-400">${parseFloat(acc.total_cost).toFixed(0)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

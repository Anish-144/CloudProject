import React, { createContext, useContext, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import {
  ShieldCheck, TrendingDown, Bell, Cloud, Activity, AlertTriangle,
  CheckCircle, DollarSign, Server, Users, Crown, BarChart2, Lock,
  LogOut, PiggyBank, Cpu, Monitor, Settings, Database, Download, Calendar,
  Globe, Zap
} from 'lucide-react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Title, Tooltip, Legend, ArcElement, Filler
} from 'chart.js';
import { Line, Doughnut, Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, ArcElement, Filler);

const REFRESH_INTERVAL = parseInt(import.meta.env.VITE_DASHBOARD_REFRESH_INTERVAL || '30000', 10);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Math.max(0, REFRESH_INTERVAL - 5000), // Ensure data is stale before next poll
      refetchInterval: REFRESH_INTERVAL,              // Automatic background refresh
      refetchOnWindowFocus: false,
      retry: 1,
    }
  }
});

const API_BASE = 'http://localhost:8000/api/v1';

// ─── Auth Helpers ─────────────────────────────────────────────────────────────
export const setAuthToken = (token: string) => {
  axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
};

const handleCSVDownload = async (endpoint: string, filename: string) => {
  try {
    const response = await axios.get(`${API_BASE}${endpoint}`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (err) {
    console.error('Download failed:', err);
    alert('Failed to download CSV. Please check your permissions.');
  }
};

// ─── Auth Context ─────────────────────────────────────────────────────────────
interface AuthCtx { authed: boolean; role: string; email: string; login: (token: string, role: string, email: string) => void; logout: () => void; }
const AuthContext = createContext<AuthCtx>({ authed: false, role: '', email: '', login: () => {}, logout: () => {} });
export const useAuth = () => useContext(AuthContext);

// ─── Role Routing ─────────────────────────────────────────────────────────────
const getRoleDashboard = (role: string): string => {
  if (!role) return '/login';
  switch (role) {
    case 'finops_manager':    return '/dashboard/finops';
    case 'compliance_manager':
    case 'compliance_officer': return '/dashboard/compliance';
    case 'it_admin':           return '/dashboard/infra';
    case 'cloud_admin':
    case 'admin':              return '/dashboard/admin';
    default:                   return '/login'; // Safer fallback
  }
};

const getRoleLabel = (role: string) => ({
  finops_manager: 'FinOps Manager',
  compliance_manager: 'Compliance Manager',
  compliance_officer: 'Compliance Officer',
  it_admin: 'IT Administrator',
  cloud_admin: 'Cloud Admin',
  admin: 'Administrator',
  viewer: 'Viewer',
}[role] ?? role);

// ─── API Fetchers ─────────────────────────────────────────────────────────────
const fetchFinOps    = () => axios.get(`${API_BASE}/finops/summary`).then(r => r.data);
const fetchTrends    = () => axios.get(`${API_BASE}/finops/cost-trends`).then(r => r.data);
const fetchSavings   = () => axios.get(`${API_BASE}/finops/top-savings`).then(r => r.data);
const fetchCompliance = () => axios.get(`${API_BASE}/compliance/score`).then(r => r.data);
const fetchViolations = () => axios.get(`${API_BASE}/compliance/violations?limit=20`).then(r => r.data);
const fetchAlerts    = (limit = 20) => axios.get(`${API_BASE}/alerts?limit=${limit}`).then(r => r.data);
const fetchAdminUsers = () => axios.get(`${API_BASE}/admin/users`).then(r => r.data);
const fetchAdminResources = () => axios.get(`${API_BASE}/admin/resources`).then(r => r.data);
const fetchAccountStats = () => axios.get(`${API_BASE}/admin/stats/by-account`).then(r => r.data);

// ─── Shared UI ────────────────────────────────────────────────────────────────
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
    <div className={`absolute bottom-0 left-0 h-0.5 w-full bg-gradient-to-r from-transparent ${color.replace('text-', 'via-').replace('400', '500').replace('emerald', 'emerald').replace('400','400')} to-transparent opacity-30`} />
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

const Spinner = () => (
  <div className="flex justify-center items-center py-16">
    <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-brand" />
  </div>
);

// ─── Alert Feed (SSE) ─────────────────────────────────────────────────────────
const AlertFeed = () => {
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    let alive = true;
    axios.get(`${API_BASE}/alerts?limit=10`).then(r => { if (alive) setItems(r.data); }).catch(() => {});
    const sse = new EventSource(`${API_BASE}/alerts/stream`);
    sse.onmessage = e => {
      try {
        const d = JSON.parse(e.data);
        if (d.type !== 'connected' && alive) setItems(prev => [d, ...prev].slice(0, 50));
      } catch {}
    };
    return () => { alive = false; sse.close(); };
  }, []);

  return (
    <div className="glass-panel rounded-2xl flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b border-dark-700 bg-dark-800 flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Bell size={16} className="text-yellow-400" /> Live Alert Stream
        </h3>
        <span className="flex h-2.5 w-2.5 relative">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {items.map((a, i) => (
          <div key={i} className="p-3 bg-dark-700/50 hover:bg-dark-700 rounded-lg border border-dark-600 transition-colors">
            <div className="flex justify-between items-center mb-1">
              <SeverityBadge severity={a.severity} />
              <span className="text-xs text-gray-500">{new Date(a.created_at).toLocaleTimeString()}</span>
            </div>
            <p className="text-xs text-gray-300 mt-1.5 leading-relaxed">{a.message}</p>
          </div>
        ))}
        {items.length === 0 && <p className="text-center text-gray-500 text-sm py-8">Waiting for events…</p>}
      </div>
    </div>
  );
};

// ─── Log Export Section ───────────────────────────────────────────────────────
const LogExport = () => {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    let url = '/finops/export/logs';
    const params = new URLSearchParams();
    if (start) params.append('start_date', new Date(start).toISOString());
    if (end) params.append('end_date', new Date(end).toISOString());
    const query = params.toString();
    if (query) url += `?${query}`;
    
    await handleCSVDownload(url, `usage_logs_${new Date().toISOString().split('T')[0]}.csv`);
    setLoading(false);
  };

  return (
    <div className="glass-panel rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Database size={18} className="text-brand" /> Export Usage Logs
        </h3>
        <button 
          onClick={handleDownload}
          disabled={loading}
          className="flex items-center gap-2 bg-brand hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-sm transition-all disabled:opacity-50"
        >
          <Download size={16} /> {loading ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1.5 ml-1">Start Date</label>
          <div className="relative">
            <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input 
              type="date" 
              value={start} 
              onChange={e => setStart(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600 rounded-xl pl-10 pr-4 py-2 text-sm text-gray-200 outline-none focus:border-brand/50 transition-all" 
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 uppercase tracking-widest mb-1.5 ml-1">End Date</label>
          <div className="relative">
            <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input 
              type="date" 
              value={end} 
              onChange={e => setEnd(e.target.value)}
              className="w-full bg-dark-700 border border-dark-600 rounded-xl pl-10 pr-4 py-2 text-sm text-gray-200 outline-none focus:border-brand/50 transition-all" 
            />
          </div>
        </div>
      </div>
      <p className="text-[10px] text-gray-500 mt-3 italic">* Leave dates empty to download ALL logs</p>
    </div>
  );
};

// ─── Sidebar ──────────────────────────────────────────────────────────────────
interface NavItem { path: string; icon: React.ReactNode; label: string; }
const Sidebar = ({ navItems }: { navItems: NavItem[] }) => {
  const { pathname } = useLocation();
  const { email, role, logout } = useAuth();
  return (
    <aside className="w-64 glass-panel border-r border-dark-700 flex flex-col shrink-0">
      <div className="p-5 flex items-center gap-3 border-b border-dark-700">
        <div className="p-2 bg-brand rounded-lg shadow-[0_0_15px_rgba(59,130,246,0.5)]">
          <Cloud size={20} className="text-white" />
        </div>
        <div>
          <span className="font-bold tracking-wide block">CloudGuard</span>
          <span className="text-[10px] text-gray-500 uppercase tracking-widest">Governance</span>
        </div>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(item => (
          <Link key={item.path} to={item.path}>
            <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all text-sm ${
              pathname === item.path
                ? 'bg-brand/10 text-brand border border-brand/20 font-semibold'
                : 'text-gray-400 hover:bg-dark-700 hover:text-gray-200'
            }`}>
              {item.icon}
              <span>{item.label}</span>
            </div>
          </Link>
        ))}
      </nav>
      <div className="p-4 border-t border-dark-700 space-y-2">
        <div className="flex items-center gap-3 p-3 rounded-xl bg-dark-700/50 border border-dark-600">
          <div className="w-8 h-8 rounded-full bg-brand/20 border border-brand/30 flex items-center justify-center text-brand font-bold text-sm shrink-0">
            {email.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-200 truncate">{email}</p>
            <p className="text-[10px] text-gray-500 mt-0.5">{getRoleLabel(role)}</p>
          </div>
        </div>
        <button onClick={logout} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors text-sm">
          <LogOut size={15} /> Sign Out
        </button>
      </div>
    </aside>
  );
};

const Layout = ({ children, nav }: { children: React.ReactNode; nav: NavItem[] }) => (
  <div className="flex h-screen overflow-hidden">
    <Sidebar navItems={nav} />
    <main className="flex-1 overflow-y-auto bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-dark-800 via-dark-900 to-dark-900 relative">
      <div className="absolute top-0 w-full h-0.5 bg-gradient-to-r from-brand via-purple-500 to-brand opacity-50 z-10" />
      <div className="p-8 pb-16">{children}</div>
    </main>
  </div>
);

// ─── FINOPS DASHBOARD ─────────────────────────────────────────────────────────
const FinOpsDashboard = () => {
  const { data: fp, isLoading: fpLoad } = useQuery({ queryKey: ['finops'], queryFn: fetchFinOps });
  const { data: trends, isLoading: tdLoad } = useQuery({ queryKey: ['trends'], queryFn: fetchTrends });
  const { data: savings, isLoading: svLoad } = useQuery({ queryKey: ['savings'], queryFn: fetchSavings });

  const nav: NavItem[] = [
    { path: '/dashboard/finops', icon: <TrendingDown size={17} />, label: 'FinOps Intelligence' },
  ];

  const trendChart = {
    labels: trends?.map((t: any) => t.date) ?? [],
    datasets: [{
      label: 'Daily Cost ($)',
      data: trends?.map((t: any) => t.cost) ?? [],
      borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)',
      borderWidth: 2, fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 6,
    }]
  };

  return (
    <Layout nav={nav}>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3 mb-1">
              <TrendingDown className="text-brand" /> FinOps Intelligence
            </h1>
            <p className="text-gray-400 text-sm">Cost optimisation · Waste detection · Savings insights</p>
          </div>
          <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1.5 rounded-full font-medium">Live Data</span>
        </div>

        {fpLoad ? <Spinner /> : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard title="Savings Potential"   value={`$${(fp?.total_savings_potential ?? 0).toLocaleString()}`}    sub="Idle & overprovisioned"     icon={DollarSign}    color="text-emerald-400" />
            <MetricCard title="Idle Resources"      value={fp?.idle_resources ?? 0}             sub="Running < 5% CPU"          icon={Activity}       color="text-yellow-400" />
            <MetricCard title="Overprovisioned"     value={fp?.overprovisioned_resources ?? 0}  sub="Undersized allocations"    icon={TrendingDown}   color="text-orange-400" />
            <MetricCard title="Cost Spikes"         value={fp?.cost_spike_resources ?? 0}       sub="Sudden increase > 20%"     icon={AlertTriangle}  color="text-red-400"   />
          </div>
        )}

        {fpLoad ? null : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <MetricCard title="Avg Monthly Cost"  value={`$${((fp?.avg_monthly_cost ?? 0)).toLocaleString(undefined,{maximumFractionDigits:0})}`} sub="30-day rolling avg" icon={BarChart2}  color="text-brand"    />
            <MetricCard title="30-Day Forecast"   value={`$${((fp?.forecast_30d ?? 0)).toLocaleString(undefined,{maximumFractionDigits:0})}`}    sub="Projected spend"   icon={PiggyBank} color="text-purple-400" />
          </div>
        )}

        <div className="glass-panel rounded-2xl p-6">
          <h3 className="font-semibold mb-4 flex items-center gap-2"><BarChart2 size={18} className="text-brand" /> Cost Trend — Last 30 Days</h3>
          {tdLoad ? <Spinner /> : (
            <div className="h-52">
              <Line data={trendChart} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } }, x: { grid: { display: false }, ticks: { color: '#9ca3af', maxTicksLimit: 8 } } } }} />
            </div>
          )}
        </div>

        <div className="glass-panel rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-dark-700 bg-dark-800 flex justify-between items-center">
            <h3 className="font-semibold flex items-center gap-2"><DollarSign size={18} className="text-emerald-400" /> Top Savings Opportunities</h3>
            <button 
              onClick={() => handleCSVDownload('/finops/top-savings', 'savings_opportunities.csv')}
              className="text-xs flex items-center gap-1.5 text-gray-400 hover:text-emerald-400 transition-colors bg-dark-700/50 px-2 py-1 rounded border border-dark-600"
            >
              <Download size={13} /> Export
            </button>
          </div>
          {svLoad ? <Spinner /> : (
            <div className="divide-y divide-dark-700/50">
              {(savings ?? []).slice(0, 6).map((item: any, i: number) => (
                <div key={i} className="flex justify-between items-center px-6 py-4 hover:bg-dark-800/50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-7 h-7 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 text-xs font-bold">{i+1}</div>
                    <div>
                      <p className="text-sm font-medium text-gray-200">{item.message}</p>
                      <SeverityBadge severity={item.severity} />
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <p className="font-bold text-emerald-400 text-sm">${parseFloat(item.details?.estimated_savings ?? 0).toFixed(0)}/mo</p>
                    <button className="mt-1 text-xs bg-dark-600 hover:bg-emerald-500/20 hover:text-emerald-400 text-gray-400 px-3 py-1 rounded transition-colors border border-dark-500 hover:border-emerald-500/30">Review</button>
                  </div>
                </div>
              ))}
              {!(savings?.length) && <p className="py-12 text-center text-gray-500">No savings opportunities detected</p>}
            </div>
          )}
        </div>

        <div className="glass-panel rounded-2xl p-6">
          <h3 className="font-semibold mb-4 flex items-center gap-2"><AlertTriangle size={18} className="text-yellow-400" /> Waste Detection Summary</h3>
          {fpLoad ? <Spinner /> : (
            <div className="space-y-3">
              {[
                { label:'Idle Resources',         desc:`${fp?.idle_resources??0} VMs running < 5% CPU for 7+ days`,         badge:'High',   cls:'text-red-400 bg-red-500/10 border-red-500/20'     },
                { label:'Overprovisioned',         desc:`${fp?.overprovisioned_resources??0} instances using < 30% of allocated`, badge:'Medium', cls:'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' },
                { label:'Cost Spikes Detected',    desc:`${fp?.cost_spike_resources??0} resources with sudden cost spike`,   badge:'High',   cls:'text-orange-400 bg-orange-500/10 border-orange-500/20' },
              ].map((r,i) => (
                <div key={i} className="flex justify-between items-center p-4 bg-dark-700/50 rounded-xl border border-dark-600 hover:bg-dark-700 transition-colors">
                  <div>
                    <p className="font-medium text-sm text-white">{r.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{r.desc}</p>
                  </div>
                  <span className={`text-xs font-bold px-3 py-1.5 rounded-lg border ml-4 shrink-0 ${r.cls}`}>{r.badge}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

// ─── COMPLIANCE DASHBOARD ─────────────────────────────────────────────────────
const ComplianceDashboard = () => {
  const { data: comp, isLoading: cpLoad } = useQuery({ queryKey: ['compliance'], queryFn: fetchCompliance });
  const { data: violations, isLoading: vlLoad } = useQuery({ queryKey: ['violations'], queryFn: fetchViolations });

  const nav: NavItem[] = [
    { path: '/dashboard/compliance', icon: <ShieldCheck size={17} />, label: 'Compliance Posture' },
  ];

  const donut = {
    labels: ['Compliant','Violations'],
    datasets: [{ data:[comp?.overall_score??0, 100-(comp?.overall_score??0)], backgroundColor:['#10b981','#f43f5e'], borderWidth:0, cutout:'78%' }]
  };

  return (
    <Layout nav={nav}>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 mb-1"><ShieldCheck className="text-purple-400" /> Compliance Posture</h1>
          <p className="text-gray-400 text-sm">Framework adherence · Violations · Audit tracking</p>
        </div>

        {cpLoad ? <Spinner /> : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard title="Compliance Score"    value={`${comp?.overall_score??0}%`}     sub="Overall posture"      icon={ShieldCheck} color={comp?.overall_score>80?'text-emerald-400':'text-orange-400'} />
              <MetricCard title="Total Rules"         value={comp?.total_rules??0}              sub="Active checks"        icon={CheckCircle} color="text-brand"       />
              <MetricCard title="Active Violations"   value={comp?.active_violations??0}        sub="Rules failing"        icon={AlertTriangle} color="text-yellow-400" />
              <MetricCard title="Critical Violations" value={comp?.critical_violations??0}      sub="Immediate attention"  icon={Lock}        color="text-red-400"    />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <div className="glass-panel rounded-2xl p-6 flex flex-col items-center justify-center lg:col-span-2">
                <div className="w-40 h-40 relative mb-5">
                  <Doughnut data={donut} options={{ responsive:true, cutout:'78%', plugins:{tooltip:{enabled:false}} }} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-4xl font-bold">{comp?.overall_score}%</span>
                    <span className="text-xs text-gray-400 mt-0.5">Compliance</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 w-full">
                  {[{l:'Critical',v:comp?.critical_violations??0,c:'text-red-400'},{l:'High',v:comp?.high_violations??0,c:'text-orange-400'},{l:'Medium',v:comp?.medium_violations??0,c:'text-yellow-400'},{l:'Low',v:comp?.low_violations??0,c:'text-blue-400'}].map(x=>(
                    <div key={x.l} className="text-center p-2 bg-dark-700/50 rounded-lg border border-dark-600">
                      <p className={`text-xl font-bold ${x.c}`}>{x.v}</p>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">{x.l}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="glass-panel rounded-2xl p-6 lg:col-span-3">
                <h3 className="font-semibold mb-4 flex items-center gap-2"><BarChart2 size={18} className="text-purple-400" /> By Framework Category</h3>
                <div className="space-y-3">
                  {Object.entries(comp?.by_category??{}).map(([cat,val]:any) => (
                    <div key={cat}>
                      <div className="flex justify-between text-sm mb-1.5">
                        <span className="text-gray-300 capitalize">{cat.replace(/_/g,' ')}</span>
                        <span className={`font-bold ${val>80?'text-emerald-400':'text-orange-400'}`}>{val}%</span>
                      </div>
                      <div className="w-full bg-dark-700 rounded-full h-2">
                        <div className={`h-2 rounded-full transition-all duration-700 ${val>80?'bg-emerald-500':'bg-orange-500'}`} style={{width:`${val}%`}} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="glass-panel rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-dark-700 bg-dark-800 flex justify-between items-center">
            <h3 className="font-semibold flex items-center gap-2"><AlertTriangle size={18} className="text-yellow-400" /> Recent Violations</h3>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">{violations?.length ?? 0} records</span>
              <button 
                onClick={() => handleCSVDownload('/compliance/export/violations', 'compliance_violations.csv')}
                className="text-xs flex items-center gap-1.5 text-gray-400 hover:text-purple-400 transition-colors bg-dark-700/50 px-2 py-1 rounded border border-dark-600"
              >
                <Download size={13} /> Export CSV
              </button>
            </div>
          </div>
          {vlLoad ? <Spinner /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-xs text-gray-400 bg-dark-800/60">
                  <tr>{['Rule','Severity','Resource Type','Region','Status','Date'].map(h=><th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-dark-700/50">
                  {(violations??[]).map((v:any,i:number)=>(
                    <tr key={i} className="hover:bg-dark-800/50 transition-colors">
                      <td className="px-5 py-3 text-sm text-gray-200">{v.rule_name}</td>
                      <td className="px-5 py-3"><SeverityBadge severity={v.severity} /></td>
                      <td className="px-5 py-3 text-xs text-gray-400">{v.resource_type??'—'}</td>
                      <td className="px-5 py-3 text-xs text-gray-400">{v.region??'—'}</td>
                      <td className="px-5 py-3"><span className={`text-xs px-2 py-0.5 rounded border ${v.status==='open'?'bg-red-500/10 text-red-400 border-red-500/30':'bg-gray-500/10 text-gray-400 border-gray-500/30'}`}>{v.status}</span></td>
                      <td className="px-5 py-3 text-xs text-gray-500">{new Date(v.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                  {!violations?.length && <tr><td colSpan={6} className="py-12 text-center text-gray-500">No violations found</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

// ─── IT ADMIN DASHBOARD ───────────────────────────────────────────────────────
const ITAdminDashboard = () => {
  const { data: alerts, isLoading } = useQuery({ queryKey: ['alerts-all'], queryFn: () => fetchAlerts(100) });

  const nav: NavItem[] = [
    { path: '/dashboard/infra', icon: <Monitor size={17} />, label: 'Infrastructure Monitor' },
    { path: '/dashboard/infra', icon: <Bell size={17} />,    label: 'Alert Center' },
  ];

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  (alerts ?? []).forEach((a: any) => { counts[a.severity as keyof typeof counts] = (counts[a.severity as keyof typeof counts] ?? 0) + 1; });
  const total = (alerts ?? []).length;
  const acknowledged = (alerts ?? []).filter((a: any) => a.status === 'acknowledged').length;

  const barData = {
    labels: ['Critical','High','Medium','Low'],
    datasets:[{ label:'Alerts', data:[counts.critical,counts.high,counts.medium,counts.low],
      backgroundColor:['rgba(239,68,68,0.7)','rgba(249,115,22,0.7)','rgba(234,179,8,0.7)','rgba(107,114,128,0.7)'],
      borderRadius:6, borderSkipped:false }]
  };

  return (
    <Layout nav={nav.slice(0,1)}>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 mb-1"><Server className="text-cyan-400" /> Infrastructure Monitor</h1>
          <p className="text-gray-400 text-sm">Resource health · Alert monitoring · Live event stream</p>
        </div>

        {isLoading ? <Spinner /> : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard title="Critical Alerts"  value={counts.critical} sub="Immediate action"    icon={AlertTriangle} color="text-red-400"    />
            <MetricCard title="High Alerts"      value={counts.high}     sub="Needs attention"     icon={Activity}      color="text-orange-400" />
            <MetricCard title="Total Alerts"     value={total}           sub="All severities"      icon={Bell}          color="text-brand"      />
            <MetricCard title="Acknowledged"     value={acknowledged}    sub="Under investigation" icon={CheckCircle}   color="text-emerald-400"/>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6" style={{height:'380px'}}>
          <div className="glass-panel rounded-2xl p-6 lg:col-span-2 flex flex-col">
            <h3 className="font-semibold mb-4 flex items-center gap-2"><BarChart2 size={18} className="text-cyan-400" /> Alert Severity Breakdown</h3>
            {isLoading ? <Spinner /> : (
              <div className="flex-1">
                <Bar data={barData} options={{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ y:{grid:{color:'#1f2937'},ticks:{color:'#9ca3af'}}, x:{grid:{display:false},ticks:{color:'#9ca3af'}} } }} />
              </div>
            )}
          </div>
          <div className="lg:col-span-3 h-full">
            <AlertFeed />
          </div>
        </div>

        <div className="glass-panel rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-dark-700 bg-dark-800 flex justify-between items-center">
            <h3 className="font-semibold flex items-center gap-2"><Activity size={18} className="text-cyan-400" /> Recent Alerts</h3>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => handleCSVDownload('/alerts/export', 'alerts_export.csv')}
                className="text-xs bg-dark-700 hover:bg-dark-600 border border-dark-600 text-gray-300 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Download size={13}/> Export CSV
              </button>
              <button className="text-xs bg-dark-600 hover:bg-dark-500 border border-dark-500 text-gray-300 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"><CheckCircle size={13}/> Acknowledge All</button>
            </div>
          </div>
          {isLoading ? <Spinner /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-xs text-gray-400 bg-dark-800/60">
                  <tr>{['Severity','Type','Message','Time','Status'].map(h=><th key={h} className="px-5 py-3 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-dark-700/50">
                  {(alerts??[]).slice(0,15).map((a:any,i:number)=>(
                    <tr key={i} className="hover:bg-dark-800/50 transition-colors">
                      <td className="px-5 py-3"><SeverityBadge severity={a.severity}/></td>
                      <td className="px-5 py-3 text-xs text-brand uppercase tracking-wide">{a.type}</td>
                      <td className="px-5 py-3 text-sm text-gray-200 max-w-md truncate">{a.message}</td>
                      <td className="px-5 py-3 text-xs text-gray-500">{new Date(a.created_at).toLocaleString()}</td>
                      <td className="px-5 py-3"><span className={`text-xs px-2 py-0.5 rounded border ${a.status==='active'?'bg-red-500/10 text-red-400 border-red-500/30':'bg-green-500/10 text-green-400 border-green-500/30'}`}>{a.status}</span></td>
                    </tr>
                  ))}
                  {!alerts?.length && <tr><td colSpan={5} className="py-12 text-center text-gray-500">No alerts</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

// ─── CLOUD ADMIN DASHBOARD ────────────────────────────────────────────────────
const CloudAdminDashboard = () => {
  const [tab, setTab] = useState<'overview'|'users'|'resources'>('overview');
  const { data: fp,         isLoading: fpLoad } = useQuery({ queryKey: ['finops'],     queryFn: fetchFinOps });
  const { data: comp,       isLoading: cpLoad } = useQuery({ queryKey: ['compliance'], queryFn: fetchCompliance });
  const { data: trends,     isLoading: tdLoad } = useQuery({ queryKey: ['trends'],     queryFn: fetchTrends });
  const { data: adminUsers, isLoading: auLoad } = useQuery({ queryKey: ['admin-users'],queryFn: fetchAdminUsers, enabled: tab==='users' });
  const { data: adminRes,   isLoading: arLoad } = useQuery({ queryKey: ['admin-resources'],queryFn: fetchAdminResources, enabled: tab==='resources' });
  const { data: accStats,   isLoading: asLoad } = useQuery({ queryKey: ['account-stats'],queryFn: fetchAccountStats, enabled: tab==='overview' });

  const nav: NavItem[] = [
    { path:'/dashboard/admin',      icon:<Crown size={17}/>,       label:'Admin Overview'      },
    { path:'/dashboard/finops',     icon:<TrendingDown size={17}/>, label:'FinOps'              },
    { path:'/dashboard/compliance', icon:<ShieldCheck size={17}/>,  label:'Compliance'          },
    { path:'/dashboard/infra',      icon:<Monitor size={17}/>,      label:'Infrastructure'      },
  ];

  const trendChart = {
    labels: trends?.map((t:any)=>t.date)??[],
    datasets:[{ label:'Daily Cost ($)', data:trends?.map((t:any)=>t.cost)??[], borderColor:'#3b82f6', backgroundColor:'rgba(59,130,246,0.08)', borderWidth:2, fill:true, tension:0.4, pointRadius:3 }]
  };

  const roleColors: Record<string,string> = {
    cloud_admin:        'bg-purple-500/20 text-purple-400 border-purple-500/30',
    admin:              'bg-purple-500/20 text-purple-400 border-purple-500/30',
    finops_manager:     'bg-blue-500/20 text-blue-400 border-blue-500/30',
    compliance_manager: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    it_admin:           'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    viewer:             'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };

  return (
    <Layout nav={nav}>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3 mb-1"><Crown className="text-yellow-400" /> Cloud Administration</h1>
            <p className="text-gray-400 text-sm">Full platform visibility · User management · All services</p>
          </div>
          <div className="flex bg-dark-800 border border-dark-600 rounded-xl p-1 gap-1">
            {(['overview','users','resources'] as const).map(t=>(
              <button key={t} onClick={()=>setTab(t)} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab===t?'bg-brand text-white shadow-sm':'text-gray-400 hover:text-gray-200'}`}>
                {t==='overview'?'Overview':t==='users'?'User Mgmt':'Resources'}
              </button>
            ))}
          </div>
        </div>

        {tab === 'overview' && (
          <>
            {(fpLoad || cpLoad) ? <Spinner /> : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <MetricCard title="Savings Potential" value={`$${(fp?.total_savings_potential ?? 0).toLocaleString()}`} sub="Cloud waste detected" icon={DollarSign} color="text-emerald-400" />
                  <MetricCard title="Compliance Score" value={`${comp?.overall_score ?? 0}%`} sub={`${comp?.active_violations ?? 0} violations`} icon={ShieldCheck} color={comp?.overall_score > 80 ? 'text-emerald-400' : 'text-orange-400'} />
                  <MetricCard title="Critical Violations" value={comp?.critical_violations ?? 0} sub="Requires immediate action" icon={AlertTriangle} color="text-red-400" />
                  <MetricCard title="Idle Resources" value={fp?.idle_resources ?? 0} sub="Running < 5% CPU" icon={Activity} color="text-yellow-400" />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 glass-panel rounded-2xl p-6">
                    <h3 className="font-semibold mb-4 flex items-center gap-2"><BarChart2 size={18} className="text-brand" /> Cost Trend — Last 30 Days</h3>
                    {tdLoad ? <Spinner /> : (
                      <div className="h-52">
                        <Line data={trendChart} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } }, x: { grid: { display: false }, ticks: { color: '#9ca3af', maxTicksLimit: 8 } } } }} />
                      </div>
                    )}
                  </div>
                  <div className="h-80"><AlertFeed /></div>
                </div>

                <div className="glass-panel rounded-2xl p-6">
                  <h3 className="font-semibold mb-4 flex items-center gap-2"><ShieldCheck size={18} className="text-purple-400" /> Compliance by Category</h3>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {Object.entries(comp?.by_category ?? {}).map(([cat, val]: any) => (
                      <div key={cat} className="p-4 bg-dark-800 rounded-xl border border-dark-600">
                        <div className="flex justify-between mb-2">
                          <span className="text-sm text-gray-300 capitalize">{cat.replace(/_/g, ' ')}</span>
                          <span className={`text-sm font-bold ${val > 80 ? 'text-emerald-400' : 'text-orange-400'}`}>{val}%</span>
                        </div>
                        <div className="w-full bg-dark-900 rounded-full h-1.5">
                          <div className={`h-1.5 rounded-full ${val > 80 ? 'bg-emerald-500' : 'bg-orange-500'}`} style={{ width: `${val}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {asLoad ? <Spinner /> : (
                  <div className="glass-panel rounded-2xl overflow-hidden shadow-lg border border-dark-700/50">
                    <div className="p-4 border-b border-dark-700 bg-dark-800/80 flex items-center justify-between">
                      <h3 className="font-semibold text-white flex items-center gap-2">
                         <Cloud size={18} className="text-brand" /> AWS Account Portfolio Distribution
                      </h3>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2">
                      {(accStats ?? []).map((acc: any, i: number) => (
                        <div key={acc.account_id} className={`p-6 ${i === 0 ? 'lg:border-r border-dark-700' : ''} hover:bg-dark-800/30 transition-colors group relative overflow-hidden`}>
                          <div className="flex items-center justify-between mb-4 relative z-10">
                            <div>
                              <h4 className="text-lg font-bold text-white group-hover:text-brand transition-colors">{acc.account_name}</h4>
                              <p className="text-xs text-gray-500 font-mono tracking-wider">{acc.aws_id}</p>
                            </div>
                            {i === 0 ? <Globe className="text-brand opacity-40 group-hover:rotate-12 transition-transform" size={24} /> : <Zap className="text-yellow-400 opacity-40 group-hover:scale-110 transition-transform" size={24} />}
                          </div>
                          <div className="grid grid-cols-3 gap-3 mb-6 relative z-10">
                            <div className="p-3 bg-dark-700/50 rounded-xl border border-dark-600">
                               <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Users</p>
                               <p className="text-lg font-bold text-white">{acc.user_count}</p>
                            </div>
                            <div className="p-3 bg-dark-700/50 rounded-xl border border-dark-600">
                               <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Resources</p>
                               <p className="text-lg font-bold text-white">{acc.resource_count}</p>
                            </div>
                            <div className="p-3 bg-dark-700/50 rounded-xl border border-dark-600">
                               <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Est. Cost</p>
                               <p className="text-lg font-bold text-emerald-400">${parseFloat(acc.total_cost).toFixed(2)}</p>
                            </div>
                          </div>
                          <div className="space-y-2 relative z-10">
                             <div className="flex justify-between text-[10px] font-medium text-gray-400 mb-1">
                               <span>UTILIZATION</span>
                               <span className={i === 0 ? 'text-brand' : 'text-yellow-400'}>{Math.min(100, (acc.resource_count / 15) * 100).toFixed(0)}%</span>
                             </div>
                             <div className="w-full bg-dark-900 h-1.5 rounded-full overflow-hidden">
                               <div className={`h-full transition-all duration-1000 ${i === 0 ? 'bg-brand' : 'bg-yellow-400'}`} style={{ width: `${Math.min(100, (acc.resource_count / 15) * 100)}%` }} />
                             </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <LogExport />
                  <div className="glass-panel rounded-2xl p-6 flex flex-col justify-center">
                    <h3 className="font-semibold mb-4 flex items-center gap-2">
                       <Crown size={18} className="text-yellow-400" /> Platform Reports
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <button onClick={() => handleCSVDownload('/admin/export/resources', 'full_resource_inventory.csv')} className="flex items-center justify-center gap-2 bg-dark-700 hover:bg-dark-600 border border-dark-600 text-gray-200 px-4 py-3 rounded-xl text-xs font-medium transition-all">
                        <Server size={14} /> Resource Inventory
                      </button>
                      <button onClick={() => handleCSVDownload('/alerts/export', 'all_platform_alerts.csv')} className="flex items-center justify-center gap-2 bg-dark-700 hover:bg-dark-600 border border-dark-600 text-gray-200 px-4 py-3 rounded-xl text-xs font-medium transition-all">
                        <Bell size={14} /> Global Alert Log
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {tab === 'users' && (
          <div className="glass-panel rounded-2xl overflow-hidden shadow-lg border border-dark-700/50 mt-6">
            <div className="p-4 border-b border-dark-700 bg-dark-800/60 flex justify-between items-center">
              <h3 className="font-semibold text-white flex items-center gap-2"><Users size={18} className="text-brand" /> User Management</h3>
              <button className="text-[10px] bg-brand hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-all font-bold uppercase tracking-widest">+ New User</button>
            </div>
            {auLoad ? <Spinner /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="text-[10px] text-gray-500 uppercase tracking-widest bg-dark-800/40">
                    <tr>{['User Identity','Platform Role','AWS Account','Joined Date'].map(h=><th key={h} className="px-5 py-4 font-bold">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-dark-700/30">
                    {(adminUsers ?? []).map((user: any) => (
                      <tr key={user.id} className="hover:bg-dark-800/30 transition-colors group">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-dark-700 border border-dark-600 flex items-center justify-center text-xs font-bold text-gray-300">
                              {user.email.charAt(0).toUpperCase()}
                            </div>
                            <span className="text-sm font-medium text-gray-200">{user.email}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className={`text-[10px] px-2.5 py-1 rounded-lg border font-bold uppercase tracking-wider ${roleColors[user.role] ?? roleColors.viewer}`}>
                            {user.role.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                           <div className="flex items-center gap-2">
                             <div className={`w-2 h-2 rounded-full ${user.aws_account_name?.includes('Alpha') ? 'bg-brand' : 'bg-yellow-400'} shadow-[0_0_8px_rgba(59,130,246,0.3)]`} />
                             <span className="text-xs text-gray-300 font-medium">{user.aws_account_name ?? 'Standalone'}</span>
                           </div>
                        </td>
                        <td className="px-5 py-4 text-xs text-gray-500 font-mono italic">{new Date(user.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                    {!adminUsers?.length && <tr><td colSpan={4} className="py-20 text-center text-gray-500 font-medium italic">No registered users discovered.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === 'resources' && (
          <div className="glass-panel rounded-2xl overflow-hidden shadow-lg border border-dark-700/50 mt-6 animate-in slide-in-from-bottom-4 duration-500">
            <div className="p-4 border-b border-dark-700 bg-dark-800/60 flex justify-between items-center">
              <h3 className="font-semibold text-white flex items-center gap-2"><Server size={18} className="text-brand" /> Global Resource Inventory</h3>
              <button onClick={() => handleCSVDownload('/admin/export/resources', 'global_inventory.csv')} className="text-[10px] bg-dark-700 hover:bg-dark-600 border border-dark-600 text-gray-300 px-3 py-1.5 rounded-lg transition-all flex items-center gap-2 font-bold uppercase tracking-widest">
                <Download size={12}/> Generate Report
              </button>
            </div>
            {arLoad ? <Spinner /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="text-[10px] text-gray-500 uppercase tracking-widest bg-dark-800/40">
                    <tr>{['Resource Identifier','Service Type','Infrastructure','AWS Region','Hosting Account','Discovery Date'].map(h=><th key={h} className="px-5 py-4 font-bold">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-dark-700/30">
                    {(adminRes ?? []).map((res: any) => (
                      <tr key={res.id} className="hover:bg-dark-800/30 transition-colors group">
                        <td className="px-5 py-4">
                           <div className="flex items-center gap-3">
                             <div className="p-2 bg-dark-700 rounded-lg border border-dark-600"><Database size={14} className="text-brand opacity-60" /></div>
                             <span className="text-xs font-mono text-gray-300 transition-colors">{res.id}</span>
                           </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className="text-[10px] bg-dark-700/50 text-gray-300 px-2 py-1 rounded border border-dark-600 uppercase tracking-widest font-bold">{res.resource_type}</span>
                        </td>
                        <td className="px-5 py-4 text-[10px] text-gray-400 uppercase tracking-widest font-black flex items-center gap-2"><div className="w-1.5 h-1.5 bg-brand/50 rounded-full" /> {res.cloud_provider}</td>
                        <td className="px-5 py-4 text-xs text-gray-500 font-medium italic">{res.region}</td>
                        <td className="px-5 py-4">
                           <div className="flex items-center gap-2">
                             <div className={`w-1.5 h-1.5 rounded-full ${res.aws_account_name?.includes('Alpha') ? 'bg-brand' : 'bg-yellow-400'}`} />
                             <span className="text-xs text-gray-300">{res.aws_account_name ?? 'Default'}</span>
                           </div>
                        </td>
                        <td className="px-5 py-4 text-xs text-gray-500">{new Date(res.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                    {!(adminRes?.length) && <tr><td colSpan={6} className="py-12 text-center text-gray-500">No resources discovered yet</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
};

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
const LoginScreen = ({ onLogin }: { onLogin: (token: string, role: string, email: string) => void }) => {
  const [email, setEmail] = useState('admin@cloudguard.io');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const roles = [
    { label: 'Cloud Admin',        email: 'admin@cloudguard.io'      },
    { label: 'FinOps Manager',     email: 'finops@cloudguard.io'     },
    { label: 'Compliance Manager', email: 'compliance@cloudguard.io' },
    { label: 'IT Admin',           email: 'itadmin@cloudguard.io'    },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('[DEBUG] Login Submit:', { email, apiBase: API_BASE });
    setError('');
    setLoading(true);
    axios.post(`${API_BASE}/auth/login`, { email, password })
      .then(res => {
        const { access_token, role, email: userEmail } = res.data;
        onLogin(access_token, role, userEmail);
      })
      .catch(err => {
        if (!err.response) setError(`Network Error: Cannot reach API at ${API_BASE}`);
        else if (err.response.status === 401) setError('Invalid email or password.');
        else setError(err.response.data?.detail ?? `Error ${err.response.status}`);
      })
      .finally(() => setLoading(false));
  };

  return (
    <div className="h-screen w-full flex items-center justify-center bg-dark-900 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-brand/5 via-dark-900 to-dark-900" />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand/5 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />

      <div className="relative z-10 w-full max-w-md px-4">
        <div className="text-center mb-8">
          <div className="inline-flex p-3 bg-brand/20 border border-brand/30 rounded-2xl mb-4">
            <Cloud size={32} className="text-brand" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-1">CloudGuard</h1>
          <p className="text-gray-400 text-sm">Cloud Governance Platform</p>
        </div>

        <div className="glass-panel rounded-2xl p-8 border border-dark-700 shadow-2xl">
          <h2 className="text-lg font-semibold text-white mb-6">Sign in to your account</h2>
          {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-xl mb-4 text-sm">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1.5 uppercase tracking-wider">Email</label>
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
                className="w-full bg-dark-800 border border-dark-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 transition-all" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1.5 uppercase tracking-wider">Password</label>
              <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
                className="w-full bg-dark-800 border border-dark-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/20 transition-all" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-brand hover:bg-blue-500 text-white font-semibold py-2.5 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 mt-2">
              {loading ? <><div className="animate-spin rounded-full h-4 w-4 border-t-2 border-white/50 border-r-2" /> Signing in…</> : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-dark-700">
            <p className="text-xs text-gray-500 mb-3 font-medium uppercase tracking-wider">Quick login (pwd: admin123)</p>
            <div className="grid grid-cols-2 gap-2">
              {roles.map(r=>(
                <button key={r.email} onClick={()=>setEmail(r.email)}
                  className="text-xs bg-dark-700 hover:bg-dark-600 border border-dark-600 text-gray-300 px-3 py-2 rounded-lg transition-colors text-left">
                  <span className="block font-medium">{r.label}</span>
                  <span className="text-gray-500 truncate block">{r.email}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── PROTECTED ROUTE ──────────────────────────────────────────────────────────
const ProtectedRoute = ({ allowed, children }: { allowed: string[]; children: React.ReactNode }) => {
  const { role, authed, logout } = useAuth();
  const location = useLocation();

  console.log('[DEBUG] ProtectedRoute:', { path: location.pathname, authed, role, allowed });

  if (!authed) {
    console.log('[DEBUG] ProtectedRoute: Not authed, redirecting to /');
    return <Navigate to="/" replace />;
  }
  
  if (!allowed.includes(role)) {
    const fallback = getRoleDashboard(role);
    console.log('[DEBUG] ProtectedRoute: Role not allowed, fallback to:', fallback);
    // Loop protection: if we're already at the fallback path, or role is missing
    if (location.pathname === fallback || !role || fallback === '/login' || fallback === '/') {
      console.warn('[DEBUG] ProtectedRoute: Loop detected or missing role, forcing logout');
      logout();
      return <Navigate to="/" replace />;
    }
    return <Navigate to={fallback} replace />;
  }
  return <>{children}</>;
};

// ─── AUTH PROVIDER ────────────────────────────────────────────────────────────
const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [authed, setAuthed] = useState(false);
  const [role, setRole]     = useState('');
  const [email, setEmail]   = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('cloudguard_token');
    const r     = localStorage.getItem('cloudguard_role') ?? '';
    const e     = localStorage.getItem('cloudguard_email') ?? '';
    
    // Only auto-auth if we have BOTH a token and a non-empty role
    if (token && r) {
      setAuthToken(token);
      setRole(r);
      setEmail(e);
      setAuthed(true);
    } else if (token || r) {
      // Inconsistent state, clear storage
      ['cloudguard_token','cloudguard_role','cloudguard_email'].forEach(k=>localStorage.removeItem(k));
    }
    setLoading(false);
  }, []);

  const login = (token: string, userRole: string, userEmail: string) => {
    localStorage.setItem('cloudguard_token', token);
    localStorage.setItem('cloudguard_role',  userRole);
    localStorage.setItem('cloudguard_email', userEmail);
    setAuthToken(token);
    setRole(userRole);
    setEmail(userEmail);
    setAuthed(true);
  };

  const logout = () => {
    ['cloudguard_token','cloudguard_role','cloudguard_email'].forEach(k=>localStorage.removeItem(k));
    delete axios.defaults.headers.common['Authorization'];
    setRole(''); setEmail(''); setAuthed(false);
    queryClient.clear();
  };

  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-dark-900">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-brand" />
    </div>
  );

  return (
    <AuthContext.Provider value={{ authed, role, email, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

// ─── APP ROUTES ───────────────────────────────────────────────────────────────
const ADMIN  = ['cloud_admin','admin'];
const FINOPS = ['finops_manager','cloud_admin','admin'];
const COMP   = ['compliance_manager','compliance_officer','cloud_admin','admin'];
const IT     = ['it_admin','cloud_admin','admin'];

function AppRoutes() {
  const { role, authed, login } = useAuth();
  const location = useLocation();

  console.log('[DEBUG] AppRoutes:', { path: location.pathname, authed, role });

  return (
    <Routes>
      {/* Root path "/" now renders LoginScreen if not authenticated */}
      <Route path="/"                   element={authed ? <Navigate to={getRoleDashboard(role)} replace /> : <LoginScreen onLogin={login} />} />
      <Route path="/login"              element={<Navigate to="/" replace />} />
      <Route path="/dashboard/finops"   element={<ProtectedRoute allowed={FINOPS}><FinOpsDashboard /></ProtectedRoute>} />
      <Route path="/dashboard/compliance" element={<ProtectedRoute allowed={COMP}><ComplianceDashboard /></ProtectedRoute>} />
      <Route path="/dashboard/infra"    element={<ProtectedRoute allowed={IT}><ITAdminDashboard /></ProtectedRoute>} />
      <Route path="/dashboard/admin"    element={<ProtectedRoute allowed={ADMIN}><CloudAdminDashboard /></ProtectedRoute>} />
      <Route path="*"                   element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

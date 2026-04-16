import React, { createContext, useContext, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import {
  ShieldCheck, TrendingDown, Bell, Cloud, Activity, AlertTriangle,
  CheckCircle, DollarSign, Server, Users, Crown, BarChart2, Lock,
  LogOut, PiggyBank, Cpu, Monitor, Settings, Database, Sun, Moon,
  Download, AlertCircle, BarChart, Calendar
} from 'lucide-react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Title, Tooltip, Legend, ArcElement, Filler
} from 'chart.js';
import { Line, Doughnut, Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, ArcElement, Filler);

// ─── QueryClient (OUTSIDE component — prevents recreation on re-render) ───────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,       // cache 5 minutes
      refetchOnWindowFocus: false,      // no refetch on tab switch
      retry: 1,
    }
  }
});

const API_BASE = 'http://localhost:8000/api/v1';

// New API base for alert endpoints without v1
const ALERT_API_BASE = 'http://localhost:8000/api';

// ─── Auth Helpers ─────────────────────────────────────────────────────────────
export const setAuthToken = (token: string) => {
  axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
};

// ─── Auth Context ─────────────────────────────────────────────────────────────
interface AuthCtx { authed: boolean; role: string; email: string; login: (token: string, role: string, email: string) => void; logout: () => void; theme: 'light' | 'dark'; toggleTheme: () => void; }
const AuthContext = createContext<AuthCtx>({ authed: false, role: '', email: '', login: () => {}, logout: () => {}, theme: 'dark', toggleTheme: () => {} });
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
const fetchAlertSummary = () => axios.get(`${ALERT_API_BASE}/alerts/summary`).then(r => r.data);
const fetchRecentAlerts = () => axios.get(`${ALERT_API_BASE}/alerts/recent`).then(r => r.data);
const fetchAdminUsers = () => axios.get(`${API_BASE}/admin/users`).then(r => r.data);
const fetchAdminOverview = () => axios.get(`${API_BASE}/admin/overview`).then(r => r.data);
const fetchAdminResources = (type?: string) => {
  const params = type ? `?resource_type=${type}` : '';
  return axios.get(`${API_BASE}/admin/resources${params}`).then(r => r.data);
};
const fetchFinOpsResourceSummary = () => axios.get(`${API_BASE}/finops/resource-summary`).then(r => r.data);
const fetchUserSummary = () => axios.get(`${API_BASE}/admin/user-summary`).then(r => r.data);
const fetchComplianceSummary = () => axios.get(`${API_BASE}/compliance/summary`).then(r => r.data);

// ─── Shared UI ────────────────────────────────────────────────────────────────
const MetricCard = ({ title, value, sub, icon: Icon, color }: any) => (
  <div className="glass-panel rounded-2xl p-5 relative overflow-hidden group hover:-translate-y-1 transition-all duration-300 cursor-default">
    <div className={`absolute top-0 right-0 p-3 opacity-10 transform translate-x-4 -translate-y-4 group-hover:scale-110 transition-transform ${color}`}>
      <Icon size={80} />
    </div>
    <div className="relative z-10">
      <p className="text-xs dark:text-gray-400 text-gray-500 font-medium mb-1 uppercase tracking-wider">{title}</p>
      <p className="text-3xl font-bold dark:text-white text-gray-900 mb-1">{value}</p>
      <p className={`text-xs font-medium ${color}`}>{sub}</p>
    </div>
    <div className={`absolute bottom-0 left-0 h-0.5 w-full bg-gradient-to-r from-transparent ${color.replace('text-', 'via-').replace('400', '500').replace('emerald', 'emerald').replace('400','400')} to-transparent opacity-30`} />
  </div>
);

const SeverityBadge = ({ severity }: { severity: string }) => {
  const s: Record<string, string> = {
    critical: 'dark:bg-red-500/20 bg-red-50 text-red-500 dark:text-red-400 border-red-500/30',
    high:     'dark:bg-orange-500/20 bg-orange-50 text-orange-600 dark:text-orange-400 border-orange-500/30',
    medium:   'dark:bg-yellow-500/20 bg-yellow-50 text-yellow-600 dark:text-yellow-400 border-yellow-500/30',
    low:      'dark:bg-gray-500/20 bg-gray-50 text-gray-600 dark:text-gray-400 border-gray-500/30',
  };
  return <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border shadow-sm ${s[severity] ?? s.low}`}>{severity}</span>;
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
    const token = localStorage.getItem('cloudguard_token');
    axios.get(`${ALERT_API_BASE}/alerts/recent?limit=10`).then(r => { if (alive) setItems(r.data); }).catch(() => {});
    
    // Pass token in query param for SSE auth
    const sse = new EventSource(`${ALERT_API_BASE}/alerts/stream?token=${token}`);
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
      <div className="p-4 border-b dark:border-dark-700 border-gray-100 dark:bg-dark-800 bg-gray-50 flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2 dark:text-white text-gray-900">
          <Bell size={16} className="text-yellow-400" /> Live Alert Stream
        </h3>
        <span className="flex h-2.5 w-2.5 relative">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 dark:bg-transparent bg-white/50">
        {items.map((a, i) => (
          <div key={i} className="p-3 dark:bg-dark-700/50 bg-white hover:dark:bg-dark-700 hover:bg-gray-50 rounded-lg border dark:border-dark-600 border-gray-100 transition-colors shadow-sm">
            <div className="flex justify-between items-center mb-1">
              <SeverityBadge severity={a.severity} />
              <span className="text-xs text-gray-500">{new Date(a.timestamp || a.created_at).toLocaleTimeString()}</span>
            </div>
            <p className="text-xs dark:text-gray-300 text-gray-600 mt-1.5 leading-relaxed">{a.message}</p>
          </div>
        ))}
        {items.length === 0 && <p className="text-center text-gray-500 text-sm py-8 font-medium">Waiting for events…</p>}
      </div>
    </div>
  );
};

// ─── Sidebar ──────────────────────────────────────────────────────────────────
interface NavItem { path: string; icon: React.ReactNode; label: string; }
const Sidebar = ({ navItems }: { navItems: NavItem[] }) => {
  const { pathname } = useLocation();
  const { email, role, logout } = useAuth();
  return (
    <aside className="w-64 glass-panel border-r dark:border-dark-700 border-gray-100 flex flex-col shrink-0">
      <div className="p-5 flex items-center gap-3 border-b dark:border-dark-700 border-gray-100 italic font-mono">
        <div className="p-2 bg-brand rounded-lg shadow-[0_0_15px_rgba(59,130,246,0.5)]">
          <Cloud size={20} className="text-white" />
        </div>
        <div>
          <span className="font-bold tracking-wide block dark:text-white text-gray-900">CloudGuard</span>
          <span className="text-[10px] dark:text-gray-500 text-gray-400 uppercase tracking-widest font-bold">Governance</span>
        </div>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(item => (
          <Link key={item.path} to={item.path}>
            <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all text-sm ${
              pathname === item.path
                ? 'bg-brand/10 text-brand border border-brand/20 font-semibold shadow-sm'
                : 'dark:text-gray-400 text-gray-500 dark:hover:bg-dark-700 hover:bg-gray-100 dark:hover:text-gray-200 hover:text-gray-900'
            }`}>
              {item.icon}
              <span>{item.label}</span>
            </div>
          </Link>
        ))}
      </nav>
      <div className="p-4 border-t dark:border-dark-700 border-gray-100 space-y-2">
        <div className="flex items-center gap-3 p-3 rounded-xl dark:bg-dark-700/50 bg-gray-50 border dark:border-dark-600 border-gray-200">
          <div className="w-8 h-8 rounded-full bg-brand/20 border border-brand/30 flex items-center justify-center text-brand font-bold text-sm shrink-0">
            {email.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium dark:text-gray-200 text-gray-900 truncate">{email}</p>
            <p className="text-[10px] dark:text-gray-500 text-gray-400 mt-0.5">{getRoleLabel(role)}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <ThemeToggle />
          <button onClick={logout} className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg dark:text-gray-400 text-gray-500 dark:hover:text-red-400 hover:text-red-500 dark:hover:bg-red-500/10 hover:bg-red-500/5 transition-colors text-xs border border-transparent hover:border-red-500/20">
            <LogOut size={14} /> Out
          </button>
        </div>
      </div>
    </aside>
  );
};

const ThemeToggle = () => {
  const { theme, toggleTheme } = useAuth();
  return (
    <button
      onClick={toggleTheme}
      className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg dark:text-gray-400 text-gray-500 dark:hover:text-brand hover:text-brand dark:hover:bg-brand/10 hover:bg-brand/5 transition-all text-xs border border-transparent hover:border-brand/20"
      title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
    >
      {theme === 'dark' ? <><Sun size={14} /> Light</> : <><Moon size={14} /> Dark</>}
    </button>
  );
};

const Layout = ({ children, nav }: { children: React.ReactNode; nav: NavItem[] }) => {
  const { theme } = useAuth();
  return (
    <div className={`flex h-screen overflow-hidden ${theme === 'dark' ? 'bg-dark-900 text-gray-100' : 'bg-gray-50 text-gray-900'}`}>
      <Sidebar navItems={nav} />
      <main className="flex-1 overflow-y-auto relative bg-transparent">
        <div className="absolute top-0 w-full h-1 bg-gradient-to-r from-brand via-purple-500 to-brand opacity-30 z-10" />
        <div className="p-8 pb-16 relative z-0">{children}</div>
        {/* Dynamic Background */}
        <div className="fixed inset-0 z-[-1] pointer-events-none overflow-hidden">
          <div className="absolute top-0 left-1/4 w-[600px] h-[600px] dark:bg-brand/5 bg-brand/10 rounded-full blur-[120px] opacity-40 animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] dark:bg-purple-500/5 bg-purple-500/10 rounded-full blur-[100px] opacity-30" />
        </div>
      </main>
    </div>
  );
};

// ─── FINOPS DASHBOARD ─────────────────────────────────────────────────────────
const FinOpsDashboard = () => {
  const { theme } = useAuth();
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
            <p className="dark:text-gray-400 text-gray-500 text-sm font-medium">Cost optimisation · Waste detection · Savings insights</p>
          </div>
          <span className="text-[10px] bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 border border-emerald-500/20 px-3 py-1.5 rounded-full font-bold uppercase tracking-wider">Live Data</span>
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

        <div className="glass-panel rounded-2xl p-6 relative overflow-hidden">
          <h3 className="font-semibold mb-4 flex items-center gap-2 dark:text-white text-gray-900"><BarChart2 size={18} className="text-brand" /> Cost Trend — Last 30 Days</h3>
          {tdLoad ? <Spinner /> : (
            <div className="h-52">
              <Line 
                data={trendChart} 
                options={{ 
                  responsive: true, 
                  maintainAspectRatio: false, 
                  plugins: { legend: { display: false } }, 
                  scales: { 
                    y: { 
                      grid: { color: theme === 'dark' ? '#1f2937' : '#e5e7eb' }, 
                      ticks: { color: theme === 'dark' ? '#9ca3af' : '#6b7280', font: { size: 10 } } 
                    }, 
                    x: { 
                      grid: { display: false }, 
                      ticks: { color: theme === 'dark' ? '#9ca3af' : '#6b7280', maxTicksLimit: 8, font: { size: 10 } } 
                    } 
                  } 
                }} 
              />
            </div>
          )}
        </div>

        <div className="glass-panel rounded-2xl overflow-hidden mb-6">
          <div className="p-4 border-b dark:border-dark-700 border-gray-100 dark:bg-dark-800 bg-gray-50 flex justify-between items-center">
            <h3 className="font-semibold flex items-center gap-2 dark:text-white text-gray-900"><DollarSign size={18} className="text-emerald-500" /> Top Savings Opportunities</h3>
          </div>
          {svLoad ? <Spinner /> : (
            <div className="divide-y dark:divide-dark-700/50 divide-gray-100">
              {(savings ?? []).slice(0, 6).map((item: any, i: number) => (
                <div key={i} className="flex justify-between items-center px-6 py-4 dark:hover:bg-dark-800/50 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-7 h-7 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 dark:text-emerald-400 text-xs font-bold shadow-sm">{i+1}</div>
                    <div>
                      <p className="text-sm font-semibold dark:text-gray-200 text-gray-800">{item.message}</p>
                      <SeverityBadge severity={item.severity} />
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <p className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">${parseFloat(item.details?.estimated_savings ?? 0).toFixed(0)}/mo</p>
                    <button className="mt-1 text-[10px] font-bold uppercase tracking-wider dark:bg-dark-600 bg-white hover:dark:bg-emerald-500/20 hover:bg-emerald-50 dark:text-gray-400 text-gray-600 hover:text-emerald-600 dark:hover:text-emerald-400 px-3 py-1 rounded transition-colors border dark:border-dark-500 border-gray-200 hover:dark:border-emerald-500/30 hover:border-emerald-200 shadow-sm">Review</button>
                  </div>
                </div>
              ))}
              {!(savings?.length) && <p className="py-12 text-center text-gray-500 italic">No savings opportunities detected</p>}
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
                <div key={i} className="flex justify-between items-center p-4 dark:bg-dark-700/50 bg-gray-50 rounded-xl border dark:border-dark-600 border-gray-100 dark:hover:bg-dark-700 hover:bg-gray-100 transition-colors">
                  <div>
                    <p className="font-medium text-sm dark:text-white text-gray-900">{r.label}</p>
                    <p className="text-xs dark:text-gray-400 text-gray-500 mt-0.5">{r.desc}</p>
                  </div>
                  <span className={`text-xs font-bold px-3 py-1.5 rounded-lg border ml-4 shrink-0 shadow-sm ${r.cls}`}>{r.badge}</span>
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
          <h1 className="text-3xl font-bold flex items-center gap-3 mb-1 dark:text-white text-gray-900"><ShieldCheck className="text-purple-500" /> Compliance Posture</h1>
          <p className="dark:text-gray-400 text-gray-500 text-sm font-medium">Framework adherence · Violations · Audit tracking</p>
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
                    <span className="text-4xl font-bold dark:text-white text-gray-900">{comp?.overall_score}%</span>
                    <span className="text-xs dark:text-gray-400 text-gray-500 mt-0.5 font-medium">Compliance</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 w-full">
                  {/* ... */}
                  {[{l:'Critical',v:comp?.critical_violations??0,c:'text-red-400'},{l:'High',v:comp?.high_violations??0,c:'text-orange-400'},{l:'Medium',v:comp?.medium_violations??0,c:'text-yellow-400'},{l:'Low',v:comp?.low_violations??0,c:'text-blue-400'}].map(x=>(
                    <div key={x.l} className="text-center p-2 dark:bg-dark-700/50 bg-gray-50 rounded-lg border dark:border-dark-600 border-gray-100">
                      <p className={`text-xl font-bold ${x.c}`}>{x.v}</p>
                      <p className="text-[10px] dark:text-gray-500 text-gray-400 uppercase tracking-wider mt-0.5 font-medium">{x.l}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="glass-panel rounded-2xl p-6 lg:col-span-3">
                <h3 className="font-semibold mb-4 flex items-center gap-2 dark:text-white text-gray-900"><BarChart2 size={18} className="text-purple-500" /> By Framework Category</h3>
                <div className="space-y-4">
                  {Object.entries(comp?.by_category??{}).map(([cat,val]:any) => (
                    <div key={cat}>
                      <div className="flex justify-between text-sm mb-1.5 font-medium">
                        <span className="dark:text-gray-300 text-gray-600 capitalize">{cat.replace(/_/g,' ')}</span>
                        <span className={`font-bold ${val>80?'text-emerald-500':'text-orange-500'}`}>{val}%</span>
                      </div>
                      <div className="w-full dark:bg-dark-700 bg-gray-100 rounded-full h-2 shadow-inner">
                        <div className={`h-2 rounded-full transition-all duration-700 ${val>80?'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]':'bg-orange-500'}`} style={{width:`${val}%`}} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="glass-panel rounded-2xl overflow-hidden mt-6">
          <div className="p-4 border-b dark:border-dark-700 border-gray-100 dark:bg-dark-800 bg-gray-50 flex justify-between items-center">
            <h3 className="font-semibold flex items-center gap-2 dark:text-white text-gray-900"><AlertTriangle size={18} className="text-yellow-500" /> Recent Violations</h3>
            <span className="text-[10px] font-bold dark:text-gray-500 text-gray-400 uppercase tracking-widest">{violations?.length ?? 0} records</span>
          </div>
          {vlLoad ? <Spinner /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-[10px] font-bold uppercase tracking-wider dark:text-gray-400 text-gray-500 dark:bg-dark-800/60 bg-gray-50">
                  <tr>{['Rule','Severity','Resource Type','Region','Status','Date'].map(h=><th key={h} className="px-5 py-3">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y dark:divide-dark-700/50 divide-gray-100">
                  {(violations??[]).map((v:any,i:number)=>(
                    <tr key={i} className="dark:hover:bg-dark-800/50 hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 text-sm font-medium dark:text-gray-200 text-gray-800">{v.rule_name}</td>
                      <td className="px-5 py-3"><SeverityBadge severity={v.severity} /></td>
                      <td className="px-5 py-3 text-xs dark:text-gray-400 text-gray-500 font-medium">{v.resource_type??'—'}</td>
                      <td className="px-5 py-3 text-xs dark:text-gray-400 text-gray-500">{v.region??'—'}</td>
                      <td className="px-5 py-3"><span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border shadow-sm ${v.status==='open'?'bg-red-500/10 text-red-500 border-red-500/30':'dark:bg-gray-500/10 bg-gray-100 dark:text-gray-400 text-gray-500 border-gray-500/30'}`}>{v.status}</span></td>
                      <td className="px-5 py-3 text-xs text-gray-500">{new Date(v.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

const ITAdminDashboard = () => {
  const { theme } = useAuth();
  const { data: alerts, isLoading } = useQuery({ queryKey: ['alerts-all'], queryFn: () => fetchAlerts(100) });
  const { data: summary } = useQuery({ queryKey: ['alerts-summary'], queryFn: fetchAlertSummary });
  const { data: recent } = useQuery({ queryKey: ['alerts-recent'], queryFn: fetchRecentAlerts });

  const nav: NavItem[] = [
    { path: '/dashboard/infra', icon: <Monitor size={17} />, label: 'Infrastructure Monitor' },
    { path: '/dashboard/infra', icon: <Bell size={17} />,    label: 'Alert Center' },
  ];

  const counts = summary || { critical: 0, high: 0, medium: 0, low: 0 };
  const total = counts.total || 0;
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
          <h1 className="text-3xl font-bold flex items-center gap-3 mb-1 dark:text-white text-gray-900"><Server className="text-cyan-500" /> Infrastructure Monitor</h1>
          <p className="dark:text-gray-400 text-gray-500 text-sm font-medium">Resource health · Alert monitoring · Live event stream</p>
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
            <h3 className="font-semibold mb-4 flex items-center gap-2 dark:text-white text-gray-900"><BarChart2 size={18} className="text-cyan-500" /> Alert Severity Breakdown</h3>
            {isLoading ? <Spinner /> : (
              <div className="flex-1">
                <Bar 
                  data={barData} 
                  options={{ 
                    responsive:true, 
                    maintainAspectRatio:false, 
                    plugins:{legend:{display:false}}, 
                    scales:{ 
                      y:{ grid:{color:theme === 'dark' ? '#1f2937' : '#e5e7eb'}, ticks:{color:theme === 'dark' ? '#9ca3af' : '#6b7280', font:{size:10}} }, 
                      x:{ grid:{display:false}, ticks:{color:theme === 'dark' ? '#9ca3af' : '#6b7280', font:{size:10}} } 
                    } 
                  }} 
                />
              </div>
            )}
          </div>
          <div className="lg:col-span-3 h-full">
            <AlertFeed />
          </div>
        </div>

        <div className="glass-panel rounded-2xl overflow-hidden mt-6">
          <div className="p-4 border-b dark:border-dark-700 border-gray-100 dark:bg-dark-800 bg-gray-50 flex justify-between items-center">
            <h3 className="font-semibold flex items-center gap-2 dark:text-white text-gray-900"><Activity size={18} className="text-cyan-500" /> Recent Alerts</h3>
            <button className="text-[10px] font-bold uppercase tracking-wider dark:bg-dark-600 bg-white hover:dark:bg-dark-500 hover:bg-gray-50 dark:border-dark-500 border-gray-200 dark:text-gray-300 text-gray-600 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 shadow-sm border"><CheckCircle size={13}/> Acknowledge All</button>
          </div>
          {isLoading ? <Spinner /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="text-[10px] font-bold uppercase tracking-wider dark:text-gray-400 text-gray-500 dark:bg-dark-800/60 bg-gray-50">
                  <tr>{['Severity','Type','Message','Time','Status'].map(h=><th key={h} className="px-5 py-3">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y dark:divide-dark-700/50 divide-gray-100">
                  {(recent??[]).slice(0,15).map((a:any,i:number)=>(
                    <tr key={i} className="dark:hover:bg-dark-800/50 hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3"><SeverityBadge severity={a.severity}/></td>
                      <td className="px-5 py-3 text-[10px] font-bold text-brand uppercase tracking-widest">{a.type}</td>
                      <td className="px-5 py-3 text-sm font-medium dark:text-gray-200 text-gray-800 max-w-md truncate">{a.message}</td>
                      <td className="px-5 py-3 text-xs dark:text-gray-500 text-gray-400">{new Date(a.timestamp || a.created_at).toLocaleString()}</td>
                      <td className="px-5 py-3"><span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border shadow-sm ${a.status==='active'?'bg-red-500/10 text-red-500 border-red-500/30':'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'}`}>{a.status}</span></td>
                    </tr>
                  ))}
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
// Resource type badges
const RESOURCE_ICONS: Record<string, React.ReactNode> = {
  ec2:    <Server size={12} className="text-cyan-400" />,
  s3:     <Database size={12} className="text-amber-400" />,
  lambda: <Activity size={12} className="text-purple-400" />,
};

const ResourceTypeBadge = ({ type }: { type: string }) => {
  const c: Record<string,string> = {
    ec2:    'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
    s3:     'bg-amber-500/10 text-amber-400 border-amber-500/30',
    lambda: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded border uppercase ${c[type] ?? 'bg-gray-500/10 text-gray-400 border-gray-500/30'}`}>
      {RESOURCE_ICONS[type]}{type}
    </span>
  );
};

const IdleBadge = ({ idle }: { idle: boolean }) => idle
  ? <span className="text-xs font-bold px-2 py-0.5 rounded border bg-amber-500/15 text-amber-400 border-amber-500/30">IDLE</span>
  : <span className="text-xs font-bold px-2 py-0.5 rounded border bg-emerald-500/10 text-emerald-400 border-emerald-500/30">ACTIVE</span>;

// Resources Tab
const ResourcesTab = () => {
  const { theme } = useAuth();
  const [typeFilter, setTypeFilter] = React.useState<string>('all');
  const [refreshKey, setRefreshKey] = React.useState(0);

  const { data: overview, isLoading: ovLoad } = useQuery({
    queryKey: ['admin-overview', refreshKey],
    queryFn: fetchAdminOverview,
    refetchInterval: 10_000,
  });

  const { data: resources, isLoading: resLoad } = useQuery({
    queryKey: ['admin-resources', typeFilter, refreshKey],
    queryFn: () => fetchAdminResources(typeFilter === 'all' ? undefined : typeFilter),
    refetchInterval: 30_000,
  });

  // SSE — refetch resources when any alert fires
  useEffect(() => {
    const token = localStorage.getItem('cloudguard_token');
    const sse = new EventSource(`${ALERT_API_BASE}/alerts/stream?token=${token}`);
    const handler = () => setRefreshKey(k => k + 1);
    sse.addEventListener('alert', handler);
    return () => {
      sse.removeEventListener('alert', handler);
      sse.close();
    };
  }, []);

  const allResources: any[] = resources ?? [];
  const idleCount = allResources.filter((r: any) => r.idle).length;
  const types = ['all', 'ec2', 's3', 'lambda'];

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {ovLoad ? <Spinner /> : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <MetricCard title="Total Resources"  value={overview?.total_resources ?? 0}    sub="Discovered by collector"  icon={Cloud}       color="text-brand" />
          <MetricCard title="Running"          value={overview?.running_resources ?? 0}  sub="Currently active"          icon={Server}      color="text-emerald-400" />
          <MetricCard title="Idle Resources"   value={overview?.idle_resources ?? 0}     sub="Wasting cost right now"   icon={Activity}    color="text-amber-400" />
          <MetricCard title="Est. Savings"     value={`$${(overview?.estimated_savings ?? 0).toFixed(2)}`} sub="Stop idle to reclaim" icon={DollarSign} color="text-emerald-400" />
          <MetricCard title="Compliance"       value={`${overview?.compliance_score ?? 0}%`} sub="Policy adherence"     icon={ShieldCheck} color={(overview?.compliance_score ?? 0) > 80 ? 'text-emerald-400' : 'text-orange-400'} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Resource Table */}
        <div className="lg:col-span-2 glass-panel rounded-2xl overflow-hidden flex flex-col h-full">
          <div className="p-4 border-b dark:border-dark-700 border-gray-100 dark:bg-dark-800 bg-gray-50 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Server size={17} className="text-cyan-500" />
              <h3 className="font-semibold text-sm dark:text-white text-gray-900">AWS Resources</h3>
              {resLoad && <div className="h-3.5 w-3.5 animate-spin rounded-full border-t border-brand border-r" />}
            </div>
            <div className="flex gap-1.5 p-1 dark:bg-dark-900/50 bg-gray-100 rounded-xl border dark:border-dark-700 border-gray-200">
              {types.map(t => (
                <button key={t} id={`resource-filter-${t}`}
                  onClick={() => setTypeFilter(t)}
                  className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition-all ${
                    typeFilter === t
                      ? 'bg-brand text-white border-brand shadow-sm'
                      : 'dark:text-gray-400 text-gray-500 border-transparent hover:dark:text-gray-200 hover:text-gray-900'
                  }`}>
                  {t === 'all' ? 'All' : t}
                </button>
              ))}
            </div>
          </div>

          {idleCount > 0 && (
            <div className="bg-amber-500/8 border-b border-amber-500/20 px-5 py-2.5 flex items-center gap-2">
              <AlertTriangle size={13} className="text-amber-400 shrink-0" />
              <p className="text-xs text-amber-300">
                <strong>{idleCount} idle {idleCount === 1 ? 'resource' : 'resources'}</strong> detected — stopping them could save <strong>${(overview?.estimated_savings ?? 0).toFixed(2)}</strong>/month
              </p>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-[10px] font-bold uppercase tracking-wider dark:text-gray-400 text-gray-500 dark:bg-dark-800/60 bg-gray-50/50">
                <tr>{['Type','Resource ID','IAM User','State','CPU / Size','Activity','Cost/mo','Status','Action'].map(h=>(
                  <th key={h} className="px-4 py-3 whitespace-nowrap">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y dark:divide-dark-700/50 divide-gray-100">
                {allResources.map((r: any, i: number) => (
                  <tr key={i} className={`dark:hover:bg-dark-800/50 hover:bg-gray-50 transition-colors ${r.idle ? 'dark:bg-amber-900/10 bg-amber-50/50' : ''}`}>
                    <td className="px-4 py-3"><ResourceTypeBadge type={r.type} /></td>
                    <td className="px-4 py-3 text-[11px] dark:text-gray-200 text-gray-800 font-mono max-w-[140px] truncate" title={r.resource_id}>{r.name || r.resource_id}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md dark:bg-dark-700 bg-gray-100 border dark:border-dark-600 border-gray-200 text-[10px] font-bold dark:text-gray-300 text-gray-600 uppercase">
                        <Users size={12} className="text-brand opacity-70" />
                        {r.iam_user || 'Unknown'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border shadow-sm ${r.state === 'running' || r.state === 'active' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' : 'dark:bg-gray-500/10 bg-gray-100 dark:text-gray-400 text-gray-500 border-gray-500/30'}`}>{r.state}</span>
                    </td>
                    <td className="px-4 py-3 text-[11px] font-medium dark:text-gray-300 text-gray-600 tracking-tight">
                      {r.cpu != null ? <span className={Number(r.cpu) > 80 ? 'text-red-500' : ''}>{r.cpu}% CPU</span> : r.size_mb != null ? `${r.size_mb} MB` : '—'}
                    </td>
                    <td className="px-4 py-3 text-[11px] dark:text-gray-500 text-gray-400">{r.last_activity ? new Date(r.last_activity).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3 text-[11px] font-bold dark:text-gray-200 text-gray-800">{Number(r.estimated_cost) > 0 ? `$${Number(r.estimated_cost).toFixed(2)}` : <span className="text-emerald-500">Free</span>}</td>
                    <td className="px-4 py-3"><IdleBadge idle={r.idle} /></td>
                    <td className="px-4 py-3">
                      {r.idle ? (
                        <button id={`action-${r.resource_id}`}
                          className="text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 px-2.5 py-1 rounded-lg transition-all shadow-sm"
                          title={r.recommendation ?? ''}>
                          Optimize
                        </button>
                      ) : <span className="text-xs text-gray-400 opacity-30">—</span>}
                    </td>
                  </tr>
                ))}
                {!resLoad && allResources.length === 0 && (
                  <tr><td colSpan={8} className="py-16 text-center text-gray-500">
                    <Cloud size={28} className="mx-auto mb-2 opacity-30" />
                    No resources found. Collector may still be running its first cycle.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Live Alert Stream */}
        <div className="h-[560px]"><AlertFeed /></div>
      </div>
    </div>
  );
};

const CloudAdminDashboard = () => {
  const { theme } = useAuth();
  const [tab, setTab] = useState<'overview'|'resources'|'users'|'export'>('overview');
  const { data: fp,         isLoading: fpLoad } = useQuery({ queryKey: ['finops'],      queryFn: fetchFinOps });
  const { data: comp,       isLoading: cpLoad } = useQuery({ queryKey: ['compliance'],  queryFn: fetchCompliance });
  const { data: trends,     isLoading: tdLoad } = useQuery({ queryKey: ['trends'],      queryFn: fetchTrends });
  const { data: adminUsers, isLoading: auLoad } = useQuery({ queryKey: ['admin-users'], queryFn: fetchAdminUsers, enabled: tab === 'users' });
  const { data: finRes,     isLoading: fResLoad } = useQuery({ queryKey: ['finops-res-sum'], queryFn: fetchFinOpsResourceSummary });
  const { data: usum,       isLoading: uLoad } = useQuery({ queryKey: ['user-sum'], queryFn: fetchUserSummary });

  const nav: NavItem[] = [
    { path:'/dashboard/admin',      icon:<Crown size={17}/>,       label:'Admin Overview' },
    { path:'/dashboard/finops',     icon:<TrendingDown size={17}/>, label:'FinOps'         },
    { path:'/dashboard/compliance', icon:<ShieldCheck size={17}/>,  label:'Compliance'     },
    { path:'/dashboard/infra',      icon:<Monitor size={17}/>,      label:'Infrastructure' },
    { path:'export',                icon:<Download size={17}/>,     label:'Export Center'  },
  ];

  const trendChart = {
    labels: trends?.map((t:any)=>t.date)??[],
    datasets:[{ label:'Daily Cost ($)', data:trends?.map((t:any)=>t.cost)??[], borderColor:'#3b82f6', backgroundColor:'rgba(59,130,246,0.08)', borderWidth:2, fill:true, tension:0.4, pointRadius:3 }]
  };

  const roleColors: Record<string,string> = {
    cloud_admin:'bg-purple-500/20 text-purple-400 border-purple-500/30',
    admin:'bg-purple-500/20 text-purple-400 border-purple-500/30',
    finops_manager:'bg-blue-500/20 text-blue-400 border-blue-500/30',
    compliance_manager:'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    it_admin:'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    viewer:'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };

  return (
    <Layout nav={nav}>
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3 mb-1 dark:text-white text-gray-900"><Crown className="text-yellow-500" /> Cloud Administration</h1>
            <p className="dark:text-gray-400 text-gray-500 text-sm font-medium">Full platform visibility · Resource monitoring · User management</p>
          </div>
          <div className="flex dark:bg-dark-800 bg-gray-50 border dark:border-dark-600 border-gray-200 rounded-xl p-1 gap-1 shadow-sm">
            {(['overview','resources','users','export'] as const).map(t=>(
              <button key={t} id={`admin-tab-${t}`} onClick={()=>setTab(t)}
                className={`px-4 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all ${tab===t?'bg-brand text-white shadow-sm':'dark:text-gray-400 text-gray-500 hover:dark:text-gray-200 hover:text-gray-900'}`}>
                {t==='overview' ? 'Overview' : t==='resources' ? '🔍 Resources' : t==='users' ? 'Users' : 'Export'}
              </button>
            ))}
          </div>
        </div>

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <>
            {(fpLoad||cpLoad) ? <Spinner /> : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard title="Savings Potential"   value={`$${(fp?.total_savings_potential??0).toLocaleString()}`} sub="Cloud waste detected"     icon={DollarSign}   color="text-emerald-400"/>
                <MetricCard title="Compliance Score"    value={`${comp?.overall_score??0}%`}                           sub={`${comp?.active_violations??0} violations`} icon={ShieldCheck}  color={comp?.overall_score>80?'text-emerald-400':'text-orange-400'}/>
                <MetricCard title="Critical Violations" value={comp?.critical_violations??0}                           sub="Requires immediate action" icon={AlertTriangle} color="text-red-400"/>
                <MetricCard title="Idle Resources"      value={fp?.idle_resources??0}                                  sub="Running < 5% CPU"          icon={Activity}     color="text-yellow-400"/>
              </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 glass-panel rounded-2xl p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2 dark:text-white text-gray-900"><BarChart2 size={18} className="text-brand"/>Cost Trend — Last 30 Days</h3>
                {tdLoad ? <Spinner /> : (
                  <div className="h-52">
                    <Line 
                      data={trendChart} 
                      options={{ 
                        responsive:true, 
                        maintainAspectRatio:false, 
                        plugins:{legend:{display:false}}, 
                        scales:{ 
                          y:{ grid:{color:theme === 'dark' ? '#1f2937' : '#e5e7eb'}, ticks:{color:theme === 'dark' ? '#9ca3af' : '#6b7280', font:{size:10}} }, 
                          x:{ grid:{display:false}, ticks:{color:theme === 'dark' ? '#9ca3af' : '#6b7280', maxTicksLimit:8, font:{size:10}} } 
                        } 
                      }} 
                    />
                  </div>
                )}
              </div>
              <div className="h-80"><AlertFeed /></div>
            </div>
            {cpLoad ? null : (
              <div className="glass-panel rounded-2xl p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2 dark:text-white text-gray-900"><ShieldCheck size={18} className="text-purple-500"/>Compliance by Category</h3>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {Object.entries(comp?.by_category??{}).map(([cat,val]:any)=>(
                    <div key={cat} className="p-4 dark:bg-dark-800 bg-gray-50 rounded-xl border dark:border-dark-600 border-gray-100 shadow-sm">
                      <div className="flex justify-between mb-2">
                        <span className="text-sm dark:text-gray-300 text-gray-600 font-medium capitalize">{cat.replace(/_/g,' ')}</span>
                        <span className={`text-sm font-bold ${val>80?'text-emerald-500':'text-orange-500'}`}>{val}%</span>
                      </div>
                      <div className="w-full dark:bg-dark-900 bg-gray-100 rounded-full h-1.5 shadow-inner">
                        <div className={`h-1.5 rounded-full ${val>80?'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.2)]':'bg-orange-500'}`} style={{width:`${val}%`}}/>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
              <div className="glass-panel rounded-2xl p-6">
                  <h3 className="font-semibold mb-4 flex items-center gap-2 dark:text-white text-gray-900"><DollarSign size={18} className="text-emerald-500"/>FinOps Resource Summary</h3>
                  {fResLoad ? <Spinner /> : (
                    <div className="space-y-4">
                      <div className="flex justify-between items-center p-3 dark:bg-dark-800 bg-gray-50 rounded-lg border dark:border-dark-600 border-gray-100 shadow-sm">
                        <span className="dark:text-gray-400 text-gray-500 font-medium">Total Running Cost</span>
                        <span className="text-xl font-bold dark:text-white text-gray-900">${(finRes?.total_cost??0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center p-3 dark:bg-dark-800 bg-gray-50 rounded-lg border dark:border-dark-600 border-gray-100 shadow-sm">
                        <span className="dark:text-gray-400 text-gray-500 font-medium">Total Idle Cost</span>
                        <span className="text-xl font-bold text-amber-500 dark:text-amber-400">${(finRes?.idle_cost??0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/30 shadow-sm">
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider text-xs">Potential Savings</span>
                        <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400">${(finRes?.potential_savings??0).toFixed(2)}</span>
                      </div>
                    </div>
                  )}
              </div>
              
              <div className="glass-panel rounded-2xl p-6 overflow-hidden flex flex-col h-full max-h-80">
                  <h3 className="font-semibold mb-4 flex items-center gap-2 dark:text-white text-gray-900"><Users size={18} className="text-brand"/>Leaderboard</h3>
                  {uLoad ? <Spinner /> : (
                    <div className="flex-1 overflow-y-auto pr-2 space-y-3 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-dark-600">
                      {!(usum?.length) ? <p className="text-gray-500 text-sm text-center py-4 italic">No data collected yet</p> : (usum).map((u:any, i:number) => (
                         <div key={i} className="flex flex-col gap-2 p-3 dark:bg-dark-800 bg-white rounded-lg border dark:border-dark-600 border-gray-100 hover:border-brand/30 transition-all shadow-sm">
                           <div className="flex justify-between items-center">
                             <div className="flex items-center gap-2">
                               <div className="w-6 h-6 rounded-full bg-brand/10 border border-brand/20 flex items-center justify-center text-brand text-[10px] font-bold shrink-0 shadow-sm">{u.iam_user.charAt(0).toUpperCase()}</div>
                               <span className="text-sm font-semibold dark:text-gray-200 text-gray-800 truncate max-w-[150px]">{u.iam_user}</span>
                             </div>
                             <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">${u.total_cost.toFixed(0)}</span>
                           </div>
                           <div className="flex justify-between text-[10px] font-medium dark:text-gray-500 text-gray-400 uppercase tracking-tight">
                             <span>{u.resource_count} resources</span>
                             <span className={u.idle_resources > 0 ? "text-amber-600 dark:text-amber-400" : ""}>{u.idle_resources} idle</span>
                           </div>
                         </div>
                      ))}
                    </div>
                  )}
              </div>
            </div>
          </>
        )}

        {/* ── RESOURCES ── */}
        {tab === 'resources' && <ResourcesTab />}

        {/* ── USERS ── */}
        {tab === 'users' && (
          <div className="glass-panel rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-dark-700 bg-dark-800 flex justify-between items-center">
              <h3 className="font-semibold flex items-center gap-2"><Users size={18} className="text-yellow-400"/>User Management</h3>
              <span className="text-xs text-gray-500">{adminUsers?.length??0} users registered</span>
            </div>
            {auLoad ? <Spinner /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="text-xs text-gray-400 bg-dark-800/60">
                    <tr>{['Email','Role','Created'].map(h=><th key={h} className="px-6 py-3 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-dark-700/50">
                    {(adminUsers??[]).map((u:any,i:number)=>(
                      <tr key={i} className="hover:bg-dark-800/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-full bg-brand/20 border border-brand/30 flex items-center justify-center text-brand text-xs font-bold shrink-0">{u.email.charAt(0).toUpperCase()}</div>
                            <span className="text-sm dark:text-gray-200 text-gray-700 font-medium">{u.email}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-xs font-semibold px-2 py-1 rounded border ${roleColors[u.role]??'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>{getRoleLabel(u.role)}</span>
                        </td>
                        <td className="px-6 py-4 text-xs text-gray-500">{new Date(u.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                    {!adminUsers?.length && <tr><td colSpan={3} className="py-12 text-center text-gray-500">No users found</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── EXPORT ── */}
        {tab === 'export' && <ExportCenter />}
      </div>
    </Layout>
  );
};

const ExportCenter = () => {
  const [start, setStart] = useState(new Date(Date.now() - 86400000).toISOString().split('T')[0]);
  const [end, setEnd] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState<string | null>(null);

  const handleDownload = async (type: 'alerts' | 'usage') => {
    setLoading(type);
    try {
      const token = localStorage.getItem('cloudguard_token');
      const resp = await fetch(`${API_BASE}/admin/export/${type}?start_date=${start}&end_date=${end}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(`Download failed (${resp.status}): ${errorData.detail}`);
      }
      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}_export_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to download logs');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold dark:text-white text-gray-900 flex items-center gap-3">
            <Download className="text-brand" /> Data Export Center
          </h2>
          <p className="dark:text-gray-400 text-gray-500 text-sm font-medium">Filter and download system logs for auditing and analysis.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-panel p-6 rounded-2xl md:col-span-1 space-y-4">
          <h3 className="font-semibold dark:text-gray-200 text-gray-800 flex items-center gap-2">
            <Calendar size={18} className="text-brand" /> Date Filtering
          </h3>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-bold uppercase text-gray-500 mb-1 block">Start Date</label>
              <input type="date" value={start} onChange={e => setStart(e.target.value)}
                className="w-full dark:bg-dark-900 bg-white border dark:border-dark-700 border-gray-200 rounded-xl px-4 py-2 text-sm dark:text-white outline-none focus:border-brand transition-all" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-gray-500 mb-1 block">End Date</label>
              <input type="date" value={end} onChange={e => setEnd(e.target.value)}
                className="w-full dark:bg-dark-900 bg-white border dark:border-dark-700 border-gray-200 rounded-xl px-4 py-2 text-sm dark:text-white outline-none focus:border-brand transition-all" />
            </div>
          </div>
          <p className="text-[11px] text-gray-500 italic">Select a range to filter logs. Default is the last 24 hours.</p>
        </div>

        <div className="md:col-span-2 space-y-4">
          <div className="glass-panel p-6 rounded-2xl flex items-center justify-between group hover:border-brand/30 transition-all border border-transparent">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-red-500/10 flex items-center justify-center text-red-500 font-bold text-xl">
                <AlertCircle size={24} />
              </div>
              <div>
                <h4 className="font-bold dark:text-white text-gray-900">System Alerts Log</h4>
                <p className="text-xs dark:text-gray-400 text-gray-500">Includes security findings, idle resource warnings, and system status changes.</p>
              </div>
            </div>
            <button
              onClick={() => handleDownload('alerts')}
              disabled={!!loading}
              className="px-6 py-2.5 bg-brand hover:opacity-90 text-white rounded-xl font-bold text-sm shadow-lg shadow-brand/20 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {loading === 'alerts' ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" /> : <Download size={16} />}
              Export CSV
            </button>
          </div>

          <div className="glass-panel p-6 rounded-2xl flex items-center justify-between group hover:border-cyan-500/30 transition-all border border-transparent">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-500 font-bold text-xl">
                <BarChart size={24} />
              </div>
              <div>
                <h4 className="font-bold dark:text-white text-gray-900">Resource Usage Metrics</h4>
                <p className="text-xs dark:text-gray-400 text-gray-500">Detailed historical data on CPU, Memory, and estimated costs for cloud resources.</p>
              </div>
            </div>
            <button
              onClick={() => handleDownload('usage')}
              disabled={!!loading}
              className="px-6 py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-cyan-500/20 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {loading === 'usage' ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" /> : <Download size={16} />}
              Export CSV
            </button>
          </div>
        </div>
      </div>
    </div>
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
    <div className="h-screen w-full flex items-center justify-center dark:bg-dark-900 bg-gray-50 relative overflow-hidden transition-all">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] dark:from-brand/5 from-brand/10 dark:via-dark-900 via-transparent to-transparent" />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 dark:bg-brand/5 bg-brand/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 dark:bg-purple-500/5 bg-purple-500/10 rounded-full blur-3xl" />

      <div className="relative z-10 w-full max-w-md px-4">
        <div className="text-center mb-8">
          <div className="inline-flex p-3 bg-brand/10 border border-brand/20 rounded-2xl mb-4 shadow-xl backdrop-blur-sm">
            <Cloud size={32} className="text-brand" />
          </div>
          <h1 className="text-3xl font-bold dark:text-white text-gray-900 mb-1">CloudGuard</h1>
          <p className="dark:text-gray-400 text-gray-500 text-sm font-medium">Governance & FinOps Platform</p>
        </div>

        <div className="glass-panel rounded-2xl p-8 border dark:border-dark-700 border-gray-200/50 shadow-2xl">
          <h2 className="text-lg font-bold dark:text-white text-gray-800 mb-6">Sign in to your account</h2>
          {error && <div className="bg-red-500/10 border border-red-500/30 text-red-500 dark:text-red-400 px-4 py-3 rounded-xl mb-4 text-sm font-medium">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] dark:text-gray-400 text-gray-500 font-bold mb-1.5 uppercase tracking-widest">Email Address</label>
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
                className="w-full dark:bg-dark-800 bg-white border dark:border-dark-600 border-gray-200 rounded-xl px-4 py-3 dark:text-white text-gray-900 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all shadow-sm" />
            </div>
            <div>
              <label className="block text-[10px] dark:text-gray-400 text-gray-500 font-bold mb-1.5 uppercase tracking-widest">Password</label>
              <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
                className="w-full dark:bg-dark-800 bg-white border dark:border-dark-600 border-gray-200 rounded-xl px-4 py-3 dark:text-white text-gray-900 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 transition-all shadow-sm" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-brand hover:bg-blue-600 text-white font-bold py-3 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 mt-2 shadow-lg shadow-brand/20">
              {loading ? <><div className="animate-spin rounded-full h-4 w-4 border-t-2 border-white/50 border-r-2" /> Authenticating…</> : 'Sign In to CloudGuard'}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t dark:border-dark-700 border-gray-100">
            <p className="text-[10px] dark:text-gray-500 text-gray-400 mb-4 font-bold uppercase tracking-widest">Quick Developer Access</p>
            <div className="grid grid-cols-2 gap-3">
              {roles.map(r=>(
                <button key={r.email} onClick={()=>setEmail(r.email)}
                  className="text-[11px] font-medium dark:bg-dark-700 bg-gray-50 hover:dark:bg-dark-600 hover:bg-gray-100 border dark:border-dark-600 border-gray-200 dark:text-gray-300 text-gray-700 px-3 py-2.5 rounded-xl transition-all text-left shadow-sm">
                  <span className="block font-bold mb-0.5">{r.label}</span>
                  <span className="dark:text-gray-500 text-gray-400 truncate block text-[10px]">{r.email}</span>
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
  const [theme, setTheme]   = useState<'light' | 'dark'>('dark');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('cloudguard_token');
    const r     = localStorage.getItem('cloudguard_role') ?? '';
    const e     = localStorage.getItem('cloudguard_email') ?? '';
    const t     = localStorage.getItem('cloudguard_theme') as 'light' | 'dark' ?? 'dark';
    
    setTheme(t);
    if (t === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');

    if (token && r) {
      setAuthToken(token);
      setRole(r);
      setEmail(e);
      setAuthed(true);
    } else if (token || r) {
      // Inconsistent state, clear storage
      ['cloudguard_token','cloudguard_role','cloudguard_email'].forEach(k=>localStorage.removeItem(k));
    }

    // INTERCEPTOR: Handle 401 Unauthorized globally
    const interceptor = axios.interceptors.response.use(
      res => res,
      err => {
        if (err.response?.status === 401) logout();
        return Promise.reject(err);
      }
    );

    setLoading(false);
    return () => axios.interceptors.response.eject(interceptor);
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

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('cloudguard_theme', next);
    if (next === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  };

  if (loading) return (
    <div className="h-screen flex items-center justify-center dark:bg-dark-900 bg-gray-50">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-brand" />
    </div>
  );

  return (
    <AuthContext.Provider value={{ authed, role, email, login, logout, theme, toggleTheme }}>
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

import React, { createContext, useContext, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import {
  ShieldCheck, TrendingDown, Bell, Cloud, Activity, AlertTriangle,
  CheckCircle, DollarSign, Server, Users, Crown, BarChart2, Lock,
  LogOut, PiggyBank, Cpu, Monitor, Settings, Database, Sun, Moon,
  Download, AlertCircle, BarChart, Calendar, Globe, Zap, Shield
} from 'lucide-react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Title, Tooltip, Legend, ArcElement, Filler
} from 'chart.js';
import { Line, Doughnut, Bar } from 'react-chartjs-2';

// Import new page components
import { AdminOverview } from './pages/AdminOverview';
import { UserManagement } from './pages/UserManagement';
import { DepartmentSummary } from './pages/DepartmentSummary';
import { ResourceRegistry } from './pages/ResourceRegistry';
import { AuditLogs } from './pages/AuditLogs';

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

const GATEWAY_HOST = window.location.hostname;
const API_BASE = `http://${GATEWAY_HOST}:8000/api/v1`;

// ─── Theme Context ────────────────────────────────────────────────────────────
interface ThemeCtx { theme: 'light' | 'dark'; toggleTheme: () => void; }
const ThemeContext = createContext<ThemeCtx>({ theme: 'dark', toggleTheme: () => {} });
export const useTheme = () => useContext(ThemeContext);

// ─── Theme Provider ───────────────────────────────────────────────────────────
const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('cloudguard_theme') as 'light' | 'dark' | null;
    return saved || 'dark';
  });

  useEffect(() => {
    localStorage.setItem('cloudguard_theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

// ─── Theme Toggle & Error Boundary ────────────────────────────────────────────
const ThemeToggle = () => {
  const ctx = useTheme();
  if (!ctx) return null;
  const { theme, toggleTheme } = ctx;
  return (
    <button onClick={toggleTheme} className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-gray-400 hover:text-white hover:bg-dark-700 transition-colors text-sm font-medium">
      {theme === 'dark' ? <Sun size={17} className="text-yellow-400" /> : <Moon size={17} className="text-blue-400" />}
      <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
    </button>
  );
};

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean}> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: any, info: any) { console.error("Dashboard failed to load.", error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-dark-900 p-4">
          <div className="glass-panel rounded-2xl p-8 max-w-md border border-dark-700 text-center shadow-2xl">
            <AlertTriangle className="mx-auto mb-4 text-red-500" size={48} />
            <h2 className="text-2xl font-bold text-white mb-2">Dashboard failed to load.</h2>
            <p className="text-gray-400 mb-6">Please refresh or check logs.</p>
            <button onClick={() => window.location.reload()} className="px-6 py-2.5 bg-brand hover:bg-blue-500 text-white rounded-xl transition-all font-medium">Reload Dashboard</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Admin Layout ───────────────────────────────────────────────────────────
const AdminLayout = ({ children }: { children: React.ReactNode }) => {
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const location = useLocation();

  const adminNav: NavItem[] = [
    { path: '/admin-overview', icon: <Crown size={17}/>, label: 'Admin Overview' },
    { path: '/user-management', icon: <Users size={17}/>, label: 'User Management' },
    { path: '/department-summary', icon: <BarChart2 size={17}/>, label: 'Department Summary' },
    { path: '/resource-registry', icon: <Database size={17}/>, label: 'Resource Registry' },
    { path: '/audit-logs', icon: <Bell size={17}/>, label: 'Audit Logs' },
  ];

  const handleClearData = async () => {
    setClearing(true);
    try {
      const response = await axios.post(`${API_BASE}/admin/clear-historical-data`);
      console.log('Historical data cleared:', response.data);
      alert(`✓ Success: ${response.data.message}\n\nDeleted Records:\n- finops_events: ${response.data.deleted_records.raw_finops_events}\n- compliance_logs: ${response.data.deleted_records.raw_compliance_logs}\n- infra_alerts: ${response.data.deleted_records.raw_infrastructure_alerts}`);
      setClearModalOpen(false);
    } catch (err: any) {
      const errMsg = err.response?.data?.detail || err.message || 'Failed to clear data';
      alert(`✗ Error: ${errMsg}`);
      console.error('Clear data error:', err);
    } finally {
      setClearing(false);
    }
  };

  const headerActions = (
    <div className="flex flex-col gap-2 w-full">
      <button
        onClick={() => setClearModalOpen(true)}
        title="Delete raw logs but preserve analytics"
        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 hover:text-yellow-300 text-sm font-medium transition-all"
      >
        <Zap size={17} />
        <span>Clear Past Data</span>
      </button>
      <ThemeToggle />
    </div>
  );

  return (
    <Layout nav={adminNav} headerActions={headerActions}>
      {children}
      <ClearDataModal 
        isOpen={clearModalOpen}
        isLoading={clearing}
        onConfirm={handleClearData}
        onCancel={() => setClearModalOpen(false)}
      />
    </Layout>
  );
};

// ─── Clear Past Data Modal ─────────────────────────────────────────────────────
interface ClearDataModalProps {
  isOpen: boolean;
  isLoading: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

const ClearDataModal = ({ isOpen, isLoading, onConfirm, onCancel }: ClearDataModalProps) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="glass-panel rounded-2xl p-8 max-w-md border border-dark-700 shadow-2xl animate-in fade-in zoom-in duration-300">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-yellow-500/20 rounded-lg border border-yellow-500/30">
            <AlertTriangle size={24} className="text-yellow-400" />
          </div>
          <h2 className="text-2xl font-bold text-white">Clear Past Data?</h2>
        </div>

        <p className="text-gray-300 mb-2">
          This will delete historical logs but keep analytics summaries used by graphs.
        </p>
        <div className="bg-dark-700/50 border border-dark-600 rounded-xl p-4 mb-6 text-sm">
          <p className="text-gray-400 font-mono text-xs leading-relaxed">
            <strong>Deleted:</strong><br/>
            • raw_finops_events<br/>
            • raw_compliance_logs<br/>
            • raw_infrastructure_alerts<br/>
            <br/>
            <strong>Preserved:</strong><br/>
            • analytics_cost_trends<br/>
            • analytics_violation_summary<br/>
            • analytics_resource_metrics
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 px-4 py-2.5 rounded-xl border border-dark-600 bg-dark-700 hover:bg-dark-600 text-gray-300 font-medium transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 px-4 py-2.5 rounded-xl bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/40 text-yellow-400 font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-yellow-400/50 border-r-2" />
                Clearing...
              </>
            ) : (
              'Confirm'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Auth Helpers ─────────────────────────────────────────────────────────────
export const setAuthToken = (token: string) => {
  axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
};

// Setup axios interceptor for 403 errors
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 403) {
      console.warn('[AUTH] 403 Forbidden - Access denied');
      alert('Access Denied: You do not have permission to access this resource.');
      // Optionally redirect to login or dashboard
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

// removed handleCSVDownload

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
    case 'admin':              return '/admin-overview';
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
const fetchAdminResources = (type?: string) => axios.get(`${API_BASE}/admin/resources${type ? `?type=${type}` : ''}`).then(r => r.data);
const fetchAdminOverview = () => axios.get(`${API_BASE}/admin/overview`).then(r => r.data);
const fetchFinOpsResourceSummary = () => axios.get(`${API_BASE}/finops/resources/summary`).then(r => r.data);
const fetchUserSummary = () => axios.get(`${API_BASE}/admin/stats/by-account`).then(r => r.data);
const fetchTopUsers   = () => axios.get(`${API_BASE}/admin/stats/by-user`).then(r => r.data);

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
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const { token, authed } = useAuth();

  const fetchAlerts = () => {
    axios.get(`${API_BASE}/alerts?limit=20`)
      .then(r => { setItems(r.data); setLastUpdated(new Date()); })
      .catch(() => {});
  };

  useEffect(() => {
    // Prevent connection attempts if not authenticated or token is missing
    if (!authed || !token) return;

    // Initial fetch
    fetchAlerts();

    // Poll every 30 seconds to catch new alerts even without SSE events
    const pollInterval = setInterval(fetchAlerts, 30000);
    
    // Pass token in query string since EventSource doesn't support headers
    const sse = new EventSource(`${API_BASE}/alerts/stream?token=${token}`);
    sse.onmessage = e => {
      try {
        const d = JSON.parse(e.data);
        if (d.type !== 'connected') {
          setItems(prev => [d, ...prev].slice(0, 50));
          setLastUpdated(new Date());
        }
      } catch {}
    };
    return () => { clearInterval(pollInterval); sse.close(); };
  }, [token, authed]);

  return (
    <div className="glass-panel rounded-2xl flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b border-dark-700 bg-dark-800 flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Bell size={16} className="text-yellow-400" /> Live Alert Stream
        </h3>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-[10px] text-gray-500">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button onClick={fetchAlerts} title="Refresh alerts" className="text-gray-500 hover:text-brand transition-colors">
            <Activity size={14} />
          </button>
          <span className="flex h-2.5 w-2.5 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {items.map((a, i) => (
          <div key={i} className="p-3 bg-dark-700/50 hover:bg-dark-700 rounded-lg border border-dark-600 transition-colors">
            <div className="flex justify-between items-center mb-1">
              <SeverityBadge severity={a.severity} />
              <div className="flex items-center gap-2">
                {a.service && <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-brand/10 text-brand border border-brand/20">{a.service}</span>}
                <span className="text-xs text-gray-500">{new Date(a.created_at).toLocaleTimeString()}</span>
              </div>
            </div>
            <p className="text-xs text-gray-300 mt-1.5 leading-relaxed">{a.message}</p>
            {(a.account_id || a.iam_entity) && (
              <div className="mt-2 flex items-center gap-2 border-t border-dark-600/50 pt-2">
                {a.account_id && (
                   <span className="text-[9px] text-gray-500 font-mono bg-dark-800 px-1.5 py-0.5 rounded border border-dark-600" title="AWS Account ID">
                     {a.account_id}
                   </span>
                )}
                {a.iam_entity && (
                   <span className="text-[9px] text-gray-400 font-bold uppercase flex items-center gap-1">
                     <Users size={10} className="text-brand opacity-60" />
                     {a.iam_entity}
                   </span>
                )}
              </div>
            )}
          </div>
        ))}
        {items.length === 0 && <p className="text-center text-gray-500 text-sm py-8">Waiting for events…</p>}
      </div>
    </div>
  );
};

// LogExport removed as per request

// ─── Sidebar ──────────────────────────────────────────────────────────────────
interface NavItem { path: string; icon: React.ReactNode; label: string; }
interface SidebarProps { navItems: NavItem[]; headerActions?: React.ReactNode; }
const Sidebar = ({ navItems, headerActions }: SidebarProps) => {
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
        {navItems.map(item => {
          const isActive = pathname === item.path || pathname.startsWith(item.path);
          return (
            <Link key={item.path} to={item.path}>
              <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all text-sm ${
                isActive
                  ? 'bg-brand/10 text-brand border border-brand/20 font-semibold'
                  : 'text-gray-400 hover:bg-dark-700 hover:text-gray-200'
              }`}>
                {item.icon}
                <span>{item.label}</span>
              </div>
            </Link>
          );
        })}
      </nav>
      
      {headerActions && <div className="px-4 py-3 border-t border-dark-700">{headerActions}</div>}
      
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

const Layout = ({ children, nav, headerActions }: { children: React.ReactNode; nav: NavItem[]; headerActions?: React.ReactNode }) => (
  <div className="flex h-screen overflow-hidden">
    <Sidebar navItems={nav} headerActions={headerActions} />
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

  const headerActions = <ThemeToggle />;

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
    <Layout nav={nav} headerActions={headerActions}>
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

  const headerActions = <ThemeToggle />;

  const donut = {
    labels: ['Compliant','Violations'],
    datasets: [{ data:[comp?.overall_score??0, 100-(comp?.overall_score??0)], backgroundColor:['#10b981','#f43f5e'], borderWidth:0, cutout:'78%' }]
  };

  return (
    <Layout nav={nav} headerActions={headerActions}>
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

  const headerActions = <ThemeToggle />;

  const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
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
    <Layout nav={nav.slice(0,1)} headerActions={headerActions}>
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

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="glass-panel rounded-2xl p-6 lg:col-span-2 flex flex-col">
            <h3 className="font-semibold mb-4 flex items-center gap-2"><BarChart2 size={18} className="text-cyan-400" /> Alert Severity Breakdown</h3>
            {isLoading ? <Spinner /> : (
              <div className="h-[300px] relative w-full mt-2">
                <Bar data={barData} options={{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ y:{grid:{color:'#1f2937'},ticks:{color:'#9ca3af'}}, x:{grid:{display:false},ticks:{color:'#9ca3af'}} } }} />
              </div>
            )}
          </div>
          <div className="lg:col-span-3">
            <AlertFeed />
          </div>
        </div>

        <div className="glass-panel rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-dark-700 bg-dark-800 flex justify-between items-center">
            <h3 className="font-semibold flex items-center gap-2"><Activity size={18} className="text-cyan-400" /> Recent Alerts</h3>
            <div className="flex items-center gap-2">
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



// Resource type badges
const RESOURCE_ICONS: Record<string, React.ReactNode> = {
  ec2:    <Server size={12} className="text-cyan-400" />,
  s3:     <Database size={12} className="text-amber-400" />,
  lambda: <Activity size={12} className="text-purple-400" />,
  iam:    <Users size={12} className="text-brand" />,
};

const ResourceTypeBadge = ({ type }: { type: string }) => {
  const c: Record<string,string> = {
    ec2:    'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
    s3:     'bg-amber-500/10 text-amber-400 border-amber-500/30',
    lambda: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    iam:    'bg-brand/10 text-brand border-brand/30',
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
  const { theme } = useTheme();
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

  const allResources: any[] = resources ?? [];
  const idleCount = allResources.filter((r: any) => r.idle).length;
  const types = ['all', 'ec2', 's3', 'lambda', 'iam'];

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
                        <div className="flex flex-col">
                           <span className="font-bold">{r.aws_account_id || 'ROOT'}</span>
                           {r.iam_user && r.iam_user !== 'unknown' && (
                             <span className="text-[9px] lowercase opacity-60">via {r.iam_user}</span>
                           )}
                        </div>
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
                      {r.idle || r.type === 'ec2' ? (
                        <button id={`action-${r.resource_id}`}
                          className="text-[10px] font-bold uppercase tracking-wider bg-brand/10 hover:bg-brand/20 text-brand border border-brand/30 px-2.5 py-1 rounded-lg transition-all shadow-sm">
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
  const { theme } = useTheme();
  const [tab, setTab] = useState<'overview'|'resources'|'users'|'export'>('overview');
  const { data: fp,         isLoading: fpLoad } = useQuery({ queryKey: ['finops'],      queryFn: fetchFinOps });
  const { data: comp,       isLoading: cpLoad } = useQuery({ queryKey: ['compliance'],  queryFn: fetchCompliance });
  const { data: trends,     isLoading: tdLoad } = useQuery({ queryKey: ['trends'],      queryFn: fetchTrends });
  const { data: adminUsers, isLoading: auLoad } = useQuery({ queryKey: ['admin-users'], queryFn: fetchAdminUsers, enabled: tab === 'users' });
  const { data: finRes,     isLoading: fResLoad } = useQuery({ queryKey: ['finops-res-sum'], queryFn: fetchFinOpsResourceSummary });
  const { data: usum,       isLoading: uLoad } = useQuery({ queryKey: ['user-sum'], queryFn: fetchUserSummary });
  const { data: tops,       isLoading: tLoad } = useQuery({ queryKey: ['top-users'], queryFn: fetchTopUsers });

  const [leaderboardMode, setLeaderboardMode] = useState<'accounts'|'users'>('accounts');

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

  const [clearing, setClearing] = useState(false);
  const [clearModalOpen, setClearModalOpen] = useState(false);

  const handleClearAllData = async () => {
    setClearing(true);
    try {
      await axios.post(`${API_BASE}/admin/clear-all-data`);
      alert('System logs and alerts have been wiped.');
      setClearModalOpen(false);
      // Refresh data
      await queryClient.invalidateQueries();
    } catch (err) {
      alert('Failed to clear data');
    } finally {
      setClearing(false);
    }
  };

  const headerActions = (
    <div className="flex flex-col gap-2 w-full">
      <button
        onClick={() => setClearModalOpen(true)}
        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 hover:text-red-300 text-sm font-medium transition-all"
      >
        <Zap size={17} />
        <span>Clear All Logs</span>
      </button>
      <ThemeToggle />
    </div>
  );

  return (
    <Layout nav={nav} headerActions={headerActions}>
      <ClearDataModal 
        isOpen={clearModalOpen} 
        onCancel={() => setClearModalOpen(false)} 
        onConfirm={handleClearAllData} 
        isLoading={clearing} 
      />
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
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold flex items-center gap-2 dark:text-white text-gray-900">
                      <Users size={18} className="text-brand"/>
                      Leaderboard
                    </h3>
                    <div className="flex bg-dark-900/50 rounded-lg p-0.5 border border-dark-700">
                      <button 
                        onClick={() => setLeaderboardMode('accounts')}
                        className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded ${leaderboardMode === 'accounts' ? 'bg-brand text-white' : 'text-gray-500 hover:text-gray-300'}`}
                      >
                        Accounts
                      </button>
                      <button 
                        onClick={() => setLeaderboardMode('users')}
                        className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded ${leaderboardMode === 'users' ? 'bg-brand text-white' : 'text-gray-500 hover:text-gray-300'}`}
                      >
                        Users
                      </button>
                    </div>
                  </div>
                  
                  {(uLoad || tLoad) ? <Spinner /> : (
                    <div className="flex-1 overflow-y-auto pr-2 space-y-3 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-dark-600">
                      {leaderboardMode === 'accounts' ? (
                        !(usum?.length) ? <p className="text-gray-500 text-sm text-center py-4 italic">No accounts scanned</p> : (usum).map((u:any, i:number) => (
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
                        ))
                      ) : (
                        !(tops?.length) ? <p className="text-gray-500 text-sm text-center py-4 italic">No IAM activity detected</p> : (tops).map((u:any, i:number) => (
                          <div key={i} className="flex flex-col gap-2 p-3 dark:bg-dark-800 bg-white rounded-lg border dark:border-dark-600 border-gray-100 hover:border-brand/30 transition-all shadow-sm">
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 text-[10px] font-bold shrink-0 shadow-sm">{u.iam_user.charAt(0).toUpperCase()}</div>
                                <span className="text-sm font-semibold dark:text-gray-200 text-gray-800 truncate max-w-[150px]">{u.iam_user}</span>
                              </div>
                              <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">${u.total_cost.toFixed(0)}</span>
                            </div>
                            <div className="flex justify-between text-[10px] font-medium dark:text-gray-500 text-gray-400 uppercase tracking-tight">
                              <span>{u.resource_count} resources</span>
                              <span className={u.idle_resources > 0 ? "text-amber-600 dark:text-amber-400" : ""}>{u.idle_resources} idle</span>
                            </div>
                          </div>
                       ))
                      )}
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

  const handleExport = async (type: 'alerts' | 'usage') => {
    setLoading(type);
    try {
      const url = `${API_BASE}/admin/export/${type}?start_date=${start}&end_date=${end}`;
      const response = await axios.get(url, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'text/csv' });
      const dlUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = dlUrl;
      link.setAttribute('download', `${type}_export_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err: any) {
      console.error('Export failed:', err);
      alert(`Download failed (500): ${err.response?.data?.detail || err.message}`);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="glass-panel rounded-2xl p-8 space-y-8 max-w-4xl mx-auto border border-dark-700 shadow-2xl">
      <div className="flex items-center gap-4 mb-2">
        <div className="p-3 bg-brand/20 rounded-2xl border border-brand/30">
          <Download size={32} className="text-brand" />
        </div>
        <div>
          <h2 className="text-2xl font-bold dark:text-white text-gray-900">Data Export Center</h2>
          <p className="dark:text-gray-400 text-gray-500 text-sm">Generate and download comprehensive system reports</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-dark-800/50 p-6 rounded-2xl border border-dark-700">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2">
            <Calendar size={14} /> Start Date
          </label>
          <input 
            type="date" 
            value={start} 
            onChange={(e) => setStart(e.target.value)}
            className="w-full bg-dark-900 border border-dark-600 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-brand transition-all font-medium text-white"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-500 flex items-center gap-2">
            <Calendar size={14} /> End Date
          </label>
          <input 
            type="date" 
            value={end} 
            onChange={(e) => setEnd(e.target.value)}
            className="w-full bg-dark-900 border border-dark-600 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-brand transition-all font-medium text-white"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-panel rounded-2xl p-6 border border-dark-700 hover:border-brand/30 transition-all group">
          <div className="flex items-start justify-between mb-4">
            <div className="p-2.5 bg-yellow-500/10 rounded-xl border border-yellow-500/20 group-hover:bg-yellow-500/20 transition-all">
              <Bell size={24} className="text-yellow-400" />
            </div>
            {loading === 'alerts' && <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-brand" />}
          </div>
          <h3 className="text-lg font-bold mb-2">System Alerts Log</h3>
          <p className="text-sm text-gray-400 mb-6 leading-relaxed">Includes security findings, idle resource warnings, and system status changes.</p>
          <button 
            onClick={() => handleExport('alerts')}
            disabled={!!loading}
            className="w-full py-3 bg-dark-700 hover:bg-dark-600 border border-dark-600 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Download size={16} /> Export Alerts CSV
          </button>
        </div>

        <div className="glass-panel rounded-2xl p-6 border border-dark-700 hover:border-brand/30 transition-all group">
          <div className="flex items-start justify-between mb-4">
            <div className="p-2.5 bg-brand/10 rounded-xl border border-brand/20 group-hover:bg-brand/20 transition-all">
              <BarChart size={24} className="text-brand" />
            </div>
            {loading === 'usage' && <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-brand" />}
          </div>
          <h3 className="text-lg font-bold mb-2">Resource Usage Metrics</h3>
          <p className="text-sm text-gray-400 mb-6 leading-relaxed">Granular CPU, memory, and cost data for all discovered AWS accounts.</p>
          <button 
            onClick={() => handleExport('usage')}
            disabled={!!loading}
            className="w-full py-3 bg-brand hover:bg-blue-500 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-brand/20 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Download size={16} /> Export Metrics CSV
          </button>
        </div>
      </div>
    </div>
  );
};


// ─── Login Page ───────────────────────────────────────────────────────────────
const LoginPage = () => {
  const [email, setEmail] = useState('admin@cloudguard.io');
  const [password, setPassword] = useState('admin123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = Navigate;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await axios.post(`${API_BASE}/auth/login`, { email, password });
      login(response.data.access_token, response.data.role, response.data.email);
      window.location.href = getRoleDashboard(response.data.role);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const QUICK_ROLES = [
    { label: 'Cloud Admin', email: 'admin@cloudguard.io', icon: <Cloud size={14} className="text-brand"/> },
    { label: 'FinOps Manager', email: 'finops@cloudguard.io', icon: <DollarSign size={14} className="text-emerald-500"/> },
    { label: 'Compliance Manager', email: 'compliance@cloudguard.io', icon: <Shield size={14} className="text-purple-500"/> },
    { label: 'IT Admin', email: 'itadmin@cloudguard.io', icon: <Settings size={14} className="text-yellow-500"/> }
  ];

  const handleQuickLogin = (roleEmail: string) => {
    setEmail(roleEmail);
    setPassword('admin123'); // Default password for all seed accounts
    setTimeout(() => {
      const form = document.querySelector('form');
      if (form) form.requestSubmit();
    }, 100);
  };

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-dark-900 overflow-hidden relative">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand/10 rounded-full blur-[120px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[120px]" />
      
      <div className="glass-panel p-10 rounded-3xl w-full max-w-md border border-dark-700 shadow-2xl relative z-10">
        <div className="flex flex-col items-center mb-8">
          <div className="p-4 bg-brand rounded-2xl shadow-[0_0_30px_rgba(59,130,246,0.3)] mb-4">
            <Cloud size={40} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-1 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">CloudGuard</h1>
          <p className="text-gray-500 text-sm font-medium">Enterprise Cloud Governance</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-500 ml-1">Email Address</label>
            <div className="relative">
              <Users className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full bg-dark-800 border border-dark-700 rounded-xl pl-12 pr-4 py-3 text-sm focus:border-brand focus:ring-1 focus:ring-brand outline-none transition-all" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-500 ml-1">Secret Key</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full bg-dark-800 border border-dark-700 rounded-xl pl-12 pr-4 py-3 text-sm focus:border-brand focus:ring-1 focus:ring-brand outline-none transition-all" />
            </div>
          </div>
          
          {error && <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium animate-in slide-in-from-top-1">{error}</div>}
          
          <button type="submit" disabled={loading} className="w-full bg-brand hover:bg-blue-500 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-brand/20 transition-all transform active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Enter Platform'}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-dark-700">
          <p className="text-[10px] text-gray-500 mb-4 font-bold uppercase tracking-[0.2em] text-center">Quick Developer Access</p>
          <div className="grid grid-cols-2 gap-3">
            {QUICK_ROLES.map((role) => (
              <button 
                key={role.email} 
                onClick={() => handleQuickLogin(role.email)}
                className="flex flex-col items-start p-3 bg-dark-800/50 hover:bg-dark-700 border border-dark-700 hover:border-brand/40 rounded-xl transition-all group"
              >
                <div className="flex items-center gap-2 mb-1">
                  {role.icon}
                  <span className="text-[11px] font-bold text-gray-300 group-hover:text-white transition-colors">{role.label}</span>
                </div>
                <span className="text-[9px] text-gray-600 truncate w-full">{role.email}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
const AppContent = () => {
  const { authed, role } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={!authed ? <LoginPage /> : <Navigate to={getRoleDashboard(role)} />} />
      
      {/* Role specific routes */}
      <Route path="/dashboard/finops"      element={authed && role==='finops_manager' ? <FinOpsDashboard /> : <Navigate to="/login" />} />
      <Route path="/dashboard/compliance"  element={authed && role==='compliance_manager' ? <ComplianceDashboard /> : <Navigate to="/login" />} />
      <Route path="/dashboard/infra"       element={authed && role==='it_admin' ? <ITAdminDashboard /> : <Navigate to="/login" />} />
      <Route path="/admin-overview"        element={(authed && (role==='cloud_admin' || role==='admin')) ? <CloudAdminDashboard /> : <Navigate to="/login" />} />
      
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
};

export default function App() {
  const [auth, setAuth] = useState<any>(() => {
    const s = localStorage.getItem('cloudguard_auth');
    if (s) {
      const d = JSON.parse(s);
      setAuthToken(d.token);
      return d;
    }
    return { authed: false, role: '', email: '', token: '' };
  });

  const login = (token: string, role: string, email: string) => {
    const d = { authed: true, role, email, token };
    localStorage.setItem('cloudguard_auth', JSON.stringify(d));
    setAuthToken(token);
    setAuth(d);
  };

  const logout = () => {
    localStorage.removeItem('cloudguard_auth');
    delete axios.defaults.headers.common['Authorization'];
    setAuth({ authed: false, role: '', email: '', token: '' });
  };

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthContext.Provider value={{ ...auth, login, logout }}>
          <BrowserRouter>
            <ErrorBoundary>
              <AppContent />
            </ErrorBoundary>
          </BrowserRouter>
        </AuthContext.Provider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

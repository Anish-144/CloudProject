import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { ShieldCheck, TrendingDown, LayoutDashboard, Bell, Cloud, Activity, AlertTriangle, CheckCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ArcElement, Filler
} from 'chart.js';
import { Line, Doughnut } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ArcElement, Filler);

const API_BASE = 'http://localhost:8000/api/v1';

// ─── Auth Helper ─────────────────────────────────────────────────────────────
let authToken = '';
export const getAuthToken = () => authToken;
export const setAuthToken = (token: string) => {
  authToken = token;
  axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
};


// ─── API Fetches ─────────────────────────────────────────────────────────────
const fetchFinOps = async () => (await axios.get(`${API_BASE}/finops/summary`)).data;
const fetchCompliance = async () => (await axios.get(`${API_BASE}/compliance/score`)).data;
const fetchCostTrends = async () => (await axios.get(`${API_BASE}/finops/cost-trends`)).data;
const fetchAlerts = async () => (await axios.get(`${API_BASE}/alerts?limit=10`)).data;

// ─── Layout ──────────────────────────────────────────────────────────────────
const Layout = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();

  const navItems = [
    { path: '/', icon: <LayoutDashboard size={20} />, label: 'Overview' },
    { path: '/finops', icon: <TrendingDown size={20} />, label: 'FinOps' },
    { path: '/compliance', icon: <ShieldCheck size={20} />, label: 'Compliance' },
    { path: '/alerts', icon: <Activity size={20} />, label: 'Alerts' },
  ];

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 glass-panel border-r border-dark-700 flex flex-col z-20">
        <div className="p-6 flex items-center space-x-3 border-b border-dark-700">
          <div className="p-2 bg-brand rounded-lg shadow-[0_0_15px_rgba(59,130,246,0.5)]">
            <Cloud size={24} className="text-white" />
          </div>
          <span className="text-xl font-bold tracking-wide">CloudGuard</span>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          {navItems.map((item) => (
            <Link key={item.path} to={item.path}>
              <div className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                location.pathname === item.path
                  ? 'bg-brand/10 text-brand border-l-2 border-brand font-medium'
                  : 'text-gray-400 hover:bg-dark-700 hover:text-gray-200'
              }`}>
                {item.icon}
                <span>{item.label}</span>
              </div>
            </Link>
          ))}
        </nav>
        <div className="p-4 text-xs text-gray-500 text-center border-t border-dark-700">
          admin@cloudguard.io
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-dark-800 via-dark-900 to-dark-900">
        <div className="absolute top-0 w-full h-1 bg-gradient-to-r from-brand via-purple-500 to-brand z-10 opacity-50"></div>
        <div className="p-8 pb-32">
          {children}
        </div>
      </main>
    </div>
  );
};

// ─── SSE Alert Feed ──────────────────────────────────────────────────────────
const AlertFeed = () => {
  const [alerts, setAlerts] = useState<any[]>([]);

  useEffect(() => {
    import('axios').then(async () => {
       const initial = await fetchAlerts();
       setAlerts(initial);
    });

    const sse = new EventSource(`${API_BASE}/alerts/stream`);
    sse.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type !== 'connected') {
          setAlerts(prev => [data, ...prev].slice(0, 50));
        }
      } catch (e) {}
    };
    return () => sse.close();
  }, []);

  return (
    <div className="glass-panel rounded-2xl overflow-hidden h-full flex flex-col">
      <div className="p-4 border-b border-dark-700 flex items-center justify-between bg-dark-800">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Bell className="text-yellow-500" size={18} /> Live Stream
        </h3>
        <span className="flex h-3 w-3 relative">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
        </span>
      </div>
      <div className="overflow-y-auto flex-1 p-2 space-y-2">
        {alerts.map((a, i) => (
          <div key={i} className="p-3 bg-dark-700/50 hover:bg-dark-700 rounded-lg border border-dark-600 transition-colors animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="flex justify-between items-start mb-1">
              <span className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                a.severity === 'critical' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                a.severity === 'high' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' :
                a.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                'bg-gray-500/20 text-gray-400 border border-gray-500/30'
              }`}>{a.type}</span>
              <span className="text-xs text-gray-500">
                {new Date(a.created_at).toLocaleTimeString()}
              </span>
            </div>
            <p className="text-sm text-gray-200 mt-2">{a.message}</p>
          </div>
        ))}
        {alerts.length === 0 && <div className="p-8 text-center text-gray-500">Waiting for events...</div>}
      </div>
    </div>
  );
};

// ─── Dashboard Components ────────────────────────────────────────────────────
const MetricCard = ({ title, value, sub, icon: Icon, color }: any) => (
  <div className="glass-panel rounded-2xl p-6 relative overflow-hidden group hover:-translate-y-1 transition-transform duration-300">
    <div className={`absolute top-0 right-0 p-4 opacity-10 transform translate-x-4 -translate-y-4 group-hover:scale-110 transition-transform ${color}`}>
      <Icon size={120} />
    </div>
    <div className="flex justify-between items-start relative z-10">
      <div>
        <h4 className="text-gray-400 font-medium mb-1">{title}</h4>
        <div className="text-4xl font-bold tracking-tight mb-2 text-white">{value}</div>
        <div className={`text-sm ${color}`}>{sub}</div>
      </div>
      <div className={`p-3 rounded-xl bg-dark-700 border border-dark-600 ${color}`}>
        <Icon size={24} />
      </div>
    </div>
  </div>
);

const Dashboard = () => {
  const { data: finops, isLoading: fpLoad } = useQuery({ queryKey: ['finops'], queryFn: fetchFinOps, refetchInterval: 5000 });
  const { data: comp, isLoading: cpLoad } = useQuery({ queryKey: ['comp'], queryFn: fetchCompliance, refetchInterval: 5000 });
  const { data: trends, isLoading: tdLoad } = useQuery({ queryKey: ['trends'], queryFn: fetchCostTrends });

  if (fpLoad || cpLoad || tdLoad) return <div className="flex justify-center items-center h-full"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-brand"></div></div>;

  const chartData = {
    labels: trends?.map((t: any) => t.date) || [],
    datasets: [
      {
        label: 'Daily Cost ($)',
        data: trends?.map((t: any) => t.cost) || [],
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
      }
    ]
  };

  const donutData = {
    labels: ['Protected', 'Violations'],
    datasets: [{
      data: [comp?.overall_score || 0, 100 - (comp?.overall_score || 0)],
      backgroundColor: ['#10b981', '#f43f5e'],
      borderWidth: 0,
      cutout: '80%',
    }]
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">Executive Summary</h1>
          <p className="text-gray-400">Unified view of your cloud governance posture.</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard title="Potential Savings" value={`$${finops?.total_savings_potential.toLocaleString()}`} sub="Found in idle & overprovisioned" icon={TrendingDown} color="text-brand" />
        <MetricCard title="Compliance Score" value={`${comp?.overall_score}%`} sub={`${comp?.active_violations} Active Violations`} icon={ShieldCheck} color={comp?.overall_score > 80 ? "text-emerald-400" : "text-orange-400"} />
        <MetricCard title="Critical Alerts" value={comp?.critical_violations || 0} sub="Requires immediate action" icon={AlertTriangle} color="text-red-400" />
        <MetricCard title="Optimized Resources" value={(comp?.total_rules || 0) - (comp?.active_violations || 0)} sub="Healthy configurations" icon={CheckCircle} color="text-emerald-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[400px]">
        {/* Cost Graph */}
        <div className="lg:col-span-2 glass-panel rounded-2xl p-6 flex flex-col">
          <h3 className="text-lg font-semibold mb-4">Cost Trend (30 Days)</h3>
          <div className="flex-1 relative">
            <Line options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: '#374151' } }, x: { grid: { display: false } } } }} data={chartData} />
          </div>
        </div>

        {/* Live Feed */}
        <div className="lg:col-span-1 h-full">
          <AlertFeed />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Score Breakdown */}
        <div className="glass-panel rounded-2xl p-6 flex gap-8 items-center justify-center">
            <div className="w-48 h-48 relative">
              <Doughnut data={donutData} options={{ responsive: true, cutout: '80%', plugins: { tooltip: { enabled: false } } }} />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-bold">{comp?.overall_score}%</span>
                <span className="text-xs text-gray-400">Score</span>
              </div>
            </div>
            <div className="space-y-4 flex-1">
              <h3 className="font-semibold text-lg border-b border-dark-700 pb-2">By Category</h3>
              {Object.entries(comp?.by_category || {}).map(([cat, val]: any) => (
                <div key={cat}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-300 capitalize">{cat.replace('_', ' ')}</span>
                    <span className="text-white">{val}%</span>
                  </div>
                  <div className="w-full bg-dark-700 rounded-full h-1.5">
                    <div className="bg-brand h-1.5 rounded-full" style={{ width: `${val}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
        </div>

        {/* FinOps Breakdown */}
        <div className="glass-panel rounded-2xl p-6">
          <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
            <TrendingDown className="text-brand" /> Top Waste Sources
          </h3>
          <div className="space-y-4">
             {/* Note: In a real app we would map over finops.waste_items. Mocking stats here. */}
             <div className="flex justify-between items-center p-3 bg-dark-700 rounded-lg">
                <div>
                   <div className="font-medium text-white">Idle Resources</div>
                   <div className="text-sm text-gray-400">{finops?.idle_resources} VMs running &lt; 5% CPU</div>
                </div>
                <div className="text-xl font-bold text-red-400 hidden lg:block border border-red-500/30 bg-red-500/10 px-3 py-1 rounded">High</div>
             </div>
             <div className="flex justify-between items-center p-3 bg-dark-700 rounded-lg">
                <div>
                   <div className="font-medium text-white">Overprovisioned</div>
                   <div className="text-sm text-gray-400">{finops?.overprovisioned_resources} instances oversized</div>
                </div>
                <div className="text-xl font-bold text-yellow-400 hidden lg:block border border-yellow-500/30 bg-yellow-500/10 px-3 py-1 rounded">Medium</div>
             </div>
             <div className="flex justify-between items-center p-3 bg-dark-700 rounded-lg">
                <div>
                   <div className="font-medium text-white">Cost Spikes</div>
                   <div className="text-sm text-gray-400">{finops?.cost_spike_resources} sudden increases</div>
                </div>
                <div className="text-xl font-bold text-orange-400 hidden lg:block border border-orange-500/30 bg-orange-500/10 px-3 py-1 rounded">High</div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const FinOpsPage = () => {
  const { data: fp, isLoading } = useQuery({ queryKey: ['finops'], queryFn: fetchFinOps });
  if (isLoading) return <div className="p-8 text-center text-gray-400">Loading FinOps data...</div>;
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold mb-2">FinOps Intelligence</h1>
        <p className="text-gray-400">Detailed cost analysis and optimization recommendations.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricCard title="Idle Resources" value={fp?.idle_resources || 0} sub="Running < 5% CPU" icon={Cloud} color="text-yellow-400" />
        <MetricCard title="Overprovisioned" value={fp?.overprovisioned_resources || 0} sub="Instances oversized" icon={TrendingDown} color="text-orange-400" />
        <MetricCard title="Cost Spikes" value={fp?.cost_spike_resources || 0} sub="Sudden increases >20%" icon={AlertTriangle} color="text-red-400" />
      </div>
      <div className="glass-panel rounded-2xl p-6">
        <h3 className="text-lg font-semibold mb-4 border-b border-dark-700 pb-2">Optimization Recommendations</h3>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex justify-between items-center p-4 bg-dark-700/50 hover:bg-dark-700 transition-colors rounded-lg border border-dark-600">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-brand/20 text-brand rounded shadow-sm"><Activity size={20} /></div>
                <div>
                  <div className="font-medium text-white">Terminate idle EC2 Instance i-0a{i}bc89f{i}a</div>
                  <div className="text-sm text-gray-400">US-East-1 • t3.large • CPU util &lt; 2% for 14 days</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-bold text-emerald-400">Save $74.50/mo</div>
                <button className="mt-1 text-xs bg-dark-600 hover:bg-dark-500 text-white px-3 py-1 rounded transition-colors">Apply Fix</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const CompliancePage = () => {
  const { data: comp, isLoading } = useQuery({ queryKey: ['comp'], queryFn: fetchCompliance });
  if (isLoading) return <div className="p-8 text-center text-gray-400">Loading Compliance data...</div>;
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold mb-2">Compliance Posture</h1>
        <p className="text-gray-400">Detailed compliance frameworks, violations, and real-time checks.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricCard title="Total Rules Checked" value={comp?.total_rules || 0} sub="Continuous validations" icon={ShieldCheck} color="text-brand" />
        <MetricCard title="Active Violations" value={comp?.active_violations || 0} sub="Rules failing" icon={AlertTriangle} color="text-yellow-400" />
        <MetricCard title="Critical Violations" value={comp?.critical_violations || 0} sub="Immediate action required" icon={AlertTriangle} color="text-red-400" />
      </div>
      <div className="glass-panel rounded-2xl p-6">
        <h3 className="text-lg font-semibold mb-4 border-b border-dark-700 pb-2">Framework Breakdown</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Object.entries(comp?.by_category || {}).map(([cat, val]: any) => (
            <div key={cat} className="p-4 bg-dark-800 rounded-lg border border-dark-600">
              <div className="flex justify-between items-center mb-2">
                <span className="font-medium capitalize text-white">{cat.replace('_', ' ')}</span>
                <span className={`font-bold ${val > 80 ? 'text-emerald-400' : 'text-orange-400'}`}>{val}%</span>
              </div>
              <div className="w-full bg-dark-900 rounded-full h-2">
                <div className={`h-2 rounded-full ${val > 80 ? 'bg-emerald-500' : 'bg-orange-500'}`} style={{ width: `${val}%` }}></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const AlertsPage = () => {
  const { data: alerts, isLoading } = useQuery({ queryKey: ['all_alerts'], queryFn: () => axios.get(`${API_BASE}/alerts?limit=100`).then(res => res.data) });
  if (isLoading) return <div className="p-8 text-center text-gray-400">Loading Alerts...</div>;
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center mb-2">
        <div>
          <h1 className="text-3xl font-bold mb-2">Alert Center</h1>
          <p className="text-gray-400">Full alert history and remediation workflows.</p>
        </div>
        <button className="bg-dark-700 hover:bg-dark-600 text-white font-medium py-2 px-4 rounded-lg flex items-center gap-2 transition-colors border border-dark-600"><CheckCircle size={18} /> Acknowledge All</button>
      </div>
      <div className="glass-panel rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-dark-800 border-b border-dark-700 text-gray-400 text-sm">
              <tr>
                <th className="px-6 py-4 font-medium">Severity</th>
                <th className="px-6 py-4 font-medium">Time (UTC)</th>
                <th className="px-6 py-4 font-medium">Message</th>
                <th className="px-6 py-4 font-medium">Service</th>
                <th className="px-6 py-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700/50">
              {alerts?.map((a: any, i: number) => (
                <tr key={i} className="hover:bg-dark-800/50 transition-colors">
                  <td className="px-6 py-4">
                    <span className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded inline-flex items-center gap-1 ${
                      a.severity === 'critical' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                      a.severity === 'high' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' :
                      a.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                      'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                    }`}>
                      {a.severity === 'critical' && <AlertTriangle size={12} />}
                      {a.severity}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-400">{new Date(a.created_at).toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-200">{a.message}</td>
                  <td className="px-6 py-4">
                    <span className="text-xs bg-brand/10 text-brand px-2 py-1 rounded border border-brand/20 uppercase tracking-widest">{a.source}</span>
                  </td>
                  <td className="px-6 py-4">
                    <button className="text-xs px-3 py-1 bg-dark-700 hover:bg-dark-600 rounded text-gray-300 transition-colors">Review</button>
                  </td>
                </tr>
              ))}
              {(!alerts || alerts.length === 0) && (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-gray-500">No alerts found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const LoginScreen = ({ onLogin }: { onLogin: () => void }) => {
  const [email, setEmail] = useState('admin@test.com');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    console.log(`[Auth] Attempting login for ${email} at ${API_BASE}/auth/login`);
    
    axios.post(`${API_BASE}/auth/login`, { email, password })
      .then(res => {
        console.log("[Auth] Login successful, storing token.");
        setAuthToken(res.data.access_token);
        localStorage.setItem('cloudguard_token', res.data.access_token);
        onLogin();
      })
      .catch(err => {
        let msg = "Login failed";
        if (!err.response) {
          msg = "Network Error: Cannot reach API gateway at " + API_BASE;
          console.error("[Auth] Network error - backend might be down or blocked by CORS.");
        } else if (err.response.status === 401) {
          msg = "Invalid email or password.";
          console.warn("[Auth] 401 Unauthorized - check credentials.");
        } else if (err.response.status === 500) {
          msg = "Server Error (500): Something went wrong on the backend.";
          console.error("[Auth] 500 Internal Server Error - check gateway logs.");
        } else {
          msg = err.response.data?.detail || `Error ${err.response.status}: ${err.response.statusText}`;
        }
        setError(msg);
        console.error("[Auth] Login error details:", err);
      });
  };

  return (
    <div className="h-screen w-full flex items-center justify-center bg-dark-900 text-brand flex-col">
      <div className="p-8 bg-dark-800 rounded-lg shadow-xl border border-gray-700 w-96">
        <h2 className="text-2xl font-bold mb-6 text-white text-center">CloudGuard Login</h2>
        {error && <div className="bg-red-500/20 text-red-500 p-2 rounded mb-4 text-sm text-center">{error}</div>}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-gray-400 text-sm mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-dark-900 border border-gray-700 outline-none rounded p-2 text-white" />
          </div>
          <div>
            <label className="block text-gray-400 text-sm mb-1">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-dark-900 border border-gray-700 outline-none rounded p-2 text-white" />
          </div>
          <button type="submit" className="w-full bg-brand text-white font-bold py-2 rounded mt-4 hover:bg-opacity-90 transition-all">Sign In</button>
        </form>
      </div>
    </div>
  );
};

const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('cloudguard_token');
    if (token) {
      setAuthToken(token);
      setAuthed(true);
    }
    setLoading(false);
  }, []);

  if (loading) return null;
  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />;
  return <>{children}</>;
};

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Layout><Dashboard /></Layout>} />
          <Route path="/finops" element={<Layout><FinOpsPage /></Layout>} />
          <Route path="/compliance" element={<Layout><CompliancePage /></Layout>} />
          <Route path="/alerts" element={<Layout><AlertsPage /></Layout>} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

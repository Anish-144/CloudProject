import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Database, Filter } from 'lucide-react';

const API_BASE = 'http://localhost:8000/api/v1';

const fetchAdminResources = () => axios.get(`${API_BASE}/admin/resources`).then(r => r.data);

const Spinner = () => (
  <div className="flex justify-center items-center py-16">
    <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-brand" />
  </div>
);

export const ResourceRegistry = () => {
  const { data: adminRes, isLoading: arLoad } = useQuery({
    queryKey: ['admin-resources'],
    queryFn: fetchAdminResources
  });

  const [filterType, setFilterType] = useState('');
  const [filterRegion, setFilterRegion] = useState('');

  // Get unique values for filters
  const resourceTypes = useMemo(() => {
    return [...new Set((adminRes ?? []).map((r: any) => r.resource_type))] as string[];
  }, [adminRes]);

  const regions = useMemo(() => {
    return [...new Set((adminRes ?? []).map((r: any) => r.region))] as string[];
  }, [adminRes]);

  // Filter resources
  const filteredResources = useMemo(() => {
    return (adminRes ?? []).filter((r: any) => {
      if (filterType && r.resource_type !== filterType) return false;
      if (filterRegion && r.region !== filterRegion) return false;
      return true;
    });
  }, [adminRes, filterType, filterRegion]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-1 flex items-center gap-3">
            <Database size={32} className="text-brand" /> Resource Registry
          </h1>
          <p className="text-gray-400 text-sm">All cloud resources across accounts and regions</p>
        </div>
        <span className="text-sm bg-brand/20 text-brand border border-brand/30 px-4 py-2 rounded-full font-semibold">
          {filteredResources.length} Resources
        </span>
      </div>

      {/* Filters */}
      <div className="glass-panel rounded-2xl p-4 border border-dark-700">
        <div className="flex items-center gap-2 mb-4">
          <Filter size={18} className="text-brand" />
          <span className="font-semibold text-sm">Filters</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-wider mb-2">Resource Type</label>
            <select 
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="w-full bg-dark-800 border border-dark-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand/50"
            >
              <option value="">All Types</option>
              {resourceTypes.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 uppercase tracking-wider mb-2">Region</label>
            <select 
              value={filterRegion}
              onChange={(e) => setFilterRegion(e.target.value)}
              className="w-full bg-dark-800 border border-dark-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand/50"
            >
              <option value="">All Regions</option>
              {regions.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button 
              onClick={() => { setFilterType(''); setFilterRegion(''); }}
              className="w-full px-4 py-2.5 bg-dark-700 hover:bg-dark-600 rounded-xl text-gray-300 text-sm font-medium transition-all"
            >
              Reset Filters
            </button>
          </div>
        </div>
      </div>

      {/* Resources Table */}
      <div className="glass-panel rounded-2xl overflow-hidden shadow-lg border border-dark-700/50">
        {arLoad ? <Spinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-xs text-gray-400 bg-dark-800/60 uppercase tracking-widest">
                <tr>
                  <th className="px-6 py-4 font-bold">Resource ID</th>
                  <th className="px-6 py-4 font-bold">Type</th>
                  <th className="px-6 py-4 font-bold">Provider</th>
                  <th className="px-6 py-4 font-bold">Region</th>
                  <th className="px-6 py-4 font-bold">Account</th>
                  <th className="px-6 py-4 font-bold">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700/50">
                {filteredResources.map((res: any) => (
                  <tr key={res.id} className="hover:bg-dark-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <code className="text-xs font-mono text-gray-300 bg-dark-800 px-2 py-1 rounded border border-dark-700">
                        {typeof res.id === 'string' ? res.id.slice(0, 12) : res.id}...
                      </code>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs bg-dark-700 text-gray-300 px-2.5 py-1 rounded border border-dark-600 font-medium uppercase tracking-wider">
                        {res.resource_type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-400">{res.cloud_provider}</td>
                    <td className="px-6 py-4 text-sm text-gray-400">{res.region}</td>
                    <td className="px-6 py-4 text-sm text-gray-400">{res.aws_account_name ?? 'Default'}</td>
                    <td className="px-6 py-4 text-xs text-gray-500">{new Date(res.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
                {!filteredResources.length && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-gray-500">
                      {adminRes?.length ? 'No resources match the selected filters' : 'No resources found'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Resource Stats */}
      {!arLoad && adminRes?.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="glass-panel rounded-2xl p-4 border border-dark-700">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Total Resources</p>
            <p className="text-2xl font-bold text-white">{adminRes.length}</p>
          </div>
          <div className="glass-panel rounded-2xl p-4 border border-dark-700">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Unique Regions</p>
            <p className="text-2xl font-bold text-blue-400">{regions.length}</p>
          </div>
          <div className="glass-panel rounded-2xl p-4 border border-dark-700">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Resource Types</p>
            <p className="text-2xl font-bold text-emerald-400">{resourceTypes.length}</p>
          </div>
        </div>
      )}
    </div>
  );
};

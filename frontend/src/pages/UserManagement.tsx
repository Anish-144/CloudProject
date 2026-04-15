import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Users, Edit2, Trash2, Plus } from 'lucide-react';

const API_BASE = 'http://localhost:8000/api/v1';

const fetchAdminUsers = () => axios.get(`${API_BASE}/admin/users`).then(r => r.data);

const Spinner = () => (
  <div className="flex justify-center items-center py-16">
    <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-brand" />
  </div>
);

const RoleModal = ({ isOpen, user, onConfirm, onCancel, loading }: any) => {
  const [newRole, setNewRole] = useState(user?.role ?? '');

  if (!isOpen || !user) return null;

  const roles = ['cloud_admin', 'finops_admin', 'compliance_admin', 'infra_admin'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="glass-panel rounded-2xl p-8 max-w-md border border-dark-700 shadow-2xl">
        <h2 className="text-2xl font-bold text-white mb-4">Change User Role</h2>
        <p className="text-gray-400 mb-4">{user.email}</p>
        
        <div className="mb-6">
          <label className="block text-xs text-gray-400 font-medium mb-2 uppercase">Select Role</label>
          <select 
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            className="w-full bg-dark-800 border border-dark-600 rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-brand/50"
          >
            {roles.map(r => (
              <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-xl border border-dark-600 bg-dark-700 hover:bg-dark-600 text-gray-300 font-medium"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(user.id, newRole)}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-xl bg-brand hover:bg-blue-500 text-white font-medium"
          >
            {loading ? 'Updating...' : 'Update'}
          </button>
        </div>
      </div>
    </div>
  );
};

export const UserManagement = () => {
  const { data: adminUsers, isLoading: auLoad } = useQuery({
    queryKey: ['admin-users'],
    queryFn: fetchAdminUsers
  });
  const queryClient = useQueryClient();
  const [editingUser, setEditingUser] = useState<any>(null);
  const [updatingRole, setUpdatingRole] = useState(false);

  const roleColors: Record<string, string> = {
    cloud_admin:       'bg-purple-500/20 text-purple-400 border-purple-500/30',
    finops_admin:      'bg-blue-500/20 text-blue-400 border-blue-500/30',
    compliance_admin:  'bg-green-500/20 text-green-400 border-green-500/30',
    infra_admin:       'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  };

  const handleUpdateRole = async (userId: string, newRole: string) => {
    setUpdatingRole(true);
    try {
      await axios.patch(`${API_BASE}/admin/users/${userId}/role`, { role: newRole });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setEditingUser(null);
      alert('User role updated successfully');
    } catch (err: any) {
      alert(`Error updating role: ${err.response?.data?.detail ?? err.message}`);
    } finally {
      setUpdatingRole(false);
    }
  };

  const handleDeleteUser = async (userId: string, email: string) => {
    if (!confirm(`Are you sure you want to delete user ${email}?`)) return;
    try {
      // Note: DELETE endpoint not shown in original code, would need to be created
      alert('Delete functionality would be implemented by adding DELETE endpoint');
    } catch (err: any) {
      alert(`Error deleting user: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-1 flex items-center gap-3">
            <Users size={32} className="text-brand" /> User Management
          </h1>
          <p className="text-gray-400 text-sm">Manage platform users and assign roles</p>
        </div>
        <button className="flex items-center gap-2 bg-brand hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl transition-all">
          <Plus size={18} /> Add User
        </button>
      </div>

      <div className="glass-panel rounded-2xl overflow-hidden shadow-lg border border-dark-700/50">
        {auLoad ? <Spinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-xs text-gray-400 bg-dark-800/60 uppercase tracking-widest">
                <tr>
                  <th className="px-6 py-4 font-bold">Email</th>
                  <th className="px-6 py-4 font-bold">Role</th>
                  <th className="px-6 py-4 font-bold">Account</th>
                  <th className="px-6 py-4 font-bold">Created Date</th>
                  <th className="px-6 py-4 font-bold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-700/50">
                {(adminUsers ?? []).map((user: any) => (
                  <tr key={user.id} className="hover:bg-dark-800/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-dark-700 border border-dark-600 flex items-center justify-center text-xs font-bold text-gray-300">
                          {user.email.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium text-gray-200">{user.email}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2.5 py-1 rounded-lg border font-bold uppercase tracking-wider ${roleColors[user.role] ?? 'bg-gray-500/20 text-gray-400'}`}>
                        {user.role.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-400">{user.aws_account_name ?? 'Standalone'}</td>
                    <td className="px-6 py-4 text-xs text-gray-500">{new Date(user.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => setEditingUser(user)}
                          className="p-2 hover:bg-dark-700 rounded-lg text-gray-400 hover:text-blue-400 transition-colors"
                          title="Edit role"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => handleDeleteUser(user.id, user.email)}
                          className="p-2 hover:bg-dark-700 rounded-lg text-gray-400 hover:text-red-400 transition-colors"
                          title="Delete user"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!adminUsers?.length && <tr><td colSpan={5} className="py-12 text-center text-gray-500">No users found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RoleModal 
        isOpen={!!editingUser}
        user={editingUser}
        onConfirm={handleUpdateRole}
        onCancel={() => setEditingUser(null)}
        loading={updatingRole}
      />
    </div>
  );
};

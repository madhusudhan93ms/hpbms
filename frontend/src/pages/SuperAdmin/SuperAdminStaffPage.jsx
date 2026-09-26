import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users, Search } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { axiosClient } from '../../api/axiosClient';
import { ROLE_NAMES } from '../../utils/constants';
import { SuperAdminModuleBridge } from '../../components/superadmin/SuperAdminModuleBridge';
import { formatDateTime } from '../../utils/formatters';

export const SuperAdminStaffPage = ({ roleFilter = null, title = 'All Staff' }) => {
  const [searchParams] = useSearchParams();
  const role = roleFilter || searchParams.get('role');
  const [staff, setStaff] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [hospitalFilter, setHospitalFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  useEffect(() => {
    const load = async () => {
      try {
        const [staffRes, hospRes] = await Promise.all([
          axiosClient.get('/auth/staff?all=true&hospitalId=ALL', {
            headers: { 'X-Hospital-Context': '' },
          }),
          axiosClient.get('/saas/hospitals', {
            headers: { 'X-Hospital-Context': '' },
          }).catch(() => ({ data: [] })),
        ]);
        const rawHospList = hospRes.data?.data || hospRes.data || [];
        const activeHospList = (Array.isArray(rawHospList) ? rawHospList : []).filter(
          (h) => !h.isDeleted && h.status !== 'DELETED'
        );
        setStaff(staffRes.data || []);
        setHospitals(activeHospList);
      } catch (err) {
        console.error(err);
      }
    };
    load();
  }, []);

  const filtered = staff.filter((s) => {
    if (role && s.role !== role) return false;
    if (statusFilter === 'ACTIVE' && !s.isActive) return false;
    if (statusFilter === 'INACTIVE' && s.isActive) return false;
    if (hospitalFilter !== 'ALL' && String(s.hospitalId?._id || s.hospitalId) !== String(hospitalFilter)) return false;
    if (search) {
      const term = search.toLowerCase();
      const hospName = (s.hospitalId?.name || '').toLowerCase();
      return s.name?.toLowerCase().includes(term) || s.email?.toLowerCase().includes(term) || hospName.includes(term);
    }
    return true;
  });

  return (
    <SuperAdminModuleBridge requireHospital={false}>
      <div className="space-y-6 animate-fade-in">
        <div>
          <h2 className="text-2xl font-bold text-neutral-900 tracking-tight">{title}</h2>
          <p className="text-xs text-neutral-500 mt-1">{filtered.length} of {staff.length} staff members · Cross-hospital visibility</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Search by name, email, or hospital..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {hospitals.length > 0 && (
            <select
              value={hospitalFilter}
              onChange={(e) => setHospitalFilter(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"
            >
              <option value="ALL">All Hospitals ({hospitals.length})</option>
              {hospitals.map((h) => (
                <option key={h._id} value={h._id}>{h.name}</option>
              ))}
            </select>
          )}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white"
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>

        <Card>
          <div className="overflow-x-auto overflow-y-auto max-h-[540px] rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-neutral-100/95 backdrop-blur-xs text-neutral-700 uppercase tracking-wider text-[10px] border-b border-neutral-200 shadow-2xs font-bold">
                <tr>
                  <th className="p-3 bg-neutral-100">Name</th>
                  <th className="p-3 bg-neutral-100">Hospital</th>
                  <th className="p-3 bg-neutral-100">Email</th>
                  <th className="p-3 bg-neutral-100">Role</th>
                  <th className="p-3 bg-neutral-100">Phone</th>
                  <th className="p-3 bg-neutral-100">Specialization</th>
                  <th className="p-3 bg-neutral-100">Status</th>
                  <th className="p-3 bg-neutral-100">Last Login</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filtered.map((s) => (
                  <tr key={s._id} className="hover:bg-neutral-50">
                    <td className="p-3 font-bold text-neutral-900">{s.name}</td>
                    <td className="p-3 font-semibold text-slate-700">{s.hospitalId?.name || 'Platform Hospital'}</td>
                    <td className="p-3 text-neutral-600 font-mono">{s.email}</td>
                    <td className="p-3"><span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px] font-bold">{ROLE_NAMES[s.role] || s.role}</span></td>
                    <td className="p-3">{s.phone || '—'}</td>
                    <td className="p-3">{s.specialization || '—'}</td>
                    <td className="p-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${s.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{s.isActive ? 'Active' : 'Inactive'}</span></td>
                    <td className="p-3">{formatDateTime(s.lastLoginAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && <p className="text-center text-slate-500 py-8">No staff found</p>}
        </Card>
      </div>
    </SuperAdminModuleBridge>
  );
};

export const SuperAdminDoctorsPage = () => (
  <SuperAdminStaffPage roleFilter="DOCTOR" title="Doctors" />
);

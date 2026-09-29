import React, { useState, useEffect } from 'react';
import { StatCard } from '../../components/ui/StatCard';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { PasswordInput } from '../../components/ui/PasswordInput';
import { axiosClient } from '../../api/axiosClient';
import { useScrollLock } from '../../hooks/useScrollLock';
import { Building2, ShieldCheck, CheckCircle, XCircle, Clock, Users, PlusCircle, X, Key } from 'lucide-react';

export const SuperAdminDashboard = () => {
  const [hospitals, setHospitals] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDirectCreateOpen, setIsDirectCreateOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);
  const [provisionedCreds, setProvisionedCreds] = useState(null);

  useScrollLock(isDirectCreateOpen || Boolean(provisionedCreds));

  const [directForm, setDirectForm] = useState({
    hospitalName: '',
    subdomain: '',
    plan: 'ENTERPRISE',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    adminPassword: '',
    confirmAdminPassword: '',
  });

  useEffect(() => {
    fetchHospitals();
  }, []);

  const fetchHospitals = async () => {
    try {
      const res = await axiosClient.get('/saas/hospitals');
      const raw = res.data?.data || res.data || [];
      setHospitals(Array.isArray(raw) ? raw : []);
    } catch (err) {
      console.error('Failed to load SaaS hospitals:', err);
    }
  };

  const handleApprove = async (hospitalId, name) => {
    setIsLoading(true);
    setActionMessage(null);
    try {
      const res = await axiosClient.patch(`/saas/hospitals/${hospitalId}/approve`);
      setActionMessage(`Hospital '${name}' approved successfully! Admin account provisioned: ${res.data.adminUser?.email}`);
      fetchHospitals();
    } catch (err) {
      setActionMessage(`Failed to approve hospital: ${err.error?.message || err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReject = async (hospitalId, name) => {
    setIsLoading(true);
    setActionMessage(null);
    try {
      await axiosClient.patch(`/saas/hospitals/${hospitalId}/status`, { status: 'REJECTED' });
      setActionMessage(`Hospital registration application for '${name}' has been rejected.`);
      fetchHospitals();
    } catch (err) {
      setActionMessage(`Failed to reject hospital: ${err.error?.message || err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDirectCreate = async (e) => {
    e.preventDefault();
    if (!directForm.adminPassword || directForm.adminPassword.length < 8) {
      setActionMessage('Hospital administrator password must be at least 8 characters long.');
      return;
    }
    if (directForm.adminPassword !== directForm.confirmAdminPassword) {
      setActionMessage('Hospital administrator password and confirm password do not match.');
      return;
    }
    setIsLoading(true);
    setActionMessage(null);
    try {
      const res = await axiosClient.post('/saas/register-hospital', {
        ...directForm,
        adminPassword: directForm.adminPassword,
      });
      const hospitalId = res.data.hospital._id;
      const approveRes = await axiosClient.patch(`/saas/hospitals/${hospitalId}/approve`);
      setProvisionedCreds({
        hospitalName: directForm.hospitalName,
        adminEmail: approveRes.data.adminUser?.email || directForm.contactEmail,
        adminPassword: directForm.adminPassword,
        loginUrl: `${window.location.origin}/login`,
      });
      fetchHospitals();
    } catch (err) {
      setActionMessage(`Failed to provision hospital: ${err.error?.message || err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStatusToggle = async (hospitalId, currentStatus) => {
    const nextStatus = currentStatus === 'SUSPENDED' ? 'APPROVED' : 'SUSPENDED';
    try {
      await axiosClient.patch(`/saas/hospitals/${hospitalId}/status`, { status: nextStatus });
      fetchHospitals();
    } catch (err) {
      console.error('Failed to toggle status:', err);
    }
  };

  const pendingHospitals = hospitals.filter((h) => h.status === 'PENDING_APPROVAL');
  const approvedHospitals = hospitals.filter((h) => h.status === 'APPROVED');

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-neutral-900 tracking-tight">Master Platform Owner SaaS Control Center</h2>
          <p className="text-xs text-neutral-500 mt-1">Platform Master Super Admin — superadmin@platform.com</p>
        </div>
        <Button variant="primary" size="sm" className="font-bold" onClick={() => setIsDirectCreateOpen(true)}>
          <PlusCircle size={16} /> Provision Hospital & Create Credentials
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Registered Hospitals" value={`${hospitals.length} Tenants`} subtitle="Multi-Tenant Isolation" icon={Building2} color="sky" />
        <StatCard title="Pending SaaS Approvals" value={`${pendingHospitals.length} Applications`} subtitle="Action Required" icon={Clock} color="amber" />
        <StatCard title="Active Subscriptions" value={`${approvedHospitals.length} Approved`} subtitle="Enterprise & Pro" icon={ShieldCheck} color="emerald" />
        <StatCard title="Platform Data Protection" value="100% Isolated" subtitle="Zero Cross-Tenant Access" icon={Users} color="purple" />
      </div>

      {actionMessage && (
        <div className="p-3 rounded-lg bg-neutral-100 border border-neutral-300 text-neutral-700 text-xs font-bold flex items-center gap-2">
          <CheckCircle size={16} className="text-neutral-600" /> {actionMessage}
        </div>
      )}

      {/* Pending Hospital Applications */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-neutral-900 flex items-center gap-2">
            <Clock size={18} className="text-neutral-600" />
            Pending SaaS Hospital Registration Applications ({pendingHospitals.length})
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-100 text-neutral-600 uppercase tracking-wider text-[10px] border-b border-neutral-200">
              <tr>
                <th className="p-3">Hospital Name</th>
                <th className="p-3">Subdomain</th>
                <th className="p-3">Contact Officer</th>
                <th className="p-3">SaaS Plan</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Approval Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 text-neutral-800">
              {pendingHospitals.length > 0 ? (
                pendingHospitals.map((hosp) => (
                  <tr key={hosp._id} className="hover:bg-neutral-50">
                    <td className="p-3 font-bold text-neutral-900">{hosp.name}</td>
                    <td className="p-3 font-mono text-neutral-600">{hosp.subdomain}.hpmbs.com</td>
                    <td className="p-3 text-neutral-600">{hosp.contactName} ({hosp.contactEmail})</td>
                    <td className="p-3 font-bold text-neutral-700">{hosp.plan}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] bg-neutral-200 text-neutral-700 border border-neutral-300 font-bold">
                        PENDING
                      </span>
                    </td>
                    <td className="p-3 text-right space-x-2">
                      <Button size="sm" variant="primary" className="font-bold" isLoading={isLoading} onClick={() => handleApprove(hosp._id, hosp.name)}>
                        <CheckCircle size={14} /> Approve
                      </Button>
                      <Button size="sm" variant="outline" className="font-bold border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300" isLoading={isLoading} onClick={() => handleReject(hosp._id, hosp.name)}>
                        <XCircle size={14} /> Reject
                      </Button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-neutral-500">
                    No pending hospital applications. Click 'Provision Hospital & Create Credentials' to create a tenant directly!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Approved Active SaaS Hospitals */}
      <Card>
        <h3 className="text-base font-bold text-neutral-900 mb-4 flex items-center gap-2">
          <Building2 size={18} className="text-neutral-600" />
          Active SaaS Tenant Hospitals ({approvedHospitals.length})
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-100 text-neutral-600 uppercase tracking-wider text-[10px] border-b border-neutral-200">
              <tr>
                <th className="p-3">Hospital Tenant Name</th>
                <th className="p-3">Subdomain Code</th>
                <th className="p-3">Authorized Admin Email</th>
                <th className="p-3">Plan</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Management</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 text-neutral-800">
              {approvedHospitals.length > 0 ? (
                approvedHospitals.map((hosp) => (
                  <tr key={hosp._id} className="hover:bg-neutral-50">
                    <td className="p-3 font-bold text-neutral-900">{hosp.name}</td>
                    <td className="p-3 font-mono text-neutral-600">{hosp.subdomain}</td>
                    <td className="p-3 text-neutral-600">{hosp.contactEmail}</td>
                    <td className="p-3 font-bold text-neutral-700">{hosp.plan}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        hosp.status === 'APPROVED'
                          ? 'bg-neutral-900 text-white border-neutral-900'
                          : 'bg-neutral-200 text-neutral-600 border-neutral-300'
                      }`}>
                        {hosp.status}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <Button size="sm" variant="outline" onClick={() => handleStatusToggle(hosp._id, hosp.status)}>
                        {hosp.status === 'SUSPENDED' ? 'Re-Activate' : 'Suspend Tenant'}
                      </Button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-neutral-500">No active approved hospitals yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Direct Provisioning Modal */}
      {isDirectCreateOpen && (
        <div className="modal-overlay animate-fade-in">
          <div className="modal-container max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-neutral-100 border border-neutral-200 text-neutral-600 flex-shrink-0">
                  <Key size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-neutral-900">
                    {provisionedCreds ? 'Hospital Account Handover Ready!' : 'Direct Hospital Sale & Credentials Provisioning'}
                  </h3>
                  {!provisionedCreds && (
                    <p className="text-xs text-neutral-500 mt-0.5">Create an approved tenant and generate Admin credentials immediately.</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => { setIsDirectCreateOpen(false); setProvisionedCreds(null); }}
                className="modal-close-btn"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              {provisionedCreds ? (
                <div className="space-y-4 text-xs text-center">
                  <div className="w-12 h-12 rounded-full bg-neutral-100 text-neutral-700 flex items-center justify-center mx-auto border border-neutral-200">
                    <CheckCircle size={28} />
                  </div>
                  <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-200 text-left space-y-2 font-mono">
                    <p><span className="text-neutral-500">Hospital:</span> <span className="text-neutral-900 font-bold">{provisionedCreds.hospitalName}</span></p>
                    <p><span className="text-neutral-500">Admin Email:</span> <span className="text-neutral-800 font-bold">{provisionedCreds.adminEmail}</span></p>
                    <p><span className="text-neutral-500">Admin Password:</span> <span className="text-neutral-900 font-bold">{provisionedCreds.adminPassword}</span></p>
                    <p><span className="text-neutral-500">Login URL:</span> <span className="text-neutral-700">{provisionedCreds.loginUrl}</span></p>
                  </div>
                  <p className="text-[11px] text-neutral-500 text-left">
                    Hand over these login credentials to the hospital client. They can now log in, create their doctors, staff, and run their hospital!
                  </p>
                  <Button variant="primary" className="w-full font-bold" onClick={() => { setIsDirectCreateOpen(false); setProvisionedCreds(null); }}>
                    Done & Close
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleDirectCreate} className="space-y-4 text-xs">
                  <Input label="Hospital Client Name" value={directForm.hospitalName} onChange={(e) => setDirectForm({ ...directForm, hospitalName: e.target.value })} placeholder="Hospital Name" required />
                  <Input label="Subdomain / Code" value={directForm.subdomain} onChange={(e) => setDirectForm({ ...directForm, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '') })} placeholder="hospital-name" required />
                  <Input label="Hospital Authorized Officer Name" value={directForm.contactName} onChange={(e) => setDirectForm({ ...directForm, contactName: e.target.value })} placeholder="Your Name" required />
                  <Input label="Hospital Admin Email (Handover Login ID)" type="email" value={directForm.contactEmail} onChange={(e) => setDirectForm({ ...directForm, contactEmail: e.target.value })} placeholder="email@gmail.com" required />
                  <PasswordInput label="Hospital Admin Password" value={directForm.adminPassword} onChange={(e) => setDirectForm({ ...directForm, adminPassword: e.target.value })} placeholder="Minimum 8 characters" required />
                  <PasswordInput
                    label="Confirm Admin Password"
                    value={directForm.confirmAdminPassword}
                    onChange={(e) => setDirectForm({ ...directForm, confirmAdminPassword: e.target.value })}
                    placeholder="Re-enter admin password"
                    helperText={
                      directForm.confirmAdminPassword && directForm.adminPassword !== directForm.confirmAdminPassword
                        ? 'Passwords do not match!'
                        : ''
                    }
                    error={
                      directForm.confirmAdminPassword && directForm.adminPassword !== directForm.confirmAdminPassword
                        ? 'Passwords do not match'
                        : ''
                    }
                    required
                  />

                  <div className="flex gap-2 pt-2">
                    <Button type="button" variant="outline" className="w-1/2" onClick={() => setIsDirectCreateOpen(false)}>Cancel</Button>
                    <Button type="submit" variant="primary" className="w-1/2 font-bold" isLoading={isLoading}>Provision & Generate Credentials</Button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

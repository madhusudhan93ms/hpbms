import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ClipboardList, CheckCircle2, XCircle, Eye, Building2, Mail, Phone,
  MapPin, Calendar, Clock, RefreshCw, ShieldCheck, AlertTriangle, User, Trash2
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { axiosClient } from '../../api/axiosClient';
import { formatDate } from '../../utils/formatters';
import { useSuperAdminContextStore } from '../../store/superAdminContextStore';

const PLAN_COLORS = {
  BASIC: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  STANDARD: { bg: 'bg-violet-100', text: 'text-violet-700', border: 'border-violet-200' },
  UNLIMITED: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' },
  PROFESSIONAL: { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200' },
  ENTERPRISE: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200' },
  STARTER: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' },
};

export const SuperAdminPendingApprovalsPage = () => {
  const navigate = useNavigate();
  const cachedPending = useSuperAdminContextStore((s) => s.pendingApprovals);
  const [hospitals, setHospitals] = useState(() => cachedPending || []);
  const [isLoading, setIsLoading] = useState(() => (cachedPending || []).length === 0);
  const [actionMsg, setActionMsg] = useState(null);
  const [processingId, setProcessingId] = useState(null);

  const fetchPending = useCallback(async (silent = false) => {
    if (!silent && hospitals.length === 0) setIsLoading(true);
    try {
      const hospRes = await axiosClient.get('/saas/hospitals/pending');
      const list = hospRes.data?.data || hospRes.data || [];
      setHospitals(list);
      useSuperAdminContextStore.getState().setPendingApprovals(list);
    } catch (err) {
      try {
        const fallback = await axiosClient.get('/saas/hospitals');
        const list = fallback.data?.data || fallback.data || [];
        const filtered = list.filter(
          (h) => !h.isDeleted && (h.status === 'PENDING_APPROVAL' || h.status === 'PENDING')
        );
        setHospitals(filtered);
        useSuperAdminContextStore.getState().setPendingApprovals(filtered);
      } catch (e) {
        console.error('Failed to load pending approvals:', e);
      }
    } finally {
      setIsLoading(false);
    }
  }, [hospitals.length]);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  const showMsg = (msg, type = 'success') => {
    setActionMsg({ msg, type });
    setTimeout(() => setActionMsg(null), 4000);
  };

  const handleApprove = async (hospital) => {
    setProcessingId(hospital._id);
    try {
      await axiosClient.patch(`/saas/hospitals/${hospital._id}/approve`);
      showMsg(`"${hospital.name}" approved! Admin account provisioned.`, 'success');
      setHospitals((prev) => prev.filter((h) => h._id !== hospital._id));
      useSuperAdminContextStore.getState().removePendingApproval(hospital._id);
      useSuperAdminContextStore.getState().updateHospital(hospital._id, { status: 'APPROVED' });
    } catch (err) {
      showMsg(`Failed to approve: ${err?.response?.data?.message || err.message}`, 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (hospital) => {
    if (!window.confirm(`Reject hospital application for "${hospital.name}"? This action cannot be undone.`)) return;
    setProcessingId(hospital._id);
    try {
      await axiosClient.patch(`/saas/hospitals/${hospital._id}/status`, { status: 'REJECTED' });
      showMsg(`"${hospital.name}" application rejected.`, 'error');
      setHospitals((prev) => prev.filter((h) => h._id !== hospital._id));
      useSuperAdminContextStore.getState().removePendingApproval(hospital._id);
      useSuperAdminContextStore.getState().updateHospital(hospital._id, { status: 'REJECTED' });
    } catch (err) {
      showMsg(`Failed to reject: ${err?.response?.data?.message || err.message}`, 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDelete = async (hospital) => {
    if (!window.confirm(`Permanently delete "${hospital.name}"? This will completely wipe all its branches, departments, users, and transactions from the database immediately.`)) return;
    setProcessingId(hospital._id);
    try {
      await axiosClient.delete(`/saas/hospitals/${hospital._id}/permanent`);
      showMsg(`"${hospital.name}" and all its records permanently deleted.`, 'success');
      setHospitals((prev) => prev.filter((h) => h._id !== hospital._id));
    } catch (err) {
      showMsg(`Failed to delete: ${err?.response?.data?.message || err.message}`, 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const getTrialDaysLeft = (hospital) => {
    if (!hospital.trialEndDate) return null;
    const days = Math.ceil((new Date(hospital.trialEndDate) - new Date()) / (1000 * 60 * 60 * 24));
    return days;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center">
              <ClipboardList size={20} className="text-amber-600" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-neutral-900 tracking-tight">Pending Approvals</h2>
              <p className="text-xs text-neutral-500 mt-0.5">Review and approve new hospital applications & branch expansion requests</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchPending} className="gap-2">
            <RefreshCw size={14} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Action Message */}
      {actionMsg && (
        <div className={`p-4 rounded-xl border font-semibold text-sm flex items-center gap-3 animate-fade-in ${
          actionMsg.type === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {actionMsg.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          {actionMsg.msg}
        </div>
      )}

      {/* Loading */}
      {isLoading && hospitals.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 p-6 animate-pulse">
              <div className="h-5 bg-slate-100 rounded w-2/3 mb-4" />
              <div className="h-3 bg-slate-100 rounded w-full mb-2" />
              <div className="h-3 bg-slate-100 rounded w-3/4 mb-6" />
            </div>
          ))}
        </div>
      ) : hospitals.length === 0 ? (
        <Card>
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto mb-4">
              <ShieldCheck size={32} className="text-emerald-500" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 mb-2">All Clear!</h3>
            <p className="text-slate-500 text-sm">No hospital registration applications pending review.</p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {hospitals.map((hospital) => {
            const planStyle = PLAN_COLORS[hospital.plan] || PLAN_COLORS.PROFESSIONAL;
            const trialDaysLeft = getTrialDaysLeft(hospital);
            const isProcessing = processingId === hospital._id;

            return (
              <div
                key={hospital._id}
                className="bg-white rounded-2xl border border-amber-200 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden"
              >
                {/* Top bar */}
                <div className="px-5 pt-4 pb-3 border-b border-amber-100 bg-amber-50">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-amber-200 border border-amber-300 flex items-center justify-center flex-shrink-0">
                        <Building2 size={18} className="text-amber-700" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold text-slate-900 text-sm truncate">{hospital.name}</h3>
                        <p className="text-[10px] text-slate-400 font-mono">{hospital.subdomain}.hpmbs.com</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-black border ${planStyle.bg} ${planStyle.text} ${planStyle.border}`}>
                        {hospital.plan}
                      </span>
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-amber-100 text-amber-700 border border-amber-200">
                        PENDING
                      </span>
                    </div>
                  </div>
                </div>

                {/* Body */}
                <div className="px-5 py-4 space-y-2.5">
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <User size={13} className="text-slate-400 shrink-0" />
                    <span className="font-semibold">{hospital.contactName}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <Mail size={13} className="text-slate-400 shrink-0" />
                    <span className="font-mono">{hospital.contactEmail}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <Phone size={13} className="text-slate-400 shrink-0" />
                    <span>{hospital.contactPhone}</span>
                  </div>
                  {hospital.address?.city && (
                    <div className="flex items-center gap-2 text-xs text-slate-600">
                      <MapPin size={13} className="text-slate-400 shrink-0" />
                      <span>{[hospital.address.city, hospital.address.state, hospital.address.country].filter(Boolean).join(', ')}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <Calendar size={13} className="text-slate-400 shrink-0" />
                    <span>Applied: <span className="font-semibold">{formatDate(hospital.createdAt)}</span></span>
                  </div>
                  {trialDaysLeft !== null && (
                    <div className="flex items-center gap-2 text-xs">
                      <Clock size={13} className={trialDaysLeft <= 2 ? 'text-red-400' : 'text-emerald-400'} />
                      <span className={trialDaysLeft <= 2 ? 'text-red-600 font-bold' : 'text-emerald-700 font-semibold'}>
                        7-Day Free Trial · {trialDaysLeft > 0 ? `${trialDaysLeft} days left` : 'Expired'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="px-5 pb-4 flex flex-col gap-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleApprove(hospital)}
                      disabled={isProcessing}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                    >
                      <CheckCircle2 size={13} />
                      {isProcessing ? '...' : 'Approve'}
                    </button>
                    <button
                      onClick={() => handleReject(hospital)}
                      disabled={isProcessing}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 font-bold text-[10px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <XCircle size={13} />
                      Reject
                    </button>
                    <button
                      onClick={() => handleDelete(hospital)}
                      disabled={isProcessing}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-[10px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Trash2 size={13} />
                      Delete
                    </button>
                  </div>
                  <button
                    onClick={() => navigate(`/admin/hospital/${hospital._id}/dashboard`)}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 font-semibold text-xs transition-colors"
                  >
                    <Eye size={14} />
                    View Details
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Info panel about approval process */}
      <Card>
        <div className="flex items-start gap-4">
          <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center flex-shrink-0 mt-0.5">
            <ShieldCheck size={16} className="text-blue-600" />
          </div>
          <div className="text-xs text-slate-600 space-y-1">
            <p className="font-bold text-slate-800">Approval Process</p>
            <p>When you approve a hospital, the system will automatically:</p>
            <ul className="list-disc list-inside space-y-0.5 text-slate-500 pl-2">
              <li>Create the Hospital Admin user account with the requested password</li>
              <li>Set up the Main Branch for the hospital</li>
              <li>Activate the 7-day free trial period</li>
              <li>Send welcome notifications to the hospital admin</li>
            </ul>
            <p className="mt-2 text-slate-500">
              <span className="font-semibold text-slate-700">Data Retention Policy:</span> After a plan expires, hospital data is retained for 90 days before permanent deletion.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};

import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Stethoscope, ConciergeBell, Activity, TestTube, Scan, Pill, CreditCard,
  UserCircle, BedDouble, Users, Calendar, IndianRupee, ShieldAlert, ClipboardList,
  Search, Key, Edit, CheckCircle2, Lock, X, ArrowDown,
  RefreshCw, AlertTriangle, Zap, TrendingUp, Globe, BadgeCheck, Clock,
  Building2, PauseCircle, PlayCircle, Trash2, MapPin, Phone, Mail, ExternalLink,
  Database, Download,
} from 'lucide-react';
import { StatCard } from '../../components/ui/StatCard';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { axiosClient } from '../../api/axiosClient';
import { SuperAdminHospitalContext } from '../../components/superadmin/SuperAdminModuleBridge';
import { useSuperAdminContextStore } from '../../store/superAdminContextStore';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/formatters';

const HOSPITAL_DASHBOARD_CARDS = [
  { key: 'doctors', title: 'TOTAL DOCTORS', icon: Stethoscope, color: 'emerald', roleFilter: 'DOCTOR' },
  { key: 'receptionists', title: 'TOTAL RECEPTIONISTS', icon: ConciergeBell, color: 'blue', roleFilter: 'RECEPTIONIST' },
  { key: 'nurses', title: 'TOTAL NURSES', icon: Activity, color: 'teal', roleFilter: 'NURSE' },
  { key: 'labStaff', title: 'TOTAL LABORATORY STAFF', icon: TestTube, color: 'indigo', roleFilter: 'LAB_TECH' },
  { key: 'radiologyStaff', title: 'TOTAL RADIOLOGY STAFF', icon: Scan, color: 'purple', roleFilter: 'RADIOLOGIST' },
  { key: 'pharmacyStaff', title: 'TOTAL PHARMACY STAFF', icon: Pill, color: 'rose', roleFilter: 'PHARMACIST' },
  { key: 'billingStaff', title: 'TOTAL BILLING STAFF', icon: CreditCard, color: 'amber', roleFilter: 'CASHIER' },
  { key: 'totalPatients', title: 'TOTAL PATIENTS', icon: UserCircle, color: 'sky', viewTab: 'patients' },
  { key: 'opdPatients', title: 'TOTAL OPD PATIENTS', icon: ClipboardList, color: 'blue', viewTab: 'patients' },
  { key: 'ipdPatients', title: 'TOTAL IPD PATIENTS', icon: BedDouble, color: 'indigo', viewTab: 'patients' },
  { key: 'activeStaff', title: 'ACTIVE STAFF', icon: Users, color: 'emerald', roleFilter: 'ALL_ACTIVE' },
  { key: 'inactiveStaff', title: 'INACTIVE STAFF', icon: Users, color: 'amber', roleFilter: 'ALL_INACTIVE' },
];

const PLAN_META = {
  BASIC:     { label: 'Basic Plan',     icon: Zap,        bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200',    price: { MONTHLY: 4000,  YEARLY: 40000  } },
  STANDARD:  { label: 'Standard Plan',  icon: TrendingUp, bg: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200',  price: { MONTHLY: 30000, YEARLY: 300000 } },
  UNLIMITED: { label: 'Unlimited Plan', icon: Globe,      bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', price: { MONTHLY: 50000, YEARLY: 500000 } },
};

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Cheque', 'UPI', 'NEFT / RTGS', 'Credit Card', 'Other'];

// ── Renew Subscription Modal ─────────────────────────────────────────────────
const RenewSubscriptionModal = ({ hospital, onClose, onRenewed }) => {
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(hospital.plan || 'BASIC');
  const [billingCycle, setBillingCycle] = useState('MONTHLY');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [paymentRef, setPaymentRef] = useState('');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [renewalNote, setRenewalNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    axiosClient.get('/saas/plans').then((r) => {
      const fetched = r.data || [];
      setPlans(fetched);
    }).catch(() => {});
  }, []);

  // Auto-fill price when plan or cycle changes
  useEffect(() => {
    const meta = PLAN_META[selectedPlan];
    if (meta) {
      setPaymentAmount(String(meta.price[billingCycle] || ''));
    }
  }, [selectedPlan, billingCycle]);

  const handleSubmit = async () => {
    if (!selectedPlan) { setError('Please select a plan.'); return; }
    setIsSubmitting(true);
    setError('');
    setSuccess('');
    try {
      await axiosClient.post(`/saas/hospitals/${hospital._id}/assign-plan`, {
        planCode: selectedPlan,
        billingCycle,
        paymentAmount: paymentAmount ? Number(paymentAmount) : undefined,
        paymentMethod,
        paymentRef: paymentRef.trim() || undefined,
        paidAt,
        renewalNote: renewalNote.trim() || undefined,
      });
      setSuccess(`${PLAN_META[selectedPlan]?.label || selectedPlan} activated successfully! Hospital renewed.`);
      setTimeout(() => {
        onRenewed();
        onClose();
      }, 1600);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to assign plan. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedMeta = PLAN_META[selectedPlan];
  const PlanIcon = selectedMeta?.icon || Zap;
  const daysAdded = billingCycle === 'YEARLY' ? 365 : 30;
  const newExpiry = new Date(Date.now() + daysAdded * 24 * 60 * 60 * 1000);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-indigo-100">
              <RefreshCw size={18} className="text-indigo-700" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">Renew / Assign Plan</h3>
              <p className="text-xs text-slate-500">{hospital.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        {/* Current Status */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1">
          <p className="font-bold text-slate-700 uppercase text-[10px] tracking-wider">Current Subscription Status</p>
          <div className="flex items-center justify-between">
            <span className="text-slate-600">Active Plan:</span>
            <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${PLAN_META[hospital.plan]?.bg || 'bg-slate-100'} ${PLAN_META[hospital.plan]?.text || 'text-slate-700'}`}>
              {hospital.plan || 'BASIC'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-600">Expires:</span>
            <span className="font-mono font-bold text-slate-900">{hospital.subscriptionEndDate ? formatDate(hospital.subscriptionEndDate) : 'N/A'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-600">Status:</span>
            <span className={`font-bold ${hospital.status === 'APPROVED' ? 'text-emerald-700' : 'text-rose-700'}`}>{hospital.status}</span>
          </div>
        </div>

        {/* Plan Selector */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Select Plan</label>
          <div className="grid grid-cols-3 gap-2">
            {['BASIC', 'STANDARD', 'UNLIMITED'].map((code) => {
              const meta = PLAN_META[code];
              const Icon = meta.icon;
              const isSelected = selectedPlan === code;
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => setSelectedPlan(code)}
                  className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 text-xs font-bold transition-all ${
                    isSelected
                      ? `${meta.border} ${meta.bg} ${meta.text} shadow-sm scale-[1.02]`
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                  }`}
                >
                  <Icon size={18} />
                  <span>{code}</span>
                  <span className="text-[10px] font-normal text-slate-500">
                    ₹{(meta.price.MONTHLY / 1000).toFixed(0)}K/mo
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Billing Cycle */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Billing Cycle</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: 'MONTHLY', label: 'Monthly', sub: '30 days' },
              { key: 'YEARLY', label: 'Yearly', sub: '365 days — Save ~17%' },
            ].map(({ key, label, sub }) => (
              <button
                key={key}
                type="button"
                onClick={() => setBillingCycle(key)}
                className={`flex flex-col items-start px-4 py-2.5 rounded-xl border-2 text-xs font-bold transition-all ${
                  billingCycle === key
                    ? 'border-indigo-400 bg-indigo-50 text-indigo-700 shadow-sm'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                <span>{label}</span>
                <span className="text-[10px] font-normal text-slate-500">{sub}</span>
              </button>
            ))}
          </div>
        </div>

        {/* New Expiry Preview */}
        {selectedPlan && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold ${selectedMeta?.bg || 'bg-slate-50'} ${selectedMeta?.text || 'text-slate-700'} border ${selectedMeta?.border || 'border-slate-200'}`}>
            <BadgeCheck size={14} />
            <span>New expiry: <strong>{newExpiry.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</strong></span>
          </div>
        )}

        {/* Payment Details */}
        <div className="space-y-3">
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Payment Details</label>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Amount Received (₹)</label>
              <input
                type="number"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="e.g. 4000"
                className="w-full px-3 py-2 border rounded-lg text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 border-slate-200"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Payment Method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-xs font-semibold text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 border-slate-200"
              >
                {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Payment Date</label>
              <input
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 border-slate-200"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase">Reference / Txn ID</label>
              <input
                type="text"
                value={paymentRef}
                onChange={(e) => setPaymentRef(e.target.value)}
                placeholder="UTR / Cheque No / Ref"
                className="w-full px-3 py-2 border rounded-lg text-xs font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 border-slate-200"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Internal Note (Optional)</label>
            <textarea
              value={renewalNote}
              onChange={(e) => setRenewalNote(e.target.value)}
              placeholder="e.g. Payment received in person by owner. Renewal for Aug 2026."
              rows={2}
              className="w-full px-3 py-2 border rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 border-slate-200 resize-none"
            />
          </div>
        </div>

        {/* Feedback */}
        {error && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-2">
            <AlertTriangle size={14} /> {error}
          </div>
        )}
        {success && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold flex items-center gap-2">
            <CheckCircle2 size={14} /> {success}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-1 border-t">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button
            size="sm"
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold gap-2"
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            <RefreshCw size={13} className={isSubmitting ? 'animate-spin' : ''} />
            {isSubmitting ? 'Activating...' : 'Activate & Renew Plan'}
          </Button>
        </div>
      </div>
    </div>
  );
};

// ── Subscription Status Bar ──────────────────────────────────────────────────
const SubscriptionStatusBar = ({ hospital, onRenewClick }) => {
  const now = new Date();
  const endDate = hospital.subscriptionEndDate ? new Date(hospital.subscriptionEndDate) : null;
  const daysLeft = endDate ? Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)) : null;
  const isExpired = daysLeft !== null && daysLeft <= 0;
  const isExpiringSoon = daysLeft !== null && daysLeft > 0 && daysLeft <= 7;
  const isTrial = hospital.isTrial;
  const meta = PLAN_META[hospital.plan] || PLAN_META.BASIC;
  const PlanIcon = meta.icon;

  let statusColor = 'bg-emerald-50 border-emerald-200 text-emerald-800';
  let statusLabel = 'Active';
  let statusIcon = <BadgeCheck size={13} className="text-emerald-600" />;

  if (isExpired) {
    statusColor = 'bg-rose-50 border-rose-200 text-rose-800';
    statusLabel = 'Expired';
    statusIcon = <AlertTriangle size={13} className="text-rose-600" />;
  } else if (isExpiringSoon) {
    statusColor = 'bg-amber-50 border-amber-200 text-amber-800';
    statusLabel = `Expiring in ${daysLeft}d`;
    statusIcon = <Clock size={13} className="text-amber-600" />;
  } else if (isTrial) {
    statusColor = 'bg-purple-50 border-purple-200 text-purple-800';
    statusLabel = 'Trial';
    statusIcon = <Clock size={13} className="text-purple-600" />;
  }

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl border text-xs ${statusColor}`}>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5 font-bold">
          <PlanIcon size={14} />
          <span>{meta.label}</span>
        </div>
        <div className="text-[11px] opacity-80">
          Start: <strong>{hospital.subscriptionStartDate ? formatDate(hospital.subscriptionStartDate) : '—'}</strong>
        </div>
        <div className="text-[11px] opacity-80">
          Expires: <strong>{endDate ? formatDate(endDate) : '—'}</strong>
        </div>
        {daysLeft !== null && (
          <div className="flex items-center gap-1 text-[11px] font-semibold">
            {statusIcon}
            <span>{statusLabel}</span>
            {!isExpired && daysLeft > 0 && <span className="opacity-70">({daysLeft} days left)</span>}
          </div>
        )}
      </div>
      <button
        onClick={onRenewClick}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all shadow-sm
          ${isExpired || isExpiringSoon
            ? 'bg-indigo-600 text-white border-indigo-700 hover:bg-indigo-700'
            : 'bg-white border-current opacity-80 hover:opacity-100 hover:shadow'}`}
      >
        <RefreshCw size={12} />
        {isExpired ? 'Renew Now' : 'Change / Renew Plan'}
      </button>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────
export const SuperAdminHospitalDashboard = () => {
  const { hospitalId } = useParams();
  const navigate = useNavigate();
  const { setSelectedHospital } = useSuperAdminContextStore();
  const [detail, setDetail] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Active Tab & Role Filter State — default ALL to show all 10 staff
  const [activeTab, setActiveTab] = useState('staff');
  const [roleFilter, setRoleFilter] = useState('ALL'); // FIX: was 'DOCTOR', now 'ALL'
  const [searchTerm, setSearchTerm] = useState('');

  // Password Change Modal State
  const [selectedStaffForPassword, setSelectedStaffForPassword] = useState(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [passwordUpdateSuccess, setPasswordUpdateSuccess] = useState('');
  const [passwordUpdateError, setPasswordUpdateError] = useState('');

  // Renewal Modal
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [databaseAction, setDatabaseAction] = useState('');
  const [databaseMessage, setDatabaseMessage] = useState('');
  const [databaseError, setDatabaseError] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');

  const detailsTableRef = useRef(null);

  const handleExportData = async () => {
    if (!hospitalId || isExporting) return;
    setIsExporting(true);
    setExportMessage('');
    try {
      const archive = await axiosClient.get(`/saas/hospitals/${hospitalId}/export`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(archive);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${detail?.hospital?.domain || detail?.hospital?.code || 'hospital'}-backup-${new Date().toISOString().slice(0, 10)}.ndjson`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportMessage('Hospital data backup downloaded successfully!');
    } catch (err) {
      setExportMessage(`Export failed: ${err.error?.message || err.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPatientsCsv = async () => {
    if (!hospitalId) return;
    try {
      const archive = await axiosClient.get(`/saas/hospitals/${hospitalId}/export-patients-csv`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(archive);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${detail?.hospital?.domain || detail?.hospital?.code || 'hospital'}-customers-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download CSV:', err);
    }
  };

  const fetchData = async () => {
    try {
      const res = await axiosClient.get(`/saas/hospitals/${hospitalId}/detail`);
      setDetail(res.data);
      if (res.data?.hospital) {
        setSelectedHospital(hospitalId, res.data.hospital.name);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (hospitalId) fetchData();
  }, [hospitalId]);

  if (isLoading) return <div className="text-center py-16 text-slate-500">Loading hospital overview...</div>;
  if (!detail) return <div className="text-center py-16 text-red-500">Hospital not found</div>;

  const { hospital, stats, staffList = [], patientList = [], branches = [] } = detail;

  const handleCardClick = (card) => {
    if (card.viewTab) {
      setActiveTab(card.viewTab);
    } else if (card.roleFilter) {
      setActiveTab('staff');
      setRoleFilter(card.roleFilter);
    }
    if (detailsTableRef.current) {
      detailsTableRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleOpenPasswordModal = (staff) => {
    setSelectedStaffForPassword(staff);
    setNewPasswordInput('');
    setPasswordUpdateSuccess('');
    setPasswordUpdateError('');
  };

  const handleSavePassword = async () => {
    if (!newPasswordInput || newPasswordInput.trim().length < 8) {
      setPasswordUpdateError('Password must be at least 8 characters long');
      return;
    }

    setIsUpdatingPassword(true);
    setPasswordUpdateError('');
    setPasswordUpdateSuccess('');

    try {
      await axiosClient.patch(`/auth/staff/${selectedStaffForPassword._id}/password`, {
        newPassword: newPasswordInput.trim()
      });

      setDetail((prev) => {
        if (!prev) return prev;
        const updatedStaffList = (prev.staffList || []).map((s) => {
          if (s._id === selectedStaffForPassword._id) {
            return s;
          }
          return s;
        });
        return { ...prev, staffList: updatedStaffList };
      });

      setPasswordUpdateSuccess(`Password updated successfully for ${selectedStaffForPassword.name}`);
      setTimeout(() => {
        setSelectedStaffForPassword(null);
      }, 1200);
    } catch (err) {
      console.error(err);
      setPasswordUpdateError(err.response?.data?.message || 'Failed to update password');
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const runDatabaseAction = async (action) => {
    const isActivation = action === 'activate';
    const confirmed = window.confirm(
      isActivation
        ? 'Activate this hospital dedicated database now? New hospital writes will be paused briefly while the final changes are copied and verified.'
        : 'Prepare a dedicated database copy for this hospital? This is non-destructive and the hospital will continue using shared storage until activation.',
    );
    if (!confirmed) return;

    setDatabaseAction(action);
    setDatabaseMessage('');
    setDatabaseError('');
    try {
      const response = await axiosClient.post(`/saas/hospitals/${hospitalId}/database/${action}`);
      setDatabaseMessage(
        response?.message || response?.data?.message ||
          (isActivation ? 'Dedicated database activated successfully.' : 'Dedicated database copy prepared and verified.'),
      );
      await fetchData();
    } catch (err) {
      setDatabaseError(err.response?.data?.message || `Unable to ${action} the dedicated database.`);
    } finally {
      setDatabaseAction('');
    }
  };

  const filteredStaff = staffList.filter((staff) => {
    if (roleFilter === 'ALL_ACTIVE' && !staff.isActive && staff.status !== 'ACTIVE') return false;
    if (roleFilter === 'ALL_INACTIVE' && (staff.isActive || staff.status === 'ACTIVE')) return false;

    if (roleFilter !== 'ALL' && roleFilter !== 'ALL_ACTIVE' && roleFilter !== 'ALL_INACTIVE') {
      const sRole = String(staff.role || '').toUpperCase();
      const targetRole = String(roleFilter).toUpperCase();
      const addRoles = (staff.additionalRoles || []).map((r) => String(r).toUpperCase());

      if (targetRole === 'DOCTOR' && !['DOCTOR', 'PHYSICIAN'].includes(sRole) && !addRoles.includes('DOCTOR')) return false;
      if (targetRole === 'NURSE' && !['NURSE', 'NURSE_INCHARGE'].includes(sRole) && !addRoles.includes('NURSE') && !addRoles.includes('NURSE_INCHARGE')) return false;
      if (targetRole === 'RECEPTIONIST' && !['RECEPTIONIST', 'RECEPTION', 'FRONT_DESK'].includes(sRole) && !addRoles.includes('RECEPTIONIST')) return false;
      if (targetRole === 'LAB_TECH' && !['LAB_TECH', 'LABORATORY_STAFF', 'PATHOLOGIST'].includes(sRole) && !addRoles.includes('LAB_TECH')) return false;
      if (targetRole === 'RADIOLOGIST' && !['RADIOLOGIST', 'RADIOLOGY_STAFF'].includes(sRole) && !addRoles.includes('RADIOLOGIST')) return false;
      if (targetRole === 'PHARMACIST' && !['PHARMACIST', 'PHARMACY_STAFF'].includes(sRole) && !addRoles.includes('PHARMACIST')) return false;
      if (targetRole === 'CASHIER' && !['CASHIER', 'BILLING_STAFF', 'ACCOUNTANT'].includes(sRole) && !addRoles.includes('CASHIER')) return false;
      if (targetRole === 'HOSPITAL_ADMIN' && !['HOSPITAL_ADMIN', 'ADMIN'].includes(sRole) && !addRoles.includes('HOSPITAL_ADMIN')) return false;
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return (
        staff.name?.toLowerCase().includes(term) ||
        staff.email?.toLowerCase().includes(term) ||
        staff.role?.toLowerCase().includes(term) ||
        staff.specialization?.toLowerCase().includes(term)
      );
    }
    return true;
  });

  const filteredPatients = patientList.filter((patient) => {
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return (
        patient.firstName?.toLowerCase().includes(term) ||
        patient.lastName?.toLowerCase().includes(term) ||
        patient.uhid?.toLowerCase().includes(term) ||
        patient.phone?.toLowerCase().includes(term)
      );
    }
    return true;
  });

  const totalRevenue = stats.totalHospitalRevenue || hospital.totalHospitalRevenue || 0;

  const getTableTitle = () => {
    if (roleFilter === 'DOCTOR') return { title: `Doctor Performance & Consultation Reports (${filteredStaff.length})`, icon: Stethoscope, color: 'text-emerald-600' };
    if (roleFilter === 'RECEPTIONIST') return { title: `Receptionist Staff Credentials & Duty Reports (${filteredStaff.length})`, icon: ConciergeBell, color: 'text-blue-600' };
    if (roleFilter === 'NURSE') return { title: `Nursing Staff Credentials & Ward Reports (${filteredStaff.length})`, icon: Activity, color: 'text-teal-600' };
    if (roleFilter === 'LAB_TECH') return { title: `Laboratory Staff Credentials & Pathology Reports (${filteredStaff.length})`, icon: TestTube, color: 'text-indigo-600' };
    if (roleFilter === 'RADIOLOGIST') return { title: `Radiology Staff Credentials & RIS Reports (${filteredStaff.length})`, icon: Scan, color: 'text-purple-600' };
    if (roleFilter === 'PHARMACIST') return { title: `Pharmacy Staff Credentials & Inventory Reports (${filteredStaff.length})`, icon: Pill, color: 'text-rose-600' };
    if (roleFilter === 'CASHIER') return { title: `Billing Cashier Credentials & Invoice Reports (${filteredStaff.length})`, icon: CreditCard, color: 'text-amber-600' };
    return { title: `All Hospital Staff Credentials & Access Control (${filteredStaff.length})`, icon: Users, color: 'text-indigo-600' };
  };

  const tableHeader = getTableTitle();
  const TableHeaderIcon = tableHeader.icon;

  return (
    <SuperAdminHospitalContext hospitalId={hospitalId}>
      <div className="space-y-6 animate-fade-in pb-12">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-neutral-900 tracking-tight">{hospital.name}</h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                {hospital.code}
              </span>
            </div>
            <p className="text-xs text-neutral-500 mt-1">
              Super Admin Control Console · Hospital ID: {hospital._id} · Primary Admin: <strong>{hospital.administrator?.email || hospital.contactEmail}</strong>
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              className="border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 font-bold gap-1.5"
              onClick={handleExportData}
              isLoading={isExporting}
            >
              <Download size={13} />
              Export Data Backup
            </Button>
            <Button
              size="sm"
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold gap-2"
              onClick={() => setShowRenewModal(true)}
            >
              <RefreshCw size={13} />
              Renew / Assign Plan
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/admin/hospitals')}>
              Back to All Hospitals
            </Button>
          </div>
        </div>

        {exportMessage && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center justify-between">
            <span className="flex items-center gap-2"><CheckCircle2 size={16} /> {exportMessage}</span>
            <button onClick={() => setExportMessage('')} className="text-emerald-500 hover:text-emerald-700 p-1">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Subscription Status Bar */}
        <SubscriptionStatusBar
          hospital={hospital}
          onRenewClick={() => setShowRenewModal(true)}
        />

        <Card data-testid="tenant-database-card">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-cyan-50 text-cyan-700 border border-cyan-100">
                <Database size={20} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold text-slate-900">Hospital Data Storage</h3>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${hospital.storageMode === 'DEDICATED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : hospital.storageMode === 'DEDICATED_PENDING' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                    {hospital.storageMode || 'SHARED'}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white text-slate-600 border border-slate-200">
                    {hospital.databaseMigrationStatus || 'NOT_STARTED'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {hospital.storageMode === 'DEDICATED'
                    ? `Physically isolated database active${hospital.databaseKey ? ` (${hospital.databaseKey})` : ''}.`
                    : 'Shared storage is logically isolated by hospital ID. Prepare and verify a physical database before activation.'}
                </p>
                {hospital.databaseMigrationReport?.sourceDocuments !== undefined && (
                  <p className="text-[11px] text-slate-500 mt-1">
                    Last verified copy: <strong>{hospital.databaseMigrationReport.sourceDocuments}</strong> source documents
                    {hospital.databaseProvisionedAt ? ` · ${formatDateTime(hospital.databaseProvisionedAt)}` : ''}
                  </p>
                )}
                {hospital.databaseMigrationError && <p className="text-xs text-red-600 mt-1">{hospital.databaseMigrationError}</p>}
                {databaseMessage && <p className="text-xs text-emerald-700 font-semibold mt-2">{databaseMessage}</p>}
                {databaseError && <p className="text-xs text-red-600 font-semibold mt-2">{databaseError}</p>}
              </div>
            </div>
            {hospital.storageMode !== 'DEDICATED' && (
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <Button
                  data-testid="prepare-tenant-database"
                  variant="outline"
                  size="sm"
                  disabled={Boolean(databaseAction)}
                  onClick={() => runDatabaseAction('prepare')}
                >
                  <RefreshCw size={13} className={databaseAction === 'prepare' ? 'animate-spin' : ''} />
                  {hospital.databaseMigrationStatus === 'COPY_PREPARED' ? 'Re-prepare Copy' : 'Prepare Copy'}
                </Button>
                <Button
                  data-testid="activate-tenant-database"
                  size="sm"
                  disabled={Boolean(databaseAction) || hospital.storageMode !== 'DEDICATED_PENDING' || hospital.databaseMigrationStatus !== 'COPY_PREPARED'}
                  onClick={() => runDatabaseAction('activate')}
                  className="bg-cyan-700 hover:bg-cyan-800 text-white"
                >
                  <PlayCircle size={13} />
                  {databaseAction === 'activate' ? 'Activating...' : 'Activate Dedicated DB'}
                </Button>
              </div>
            )}
          </div>
        </Card>

        {/* Overview Info Cards */}
        <Card>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-xs">
            <div><p className="text-slate-400 font-bold uppercase text-[10px]">Registration Date</p><p className="font-semibold text-slate-900 mt-1">{formatDate(hospital.registrationDate)}</p></div>
            <div><p className="text-slate-400 font-bold uppercase text-[10px]">Plan & Subscription</p><p className="font-semibold text-slate-900 mt-1">{hospital.subscriptionPlan || hospital.plan}</p></div>
            <div><p className="text-slate-400 font-bold uppercase text-[10px]">Hospital Status</p><p className="font-semibold text-emerald-700 mt-1">{hospital.status}</p></div>
            <div><p className="text-slate-400 font-bold uppercase text-[10px]">Total Staff Created</p><p className="font-bold text-indigo-600 mt-1">{staffList.length} Members</p></div>
            <div><p className="text-slate-400 font-bold uppercase text-[10px]">Total All-Time Revenue</p><p className="font-extrabold text-emerald-600 mt-1 font-mono">{formatCurrency(totalRevenue)}</p></div>
          </div>
        </Card>

        {/* Interactive Dashboard Cards */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Users size={18} className="text-indigo-600" />
              Hospital Overview Dashboard Cards (Click any box to view staff, email & passwords below)
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {HOSPITAL_DASHBOARD_CARDS.map((card) => {
              const { key, title, icon, color, format } = card;
              return (
                <div
                  key={key}
                  onClick={() => handleCardClick(card)}
                  className="cursor-pointer transition-all hover:scale-[1.02] hover:shadow-md group relative"
                  title={`Click to view ${title} list, email, and passwords below`}
                >
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-indigo-600 text-white p-1 rounded-full text-[10px] shadow-sm">
                    <ArrowDown size={12} />
                  </div>
                  <StatCard
                    title={title}
                    value={format ? format(stats[key]) : (stats[key] ?? 0)}
                    subtitle="Click to show staff email & passwords below"
                    icon={icon}
                    color={color}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Dynamic Staff Credentials Table */}
        <div ref={detailsTableRef}>
          <Card className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setActiveTab('staff')}
                  className={`px-4 py-2 rounded-lg font-bold text-xs transition-colors ${activeTab === 'staff' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  Staff Email, Passwords & Access ({filteredStaff.length})
                </button>
                <button
                  onClick={() => setActiveTab('patients')}
                  className={`px-4 py-2 rounded-lg font-bold text-xs transition-colors ${activeTab === 'patients' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  Patient Directory ({filteredPatients.length})
                </button>
                <button
                  onClick={() => setActiveTab('revenue')}
                  className={`px-4 py-2 rounded-lg font-bold text-xs transition-colors ${activeTab === 'revenue' ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  Revenue & Performance Ledger
                </button>
              </div>

              {/* Search & Role Selectors */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search doctor, email, specialization..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8 pr-3 py-1.5 border rounded-lg text-xs w-56 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                {activeTab === 'staff' && (
                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                    className="px-3 py-1.5 border rounded-lg text-xs bg-white font-semibold text-slate-700"
                  >
                    <option value="ALL">All Staff Roles ({staffList.length})</option>
                    <option value="DOCTOR">Doctors ({staffList.filter(s => s.role === 'DOCTOR').length})</option>
                    <option value="NURSE">Nurses ({staffList.filter(s => s.role === 'NURSE' || s.role === 'NURSE_INCHARGE').length})</option>
                    <option value="RECEPTIONIST">Receptionists ({staffList.filter(s => s.role === 'RECEPTIONIST').length})</option>
                    <option value="LAB_TECH">Lab Techs ({staffList.filter(s => s.role === 'LAB_TECH' || s.role === 'LABORATORY_STAFF').length})</option>
                    <option value="RADIOLOGIST">Radiologists ({staffList.filter(s => s.role === 'RADIOLOGIST' || s.role === 'RADIOLOGY_STAFF').length})</option>
                    <option value="PHARMACIST">Pharmacists ({staffList.filter(s => s.role === 'PHARMACIST' || s.role === 'PHARMACY_STAFF').length})</option>
                    <option value="CASHIER">Billing Cashiers ({staffList.filter(s => s.role === 'CASHIER' || s.role === 'BILLING_STAFF').length})</option>
                    <option value="HOSPITAL_ADMIN">Hospital Admins ({staffList.filter(s => s.role === 'HOSPITAL_ADMIN').length})</option>
                    <option value="ALL_ACTIVE">Active Staff Only</option>
                    <option value="ALL_INACTIVE">Inactive Staff Only</option>
                  </select>
                )}
              </div>
            </div>

            {/* TAB 1: STAFF TABLE */}
            {activeTab === 'staff' && (
              <div className="pt-2">
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 mb-3">
                  <TableHeaderIcon size={20} className={tableHeader.color} />
                  {tableHeader.title}
                </h3>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="p-3">{roleFilter === 'DOCTOR' ? 'DOCTOR NAME' : 'STAFF NAME'}</th>
                        <th className="p-3">ROLE / SPECIALIZATION</th>
                        <th className="p-3">LOGIN EMAIL</th>
                        <th className="p-3">PASSWORD MANAGEMENT</th>
                        <th className="p-3">OPD CABIN / WARD</th>
                        <th className="p-3">DUTY STATUS</th>
                        <th className="p-3 text-right">SUPER ADMIN ACTION</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredStaff.map((staff) => {
                        return (
                          <tr key={staff._id} className="hover:bg-slate-50">
                            <td className="p-3">
                              <p className="font-bold text-slate-900">{staff.name}</p>
                              <p className="text-[10px] text-slate-400 font-mono">{staff.phone || 'No Phone'}</p>
                            </td>
                            <td className="p-3 font-semibold text-slate-700">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">{staff.role}</span>
                              {staff.specialization && (
                                <p className="text-[10px] text-slate-500 mt-0.5">{staff.specialization}</p>
                              )}
                            </td>
                            <td className="p-3 font-mono font-bold text-slate-700">{staff.email}</td>
                            <td className="p-3">
                              <div className="flex items-center gap-2 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200 w-max">
                                <Key size={13} className="text-amber-500 shrink-0" />
                                <span className="font-mono font-bold text-slate-900 selection:bg-amber-100">
                                  Secure hash only — use Change Password to reset
                                </span>
                              </div>
                            </td>
                            <td className="p-3 font-mono font-bold text-indigo-700">
                              {staff.cabinNo || 'Cabin 101'}
                            </td>
                            <td className="p-3">
                              <span className={`px-2.5 py-0.5 rounded font-bold text-[10px] ${staff.isAvailable !== false && staff.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                                {staff.isAvailable !== false && staff.isActive ? 'ON DUTY' : 'OFF DUTY'}
                              </span>
                            </td>
                            <td className="p-3 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-[11px] font-bold bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
                                onClick={() => handleOpenPasswordModal(staff)}
                              >
                                <Edit size={12} className="mr-1" /> Change Password
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {filteredStaff.length === 0 && (
                    <div className="p-8 text-center text-slate-500 text-xs">No staff members found matching criteria.</div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: PATIENTS DIRECTORY */}
            {activeTab === 'patients' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-1 flex-wrap gap-2">
                  <p className="text-xs text-slate-500">
                    Showing <strong>{filteredPatients.length}</strong> patient customer records.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 font-bold gap-1.5"
                    onClick={handleExportPatientsCsv}
                  >
                    <Download size={13} />
                    Download Customers (Excel / CSV)
                  </Button>
                </div>
                <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="p-3">Patient Name</th>
                      <th className="p-3">UHID</th>
                      <th className="p-3">Contact Phone</th>
                      <th className="p-3">Category</th>
                      <th className="p-3">Gender & Age</th>
                      <th className="p-3">Registration Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPatients.map((pat) => (
                      <tr key={pat._id} className="hover:bg-slate-50">
                        <td className="p-3 font-bold text-slate-900">{pat.firstName} {pat.lastName}</td>
                        <td className="p-3 font-mono font-bold text-indigo-700">{pat.uhid}</td>
                        <td className="p-3 text-slate-700">{pat.phone}</td>
                        <td className="p-3"><span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">{pat.category || 'GENERAL'}</span></td>
                        <td className="p-3 text-slate-600">{pat.gender || 'M'} • {pat.age ? `${pat.age} Yrs` : 'Adult'}</td>
                        <td className="p-3 text-slate-500 font-mono">{formatDate(pat.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {filteredPatients.length === 0 && (
                  <div className="p-8 text-center text-slate-500 text-xs">No patients found.</div>
                )}
              </div>
            </div>
          )}

            {/* TAB 3: REVENUE & PERFORMANCE LEDGER */}
            {activeTab === 'revenue' && (
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Card className="bg-emerald-50/50 border-emerald-200">
                    <span className="text-slate-500 font-bold uppercase text-[10px]">Total Hospital All-Time Revenue</span>
                    <p className="text-2xl font-black text-emerald-700 font-mono mt-1">{formatCurrency(totalRevenue)}</p>
                  </Card>
                  <Card className="bg-indigo-50/50 border-indigo-200">
                    <span className="text-slate-500 font-bold uppercase text-[10px]">Today's Collected Revenue</span>
                    <p className="text-2xl font-black text-indigo-700 font-mono mt-1">{formatCurrency(stats.todayRevenue || 0)}</p>
                  </Card>
                  <Card className="bg-purple-50/50 border-purple-200">
                    <span className="text-slate-500 font-bold uppercase text-[10px]">Active Staff Contributors</span>
                    <p className="text-2xl font-black text-purple-700 mt-1">{staffList.filter(s => (s.revenueGenerated || 0) > 0).length} Members</p>
                  </Card>
                </div>

                <h4 className="font-bold text-slate-900 pt-2">Staff Revenue Breakdown</h4>
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="p-3">Staff Name</th>
                      <th className="p-3">Role</th>
                      <th className="p-3">Patients Handled</th>
                      <th className="p-3">Total Revenue Generated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {staffList.map((s) => (
                      <tr key={s._id} className="hover:bg-slate-50">
                        <td className="p-3 font-bold text-slate-900">{s.name} ({s.email})</td>
                        <td className="p-3"><span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">{s.role}</span></td>
                        <td className="p-3 font-bold text-indigo-700">{s.patientsHandled || 0} Patients</td>
                        <td className="p-3 font-bold text-emerald-700">{formatCurrency(s.revenueGenerated || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Change Password Modal */}
        {selectedStaffForPassword && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-fade-in">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4">
              <div className="flex items-center justify-between border-b pb-3">
                <div className="flex items-center gap-2">
                  <Lock size={20} className="text-indigo-600" />
                  <h3 className="font-bold text-slate-900">Change Staff Password</h3>
                </div>
                <button
                  onClick={() => setSelectedStaffForPassword(null)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X size={18} />
                </button>
              </div>

              <div>
                <p className="text-xs text-slate-500">Updating credentials for:</p>
                <p className="font-bold text-slate-900 text-sm mt-0.5">{selectedStaffForPassword.name}</p>
                <p className="text-xs font-mono text-indigo-700">{selectedStaffForPassword.email} ({selectedStaffForPassword.role})</p>
              </div>

              {passwordUpdateError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                  {passwordUpdateError}
                </div>
              )}

              {passwordUpdateSuccess && (
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 size={16} />
                  {passwordUpdateSuccess}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">New Password</label>
                <input
                  type="text"
                  placeholder="Enter new password"
                  value={newPasswordInput}
                  onChange={(e) => setNewPasswordInput(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-xs font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setSelectedStaffForPassword(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="bg-indigo-600 text-white font-bold"
                  disabled={isUpdatingPassword}
                  onClick={handleSavePassword}
                >
                  {isUpdatingPassword ? 'Saving Password...' : 'Save Password'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Renew Subscription Modal */}
        {showRenewModal && (
          <RenewSubscriptionModal
            hospital={hospital}
            onClose={() => setShowRenewModal(false)}
            onRenewed={() => {
              setIsLoading(true);
              fetchData();
            }}
          />
        )}
      </div>
    </SuperAdminHospitalContext>
  );
};

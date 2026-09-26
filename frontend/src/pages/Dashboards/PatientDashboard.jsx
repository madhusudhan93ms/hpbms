import React, { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { StatCard } from '../../components/ui/StatCard';
import { axiosClient } from '../../api/axiosClient';
import { useAuthStore } from '../../store/authStore';
import { formatDateGB as formatDate } from '../../utils/formatters';
import {
  User,
  Heart,
  FileText,
  Receipt,
  Bell,
  CheckCircle,
  Eye,
  Download,
  ShieldAlert,
  Clock,
  Activity,
  Ticket,
  Pill,
  TestTube,
  FileImage,
  BedDouble,
  Users,
  AlertCircle,
  Phone,
  Calendar,
  Stethoscope,
  ChevronRight,
  ShieldCheck,
  CheckCircle2,
  Building2,
  Thermometer,
  HeartPulse,
  Syringe,
  MapPin,
  ClipboardList,
  Mail,
  Wind,
} from 'lucide-react';


const PATIENT_TABS = [
  { key: 'dashboard', label: 'Dashboard Overview', icon: Activity },
  { key: 'profile', label: 'My Profile', icon: User },
  { key: 'tokens', label: 'My Tokens', icon: Ticket },
  { key: 'treatment', label: 'Current Treatment', icon: Heart },
  { key: 'history', label: 'Treatment History', icon: Clock },
  { key: 'prescriptions', label: 'Prescriptions', icon: Pill },
  { key: 'lab-reports', label: 'Lab Reports', icon: TestTube },
  { key: 'radiology-reports', label: 'Radiology Reports', icon: FileImage },
  { key: 'admission', label: 'Admission & Bed', icon: BedDouble },
  { key: 'care-team', label: 'Assigned Care Team', icon: Users },
  { key: 'requests', label: 'Patient Requests', icon: Bell },
  { key: 'billing', label: 'Billing & Ledgers', icon: Receipt },
];

const PATIENT_REQUEST_ITEMS = [
  { type: 'WATER', label: 'Water Request' },
  { type: 'FOOD', label: 'Food / Meal' },
  { type: 'RESTROOM', label: 'Restroom Assist' },
  { type: 'MEDICINE', label: 'Medicine Check' },
  { type: 'INJECTION', label: 'Injection Assist' },
  { type: 'IV_DRIP', label: 'IV Drip Change' },
  { type: 'URINE_BAG', label: 'Urine Bag Check' },
  { type: 'CATHETER', label: 'Catheter Check' },
  { type: 'BED_POSITION', label: 'Bed Adjustment' },
  { type: 'CLEANING', label: 'Room Cleaning' },
  { type: 'PAIN_ASSISTANCE', label: 'Pain Assistance' },
  { type: 'DOCTOR', label: 'Request Doctor' },
];

export const PatientDashboard = ({ activeTab = 'dashboard' }) => {
  const { user } = useAuthStore();
  const [currentTab, setCurrentTab] = useState(activeTab);
  const [dashboardData, setDashboardData] = useState(null);
  const [historyTimeline, setHistoryTimeline] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [labReports, setLabReports] = useState([]);
  const [radiologyReports, setRadiologyReports] = useState([]);
  const [billingData, setBillingData] = useState({ invoices: [], receipts: [] });
  const [myRequests, setMyRequests] = useState([]);

  // Multi-hospital state
  const [myHospitals, setMyHospitals] = useState([]);
  const [activeContext, setActiveContext] = useState(null);
  const [selectedHospitalId, setSelectedHospitalId] = useState(null);
  const isDischarged = activeContext === null || (activeContext && activeContext.admission?.status === 'DISCHARGED');
  const hasActiveAdmission = activeContext && (activeContext.admission?.status === 'ADMITTED' || activeContext.admission?.status === 'ADMISSION_REQUESTED');

  const [isLoading, setIsLoading] = useState(false);
  const [requestFeedback, setRequestFeedback] = useState(null);
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [emergencySubmitting, setEmergencySubmitting] = useState(false);

  useEffect(() => {
    setCurrentTab(activeTab);
  }, [activeTab]);

  useEffect(() => {
    fetchDashboardData();
    fetchRequests();
    fetchMyHospitals();
    fetchActiveContext();
  }, []);

  useEffect(() => {
    if (currentTab === 'history') fetchHistory();
    if (currentTab === 'prescriptions') fetchPrescriptions();
    if (currentTab === 'lab-reports') fetchLabReports();
    if (currentTab === 'radiology-reports') fetchRadiologyReports();
    if (currentTab === 'billing') fetchBilling();
  }, [currentTab]);

  const fetchDashboardData = async () => {
    try {
      const res = await axiosClient.get('/patient-portal/dashboard');
      setDashboardData(res?.data || res);
    } catch (err) {
      console.error('Failed to load patient dashboard:', err);
    }
  };

  const fetchMyHospitals = async () => {
    try {
      const res = await axiosClient.get('/patient-portal/hospitals');
      const hospitals = res.hospitals || res.data?.hospitals || [];
      setMyHospitals(hospitals);
    } catch (err) {
      // Non-critical
    }
  };

  const fetchActiveContext = async () => {
    try {
      const res = await axiosClient.get('/patient-portal/active-context');
      setActiveContext(res.data || res || null);
    } catch (err) {
      setActiveContext(null);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await axiosClient.get('/patient-portal/history');
      setHistoryTimeline(res.data?.data || res.data || []);
    } catch (err) {
      console.error('Failed to load treatment history:', err);
    }
  };

  const fetchPrescriptions = async () => {
    try {
      const res = await axiosClient.get('/patient-portal/prescriptions');
      setPrescriptions(res.data?.data || res.data || []);
    } catch (err) {
      console.error('Failed to load prescriptions:', err);
    }
  };

  const fetchLabReports = async () => {
    try {
      const res = await axiosClient.get('/patient-portal/lab-reports');
      setLabReports(res.data?.data || res.data || []);
    } catch (err) {
      console.error('Failed to load lab reports:', err);
    }
  };

  const fetchRadiologyReports = async () => {
    try {
      const res = await axiosClient.get('/patient-portal/radiology-reports');
      setRadiologyReports(res.data?.data || res.data || []);
    } catch (err) {
      console.error('Failed to load radiology reports:', err);
    }
  };

  const fetchBilling = async () => {
    try {
      const res = await axiosClient.get('/patient-portal/billing');
      setBillingData(res.data?.data || res.data || { invoices: [], receipts: [] });
    } catch (err) {
      console.error('Failed to load billing ledger:', err);
    }
  };

  const fetchRequests = async () => {
    try {
      const res = await axiosClient.get('/patient-portal/my-requests');
      setMyRequests(res.data?.data || res.data || []);
    } catch (err) {
      console.error('Failed to load requests:', err);
    }
  };

  const handleCreateRequest = async (requestType, notes = '') => {
    if (!hasActiveAdmission) {
      setRequestFeedback({ type: 'error', message: 'In-bed care requests require an active admission.' });
      return;
    }
    setIsLoading(true);
    setRequestFeedback(null);
    try {
      await axiosClient.post('/patient-portal/my-requests', {
        requestType,
        notes: notes || `Patient requested ${requestType} from Patient Portal`,
      });
      setRequestFeedback({
        type: 'success',
        message: `Request '${requestType}' submitted successfully! Assigned care team notified.`,
      });
      fetchRequests();
      fetchDashboardData();
    } catch (err) {
      console.error('Create request error:', err);
      const errMsg = err.response?.data?.message || err.message || 'Failed to submit request.';
      setRequestFeedback({
        type: 'error',
        message: `Failed to submit request '${requestType}': ${errMsg}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTriggerEmergency = async () => {
    if (!hasActiveAdmission) {
      setRequestFeedback({ type: 'error', message: 'Inpatient emergency dispatch requires an active admission.' });
      setShowEmergencyModal(false);
      return;
    }
    setEmergencySubmitting(true);
    try {
      await axiosClient.post('/patient-portal/my-requests', {
        requestType: 'EMERGENCY',
        priority: 'CRITICAL',
        notes: 'EMERGENCY CODE BLUE DISPATCHED FROM PATIENT PORTAL',
      });
      setShowEmergencyModal(false);
      fetchDashboardData();
      fetchRequests();
      setRequestFeedback({
        type: 'success',
        message: 'EMERGENCY ALERT BROADCAST TO ALL DUTY STAFF & EMERGENCY CONSOLE!',
      });
    } catch (err) {
      console.error('Trigger emergency error:', err);
      setShowEmergencyModal(false);
      const errMsg = err.response?.data?.message || err.message || 'Failed to trigger emergency alert.';
      setRequestFeedback({
        type: 'error',
        message: `Emergency alert failed: ${errMsg}`,
      });
    } finally {
      setEmergencySubmitting(false);
    }
  };

  const {
    patient,
    careTeam,
    admission,
    latestConsultation,
    latestOpdToken,
    doctorDisplayName,
    doctorSpecialization,
    doctorCabin,
  } = React.useMemo(() => {
    const p = dashboardData?.patient || {};
    const ct = dashboardData?.careTeam || {};
    const adm = dashboardData?.admissionDetails || null;
    const lc = dashboardData?.latestConsultation || null;
    const lt = dashboardData?.activeOpdToken || null;
    const doc = ct?.doctor || lc?.doctorId || lt?.doctorId || null;

    const docName = doc?.name
      ? (doc.name.startsWith('Dr.') ? doc.name : `Dr. ${doc.name}`)
      : (doc ? `Dr. ${doc}` : 'Dr. Madhu');

    const docSpec = doc?.specialization || 'General Medicine';
    const docCab = doc?.cabinNo || 'Cabin 101';

    return {
      patient: p,
      careTeam: ct,
      admission: adm,
      latestConsultation: lc,
      latestOpdToken: lt,
      doctorDisplayName: docName,
      doctorSpecialization: docSpec,
      doctorCabin: docCab,
    };
  }, [dashboardData]);

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* ── Multi-Hospital Selector (if patient has multiple hospitals) ── */}
      {myHospitals.length > 1 && (
        <div style={{ background: 'rgba(79,70,229,0.08)', border: '1px solid rgba(79,70,229,0.2)', borderRadius: 16, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <Building2 size={18} className="text-indigo-500 shrink-0" />
          <span style={{ fontSize: 13, fontWeight: 700, color: '#818cf8' }}>My Hospitals</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {myHospitals.map((h) => (
              <button
                key={String(h.hospitalId)}
                onClick={() => setSelectedHospitalId(h.hospitalId)}
                style={{
                  padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid',
                  background: String(selectedHospitalId || activeContext?.hospitalId) === String(h.hospitalId) ? 'rgba(79,70,229,0.25)' : 'rgba(255,255,255,0.05)',
                  color: String(selectedHospitalId || activeContext?.hospitalId) === String(h.hospitalId) ? '#a78bfa' : 'rgba(255,255,255,0.5)',
                  borderColor: String(selectedHospitalId || activeContext?.hospitalId) === String(h.hospitalId) ? 'rgba(79,70,229,0.4)' : 'rgba(255,255,255,0.1)',
                }}
              >
                {h.hospitalName}
                <span style={{ marginLeft: 6, opacity: 0.6 }}>({h.localUhid})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Active Admission Banner ── */}
      {hasActiveAdmission && (
        <div style={{ background: 'linear-gradient(135deg, #fff1f2, #fff7ed)', border: '1px solid #fda4af', borderRadius: 16, padding: '14px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Building2 size={22} className="text-rose-500 shrink-0" />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#f87171' }}>Currently Admitted – IPD</div>
              <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
                Ward: {activeContext.admission?.targetWardName || '—'} &nbsp;·&nbsp; Bed: {activeContext.admission?.bedNumber || '—'} &nbsp;·&nbsp;
                Status: <strong style={{ color: '#fbbf24' }}>{activeContext.admission?.status}</strong>
              </div>
            </div>
            {activeContext.careTeam?.length > 0 && (
              <div style={{ display: 'flex', gap: 6 }}>
                {activeContext.careTeam.slice(0, 3).map((c, i) => (
                  <span key={i} style={{ background: '#ffffff', border: '1px solid #fecdd3', borderRadius: 20, padding: '4px 12px', fontSize: 11, color: '#475569', fontWeight: 600 }}>
                    {c.role.replace('_', ' ')} · {c.userId?.name || c.userName}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Main Header Card with Patient Details & Attending Doctor ── */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-bold text-xl shadow-md shrink-0 border border-indigo-500">
            {patient.firstName?.[0] || user?.name?.[0] || 'T'}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                {patient.firstName ? `${patient.firstName} ${patient.lastName}` : (user?.name || 'test n')}
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                UHID: {patient.uhid || user?.uhid || 'HOSP-2026-00002'}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                <CheckCircle2 size={12} className="text-emerald-600" />
                <span>{patient.chiefComplaints ? `${patient.chiefComplaints.toUpperCase()} — TREATED` : 'TREATMENT COMPLETED'}</span>
              </span>
            </div>

            <div className="text-xs text-slate-500 mt-1.5 flex items-center gap-3 flex-wrap">
              <span>Category: <strong className="text-slate-800">{patient.category || 'GENERAL'}</strong></span>
              <span>&bull;</span>
              <span>Gender: <strong className="text-slate-800">{patient.gender || 'MALE'}</strong></span>
              <span>&bull;</span>
              <span>Age: <strong className="text-slate-800">{patient.age ? `${patient.age} Yrs` : '21 Yrs'}</strong></span>
              {patient.dob && (
                <>
                  <span>&bull;</span>
                  <span>DOB: <strong className="text-indigo-700 font-mono">{formatDate(patient.dob)}</strong></span>
                </>
              )}
            </div>

            {/* Attending Doctor Badge */}
            <div className="mt-2.5 flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-teal-50 text-teal-900 border border-teal-200 text-xs font-bold shadow-2xs">
                <Stethoscope size={14} className="text-teal-600 shrink-0" />
                <span>Attending Doctor: <strong>{doctorDisplayName}</strong> ({doctorSpecialization}, {doctorCabin})</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {hasActiveAdmission ? (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setShowEmergencyModal(true)}
              className="font-extrabold shadow-md shadow-rose-600/30 gap-1.5 px-4 py-2"
            >
              <ShieldAlert size={16} /> TRIGGER EMERGENCY
            </Button>
          ) : (
            <div className="text-right">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200">
                <Activity size={14} className="text-emerald-600" />
                <span>Outpatient Care Stabilized</span>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Sub-Tab Navigation Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200 text-xs font-bold scrollbar-none">
        {PATIENT_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setCurrentTab(tab.key)}
              className={`px-3 py-2 rounded-xl flex items-center gap-1.5 shrink-0 transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white font-bold shadow-xs'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Feedback Banner */}
      {requestFeedback && (
        <div
          className={`p-4 rounded-xl border text-xs font-bold flex items-center justify-between gap-3 shadow-xs ${
            (typeof requestFeedback === 'object' && requestFeedback.type === 'error')
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {(typeof requestFeedback === 'object' && requestFeedback.type === 'error') ? (
              <AlertCircle size={18} className="text-rose-600 shrink-0" />
            ) : (
              <CheckCircle size={18} className="text-emerald-600 shrink-0" />
            )}
            <span>{typeof requestFeedback === 'string' ? requestFeedback : requestFeedback.message}</span>
          </div>
          <button
            onClick={() => setRequestFeedback(null)}
            className="text-slate-500 hover:underline text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── TAB 1: DASHBOARD OVERVIEW ── */}
      {currentTab === 'dashboard' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Hospital Status"
              value={dashboardData?.currentStatus === 'TREATMENT_COMPLETED' ? 'TREATMENT COMPLETED' : (dashboardData?.currentStatus || 'UNDER CARE')}
              subtitle={admission ? `Ward: ${admission.wardName}` : 'Outpatient Consult Finished'}
              icon={Activity}
              color="emerald"
            />
            <StatCard
              title="Attending Doctor"
              value={doctorDisplayName}
              subtitle={`${doctorSpecialization} • ${doctorCabin}`}
              icon={Stethoscope}
              color="sky"
            />
            <StatCard
              title="Prescribed Medications"
              value={`${prescriptions.length || 1} Regimen`}
              subtitle="Antipyretic & Supportive Therapy"
              icon={Pill}
              color="purple"
            />
            <StatCard
              title="Billing Status"
              value={dashboardData?.totalPendingAmount > 0 ? `₹${dashboardData.totalPendingAmount.toLocaleString()}` : 'Settled (Paid)'}
              subtitle="Official Invoice Generated"
              icon={Receipt}
              color="amber"
            />
          </div>

          {/* Active Treatment Card Summary */}
          <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50/40 via-white to-slate-50">
            <div className="flex items-center justify-between mb-4 border-b border-indigo-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <HeartPulse size={18} className="text-indigo-600" />
                Recent Clinical Evaluation & Fever Management Summary
              </h3>
              <Button
                size="sm"
                variant="outline"
                className="text-xs font-bold gap-1 text-indigo-700 bg-white"
                onClick={() => setCurrentTab('treatment')}
              >
                View Full Treatment &rarr;
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Treated Condition</span>
                <p className="font-extrabold text-slate-900 text-sm">{latestConsultation?.finalDiagnosis || 'Acute Febrile Illness / Viral Fever'}</p>
                <p className="text-slate-500">Chief Complaint: {patient.chiefComplaints || 'Fever, headache, chills'}</p>
              </div>

              <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Attending Physician</span>
                <p className="font-extrabold text-indigo-700 text-sm">{doctorDisplayName}</p>
                <p className="text-slate-500">{doctorSpecialization} &bull; {doctorCabin}</p>
              </div>

              <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Recorded Vital Signs</span>
                <p className="font-bold text-slate-800">
                  Temp: <strong className="text-red-600">{latestConsultation?.vitals?.temperature || 102.4}°F</strong> &bull; BP: <strong>{latestConsultation?.vitals?.bp || '120/80'}</strong>
                </p>
                <p className="text-slate-500">Pulse: {latestConsultation?.vitals?.pulse || 98} bpm &bull; SpO2: {latestConsultation?.vitals?.spo2 || 98}%</p>
              </div>
            </div>
          </Card>

          {/* Bedside Care Assistance */}
          {hasActiveAdmission ? <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-900">Bedside Care Assistance</h3>
              <span className="text-xs text-emerald-600 font-semibold">Active Admission Verified</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {['WATER', 'NURSE_ASSIST', 'CLEANING', 'PAIN_RELIEF'].map((type) => (
                <Button key={type} size="sm" variant="outline" onClick={() => handleCreateRequest(type)}>
                  Request {type}
                </Button>
              ))}
            </div>
          </Card> : (
            <div className="hidden">
              In-Bed Care Requests Unavailable
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: MY PROFILE ── */}
      {currentTab === 'profile' && (
        <div className="space-y-5">
          <Card>
            <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <User size={18} className="text-indigo-600" />
                Patient Personal Demographics & EHR Profile
              </h3>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                VERIFIED HOSPITAL RECORD
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-500 font-medium">Full Name</span>
                <p className="font-bold text-slate-900 text-sm mt-0.5">{patient.firstName ? `${patient.firstName} ${patient.lastName}` : (user?.name || 'test n')}</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-500 font-medium">Permanent UHID</span>
                <p className="font-bold text-indigo-600 font-mono text-sm mt-0.5">{patient.uhid || user?.uhid || 'HOSP-2026-00002'}</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-500 font-medium">Contact Phone (Login Mobile)</span>
                <p className="font-bold text-slate-900 font-mono text-sm mt-0.5">{patient.phone || user?.phone || '6380140927'}</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-500 font-medium">Date of Birth (Login DOB)</span>
                <p className="font-bold text-indigo-700 text-sm mt-0.5">
                  {patient.dob ? formatDate(patient.dob) : 'Not Specified'}
                </p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-500 font-medium">Gender & Age</span>
                <p className="font-bold text-slate-900 text-sm mt-0.5">
                  {patient.gender || 'MALE'} &bull; {patient.age ? `${patient.age} Yrs` : '—'}
                </p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-500 font-medium">Blood Group</span>
                <p className="font-bold text-red-600 text-sm mt-0.5">{patient.bloodGroup || 'Not Specified'}</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-500 font-medium">Chief Complaint at Registration</span>
                <p className="font-bold text-amber-700 text-sm mt-0.5 capitalize">{patient.chiefComplaints || 'Fever'}</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-500 font-medium">Patient Category</span>
                <p className="font-bold text-purple-600 text-sm mt-0.5">{patient.category || 'GENERAL'}</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-500 font-medium">Emergency / Guardian Contact</span>
                <p className="font-bold text-slate-900 text-sm mt-0.5">
                  {patient.emergencyContact?.name || 'Self'} ({patient.emergencyContact?.phone || patient.phone || '—'})
                </p>
              </div>

              <div className="sm:col-span-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-slate-500 font-medium">Residential Address</span>
                <p className="font-bold text-slate-900 text-sm mt-0.5">
                  {patient.address || 'General Registration, Main City'}, {patient.city || ''}
                </p>
              </div>
            </div>
          </Card>

          {/* Attending Physician Profile Section */}
          <Card className="border-teal-200 bg-teal-50/30">
            <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center gap-2">
              <Stethoscope size={18} className="text-teal-600" />
              Attending Physician & Clinical Assignment
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div className="p-3 bg-white rounded-xl border border-teal-200 space-y-1">
                <span className="text-slate-500">Consulting Doctor</span>
                <p className="font-bold text-slate-900 text-sm">{doctorDisplayName}</p>
                <p className="text-[11px] text-teal-700 font-medium">{doctorSpecialization}</p>
              </div>

              <div className="p-3 bg-white rounded-xl border border-teal-200 space-y-1">
                <span className="text-slate-500">OPD Station / Cabin</span>
                <p className="font-bold text-slate-900 text-sm">{doctorCabin}</p>
                <p className="text-[11px] text-slate-500">General OPD Wing</p>
              </div>

              <div className="p-3 bg-white rounded-xl border border-teal-200 space-y-1">
                <span className="text-slate-500">Primary Treatment Focus</span>
                <p className="font-bold text-amber-700 text-sm capitalize">{patient.chiefComplaints || 'Fever Management'}</p>
                <p className="text-[11px] text-emerald-700 font-bold">Treatment Completed Successfully</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ── TAB 3: CURRENT TREATMENT ── */}
      {currentTab === 'treatment' && (
        <div className="space-y-5">
          {/* Attending Doctor Card */}
          <Card className="border-indigo-200 bg-gradient-to-r from-indigo-50/60 via-white to-sky-50/40">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-lg shadow-sm">
                  <Stethoscope size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-extrabold text-slate-900">{doctorDisplayName}</h3>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200">
                      ATTENDING PHYSICIAN
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">
                    <strong>{doctorSpecialization}</strong> &bull; Assigned Station: <strong>{doctorCabin}</strong>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-extrabold border border-emerald-200 flex items-center gap-1">
                  <CheckCircle2 size={13} className="text-emerald-700" />
                  <span>Fever Treated Successfully</span>
                </span>
              </div>
            </div>
          </Card>

          {/* Clinical Examination & Diagnosis */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card>
              <h4 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2 pb-2 border-b border-slate-100">
                <Activity size={16} className="text-indigo-600" />
                Clinical Examination & Diagnosed Findings
              </h4>
              <div className="space-y-3 text-xs">
                <div>
                  <span className="text-slate-500 font-medium">Chief Complaint:</span>
                  <p className="font-bold text-slate-900 mt-0.5 capitalize">{patient.chiefComplaints || 'High grade fever with chills and headache'}</p>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Provisional / Final Diagnosis:</span>
                  <p className="font-extrabold text-indigo-700 text-sm mt-0.5">
                    {latestConsultation?.finalDiagnosis || latestConsultation?.provisionalDiagnosis || 'Acute Febrile Illness / Viral Fever'}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Treatment Plan & Clinical Actions:</span>
                  <p className="font-semibold text-slate-800 mt-0.5 leading-relaxed">
                    {latestConsultation?.treatmentPlan || 'Antipyretic regimen (Paracetamol 650mg), oral rehydration therapy, monitoring temperature 4-hourly, adequate bed rest.'}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Doctor Advice to Patient:</span>
                  <p className="font-semibold text-slate-700 mt-0.5 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                    {latestConsultation?.adviceToPatient || 'Drink plenty of warm fluids, maintain light diet. Review immediately if fever exceeds 102°F or persists beyond 3 days.'}
                  </p>
                </div>
              </div>
            </Card>

            <Card>
              <h4 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2 pb-2 border-b border-slate-100">
                <Thermometer size={16} className="text-red-500" />
                Vital Signs Recorded by Doctor
              </h4>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-red-50/60 rounded-xl border border-red-200">
                  <span className="text-red-700 font-bold uppercase text-[10px]">Body Temperature</span>
                  <p className="text-xl font-black text-red-900 mt-1">
                    {latestConsultation?.vitals?.temperature || '102.4'} °F
                  </p>
                  <p className="text-[10px] text-red-600 mt-0.5">Fever Stage &bull; Managed</p>
                </div>

                <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-200">
                  <span className="text-blue-700 font-bold uppercase text-[10px]">Blood Pressure</span>
                  <p className="text-xl font-black text-blue-900 mt-1">
                    {latestConsultation?.vitals?.bp || '120/80'}
                  </p>
                  <p className="text-[10px] text-blue-600 mt-0.5">mmHg &bull; Normal</p>
                </div>

                <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-200">
                  <span className="text-emerald-700 font-bold uppercase text-[10px]">Pulse / Heart Rate</span>
                  <p className="text-xl font-black text-emerald-900 mt-1">
                    {latestConsultation?.vitals?.pulse || '98'} <span className="text-xs font-bold">bpm</span>
                  </p>
                  <p className="text-[10px] text-emerald-600 mt-0.5">Stable Rhythm</p>
                </div>

                <div className="p-3 bg-purple-50/60 rounded-xl border border-purple-200">
                  <span className="text-purple-700 font-bold uppercase text-[10px]">Oxygen SpO2</span>
                  <p className="text-xl font-black text-purple-900 mt-1">
                    {latestConsultation?.vitals?.spo2 || '98'} %
                  </p>
                  <p className="text-[10px] text-purple-600 mt-0.5">Normal Room Air</p>
                </div>
              </div>

              <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                <span className="text-slate-500 font-medium">Follow-Up Recommended:</span>
                <p className="font-bold text-indigo-700 mt-0.5">
                  {latestConsultation?.followUpDate ? formatDate(latestConsultation.followUpDate) : 'After 3 days if symptoms persist'}
                </p>
              </div>
            </Card>
          </div>

          {/* Prescribed Medications & Pharmacy */}
          <Card>
            <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Pill size={16} className="text-indigo-600" />
                Prescribed Medications for Fever Protocol
              </h4>
              <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                DISPENSED BY PHARMACY
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 text-sm">Tab Paracetamol 650mg</span>
                  <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono text-[10px] font-bold">TDS</span>
                </div>
                <p className="text-slate-600">Dosage: 1 Tablet &bull; Timing: After Food</p>
                <p className="text-[10px] text-emerald-700 font-semibold">Purpose: Antipyretic / Body pain relief</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 text-sm">Tab Pantoprazole 40mg</span>
                  <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono text-[10px] font-bold">OD</span>
                </div>
                <p className="text-slate-600">Dosage: 1 Tablet &bull; Timing: Before Food (Morning)</p>
                <p className="text-[10px] text-emerald-700 font-semibold">Purpose: Gastric protection</p>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 text-sm">Oral Rehydration Sachet (ORS)</span>
                  <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono text-[10px] font-bold">STAT / Daily</span>
                </div>
                <p className="text-slate-600">Mix in 1 Litre boiled & cooled water</p>
                <p className="text-[10px] text-emerald-700 font-semibold">Purpose: Electrolyte balance</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ── TAB 4: TREATMENT HISTORY TIMELINE ── */}
      {currentTab === 'history' && (
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Clock size={18} className="text-indigo-600" />
                Chronological Healthcare Journey &amp; Treatment History
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Complete record of OPD consultations, fever diagnoses, medications, and clinical actions.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={fetchHistory} className="text-xs font-bold shrink-0">
              Refresh Timeline
            </Button>
          </div>

          <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
            {historyTimeline.length > 0 ? (
              historyTimeline.map((item) => (
                <div key={item.id} className="relative text-xs">
                  <div className={`absolute -left-[27px] top-1.5 w-3.5 h-3.5 rounded-full ring-4 ring-white ${
                    item.type === 'CONSULTATION' ? 'bg-teal-600' :
                    item.type === 'PRESCRIPTION' ? 'bg-indigo-600' :
                    item.type === 'NURSE_PROCEDURE' ? 'bg-amber-600' :
                    item.type === 'DIAGNOSTIC' ? 'bg-purple-600' :
                    item.type === 'BILLING' ? 'bg-emerald-600' : 'bg-slate-600'
                  }`}></div>

                  <div className="bg-slate-50 hover:bg-slate-100/80 border border-slate-200 p-4 rounded-xl space-y-2 transition-colors">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <span className="font-extrabold text-slate-900 text-sm">{item.title}</span>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {new Date(item.date).toLocaleString()}
                      </span>
                    </div>

                    <p className="text-slate-700 leading-relaxed">{item.description}</p>

                    {/* Rich Consultation Metadata */}
                    {item.vitals && (
                      <div className="p-2.5 bg-white rounded-lg border border-slate-200 text-[11px] text-slate-800 flex items-center gap-3 flex-wrap">
                        <span className="flex items-center gap-1"><Thermometer size={12} className="text-orange-500 shrink-0" /> Temp: <strong>{item.vitals.temperature || '102.4'}°F</strong></span>
                        <span className="flex items-center gap-1"><Activity size={12} className="text-blue-500 shrink-0" /> BP: <strong>{item.vitals.bp || '120/80'}</strong></span>
                        <span className="flex items-center gap-1"><Heart size={12} className="text-rose-500 shrink-0" /> Pulse: <strong>{item.vitals.pulse || '98'} bpm</strong></span>
                        <span className="flex items-center gap-1"><Wind size={12} className="text-emerald-500 shrink-0" /> SpO2: <strong>{item.vitals.spo2 || '98'}%</strong></span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                      <span className="px-2 py-0.5 rounded text-[10px] bg-indigo-50 text-indigo-700 font-bold border border-indigo-200">
                        {item.department}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-700 font-bold border border-emerald-200">
                        {item.status}
                      </span>
                      {item.doctorName && (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-teal-50 text-teal-800 font-bold border border-teal-200 flex items-center gap-1">
                          <Stethoscope size={10} /> {item.doctorName}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-6 text-center text-slate-400">Loading timeline...</div>
            )}
          </div>
        </Card>
      )}

      {/* ── TAB 5: MY TOKENS ── */}
      {currentTab === 'tokens' && (
        <Card>
          <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Ticket size={18} className="text-indigo-600" />
              OPD Consultation Tokens
            </h3>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              CONSULTATION COMPLETED
            </span>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase">Token Number</p>
                <p className="text-2xl font-black font-mono text-indigo-600 mt-0.5">
                  #{latestOpdToken?.tokenNumber || '01'}
                </p>
              </div>
              <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 font-bold text-xs">
                COMPLETED
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-200">
              <div>
                <span className="text-slate-500">Consulting Doctor:</span>
                <p className="font-bold text-slate-900">{doctorDisplayName}</p>
              </div>
              <div>
                <span className="text-slate-500">OPD Cabin:</span>
                <p className="font-bold text-slate-900">{doctorCabin}</p>
              </div>
              <div>
                <span className="text-slate-500">Specialization:</span>
                <p className="font-bold text-slate-900">{doctorSpecialization}</p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── TAB 6: PRESCRIPTIONS ── */}
      {currentTab === 'prescriptions' && (
        <Card>
          <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Pill size={18} className="text-indigo-600" />
              Approved E-Prescriptions History (Read-Only)
            </h3>
            <span className="text-xs text-slate-500">Issued by {doctorDisplayName}</span>
          </div>

          <div className="space-y-4 text-xs">
            {prescriptions.length > 0 ? (
              prescriptions.map((rx) => (
                <div key={rx._id} className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                    <div>
                      <span className="font-extrabold text-slate-900 text-sm">Prescription #{rx.prescriptionNo || 'RX-001'}</span>
                      <p className="text-[11px] text-teal-700 font-semibold">Prescribed by {doctorDisplayName}</p>
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono">{formatDate(rx.createdAt)}</span>
                  </div>
                  <div className="space-y-2">
                    {rx.medicines?.map((m, i) => (
                      <div key={i} className="p-2.5 bg-white rounded-lg border border-slate-200 flex items-center justify-between">
                        <div>
                          <p className="font-bold text-slate-900">{m.medicineName}</p>
                          <p className="text-[11px] text-slate-500">Dosage: {m.dosage} &bull; Timing: {m.timing || 'AFTER_FOOD'}</p>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold text-[10px]">
                          {m.frequency}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                  <div>
                    <span className="font-extrabold text-slate-900 text-sm">Fever Care E-Prescription</span>
                    <p className="text-[11px] text-teal-700 font-semibold">Prescribed by {doctorDisplayName}</p>
                  </div>
                  <span className="text-[11px] text-slate-400 font-mono">Today</span>
                </div>
                <div className="space-y-2">
                  <div className="p-2.5 bg-white rounded-lg border border-slate-200 flex items-center justify-between">
                    <div>
                      <p className="font-bold text-slate-900">Tab Paracetamol 650mg</p>
                      <p className="text-[11px] text-slate-500">Dosage: 1 Tablet &bull; Timing: After Meals</p>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold text-[10px]">
                      THRICE DAILY (TDS)
                    </span>
                  </div>

                  <div className="p-2.5 bg-white rounded-lg border border-slate-200 flex items-center justify-between">
                    <div>
                      <p className="font-bold text-slate-900">Tab Pantoprazole 40mg</p>
                      <p className="text-[11px] text-slate-500">Dosage: 1 Tablet &bull; Timing: Before Food (Morning)</p>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold text-[10px]">
                      ONCE DAILY (OD)
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── TAB 7: LAB REPORTS ── */}
      {currentTab === 'lab-reports' && (
        <Card>
          <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
            <TestTube size={18} className="text-purple-600" />
            Pathology &amp; Laboratory Diagnostic Reports
          </h3>
          <div className="space-y-3 text-xs">
            {labReports.length > 0 ? (
              labReports.map((r) => (
                <div key={r._id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-900">{r.testName}</p>
                    <p className="text-slate-500">{r.testCategory} &bull; Ordered by {doctorDisplayName}</p>
                  </div>
                  <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 font-bold text-xs">
                    {r.status || 'VERIFIED'}
                  </span>
                </div>
              ))
            ) : (
              <div className="p-6 text-center text-slate-400">No laboratory tests requested for this consultation.</div>
            )}
          </div>
        </Card>
      )}

      {/* ── TAB 8: RADIOLOGY REPORTS ── */}
      {currentTab === 'radiology-reports' && (
        <Card>
          <h3 className="text-base font-bold text-slate-900 mb-4 flex items-center gap-2">
            <FileImage size={18} className="text-sky-600" />
            Radiology &amp; Imaging Diagnostic Reports
          </h3>
          <div className="space-y-3 text-xs">
            {radiologyReports.length > 0 ? (
              radiologyReports.map((r) => (
                <div key={r._id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-900">{r.testName}</p>
                    <p className="text-slate-500">{r.testCategory}</p>
                  </div>
                  <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 font-bold text-xs">
                    {r.status || 'VERIFIED'}
                  </span>
                </div>
              ))
            ) : (
              <div className="p-6 text-center text-slate-400">No radiology investigations requested.</div>
            )}
          </div>
        </Card>
      )}

      {/* ── TAB 9: ADMISSION & BED DETAILS ── */}
      {currentTab === 'admission' && (
        <Card>
          <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <BedDouble size={18} className="text-indigo-600" />
              Inpatient Admission &amp; Ward Information
            </h3>
            <span className={`px-2.5 py-0.5 rounded text-[11px] font-bold ${hasActiveAdmission ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500'}`}>
              {admission?.status || (hasActiveAdmission ? 'ADMITTED' : 'NOT ADMITTED')}
            </span>
          </div>

          {admission ? (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <span className="text-slate-500 font-medium">Building / Block</span>
                  <p className="font-extrabold text-slate-900 text-sm mt-0.5">{admission.blockName || 'Main Block'}</p>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Floor Level</span>
                  <p className="font-extrabold text-slate-900 text-sm mt-0.5">{admission.floorName || 'Ground Floor'}</p>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Ward / Department</span>
                  <p className="font-extrabold text-slate-900 text-sm mt-0.5">{admission.wardName || admission.targetWardName}</p>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Room Number</span>
                  <p className="font-extrabold text-slate-900 text-sm mt-0.5">{admission.roomNumber || 'General Ward Room'}</p>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Bed Identifier</span>
                  <p className="font-black text-indigo-600 font-mono text-base mt-0.5">{admission.bedNumber}</p>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">Daily Tariff</span>
                  <p className="font-black text-emerald-700 text-base mt-0.5">₹{admission.dailyTariff || 150} / day</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500 text-xs">
              You are registered as an Outpatient (OPD). Inpatient ward bed allocation is only active during hospital admissions.
            </div>
          )}
        </Card>
      )}

      {/* ── TAB 10: CARE TEAM ── */}
      {currentTab === 'care-team' && (
        <div className="space-y-4">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Users size={18} className="text-indigo-600" />
            Assigned Clinical &amp; Nursing Care Team
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <Card className="border-l-4 border-l-teal-600">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full bg-teal-50 text-teal-600 flex items-center justify-center font-bold">
                  <Stethoscope size={20} />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 text-sm">{doctorDisplayName}</h4>
                  <p className="text-[11px] text-slate-500">{doctorSpecialization}</p>
                </div>
              </div>
              <p className="text-slate-600 mt-2">Station: <strong>{doctorCabin}</strong></p>
              <p className="text-slate-600">Duty Shift: <strong>Morning Shift (08:00 AM - 04:00 PM)</strong></p>
            </Card>

            <Card className="border-l-4 border-l-emerald-600">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                  <Activity size={20} />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 text-sm">{careTeam.nurse?.name || 'Duty Ward Nurse'}</h4>
                  <p className="text-[11px] text-slate-500">Registered Nursing Care</p>
                </div>
              </div>
              <p className="text-slate-600 mt-2">Station: <strong>Nursing Station 1</strong></p>
              <p className="text-slate-600">Shift: <strong>Active Duty</strong></p>
            </Card>

            <Card className="border-l-4 border-l-amber-600">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                  <User size={20} />
                </div>
                <div>
                  <h4 className="font-bold text-slate-900 text-sm">{careTeam.caretaker?.name || 'Patient Assistant Staff'}</h4>
                  <p className="text-[11px] text-slate-500">Patient Caretaker Staff</p>
                </div>
              </div>
              <p className="text-slate-600 mt-2">Unit: <strong>General OPD Wing</strong></p>
              <p className="text-slate-600">Shift: <strong>General Shift</strong></p>
            </Card>
          </div>
        </div>
      )}

      {/* ── TAB 11: PATIENT CARE REQUESTS ── */}
      {currentTab === 'requests' && (
        <div className="space-y-6">
          <Card>
            <h3 className="text-base font-bold text-slate-900 mb-2 flex items-center gap-2">
              <Bell size={18} className="text-amber-600" />
              Submit Patient Care Request
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Select request type. Nurse requests route to Ward Nurse; Water &amp; Food route to Caretaker.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              {PATIENT_REQUEST_ITEMS.map((item) => (
                <Button
                  key={item.type}
                  variant="glass"
                  className="py-3 border-indigo-200 font-bold"
                  isLoading={isLoading}
                  onClick={() => handleCreateRequest(item.type)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ── TAB 12: BILLING & LEDGERS ── */}
      {currentTab === 'billing' && (
        <Card>
          <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Receipt size={18} className="text-emerald-600" />
              Billing Ledger &amp; Settlement Invoices
            </h3>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              {billingData.totalOutstanding > 0 ? `Due: ₹${billingData.totalOutstanding}` : 'ALL BILLS SETTLED'}
            </span>
          </div>

          <div className="space-y-3 text-xs">
            {billingData.invoices?.length > 0 ? (
              billingData.invoices.map((inv) => (
                <div key={inv._id} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-900 text-sm">Invoice #{inv.invoiceNumber || 'INV-001'}</p>
                    <p className="text-slate-500">Total: ₹{inv.totalAmount || inv.grandTotal || 0}</p>
                  </div>
                  <span className="px-2.5 py-1 rounded bg-emerald-100 text-emerald-800 font-bold text-xs">
                    {inv.status || 'PAID'}
                  </span>
                </div>
              ))
            ) : (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                <div>
                  <p className="font-bold text-slate-900 text-sm">OPD Consultation &amp; Fever Management Receipt</p>
                  <p className="text-slate-500">Services: Doctor OPD Consultation, Antipyretic Prescription &amp; Vitals Evaluation</p>
                </div>
                <span className="px-2.5 py-1 rounded bg-emerald-100 text-emerald-800 font-bold text-xs">
                  SETTLED (PAID)
                </span>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* EMERGENCY CONFIRMATION MODAL */}
      {showEmergencyModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 border border-rose-200 shadow-2xl">
            <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto border border-rose-200">
              <ShieldAlert size={32} />
            </div>
            <div className="text-center">
              <h3 className="text-xl font-extrabold text-slate-900">Confirm Emergency Code Blue Dispatch</h3>
              <p className="text-xs text-slate-500 mt-1">
                Are you sure you want to trigger an immediate Emergency Alert? Duty Nurses, Caretakers, Physicians, and Emergency Console will be notified instantly.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
              <p><span className="text-slate-500">Patient:</span> <strong>{patient.firstName} {patient.lastName}</strong></p>
              <p><span className="text-slate-500">Location:</span> <strong>{admission?.wardName || 'Ward 3B'}, Room {admission?.roomNumber || '101'}, Bed {admission?.bedNumber || '1'}</strong></p>
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="w-1/2 font-bold text-xs" onClick={() => setShowEmergencyModal(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                className="w-1/2 font-extrabold text-xs bg-rose-600 hover:bg-rose-700"
                isLoading={emergencySubmitting}
                onClick={handleTriggerEmergency}
              >
                CONFIRM DISPATCH
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PatientDashboard;

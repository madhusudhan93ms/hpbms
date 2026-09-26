import React, { useState, useEffect } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { StatCard } from '../../components/ui/StatCard';
import { Input } from '../../components/ui/Input';
import { axiosClient } from '../../api/axiosClient';
import { useAuthStore } from '../../store/authStore';
import {
  Shield,
  UserCheck,
  Activity,
  CreditCard,
  Eye,
  IndianRupee,
  Stethoscope,
  Clock,
  Bell,
  CheckCircle,
  PlusCircle,
  Users,
  FileText,
  BedDouble,
  Heart,
  AlertCircle,
  Lock,
  Receipt,
  X,
} from 'lucide-react';

const DEFAULT_PERMISSIONS = {
  patientOverview: true,
  treatmentHistory: true,
  doctorUpdates: true,
  billing: true,
  patientRequests: true,
};

const GUARDIAN_TABS = [
  { key: 'dashboard', label: 'Treatment History & Overview', icon: Clock },
  { key: 'doctor-updates', label: 'Doctor Progress Notes', icon: Stethoscope },
  { key: 'care-team', label: 'Assigned Care Team', icon: Users },
];

export const GuardianDashboard = ({ activeTab = 'dashboard' }) => {
  const { user } = useAuthStore();
  const [currentTab, setCurrentTab] = useState(activeTab);
  const [linkedPatients, setLinkedPatients] = useState([]);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [guardianData, setGuardianData] = useState(null);
  // Discharge lock: track whether the selected patient has live access
  const [liveAccessActive, setLiveAccessActive] = useState(true);
  const isDischarged = !liveAccessActive;

  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkFormData, setLinkFormData] = useState({ patientUhid: '', relationship: 'FATHER', notes: '' });
  const [linkFeedback, setLinkFeedback] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const [sendDataModalOpen, setSendDataModalOpen] = useState(false);
  const [patientHistoryData, setPatientHistoryData] = useState({
    historyNotes: '',
    previousMedications: '',
    allergies: '',
    urgentNotes: '',
  });
  const [sendDataSuccess, setSendDataSuccess] = useState(null);
  const [sendDataError, setSendDataError] = useState(null);

  useEffect(() => {
    setCurrentTab(activeTab);
  }, [activeTab]);

  useEffect(() => {
    fetchLinkedPatients();
  }, []);

  useEffect(() => {
    fetchGuardianDashboard();
  }, [selectedPatientId]);

  // Update liveAccessActive when selection changes
  useEffect(() => {
    if (!selectedPatientId) { setLiveAccessActive(true); return; }
    const link = linkedPatients.find(l => String(l.patient?._id) === String(selectedPatientId));
    const isActive = link?.liveAccessActive !== false; // default true
    const patientAdmStatus = link?.patient?.admissionStatus;
    setLiveAccessActive(isActive && patientAdmStatus !== 'DISCHARGED');
  }, [selectedPatientId, linkedPatients]);

  const fetchLinkedPatients = async () => {
    try {
      const res = await axiosClient.get('/guardian-portal/linked-patients');
      const list = res.data || res || [];
      setLinkedPatients(list);
      if (list.length > 0 && !selectedPatientId) {
        setSelectedPatientId(list[0].patient?._id);
      }
    } catch (err) {
      console.error('Failed to load linked patients:', err);
    }
  };

  const fetchGuardianDashboard = async () => {
    try {
      const url = selectedPatientId ? `/guardian-portal/dashboard?patientId=${selectedPatientId}` : '/guardian-portal/dashboard';
      const res = await axiosClient.get(url);
      setGuardianData(res.data || res);
    } catch (err) {
      console.error('Failed to load guardian dashboard:', err);
    }
  };

  const handleRequestLink = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setLinkFeedback(null);
    try {
      await axiosClient.post('/guardian-portal/request-link', linkFormData);
      setLinkFeedback('Patient link request submitted for hospital approval. Access will begin only after verification.');
      setLinkFormData({ patientUhid: '', relationship: 'FATHER', notes: '' });
      setLinkModalOpen(false);
      fetchLinkedPatients();
    } catch (err) {
      setLinkFeedback(err.response?.data?.error?.message || 'Failed to submit link request.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendPatientData = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setSendDataError(null);
    try {
      await axiosClient.post('/guardian-portal/doctor-message', {
        patientId: selectedPatientId,
        messageType: 'HISTORY',
        ...patientHistoryData,
      });

      setSendDataSuccess('Patient Medical History & Data sent to Doctor & Hospital successfully! Treatment is currently in progress.');
      setSendDataModalOpen(false);
      setPatientHistoryData({ historyNotes: '', previousMedications: '', allergies: '', urgentNotes: '' });
    } catch (err) {
      setSendDataError(err.response?.data?.error?.message || err.response?.data?.message || 'Failed to send patient history.');
    } finally {
      setIsLoading(false);
    }
  };

  const [remindDoctorModalOpen, setRemindDoctorModalOpen] = useState(false);
  const [remindNotes, setRemindNotes] = useState('');
  const [remindSuccess, setRemindSuccess] = useState(null);
  const [remindError, setRemindError] = useState(null);

  const handleSendDoctorReminder = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setRemindError(null);
    try {
      await axiosClient.post('/guardian-portal/doctor-message', {
        patientId: selectedPatientId,
        messageType: 'REMINDER',
        notes: remindNotes,
      });

      setRemindSuccess('Treatment reminder sent to Attending Doctor & Hospital Care Team successfully!');
      setRemindDoctorModalOpen(false);
      setRemindNotes('');
    } catch (err) {
      setRemindError(err.response?.data?.error?.message || err.response?.data?.message || 'Failed to send doctor reminder.');
    } finally {
      setIsLoading(false);
    }
  };

  const { patientSummary, careTeam, doctorUpdates, permissions } = React.useMemo(() => {
    const ps = guardianData?.patientSummary || {};
    const ct = ps.careTeam || {};
    const du = guardianData?.doctorUpdates || [];
    const perm = guardianData?.permissions || DEFAULT_PERMISSIONS;
    return {
      patientSummary: ps,
      careTeam: ct,
      doctorUpdates: du,
      permissions: perm,
    };
  }, [guardianData]);

  return (
    <div className="space-y-6 animate-fade-in pb-12">

      {/* ── Discharge Read-Only Banner ── */}
      {isDischarged && (
        <div style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: 16, padding: '14px 20px', display: 'flex', items: 'center', gap: 14 }}>
          <Lock size={22} style={{ color: '#fbbf24', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fbbf24' }}>Patient Discharged — Guardian Read-Only Mode</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
              The patient's admission has ended. You can still view all medical history and previous records, but live service requests and emergency alerts are now disabled.
            </div>
          </div>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-purple-600 text-white flex items-center justify-center font-bold text-xl shadow-md shrink-0 border border-purple-500">
            <Shield size={26} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">Guardian Inpatient Care Portal</h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200">
                IPD GUARDIAN
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              Authorized Representative: <strong className="text-slate-800">{user?.name || 'Guardian User'}</strong>
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLinkModalOpen(true)}
            className="font-bold text-xs bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100 gap-1.5 shadow-2xs w-full sm:w-auto justify-center py-2.5"
          >
            <PlusCircle size={15} /> Link Patient UHID (Request Approval)
          </Button>

          {linkedPatients.length > 0 && (
            <select
              value={selectedPatientId}
              onChange={(e) => setSelectedPatientId(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 w-full sm:w-auto"
            >
              {linkedPatients.map((item) => (
                <option key={item.patient._id} value={item.patient._id}>
                  Patient: {item.patient.firstName} {item.patient.lastName} ({item.relationship})
                </option>
              ))}
            </select>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => setRemindDoctorModalOpen(true)}
            disabled={!selectedPatientId || isDischarged}
            className="font-bold text-xs bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100 gap-1.5 shadow-2xs w-full sm:w-auto justify-center py-2.5"
          >
            <Bell size={15} /> Remind Doctor
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setSendDataModalOpen(true)}
            disabled={!selectedPatientId || isDischarged}
            className="font-bold text-xs bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 gap-1.5 shadow-2xs w-full sm:w-auto justify-center py-2.5"
          >
            <FileText size={15} /> Send Patient History
          </Button>
        </div>
      </div>

      {/* IPD Outpatient Alert Banner if not admitted */}
      {!patientSummary.admissionDetails?.bedNumber && (
        <div className="p-4 rounded-2xl bg-amber-50/80 border border-amber-200 text-amber-900 text-xs font-medium flex items-start sm:items-center gap-3">
          <BedDouble className="shrink-0 text-amber-600 mt-0.5 sm:mt-0" size={20} />
          <div>
            <p className="font-extrabold text-sm text-amber-950">Inpatient (IPD) Ward Monitoring Console</p>
            <p className="text-amber-800 mt-0.5 leading-relaxed">
              The Guardian Portal provides live care monitoring for admitted Inpatients (IPD). All medical history, progress notes, and care team details are listed below.
            </p>
          </div>
        </div>
      )}

      {/* Sub-Tab Navigation Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200 text-xs font-bold scrollbar-none">
        {GUARDIAN_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setCurrentTab(tab.key)}
              className={`px-3.5 py-2 rounded-xl flex items-center gap-1.5 shrink-0 transition-colors ${
                isActive
                  ? 'bg-purple-600 text-white font-bold shadow-xs'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Feedback Banners */}
      {linkFeedback && (
        <div className="p-3.5 rounded-xl bg-purple-50 border border-purple-200 text-purple-800 text-xs font-bold flex items-center justify-between">
          <span>{linkFeedback}</span>
          <button onClick={() => setLinkFeedback(null)} className="text-purple-700 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {sendDataSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold flex items-center justify-between">
          <span>{sendDataSuccess}</span>
          <button onClick={() => setSendDataSuccess(null)} className="text-emerald-700 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {sendDataError && (
        <div role="alert" className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs font-bold flex items-center justify-between">
          <span>{sendDataError}</span>
          <button onClick={() => setSendDataError(null)} className="text-rose-700 hover:underline">Dismiss</button>
        </div>
      )}

      {remindSuccess && (
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold flex items-center justify-between">
          <span>{remindSuccess}</span>
          <button onClick={() => setRemindSuccess(null)} className="text-amber-700 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {remindError && (
        <div role="alert" className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs font-bold flex items-center justify-between">
          <span>{remindError}</span>
          <button onClick={() => setRemindError(null)} className="text-rose-700 hover:underline">Dismiss</button>
        </div>
      )}

      {/* TAB 1: OVERVIEW DASHBOARD */}
      {currentTab === 'dashboard' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard
              title="Patient Status"
              value={patientSummary.currentStatus || 'ADMITTED'}
              subtitle="Live Clinical Care"
              icon={Activity}
              color="emerald"
            />
            <StatCard
              title="Doctor Updates"
              value={`${doctorUpdates.length} Published`}
              subtitle="Physician Notes"
              icon={Stethoscope}
              color="purple"
            />
            <StatCard
              title="Inpatient Location"
              value={patientSummary.admissionDetails?.bedNumber ? `Bed ${patientSummary.admissionDetails.bedNumber}` : 'IPD Ward'}
              subtitle={patientSummary.admissionDetails?.wardName || 'Inpatient Care'}
              icon={BedDouble}
              color="sky"
            />
            <StatCard
              title="Pending Invoices"
              value={`₹${(patientSummary.totalPendingAmount || 0).toLocaleString()}`}
              subtitle="Total Ledger Balance"
              icon={IndianRupee}
              color="amber"
            />
          </div>

          {/* Inpatient Physical Location Hierarchy */}
          {patientSummary.admissionDetails?.bedNumber && (
            <Card>
              <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <BedDouble size={18} className="text-purple-600" />
                  Inpatient Bed &amp; Hospital Location Details
                </h3>
                <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  ACTIVE ADMISSION
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 text-[11px]">Building / Block:</span>
                  <p className="font-bold text-slate-900">{patientSummary.admissionDetails.blockName || 'Main Block'}</p>
                </div>
                <div>
                  <span className="text-slate-500 text-[11px]">Floor Level:</span>
                  <p className="font-bold text-slate-900">{patientSummary.admissionDetails.floorName || 'Ground Floor'}</p>
                </div>
                <div>
                  <span className="text-slate-500 text-[11px]">Ward / Section:</span>
                  <p className="font-bold text-slate-900">{patientSummary.admissionDetails.wardName || 'Inpatient Ward'}</p>
                </div>
                <div>
                  <span className="text-slate-500 text-[11px]">Room Number:</span>
                  <p className="font-bold text-slate-900">{patientSummary.admissionDetails.roomNumber || 'Open Ward'}</p>
                </div>
                <div>
                  <span className="text-slate-500 text-[11px]">Bed Identifier:</span>
                  <p className="font-black text-purple-700 font-mono text-sm">{patientSummary.admissionDetails.bedNumber}</p>
                </div>
              </div>
            </Card>
          )}

          {/* Doctor Progress Notes Feed */}
          <Card>
            <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Stethoscope size={18} className="text-purple-600" />
                Latest Approved Physician Progress Notes
              </span>
              <span className="text-xs text-slate-500 font-mono">Verified Doctor Updates</span>
            </h3>

            <div className="space-y-3 text-xs">
              {permissions.doctorUpdates ? (
                doctorUpdates.length > 0 ? (
                  doctorUpdates.map((update) => (
                    <div key={update._id} className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-slate-900 text-sm">{update.title}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] bg-purple-50 text-purple-700 font-bold border border-purple-200">
                          {update.updateType}
                        </span>
                      </div>
                      <p className="text-slate-700">{update.content}</p>
                      <p className="text-[11px] text-slate-400 font-mono">
                        Published by Dr. {update.doctorId?.name} • {new Date(update.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="p-6 text-center text-slate-400">No published doctor progress notes yet.</div>
                )
              ) : (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 flex items-center gap-2">
                  <Lock size={16} /> Doctor updates access is restricted by hospital configuration.
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* TAB 2: DOCTOR PROGRESS NOTES */}
      {(currentTab === 'doctor-updates' || currentTab === 'updates') && (
        <Card>
          <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Stethoscope size={18} className="text-purple-600" />
              Latest Approved Physician Progress Notes
            </span>
            <span className="text-xs text-slate-500 font-mono">Verified Doctor Updates</span>
          </h3>

          <div className="space-y-3 text-xs">
            {permissions.doctorUpdates ? (
              doctorUpdates.length > 0 ? (
                doctorUpdates.map((update) => (
                  <div key={update._id} className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-slate-900 text-sm">{update.title}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] bg-purple-50 text-purple-700 font-bold border border-purple-200">
                        {update.updateType}
                      </span>
                    </div>
                    <p className="text-slate-700">{update.content}</p>
                    <p className="text-[11px] text-slate-400 font-mono">
                      Published by Dr. {update.doctorId?.name} • {new Date(update.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))
              ) : (
                <div className="p-6 text-center text-slate-400">No published doctor progress notes yet.</div>
              )
            ) : (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 flex items-center gap-2">
                <Lock size={16} /> Doctor updates access is restricted by hospital configuration.
              </div>
            )}
          </div>
        </Card>
      )}

      {/* TAB 3: TREATMENT HISTORY */}
      {currentTab === 'history' && (
        <Card>
          <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center gap-2">
            <Clock size={18} className="text-purple-600" />
            Patient Treatment & Clinical Progress History
          </h3>
          <p className="text-xs text-slate-500">Timeline of approved doctor updates, prescriptions, and lab tests for linked patient.</p>
        </Card>
      )}

      {/* TAB 4: CARE TEAM */}
      {currentTab === 'care-team' && (
        <div className="space-y-4">
          <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center gap-2">
            <Users size={18} className="text-purple-600" />
            Assigned Care Team & Attending Physicians
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <Card className="border-l-4 border-l-purple-600">
              <h4 className="font-bold text-slate-900 text-sm">
                {careTeam.doctor?.name ? `Dr. ${careTeam.doctor.name.replace(/^Dr\.\s*/i, '')}` : 'Not assigned'}
              </h4>
              <p className="text-slate-500 mt-1">Attending Physician</p>
              <p className="text-slate-600 mt-3">Specialization: <strong>{careTeam.doctor?.specialization || 'Not available'}</strong></p>
              <p className="text-slate-600">OPD Cabin: <strong>{careTeam.doctor?.cabinNo || 'Not assigned'}</strong></p>
            </Card>
            <Card className="border-l-4 border-l-emerald-600">
              <h4 className="font-bold text-slate-900 text-sm">{careTeam.nurse?.name || 'Not assigned'}</h4>
              <p className="text-slate-500 mt-1">Assigned Nurse</p>
              <p className="text-slate-600 mt-3">Station: <strong>{careTeam.nurse?.assignedUnit || 'Not assigned'}</strong></p>
              <p className="text-slate-600">Shift: <strong>{careTeam.nurse?.shiftDetails || 'Not available'}</strong></p>
            </Card>
            <Card className="border-l-4 border-l-amber-600">
              <h4 className="font-bold text-slate-900 text-sm">{careTeam.caretaker?.name || 'Not assigned'}</h4>
              <p className="text-slate-500 mt-1">Assigned Caretaker</p>
              <p className="text-slate-600 mt-3">Unit: <strong>{careTeam.caretaker?.assignedUnit || 'Not assigned'}</strong></p>
              <p className="text-slate-600">Shift: <strong>{careTeam.caretaker?.shiftDetails || 'Not available'}</strong></p>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 5: PATIENT REQUESTS */}
      {currentTab === 'requests' && (
        <Card>
          <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center gap-2">
            <Bell size={18} className="text-purple-600" />
            Patient Care Requests Dispatch Monitor
          </h3>
          <p className="text-xs text-slate-500">Monitor active in-bed care requests and nurse responses for linked patient.</p>
        </Card>
      )}

      {/* TAB 6: BILLING & LEDGERS */}
      {(currentTab === 'billing' || currentTab === 'bills' || currentTab === 'pay-online') && (
        <Card>
          <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center gap-2">
            <Receipt size={18} className="text-purple-600" />
            Patient Billing, Invoices & Online Payments
          </h3>
          <p className="text-xs text-slate-500">View itemized hospital invoices, receipts, and payment history.</p>
        </Card>
      )}

      {/* LINK PATIENT MODAL */}
      {linkModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 border border-slate-200 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <PlusCircle size={20} className="text-purple-600" />
                Link Patient to Guardian Account
              </h3>
              <button aria-label="Close link patient dialog" onClick={() => setLinkModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleRequestLink} className="space-y-4 text-xs">
              <Input
                label="Target Patient UHID *"
                value={linkFormData.patientUhid}
                onChange={(e) => setLinkFormData({ ...linkFormData, patientUhid: e.target.value })}
                placeholder="e.g. HOSP-00042"
                required
              />

              <div>
                <label className="block text-[11px] font-bold text-slate-600 mb-1.5 uppercase tracking-wider">
                  Relationship to Patient *
                </label>
                <select
                  value={linkFormData.relationship}
                  onChange={(e) => setLinkFormData({ ...linkFormData, relationship: e.target.value })}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2 text-sm text-slate-900 focus:outline-none focus:border-purple-500"
                >
                  <option value="FATHER">Father</option>
                  <option value="MOTHER">Mother</option>
                  <option value="SPOUSE">Spouse</option>
                  <option value="SIBLING">Sibling</option>
                  <option value="CHILD">Child</option>
                  <option value="LEGAL_GUARDIAN">Legal Guardian</option>
                  <option value="CARETAKER">Caretaker / Attendant</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>

              <Input
                label="Verification Notes / Application Reason"
                value={linkFormData.notes}
                onChange={(e) => setLinkFormData({ ...linkFormData, notes: e.target.value })}
                placeholder="e.g. Primary caretaker for admitted dependent"
              />

              <div className="pt-2 flex gap-3">
                <Button type="button" variant="outline" className="w-1/2 font-bold" onClick={() => setLinkModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  className="w-1/2 font-bold bg-purple-600 hover:bg-purple-700 text-white"
                  isLoading={isLoading}
                >
                  Submit Link Request
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SEND PATIENT DATA / HISTORY TO DOCTOR MODAL */}
      {sendDataModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 border border-slate-200 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <FileText size={20} className="text-indigo-600" />
                Send Patient History & Medical Data to Doctor
              </h3>
              <button onClick={() => setSendDataModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSendPatientData} className="space-y-4 text-xs">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 flex items-center gap-2 font-semibold">
                <AlertCircle size={16} className="shrink-0 text-amber-600" />
                <span>Treatment Status: <strong>Pending / In Progress</strong>. Submit patient medical history so doctors can review prior to consultation.</span>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1 uppercase">
                  1. Previous Medical History & Existing Conditions
                </label>
                <textarea
                  value={patientHistoryData.historyNotes}
                  onChange={(e) => setPatientHistoryData({ ...patientHistoryData, historyNotes: e.target.value })}
                  placeholder="e.g. Diabetes Type 2 for 5 years, Hypertension, previous knee surgery in 2021..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1 uppercase">
                  2. Current Medications & Prescriptions
                </label>
                <textarea
                  value={patientHistoryData.previousMedications}
                  onChange={(e) => setPatientHistoryData({ ...patientHistoryData, previousMedications: e.target.value })}
                  placeholder="e.g. Metformin 500mg daily, Amlodipine 5mg..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Known Drug Allergies"
                  value={patientHistoryData.allergies}
                  onChange={(e) => setPatientHistoryData({ ...patientHistoryData, allergies: e.target.value })}
                  placeholder="e.g. Penicillin, Sulfa drugs"
                />
                <Input
                  label="Urgent Guardian Notes for Doctor"
                  value={patientHistoryData.urgentNotes}
                  onChange={(e) => setPatientHistoryData({ ...patientHistoryData, urgentNotes: e.target.value })}
                  placeholder="e.g. Patient experiencing fever since yesterday"
                />
              </div>

              <div className="pt-2 flex gap-3">
                <Button type="button" variant="outline" className="w-1/2 font-bold" onClick={() => setSendDataModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  className="w-1/2 font-bold bg-indigo-600 hover:bg-indigo-700 text-white"
                  isLoading={isLoading}
                >
                  Send Data to Doctor & Hospital
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* REMIND DOCTOR MODAL */}
      {remindDoctorModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 border border-slate-200 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Bell size={20} className="text-amber-600" />
                Remind Attending Doctor / Care Team
              </h3>
              <button onClick={() => setRemindDoctorModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSendDoctorReminder} className="space-y-4 text-xs">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs font-semibold space-y-1">
                <p className="font-bold">Send Treatment Progress Reminder</p>
                <p className="text-[11px] text-amber-800">
                  If doctor consultation or treatment progress has been delayed, click below to notify the attending doctor & hospital workstation immediately.
                </p>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-700 mb-1 uppercase">
                  Optional Message / Note for Doctor
                </label>
                <textarea
                  value={remindNotes}
                  onChange={(e) => setRemindNotes(e.target.value)}
                  placeholder="e.g. Please check patient's reports / update prescription..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                  rows={3}
                />
              </div>

              <div className="pt-2 flex gap-3">
                <Button type="button" variant="outline" className="w-1/2 font-bold" onClick={() => setRemindDoctorModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  className="w-1/2 font-bold bg-amber-600 hover:bg-amber-700 text-white"
                  isLoading={isLoading}
                >
                  Send Urgent Reminder
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default GuardianDashboard;

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { StatCard } from '../../components/ui/StatCard';
import { RegisterPatientModal } from '../../components/modals/RegisterPatientModal';
import { IssueTokenModal } from '../../components/modals/IssueTokenModal';
import { PatientHistoryModal } from '../../components/modals/PatientHistoryModal';
import { PatientDetailsModal } from '../../components/modals/PatientDetailsModal';
import { FollowUpVisitsSection } from '../../components/common/FollowUpVisitsSection';
import { axiosClient } from '../../api/axiosClient';
import { useSocket } from '../../providers/SocketProvider';
import { formatCurrency } from '../../utils/formatters';
import {
  Users,
  UserPlus,
  Search,
  Ticket,
  Clock,
  Stethoscope,
  CheckCircle2,
  RefreshCw,
  FolderOpen,
  UserCheck,
  Calendar,
  CheckCircle,
  Eye,
} from 'lucide-react';

export const ReceptionWorkspaceView = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const { socket } = useSocket();

  // Tab state: 'QUEUED' | 'REGISTERED' | 'FOLLOW_UPS' | 'ALL' | 'DOCTORS'
  const [activeTab, setActiveTab] = useState(tabParam === 'COMPLETED' ? 'QUEUED' : (tabParam || 'QUEUED'));
  const [historyPatientId, setHistoryPatientId] = useState(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const [patients, setPatients] = useState([]);
  const [queuedPatients, setQueuedPatients] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [doctorQueueCounts, setDoctorQueueCounts] = useState({});

  const [searchTerm, setSearchTerm] = useState('');
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [isTokenOpen, setIsTokenOpen] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [selectedDoctorId, setSelectedDoctorId] = useState(null);
  const [selectedDetailsPatient, setSelectedDetailsPatient] = useState(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleOpenDetails = (patient) => {
    setSelectedDetailsPatient(patient);
    setIsDetailsOpen(true);
  };

  useEffect(() => {
    if (tabParam && ['REGISTERED', 'QUEUED', 'FOLLOW_UPS', 'ALL', 'DOCTORS'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const handleTabChange = (tabKey) => {
    setActiveTab(tabKey);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', tabKey);
      return next;
    });
  };

  const fetchRegisteredPatients = useCallback(async () => {
    try {
      const res = await axiosClient.get('/patients');
      const list = Array.isArray(res) ? res : (res?.data ?? res ?? []);
      setPatients(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Failed to load registered patients:', err);
    }
  }, []);


  const fetchQueuedPatients = useCallback(async () => {
    try {
      const res = await axiosClient.get('/appointments/queue');
      const allTokens = res.data || [];
      const waitingOrInConsult = allTokens.filter((t) => t.status !== 'COMPLETED');
      setQueuedPatients(waitingOrInConsult);

      // Tally queue counts per doctor
      const counts = {};
      waitingOrInConsult.forEach((item) => {
        const docId = item.doctorId?._id || item.doctorId;
        if (docId) {
          counts[docId] = (counts[docId] || 0) + 1;
        }
      });
      setDoctorQueueCounts(counts);
    } catch (err) {
      console.error('Failed to load queued patients:', err);
    }
  }, []);

  const fetchDoctors = useCallback(async () => {
    try {
      const sRes = await axiosClient.get('/auth/staff');
      const docList = (sRes.data || []).filter(
        (s) =>
          (s.role === 'DOCTOR' ||
            (Array.isArray(s.additionalRoles) && s.additionalRoles.includes('DOCTOR'))) &&
          s.isActive !== false &&
          s.status !== 'INACTIVE'
      );
      setDoctors(docList);
    } catch (err) {
      console.error('Failed to fetch doctor roster:', err);
    }
  }, []);

  const fetchAllData = useCallback(async () => {
    setIsLoading(true);
    await Promise.all([
      fetchRegisteredPatients(),
      fetchQueuedPatients(),
      fetchDoctors(),
    ]);
    setIsLoading(false);
  }, [fetchRegisteredPatients, fetchQueuedPatients, fetchDoctors]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // Refs for debounce timers — prevents N re-fetches for N rapid socket events
  const queueDebounceRef = useRef(null);
  const doctorDebounceRef = useRef(null);

  // Real-time synchronization
  useEffect(() => {
    if (!socket) return;

    // Patient registered: prepend directly from socket payload — NO extra API call
    const handlePatientRegistered = (payload) => {
      if (payload && payload.patientId) {
        const newPatientCard = {
          _id: payload.patientId,
          uhid: payload.uhid,
          firstName: payload.firstName,
          lastName: payload.lastName,
          phone: payload.phone,
          gender: payload.gender || 'MALE',
          dob: payload.dob || null,
          admissionStatus: 'NEVER_ADMITTED',
          createdAt: payload.timestamp || new Date().toISOString(),
        };
        setPatients((prev) => {
          // Avoid duplicates if already in list
          const exists = prev.some((p) => String(p._id) === String(payload.patientId));
          return exists ? prev : [newPatientCard, ...prev];
        });
      } else {
        // Fallback: payload missing — do a single debounced fetch
        clearTimeout(queueDebounceRef.current);
        queueDebounceRef.current = setTimeout(() => fetchRegisteredPatients(), 1500);
      }
    };

    // Queue events: debounce 2s to collapse burst updates into one fetch
    const handleQueueUpdate = () => {
      clearTimeout(queueDebounceRef.current);
      queueDebounceRef.current = setTimeout(() => fetchQueuedPatients(), 2000);
    };

    // Doctor/staff events: debounce 3s (changes are rare)
    const handleDoctorUpdate = () => {
      clearTimeout(doctorDebounceRef.current);
      doctorDebounceRef.current = setTimeout(() => fetchDoctors(), 3000);
    };

    socket.on('patient:registered', handlePatientRegistered);
    socket.on('patient:created', handlePatientRegistered);
    socket.on('opd_queue:updated', handleQueueUpdate);
    socket.on('opd_queue:status_changed', handleQueueUpdate);
    socket.on('token:generated', handleQueueUpdate);
    socket.on('token:created', handleQueueUpdate);
    socket.on('doctor:availability_changed', handleDoctorUpdate);
    socket.on('staff:availability_changed', handleDoctorUpdate);
    socket.on('staff:updated', handleDoctorUpdate);
    socket.on('user:status_changed', handleDoctorUpdate);
    socket.on('workflow:notification', handleQueueUpdate);

    return () => {
      socket.off('patient:registered', handlePatientRegistered);
      socket.off('patient:created', handlePatientRegistered);
      socket.off('opd_queue:updated', handleQueueUpdate);
      socket.off('opd_queue:status_changed', handleQueueUpdate);
      socket.off('token:generated', handleQueueUpdate);
      socket.off('token:created', handleQueueUpdate);
      socket.off('doctor:availability_changed', handleDoctorUpdate);
      socket.off('staff:availability_changed', handleDoctorUpdate);
      socket.off('staff:updated', handleDoctorUpdate);
      socket.off('user:status_changed', handleDoctorUpdate);
      socket.off('workflow:notification', handleQueueUpdate);
      // Clean up pending debounce timers on unmount
      clearTimeout(queueDebounceRef.current);
      clearTimeout(doctorDebounceRef.current);
    };
  }, [socket, fetchQueuedPatients, fetchRegisteredPatients, fetchDoctors]);

  const handleIssueTokenForPatient = (pat) => {
    setSelectedPatient(pat);
    setSelectedDoctorId(null);
    setIsTokenOpen(true);
  };

  const handleIssueTokenForDoctor = (docId) => {
    setSelectedDoctorId(docId);
    setSelectedPatient(null);
    setIsTokenOpen(true);
  };

  // Set of queued patient IDs today
  const queuedPatientIds = new Set(
    queuedPatients.map((q) => (q.patientId?._id || q.patientId || '').toString())
  );

  // Tab 1: Registered Patients Awaiting OPD Token
  const registeredAwaitingToken = patients.filter((p) => {
    const pId = (p._id || '').toString();
    return !queuedPatientIds.has(pId);
  });

  const activeDoctors = doctors.filter((d) => d.isAvailable !== false);

  // Filtered lists with search bar
  const filteredAwaiting = registeredAwaitingToken.filter(
    (p) =>
      p.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.uhid?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.phone?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.chiefComplaints?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredQueued = queuedPatients.filter(
    (q) =>
      q.patientId?.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.patientId?.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.patientId?.uhid?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      q.doctorId?.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredAllPatients = patients.filter(
    (p) =>
      p.firstName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.lastName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.uhid?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.phone?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.chiefComplaints?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Top Header & Global Actions ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-white border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100">
              <Users size={22} />
            </span>
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">
                Reception Desk &amp; OPD Station
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Register Patients, Generate OPD Tokens, Manage Live Queues &amp; Doctor Rosters
              </p>
            </div>
          </div>
        </div>

        {/* Both Key Actions Side-by-Side */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            size="sm"
            variant="outline"
            className="font-bold gap-1.5 text-xs text-slate-700 hover:bg-slate-50 border-slate-300"
            onClick={fetchAllData}
            isLoading={isLoading}
          >
            <RefreshCw size={14} /> Refresh
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="font-bold gap-1.5 text-xs bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100 shadow-2xs"
            onClick={() => {
              setSelectedPatient(null);
              setSelectedDoctorId(null);
              setIsTokenOpen(true);
            }}
          >
            <Ticket size={16} className="text-amber-600" /> Issue OPD Token
          </Button>

          <Button
            variant="primary"
            size="sm"
            className="font-bold gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
            onClick={() => setIsRegisterOpen(true)}
          >
            <UserPlus size={16} /> Register New Patient
          </Button>
        </div>
      </div>

      {/* ── Quick Summary Stat Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div onClick={() => handleTabChange('REGISTERED')} className="cursor-pointer transition-transform hover:scale-[1.01]">
          <StatCard
            title="Registered Patients"
            value={`${patients.length} Total`}
            subtitle={`${registeredAwaitingToken.length} Awaiting Token`}
            icon={UserPlus}
            color="indigo"
          />
        </div>
        <div onClick={() => handleTabChange('DOCTORS')} className="cursor-pointer transition-transform hover:scale-[1.01]">
          <StatCard
            title="OPD Doctor Roster"
            value={`${activeDoctors.length} / ${doctors.length} Online`}
            subtitle="Available for Consults"
            icon={Stethoscope}
            color="emerald"
          />
        </div>
        <div onClick={() => handleTabChange('QUEUED')} className="cursor-pointer transition-transform hover:scale-[1.01]">
          <StatCard
            title="Active Live Queue"
            value={`${queuedPatients.length} Waiting`}
            subtitle="Real-time OPD Line"
            icon={Ticket}
            color="amber"
          />
        </div>
        <div onClick={() => handleTabChange('ALL')} className="cursor-pointer transition-transform hover:scale-[1.01]">
          <StatCard
            title="Hospital Master Directory"
            value={`${patients.length} Registered`}
            subtitle="All Patient Profiles"
            icon={FolderOpen}
            color="purple"
          />
        </div>
      </div>

      {/* ── Active Section Header & Search ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-2.5">
          <span className="p-2.5 rounded-xl bg-slate-100 border border-slate-200">
            {activeTab === 'QUEUED' && <Ticket size={18} className="text-amber-600" />}
            {activeTab === 'REGISTERED' && <UserCheck size={18} className="text-indigo-600" />}
            {activeTab === 'FOLLOW_UPS' && <Calendar size={18} className="text-purple-600" />}
            {activeTab === 'ALL' && <FolderOpen size={18} className="text-slate-600" />}
            {activeTab === 'DOCTORS' && <Stethoscope size={18} className="text-teal-600" />}
          </span>
          <div>
            <h3 className="text-sm font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
              {activeTab === 'QUEUED' && 'Active OPD Live Queue'}
              {activeTab === 'REGISTERED' && 'Registered Patients Awaiting Token'}
              {activeTab === 'FOLLOW_UPS' && 'Scheduled Follow-Up Visits'}
              {activeTab === 'ALL' && 'All Hospital Patients Master Directory'}
              {activeTab === 'DOCTORS' && 'OPD Doctor On-Duty Roster'}
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200">
                {activeTab === 'QUEUED' && `${queuedPatients.length} Waiting`}
                {activeTab === 'REGISTERED' && `${registeredAwaitingToken.length} Awaiting`}
                {activeTab === 'ALL' && `${patients.length} Total`}
                {activeTab === 'DOCTORS' && `${activeDoctors.length} / ${doctors.length} Online`}
              </span>
            </h3>
            <p className="text-[11px] text-slate-400 font-medium">
              {activeTab === 'QUEUED' && 'Patients currently queued with active OPD tokens awaiting doctor consultation'}
              {activeTab === 'REGISTERED' && 'Newly registered patients ready for token generation and doctor assignment'}
              {activeTab === 'FOLLOW_UPS' && 'Patients scheduled for returning OPD follow-up consultations'}
              {activeTab === 'ALL' && 'Complete hospital patient registry with medical history and records'}
              {activeTab === 'DOCTORS' && 'Real-time doctor availability and consultation room allocations'}
            </p>
          </div>
        </div>

        {/* Search Input */}
        {activeTab !== 'FOLLOW_UPS' && activeTab !== 'DOCTORS' && (
          <div className="relative max-w-xs sm:max-w-sm w-full">
            <Input
              placeholder="Search by UHID, Patient Name, Phone, Doctor..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="py-1.5 text-xs pl-9 bg-white border-slate-300"
            />
            <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
          </div>
        )}
      </div>

      {/* ── TAB 1: ACTIVE OPD LIVE QUEUE ── */}
      {activeTab === 'QUEUED' && (
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Ticket size={18} className="text-amber-600" />
                Active OPD Live Token Queue ({filteredQueued.length})
              </h3>
              <p className="text-xs text-slate-500">
                Patients currently waiting in lobby or undergoing clinical consultation with assigned doctors.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="font-bold text-xs gap-1.5 text-amber-900 bg-amber-50 border-amber-300 hover:bg-amber-100"
              onClick={() => {
                setSelectedPatient(null);
                setSelectedDoctorId(null);
                setIsTokenOpen(true);
              }}
            >
              <Ticket size={14} className="text-amber-600" /> Issue Next Token
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-600 uppercase tracking-wider text-[10px] border-b border-slate-200">
                <tr>
                  <th className="p-3 font-extrabold">Token #</th>
                  <th className="p-3 font-extrabold">UHID</th>
                  <th className="p-3 font-extrabold">Patient Name</th>
                  <th className="p-3 font-extrabold">Assigned Doctor</th>
                  <th className="p-3 font-extrabold">Cabin / Room</th>
                  <th className="p-3 font-extrabold">Chief Complaint</th>
                  <th className="p-3 font-extrabold">Queue Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800">
                {filteredQueued.length > 0 ? (
                  filteredQueued.map((tok) => {
                    const pat = tok.patientId || {};
                    const doc = tok.doctorId || {};
                    return (
                      <tr key={tok._id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3 font-black text-amber-600 font-mono text-sm">#{tok.tokenNumber}</td>
                        <td className="p-3 font-mono font-bold text-indigo-700">{pat.uhid || '—'}</td>
                        <td className="p-3 font-bold text-slate-900">
                          {pat.firstName} {pat.lastName}
                          <p className="text-[10px] text-slate-500 font-normal font-mono">{pat.phone}</p>
                        </td>
                        <td className="p-3 text-slate-700">
                          <span className="font-bold text-slate-900">
                            {doc.name ? (doc.name.startsWith('Dr.') ? doc.name : `Dr. ${doc.name}`) : 'Assigned Doctor'}
                            {doc.role === 'HOSPITAL_ADMIN' && <span className="ml-1 text-[10px] font-bold text-indigo-600">(Admin)</span>}
                          </span>
                          <p className="text-[10px] text-slate-500">{doc.specialization || 'OPD Clinic'}</p>
                        </td>
                        <td className="p-3 text-slate-700 font-medium">{tok.cabinNo || doc.cabinNo || 'Cabin 101'}</td>
                        <td className="p-3 text-amber-700 font-medium">{tok.chiefComplaints || 'OPD Check-up'}</td>
                        <td className="p-3">
                          <span className={`px-2.5 py-1 rounded text-[10px] font-extrabold border inline-flex items-center gap-1 ${tok.status === 'IN_CONSULTATION'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300 animate-pulse'
                              : 'bg-amber-50 text-amber-700 border-amber-300'
                            }`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${tok.status === 'IN_CONSULTATION' ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                            {tok.status === 'IN_CONSULTATION' ? 'IN CONSULTATION' : 'WAITING IN QUEUE'}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      <Ticket size={28} className="mx-auto text-slate-300 mb-2" />
                      <p className="font-semibold text-slate-700">No patients currently in the OPD queue.</p>
                      <p className="text-xs text-slate-400 mt-1">Use the "Issue OPD Token" or "Register New Patient" buttons above to queue patients.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── TAB 2: REGISTERED PATIENTS AWAITING TOKEN ── */}
      {activeTab === 'REGISTERED' && (
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <UserCheck size={18} className="text-indigo-600" />
                Registered Patients Awaiting OPD Token ({filteredAwaiting.length})
              </h3>
              <p className="text-xs text-slate-500">
                Patients registered in the system who are ready to receive an OPD queue token number.
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              className="font-bold gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={() => setIsRegisterOpen(true)}
            >
              <UserPlus size={15} /> + Register New Patient
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-600 uppercase tracking-wider text-[10px] border-b border-slate-200">
                <tr>
                  <th className="p-3 font-extrabold">UHID</th>
                  <th className="p-3 font-extrabold">Patient Name</th>
                  <th className="p-3 font-extrabold">Age / Gender</th>
                  <th className="p-3 font-extrabold">Phone Number</th>
                  <th className="p-3 font-extrabold">Reason / Complaint</th>
                  <th className="p-3 font-extrabold">Registered Time</th>
                  <th className="p-3 font-extrabold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800">
                {filteredAwaiting.length > 0 ? (
                  filteredAwaiting.map((pat) => (
                    <tr key={pat._id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 font-mono font-extrabold text-indigo-700">{pat.uhid}</td>
                      <td className="p-3 font-bold text-slate-900">{pat.firstName} {pat.lastName}</td>
                      <td className="p-3">
                        <div className="font-semibold text-slate-800">
                          {pat.age ? `${pat.age} Yrs` : '—'} &bull; {pat.gender || '—'}
                        </div>
                        {pat.dob && (
                          <div className="flex items-center gap-1 text-[11px] text-indigo-700 font-semibold mt-0.5">
                            <Calendar size={11} className="text-indigo-500 shrink-0" />
                            <span>DOB: {new Date(pat.dob).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                          </div>
                        )}
                      </td>
                      <td className="p-3 font-mono text-slate-600">{pat.phone}</td>
                      <td className="p-3 text-amber-700 font-medium">{pat.chiefComplaints || 'Routine Consultation'}</td>
                      <td className="p-3 text-slate-500">{new Date(pat.createdAt).toLocaleDateString()}</td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="font-bold gap-1 text-xs text-indigo-700 bg-indigo-50/80 border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300 shadow-2xs"
                            onClick={() => handleOpenDetails(pat)}
                            title="View Patient Login Credentials & DOB"
                          >
                            <Eye size={13} /> View DOB
                          </Button>
                          <Button
                            size="sm"
                            variant="primary"
                            className="font-bold gap-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs"
                            onClick={() => handleIssueTokenForPatient(pat)}
                          >
                            <Ticket size={13} /> Issue OPD Token
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      <CheckCircle size={28} className="mx-auto text-emerald-400 mb-2" />
                      <p className="font-semibold text-slate-700">All registered patients have been queued or consulted!</p>
                      <p className="text-xs text-slate-400 mt-1">Click "Register New Patient" to register a first-time visitor.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── TAB 3: FOLLOW-UP VISITS ── */}
      {activeTab === 'FOLLOW_UPS' && (
        <FollowUpVisitsSection
          onIssueToken={(patient) => {
            setSelectedPatient(patient);
            setSelectedDoctorId(null);
            setIsTokenOpen(true);
          }}
          onViewHistory={(id) => {
            setHistoryPatientId(id);
            setIsHistoryOpen(true);
          }}
        />
      )}

      {/* ── TAB 4: ALL HOSPITAL PATIENTS (MASTER DIRECTORY) ── */}
      {activeTab === 'ALL' && (
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <FolderOpen size={18} className="text-indigo-600" />
                Hospital Master Patient Directory ({filteredAllPatients.length})
              </h3>
              <p className="text-xs text-slate-500">
                Complete permanent archive of all patients registered with permanent UHIDs.
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              className="font-bold gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={() => setIsRegisterOpen(true)}
            >
              <UserPlus size={15} /> + Register New Patient
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-600 uppercase tracking-wider text-[10px] border-b border-slate-200">
                <tr>
                  <th className="p-3 font-extrabold">UHID</th>
                  <th className="p-3 font-extrabold">Patient Name</th>
                  <th className="p-3 font-extrabold">Age / Gender</th>
                  <th className="p-3 font-extrabold">Phone Number</th>
                  <th className="p-3 font-extrabold">Chief Complaint</th>
                  <th className="p-3 font-extrabold">Registered Date</th>
                  <th className="p-3 font-extrabold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800">
                {filteredAllPatients.length > 0 ? (
                  filteredAllPatients.map((pat) => {
                    const isQueued = queuedPatientIds.has((pat._id || '').toString());

                    return (
                      <tr key={pat._id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3 font-mono font-extrabold text-indigo-700">{pat.uhid}</td>
                        <td className="p-3 font-bold text-slate-900">{pat.firstName} {pat.lastName}</td>
                        <td className="p-3">
                          <div className="font-semibold text-slate-800">
                            {pat.age ? `${pat.age} Yrs` : '—'} &bull; {pat.gender || '—'}
                          </div>
                          {pat.dob && (
                            <div className="flex items-center gap-1 text-[11px] text-indigo-700 font-semibold mt-0.5">
                              <Calendar size={11} className="text-indigo-500 shrink-0" />
                              <span>DOB: {new Date(pat.dob).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                            </div>
                          )}
                        </td>
                        <td className="p-3 font-mono text-slate-600">{pat.phone}</td>
                        <td className="p-3 text-amber-700 font-medium">{pat.chiefComplaints || 'OPD Checkup'}</td>
                        <td className="p-3 text-slate-500">{new Date(pat.createdAt).toLocaleDateString()}</td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="font-bold gap-1 text-xs text-indigo-700 bg-indigo-50/80 border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300 shadow-2xs"
                              onClick={() => handleOpenDetails(pat)}
                              title="View Patient Login Credentials & DOB"
                            >
                              <Eye size={13} /> View DOB
                            </Button>
                            {isQueued ? (
                              <span className="px-2.5 py-1 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">
                                IN QUEUE TODAY
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                variant="primary"
                                className="font-bold gap-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs"
                                onClick={() => handleIssueTokenForPatient(pat)}
                              >
                                <Ticket size={13} /> Issue OPD Token
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      No registered patients found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── TAB 6: DOCTOR ROSTER & AVAILABILITY ── */}
      {activeTab === 'DOCTORS' && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Stethoscope size={18} className="text-teal-600" />
                Doctor Roster &amp; Availability Console ({doctors.length})
              </h3>
              <p className="text-xs text-slate-500">Live doctor duty status, cabin assignments, and active queue loads.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            {doctors.length > 0 ? (
              doctors.map((doc) => {
                const isAvail = doc.isAvailable !== false;
                const waitingCount = doctorQueueCounts[doc._id] || 0;
                return (
                  <div
                    key={doc._id}
                    className={`p-4 rounded-xl border transition-all space-y-3 ${isAvail
                        ? 'bg-white border-teal-200 hover:border-teal-400 shadow-sm'
                        : 'bg-red-50/70 border-red-200 opacity-75'
                      }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-slate-900 text-sm">
                        {doc.name?.startsWith('Dr.') ? doc.name : `Dr. ${doc.name}`}
                      </p>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black border flex items-center gap-1.5 ${isAvail
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-300 shadow-2xs'
                          : 'bg-rose-50 text-rose-700 border-rose-300'
                        }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${isAvail ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
                        {isAvail ? 'ONLINE • AVAILABLE' : 'OFFLINE • OFF DUTY'}
                      </span>
                    </div>

                    <div className="space-y-1 text-slate-600">
                      <p><span className="text-slate-400">Specialization:</span> <strong>{doc.specialization || 'General OPD'}</strong></p>
                      <p><span className="text-slate-400">Cabin / Station:</span> <strong>{doc.cabinNo || 'Cabin 101'}</strong></p>
                      <p><span className="text-slate-400">Patients in Queue:</span> <strong className="text-amber-600">{waitingCount} waiting</strong></p>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full font-bold gap-1 text-xs text-indigo-700 bg-indigo-50/70 border-indigo-200 hover:bg-indigo-100"
                      onClick={() => handleIssueTokenForDoctor(doc._id)}
                    >
                      <Ticket size={13} /> Issue Token for {doc.name?.startsWith('Dr.') ? doc.name : `Dr. ${doc.name}`}
                    </Button>
                  </div>
                );
              })
            ) : (
              <div className="col-span-3 p-8 text-center text-slate-500">
                No doctors registered in staff roster.
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── Modals ── */}
      <RegisterPatientModal
        isOpen={isRegisterOpen}
        onClose={() => setIsRegisterOpen(false)}
        onSuccess={fetchAllData}
        onIssueToken={(pat) => {
          setSelectedPatient(pat);
          setSelectedDoctorId(null);
          setIsTokenOpen(true);
        }}
      />

      <IssueTokenModal
        isOpen={isTokenOpen}
        onClose={() => {
          setIsTokenOpen(false);
          setSelectedPatient(null);
          setSelectedDoctorId(null);
        }}
        onSuccess={fetchAllData}
        initialPatient={selectedPatient}
        initialDoctorId={selectedDoctorId}
      />

      <PatientHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => {
          setIsHistoryOpen(false);
          setHistoryPatientId(null);
        }}
        initialIdentifier={historyPatientId}
      />

      <PatientDetailsModal
        isOpen={isDetailsOpen}
        onClose={() => {
          setIsDetailsOpen(false);
          setSelectedDetailsPatient(null);
        }}
        patient={selectedDetailsPatient}
        onIssueToken={(pat) => {
          setSelectedPatient(pat);
          setSelectedDoctorId(null);
          setIsTokenOpen(true);
        }}
        isQueued={
          selectedDetailsPatient
            ? queuedPatientIds.has((selectedDetailsPatient._id || '').toString())
            : false
        }
      />
    </div>
  );
};

export default ReceptionWorkspaceView;

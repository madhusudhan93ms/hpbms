import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDebounce } from '../../hooks/useDebounce';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { axiosClient } from '../../api/axiosClient';
import { useSocket } from '../../providers/SocketProvider';
import { useAuthStore } from '../../store/authStore';
import { FollowUpVisitsSection } from '../../components/common/FollowUpVisitsSection';
import { PatientHistoryModal } from '../../components/modals/PatientHistoryModal';
import {
  Users,
  UserPlus,
  Search,
  Ticket,
  Clock,
  Stethoscope,
  CheckCircle2,
  RefreshCw,
  UserCheck,
  Printer,
  CreditCard,
  AlertCircle,
  Phone,
  RotateCcw,
  Sparkles,
  Eye,
  ChevronDown,
  ChevronUp,
  Calendar,
} from 'lucide-react';

export const ReceptionWorkspaceView = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuthStore();
  const { socket } = useSocket();

  const activeTabParam = (searchParams.get('tab') || '').toUpperCase();
  const isFollowUpsTab = activeTabParam === 'FOLLOW_UPS';

  // Clinical history modal state
  const [historyPatientId, setHistoryPatientId] = useState(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Form mode in the on-screen corner panel: 'NEW' (Walk-in) | 'RETURNING' (Existing patient)
  const [formMode, setFormMode] = useState('NEW');

  // Core Data
  const [patients, setPatients] = useState([]);
  const [queuedPatients, setQueuedPatients] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [doctorQueueCounts, setDoctorQueueCounts] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  // Search in registered directory
  const [searchTerm, setSearchTerm] = useState('');

  // Form State: New Patient Intake (Chief Complaint removed per single clinic workflow)
  const [newPatient, setNewPatient] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    dob: '',
    age: '',
    gender: 'MALE',
    guardianName: '',
    guardianPhone: '',
    guardianRelationship: 'Father',
  });
  const [showMoreDetails, setShowMoreDetails] = useState(false);

  // Selected Doctor for Token Generation
  const [selectedDoctorId, setSelectedDoctorId] = useState('');

  // Returning Patient State
  const [returningSearch, setReturningSearch] = useState('');
  const [selectedReturningPatient, setSelectedReturningPatient] = useState(null);

  // Recently Issued Token (Displays Token Slip in Corner Panel - NO POPUP)
  const [issuedTokenSlip, setIssuedTokenSlip] = useState(null);

  // Form Feedback
  const [formError, setFormError] = useState(null);
  const [duplicateMatch, setDuplicateMatch] = useState(null);
  const [formSuccess, setFormSuccess] = useState(null);

  // Inline details view for registered patient
  const [expandedPatientId, setExpandedPatientId] = useState(null);

  // Fetch all registered patients
  const fetchRegisteredPatients = useCallback(async () => {
    try {
      const res = await axiosClient.get('/patients');
      const list = Array.isArray(res) ? res : (res?.data ?? res ?? []);
      setPatients(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Failed to load registered patients:', err);
    }
  }, []);

  // Fetch active OPD queue
  const fetchQueuedPatients = useCallback(async () => {
    try {
      const res = await axiosClient.get('/appointments/queue');
      const allTokens = res.data || [];
      const waitingOrInConsult = allTokens.filter((t) => t.status !== 'COMPLETED');
      setQueuedPatients(waitingOrInConsult);

      // Tally counts per doctor
      const counts = {};
      waitingOrInConsult.forEach((item) => {
        const docId = item.doctorId?._id || item.doctorId;
        if (docId) counts[docId] = (counts[docId] || 0) + 1;
      });
      setDoctorQueueCounts(counts);
    } catch (err) {
      console.error('Failed to load queued patients:', err);
    }
  }, []);

  // Fetch doctors roster
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

      // Default select the first available doctor if none selected
      const available = docList.filter((d) => d.isAvailable !== false);
      if (available.length > 0 && !selectedDoctorId) {
        setSelectedDoctorId(available[0]._id);
      } else if (docList.length > 0 && !selectedDoctorId) {
        setSelectedDoctorId(docList[0]._id);
      }
    } catch (err) {
      console.error('Failed to fetch doctor roster:', err);
    }
  }, [selectedDoctorId]);

  const fetchAllData = useCallback(async () => {
    setIsLoading(true);
    await Promise.all([fetchRegisteredPatients(), fetchQueuedPatients(), fetchDoctors()]);
    setIsLoading(false);
  }, [fetchRegisteredPatients, fetchQueuedPatients, fetchDoctors]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // Real-time synchronization via Socket.IO
  const queueDebounceRef = useRef(null);
  const doctorDebounceRef = useRef(null);

  useEffect(() => {
    if (!socket) return;

    const handlePatientRegistered = (payload) => {
      if (payload && (payload.patientId || payload.uhid)) {
        const card = {
          _id: payload.patientId,
          uhid: payload.uhid,
          firstName: payload.firstName,
          lastName: payload.lastName,
          phone: payload.phone,
          gender: payload.gender || 'MALE',
          createdAt: payload.timestamp || new Date().toISOString(),
        };
        setPatients((prev) => {
          const exists = prev.some(
            (p) =>
              (payload.patientId && String(p._id) === String(payload.patientId)) ||
              (payload.uhid && p.uhid === payload.uhid)
          );
          if (exists) {
            return prev.map((p) =>
              (payload.patientId && String(p._id) === String(payload.patientId)) ||
              (payload.uhid && p.uhid === payload.uhid)
                ? { ...p, ...card }
                : p
            );
          }
          return [card, ...prev];
        });
      } else {
        clearTimeout(queueDebounceRef.current);
        queueDebounceRef.current = setTimeout(() => fetchRegisteredPatients(), 1500);
      }
    };

    const handleQueueUpdate = () => {
      clearTimeout(queueDebounceRef.current);
      queueDebounceRef.current = setTimeout(() => fetchQueuedPatients(), 1500);
    };

    const handleDoctorUpdate = () => {
      clearTimeout(doctorDebounceRef.current);
      doctorDebounceRef.current = setTimeout(() => fetchDoctors(), 2000);
    };

    socket.on('patient:registered', handlePatientRegistered);
    socket.on('opd_queue:updated', handleQueueUpdate);
    socket.on('opd_queue:status_changed', handleQueueUpdate);
    socket.on('token:generated', handleQueueUpdate);
    socket.on('token:created', handleQueueUpdate);
    socket.on('doctor:availability_changed', handleDoctorUpdate);
    socket.on('staff:availability_changed', handleDoctorUpdate);

    return () => {
      socket.off('patient:registered', handlePatientRegistered);
      socket.off('opd_queue:updated', handleQueueUpdate);
      socket.off('opd_queue:status_changed', handleQueueUpdate);
      socket.off('token:generated', handleQueueUpdate);
      socket.off('token:created', handleQueueUpdate);
      socket.off('doctor:availability_changed', handleDoctorUpdate);
      socket.off('staff:availability_changed', handleDoctorUpdate);
      clearTimeout(queueDebounceRef.current);
      clearTimeout(doctorDebounceRef.current);
    };
  }, [socket, fetchQueuedPatients, fetchRegisteredPatients, fetchDoctors]);

  // Set of queued patient IDs (memoized)
  const queuedPatientIds = React.useMemo(() => new Set(
    queuedPatients.map((q) => (q.patientId?._id || q.patientId || '').toString())
  ), [queuedPatients]);

  const activeDoctors = React.useMemo(() => doctors.filter((d) => d.isAvailable !== false), [doctors]);

  // Debounce patient directory search — avoids filtering full roster on every keystroke
  const debouncedSearchTerm = useDebounce(searchTerm, 200);
  const lowerSearch = debouncedSearchTerm.toLowerCase();

  // Deduplicate directory patient list by _id and uhid
  const uniquePatients = React.useMemo(() => {
    const seenIds = new Set();
    const seenUhids = new Set();
    const result = [];
    for (const p of patients) {
      const idKey = p._id ? String(p._id) : null;
      const uhidKey = p.uhid ? String(p.uhid).toUpperCase() : null;
      if (idKey && seenIds.has(idKey)) continue;
      if (uhidKey && seenUhids.has(uhidKey)) continue;
      if (idKey) seenIds.add(idKey);
      if (uhidKey) seenUhids.add(uhidKey);
      result.push(p);
    }
    return result;
  }, [patients]);

  // Memoized Filtered Registered Directory
  const filteredAllPatients = React.useMemo(() => {
    if (!lowerSearch) return uniquePatients;
    return uniquePatients.filter(
      (p) =>
        p.firstName?.toLowerCase().includes(lowerSearch) ||
        p.lastName?.toLowerCase().includes(lowerSearch) ||
        p.uhid?.toLowerCase().includes(lowerSearch) ||
        p.phone?.toLowerCase().includes(lowerSearch)
    );
  }, [uniquePatients, lowerSearch]);

  // Memoized returning patients search
  const returningSearchResults = React.useMemo(() => {
    const term = returningSearch.trim().toLowerCase();
    if (!term) return [];
    return uniquePatients
      .filter(
        (p) =>
          p.phone?.includes(term) ||
          p.uhid?.toLowerCase().includes(term) ||
          `${p.firstName} ${p.lastName}`.toLowerCase().includes(term)
      )
      .slice(0, 6);
  }, [uniquePatients, returningSearch]);

  // DOB & Age synchronization helper
  const handleDobChange = (e) => {
    const dobVal = e.target.value;
    let computedAge = newPatient.age;
    if (dobVal) {
      const birthDate = new Date(dobVal);
      if (!isNaN(birthDate.getTime())) {
        const today = new Date();
        let calculated = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
          calculated--;
        }
        if (calculated >= 0) computedAge = String(calculated);
      }
    }
    setNewPatient((prev) => ({ ...prev, dob: dobVal, age: computedAge }));
  };

  // Reset On-Screen Form for Next Patient
  const handleResetForm = () => {
    setNewPatient({
      firstName: '',
      lastName: '',
      phone: '',
      dob: '',
      age: '',
      gender: 'MALE',
      guardianName: '',
      guardianPhone: '',
      guardianRelationship: 'Father',
    });
    setShowMoreDetails(false);
    setSelectedReturningPatient(null);
    setReturningSearch('');
    setIssuedTokenSlip(null);
    setFormError(null);
    setDuplicateMatch(null);
    setFormSuccess(null);
  };

  // Submit Handler: Register New Walk-in + Issue Token in ONE Click
  const handleRegisterAndIssueToken = async (e, issueToken = true) => {
    if (e) e.preventDefault();
    if (isSubmittingRef.current || isSubmitting) return;
    if (!newPatient.firstName.trim()) {
      setFormError('Patient First Name is required.');
      return;
    }
    // All other fields (lastName, phone, dob, age, guardian details) are optional
    if (issueToken && !selectedDoctorId) {
      setFormError('Please select a doctor to assign the token.');
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setFormError(null);
    setDuplicateMatch(null);
    setFormSuccess(null);

    try {
      // 1. Create Patient Record
      const patPayload = {
        firstName: newPatient.firstName.trim(),
        lastName: newPatient.lastName.trim(),
        phone: newPatient.phone.trim(),
        dob: newPatient.dob || undefined,
        age: newPatient.age ? Number(newPatient.age) : undefined,
        gender: newPatient.gender,
        guardianName: newPatient.guardianName.trim() || undefined,
        guardianPhone: newPatient.guardianPhone.trim() || undefined,
        guardianRelationship: newPatient.guardianRelationship || undefined,
        emergencyContact: {
          name: newPatient.guardianName.trim() || 'Self / N/A',
          phone: newPatient.guardianPhone.trim() || newPatient.phone.trim() || '+1 (555) 000-0000',
          relation: newPatient.guardianRelationship || 'Family',
        },
        chiefComplaints: 'OPD Consultation',
      };

      const patRes = await axiosClient.post('/patients', patPayload);
      const createdPatient = patRes.data;

      // Update local patient roster immediately with deduplication
      setPatients((prev) => {
        const exists = prev.some(
          (p) =>
            (createdPatient._id && String(p._id) === String(createdPatient._id)) ||
            (createdPatient.uhid && p.uhid === createdPatient.uhid)
        );
        if (exists) {
          return prev.map((p) =>
            (createdPatient._id && String(p._id) === String(createdPatient._id)) ||
            (createdPatient.uhid && p.uhid === createdPatient.uhid)
              ? { ...p, ...createdPatient }
              : p
          );
        }
        return [createdPatient, ...prev];
      });

      if (issueToken) {
        // 2. Issue OPD Queue Token
        const tokRes = await axiosClient.post('/appointments/tokens', {
          patientId: createdPatient._id,
          uhid: createdPatient.uhid,
          phone: createdPatient.phone,
          doctorId: selectedDoctorId,
          chiefComplaints: 'OPD Consultation',
        });

        const tokenData = tokRes.data;
        const assignedDoc = doctors.find((d) => String(d._id) === String(selectedDoctorId));

        // Set Issued Slip State (Shows on screen right in the card!)
        setIssuedTokenSlip({
          ...tokenData,
          patient: createdPatient,
          doctor: assignedDoc,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        });

        // Reset on-screen form fields immediately so it's clean and ready for the next patient
        setNewPatient({
          firstName: '',
          lastName: '',
          phone: '',
          dob: '',
          age: '',
          gender: 'MALE',
          guardianName: '',
          guardianPhone: '',
          guardianRelationship: 'Father',
        });
        setShowMoreDetails(false);

        setFormSuccess(`Registered ${createdPatient.firstName} and issued Token #${tokenData.tokenNumber}!`);
        await fetchQueuedPatients();
      } else {
        setFormSuccess(`Patient registered successfully! UHID: ${createdPatient.uhid}`);
        handleResetForm();
      }
    } catch (err) {
      const status = err.response?.status;
      const respData = err.response?.data?.existingRecords || err.response?.data?.data;
      if (status === 409 && Array.isArray(respData) && respData.length > 0) {
        setDuplicateMatch(respData[0]);
        setFormError(`Patient with this mobile is already registered: ${respData[0].firstName} ${respData[0].lastName} (${respData[0].uhid})`);
      } else {
        setFormError(err.response?.data?.error?.message || err.response?.data?.message || 'Failed to register patient.');
      }
    } finally {
      setIsSubmitting(false);
      isSubmittingRef.current = false;
    }
  };

  // Submit Handler: Issue Token for Returning Patient
  const handleIssueTokenForReturning = async (e) => {
    if (e) e.preventDefault();
    if (isSubmittingRef.current || isSubmitting) return;
    if (!selectedReturningPatient) {
      setFormError('Please select a returning patient first.');
      return;
    }
    if (!selectedDoctorId) {
      setFormError('Please select a doctor to assign the token.');
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setFormError(null);
    setFormSuccess(null);

    try {
      const tokRes = await axiosClient.post('/appointments/tokens', {
        patientId: selectedReturningPatient._id,
        uhid: selectedReturningPatient.uhid,
        phone: selectedReturningPatient.phone,
        doctorId: selectedDoctorId,
        chiefComplaints: selectedReturningPatient.chiefComplaints || 'OPD Consultation',
      });

      const tokenData = tokRes.data;
      const assignedDoc = doctors.find((d) => String(d._id) === String(selectedDoctorId));

      setIssuedTokenSlip({
        ...tokenData,
        patient: selectedReturningPatient,
        doctor: assignedDoc,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });

      setFormSuccess(`Token #${tokenData.tokenNumber} issued for ${selectedReturningPatient.firstName}!`);
      setSelectedReturningPatient(null);
      setReturningSearch('');
      await fetchQueuedPatients();
    } catch (err) {
      setFormError(err.response?.data?.error?.message || err.response?.data?.message || 'Failed to issue token.');
    } finally {
      setIsSubmitting(false);
      isSubmittingRef.current = false;
    }
  };

  // Select a duplicate patient into returning mode
  const handleSelectDuplicateAsReturning = (pat) => {
    setSelectedReturningPatient(pat);
    setFormMode('RETURNING');
    setDuplicateMatch(null);
    setFormError(null);
  };

  // Select patient from directory table into the corner returning form
  const handleSelectPatientFromDirectory = (pat) => {
    setSelectedReturningPatient(pat);
    setFormMode('RETURNING');
    setDuplicateMatch(null);
    setFormError(null);
    setIssuedTokenSlip(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Thermal Slip Print
  const handlePrintSlip = () => {
    if (!issuedTokenSlip) return;
    const printWindow = window.open('', '', 'width=460,height=680');
    const pat = issuedTokenSlip.patient || {};
    const patName = `${pat.firstName || ''} ${pat.lastName || ''}`.trim() || 'Walk-in Patient';
    const docName = issuedTokenSlip.doctor?.name
      ? (issuedTokenSlip.doctor.name.startsWith('Dr.') ? issuedTokenSlip.doctor.name : `Dr. ${issuedTokenSlip.doctor.name}`)
      : 'Assigned OPD Doctor';
    const cabin = issuedTokenSlip.cabinNo || issuedTokenSlip.doctor?.cabinNo || 'Cabin 101';
    const hospObj = user?.hospitalId || user?.hospital || {};
    const hospName = hospObj?.name || user?.hospitalName || 'Sri Vijayalakshmi Hospital';

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Token #${issuedTokenSlip.tokenNumber} - ${patName}</title>
          <style>
            @page { size: 80mm auto; margin: 4mm; }
            body { font-family: monospace, sans-serif; padding: 12px; margin: 0; text-align: center; color: #000; font-size: 12px; }
            .card { border: 2px dashed #000; padding: 12px; border-radius: 6px; }
            .hosp { font-size: 16px; font-weight: bold; text-transform: uppercase; margin-bottom: 4px; }
            .badge { display: inline-block; font-size: 11px; font-weight: bold; border: 1px solid #000; padding: 2px 6px; margin: 4px 0; }
            .token-num { font-size: 52px; font-weight: 900; margin: 6px 0; line-height: 1; }
            .cabin { font-size: 14px; font-weight: bold; background: #eee; padding: 4px; margin-bottom: 8px; }
            .details { text-align: left; font-size: 11px; border-top: 1px solid #000; padding-top: 8px; line-height: 1.6; }
            .row { display: flex; justify-content: space-between; }
            .footer { font-size: 10px; margin-top: 10px; border-top: 1px dashed #000; padding-top: 6px; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="hosp">${hospName}</div>
            <div class="badge">OPD CONSULTATION TOKEN</div>
            <div class="token-num">#${issuedTokenSlip.tokenNumber}</div>
            <div class="cabin">ROOM / CABIN: ${cabin}</div>
            <div class="details">
              <div class="row"><strong>Patient:</strong> <span>${patName}</span></div>
              <div class="row"><strong>UHID:</strong> <span>${pat.uhid || 'N/A'}</span></div>
              <div class="row"><strong>Mobile:</strong> <span>${pat.phone || 'N/A'}</span></div>
              <div class="row"><strong>Age / Gender:</strong> <span>${pat.age || '—'} Yrs / ${pat.gender || '—'}</span></div>
              <div class="row"><strong>Doctor:</strong> <span>${docName}</span></div>
              <div class="row"><strong>Date & Time:</strong> <span>${new Date().toLocaleDateString()} ${issuedTokenSlip.time || ''}</span></div>
            </div>
            <div class="footer">
              Please wait in the reception lobby until your token # is announced.
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      {/* ── Top Header & Clinic Status Bar ── */}
      <div className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200/90 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-indigo-600 text-white shadow-sm flex-shrink-0">
            <Ticket size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-slate-900 tracking-tight">
                Clinic Front Desk
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Live OPD Desk
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              1. Register Patient &rarr; 2. Issue Token &rarr; 3. Waiting for Consultant &rarr; 4. Billing
            </p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={fetchAllData}
            isLoading={isLoading}
            className="font-bold text-xs gap-1.5 text-slate-700 bg-white border-slate-300 hover:bg-slate-50 shadow-2xs"
          >
            <RefreshCw size={14} /> Refresh
          </Button>

          <Button
            size="sm"
            variant="primary"
            onClick={() => navigate('/billing/dashboard')}
            className="font-bold text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs"
          >
            <CreditCard size={15} /> Open Billing Desk &rarr;
          </Button>
        </div>
      </div>

      {/* ── Main Clinic Workspace ── */}
      {isFollowUpsTab ? (
        <div className="space-y-5">
          <FollowUpVisitsSection
            onIssueToken={(patient) => {
              setFormMode('RETURNING');
              setSelectedReturningPatient(patient);
              const next = new URLSearchParams(searchParams);
              next.delete('tab');
              setSearchParams(next);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onViewHistory={(id) => {
              setHistoryPatientId(id);
              setIsHistoryOpen(true);
            }}
          />
        </div>
      ) : (
        <div className="space-y-5">
          {/* =========================================================================
              EMBEDDED PATIENT REGISTRATION & TOKEN DESK
              (STAYS RIGHT ON THE SCREEN - NO MODAL POPUPS!)
             ========================================================================= */}
          <div className="rounded-2xl bg-white border-2 border-indigo-100 shadow-sm overflow-hidden">
            {/* Active Issued Token Slip Banner (shown when a token is issued!) */}
            {issuedTokenSlip && (
              <div className="p-4 sm:p-5 bg-gradient-to-r from-emerald-50 via-teal-50 to-white border-b-2 border-emerald-300">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="p-3 rounded-2xl bg-emerald-600 text-white shadow-2xs shrink-0">
                    <Ticket size={24} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black uppercase tracking-wider text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                        OPD Token Generated
                      </span>
                      <span className="font-mono text-2xl font-black text-slate-900">
                        #{issuedTokenSlip.tokenNumber}
                      </span>
                      <span className="text-xs font-bold text-slate-700 bg-white border border-slate-200 px-2.5 py-0.5 rounded-lg shadow-2xs">
                        {issuedTokenSlip.cabinNo || issuedTokenSlip.doctor?.cabinNo || 'Cabin 101'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">
                      <strong>{issuedTokenSlip.patient?.firstName} {issuedTokenSlip.patient?.lastName}</strong>
                      <span className="font-mono text-indigo-700 font-bold ml-1.5">({issuedTokenSlip.patient?.uhid})</span>
                      <span className="text-slate-400 mx-1.5">&bull;</span>
                      <span>{issuedTokenSlip.doctor?.name ? (issuedTokenSlip.doctor.name.startsWith('Dr.') ? issuedTokenSlip.doctor.name : `Dr. ${issuedTokenSlip.doctor.name}`) : 'Assigned Doctor'}</span>
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    onClick={handlePrintSlip}
                    variant="primary"
                    className="font-bold text-xs gap-1.5 bg-slate-900 hover:bg-black text-white shadow-xs"
                  >
                    <Printer size={14} /> Print Thermal Slip (80mm)
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => navigate('/billing/dashboard')}
                    variant="outline"
                    className="font-bold text-xs gap-1.5 text-indigo-700 bg-indigo-50 border-indigo-200 hover:bg-indigo-100"
                  >
                    <CreditCard size={14} /> Bill Patient
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleResetForm}
                    variant="outline"
                    className="font-bold text-xs gap-1 text-slate-700 bg-white border-slate-300 hover:bg-slate-50"
                  >
                    <RotateCcw size={14} /> Register Next
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Corner Panel Header */}
          <div className="p-4 bg-gradient-to-r from-indigo-50/90 via-slate-50 to-white border-b border-indigo-100/80">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-indigo-600 text-white shadow-2xs">
                  <UserPlus size={18} />
                </span>
                <div>
                  <h2 className="text-sm font-black text-slate-900 tracking-tight">
                    Patient Intake &amp; Token Station
                  </h2>
                  <p className="text-[11px] text-slate-500 font-medium">
                    Fast registration &bull; Instant OPD token issuance
                  </p>
                </div>
              </div>

              {/* Mode Toggle Tabs (New Walk-In vs Returning Patient) */}
              <div className="flex items-center gap-1.5 p-1 bg-slate-200/70 rounded-xl text-xs font-extrabold">
                <button
                  type="button"
                  onClick={() => {
                    setFormMode('NEW');
                    setFormError(null);
                    setDuplicateMatch(null);
                  }}
                  className={`px-3 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                    formMode === 'NEW'
                      ? 'bg-white text-indigo-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <UserPlus size={14} /> + New Walk-In Registration
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFormMode('RETURNING');
                    setFormError(null);
                    setDuplicateMatch(null);
                  }}
                  className={`px-3 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                    formMode === 'RETURNING'
                      ? 'bg-white text-indigo-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <UserCheck size={14} /> Returning Patient (Issue Token)
                </button>
              </div>
            </div>
          </div>

          {/* Corner Panel Body */}
          <div className="p-4 sm:p-5">
            <div className="space-y-4">
              {/* Feedback Messages */}
              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-start gap-2">
                  <AlertCircle size={16} className="text-rose-600 shrink-0 mt-0.5" />
                  <div>{formError}</div>
                </div>
              )}

              {formSuccess && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                  <div>{formSuccess}</div>
                </div>
              )}

              {/* Duplicate Patient Alert Card */}
              {duplicateMatch && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-xs space-y-2.5">
                  <div className="flex items-center gap-1.5 font-bold text-amber-900">
                    <AlertCircle size={15} className="text-amber-600 shrink-0" />
                    <span>Existing Patient Record Found</span>
                  </div>
                  <p className="text-slate-700">
                    <strong>{duplicateMatch.firstName} {duplicateMatch.lastName}</strong> &bull;{' '}
                    <span className="font-mono text-indigo-700 font-bold">{duplicateMatch.uhid}</span>
                  </p>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => handleSelectDuplicateAsReturning(duplicateMatch)}
                    className="w-full sm:w-auto text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white gap-1"
                  >
                    <UserCheck size={14} /> Select &amp; Issue Token For This Patient
                  </Button>
                </div>
              )}

              {/* ── SUB-MODE 1: NEW WALK-IN REGISTRATION ── */}
              {formMode === 'NEW' && (
                <form onSubmit={handleRegisterAndIssueToken} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                    {/* First Name */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        First Name <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="Your Name"
                        value={newPatient.firstName}
                        onChange={(e) => setNewPatient({ ...newPatient, firstName: e.target.value })}
                        required
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white font-medium"
                      />
                    </div>

                    {/* Last Name */}
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Last Name <span className="text-[10px] text-slate-400 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        placeholder="Last Name"
                        value={newPatient.lastName}
                        onChange={(e) => setNewPatient({ ...newPatient, lastName: e.target.value })}
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white"
                      />
                    </div>

                    {/* Phone Number */}
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Mobile Phone <span className="text-[10px] text-slate-400 font-normal">(Optional)</span>
                      </label>
                      <div className="relative">
                        <input
                          type="tel"
                          placeholder="10-digit mobile number"
                          value={newPatient.phone}
                          maxLength={14}
                          onChange={(e) => setNewPatient({ ...newPatient, phone: e.target.value })}
                          className="w-full pl-8 pr-3 py-2 text-xs font-mono rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white"
                        />
                        <Phone size={13} className="absolute left-2.5 top-2.5 text-slate-400" />
                      </div>
                    </div>

                    {/* Date of Birth (DOB) */}
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Date of Birth (DOB) <span className="text-[10px] text-slate-400 font-normal">(Optional)</span>
                      </label>
                      <div className="relative">
                        <input
                          type="date"
                          value={newPatient.dob}
                          onChange={handleDobChange}
                          className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white font-medium"
                        />
                        <Calendar size={13} className="absolute left-2.5 top-2.5 text-slate-400" />
                      </div>
                    </div>

                    {/* Age */}
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Age (Years) <span className="text-[10px] text-slate-400 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="125"
                        placeholder="Age"
                        value={newPatient.age}
                        onChange={(e) => setNewPatient({ ...newPatient, age: e.target.value })}
                        className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white"
                      />
                    </div>

                    {/* Gender */}
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Gender
                      </label>
                      <select
                        value={newPatient.gender}
                        onChange={(e) => setNewPatient({ ...newPatient, gender: e.target.value })}
                        className="w-full px-2.5 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white font-semibold"
                      >
                        <option value="MALE">Male</option>
                        <option value="FEMALE">Female</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </div>

                    {/* Doctor Assignment (Spans 2 columns on tablet/desktop) */}
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Assign Doctor &bull; Cabin <span className="text-rose-500">*</span>
                      </label>
                      <select
                        value={selectedDoctorId}
                        onChange={(e) => setSelectedDoctorId(e.target.value)}
                        required
                        className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white font-bold text-slate-800"
                      >
                        <option value="">-- Choose Doctor on Duty --</option>
                        {doctors.map((doc) => {
                          const isAvail = doc.isAvailable !== false;
                          const count = doctorQueueCounts[doc._id] || 0;
                          return (
                            <option key={doc._id} value={doc._id}>
                              {doc.name.startsWith('Dr.') ? doc.name : `Dr. ${doc.name}`} ({doc.cabinNo || 'Cabin 101'}) &mdash; {count} waiting {isAvail ? '• Online' : '• Offline'}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </div>

                  {/* Collapsible Guardian / Attendant Details (Show More / Show Less) */}
                  <div className="pt-0.5">
                    <button
                      type="button"
                      onClick={() => setShowMoreDetails((prev) => !prev)}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/80 px-3 py-1.5 rounded-lg transition-all"
                    >
                      {showMoreDetails ? (
                        <>
                          <ChevronUp size={14} /> Show Less (Hide Guardian Details)
                        </>
                      ) : (
                        <>
                          <ChevronDown size={14} /> Show More &bull; Guardian Details (Optional)
                        </>
                      )}
                    </button>

                    {showMoreDetails && (
                      <div className="mt-2.5 p-3.5 bg-slate-50/80 rounded-xl border border-slate-200/80 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                            <UserCheck size={14} className="text-indigo-600" />
                            Guardian / Emergency Contact Information
                          </span>
                          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                            Optional
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Guardian Name (Optional)
                            </label>
                            <input
                              type="text"
                              placeholder="Guardian Name"
                              value={newPatient.guardianName}
                              onChange={(e) => setNewPatient({ ...newPatient, guardianName: e.target.value })}
                              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Guardian Mobile Phone (Optional)
                            </label>
                            <div className="relative">
                              <input
                                type="tel"
                                placeholder="10-digit mobile"
                                value={newPatient.guardianPhone}
                                maxLength={14}
                                onChange={(e) => setNewPatient({ ...newPatient, guardianPhone: e.target.value })}
                                className="w-full pl-8 pr-3 py-2 text-xs font-mono rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white"
                              />
                              <Phone size={13} className="absolute left-2.5 top-2.5 text-slate-400" />
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Relationship (Optional)
                            </label>
                            <select
                              value={newPatient.guardianRelationship}
                              onChange={(e) => setNewPatient({ ...newPatient, guardianRelationship: e.target.value })}
                              className="w-full px-2.5 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white font-medium"
                            >
                              <option value="Father">Father</option>
                              <option value="Mother">Mother</option>
                              <option value="Spouse">Spouse</option>
                              <option value="Sibling">Sibling</option>
                              <option value="Child">Child</option>
                              <option value="Legal Guardian">Legal Guardian</option>
                              <option value="Caretaker">Caretaker</option>
                              <option value="Other">Other</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Primary Submission Button & Secondary Action */}
                  <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
                    <Button
                      type="submit"
                      variant="primary"
                      isLoading={isSubmitting}
                      className="w-full sm:w-auto font-bold gap-2 text-xs bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs py-2.5 px-6"
                    >
                      <Ticket size={16} /> Register &amp; Issue OPD Token &rarr;
                    </Button>

                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={(e) => handleRegisterAndIssueToken(e, false)}
                      className="text-[11px] font-bold text-slate-500 hover:text-indigo-600 py-1 transition-colors"
                    >
                      Register Patient Record Only (Without Token)
                    </button>
                  </div>
                </form>
              )}

              {/* ── SUB-MODE 2: RETURNING PATIENT LOOKUP & TOKEN ── */}
              {formMode === 'RETURNING' && (
                <div className="space-y-3.5">
                  {!selectedReturningPatient ? (
                    <div className="space-y-2">
                      <label className="block text-[11px] font-bold text-slate-700 mb-1">
                        Search Registered Patient
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Type Mobile, UHID, or Name..."
                          value={returningSearch}
                          onChange={(e) => setReturningSearch(e.target.value)}
                          className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white"
                          autoFocus
                        />
                        <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                      </div>

                      {/* Matching Search Results Dropdown List */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-56 overflow-y-auto pt-1">
                        {returningSearchResults.length > 0 ? (
                          returningSearchResults.map((pat) => (
                            <button
                              key={pat._id}
                              type="button"
                              onClick={() => setSelectedReturningPatient(pat)}
                              className="p-2.5 text-left rounded-xl bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 transition-all flex items-center justify-between text-xs group"
                            >
                              <div>
                                <p className="font-bold text-slate-900 group-hover:text-indigo-900">
                                  {pat.firstName} {pat.lastName}
                                </p>
                                <p className="text-[10px] text-slate-500">
                                  Phone: {pat.phone} &bull; {pat.gender}
                                </p>
                              </div>
                              <span className="font-mono text-[11px] font-bold text-indigo-700 bg-white px-2 py-0.5 rounded border border-indigo-100">
                                {pat.uhid}
                              </span>
                            </button>
                          ))
                        ) : returningSearch.trim().length > 1 ? (
                          <p className="col-span-full text-center text-[11px] text-slate-400 py-3">
                            No registered patient found. Use "+ New Walk-In" to register.
                          </p>
                        ) : (
                          <p className="col-span-full text-center text-[11px] text-slate-400 py-2">
                            Enter 3+ digits of mobile or UHID to search.
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* Selected Returning Patient Card */
                    <form onSubmit={handleIssueTokenForReturning} className="space-y-3.5">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 items-end">
                        <div className="p-3.5 rounded-xl bg-indigo-50/80 border border-indigo-200 text-xs">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">
                              Selected Patient
                            </span>
                            <button
                              type="button"
                              onClick={() => setSelectedReturningPatient(null)}
                              className="text-[10px] font-bold text-indigo-600 hover:underline"
                            >
                              Change
                            </button>
                          </div>
                          <p className="font-extrabold text-slate-900 text-sm">
                            {selectedReturningPatient.firstName} {selectedReturningPatient.lastName}
                          </p>
                          <p className="text-[11px] font-mono text-indigo-800 font-bold mt-0.5">
                            UHID: {selectedReturningPatient.uhid}
                          </p>
                          <p className="text-[10px] text-slate-600 mt-0.5">
                            Phone: {selectedReturningPatient.phone} &bull; {selectedReturningPatient.age ? `${selectedReturningPatient.age} Yrs` : ''} &bull; {selectedReturningPatient.gender}
                          </p>
                        </div>

                        {/* Doctor Assignment & Submit */}
                        <div className="space-y-3">
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">
                              Assign Doctor &bull; Cabin <span className="text-rose-500">*</span>
                            </label>
                            <select
                              value={selectedDoctorId}
                              onChange={(e) => setSelectedDoctorId(e.target.value)}
                              required
                              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white font-bold text-slate-800"
                            >
                              <option value="">-- Choose Doctor on Duty --</option>
                              {doctors.map((doc) => (
                                <option key={doc._id} value={doc._id}>
                                  {doc.name.startsWith('Dr.') ? doc.name : `Dr. ${doc.name}`} ({doc.cabinNo || 'Cabin 101'}) &mdash; {doctorQueueCounts[doc._id] || 0} waiting
                                </option>
                              ))}
                            </select>
                          </div>

                          <Button
                            type="submit"
                            variant="primary"
                            isLoading={isSubmitting}
                            className="w-full font-bold gap-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs py-2.5"
                          >
                            <Ticket size={16} /> Issue OPD Token &rarr;
                          </Button>
                        </div>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )}

      {/* =========================================================================
          BELOW: REGISTERED PATIENT DIRECTORY (FULL WIDTH)
          No popups, instant search, one-click token issuance
         ========================================================================= */}
      <Card className="p-4 sm:p-6 shadow-xs border border-slate-200/90">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <Users size={18} className="text-indigo-600" />
              <h2 className="text-base font-black text-slate-900 tracking-tight">
                Registered Patients Directory
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                {uniquePatients.length} Total Patients
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Search hospital records &bull; Click &quot;Issue Token&quot; to immediately assign a doctor in the intake station above
            </p>
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-72">
            <input
              type="text"
              placeholder="Search by UHID, Name, or Mobile..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white"
            />
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-2.5 text-[11px] text-slate-400 hover:text-slate-700 font-bold"
              >
                &times;
              </button>
            )}
          </div>
        </div>

        {/* Directory Table */}
        <div className="overflow-x-auto overflow-y-auto max-h-[540px] rounded-xl border border-slate-200/90 mt-4 relative shadow-2xs">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-xs text-slate-700 uppercase tracking-wider text-[10px] border-b border-slate-200 shadow-2xs">
              <tr>
                <th className="p-3 font-extrabold bg-slate-100">UHID</th>
                <th className="p-3 font-extrabold bg-slate-100">Patient Name</th>
                <th className="p-3 font-extrabold bg-slate-100">Age / Gender</th>
                <th className="p-3 font-extrabold bg-slate-100">Mobile Phone</th>
                <th className="p-3 font-extrabold bg-slate-100">Registered Date</th>
                <th className="p-3 font-extrabold bg-slate-100 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {filteredAllPatients.length > 0 ? (
                filteredAllPatients.map((pat) => {
                  const isQueued = queuedPatientIds.has((pat._id || '').toString());
                  const isExpanded = expandedPatientId === pat._id;

                  return (
                    <React.Fragment key={pat._id}>
                      <tr className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3 font-mono font-bold text-indigo-700">
                          {pat.uhid}
                        </td>
                        <td className="p-3 font-bold text-slate-900">
                          {pat.firstName} {pat.lastName}
                        </td>
                        <td className="p-3 text-slate-600 font-medium">
                          {pat.age ? `${pat.age} Yrs` : '—'} &bull; {pat.gender || '—'}
                        </td>
                        <td className="p-3 font-mono text-slate-600">
                          {pat.phone}
                        </td>
                        <td className="p-3 text-slate-500">
                          {pat.createdAt ? new Date(pat.createdAt).toLocaleDateString() : '—'}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="font-bold text-[11px] gap-1 text-slate-600 bg-white border-slate-200 hover:bg-slate-50 shadow-2xs"
                              onClick={() => setExpandedPatientId(isExpanded ? null : pat._id)}
                            >
                              <Eye size={12} /> {isExpanded ? 'Hide' : 'Details'}
                            </Button>

                            {isQueued ? (
                              <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold">
                                IN QUEUE
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                variant="primary"
                                className="font-bold text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs"
                                onClick={() => handleSelectPatientFromDirectory(pat)}
                                title="Load into intake station above to issue OPD token"
                              >
                                <Ticket size={13} /> Issue Token
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Inline Expandable Details */}
                      {isExpanded && (
                        <tr className="bg-indigo-50/40">
                          <td colSpan={6} className="p-3.5 pl-6 text-xs text-slate-700 border-b border-indigo-100">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <div>
                                <p className="text-[10px] font-bold uppercase text-indigo-700">DOB &amp; Login</p>
                                <p className="font-semibold text-slate-900 mt-0.5">
                                  DOB: {pat.dob ? new Date(pat.dob).toLocaleDateString('en-GB') : 'Not Specified'}
                                </p>
                                <p className="font-mono text-[11px] text-slate-600">
                                  User: {pat.patientCredentials?.username || pat.uhid}
                                </p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold uppercase text-indigo-700">Address</p>
                                <p className="text-slate-800 mt-0.5">{pat.address || 'Walk-in Registration'}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold uppercase text-indigo-700">Quick Token Action</p>
                                <button
                                  onClick={() => handleSelectPatientFromDirectory(pat)}
                                  className="mt-1 text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                                >
                                  Load this patient into intake station &rarr;
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    <p className="font-bold text-slate-700">No registered patients found.</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {searchTerm ? 'Try searching with a different name, phone or UHID.' : 'Use the intake station above to register new patients.'}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {/* Patient Clinical History Modal */}
      <PatientHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => {
          setIsHistoryOpen(false);
          setHistoryPatientId(null);
        }}
        initialIdentifier={historyPatientId}
      />
    </div>
  );
};

export default ReceptionWorkspaceView;


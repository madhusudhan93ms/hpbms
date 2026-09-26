import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { StatCard } from '../../components/ui/StatCard';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { axiosClient } from '../../api/axiosClient';
import { AllocateBedModal } from '../../components/modals/AllocateBedModal';
import { formatCurrency } from '../../utils/formatters';
import { useSocket } from '../../providers/SocketProvider';
import { useDepartmentNotificationStore } from '../../store/departmentNotificationStore';
import {
  BedDouble,
  CheckCircle2,
  AlertTriangle,
  UserPlus,
  UserCheck,
  LayoutGrid,
  RefreshCw,
  Search,
  Lock,
  LogOut,
  Stethoscope,
  Activity,
} from 'lucide-react';

export const NurseInchargeDashboard = () => {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('REQUISITIONS'); // 'REQUISITIONS' | 'ADMITTED' | 'BEDS' | 'REQUESTS' | 'TASKS'
  const [taskFilter, setTaskFilter] = useState('PENDING'); // 'PENDING' | 'COMPLETED' | 'ALL'
  const [admissions, setAdmissions] = useState([]);
  const [beds, setBeds] = useState([]);
  const [patientRequests, setPatientRequests] = useState([]);
  const [nurseTasks, setNurseTasks] = useState([]);
  const requestedTaskId = location.state?.taskId || new URLSearchParams(location.search).get('taskId');
  const requestedRequestId = location.state?.requestId || new URLSearchParams(location.search).get('requestId');
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const [selectedAdmissionForModal, setSelectedAdmissionForModal] = useState(null);
  const [isAllocateModalOpen, setIsAllocateModalOpen] = useState(false);
  const [isDischargingId, setIsDischargingId] = useState(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const tabParam = location.state?.tab || searchParams.get('tab');
    if (tabParam && ['REQUISITIONS', 'ADMITTED', 'BEDS', 'REQUESTS', 'TASKS'].includes(tabParam.toUpperCase())) {
      setActiveTab(tabParam.toUpperCase());
    } else {
      setActiveTab('REQUISITIONS');
    }
  }, [location.search, location.state]);

  const { socket } = useSocket();
  const { fetchPendingWork } = useDepartmentNotificationStore();

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!requestedTaskId || activeTab !== 'TASKS' || nurseTasks.length === 0) return;
    const requestedTask = nurseTasks.find((task) => String(task._id) === String(requestedTaskId));
    if (!requestedTask) return;
    setTaskFilter(requestedTask.status === 'ADMINISTERED' ? 'COMPLETED' : 'PENDING');
    setTimeout(() => document.getElementById(`nurse-task-${requestedTaskId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  }, [requestedTaskId, activeTab, nurseTasks]);

  useEffect(() => {
    if (!requestedRequestId || activeTab !== 'REQUESTS' || patientRequests.length === 0) return;
    const requestedItem = patientRequests.find((item) => String(item._id) === String(requestedRequestId));
    if (!requestedItem) return;
    setTimeout(() => document.getElementById(`patient-request-${requestedRequestId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
  }, [requestedRequestId, activeTab, patientRequests]);

  useEffect(() => {
    if (!socket) return;
    let updateTimer = null;
    const handleUpdate = () => {
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = setTimeout(() => {
        fetchData();
      }, 250);
    };
    socket.on('admission:requisition_created', handleUpdate);
    socket.on('admission:confirmed', handleUpdate);
    socket.on('workflow:pending_changed', handleUpdate);
    socket.on('workflow:notification', handleUpdate);
    socket.on('workflow:new_nurse_tasks', handleUpdate);
    socket.on('nurse_task:created', handleUpdate);
    socket.on('nurse_task:updated', handleUpdate);
    socket.on('request:created', handleUpdate);
    socket.on('request:updated', handleUpdate);
    return () => {
      if (updateTimer) clearTimeout(updateTimer);
      socket.off('admission:requisition_created', handleUpdate);
      socket.off('admission:confirmed', handleUpdate);
      socket.off('workflow:pending_changed', handleUpdate);
      socket.off('workflow:notification', handleUpdate);
      socket.off('workflow:new_nurse_tasks', handleUpdate);
      socket.off('nurse_task:created', handleUpdate);
      socket.off('nurse_task:updated', handleUpdate);
      socket.off('request:created', handleUpdate);
      socket.off('request:updated', handleUpdate);
    };
  }, [socket]);

  const fetchData = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const [admRes, bedsRes, reqRes, tasksRes] = await Promise.all([
        axiosClient.get('/admissions'),
        axiosClient.get('/beds'),
        axiosClient.get('/requests'),
        axiosClient.get('/pharmacy/nurse-tasks'),
      ]);
      const rawAdm = Array.isArray(admRes) ? admRes : (admRes?.data?.data || admRes?.data || []);
      const rawBeds = Array.isArray(bedsRes) ? bedsRes : (bedsRes?.data?.data || bedsRes?.data || []);
      const rawReq = Array.isArray(reqRes) ? reqRes : (reqRes?.data?.data || reqRes?.data || []);
      const rawTasks = Array.isArray(tasksRes) ? tasksRes : (tasksRes?.data?.data || tasksRes?.data || []);

      setAdmissions(Array.isArray(rawAdm) ? rawAdm : []);
      setBeds(Array.isArray(rawBeds) ? rawBeds : []);
      setPatientRequests(Array.isArray(rawReq) ? rawReq : []);
      setNurseTasks(Array.isArray(rawTasks) ? rawTasks : []);
      fetchPendingWork();
    } catch (err) {
      console.error('Failed to fetch nurse dashboard data:', err);
      setLoadError(err.error?.message || err.message || 'Nursing and IPD data could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenAllocateModal = (adm) => {
    setSelectedAdmissionForModal(adm);
    setIsAllocateModalOpen(true);
  };

  const handleDischargePatient = async (admissionId) => {
    if (!window.confirm('Are you sure you want to discharge this inpatient and liberate the bed to AVAILABLE status?')) return;
    setIsDischargingId(admissionId);
    try {
      await axiosClient.patch(`/admissions/${admissionId}/discharge`);
      fetchData();
      fetchPendingWork();
    } catch (err) {
      console.error('Failed to discharge patient:', err);
    } finally {
      setIsDischargingId(null);
    }
  };

  // Metrics
  const {
    pendingRequisitions,
    admittedInpatients,
    occupiedBedsCount,
    availableBedsCount,
    pendingPatientRequests,
    pendingNurseTasks,
    completedNurseTasks,
  } = useMemo(() => {
    const pReq = [];
    const admIn = [];
    admissions.forEach((a) => {
      if (a.status === 'REQUISITION_RAISED' || a.status === 'ADMISSION_REQUESTED') {
        pReq.push(a);
      } else if (a.status === 'ADMITTED') {
        admIn.push(a);
      }
    });

    let occBeds = 0;
    let availBeds = 0;
    beds.forEach((b) => {
      if (b.status === 'OCCUPIED') occBeds++;
      else if (b.status === 'AVAILABLE') availBeds++;
    });

    const pRequests = patientRequests.filter((r) => r.status !== 'COMPLETED');
    const pTasks = [];
    const cTasks = [];
    nurseTasks.forEach((t) => {
      if (t.status === 'ADMINISTERED') {
        cTasks.push(t);
      } else {
        pTasks.push(t);
      }
    });

    return {
      pendingRequisitions: pReq,
      admittedInpatients: admIn,
      occupiedBedsCount: occBeds,
      availableBedsCount: availBeds,
      pendingPatientRequests: pRequests,
      pendingNurseTasks: pTasks,
      completedNurseTasks: cTasks,
    };
  }, [admissions, beds, patientRequests, nurseTasks]);

  // Filtered lists
  const filteredRequisitions = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    if (!search) return pendingRequisitions;
    return pendingRequisitions.filter((a) => {
      const patient = a.patientId || {};
      return [
        a.patientName, a.uhid, a.bedNumber, a.targetWardName, a.doctorName,
        patient.phone, patient.email, patient.bloodGroup, patient.category,
      ].some((value) => String(value || '').toLowerCase().includes(search));
    });
  }, [pendingRequisitions, searchTerm]);

  const filteredAdmitted = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    if (!search) return admittedInpatients;
    return admittedInpatients.filter((a) => {
      const patient = a.patientId || {};
      return [
        a.patientName, a.uhid, a.bedNumber, a.targetWardName, a.doctorName,
        patient.phone, patient.email, patient.bloodGroup, patient.category,
      ].some((value) => String(value || '').toLowerCase().includes(search));
    });
  }, [admittedInpatients, searchTerm]);

  const displayedTasks = useMemo(() => {
    return nurseTasks.filter((t) => {
      if (taskFilter === 'PENDING') return t.status !== 'ADMINISTERED';
      if (taskFilter === 'COMPLETED') return t.status === 'ADMINISTERED';
      return true;
    });
  }, [nurseTasks, taskFilter]);

  return (
    <div className="space-y-6 animate-fade-in">
      {loadError && (
        <div role="alert" className="p-3 rounded-xl border border-rose-300 bg-rose-50 text-rose-800 text-sm font-semibold flex items-center justify-between gap-3">
          <span>{loadError}</span>
          <Button size="sm" variant="outline" onClick={fetchData}>Retry</Button>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            Nurse In-Charge & IPD Ward Supervisor Console
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Real-time IPD Admissions Requisitions, Bed Allocation Locking & Inpatient Ward Occupancy Management
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1 font-bold shrink-0" onClick={fetchData}>
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} /> Refresh Data
        </Button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Pending IPD Requisitions" value={`${pendingRequisitions.length} Requisitions`} subtitle="Doctor Dispatched" icon={UserPlus} color="amber" />
        <StatCard title="Currently Admitted Inpatients" value={`${admittedInpatients.length} Inpatients`} subtitle="Occupying Wards" icon={UserCheck} color="indigo" />
        <StatCard title="Ward Beds Available" value={`${availableBedsCount} Beds`} subtitle="Unassigned & Clean" icon={CheckCircle2} color="emerald" />
        <StatCard title="Total Occupied Beds" value={`${occupiedBedsCount} Beds`} subtitle="Occupancy Locked" icon={BedDouble} color="sky" />
      </div>

      {/* Active Workstation View Bar & Search Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-2">
          {activeTab === 'REQUISITIONS' && (
            <div className="flex items-center gap-2 text-amber-900 bg-amber-50 px-3 py-1.5 rounded-xl border border-amber-200">
              <BedDouble size={16} className="text-amber-600" />
              <span className="text-xs font-black uppercase tracking-wider">IPD Requisitions</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-amber-600 text-white">
                {pendingRequisitions.length}
              </span>
            </div>
          )}
          {activeTab === 'ADMITTED' && (
            <div className="flex items-center gap-2 text-indigo-900 bg-indigo-50 px-3 py-1.5 rounded-xl border border-indigo-200">
              <UserCheck size={16} className="text-indigo-600" />
              <span className="text-xs font-black uppercase tracking-wider">Admitted Inpatients</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-indigo-600 text-white">
                {admittedInpatients.length}
              </span>
            </div>
          )}
          {activeTab === 'BEDS' && (
            <div className="flex items-center gap-2 text-emerald-900 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200">
              <LayoutGrid size={16} className="text-emerald-600" />
              <span className="text-xs font-black uppercase tracking-wider">Ward Bed Matrix</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-emerald-600 text-white">
                {beds.length}
              </span>
            </div>
          )}
          {activeTab === 'REQUESTS' && (
            <div className="flex items-center gap-2 text-rose-900 bg-rose-50 px-3 py-1.5 rounded-xl border border-rose-200">
              <Activity size={16} className="text-rose-600" />
              <span className="text-xs font-black uppercase tracking-wider">Patient Requests</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-rose-600 text-white">
                {pendingPatientRequests.length}
              </span>
            </div>
          )}
          {activeTab === 'TASKS' && (
            <div className="flex items-center gap-2 text-sky-900 bg-sky-50 px-3 py-1.5 rounded-xl border border-sky-200">
              <Stethoscope size={16} className="text-sky-600" />
              <span className="text-xs font-black uppercase tracking-wider">Medication & Tasks</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-sky-600 text-white">
                {pendingNurseTasks.length}
              </span>
            </div>
          )}
        </div>

        {/* Search Bar */}
        <div className="relative max-w-xs w-full">
          <input
            type="text"
            placeholder="Search patient, UHID, ward, bed..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full glass-input rounded-xl py-2 text-xs pl-8 pr-3 text-slate-900"
          />
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
        </div>
      </div>

      {/* TAB 1: IPD REQUISITIONS */}
      {activeTab === 'REQUISITIONS' && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <BedDouble size={18} className="text-amber-600" />
                IPD Inpatient Requisitions & Bed Allocations ({filteredRequisitions.length})
              </h3>
              <p className="text-xs text-slate-500">
                Every doctor-recommended IPD patient awaiting care-team and bed assignment.
              </p>
            </div>
          </div>

          <div className="space-y-3 text-xs">
            {filteredRequisitions.length > 0 ? (
              filteredRequisitions.map((adm) => {
                const patient = adm.patientId || {};
                return (
                  <div
                    key={adm._id}
                    className="p-4 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-amber-50/50 border-amber-200 shadow-2xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-amber-600 text-white"
                        >
                          ADMISSION REQUISITION
                        </span>
                        <span className="font-mono font-bold text-indigo-700 text-xs">{adm.uhid}</span>
                      </div>
                      <p className="font-extrabold text-slate-900 text-sm">{adm.patientName}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
                        <span>Age/Gender: <strong className="text-slate-900">{patient.age || 'N/A'} / {patient.gender || 'N/A'}</strong></span>
                        <span>Blood Group: <strong className="text-rose-700">{patient.bloodGroup || 'N/A'}</strong></span>
                        <span>Phone: <strong className="text-slate-900">{patient.phone || 'N/A'}</strong></span>
                        <span>Category: <strong className="text-slate-900">{patient.category || 'GENERAL'}</strong></span>
                      </div>
                      {(patient.allergies?.length > 0 || patient.chiefComplaints) && (
                        <p className="text-[11px] text-rose-700">
                          Clinical alerts: <strong>{patient.allergies?.length ? `Allergies: ${patient.allergies.join(', ')}` : patient.chiefComplaints}</strong>
                        </p>
                      )}
                      <p className="text-slate-600 text-[11px]">
                        Target Ward: <span className="text-slate-900 font-bold">{adm.targetWardName} ({adm.wardType})</span>
                        {' • '}
                        Tariff: <span className="font-mono font-bold text-slate-900">{formatCurrency(adm.dailyTariff)}/day</span>
                      </p>
                      <p className="text-slate-500 italic text-[11px]">
                        <Stethoscope size={11} className="inline mr-1 text-indigo-500" />
                        "{adm.admissionReason || 'Inpatient care observation'}" • Requisition by <strong className="text-slate-700">{adm.doctorName}</strong>
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="success"
                        className="font-bold shadow-2xs gap-1.5"
                        onClick={() => handleOpenAllocateModal(adm)}
                      >
                        <BedDouble size={16} /> Assign Team & Allocate Bed
                      </Button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-8 text-center text-slate-500 text-xs">
                No IPD admission requisitions matching your filter.
              </div>
            )}
          </div>
        </Card>
      )}

      {/* TAB 2: ADMITTED INPATIENTS DIRECTORY */}
      {activeTab === 'ADMITTED' && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <UserCheck size={18} className="text-indigo-600" />
                Active Admitted Inpatients Directory ({filteredAdmitted.length})
              </h3>
              <p className="text-xs text-slate-500">
                List of all patients currently occupying IPD ward beds.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto overflow-y-auto max-h-[540px] rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100/95 backdrop-blur-xs text-slate-700 uppercase tracking-wider text-[10px] border-b border-slate-200 shadow-2xs font-bold">
                <tr>
                  <th className="p-3 bg-slate-100">UHID &amp; Patient Name</th>
                  <th className="p-3 bg-slate-100">Assigned Ward &amp; Bed #</th>
                  <th className="p-3 bg-slate-100">Assigned Care Team</th>
                  <th className="p-3 bg-slate-100">Admitted Date</th>
                  <th className="p-3 bg-slate-100 text-right">Daily Tariff</th>
                  <th className="p-3 bg-slate-100 text-center">Status</th>
                  <th className="p-3 bg-slate-100 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800">
                {filteredAdmitted.length > 0 ? (
                  filteredAdmitted.map((adm) => (
                    <tr key={adm._id} className="hover:bg-slate-50">
                      <td className="p-3">
                        <p className="font-extrabold text-slate-900 text-sm">{adm.patientName}</p>
                        <p className="font-mono text-indigo-700 font-bold text-[11px]">{adm.uhid}</p>
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded text-[11px] font-mono font-black bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {adm.bedNumber}
                        </span>
                        <p className="text-[11px] text-slate-600 mt-0.5 font-medium">{adm.targetWardName}</p>
                      </td>
                      <td className="p-3">
                        <p className="font-bold text-slate-900">Doctor: {adm.doctorId?.name || adm.doctorName}</p>
                        <p className="text-[10px] text-slate-600">Nurse: <strong>{adm.assignedNurseId?.name || adm.bedId?.assignedNurseId?.name || 'Not assigned'}</strong></p>
                        <p className="text-[10px] text-slate-600">Caretaker: <strong>{adm.assignedCaretakerId?.name || 'Not assigned'}</strong></p>
                      </td>
                      <td className="p-3 text-slate-600 font-medium">
                        {adm.admittedAt ? new Date(adm.admittedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Recently'}
                      </td>
                      <td className="p-3 text-right font-mono font-bold text-slate-900">
                        {formatCurrency(adm.dailyTariff)}/day
                      </td>
                      <td className="p-3 text-center">
                        <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          OCCUPIED & LOCKED
                        </span>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" className="font-bold text-xs" onClick={() => handleOpenAllocateModal(adm)}>
                            <UserCheck size={13} /> Edit Care Team
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="font-bold text-xs gap-1 text-rose-600 hover:bg-rose-50 hover:border-rose-300"
                            isLoading={isDischargingId === adm._id}
                            onClick={() => handleDischargePatient(adm._id)}
                          >
                            <LogOut size={13} /> Discharge & Free Bed
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500 text-xs">
                      No active admitted inpatients in ward beds.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* TAB 3: WARD BED MATRIX */}
      {activeTab === 'BEDS' && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <LayoutGrid size={18} className="text-emerald-600" />
                Hospital Ward & Live Bed Matrix ({beds.length} Total Beds)
              </h3>
              <p className="text-xs text-slate-500">
                Live bed occupancy status matrix across all hospital departments & inpatient wards.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {beds.length > 0 ? (
              beds.map((b) => {
                const isOccupied = b.status === 'OCCUPIED';
                const pat = b.currentPatientId;
                return (
                  <div
                    key={b._id}
                    className={`p-3.5 rounded-xl border text-xs space-y-2 transition-all ${
                      isOccupied
                        ? 'bg-rose-50/40 border-rose-200 shadow-2xs'
                        : 'bg-emerald-50/40 border-emerald-200 hover:border-emerald-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-black text-sm text-slate-900">{b.bedNumber}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[9px] font-black border ${
                          isOccupied
                            ? 'bg-rose-600 text-white border-rose-700'
                            : 'bg-emerald-600 text-white border-emerald-700'
                        }`}
                      >
                        {isOccupied ? 'OCCUPIED' : 'AVAILABLE'}
                      </span>
                    </div>

                    <div>
                      <p className="font-bold text-slate-800 text-[11px]">{b.wardName}</p>
                      <p className="text-slate-500 text-[10px]">{b.wardType} • ₹{b.dailyTariff}/day</p>
                    </div>

                    {isOccupied && (
                      <div className="p-2 rounded-lg bg-white border border-rose-200 text-[11px] space-y-0.5">
                        <p className="text-slate-500 text-[10px] uppercase font-bold">Occupying Patient:</p>
                        <p className="font-extrabold text-slate-900">
                          {pat ? `${pat.firstName || ''} ${pat.lastName || ''}` : 'Admitted Inpatient'}
                        </p>
                        {pat?.uhid && <p className="font-mono text-indigo-700 text-[10px]">{pat.uhid}</p>}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="col-span-full p-8 text-center text-slate-500 text-xs">
                Loading hospital bed matrix...
              </div>
            )}
          </div>
        </Card>
      )}

      {/* TAB 4: IN-BED PATIENT REQUESTS */}
      {activeTab === 'REQUESTS' && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Activity size={18} className="text-purple-600" />
                In-Bed Patient Requests ({patientRequests.length})
              </h3>
              <p className="text-xs text-slate-500">
                Real-time bedside care requests from admitted patients and guardians.
              </p>
            </div>
          </div>

          <div className="space-y-3 text-xs">
            {patientRequests.length > 0 ? (
              patientRequests.map((req) => (
                <div
                  id={`patient-request-${req._id}`}
                  key={req._id}
                  className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${String(req._id) === String(requestedRequestId) ? 'border-purple-500 bg-purple-100 ring-2 ring-purple-200' : 'border-slate-200 bg-purple-50/30'}`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-slate-900 text-sm">{req.requestType || 'Care Request'}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${req.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                        {req.status}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">Category: {req.requestCategory || 'NURSE'}</span>
                    </div>
                    <p className="text-slate-700">
                      Patient: <strong>{req.patientId?.firstName} {req.patientId?.lastName}</strong> (UHID: {req.patientId?.uhid || 'N/A'})
                    </p>
                    <p className="text-slate-500">{req.notes || req.description || 'No additional instructions'}</p>
                  </div>

                  {req.status !== 'COMPLETED' && (
                    <Button
                      size="sm"
                      variant="success"
                      onClick={async () => {
                        try {
                          await axiosClient.patch(`/requests/${req._id}/status`, { status: 'COMPLETED' });
                          // Update local state: mark this request as COMPLETED
                          setPatientRequests((prev) =>
                            prev.map((r) => r._id === req._id ? { ...r, status: 'COMPLETED' } : r)
                          );
                          // Sync server-side pending work count (sidebar badge + bell count)
                          fetchPendingWork();
                        } catch (e) {
                          console.error('Failed to resolve request:', e);
                          fetchData();
                        }
                      }}
                    >
                      Mark Resolved
                    </Button>
                  )}
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-slate-400">No active in-bed patient requests found.</div>
            )}
          </div>
        </Card>
      )}

      {/* TAB 5: TREATMENT TASKS */}
      {activeTab === 'TASKS' && (
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Stethoscope size={18} className="text-rose-600" />
                Doctor-Prescribed Treatment Tasks ({pendingNurseTasks.length} Pending)
              </h3>
              <p className="text-xs text-slate-500">
                Active medication administration and injection schedules across wards.
              </p>
            </div>

            {/* Sub-Filter: Pending vs Done vs All */}
            <div className="flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs">
              <button
                type="button"
                onClick={() => setTaskFilter('PENDING')}
                className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all ${
                  taskFilter === 'PENDING' ? 'bg-rose-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Pending Tasks ({pendingNurseTasks.length})
              </button>
              <button
                type="button"
                onClick={() => setTaskFilter('COMPLETED')}
                className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all ${
                  taskFilter === 'COMPLETED' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Administered ({completedNurseTasks.length})
              </button>
              <button
                type="button"
                onClick={() => setTaskFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-all ${
                  taskFilter === 'ALL' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({nurseTasks.length})
              </button>
            </div>
          </div>

          <div className="space-y-3 text-xs">
            {displayedTasks.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                {taskFilter === 'PENDING'
                  ? 'No pending treatment tasks. All prescribed medications and injections have been administered!'
                  : 'No records found for this filter.'}
              </div>
            ) : (
              displayedTasks.map((t) => (
                <div
                  key={t._id}
                  id={`nurse-task-${t._id}`}
                  data-testid={`nurse-task-${t._id}`}
                  className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all ${
                    String(t._id) === String(requestedTaskId)
                      ? 'bg-amber-100 border-amber-400 ring-2 ring-amber-400'
                      : t.status === 'ADMINISTERED'
                      ? 'bg-slate-50/50 border-slate-200'
                      : 'bg-rose-50/25 border-rose-200 shadow-2xs'
                  }`}
                >
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-extrabold text-slate-900 text-sm">{t.medicineName} ({t.dose})</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 uppercase">
                        {t.taskType || 'INJECTION'}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-800">
                        Route: {t.route}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          t.status === 'ADMINISTERED' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800 animate-pulse'
                        }`}
                      >
                        {t.status}
                      </span>
                    </div>

                    <p className="text-slate-800 text-xs">
                      Patient: <strong className="text-indigo-900">{t.patientId?.firstName} {t.patientId?.lastName}</strong> (UHID: <span className="font-mono font-bold text-slate-700">{t.patientId?.uhid || 'N/A'}</span>)
                    </p>

                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
                      <span><Stethoscope size={12} className="inline mr-1 text-indigo-600" /> Prescribed by: <strong className="text-slate-900">Dr. {t.doctorName || t.doctorId?.name || 'Consultant'}</strong> ({t.doctorDepartment || 'OPD Desk'})</span>
                      <span>Order Time: <strong className="text-slate-800">{new Date(t.createdAt).toLocaleTimeString()}</strong></span>
                      <span>Assigned Nurse: <strong className="text-slate-800">{t.assignedNurseName || t.assignedNurseId?.name || 'Duty Nurse / Station'}</strong></span>
                    </div>

                    <p className="text-[11px] text-slate-600 italic bg-white/80 p-1.5 rounded-lg border border-slate-200/80">
                      Doctor's Instructions: <strong className="text-slate-800 not-italic">"{t.doctorInstructions || 'Administer as scheduled'}"</strong>
                    </p>

                    {t.status === 'ADMINISTERED' && (
                      <div className="mt-2 p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-900 flex flex-wrap items-center justify-between gap-2">
                        <span>
                          <CheckCircle2 size={13} className="inline mr-1 text-emerald-600" />
                          Administered by <strong className="font-extrabold">{t.administrationDetails?.nurseName || 'Duty Nurse'}</strong> at <strong className="font-mono">{new Date(t.administrationDetails?.administeredAt || t.updatedAt).toLocaleTimeString()}</strong>
                        </span>
                        <span className="px-2 py-0.5 rounded bg-emerald-200/60 font-bold text-[10px]">
                          ✓ Doctor Notified & Bill Logged
                        </span>
                      </div>
                    )}
                  </div>

                  {t.status !== 'ADMINISTERED' ? (
                    <Button
                      size="sm"
                      variant="success"
                      onClick={async () => {
                        try {
                          await axiosClient.patch(`/pharmacy/nurse-tasks/${t._id}/status`, {
                            status: 'ADMINISTERED',
                            notes: 'Administered by duty nurse',
                          });
                          fetchData();
                          fetchPendingWork();
                        } catch (e) {
                          console.error('Failed to update task:', e);
                        }
                      }}
                      className="gap-1.5 shadow-sm font-bold shrink-0"
                    >
                      <CheckCircle2 size={13} /> Mark Administered
                    </Button>
                  ) : (
                    <div className="shrink-0 flex items-center gap-1.5">
                      <span className="px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-800 font-extrabold text-xs flex items-center gap-1">
                        <CheckCircle2 size={14} className="text-emerald-600" /> Completed
                      </span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>
      )}

      {/* Allocate Bed Modal */}
      {selectedAdmissionForModal && (
        <AllocateBedModal
          isOpen={isAllocateModalOpen}
          onClose={() => {
            setIsAllocateModalOpen(false);
            setSelectedAdmissionForModal(null);
          }}
          admission={selectedAdmissionForModal}
          onSuccess={() => {
            fetchData();
          }}
        />
      )}
    </div>
  );
};

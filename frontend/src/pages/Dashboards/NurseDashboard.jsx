import React, { useState, useEffect, useMemo } from 'react';
import { StatCard } from '../../components/ui/StatCard';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { AvailabilityBanner } from '../../components/ui/AvailabilityBanner';
import { useAvailability } from '../../hooks/useAvailability';
import { useScrollLock } from '../../hooks/useScrollLock';
import { HeartPulse, Bed, Bell, AlertOctagon, CheckCircle2, Syringe, Activity, ArrowUpRight, X } from 'lucide-react';
import { useSocket } from '../../providers/SocketProvider';
import { useAuthStore } from '../../store/authStore';
import { axiosClient } from '../../api/axiosClient';

export const NurseDashboard = () => {
  const { socket } = useSocket();
  const { user } = useAuthStore();
  const { isAvailable, isToggling, handleToggle, statusMessage } = useAvailability();
  const [requests, setRequests] = useState([]);
  const [nurseTasks, setNurseTasks] = useState([]);
  const [beds, setBeds] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [selectedTask, setSelectedTask] = useState(null);

  useScrollLock(!!selectedTask);

  // Administer Modal State
  const [adminForm, setAdminForm] = useState({
    administeredQty: 1,
    batchNumber: 'BATCH-2026-01',
    siteOrRoute: 'Left Arm IV',
    patientReaction: 'NORMAL',
    notes: 'Administered without distress',
    reasonIfSkippedOrRefused: '',
  });

  useEffect(() => {
    fetchRequests();
    fetchNurseTasks();
    fetchBeds();
  }, [filterCategory]);

  useEffect(() => {
    if (!socket) return;
    let refreshTimer = null;
    const refresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        fetchRequests();
        fetchNurseTasks();
      }, 250);
    };
    socket.on('workflow:notification', refresh);
    socket.on('workflow:pending_changed', refresh);
    socket.on('workflow:new_nurse_tasks', refresh);
    socket.on('nurse_task:created', refresh);
    socket.on('nurse_task:updated', refresh);
    socket.on('request:created', refresh);
    socket.on('request:updated', refresh);
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      socket.off('workflow:notification', refresh);
      socket.off('workflow:pending_changed', refresh);
      socket.off('workflow:new_nurse_tasks', refresh);
      socket.off('nurse_task:created', refresh);
      socket.off('nurse_task:updated', refresh);
      socket.off('request:created', refresh);
      socket.off('request:updated', refresh);
    };
  }, [socket]);

  const fetchRequests = async () => {
    try {
      const url = filterCategory !== 'ALL' ? `/requests?category=${filterCategory}` : '/requests';
      const res = await axiosClient.get(url);
      setRequests(res.data?.data || res.data || []);
    } catch (err) {
      console.error('Failed to load requests:', err);
    }
  };

  const fetchNurseTasks = async () => {
    try {
      const res = await axiosClient.get('/pharmacy/nurse-tasks');
      setNurseTasks(res.data || []);
    } catch (err) {
      console.error('Failed to load nurse tasks:', err);
    }
  };

  const fetchBeds = async () => {
    try {
      const res = await axiosClient.get('/beds');
      setBeds(res.data?.data || res.data || []);
    } catch (err) {
      console.error('Failed to load beds:', err);
    }
  };

  const handleUpdateTaskStatus = async (taskId, newStatus) => {
    try {
      await axiosClient.patch(`/pharmacy/nurse-tasks/${taskId}/status`, {
        status: newStatus,
        ...adminForm,
        administeredQty: Math.max(1, parseInt(adminForm.administeredQty, 10) || 1),
      });
      setSelectedTask(null);
      fetchNurseTasks();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update task status');
    }
  };

  const { pendingTasks, completedTasks, occupiedBedsCount, pendingRequestsCount } = useMemo(() => {
    const pending = [];
    const completed = [];
    nurseTasks.forEach((t) => {
      if (['PENDING', 'ACCEPTED', 'SCHEDULED'].includes(t.status)) {
        pending.push(t);
      } else if (t.status === 'ADMINISTERED') {
        completed.push(t);
      }
    });

    let occupiedBeds = 0;
    beds.forEach((b) => {
      if (b.status === 'OCCUPIED') occupiedBeds++;
    });

    let pendingReqs = 0;
    requests.forEach((r) => {
      if (r.status !== 'COMPLETED') pendingReqs++;
    });

    return {
      pendingTasks: pending,
      completedTasks: completed,
      occupiedBedsCount: occupiedBeds,
      pendingRequestsCount: pendingReqs,
    };
  }, [nurseTasks, beds, requests]);

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Ward Nursing Station & Treatment Monitor</h2>
          <p className="text-xs text-slate-500 mt-0.5">Medication Administration, Injection Schedules & Care Requests</p>
        </div>
      </div>

      <AvailabilityBanner
        role="Nurse"
        isAvailable={isAvailable}
        isToggling={isToggling}
        onToggle={handleToggle}
        pendingCount={pendingTasks.length + pendingRequestsCount}
      />

      {statusMessage && (
        <div className={`p-3 rounded-xl border text-xs font-bold ${statusMessage.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
          {statusMessage.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Ward Beds Occupied" value={`${occupiedBedsCount} Beds`} subtitle="Inpatient Ward Beds" icon={Bed} color="sky" />
        <StatCard title="Pending Nurse Treatments" value={`${pendingTasks.length} Tasks`} subtitle="Injections, IV Fluids & Dressings" icon={Syringe} color="indigo" />
        <StatCard title="Completed Today" value={`${completedTasks.length} Administered`} subtitle="Doses Logged" icon={CheckCircle2} color="emerald" />
        <StatCard title="In-Progress Patient Calls" value={`${pendingRequestsCount} Calls`} subtitle="Bedside Requests" icon={Bell} color="amber" />
      </div>

      {/* SECTION 1: Doctor-Prescribed Nurse Medication & Treatment Tasks */}
      <Card>
        <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Syringe size={18} className="text-indigo-600" />
            Doctor-Prescribed Injection & Bedside Treatment Tasks Queue
          </span>
          <span className="text-xs text-slate-500 font-mono">Stock Auto-Deduction & Billing Active</span>
        </h3>

        <div className="space-y-3 text-xs">
          {pendingTasks.length > 0 ? (
            pendingTasks.map((task) => (
              <div key={task._id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-slate-900 text-sm">{task.medicineName} ({task.dose})</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                      {task.taskType}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-800">
                      Route: {task.route}
                    </span>
                  </div>
                  <p className="text-slate-700">
                    Patient: <strong>{task.patientId?.firstName} {task.patientId?.lastName}</strong> (UHID: {task.patientId?.uhid || 'N/A'}) · Bed: {task.patientId?.bedNo || 'Ward Bed'}
                  </p>
                  <p className="text-slate-500">Dr. {task.doctorId?.name} · Instructions: {task.doctorInstructions || 'Administer as scheduled'}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="success"
                    size="sm"
                    onClick={() => {
                      setSelectedTask(task);
                      setAdminForm({
                        administeredQty: 1,
                        batchNumber: 'BATCH-2026-01',
                        siteOrRoute: task.route || 'IV',
                        patientReaction: 'NORMAL',
                        notes: 'Administered as prescribed',
                        reasonIfSkippedOrRefused: '',
                      });
                    }}
                  >
                    <CheckCircle2 size={14} className="mr-1" /> Record Administration
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="p-8 text-center text-slate-400">No pending nurse administration tasks.</div>
          )}
        </div>
      </Card>

      {/* MODAL: RECORD ADMINISTRATION */}
      {selectedTask && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-lg font-bold text-slate-900">Record Nurse Administration</h3>
              <button
                type="button"
                onClick={() => setSelectedTask(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="text-xs space-y-1 bg-slate-50 p-3 rounded border">
              <p className="font-bold text-indigo-700">{selectedTask.medicineName} ({selectedTask.dose})</p>
              <p className="text-slate-700">Patient: {selectedTask.patientId?.firstName} {selectedTask.patientId?.lastName}</p>
              <p className="text-slate-500">Route: {selectedTask.route} · Prescribed by Dr. {selectedTask.doctorId?.name}</p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700">Batch Number Used</label>
                <input
                  type="text"
                  value={adminForm.batchNumber}
                  onChange={(e) => setAdminForm({ ...adminForm, batchNumber: e.target.value })}
                  className="w-full p-2 border rounded mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700">Administered Qty</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="1"
                    value={adminForm.administeredQty ?? ''}
                    onChange={(e) => setAdminForm({ ...adminForm, administeredQty: e.target.value })}
                    className="w-full p-2 border rounded mt-1"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700">Site / Route</label>
                  <input
                    type="text"
                    value={adminForm.siteOrRoute}
                    onChange={(e) => setAdminForm({ ...adminForm, siteOrRoute: e.target.value })}
                    className="w-full p-2 border rounded mt-1"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700">Patient Reaction</label>
                <select
                  value={adminForm.patientReaction}
                  onChange={(e) => setAdminForm({ ...adminForm, patientReaction: e.target.value })}
                  className="w-full p-2 border rounded mt-1"
                >
                  <option value="NORMAL">Normal (No adverse reaction)</option>
                  <option value="MILD_ALLERGY">Mild Rash / Redness</option>
                  <option value="SEVERE_REACTION">Severe Adverse Reaction</option>
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700">Nurse Notes</label>
                <textarea
                  rows="2"
                  value={adminForm.notes}
                  onChange={(e) => setAdminForm({ ...adminForm, notes: e.target.value })}
                  className="w-full p-2 border rounded mt-1"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button type="button" variant="ghost" onClick={() => setSelectedTask(null)}>Cancel</Button>
                <Button type="button" variant="success" onClick={() => handleUpdateTaskStatus(selectedTask._id, 'ADMINISTERED')}>
                  Confirm & Deduct Stock
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NurseDashboard;

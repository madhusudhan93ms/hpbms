import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { StatCard } from '../../components/ui/StatCard';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { AvailabilityBanner } from '../../components/ui/AvailabilityBanner';
import { useAvailability } from '../../hooks/useAvailability';
import { axiosClient } from '../../api/axiosClient';
import { useAuthStore } from '../../store/authStore';
import { useSocket } from '../../providers/SocketProvider';
import { useDepartmentNotificationStore } from '../../store/departmentNotificationStore';
import { TestTube, QrCode, FileCheck, CheckCircle2, FlaskConical, AlertCircle, Upload, Check, Printer, FileSpreadsheet } from 'lucide-react';

export const LabTechDashboard = () => {
  const { user } = useAuthStore();
  const { socket } = useSocket();
  const { isAvailable, isToggling, handleToggle, statusMessage } = useAvailability();
  const resolvePending = useDepartmentNotificationStore((state) => state.resolvePending);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const tabParam = location.state?.tab || searchParams.get('tab');
  const requestedOrderId = location.state?.orderId || searchParams.get('orderId');

  const [activeTab, setActiveTab] = useState(tabParam || 'ACTIVE');
  const [orders, setOrders] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [reportSummary, setReportSummary] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (tabParam) {
      setActiveTab(tabParam.toUpperCase());
    } else {
      setActiveTab('ACTIVE');
    }
  }, [tabParam, location.search, location.state]);

  useEffect(() => {
    fetchOrders();
  }, [requestedOrderId]);

  useEffect(() => {
    if (!socket) return;
    let refreshTimer = null;
    const handleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        fetchOrders();
      }, 250);
    };

    socket.on('investigation:new_request', handleRefresh);
    socket.on('investigation:status_updated', handleRefresh);
    socket.on('workflow:notification', handleRefresh);
    socket.on('workflow:pending_changed', handleRefresh);

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      socket.off('investigation:new_request', handleRefresh);
      socket.off('investigation:status_updated', handleRefresh);
      socket.off('workflow:notification', handleRefresh);
      socket.off('workflow:pending_changed', handleRefresh);
    };
  }, [socket]);

  const fetchOrders = async () => {
    try {
      const res = await axiosClient.get('/diagnostics/orders?testCategory=PATHOLOGY');
      const list = res.data || [];
      setOrders(list);
      if (list.length > 0) {
        setSelectedOrder((prev) => (
          list.find((o) => o._id === requestedOrderId) ||
          (prev ? list.find((o) => o._id === prev._id) : null) ||
          list[0]
        ));
      } else {
        setSelectedOrder(null);
      }
    } catch (err) {
      console.error('Failed to load pathology orders:', err);
    }
  };

  const handleResolveBillingQuery = async () => {
    if (!selectedOrder?.billingQuery || selectedOrder.billingQuery.resolved) return;
    setIsLoading(true);
    try {
      await axiosClient.patch(`/diagnostics/orders/${selectedOrder._id}/charge`, {
        price: Number(selectedOrder.price) || 0,
        additionalCharges: selectedOrder.additionalCharges || [],
      });
      await fetchOrders();
    } catch (err) {
      console.error('Failed to resubmit corrected laboratory charge:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateStatus = async (orderId, newStatus) => {
    try {
      await axiosClient.patch(`/diagnostics/orders/${orderId}/status`, {
        status: newStatus,
        notes: `Department updated status to ${newStatus}`,
      });
      if (['ACCEPTED', 'IN_PROGRESS'].includes(newStatus)) setActiveTab('PROGRESS');
      fetchOrders();
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  const handlePublishReport = async (e) => {
    e.preventDefault();
    if (!selectedOrder) return;
    setIsLoading(true);
    try {
      await axiosClient.post(`/diagnostics/orders/${selectedOrder._id}/report`, {
        reportSummary: reportSummary || 'Pathology analysis completed within physiological parameters.',
        price: selectedOrder.price === '' || selectedOrder.price === undefined || selectedOrder.price === null ? 120 : Number(selectedOrder.price),
        attachments: [
          {
            fileName: `${selectedOrder.testName}_Report_${selectedOrder.uhid}.pdf`,
            fileUrl: 'https://images.unsplash.com/photo-1516549655169-df83a0774514?auto=format&fit=crop&w=800&q=80',
            fileType: 'PATHOLOGY_PDF',
          },
        ],
      });

      resolvePending(selectedOrder._id);

      setReportSummary('');
      fetchOrders();
    } catch (err) {
      console.error('Failed to publish report:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const {
    incomingOrders,
    progressOrders,
    activeOrders,
    completedOrders,
    pendingCount,
    inProgressCount,
    emergencyCount,
  } = useMemo(() => {
    const incoming = [];
    const progress = [];
    const completed = [];
    let pCount = 0;
    let ipCount = 0;
    let emCount = 0;

    orders.forEach((o) => {
      if (o.status === 'REQUESTED' || o.status === 'DEPARTMENT_RECEIVED') {
        incoming.push(o);
      }
      if (o.status === 'ACCEPTED' || o.status === 'IN_PROGRESS') {
        progress.push(o);
      }
      if (o.status === 'COMPLETED' || o.status === 'REPORT_UPLOADED' || o.status === 'REVIEWED') {
        completed.push(o);
      }
      if (o.status === 'REQUESTED') {
        pCount++;
      }
      if (o.status === 'IN_PROGRESS' || o.status === 'ACCEPTED') {
        ipCount++;
      }
      if (o.priority === 'EMERGENCY') {
        emCount++;
      }
    });

    return {
      incomingOrders: incoming,
      progressOrders: progress,
      activeOrders: [...incoming, ...progress],
      completedOrders: completed,
      pendingCount: pCount,
      inProgressCount: ipCount,
      emergencyCount: emCount,
    };
  }, [orders]);

  const currentQueue = useMemo(() => {
    return (activeTab === 'COMPLETED' || activeTab === 'REPORTS')
      ? completedOrders
      : activeTab === 'PROGRESS'
        ? progressOrders
        : incomingOrders;
  }, [activeTab, incomingOrders, progressOrders, completedOrders]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
          {activeTab === 'SAMPLES' && 'Sample Intake & Barcode Scanning Workbench'}
          {activeTab === 'RESULTS' && 'Pathology Analyzer & Result Entry Workbench'}
          {(activeTab === 'REPORTS' || activeTab === 'COMPLETED') && 'Pathology Report Verification & Sign-Off'}
          {(activeTab === 'ACTIVE' || activeTab === 'OVERVIEW') && 'Pathology Laboratory & LIS Workstation'}
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          {user?.name || 'Lab Technologist'} — Auto-Dispatched Pathology Queue & Laboratory Information System
        </p>
      </div>

      <AvailabilityBanner
        role="Laboratory Technologist"
        isAvailable={isAvailable}
        isToggling={isToggling}
        onToggle={handleToggle}
        pendingCount={pendingCount + inProgressCount}
      />

      {statusMessage && (
        <div className={`p-3 rounded-xl border text-xs font-bold ${statusMessage.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
          {statusMessage.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Active Pathology Requests" value={`${activeOrders.length} Active`} subtitle="Auto-Dispatched by Doctors" icon={TestTube} color="amber" />
        <StatCard title="In Progress" value={`${inProgressCount} Processing`} subtitle="Analyzer Processing" icon={FlaskConical} color="purple" />
        <StatCard title="Emergency Requests" value={`${emergencyCount} STAT`} subtitle="Priority 1 Diagnostics" icon={AlertCircle} color="red" />
        <StatCard title="Completed Reports" value={`${completedOrders.length} Verified`} subtitle="Sent to Doctor & Portal" icon={FileCheck} color="emerald" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Department Order Queue with Active / In-Progress / Completed Tabs */}
        <Card className="lg:col-span-1 flex flex-col">
          {/* Header with Title and LIS Live status */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100">
                <FlaskConical size={16} />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-900 leading-none">Order Queue</h3>
                <p className="text-[11px] text-slate-400 font-semibold mt-0.5">Pathology Requests</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] bg-emerald-50 text-emerald-700 font-extrabold border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> LIS LIVE
            </span>
          </div>

          {/* Clean Segmented Tab Navigation with Counts */}
          <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-xl mb-3 border border-slate-200/60">
            <button
              type="button"
              onClick={() => setActiveTab('ACTIVE')}
              className={`flex flex-col items-center justify-center py-2 px-1 rounded-lg text-[11px] font-extrabold transition-all cursor-pointer ${
                activeTab === 'ACTIVE'
                  ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/80'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'
              }`}
            >
              <span className="truncate">Incoming</span>
              <span className={`inline-flex items-center justify-center px-2 py-0.5 mt-1 rounded-full text-[10px] font-black ${
                activeTab === 'ACTIVE' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-200 text-slate-600'
              }`}>
                {incomingOrders.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('PROGRESS')}
              className={`flex flex-col items-center justify-center py-2 px-1 rounded-lg text-[11px] font-extrabold transition-all cursor-pointer ${
                activeTab === 'PROGRESS'
                  ? 'bg-white text-violet-700 shadow-sm border border-slate-200/80'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'
              }`}
            >
              <span className="truncate">In Progress</span>
              <span className={`inline-flex items-center justify-center px-2 py-0.5 mt-1 rounded-full text-[10px] font-black ${
                activeTab === 'PROGRESS' ? 'bg-violet-100 text-violet-800' : 'bg-slate-200 text-slate-600'
              }`}>
                {progressOrders.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('COMPLETED')}
              className={`flex flex-col items-center justify-center py-2 px-1 rounded-lg text-[11px] font-extrabold transition-all cursor-pointer ${
                activeTab === 'COMPLETED'
                  ? 'bg-white text-emerald-700 shadow-sm border border-slate-200/80'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'
              }`}
            >
              <span className="truncate">Completed</span>
              <span className={`inline-flex items-center justify-center px-2 py-0.5 mt-1 rounded-full text-[10px] font-black ${
                activeTab === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
              }`}>
                {completedOrders.length}
              </span>
            </button>
          </div>

          <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1 flex-1">
            {currentQueue.length > 0 ? (
              currentQueue.map((ord) => (
                <div
                  key={ord._id}
                  onClick={() => setSelectedOrder(ord)}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    selectedOrder?._id === ord._id
                      ? 'bg-indigo-50/80 border-indigo-400 shadow-sm ring-1 ring-indigo-400'
                      : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/80'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold border ${
                      ord.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    }`}>
                      {ord.testName}
                    </span>
                    <span className={`px-2 py-0.5 rounded-md text-[9px] font-black border ${
                      ord.priority === 'EMERGENCY' ? 'bg-red-50 text-red-600 border-red-200 animate-pulse' : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}>
                      {ord.priority}
                    </span>
                  </div>
                  <p className="font-bold text-slate-900 text-sm mt-1.5">{ord.patientName} ({ord.patientAge})</p>
                  <p className="text-[11px] text-slate-500 font-medium">Prescribed by: <strong className="text-slate-800">Dr. {ord.doctorName || 'Doctor'}</strong></p>
                  <div className="flex justify-between items-center mt-1.5 text-xs">
                    <span className="text-indigo-700 font-mono font-bold text-[11px]">UHID: {ord.uhid}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black border ${
                      ord.status === 'COMPLETED' || ord.status === 'REPORT_UPLOADED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}>
                      {ord.status}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-slate-400 text-xs flex flex-col items-center justify-center">
                <FlaskConical size={24} className="text-slate-300 mb-2" />
                <p className="font-bold text-slate-600">No requests in queue</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {activeTab === 'ACTIVE' ? 'Incoming pathology requests will appear here.' : activeTab === 'PROGRESS' ? 'No orders currently being processed.' : 'No completed lab tests in history.'}
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* Action Workbench & Report Publishing */}
        <Card className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <FlaskConical size={18} className="text-indigo-500" />
              Pathology Result Entry & Verification Workbench
            </h3>
            {selectedOrder && (
              <div className="flex gap-2">
                {selectedOrder.status === 'REQUESTED' && (
                  <Button size="sm" variant="primary" className="bg-sky-600 hover:bg-sky-700 font-bold text-xs" onClick={() => handleUpdateStatus(selectedOrder._id, 'ACCEPTED')}>
                    <Check size={14} /> Accept Request & Notify Doctor
                  </Button>
                )}
                {selectedOrder.status === 'ACCEPTED' && (
                  <span className="px-3 py-1 rounded bg-sky-50 text-sky-700 border border-sky-200 font-bold text-xs flex items-center gap-1">
                    <FlaskConical size={14} /> ACCEPTED — PROCESSING TEST
                  </span>
                )}
                {selectedOrder.status === 'ACCEPTED' && (
                  <Button size="sm" variant="primary" className="bg-violet-600 hover:bg-violet-700 font-bold text-xs" onClick={() => handleUpdateStatus(selectedOrder._id, 'IN_PROGRESS')}>
                    <FlaskConical size={14} /> Start Processing
                  </Button>
                )}
                {['COMPLETED', 'REPORT_UPLOADED', 'REVIEWED'].includes(selectedOrder.status) && (
                  <span className="px-3 py-1 rounded bg-emerald-50 text-emerald-600 border border-emerald-200 font-bold text-xs flex items-center gap-1">
                    <CheckCircle2 size={14} /> REPORT SUBMITTED TO DOCTOR
                  </span>
                )}
              </div>
            )}
          </div>

          {selectedOrder ? (
            <div className="space-y-4 text-xs">
              {selectedOrder.billingQuery && !selectedOrder.billingQuery.resolved && (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 space-y-3" data-testid="billing-query-banner">
                  <div className="font-black flex items-center gap-2"><AlertCircle size={16} /> Billing correction required</div>
                  <p>Returned by {selectedOrder.billingQuery.requestedByName || 'Billing Desk'}: “{selectedOrder.billingQuery.query}”</p>
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                    <label className="flex-1 font-bold">Corrected charge (₹)
                      <input className="mt-1 w-full glass-input rounded-lg p-2" type="number" min="0" value={selectedOrder.price ?? ''} onChange={(event) => setSelectedOrder((current) => ({ ...current, price: event.target.value }))} />
                    </label>
                    <Button type="button" variant="primary" size="sm" isLoading={isLoading} onClick={handleResolveBillingQuery}>Resubmit to Billing</Button>
                  </div>
                </div>
              )}
              <div className="p-3 rounded-xl bg-white border border-slate-200 grid grid-cols-2 md:grid-cols-4 gap-2">
                <div>
                  <p className="text-slate-500">Patient Name:</p>
                  <p className="font-bold text-slate-900 text-sm">{selectedOrder.patientName}</p>
                </div>
                <div>
                  <p className="text-slate-500">UHID & OP/IP:</p>
                  <p className="font-mono text-indigo-700 font-bold">{selectedOrder.uhid} ({selectedOrder.opIpNumber || 'OP-101'})</p>
                </div>
                <div>
                  <p className="text-slate-500">Requesting Doctor:</p>
                  <p className="font-bold text-slate-900">{selectedOrder.doctorName}</p>
                </div>
                <div>
                  <p className="text-slate-500">Current Status:</p>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                    selectedOrder.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                  }`}>
                    {selectedOrder.status}
                  </span>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                <p className="font-bold text-indigo-600">Doctor Clinical Notes:</p>
                <p className="text-slate-600 italic">"{selectedOrder.clinicalNotes || 'No specific notes provided.'}"</p>
              </div>

              {['COMPLETED', 'REPORT_UPLOADED', 'REVIEWED'].includes(selectedOrder.status) ? (
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-emerald-600 text-sm flex items-center gap-1.5">
                      <CheckCircle2 size={16} /> Pathology Report Completed & Verified
                    </span>
                    <span className="text-[11px] text-slate-500">Verified by: {selectedOrder.technicianName || user?.name}</span>
                  </div>
                  <p className="text-slate-700 bg-white p-3 rounded-lg border border-slate-200">
                    "{selectedOrder.reportSummary}"
                  </p>
                </div>
              ) : (
                <form onSubmit={handlePublishReport} className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 rounded-lg bg-white border border-slate-200">
                    <div>
                      <label className="block text-slate-600 font-bold mb-1">Pathology Service Charge (₹):</label>
                      <input
                        type="text"
                        placeholder="Type cost (e.g. 120)"
                        className="w-full glass-input rounded-lg p-2 text-xs text-slate-900 font-mono font-bold"
                        value={selectedOrder.price === undefined || selectedOrder.price === null ? '' : selectedOrder.price}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSelectedOrder((prev) => ({ ...prev, price: val }));
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-slate-600 font-bold mb-1">Charge Status:</label>
                      <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-600 font-bold border border-emerald-200 text-[11px] block">
                        SUBMITTED TO DOCTOR FOR REVIEW
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-600 font-bold mb-1">Pathology Observed Values & Findings:</label>
                    <textarea
                      className="w-full glass-input rounded-lg p-2.5 text-xs text-slate-900"
                      rows={3}
                      placeholder="Enter automated analyzer findings and observed test values..."
                      value={reportSummary}
                      onChange={(e) => setReportSummary(e.target.value)}
                      required
                    ></textarea>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button type="submit" variant="success" size="sm" className="font-bold gap-1.5" isLoading={isLoading}>
                      <Upload size={14} /> Submit Report & Charges to Doctor
                    </Button>
                  </div>
                </form>
              )}
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500 text-sm">
              Select an investigation request from the queue to process findings.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

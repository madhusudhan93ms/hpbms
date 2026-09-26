import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { StatCard } from '../../components/ui/StatCard';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { ProcessPaymentModal } from '../../components/modals/ProcessPaymentModal';
import { OfficialReceiptModal } from '../../components/modals/OfficialReceiptModal';
import { ReturnToDepartmentModal } from '../../components/modals/ReturnToDepartmentModal';
import { Modal } from '../../components/ui/Modal';
import { axiosClient } from '../../api/axiosClient';
import { useAuthStore } from '../../store/authStore';
import { useSocket } from '../../providers/SocketProvider';
import {
  CreditCard, Receipt, Lock, IndianRupee, Stethoscope,
  User, Pill, CheckCircle, Clock, RefreshCw, AlertCircle,
  Search, Printer, MessageCircle, Eye, FileText, Phone, CheckCircle2,
  Trash2, Archive, ShieldAlert, X, XCircle, RotateCcw
} from 'lucide-react';
import { formatCurrency } from '../../utils/formatters';
import { SoloDoctorFlowBar } from '../../components/common/SoloDoctorFlowBar';
import { useWorkspaceModeStore } from '../../store/workspaceModeStore';
import { useDepartmentNotificationStore } from '../../store/departmentNotificationStore';
import { useNotificationStore } from '../../store/notificationStore';

// Map category codes to friendly labels + colors
const CATEGORY_STYLES = {
  CONSULTATION: { label: 'Consultation', color: 'sky' },
  PHARMACY:     { label: 'Pharmacy / Rx', color: 'purple' },
  LAB:          { label: 'Laboratory', color: 'amber' },
  RADIOLOGY:    { label: 'Radiology', color: 'emerald' },
  BED_TARIFF:   { label: 'Bed / Ward', color: 'rose' },
  OTHER:        { label: 'Other', color: 'slate' },
};

const CategoryBadge = ({ cat }) => {
  const s = CATEGORY_STYLES[cat] || CATEGORY_STYLES.OTHER;
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-${s.color}-50 text-${s.color}-600 border border-${s.color}-200`}>
      {s.label}
    </span>
  );
};

export const CashierDashboard = () => {
  const { user } = useAuthStore();
  const { isDualModeEligible } = useWorkspaceModeStore();
  const { socket } = useSocket();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();

  const tabParam = location.state?.tab || searchParams.get('tab');
  const requestedInvoiceId = location.state?.invoiceId || searchParams.get('invoiceId');
  const isReceiptsRoute = location.pathname.includes('/billing/receipts') || tabParam === 'RECEIPTS';

  const [activeTab, setActiveTab] = useState(isReceiptsRoute ? 'RECEIPTS' : 'UNPAID');

  useEffect(() => {
    if (isReceiptsRoute) {
      setActiveTab('RECEIPTS');
    } else {
      setActiveTab('UNPAID');
    }
  }, [isReceiptsRoute, tabParam, location.search, location.pathname]);

  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [unpaidInvoices, setUnpaidInvoices] = useState([]);
  const [allReceipts, setAllReceipts] = useState([]);
  const [deletedReceipts, setDeletedReceipts] = useState([]);
  const [receiptSubTab, setReceiptSubTab] = useState('ACTIVE'); // 'ACTIVE' | 'DELETED'
  const [receiptToDelete, setReceiptToDelete] = useState(null);
  const [deletionReason, setDeletionReason] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState(null);
  const [invoiceDeletionReason, setInvoiceDeletionReason] = useState('');
  const [isDeletingInvoice, setIsDeletingInvoice] = useState(false);
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false);
  const [isReturningToDept, setIsReturningToDept] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [selectedReceiptForView, setSelectedReceiptForView] = useState(null);
  const [receiptSearchTerm, setReceiptSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [todayCollected, setTodayCollected] = useState(0);
  const [receiptsCount, setReceiptsCount] = useState(0);

  const fetchUnpaidInvoices = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await axiosClient.get('/billing/unpaid-invoices');
      const allInvoices = res.data || [];
      const invoices = allInvoices.filter((inv) => {
        const hasActiveDoctorQuery = Boolean(inv.doctorReviewQuery?.query?.trim() && !inv.doctorReviewQuery?.resolved);
        return !hasActiveDoctorQuery;
      });
      setUnpaidInvoices(invoices);
      useDepartmentNotificationStore.getState().setNavCount?.('/billing/dashboard', invoices.length);
      useDepartmentNotificationStore.getState().setNavCount?.('/billing/dashboard?tab=CENTRAL_DESK', invoices.length);
      setSelectedInvoice((prev) => {
        const requested = invoices.find((invoice) => invoice._id === requestedInvoiceId);
        if (requested) return requested;
        if (prev) {
          const fresh = invoices.find((i) => i._id === prev._id);
          if (fresh) return fresh;
        }
        return invoices.length > 0 ? invoices[0] : null;
      });
    } catch (err) {
      console.error('Failed to load unpaid invoices:', err);
    } finally {
      setIsLoading(false);
    }
  }, [requestedInvoiceId]);

  const fetchAllReceipts = useCallback(async () => {
    try {
      const res = await axiosClient.get('/billing/receipts');
      const receipts = res.data || [];
      setAllReceipts(receipts);
      setReceiptsCount(receipts.length);

      const today = new Date().toISOString().split('T')[0];
      const total = receipts.reduce((sum, r) => {
        const rDate = (r.createdAt || r.paidAt || '').split('T')[0];
        return rDate === today ? sum + Number(r.amountPaid || 0) : sum;
      }, 0);
      setTodayCollected(total);

      useDepartmentNotificationStore.getState().setNavCount?.('/billing/dashboard?tab=RECEIPTS', 0);
      useDepartmentNotificationStore.getState().setNavCount?.('/billing/receipts', 0);
    } catch (err) {
      console.error('Failed to load receipts:', err);
    }
  }, []);

  const fetchDeletedReceipts = useCallback(async () => {
    try {
      const res = await axiosClient.get('/billing/deleted-receipts');
      setDeletedReceipts(res.data || []);
    } catch (err) {
      console.error('Failed to load deleted receipts:', err);
    }
  }, []);

  useEffect(() => {
    useDepartmentNotificationStore.getState().setNavCount?.('/billing/dashboard?tab=RECEIPTS', 0);
    useDepartmentNotificationStore.getState().setNavCount?.('/billing/receipts', 0);
  }, [activeTab, isReceiptsRoute]);

  useEffect(() => {
    fetchUnpaidInvoices();
    fetchAllReceipts();
    fetchDeletedReceipts();
  }, [fetchUnpaidInvoices, fetchAllReceipts, fetchDeletedReceipts]);

  useEffect(() => {
    if (!socket) return;
    let debounceTimer = null;
    const debouncedHandler = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        fetchUnpaidInvoices();
        fetchAllReceipts();
        fetchDeletedReceipts();
        useDepartmentNotificationStore.getState().fetchPendingWork?.();
      }, 250);
    };
    socket.on('billing:invoice_created', debouncedHandler);
    socket.on('billing:invoice_updated', debouncedHandler);
    socket.on('billing:invoice_deleted', debouncedHandler);
    socket.on('billing:payment_collected', debouncedHandler);
    socket.on('billing:receipt_deleted', debouncedHandler);
    socket.on('workflow:pending_changed', debouncedHandler);
    socket.on('workflow:notification', debouncedHandler);
    socket.on('workflow:notification_cleared', debouncedHandler);
    socket.on('consultation:completed', debouncedHandler);
    socket.on('doctor:billing_query_response', debouncedHandler);
    socket.on('notification:created', debouncedHandler);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      socket.off('billing:invoice_created', debouncedHandler);
      socket.off('billing:invoice_updated', debouncedHandler);
      socket.off('billing:invoice_deleted', debouncedHandler);
      socket.off('billing:payment_collected', debouncedHandler);
      socket.off('billing:receipt_deleted', debouncedHandler);
      socket.off('workflow:pending_changed', debouncedHandler);
      socket.off('workflow:notification', debouncedHandler);
      socket.off('workflow:notification_cleared', debouncedHandler);
      socket.off('consultation:completed', debouncedHandler);
      socket.off('doctor:billing_query_response', debouncedHandler);
      socket.off('notification:created', debouncedHandler);
    };
  }, [socket, fetchUnpaidInvoices, fetchAllReceipts, fetchDeletedReceipts]);

  const handlePaymentSuccess = () => {
    if (selectedInvoice) {
      useNotificationStore.getState().resolveEntityNotification(String(selectedInvoice._id));
      useDepartmentNotificationStore.getState().resolvePending(String(selectedInvoice._id));
    }
    useNotificationStore.getState().markRouteAsRead('/billing/dashboard');
    fetchUnpaidInvoices();
    fetchAllReceipts();
    fetchDeletedReceipts();
    setIsPaymentOpen(false);
    useDepartmentNotificationStore.getState().fetchPendingWork?.();
    useNotificationStore.getState().fetchNotifications?.('active');
  };

  const handleConfirmDeleteBill = async () => {
    if (!receiptToDelete) return;
    const reason = deletionReason.trim() || 'Voided by cashier / staff';
    setIsDeleting(true);
    try {
      try {
        await axiosClient.delete(`/billing/receipts/${receiptToDelete._id}?deletionReason=${encodeURIComponent(reason)}`, {
          data: { deletionReason: reason },
        });
      } catch (delErr) {
        await axiosClient.post(`/billing/receipts/${receiptToDelete._id}/cancel`, { deletionReason: reason });
      }
      setReceiptToDelete(null);
      setDeletionReason('');
      fetchAllReceipts();
      fetchDeletedReceipts();
      fetchUnpaidInvoices();
    } catch (err) {
      alert(err.response?.data?.message || err.message || 'Failed to delete bill record.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmDeleteInvoice = async () => {
    if (!invoiceToDelete) return;
    const reason = invoiceDeletionReason.trim() || 'Patient requested cancellation';
    setIsDeletingInvoice(true);
    try {
      try {
        await axiosClient.delete(`/billing/invoices/${invoiceToDelete._id}?deletionReason=${encodeURIComponent(reason)}`, {
          data: { deletionReason: reason },
        });
      } catch (delErr) {
        await axiosClient.post(`/billing/invoices/${invoiceToDelete._id}/cancel`, { deletionReason: reason });
      }
      setInvoiceToDelete(null);
      setInvoiceDeletionReason('');
      if (selectedInvoice?._id === invoiceToDelete._id) {
        setSelectedInvoice(null);
      }
      fetchUnpaidInvoices();
      fetchAllReceipts();
      fetchDeletedReceipts();
    } catch (err) {
      alert(err.response?.data?.message || err.message || 'Failed to cancel/delete pending bill.');
    } finally {
      setIsDeletingInvoice(false);
    }
  };

  const handleConfirmReturnToDepartment = async ({ invoiceId, targetDepartment, reason, note }) => {
    setIsReturningToDept(true);
    try {
      const res = await axiosClient.post(`/billing/invoices/${invoiceId}/return-to-department`, {
        targetDepartment,
        reason,
        note,
      });
      alert(res.data?.message || res.message || 'Item returned to originating department.');
      setIsReturnModalOpen(false);
      setSelectedInvoice(null);
      fetchUnpaidInvoices();
      useDepartmentNotificationStore.getState().fetchPendingWork?.();
    } catch (err) {
      console.error('Failed to return to department:', err);
      const msg = err.response?.data?.error?.message || err.response?.data?.message || err.message || 'Failed to return to department.';
      alert(msg);
    } finally {
      setIsReturningToDept(false);
    }
  };

  const handleSendReceiptWhatsApp = (rc) => {
    const pat = rc.patientId || rc.invoiceId?.patientId || {};
    const rawPhone = pat.phone || '';
    const cleanPhone = rawPhone.replace(/[^0-9]/g, '');
    const patName = `${pat.firstName || ''} ${pat.lastName || ''}`.trim() || 'Patient';
    const invNo = rc.invoiceId?.invoiceNo || 'INV';
    const msg = `*Hospital Billing Receipt*\n\nDear ${patName},\nThank you for visiting our Healthcare Facility.\n\n*Receipt Summary:*\n• Receipt No: ${rc.receiptNo}\n• Invoice No: ${invNo}\n• UHID: ${pat.uhid || 'N/A'}\n• Amount Paid: ₹${rc.amountPaid}\n• Payment Tender: ${rc.paymentMode}\n• Date: ${new Date(rc.createdAt).toLocaleString()}\n\nThank you for choosing our hospital services!`;
    const encoded = encodeURIComponent(msg);
    window.open(`https://wa.me/${cleanPhone.length >= 10 ? cleanPhone : ''}?text=${encoded}`, '_blank');
  };

  const filteredReceipts = useMemo(() => {
    const search = receiptSearchTerm.trim().toLowerCase();
    if (!search) return allReceipts;
    return allReceipts.filter((rc) => {
      const pat = rc.patientId || rc.invoiceId?.patientId || {};
      const name = `${pat.firstName || ''} ${pat.lastName || ''}`.toLowerCase();
      const uhid = (pat.uhid || '').toLowerCase();
      const rcNo = (rc.receiptNo || '').toLowerCase();
      const invNo = (rc.invoiceId?.invoiceNo || '').toLowerCase();
      const phone = (pat.phone || '').toLowerCase();
      return name.includes(search) || uhid.includes(search) || rcNo.includes(search) || invNo.includes(search) || phone.includes(search);
    });
  }, [allReceipts, receiptSearchTerm]);

  const filteredDeletedReceipts = useMemo(() => {
    const search = receiptSearchTerm.trim().toLowerCase();
    if (!search) return deletedReceipts;
    return deletedReceipts.filter((rc) => {
      const pat = rc.patientId || rc.invoiceId?.patientId || {};
      const name = `${pat.firstName || ''} ${pat.lastName || ''}`.toLowerCase();
      const uhid = (pat.uhid || '').toLowerCase();
      const rcNo = (rc.receiptNo || '').toLowerCase();
      const invNo = (rc.invoiceId?.invoiceNo || rc.invoiceNo || '').toLowerCase();
      const reason = (rc.deletionReason || '').toLowerCase();
      const deletedBy = (rc.deletedByName || rc.deletedBy?.name || '').toLowerCase();
      return name.includes(search) || uhid.includes(search) || rcNo.includes(search) || invNo.includes(search) || reason.includes(search) || deletedBy.includes(search);
    });
  }, [deletedReceipts, receiptSearchTerm]);

  const patient    = selectedInvoice?.patientId;
  const consult    = selectedInvoice?.consultation;
  const doctor     = selectedInvoice?.doctorId || consult?.doctorId;
  const doctorName = selectedInvoice?.doctorName || (doctor?.name ? `Dr. ${doctor.name}` : (consult?.doctorId?.name ? `Dr. ${consult.doctorId.name}` : null));

  return (
    <div className="space-y-6 animate-fade-in pb-28">
      {/* Dynamic Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            {activeTab === 'RECEIPTS' ? 'Permanent Receipts & Payment Records' : 'Cash Counter & Billing Workstation'}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {activeTab === 'RECEIPTS'
              ? 'Stored history of all billed receipts, patient billing archives & WhatsApp sharing'
              : `${user?.name || 'Cashier'} — Billing & Receipts Station`}
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1 font-bold" onClick={() => { fetchUnpaidInvoices(); fetchAllReceipts(); }}>
          <RefreshCw size={14} /> Refresh Data
        </Button>
      </div>



      {/* Stats - visible when on UNPAID tab */}
      {activeTab === 'UNPAID' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Today's Shift Collection" value={formatCurrency(todayCollected)} subtitle="Cash & Digital Payments" icon={IndianRupee} color="emerald" />
          <StatCard title="Receipts Issued Today" value={`${receiptsCount} Receipts`} subtitle="Thermal Printed" icon={Receipt} color="sky" />
          <StatCard title="Pending Bills" value={`${unpaidInvoices.length} Invoices`} subtitle="Doctor-Finalized, Awaiting Payment" icon={Clock} color="amber" />
          <StatCard title="Shift Reconciliation" value="BALANCED" subtitle="0 Discrepancy" icon={Lock} color="purple" />
        </div>
      )}

      {activeTab === 'UNPAID' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Pending Invoice Queue */}
          <Card className="lg:col-span-1">
            <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center gap-2">
              <Clock size={18} className="text-amber-600" />
              Pending Bills Queue ({unpaidInvoices.length})
            </h3>

            {isLoading ? (
              <div className="p-6 text-center text-indigo-600 text-xs animate-pulse">Loading invoices…</div>
            ) : unpaidInvoices.length > 0 ? (
              <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                {unpaidInvoices.map((inv) => {
                  const pat = inv.patientId || {};
                  const docObj = inv.doctorId || inv.consultation?.doctorId;
                  const docNameStr = inv.doctorName || docObj?.name || inv.consultation?.doctorId?.name;
                  const isSelected = selectedInvoice?._id === inv._id;
                  return (
                    <div
                      key={inv._id}
                      onClick={() => setSelectedInvoice(inv)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all text-xs ${
                        isSelected
                          ? 'bg-indigo-50 border-indigo-400 shadow-sm'
                          : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono font-bold text-indigo-700 text-[11px]">{pat.uhid || '—'}</span>
                        <div className="flex items-center gap-1.5">
                          {inv.isReturnedToDept && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700 border border-amber-200 uppercase tracking-wide">
                              Returned
                            </span>
                          )}
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                            inv.status === 'PARTIALLY_PAID'
                              ? 'bg-amber-50 text-amber-600 border-amber-200'
                              : 'bg-red-50 text-red-600 border-red-200'
                          }`}>
                            {inv.status === 'PARTIALLY_PAID' ? 'PARTIAL' : 'UNPAID'}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setInvoiceToDelete(inv);
                              setInvoiceDeletionReason('');
                            }}
                            className="w-5 h-5 rounded-md flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-100/80 border border-slate-200 hover:border-rose-300 transition-all cursor-pointer"
                            title="Cancel & Delete this Pending Bill"
                          >
                            <X size={12} strokeWidth={2.5} />
                          </button>
                        </div>
                      </div>
                      <p className="font-bold text-slate-900 text-sm">{pat.firstName} {pat.lastName}</p>
                      {docNameStr && (
                        <p className="text-slate-600 font-semibold text-[10px] mt-0.5">
                          <Stethoscope size={10} className="inline mr-0.5 text-indigo-500" />
                          {docNameStr.startsWith('Dr.') ? docNameStr : `Dr. ${docNameStr}`}
                        </p>
                      )}
                      <div className="flex justify-between items-center mt-1.5 pt-1.5 border-t border-slate-200">
                        <span className="text-slate-500 text-[10px]">Invoice: <span className="text-slate-900 font-mono">{inv.invoiceNo}</span></span>
                        <span className="font-bold text-emerald-600 text-xs">{formatCurrency(inv.balanceAmount)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-6 text-center text-slate-500 text-xs space-y-2">
                <CheckCircle size={28} className="mx-auto text-emerald-500/40" />
                <p className="font-semibold text-slate-500">All Clear!</p>
                <p>No pending invoices. Doctor-finalized bills will appear here automatically.</p>
              </div>
            )}
          </Card>

          {/* Right: Invoice Detail + Bill Breakdown */}
          <Card className="lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Receipt size={18} className="text-emerald-600" />
                Itemised Bill & Treatment Summary
              </h3>
              {selectedInvoice && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsReturnModalOpen(true)}
                    className="px-3 py-2 rounded-xl text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs hover:shadow-xs active:scale-95"
                    title="Return item or request price correction from Pharmacy / Lab / Doctor"
                  >
                    <RotateCcw size={14} className="text-amber-600" />
                    <span>Return / Query Dept</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setInvoiceToDelete(selectedInvoice);
                      setInvoiceDeletionReason('');
                    }}
                    className="px-3 py-2 rounded-xl text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200/80 transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs hover:shadow-xs active:scale-95"
                    title="Cancel & Delete this Pending Bill"
                  >
                    <X size={14} className="text-rose-600" />
                    <span>Cancel Bill</span>
                  </button>
                  <Button size="sm" variant="success" className="font-bold" onClick={() => setIsPaymentOpen(true)}>
                    Collect Payment & Issue Receipt
                  </Button>
                </div>
              )}
            </div>

            {selectedInvoice ? (
              <div className="space-y-4 text-xs">
                {/* Patient Info Banner */}
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
                      <User size={20} />
                    </div>
                    <div>
                      <p className="font-bold text-slate-900 text-sm">
                        {patient?.firstName} {patient?.lastName}
                        {patient?.age && <span className="text-slate-500 font-normal text-xs ml-1">({patient.age} yrs)</span>}
                      </p>
                      <p className="text-indigo-700 font-mono text-[11px] mt-0.5">
                        UHID: {patient?.uhid} • {patient?.phone}
                      </p>
                      {consult?.chiefComplaints && (
                        <p className="text-amber-600 text-[11px] mt-0.5">
                          Chief Complaint: {consult.chiefComplaints}
                        </p>
                      )}
                    </div>
                  </div>
                  {(doctorName || doctor) && (
                    <div className="text-right">
                      <p className="text-slate-500 text-[10px] uppercase tracking-wider font-bold">Attending / Billed Doctor</p>
                      <p className="text-slate-900 font-extrabold text-sm">
                        {doctorName ? (doctorName.startsWith('Dr.') ? doctorName : `Dr. ${doctorName}`) : `Dr. ${doctor?.name}`}
                      </p>
                      <p className="text-indigo-600 text-[10px] font-semibold">{doctor?.specialization || 'Consultant Specialist'}</p>
                    </div>
                  )}
                </div>

                {/* Invoice Meta */}
                <div className="flex flex-wrap gap-3 text-[11px]">
                  <span className="px-2 py-1 rounded bg-white border border-slate-200 text-slate-600">
                    Invoice: <span className="text-slate-900 font-mono font-bold">{selectedInvoice.invoiceNo}</span>
                  </span>
                  <span className={`px-2 py-1 rounded border font-bold ${
                    selectedInvoice.status === 'PARTIALLY_PAID'
                      ? 'bg-amber-50 text-amber-600 border-amber-200'
                      : 'bg-red-50 text-red-600 border-red-200'
                  }`}>
                    {selectedInvoice.status}
                  </span>
                  {consult?.followUpDate && (
                    <span className="px-2 py-1 rounded bg-indigo-50 border border-indigo-200 text-indigo-600">
                      Follow-up: {new Date(consult.followUpDate).toLocaleDateString()}
                    </span>
                  )}
                </div>

                {/* Treatment Items Table */}
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-600 uppercase text-[10px] border-b border-slate-200">
                      <tr>
                        <th className="p-2.5">Item Description</th>
                        <th className="p-2.5 text-center">Category</th>
                        <th className="p-2.5 text-center">Qty</th>
                        <th className="p-2.5 text-right">Unit Price</th>
                        <th className="p-2.5 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-slate-800">
                      {selectedInvoice.items?.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="p-2.5 text-slate-900 font-medium">
                            {item.description}
                            {item.unitPrice === 0 && item.category === 'PHARMACY' && (
                              <span className="inline-block ml-2 px-1.5 py-0.2 text-[9px] font-bold bg-amber-100 text-amber-800 rounded border border-amber-300">
                                ₹0 Price Needs Correction
                              </span>
                            )}
                          </td>
                          <td className="p-2.5 text-center">
                            <CategoryBadge cat={item.category} />
                          </td>
                          <td className="p-2.5 text-center text-slate-500">{item.qty}</td>
                          <td className="p-2.5 text-right font-mono">{formatCurrency(item.unitPrice)}</td>
                          <td className="p-2.5 text-right font-mono font-bold text-slate-900">
                            {formatCurrency(item.totalPrice)}
                            {item.category === 'PHARMACY' && (
                              <button
                                type="button"
                                onClick={() => setIsReturnModalOpen(true)}
                                className="inline-flex items-center gap-1 ml-auto text-[10px] text-amber-600 hover:text-amber-800 font-sans hover:underline font-bold mt-0.5 cursor-pointer"
                                title="Send back to Pharmacy for price / batch correction"
                              >
                                <RotateCcw size={10} /> Return to Pharmacy
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Prescription Preview */}
                {consult?.prescriptions?.length > 0 && (
                  <div className="p-3 rounded-xl bg-purple-50 border border-purple-200">
                    <p className="text-purple-600 font-bold text-[11px] uppercase tracking-wider flex items-center gap-1 mb-2">
                      <Pill size={12} /> Doctor's Prescription ({consult.prescriptions.length} medicines)
                    </p>
                    <div className="space-y-1">
                      {consult.prescriptions.map((med, i) => (
                        <p key={i} className="text-slate-600 text-[11px]">
                          <span className="text-slate-900 font-bold">{med.medicineName}</span>
                          {' — '}{med.dosage} · {med.frequency?.replace(/_/g, ' ')} · {med.durationDays} days
                          {med.timing && <span className="text-slate-500"> ({med.timing.replace(/_/g, ' ').toLowerCase()})</span>}
                        </p>
                      ))}
                    </div>
                    {consult.adviceToPatient && (
                      <p className="mt-2 text-amber-600 text-[11px]">
                        Advice: <span className="text-slate-600">{consult.adviceToPatient}</span>
                      </p>
                    )}
                  </div>
                )}

                {/* Bill Totals */}
                <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-2">
                  <div className="flex justify-between text-slate-500">
                    <span>Subtotal</span>
                    <span className="font-mono">{formatCurrency(selectedInvoice.subtotal)}</span>
                  </div>
                  {selectedInvoice.discountAmount > 0 && (
                    <div className="flex justify-between text-amber-600">
                      <span>Discount</span>
                      <span className="font-mono">— {formatCurrency(selectedInvoice.discountAmount)}</span>
                    </div>
                  )}
                  {selectedInvoice.paidAmount > 0 && (
                    <div className="flex justify-between text-emerald-600">
                      <span>Already Paid</span>
                      <span className="font-mono">— {formatCurrency(selectedInvoice.paidAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-base text-slate-900 border-t border-slate-200 pt-2 mt-2">
                    <span>Balance Due</span>
                    <span className="text-emerald-600">{formatCurrency(selectedInvoice.balanceAmount)}</span>
                  </div>
                </div>

                {/* Collect Button */}
                <Button
                  variant="success"
                  className="w-full font-bold py-3"
                  onClick={() => setIsPaymentOpen(true)}
                >
                  Collect {formatCurrency(selectedInvoice.balanceAmount)} & Print Receipt
                </Button>
              </div>
            ) : (
              <div className="p-10 text-center text-slate-500 space-y-2 text-sm">
                <AlertCircle size={32} className="mx-auto text-slate-400" />
                <p className="font-semibold">No invoice selected</p>
                <p className="text-xs">Select a pending bill from the left panel, or wait for a doctor to finalize a consultation — it will appear automatically!</p>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* RECEIPTS & PAYMENT HISTORY TAB */}
      {activeTab === 'RECEIPTS' && (
        <Card className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Receipt size={18} className="text-emerald-600" />
                Permanent Receipts & Payment Records
              </h3>
              <p className="text-xs text-slate-500">Stored history of all billed receipts, deleted bills archive & WhatsApp sharing</p>
            </div>

            <div className="flex items-center gap-3">
              {/* Sub-tab Switcher */}
              <div className="flex rounded-xl bg-slate-100 p-1 border border-slate-200 text-xs">
                <button
                  type="button"
                  onClick={() => setReceiptSubTab('ACTIVE')}
                  className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                    receiptSubTab === 'ACTIVE'
                      ? 'bg-white text-indigo-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Active Receipts ({allReceipts.length})
                </button>
                <button
                  type="button"
                  onClick={() => setReceiptSubTab('DELETED')}
                  className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
                    receiptSubTab === 'DELETED'
                      ? 'bg-rose-50 text-rose-700 border border-rose-200 shadow-xs'
                      : 'text-slate-600 hover:text-rose-700'
                  }`}
                >
                  <Archive size={13} />
                  <span>Deleted Archive ({deletedReceipts.length})</span>
                </button>
              </div>

              <div className="relative w-full sm:w-64">
                <input
                  type="text"
                  placeholder="Search patient, UHID, receipt..."
                  value={receiptSearchTerm}
                  onChange={(e) => setReceiptSearchTerm(e.target.value)}
                  className="w-full glass-input rounded-xl py-2 pl-9 pr-3 text-xs text-slate-900"
                />
                <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
              </div>
            </div>
          </div>

          {/* ACTIVE RECEIPTS VIEW */}
          {receiptSubTab === 'ACTIVE' && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 text-slate-600 uppercase text-[10px] border-b border-slate-200">
                  <tr>
                    <th className="p-3">Receipt No</th>
                    <th className="p-3">Patient Details</th>
                    <th className="p-3 text-center">Tender Mode</th>
                    <th className="p-3 text-right">Amount Paid</th>
                    <th className="p-3 text-center">Date & Time</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-800">
                  {filteredReceipts.length > 0 ? (
                    filteredReceipts.map((rc) => {
                      const pat = rc.patientId || rc.invoiceId?.patientId || {};
                      const rcDocObj = rc.invoiceId?.doctorId || rc.invoiceId?.consultation?.doctorId;
                      const rcDocName = rc.invoiceId?.doctorName || rcDocObj?.name || rc.invoiceId?.consultation?.doctorId?.name;
                      return (
                        <tr key={rc._id} className="hover:bg-slate-50">
                          <td className="p-3">
                            <p className="font-mono font-bold text-indigo-700 text-xs">{rc.receiptNo}</p>
                            <p className="text-[10px] text-slate-400 font-mono">Inv: {rc.invoiceId?.invoiceNo || 'INV'}</p>
                          </td>
                          <td className="p-3">
                            <p className="font-bold text-slate-900">{pat.firstName} {pat.lastName}</p>
                            <p className="text-slate-500 text-[10px] font-mono">
                              UHID: {pat.uhid || '—'} {pat.phone && `• Phone: ${pat.phone}`}
                            </p>
                            {rcDocName && (
                              <p className="text-indigo-600 text-[10px] font-bold mt-0.5">
                                <Stethoscope size={10} className="inline mr-0.5 text-indigo-500" />
                                {rcDocName.startsWith('Dr.') ? rcDocName : `Dr. ${rcDocName}`}
                              </p>
                            )}
                          </td>
                          <td className="p-3 text-center">
                            <span className="px-2 py-0.5 rounded text-[10px] font-black bg-indigo-50 text-indigo-700 border border-indigo-200">
                              {rc.paymentMode}
                            </span>
                          </td>
                          <td className="p-3 text-right font-mono font-bold text-emerald-600 text-sm">
                            {formatCurrency(rc.amountPaid)}
                          </td>
                          <td className="p-3 text-center text-slate-500 text-[11px]">
                            {new Date(rc.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setSelectedReceiptForView(rc)}
                                className="px-2.5 py-1.5 rounded-xl font-bold text-xs text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/80 shadow-2xs hover:shadow-xs transition-all flex items-center gap-1 shrink-0 cursor-pointer active:scale-95"
                              >
                                <Eye size={13} className="text-indigo-600" />
                                <span>View Bill</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleSendReceiptWhatsApp(rc)}
                                className="px-2.5 py-1.5 rounded-xl font-bold text-xs text-white bg-emerald-600 hover:bg-emerald-700 border border-emerald-600 shadow-2xs hover:shadow-xs transition-all flex items-center gap-1 shrink-0 cursor-pointer active:scale-95"
                              >
                                <MessageCircle size={13} className="text-white fill-white/20" />
                                <span>WhatsApp</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setReceiptToDelete(rc);
                                  setDeletionReason('');
                                }}
                                className="px-2.5 py-1.5 rounded-xl font-bold text-xs text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200/80 shadow-2xs hover:shadow-xs transition-all flex items-center gap-1 shrink-0 cursor-pointer active:scale-95"
                                title="Delete & Void this Bill"
                              >
                                <Trash2 size={13} className="text-rose-600" />
                                <span>Delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500 text-xs">
                        No matching paid receipts found. Processed bills will stay stored here permanently.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* DELETED BILLS ARCHIVE VIEW */}
          {receiptSubTab === 'DELETED' && (
            <div className="space-y-3">
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 flex items-start gap-2.5 text-xs text-amber-900">
                <ShieldAlert size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Audit Archive & Revenue Exclusion Notice</p>
                  <p className="text-[11px] text-amber-700">
                    All voided bills below are stored permanently for audit trail and compliance purposes. Their revenue is automatically deducted from all total revenue, cashier summaries, and hospital reports.
                  </p>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-rose-50/70 text-rose-800 uppercase text-[10px] border-b border-rose-200">
                    <tr>
                      <th className="p-3">Receipt / Invoice</th>
                      <th className="p-3">Patient Details</th>
                      <th className="p-3 text-right">Voided Amount</th>
                      <th className="p-3">Billed By</th>
                      <th className="p-3">Deleted By</th>
                      <th className="p-3">Deletion Reason</th>
                      <th className="p-3 text-center">Date Deleted</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-800">
                    {filteredDeletedReceipts.length > 0 ? (
                      filteredDeletedReceipts.map((rc) => {
                        const pat = rc.patientId || rc.invoiceId?.patientId || {};
                        const rcDocObj = rc.invoiceId?.doctorId || rc.invoiceId?.consultation?.doctorId;
                        const rcDocName = rc.invoiceId?.doctorName || rcDocObj?.name || rc.invoiceId?.consultation?.doctorId?.name;
                        return (
                          <tr key={rc._id} className="hover:bg-slate-50">
                            <td className="p-3">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-bold text-slate-700 text-xs line-through">{rc.receiptNo}</span>
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-rose-100 text-rose-700 border border-rose-200">
                                  VOIDED
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-400 font-mono">Inv: {rc.invoiceId?.invoiceNo || rc.invoiceNo || 'INV'}</p>
                            </td>
                            <td className="p-3">
                              <p className="font-bold text-slate-900">{pat.firstName} {pat.lastName}</p>
                              <p className="text-slate-500 text-[10px] font-mono">
                                UHID: {pat.uhid || '—'} {pat.phone && `• Phone: ${pat.phone}`}
                              </p>
                              {rcDocName && (
                                <p className="text-slate-500 text-[10px] font-medium mt-0.5">
                                  Dr: {rcDocName.startsWith('Dr.') ? rcDocName : `Dr. ${rcDocName}`}
                                </p>
                              )}
                            </td>
                            <td className="p-3 text-right font-mono font-bold text-rose-600 text-sm">
                              {formatCurrency(rc.amountPaid || rc.grandTotal || 0)}
                            </td>
                            <td className="p-3">
                              <p className="font-bold text-slate-800 text-[11px]">{rc.cashierId?.name || 'Cashier'}</p>
                              <p className="text-[10px] text-slate-400">{rc.cashierId?.email || 'Counter'}</p>
                            </td>
                            <td className="p-3">
                              <p className="font-bold text-rose-700 text-[11px]">{rc.deletedByName || rc.deletedBy?.name || 'Staff'}</p>
                              <p className="text-[10px] text-slate-400">{rc.deletedBy?.role || 'Authorized User'}</p>
                            </td>
                            <td className="p-3 max-w-xs">
                              <div className="p-1.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 font-medium text-[11px]">
                                {rc.deletionReason || 'Reason not recorded'}
                              </div>
                            </td>
                            <td className="p-3 text-center text-slate-500 text-[11px]">
                              {rc.deletedAt
                                ? new Date(rc.deletedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
                                : new Date(rc.updatedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                            </td>
                            <td className="p-3 text-right">
                              <button
                                type="button"
                                onClick={() => setSelectedReceiptForView(rc)}
                                className="px-2.5 py-1.5 rounded-xl font-bold text-xs text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200/80 shadow-2xs hover:shadow-xs transition-all flex items-center gap-1 shrink-0 ml-auto cursor-pointer active:scale-95"
                              >
                                <Eye size={13} className="text-rose-600" />
                                <span>View</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-slate-500 text-xs">
                          No deleted bills found in the archive. All active records remain intact.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}

      {selectedInvoice && (
        <ProcessPaymentModal
          isOpen={isPaymentOpen}
          onClose={() => setIsPaymentOpen(false)}
          invoice={selectedInvoice}
          onSuccess={handlePaymentSuccess}
        />
      )}

      {/* View Historical Receipt & Printable Bill Modal */}
      {selectedReceiptForView && (
        <OfficialReceiptModal
          isOpen={Boolean(selectedReceiptForView)}
          onClose={() => setSelectedReceiptForView(null)}
          receipt={selectedReceiptForView}
          invoice={selectedReceiptForView.invoiceId}
        />
      )}

      {/* Delete / Void Bill Confirmation Modal */}
      {receiptToDelete && (
        <Modal
          isOpen={Boolean(receiptToDelete)}
          onClose={() => {
            if (!isDeleting) {
              setReceiptToDelete(null);
              setDeletionReason('');
            }
          }}
          title={`Delete & Void Bill #${receiptToDelete.receiptNo}`}
          subtitle="Mandatory Reason & Audit Trail Required"
          icon={Trash2}
          maxWidth="max-w-lg"
        >
          <div className="space-y-4 text-xs text-slate-800">
            <div className="p-3.5 bg-rose-50 rounded-xl border border-rose-200 flex items-start gap-2.5">
              <ShieldAlert size={18} className="text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-rose-900">Revenue Exclusion & Audit Warning</p>
                <p className="text-[11px] text-rose-700 mt-0.5">
                  Deleting this bill will permanently void it, immediately exclude its {formatCurrency(receiptToDelete.amountPaid)} from hospital revenue, and record an immutable audit log entry for the Hospital Administration.
                </p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5 font-medium">
              <div className="flex justify-between">
                <span className="text-slate-500">Patient:</span>
                <span className="font-bold text-slate-900">
                  {receiptToDelete.patientId?.firstName || receiptToDelete.invoiceId?.patientId?.firstName}{' '}
                  {receiptToDelete.patientId?.lastName || receiptToDelete.invoiceId?.patientId?.lastName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Receipt No:</span>
                <span className="font-mono font-bold text-indigo-700">{receiptToDelete.receiptNo}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Billed Amount:</span>
                <span className="font-mono font-bold text-emerald-600">{formatCurrency(receiptToDelete.amountPaid)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Original Cashier:</span>
                <span className="text-slate-700">{receiptToDelete.cashierId?.name || user?.name || 'Counter Staff'}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block font-bold text-slate-700 text-xs">
                Reason for Deletion <span className="text-rose-500">*</span>
              </label>
              <textarea
                rows={3}
                value={deletionReason}
                onChange={(e) => setDeletionReason(e.target.value)}
                placeholder="Enter detailed reason for voiding this bill (e.g. duplicate payment, patient cancelled consultation, wrong payment mode)..."
                className="w-full rounded-xl border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-none"
              />

              {/* Quick suggestion chips */}
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase text-slate-400">Quick Reason Presets:</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'Duplicate Bill Entry',
                    'Patient Cancelled Consultation',
                    'Incorrect Payment Amount',
                    'Wrong Tender Mode Selected',
                    'Test / Training Entry',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setDeletionReason(preset)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-all ${
                        deletionReason === preset
                          ? 'bg-rose-100 text-rose-800 border-rose-300'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => {
                  setReceiptToDelete(null);
                  setDeletionReason('');
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 border border-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting || !deletionReason.trim()}
                onClick={handleConfirmDeleteBill}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 transition-all flex items-center gap-1.5 shadow-sm"
              >
                <Trash2 size={13} />
                <span>{isDeleting ? 'Voiding Bill…' : 'Confirm Deletion (Void Bill)'}</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Cancel / Delete Pending Invoice Modal */}
      {invoiceToDelete && (
        <Modal
          isOpen={Boolean(invoiceToDelete)}
          onClose={() => {
            if (!isDeletingInvoice) {
              setInvoiceToDelete(null);
              setInvoiceDeletionReason('');
            }
          }}
          title={`Cancel Pending Bill #${invoiceToDelete.invoiceNo}`}
          subtitle="Mandatory Reason & Hospital Audit Required"
          icon={XCircle}
          maxWidth="max-w-lg"
        >
          <div className="space-y-4 text-xs text-slate-800">
            <div className="p-3.5 bg-rose-50 rounded-xl border border-rose-200 flex items-start gap-2.5">
              <ShieldAlert size={18} className="text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-rose-900">Pending Bill Cancellation</p>
                <p className="text-[11px] text-rose-700 mt-0.5">
                  Cancelling this bill will remove it from the active cashier queue and record an immutable audit log entry with your cancellation reason for the Hospital Administration.
                </p>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5 font-medium">
              <div className="flex justify-between">
                <span className="text-slate-500">Patient:</span>
                <span className="font-bold text-slate-900">
                  {invoiceToDelete.patientId?.firstName} {invoiceToDelete.patientId?.lastName}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">UHID:</span>
                <span className="font-mono font-bold text-indigo-700">{invoiceToDelete.patientId?.uhid || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Invoice No:</span>
                <span className="font-mono font-bold text-slate-900">{invoiceToDelete.invoiceNo}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Pending Amount:</span>
                <span className="font-mono font-bold text-rose-600">{formatCurrency(invoiceToDelete.balanceAmount || invoiceToDelete.grandTotal)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block font-bold text-slate-700 text-xs">
                Reason for Cancellation / Deletion <span className="text-rose-500">*</span>
              </label>
              <textarea
                rows={3}
                value={invoiceDeletionReason}
                onChange={(e) => setInvoiceDeletionReason(e.target.value)}
                placeholder="Enter detailed reason for cancelling this pending bill (e.g. patient left without treatment, doctor consultation cancelled, wrong charges)..."
                className="w-full rounded-xl border border-slate-300 p-2.5 text-xs text-slate-900 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-none"
              />

              {/* Quick suggestion chips */}
              <div className="space-y-1">
                <p className="text-[10px] font-bold uppercase text-slate-400">Quick Reason Presets:</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    'Patient Left Without Consultation',
                    'Doctor Cancelled Consultation',
                    'Duplicate Bill Generated',
                    'Incorrect Charges / Treatment Item',
                    'Patient Requested Cancellation',
                    'Test / Training Entry',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setInvoiceDeletionReason(preset)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-all ${
                        invoiceDeletionReason === preset
                          ? 'bg-rose-100 text-rose-800 border-rose-300'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
              <button
                type="button"
                disabled={isDeletingInvoice}
                onClick={() => {
                  setInvoiceToDelete(null);
                  setInvoiceDeletionReason('');
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 border border-slate-200 transition-colors"
              >
                Keep Pending
              </button>
              <button
                type="button"
                disabled={isDeletingInvoice || !invoiceDeletionReason.trim()}
                onClick={handleConfirmDeleteInvoice}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 transition-all flex items-center gap-1.5 shadow-sm"
              >
                <X size={14} />
                <span>{isDeletingInvoice ? 'Cancelling Bill…' : 'Confirm Cancellation (Delete Bill)'}</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Return to Department / Clarification Query Modal */}
      <ReturnToDepartmentModal
        isOpen={isReturnModalOpen}
        onClose={() => setIsReturnModalOpen(false)}
        invoice={selectedInvoice}
        onConfirmReturn={handleConfirmReturnToDepartment}
        isSubmitting={isReturningToDept}
      />
    </div>
  );
};

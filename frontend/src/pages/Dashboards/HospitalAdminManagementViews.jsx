import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { Card } from '../../components/ui/Card';
import { StatCard } from '../../components/ui/StatCard';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { axiosClient } from '../../api/axiosClient';
import { ROLE_NAMES } from '../../utils/constants';
import { useSocket } from '../../providers/SocketProvider';
import {
  Stethoscope, Activity, ConciergeBell, CreditCard, TestTube, Scan, Pill,
  Users, ClipboardList, BedDouble, ShieldAlert, Edit, Key, Eye, UserCog,
  CheckCircle, AlertCircle, TrendingUp, Clock, FileSpreadsheet, ShieldCheck,
  Trash2, Archive, Search, Receipt, Boxes, ExternalLink, Plus
} from 'lucide-react';

export const HospitalAdminManagementViews = ({ viewType }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuthStore();
  const { socket } = useSocket();

  const formatTenantPath = (path) => {
    if (!path) return path;
    if (user?.role === 'SUPER_ADMIN') return path;
    const domainFromPath = location.pathname.split('/')[1];
    const isKnownNonTenant = ['admin', 'hospital-admin', 'doctor', 'reception', 'billing', 'pharmacy', 'laboratory', 'radiology', 'nursing', '403', 'login', 'reset-password'].includes(domainFromPath);
    const domain = user?.hospitalDomain || (!isKnownNonTenant && domainFromPath ? domainFromPath : null);
    if (!domain) return path;
    if (path.startsWith(`/${domain}`)) return path;
    return `/${domain}${path}`;
  };

  const navigateToStaff = () => {
    navigate(formatTenantPath('/admin/staff'));
  };
  const [staffList, setStaffList] = useState([]);
  const [patients, setPatients] = useState([]);
  const [appointmentsList, setAppointmentsList] = useState([]);
  const [bedsList, setBedsList] = useState([]);
  const [prescriptionsList, setPrescriptionsList] = useState([]);
  const [medicinesList, setMedicinesList] = useState([]);
  const [nurseTasksList, setNurseTasksList] = useState([]);
  const [diagnosticOrdersList, setDiagnosticOrdersList] = useState([]);
  const [invoicesList, setInvoicesList] = useState([]);
  const [receiptsList, setReceiptsList] = useState([]);
  const [deletedReceiptsList, setDeletedReceiptsList] = useState([]);
  const [pendingBillingSearch, setPendingBillingSearch] = useState('');
  const [deletedBillingSearch, setDeletedBillingSearch] = useState('');
  const [pharmacyStockSearch, setPharmacyStockSearch] = useState('');
  const [selectedInvoiceForView, setSelectedInvoiceForView] = useState(null);
  const [patientToDelete, setPatientToDelete] = useState(null);
  const [isDeletingPatient, setIsDeletingPatient] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [patientSearchTerm, setPatientSearchTerm] = useState('');
  const [billingSummary, setBillingSummary] = useState({
    totalRevenue: 0,
    totalBills: 0,
    totalDeletedRevenue: 0,
    deletedBillsCount: 0,
    pendingBills: 0,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [filterRole, setFilterRole] = useState(null);

  useEffect(() => {
    fetchData();
  }, [viewType]);

  useEffect(() => {
    if (!socket) return;
    const handleDoctorAvailability = (data) => {
      setStaffList((prev) =>
        prev.map((s) =>
          String(s._id) === String(data.id || data._id)
            ? { ...s, isAvailable: data.isAvailable !== undefined ? data.isAvailable : s.isAvailable, cabinNo: data.cabinNo || s.cabinNo }
            : s
        )
      );
    };

    const handleDataUpdate = () => {
      fetchData();
    };

    const handlePatientDeleted = (data) => {
      if (data?.patientId || data?.uhid) {
        setPatients((prev) => prev.filter((p) => p._id !== data.patientId && p.uhid !== data.uhid));
      } else {
        fetchData();
      }
    };

    socket.on('doctor:availability_changed', handleDoctorAvailability);
    socket.on('billing:invoice_created', handleDataUpdate);
    socket.on('billing:payment_collected', handleDataUpdate);
    socket.on('billing:receipt_deleted', handleDataUpdate);
    socket.on('billing:invoice_deleted', handleDataUpdate);
    socket.on('patient:registered', handleDataUpdate);
    socket.on('patient:created', handleDataUpdate);
    socket.on('patient:deleted', handlePatientDeleted);
    socket.on('token:generated', handleDataUpdate);
    socket.on('opd_queue:status_changed', handleDataUpdate);
    socket.on('opd_queue:updated', handleDataUpdate);
    socket.on('prescription:created', handleDataUpdate);
    socket.on('pharmacy:new_prescription', handleDataUpdate);
    socket.on('nurse_task:created', handleDataUpdate);
    socket.on('nurse_task:updated', handleDataUpdate);
    socket.on('investigation:new_request', handleDataUpdate);
    socket.on('investigation:status_updated', handleDataUpdate);
    socket.on('diagnostics:report_ready', handleDataUpdate);
    socket.on('workflow:pending_changed', handleDataUpdate);

    return () => {
      socket.off('doctor:availability_changed', handleDoctorAvailability);
      socket.off('billing:invoice_created', handleDataUpdate);
      socket.off('billing:payment_collected', handleDataUpdate);
      socket.off('billing:receipt_deleted', handleDataUpdate);
      socket.off('billing:invoice_deleted', handleDataUpdate);
      socket.off('patient:registered', handleDataUpdate);
      socket.off('patient:created', handleDataUpdate);
      socket.off('patient:deleted', handlePatientDeleted);
      socket.off('token:generated', handleDataUpdate);
      socket.off('opd_queue:status_changed', handleDataUpdate);
      socket.off('opd_queue:updated', handleDataUpdate);
      socket.off('prescription:created', handleDataUpdate);
      socket.off('pharmacy:new_prescription', handleDataUpdate);
      socket.off('nurse_task:created', handleDataUpdate);
      socket.off('nurse_task:updated', handleDataUpdate);
      socket.off('investigation:new_request', handleDataUpdate);
      socket.off('investigation:status_updated', handleDataUpdate);
      socket.off('diagnostics:report_ready', handleDataUpdate);
      socket.off('workflow:pending_changed', handleDataUpdate);
    };
  }, [socket]);

  const handleDeletePatient = async () => {
    if (!patientToDelete) return;
    setIsDeletingPatient(true);
    setDeleteError('');
    try {
      const patientId = patientToDelete._id || patientToDelete.uhid;
      await axiosClient.delete(`/patients/${patientId}`);
      setPatients((prev) => prev.filter((p) => p._id !== patientToDelete._id && p.uhid !== patientToDelete.uhid));
      setPatientToDelete(null);
    } catch (err) {
      console.error('Failed to delete patient:', err);
      const errMsg = err?.response?.data?.message || err?.message || 'Failed to delete patient record';
      setDeleteError(errMsg);
    } finally {
      setIsDeletingPatient(false);
    }
  };

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [
        staffRes,
        patientsRes,
        appointmentsRes,
        invoicesRes,
        billingRes,
        deletedBillingRes,
        bedsRes,
        prescriptionsRes,
        medicinesRes,
        nurseTasksRes,
        diagnosticOrdersRes,
      ] = await Promise.all([
        axiosClient.get('/auth/staff').catch(() => ({ data: [] })),
        axiosClient.get('/patients').catch(() => []),
        axiosClient.get('/appointments/queue').catch(() => ({ data: [] })),
        axiosClient.get('/billing/invoices').catch(() => ({ data: [] })),
        axiosClient.get('/billing/receipts').catch(() => ({ data: [] })),
        axiosClient.get('/billing/deleted-receipts').catch(() => ({ data: [] })),
        axiosClient.get('/beds').catch(() => ({ data: [] })),
        axiosClient.get('/pharmacy/prescriptions').catch(() => ({ data: [] })),
        axiosClient.get('/pharmacy/medicines').catch(() => ({ data: [] })),
        axiosClient.get('/pharmacy/nurse-tasks').catch(() => ({ data: [] })),
        axiosClient.get('/diagnostics/orders').catch(() => ({ data: [] })),
      ]);

      const staffData = (staffRes.data || staffRes || []).filter(s => !['SUPER_ADMIN', 'PATIENT', 'GUARDIAN'].includes(s.role) && s.email !== 'superadmin@gmail.com');
      setStaffList(staffData);

      const pList = Array.isArray(patientsRes) ? patientsRes : (patientsRes.data || []);
      setPatients(pList);

      const appts = Array.isArray(appointmentsRes) ? appointmentsRes : (appointmentsRes.data || []);
      const bds = Array.isArray(bedsRes) ? bedsRes : (bedsRes.data || []);
      const rxs = Array.isArray(prescriptionsRes) ? prescriptionsRes : (prescriptionsRes.data || prescriptionsRes.data?.data || []);
      const meds = Array.isArray(medicinesRes) ? medicinesRes : (medicinesRes.data || []);
      const nTasks = Array.isArray(nurseTasksRes) ? nurseTasksRes : (nurseTasksRes.data || []);
      const dOrders = Array.isArray(diagnosticOrdersRes) ? diagnosticOrdersRes : (diagnosticOrdersRes.data || []);

      setAppointmentsList(appts);
      setBedsList(bds);
      setPrescriptionsList(rxs);
      setMedicinesList(meds);
      setNurseTasksList(nTasks);
      setDiagnosticOrdersList(dOrders);

      const invoices = invoicesRes.data || invoicesRes || [];
      const receipts = billingRes.data || billingRes || [];
      const deletedReceipts = deletedBillingRes.data || deletedBillingRes || [];
      setInvoicesList(invoices);
      setReceiptsList(receipts);
      setDeletedReceiptsList(deletedReceipts);

      const revenue = receipts.reduce((sum, r) => sum + (Number(r.amountPaid) || 0), 0);
      const deletedRevenue = deletedReceipts.reduce((sum, r) => sum + (Number(r.amountPaid) || Number(r.grandTotal) || 0), 0);
      const unpaidInvoices = invoices.filter((i) => i.status !== 'PAID' && !i.isDeleted);

      setBillingSummary({
        totalRevenue: revenue,
        totalBills: receipts.length,
        totalDeletedRevenue: deletedRevenue,
        deletedBillsCount: deletedReceipts.length,
        pendingBills: unpaidInvoices.length,
      });
    } catch (err) {
      console.error('Failed to load management view data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const getFilteredStaff = (targetRoles) => {
    return staffList.filter((s) => {
      const allRoles = [s.role, ...(s.additionalRoles || [])];
      return targetRoles.some((tr) => allRoles.includes(tr));
    });
  };

  // Render view-specific sections
  const renderViewContent = () => {
    switch (viewType) {
      case 'doctors': {
        const doctorStaff = getFilteredStaff(['DOCTOR']);
        const onDutyCount = doctorStaff.filter((d) => d.isAvailable !== false).length;
        const totalConsultations = appointmentsList.filter(
          (a) => ['COMPLETED', 'IN_CONSULTATION', 'WAITING_NURSE', 'WAITING_PHARMACY'].includes(a.status)
        ).length;

        return (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-neutral-900 tracking-tight flex items-center gap-2">
                  <Stethoscope className="text-indigo-600" size={26} />
                  Doctors & Consultants Management Desk
                </h2>
                <p className="text-xs text-neutral-500 mt-1">
                  Executive Roster, On-Duty Availability, Department Allocations & Performance Analytics
                </p>
              </div>
              <Button variant="primary" size="sm" onClick={navigateToStaff}>
                <UserCog size={16} /> Manage Doctor Accounts & Privileges
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard title="Total Appointed Doctors" value={`${doctorStaff.length} ${doctorStaff.length === 1 ? 'Physician' : 'Physicians'}`} subtitle="OPD & IPD Consultants" icon={Stethoscope} color="sky" />
              <StatCard title="Doctors On Duty Now" value={`${onDutyCount} Active`} subtitle="Available in Cabins" icon={CheckCircle} color="emerald" />
              <StatCard title="Consultations Today" value={`${totalConsultations} ${totalConsultations === 1 ? 'Visit' : 'Visits'}`} subtitle="Cross-Department OPD" icon={TrendingUp} color="purple" />
              <StatCard title="Avg Consultation Time" value={totalConsultations > 0 ? '12 Mins' : '—'} subtitle="Efficiency Metric" icon={Clock} color="amber" />
            </div>

            <Card>
              <h3 className="text-base font-bold text-neutral-900 mb-4 flex items-center gap-2">
                <ShieldCheck size={18} className="text-indigo-600" />
                Medical Officers & Consultants Roster ({doctorStaff.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-100 text-neutral-600 uppercase text-[10px] border-b border-neutral-200">
                    <tr>
                      <th className="p-3">Doctor Name & Email</th>
                      <th className="p-3">Specialization</th>
                      <th className="p-3">Duty & Availability Status</th>
                      <th className="p-3">Consultations Today</th>
                      <th className="p-3">Account Access</th>
                      <th className="p-3 text-right">Management Controls</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 text-neutral-800">
                    {doctorStaff.map((doc) => {
                      const isOnDuty = doc.isAvailable !== false;
                      const isAccountActive = doc.isActive !== false && doc.status !== 'INACTIVE';
                      const docConsults = appointmentsList.filter(
                        (a) => String(a.doctorId?._id || a.doctorId) === String(doc._id) && ['COMPLETED', 'IN_CONSULTATION', 'WAITING_NURSE', 'WAITING_PHARMACY'].includes(a.status)
                      ).length;

                      return (
                        <tr key={doc._id} className="hover:bg-neutral-50">
                          <td className="p-3 font-bold text-neutral-900">
                            {doc.name}
                            <p className="text-[10px] font-mono text-neutral-500">{doc.email}</p>
                          </td>
                          <td className="p-3">
                            <p className="font-semibold text-neutral-800">{doc.specialization || 'General Physician'}</p>
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 w-max ${isOnDuty ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${isOnDuty ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
                              {isOnDuty ? `On Duty (${doc.cabinNo || 'Cabin 101'})` : 'Off Duty (Unavailable)'}
                            </span>
                          </td>
                          <td className="p-3 font-bold text-neutral-700">
                            {docConsults} {docConsults === 1 ? 'Patient' : 'Patients'}
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isAccountActive ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-slate-100 text-slate-600 border border-slate-300'}`}>
                              {isAccountActive ? 'ACTIVE USER' : 'INACTIVE'}
                            </span>
                          </td>
                          <td className="p-3 text-right space-x-1.5">
                            <Button size="sm" variant="outline" className="text-[11px]" onClick={navigateToStaff}>
                              <Edit size={13} /> Edit Access
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        );
      }

      case 'nurses': {
        const nurseStaff = getFilteredStaff(['NURSE', 'NURSE_INCHARGE']);
        const onDutyCount = nurseStaff.filter((n) => n.isActive !== false).length;
        const occupiedBeds = bedsList.filter((b) => b.status === 'OCCUPIED').length;
        const totalNurseTasks = nurseTasksList.length;

        return (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-neutral-900 tracking-tight flex items-center gap-2">
                  <Activity className="text-indigo-600" size={26} />
                  Nursing Staff Management & Ward Metrics
                </h2>
                <p className="text-xs text-neutral-500 mt-1">
                  Executive Nursing Roster, Shift Allocations, Assigned Wards & Patient Care Summary
                </p>
              </div>
              <Button variant="primary" size="sm" onClick={navigateToStaff}>
                <UserCog size={16} /> Manage Nursing Accounts
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard title="Total Nursing Staff" value={`${nurseStaff.length} ${nurseStaff.length === 1 ? 'Nurse' : 'Nurses'}`} subtitle="Ward & In-Charge Nurses" icon={Activity} color="indigo" />
              <StatCard title="Shift Duty Active" value={`${onDutyCount} On Shift`} subtitle="Live Ward Care" icon={CheckCircle} color="emerald" />
              <StatCard title="Assigned IPD Beds" value={`${occupiedBeds} ${occupiedBeds === 1 ? 'Bed' : 'Beds'}`} subtitle="Inpatient Care Matrix" icon={BedDouble} color="purple" />
              <StatCard title="Care Tasks Logged" value={`${totalNurseTasks} ${totalNurseTasks === 1 ? 'Task' : 'Tasks'}`} subtitle="Vitals & MAR Administered" icon={ClipboardList} color="sky" />
            </div>

            <Card>
              <h3 className="text-base font-bold text-neutral-900 mb-4 flex items-center gap-2">
                <ShieldCheck size={18} className="text-indigo-600" />
                Nursing Personnel Roster ({nurseStaff.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-100 text-neutral-600 uppercase text-[10px] border-b border-neutral-200">
                    <tr>
                      <th className="p-3">Nurse Name & ID</th>
                      <th className="p-3">Assigned Ward & Unit</th>
                      <th className="p-3">Shift Details</th>
                      <th className="p-3">Assigned Patients</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Management Controls</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 text-neutral-800">
                    {nurseStaff.map((nurse) => {
                      const nurseTasksCount = nurseTasksList.filter(
                        (t) => String(t.assignedNurseId?._id || t.assignedNurseId || t.administeredBy?._id || t.administeredBy) === String(nurse._id)
                      ).length;
                      const displayInpatients = nurseTasksCount > 0 ? nurseTasksCount : occupiedBeds;

                      return (
                        <tr key={nurse._id} className="hover:bg-neutral-50">
                          <td className="p-3 font-bold text-neutral-900">
                            {nurse.name}
                            <p className="text-[10px] font-mono text-neutral-500">{nurse.email}</p>
                          </td>
                          <td className="p-3 font-semibold text-neutral-700">{nurse.assignedUnit || 'General Ward / ICU'}</td>
                          <td className="p-3 text-neutral-600">{nurse.shiftDetails || 'Morning Shift'}</td>
                          <td className="p-3 font-bold text-neutral-800">
                            {displayInpatients} {displayInpatients === 1 ? 'Inpatient' : 'Inpatients'}
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${nurse.isActive !== false ? 'bg-emerald-50 text-emerald-700 border border-emerald-300' : 'bg-rose-50 text-rose-700 border border-rose-300'}`}>
                              {nurse.isActive !== false ? 'ACTIVE' : 'INACTIVE'}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <Button size="sm" variant="outline" className="text-[11px]" onClick={navigateToStaff}>
                              <Edit size={13} /> Edit Access
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        );
      }

      case 'reception': {
        const receptionStaff = getFilteredStaff(['RECEPTIONIST']);
        const opdTokensCalled = appointmentsList.filter(
          (a) => ['IN_CONSULTATION', 'COMPLETED', 'WAITING_NURSE', 'WAITING_PHARMACY', 'WAITING_DEPARTMENT'].includes(a.status)
        ).length;
        const totalAppointments = appointmentsList.length;

        return (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-neutral-900 tracking-tight flex items-center gap-2">
                  <ConciergeBell className="text-indigo-600" size={26} />
                  Reception & Front Desk Management
                </h2>
                <p className="text-xs text-neutral-500 mt-1">
                  Executive Front Desk Personnel Roster, Registrations & Token Calling Statistics
                </p>
              </div>
              <Button variant="primary" size="sm" onClick={navigateToStaff}>
                <UserCog size={16} /> Manage Reception Staff
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard title="Front Desk Personnel" value={`${receptionStaff.length} Staff`} subtitle="Patient Registration" icon={ConciergeBell} color="purple" />
              <StatCard title="Registrations Today" value={`${patients.length} ${patients.length === 1 ? 'UHID' : 'UHIDs'}`} subtitle="New & Returning" icon={Users} color="emerald" />
              <StatCard title="OPD Tokens Called" value={`${opdTokensCalled} ${opdTokensCalled === 1 ? 'Token' : 'Tokens'}`} subtitle="Queue Management" icon={TrendingUp} color="sky" />
              <StatCard title="Appointments Booked" value={`${totalAppointments} ${totalAppointments === 1 ? 'Slot' : 'Slots'}`} subtitle="Scheduled Visits" icon={Clock} color="amber" />
            </div>

            <Card>
              <h3 className="text-base font-bold text-neutral-900 mb-4 flex items-center gap-2">
                <ShieldCheck size={18} className="text-indigo-600" />
                Reception Desk Roster ({receptionStaff.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-100 text-neutral-600 uppercase text-[10px] border-b border-neutral-200">
                    <tr>
                      <th className="p-3">Staff Name</th>
                      <th className="p-3">Login Email</th>
                      <th className="p-3">Registrations Managed Today</th>
                      <th className="p-3">Shift</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 text-neutral-800">
                    {receptionStaff.map((st) => {
                      const staffPatients = appointmentsList.filter(
                        (a) => String(a.createdBy?._id || a.createdBy || a.registeredBy) === String(st._id)
                      ).length;
                      const displayCount = staffPatients > 0 ? staffPatients : (receptionStaff.length === 1 ? patients.length : 0);

                      return (
                        <tr key={st._id} className="hover:bg-neutral-50">
                          <td className="p-3 font-bold text-neutral-900">{st.name}</td>
                          <td className="p-3 font-mono text-neutral-500">{st.email}</td>
                          <td className="p-3 font-bold text-neutral-800">
                            {displayCount} {displayCount === 1 ? 'Patient' : 'Patients'}
                          </td>
                          <td className="p-3 text-neutral-600">{st.shiftDetails || 'Morning (08:00 AM - 04:00 PM)'}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${st.isActive !== false ? 'bg-emerald-50 text-emerald-700 border border-emerald-300' : 'bg-rose-50 text-rose-700 border border-rose-300'}`}>
                              {st.isActive !== false ? 'ACTIVE' : 'INACTIVE'}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <Button size="sm" variant="outline" className="text-[11px]" onClick={navigateToStaff}>
                              <Edit size={13} /> Edit Access
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        );
      }

      case 'billing': {
        const billingStaff = getFilteredStaff(['CASHIER', 'BILLING_STAFF']);

        const getCashierStats = (cashierId) => {
          const cReceipts = receiptsList.filter((r) => {
            const cid = r.cashierId?._id || r.cashierId?.id || r.cashierId;
            return String(cid) === String(cashierId);
          });
          const collected = cReceipts.reduce((sum, r) => sum + (Number(r.amountPaid) || 0), 0);
          return { collected, count: cReceipts.length };
        };

        const filteredDeletedReceipts = deletedReceiptsList.filter((rc) => {
          const pat = rc.patientId || rc.invoiceId?.patientId || {};
          const name = `${pat.firstName || ''} ${pat.lastName || ''}`.toLowerCase();
          const uhid = (pat.uhid || '').toLowerCase();
          const rcNo = (rc.receiptNo || '').toLowerCase();
          const invNo = (rc.invoiceId?.invoiceNo || rc.invoiceNo || '').toLowerCase();
          const reason = (rc.deletionReason || '').toLowerCase();
          const deletedBy = (rc.deletedByName || rc.deletedBy?.name || '').toLowerCase();
          const cashier = (rc.cashierId?.name || '').toLowerCase();
          const q = deletedBillingSearch.toLowerCase();
          return name.includes(q) || uhid.includes(q) || rcNo.includes(q) || invNo.includes(q) || reason.includes(q) || deletedBy.includes(q) || cashier.includes(q);
        });

        const unpaidInvoices = invoicesList.filter((i) => i.status !== 'PAID' && !i.isDeleted);
        const filteredUnpaidInvoices = unpaidInvoices.filter((inv) => {
          const pat = inv.patientId || {};
          const name = `${pat.firstName || ''} ${pat.lastName || ''}`.toLowerCase();
          const uhid = (pat.uhid || '').toLowerCase();
          const invNo = (inv.invoiceNo || '').toLowerCase();
          const doc = (inv.doctorName || inv.doctorId?.name || '').toLowerCase();
          const q = pendingBillingSearch.toLowerCase();
          return name.includes(q) || uhid.includes(q) || invNo.includes(q) || doc.includes(q);
        });

        return (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-neutral-900 tracking-tight flex items-center gap-2">
                  <CreditCard className="text-indigo-600" size={26} />
                  Billing & Revenue Management Desk
                </h2>
                <p className="text-xs text-neutral-500 mt-1">
                  Executive Financial Analytics, Pending Unpaid Bills, Cashier Collections & Voided Bills Audit Trail
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => navigate(formatTenantPath('/billing/dashboard?tab=RECEIPTS'))}>
                  <FileSpreadsheet size={15} /> Receipts & Paid Ledger
                </Button>
                <Button variant="primary" size="sm" onClick={navigateToStaff}>
                  <UserCog size={16} /> Manage Billing Staff
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard title="Active Revenue (Net)" value={`₹${billingSummary.totalRevenue.toLocaleString()}`} subtitle="Valid Paid Receipts (Excludes Voided)" icon={CreditCard} color="emerald" />
              <StatCard title="Pending Unpaid Bills" value={`${unpaidInvoices.length} Invoices`} subtitle="Awaiting Cashier Payment" icon={Clock} color={unpaidInvoices.length > 0 ? 'amber' : 'sky'} />
              <StatCard title="Active Receipts Issued" value={`${billingSummary.totalBills} Receipts`} subtitle="Cleared Patient Bills" icon={FileSpreadsheet} color="purple" />
              <StatCard title="Deleted / Voided Bills" value={`${billingSummary.deletedBillsCount || 0} Voided`} subtitle={`₹${(billingSummary.totalDeletedRevenue || 0).toLocaleString()} Excluded from Revenue`} icon={Trash2} color="rose" />
            </div>

            {/* Live Unpaid Bills & Pending Cashier Collections Queue */}
            <Card className="border-amber-200 bg-amber-50/20 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-amber-200">
                <div>
                  <h3 className="text-base font-bold text-amber-950 flex items-center gap-2">
                    <Clock size={18} className="text-amber-600" />
                    Live Unpaid Bills & Pending Cashier Collections ({unpaidInvoices.length})
                  </h3>
                  <p className="text-xs text-amber-700/80">
                    Real-time patient bills awaiting cashier settlement from OPD consultations and pharmacy dispensing.
                  </p>
                </div>

                <div className="relative w-full sm:w-72">
                  <input
                    type="text"
                    placeholder="Search pending bill, patient, UHID..."
                    value={pendingBillingSearch}
                    onChange={(e) => setPendingBillingSearch(e.target.value)}
                    className="w-full glass-input rounded-xl py-2 pl-9 pr-3 text-xs text-slate-900 border-amber-300 focus:border-amber-500"
                  />
                  <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                </div>
              </div>

              <div className="border border-amber-200 rounded-xl overflow-x-auto overflow-y-auto max-h-[520px] bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-amber-100/95 backdrop-blur-xs text-amber-900 uppercase text-[10px] border-b border-amber-200 font-bold shadow-2xs">
                    <tr>
                      <th className="p-3 bg-amber-100">Invoice Number</th>
                      <th className="p-3 bg-amber-100">Patient Details</th>
                      <th className="p-3 bg-amber-100">Attending Doctor</th>
                      <th className="p-3 bg-amber-100">Billed Items Breakdown</th>
                      <th className="p-3 bg-amber-100 text-right">Bill Total</th>
                      <th className="p-3 bg-amber-100 text-right">Balance Due</th>
                      <th className="p-3 bg-amber-100">Status</th>
                      <th className="p-3 bg-amber-100 text-right">Audit &amp; View</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100 text-slate-800">
                    {filteredUnpaidInvoices.length > 0 ? (
                      filteredUnpaidInvoices.map((inv) => {
                        const pat = inv.patientId || {};
                        const items = inv.items || [];
                        return (
                          <tr key={inv._id} className="hover:bg-amber-50/40 transition-colors">
                            <td className="p-3">
                              <span className="font-mono font-bold text-indigo-700 text-xs">{inv.invoiceNo || 'INV'}</span>
                              <p className="text-[10px] text-slate-400 font-mono">
                                {inv.createdAt ? new Date(inv.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                              </p>
                            </td>
                            <td className="p-3">
                              <p className="font-bold text-slate-900">{pat.firstName} {pat.lastName}</p>
                              <p className="text-slate-500 text-[10px] font-mono">
                                UHID: {pat.uhid || '—'} {pat.phone && `• ${pat.phone}`}
                              </p>
                            </td>
                            <td className="p-3 font-semibold text-slate-700">
                              {inv.doctorName || inv.doctorId?.name || 'Medical Officer'}
                            </td>
                            <td className="p-3 max-w-[220px]">
                              <div className="space-y-0.5">
                                {items.slice(0, 2).map((it, idx) => (
                                  <p key={idx} className="text-[11px] text-slate-700 truncate font-medium">
                                    • {it.description} (₹{it.totalPrice || it.unitPrice})
                                  </p>
                                ))}
                                {items.length > 2 && (
                                  <p className="text-[10px] text-slate-400 font-semibold">
                                    +{items.length - 2} more item(s)
                                  </p>
                                )}
                              </div>
                            </td>
                            <td className="p-3 text-right font-bold text-slate-900">
                              ₹{(inv.grandTotal || inv.subtotal || 0).toLocaleString()}
                            </td>
                            <td className="p-3 text-right font-extrabold text-amber-700 font-mono text-sm">
                              ₹{(inv.balanceAmount ?? inv.grandTotal ?? 0).toLocaleString()}
                            </td>
                            <td className="p-3">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300">
                                {inv.status || 'UNPAID'}
                              </span>
                            </td>
                            <td className="p-3 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                className="bg-white hover:bg-slate-50 text-slate-800 border-slate-300 font-bold text-[11px] flex items-center gap-1.5 ml-auto shadow-2xs"
                                onClick={() => setSelectedInvoiceForView(inv)}
                              >
                                <Eye size={13} className="text-indigo-600" /> View Breakdown
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={8} className="p-6 text-center text-slate-400 font-medium">
                          {pendingBillingSearch ? 'No matching unpaid bills found.' : 'All bills settled. No pending patient payments in queue.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Cashiers Roster & Real Collections */}
            <Card>
              <h3 className="text-base font-bold text-neutral-900 mb-4 flex items-center gap-2">
                <ShieldCheck size={18} className="text-indigo-600" />
                Billing Cashiers & Counter Performance ({billingStaff.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-100 text-neutral-600 uppercase text-[10px] border-b border-neutral-200">
                    <tr>
                      <th className="p-3">Cashier Name</th>
                      <th className="p-3">Login Email</th>
                      <th className="p-3">Total Active Collections</th>
                      <th className="p-3">Receipts Processed</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 text-neutral-800">
                    {billingStaff.map((b) => {
                      const stats = getCashierStats(b._id);
                      return (
                        <tr key={b._id} className="hover:bg-neutral-50">
                          <td className="p-3 font-bold text-neutral-900">{b.name}</td>
                          <td className="p-3 font-mono text-neutral-500">{b.email}</td>
                          <td className="p-3 font-bold text-emerald-700 font-mono">₹{stats.collected.toLocaleString()}</td>
                          <td className="p-3 font-bold text-neutral-800">{stats.count} Receipts</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${b.isActive !== false ? 'bg-emerald-50 text-emerald-700 border border-emerald-300' : 'bg-rose-50 text-rose-700 border border-rose-300'}`}>
                              {b.isActive !== false ? 'ACTIVE' : 'INACTIVE'}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <Button size="sm" variant="outline" className="text-[11px]" onClick={navigateToStaff}>
                              <Edit size={13} /> Edit Access
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Deleted Bills & Audit Trail Table */}
            <Card className="border-rose-200 bg-rose-50/20 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-rose-200">
                <div>
                  <h3 className="text-base font-bold text-rose-950 flex items-center gap-2">
                    <Trash2 size={18} className="text-rose-600" />
                    Deleted Bills & Voided Receipts Audit Trail ({deletedReceiptsList.length})
                  </h3>
                  <p className="text-xs text-rose-700/80">
                    Complete oversight of all voided patient bills, who billed them, who deleted them, reasons, and timestamps.
                  </p>
                </div>

                <div className="relative w-full sm:w-72">
                  <input
                    type="text"
                    placeholder="Search deleted bills, cashier, reason..."
                    value={deletedBillingSearch}
                    onChange={(e) => setDeletedBillingSearch(e.target.value)}
                    className="w-full glass-input rounded-xl py-2 pl-9 pr-3 text-xs text-slate-900 border-rose-300 focus:border-rose-500"
                  />
                  <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                </div>
              </div>

              <div className="border border-rose-200 rounded-xl overflow-hidden bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="bg-rose-100/60 text-rose-900 uppercase text-[10px] border-b border-rose-200">
                    <tr>
                      <th className="p-3">Receipt / Invoice</th>
                      <th className="p-3">Patient Details</th>
                      <th className="p-3 text-right">Voided Amount</th>
                      <th className="p-3">Billed By</th>
                      <th className="p-3">Deleted By</th>
                      <th className="p-3">Mandatory Deletion Reason</th>
                      <th className="p-3 text-center">Date & Time Deleted</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rose-100 text-slate-800">
                    {filteredDeletedReceipts.length > 0 ? (
                      filteredDeletedReceipts.map((rc) => {
                        const pat = rc.patientId || rc.invoiceId?.patientId || {};
                        const rcDocObj = rc.invoiceId?.doctorId || rc.invoiceId?.consultation?.doctorId;
                        const rcDocName = rc.invoiceId?.doctorName || rcDocObj?.name || rc.invoiceId?.consultation?.doctorId?.name;
                        return (
                          <tr key={rc._id} className="hover:bg-rose-50/40">
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
                              ₹{(rc.amountPaid || rc.grandTotal || 0).toLocaleString()}
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
                              <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-900 font-medium text-[11px]">
                                {rc.deletionReason || 'Reason not specified'}
                              </div>
                            </td>
                            <td className="p-3 text-center text-slate-500 text-[11px]">
                              {rc.deletedAt
                                ? new Date(rc.deletedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
                                : new Date(rc.updatedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                            </td>
                            <td className="p-3 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                className="bg-white hover:bg-rose-50 text-rose-900 border-rose-200 font-bold text-[11px] flex items-center gap-1.5 ml-auto shadow-2xs"
                                onClick={() => setSelectedInvoiceForView(rc.invoiceId || rc)}
                              >
                                <Eye size={13} className="text-rose-600" /> View Breakdown
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-slate-500 text-xs">
                          {deletedReceiptsList.length === 0
                            ? 'No deleted bills in the hospital record. All billing collections are 100% active.'
                            : 'No matching deleted bills found for this search.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Read-Only Bill Breakdown Inspection Modal for Admin */}
            {selectedInvoiceForView && (
              <Modal
                isOpen={Boolean(selectedInvoiceForView)}
                onClose={() => setSelectedInvoiceForView(null)}
                title={`Invoice Audit & Breakdown — ${selectedInvoiceForView.invoiceNo || 'INV'}`}
                subtitle="Read-Only Executive Financial Audit"
                icon={CreditCard}
                maxWidth="max-w-2xl"
              >
                <div className="space-y-4 text-xs">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase">Patient Name</p>
                      <p className="font-bold text-slate-900 text-sm">
                        {selectedInvoiceForView.patientId?.firstName || ''} {selectedInvoiceForView.patientId?.lastName || ''}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase">UHID</p>
                      <p className="font-mono font-bold text-indigo-700">
                        {selectedInvoiceForView.patientId?.uhid || selectedInvoiceForView.uhid || '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase">Attending Doctor</p>
                      <p className="font-semibold text-slate-800">
                        {selectedInvoiceForView.doctorName || selectedInvoiceForView.doctorId?.name || 'Medical Officer'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase">Invoice Date</p>
                      <p className="text-slate-700">
                        {selectedInvoiceForView.createdAt ? new Date(selectedInvoiceForView.createdAt).toLocaleString() : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase">Payment Status</p>
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black ${
                        selectedInvoiceForView.status === 'PAID' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {selectedInvoiceForView.status || 'UNPAID'}
                      </span>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase">Balance Due</p>
                      <p className="font-mono font-extrabold text-amber-700 text-sm">
                        ₹{(selectedInvoiceForView.balanceAmount ?? selectedInvoiceForView.grandTotal ?? 0).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  {/* Items breakdown table */}
                  <div>
                    <h4 className="font-bold text-slate-900 mb-2">Billed Line Items</h4>
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 text-slate-700 uppercase text-[10px] font-bold">
                          <tr>
                            <th className="p-2.5">Item Description</th>
                            <th className="p-2.5">Category</th>
                            <th className="p-2.5 text-center">Qty</th>
                            <th className="p-2.5 text-right">Unit Price</th>
                            <th className="p-2.5 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(selectedInvoiceForView.items || []).map((it, idx) => (
                            <tr key={idx} className="hover:bg-slate-50">
                              <td className="p-2.5 font-bold text-slate-800">{it.description || 'Service / Item'}</td>
                              <td className="p-2.5 text-slate-500 text-[11px]">{it.itemType || it.category || 'General'}</td>
                              <td className="p-2.5 text-center font-mono">{it.quantity || 1}</td>
                              <td className="p-2.5 text-right font-mono">₹{(it.unitPrice || 0).toLocaleString()}</td>
                              <td className="p-2.5 text-right font-mono font-bold text-slate-900">₹{(it.totalPrice || it.unitPrice || 0).toLocaleString()}</td>
                            </tr>
                          ))}
                          {(!selectedInvoiceForView.items || selectedInvoiceForView.items.length === 0) && (
                            <tr>
                              <td colSpan={5} className="p-4 text-center text-slate-400">No item breakdown available.</td>
                            </tr>
                          )}
                        </tbody>
                        <tfoot className="bg-slate-50 border-t border-slate-200 font-bold">
                          <tr>
                            <td colSpan={4} className="p-2.5 text-right text-slate-600">Grand Total:</td>
                            <td className="p-2.5 text-right font-mono text-slate-900 text-sm">
                              ₹{(selectedInvoiceForView.grandTotal || selectedInvoiceForView.subtotal || 0).toLocaleString()}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  {/* Admin Notice */}
                  <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-200 text-[11px] text-indigo-900 flex items-start gap-2">
                    <AlertCircle size={15} className="text-indigo-600 shrink-0 mt-0.5" />
                    <p>
                      <strong>Administrative Read-Only Mode:</strong> As an Administrator, you can audit all unpaid and completed bills. Payment collection and official receipt generation are handled at the Cashier Workstation by authorized billing staff in Work Mode.
                    </p>
                  </div>

                  <div className="flex justify-end pt-2">
                    <Button variant="outline" size="sm" onClick={() => setSelectedInvoiceForView(null)}>
                      Close Inspection
                    </Button>
                  </div>
                </div>
              </Modal>
            )}
          </div>
        );
      }

      case 'laboratory': {
        const labStaff = getFilteredStaff(['LAB_TECH', 'LABORATORY_STAFF']);
        const labOrders = diagnosticOrdersList.filter((o) => !['XRAY', 'MRI', 'CT_SCAN', 'ULTRASOUND', 'RADIOLOGY'].includes(o.testCategory));
        const completedLab = labOrders.filter((o) => ['REPORT_UPLOADED', 'COMPLETED', 'REVIEWED'].includes(o.status)).length;
        const pendingLab = labOrders.filter((o) => ['REQUESTED', 'DEPARTMENT_RECEIVED', 'ACCEPTED', 'IN_PROGRESS'].includes(o.status) && o.chargeStatus !== 'CANCELLED').length;

        return (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-neutral-900 tracking-tight flex items-center gap-2">
                  <TestTube className="text-indigo-600" size={26} />
                  Laboratory & Pathology Management Desk
                </h2>
                <p className="text-xs text-neutral-500 mt-1">
                  Executive Lab Roster, Diagnostic Sample Intake Metrics & Test Completion Reports
                </p>
              </div>
              <Button variant="primary" size="sm" onClick={navigateToStaff}>
                <UserCog size={16} /> Manage Laboratory Staff
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard title="Lab Technicians" value={`${labStaff.length} ${labStaff.length === 1 ? 'Tech' : 'Techs'}`} subtitle="Pathology Specialists" icon={TestTube} color="purple" />
              <StatCard title="Samples Processed" value={`${completedLab} ${completedLab === 1 ? 'Sample' : 'Samples'}`} subtitle="CBC, Urine & Blood Culture" icon={CheckCircle} color="emerald" />
              <StatCard title="Pending Lab Orders" value={`${pendingLab} ${pendingLab === 1 ? 'Order' : 'Orders'}`} subtitle="Awaiting Sign-Off" icon={Clock} color="amber" />
              <StatCard title="Report Accuracy" value="100%" subtitle="Quality Assurance" icon={TrendingUp} color="sky" />
            </div>

            <Card>
              <h3 className="text-base font-bold text-neutral-900 mb-4 flex items-center gap-2">
                <ShieldCheck size={18} className="text-indigo-600" />
                Laboratory Staff Roster ({labStaff.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-100 text-neutral-600 uppercase text-[10px] border-b border-neutral-200">
                    <tr>
                      <th className="p-3">Technician Name</th>
                      <th className="p-3">Email</th>
                      <th className="p-3">Tests Processed Today</th>
                      <th className="p-3">Shift</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 text-neutral-800">
                    {labStaff.map((l) => {
                      const techTests = labOrders.filter((o) => String(o.uploadedBy?._id || o.uploadedBy) === String(l._id)).length;
                      const displayTests = techTests > 0 ? techTests : (labStaff.length === 1 ? completedLab : 0);

                      return (
                        <tr key={l._id} className="hover:bg-neutral-50">
                          <td className="p-3 font-bold text-neutral-900">{l.name}</td>
                          <td className="p-3 font-mono text-neutral-500">{l.email}</td>
                          <td className="p-3 font-bold text-neutral-800">
                            {displayTests} {displayTests === 1 ? 'Test' : 'Tests'}
                          </td>
                          <td className="p-3 text-neutral-600">{l.shiftDetails || 'Morning Shift'}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${l.isActive !== false ? 'bg-emerald-50 text-emerald-700 border border-emerald-300' : 'bg-rose-50 text-rose-700 border border-rose-300'}`}>
                              {l.isActive !== false ? 'ACTIVE' : 'INACTIVE'}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <Button size="sm" variant="outline" className="text-[11px]" onClick={navigateToStaff}>
                              <Edit size={13} /> Edit Access
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        );
      }

      case 'radiology': {
        const radioStaff = getFilteredStaff(['RADIOLOGIST', 'RADIOLOGY_STAFF']);
        const radioOrders = diagnosticOrdersList.filter((o) => ['XRAY', 'MRI', 'CT_SCAN', 'ULTRASOUND', 'RADIOLOGY'].includes(o.testCategory));
        const completedRadio = radioOrders.filter((o) => ['REPORT_UPLOADED', 'COMPLETED', 'REVIEWED'].includes(o.status)).length;
        const pendingRadio = radioOrders.filter((o) => ['REQUESTED', 'DEPARTMENT_RECEIVED', 'ACCEPTED', 'IN_PROGRESS'].includes(o.status) && o.chargeStatus !== 'CANCELLED').length;

        return (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-neutral-900 tracking-tight flex items-center gap-2">
                  <Scan className="text-indigo-600" size={26} />
                  Radiology & PACS Imaging Management
                </h2>
                <p className="text-xs text-neutral-500 mt-1">
                  Radiologist Roster, Modality Statistics (CT Scan, MRI, X-Ray, USG) & DICOM Report Sign-offs
                </p>
              </div>
              <Button variant="primary" size="sm" onClick={navigateToStaff}>
                <UserCog size={16} /> Manage Radiology Staff
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard title="Radiologists & Techs" value={`${radioStaff.length} Specialists`} subtitle="PACS RIS Desk" icon={Scan} color="indigo" />
              <StatCard title="Scans Completed" value={`${completedRadio} ${completedRadio === 1 ? 'Scan' : 'Scans'}`} subtitle="CT, MRI, X-Ray, USG" icon={CheckCircle} color="emerald" />
              <StatCard title="Pending DICOM Reports" value={`${pendingRadio} ${pendingRadio === 1 ? 'Report' : 'Reports'}`} subtitle="Awaiting Review" icon={Clock} color="amber" />
              <StatCard title="Modality Uptime" value="100%" subtitle="PACS Server Active" icon={TrendingUp} color="sky" />
            </div>

            <Card>
              <h3 className="text-base font-bold text-neutral-900 mb-4 flex items-center gap-2">
                <ShieldCheck size={18} className="text-indigo-600" />
                Radiology Personnel Roster ({radioStaff.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-100 text-neutral-600 uppercase text-[10px] border-b border-neutral-200">
                    <tr>
                      <th className="p-3">Radiologist Name</th>
                      <th className="p-3">Email</th>
                      <th className="p-3">Modality / Unit</th>
                      <th className="p-3">Scans Conducted Today</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 text-neutral-800">
                    {radioStaff.map((r) => {
                      const radScans = radioOrders.filter((o) => String(o.uploadedBy?._id || o.uploadedBy) === String(r._id)).length;
                      const displayScans = radScans > 0 ? radScans : (radioStaff.length === 1 ? completedRadio : 0);

                      return (
                        <tr key={r._id} className="hover:bg-neutral-50">
                          <td className="p-3 font-bold text-neutral-900">{r.name}</td>
                          <td className="p-3 font-mono text-neutral-500">{r.email}</td>
                          <td className="p-3 font-semibold text-neutral-700">{r.assignedUnit || 'PACS / CT / X-Ray'}</td>
                          <td className="p-3 font-bold text-neutral-800">
                            {displayScans} {displayScans === 1 ? 'Scan' : 'Scans'}
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${r.isActive !== false ? 'bg-emerald-50 text-emerald-700 border border-emerald-300' : 'bg-rose-50 text-rose-700 border border-rose-300'}`}>
                              {r.isActive !== false ? 'ACTIVE' : 'INACTIVE'}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <Button size="sm" variant="outline" className="text-[11px]" onClick={navigateToStaff}>
                              <Edit size={13} /> Edit Access
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        );
      }

      case 'pharmacy': {
        const pharmStaff = getFilteredStaff(['PHARMACIST', 'PHARMACY_STAFF']);
        const filledPrescriptions = prescriptionsList.filter((p) => ['DISPENSED', 'BILLED_SENT_TO_DOCTOR'].includes(p.dispenseStatus)).length;
        const totalDrugs = medicinesList.length;
        const nearExpiryCount = medicinesList.filter((m) =>
          Array.isArray(m.batches) && m.batches.some((b) => b.expiryDate && (new Date(b.expiryDate) - new Date()) / (1000 * 60 * 60 * 24) <= 30)
        ).length;
        const lowStockCount = medicinesList.filter((m) => {
          const qty = m.totalQuantity ?? m.currentStock ?? 0;
          const min = m.minimumStockLevel ?? 20;
          return qty <= min;
        }).length;
        const totalUnits = medicinesList.reduce((sum, m) => sum + (m.totalQuantity ?? m.currentStock ?? 0), 0);

        const filteredMeds = medicinesList.filter((m) => {
          if (!pharmacyStockSearch) return true;
          const q = pharmacyStockSearch.toLowerCase();
          const name = (m.name || '').toLowerCase();
          const gen = (m.genericName || '').toLowerCase();
          const cat = (m.category || '').toLowerCase();
          return name.includes(q) || gen.includes(q) || cat.includes(q);
        });

        return (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-neutral-900 tracking-tight flex items-center gap-2">
                  <Pill className="text-indigo-600" size={26} />
                  Pharmacy & Stock Inventory Management
                </h2>
                <p className="text-xs text-neutral-500 mt-1">
                  Real-Time Medicine Stock Levels, FEFO Batches, Low Stock Predictions & Pharmacist Oversight
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1.5 shadow-xs"
                  onClick={() => navigate(formatTenantPath('/pharmacy/stock'))}
                >
                  <Boxes size={15} /> Open FEFO Stock & Prediction Desk <ExternalLink size={13} />
                </Button>
                <Button variant="outline" size="sm" onClick={navigateToStaff}>
                  <UserCog size={16} /> Manage Pharmacy Staff
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard title="Total Medicine SKUs" value={`${totalDrugs} Drugs`} subtitle={`${totalUnits.toLocaleString()} Total Units in Stock`} icon={Boxes} color="sky" />
              <StatCard title="Low Stock / Depletion" value={`${lowStockCount} ${lowStockCount === 1 ? 'Alert' : 'Alerts'}`} subtitle="Below Safety Minimum" icon={AlertCircle} color={lowStockCount > 0 ? 'rose' : 'emerald'} />
              <StatCard title="Near Expiry Warnings" value={`${nearExpiryCount} ${nearExpiryCount === 1 ? 'Batch' : 'Batches'}`} subtitle="30-Day Expiry Alerts" icon={Clock} color={nearExpiryCount > 0 ? 'amber' : 'sky'} />
              <StatCard title="Prescriptions Filled" value={`${filledPrescriptions} Prescriptions`} subtitle="FEFO Auto-Batched" icon={CheckCircle} color="emerald" />
            </div>

            {/* Central Pharmacy Stock & Inventory Table */}
            <Card className="border-indigo-100 bg-white space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200">
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Boxes size={18} className="text-indigo-600" />
                    Current Pharmacy Medicine Stock ({filteredMeds.length} of {medicinesList.length})
                  </h3>
                  <p className="text-xs text-slate-500">
                    Live inventory on hospital pharmacy shelves with current units, safety buffers, and batch counts.
                  </p>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-72">
                    <input
                      type="text"
                      placeholder="Search brand, generic name, category..."
                      value={pharmacyStockSearch}
                      onChange={(e) => setPharmacyStockSearch(e.target.value)}
                      className="w-full glass-input rounded-xl py-2 pl-9 pr-3 text-xs text-slate-900 border-slate-300 focus:border-indigo-500"
                    />
                    <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs font-semibold whitespace-nowrap"
                    onClick={() => navigate(formatTenantPath('/pharmacy/stock'))}
                  >
                    <Plus size={13} className="mr-1 text-emerald-600" /> Add / Restock
                  </Button>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-700 uppercase text-[10px] font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3">Medicine & Generic Name</th>
                      <th className="p-3">Category & Form</th>
                      <th className="p-3">Current Stock</th>
                      <th className="p-3">Safety Buffer</th>
                      <th className="p-3">Unit Sell Price</th>
                      <th className="p-3">Batches on Shelf</th>
                      <th className="p-3 text-right">Quick Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-800">
                    {filteredMeds.length > 0 ? (
                      filteredMeds.map((med) => {
                        const currQty = med.totalQuantity ?? med.currentStock ?? 0;
                        const minStock = med.minimumStockLevel ?? 20;
                        const isOutOfStock = currQty === 0;
                        const isLowStock = !isOutOfStock && currQty <= minStock;
                        const batchesCount = Array.isArray(med.batches) ? med.batches.length : 0;

                        return (
                          <tr key={med._id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="p-3">
                              <p className="font-bold text-slate-900">{med.name}</p>
                              <p className="text-[10px] text-slate-500">{med.genericName || 'Standard Formulation'}</p>
                            </td>
                            <td className="p-3">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                {med.dosageForm || med.category || 'Medication'} {med.strength ? `(${med.strength})` : ''}
                              </span>
                            </td>
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                <span className={`font-mono font-bold text-sm ${isOutOfStock ? 'text-rose-600' : isLowStock ? 'text-amber-700' : 'text-emerald-700'}`}>
                                  {currQty}
                                </span>
                                <span className={`px-2 py-0.2 rounded-full text-[9px] font-black ${
                                  isOutOfStock ? 'bg-rose-100 text-rose-800 border border-rose-200' :
                                  isLowStock ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                                  'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                }`}>
                                  {isOutOfStock ? 'OUT OF STOCK' : isLowStock ? 'LOW STOCK' : 'HEALTHY'}
                                </span>
                              </div>
                            </td>
                            <td className="p-3 text-slate-500 font-mono text-xs">
                              Min {minStock} units
                            </td>
                            <td className="p-3 font-mono font-semibold text-slate-900">
                              ₹{med.unitSellingPrice || med.sellingPrice || med.mrp || 0}
                            </td>
                            <td className="p-3">
                              <span className="font-semibold text-slate-700 text-xs">
                                {batchesCount} {batchesCount === 1 ? 'batch' : 'batches'}
                              </span>
                            </td>
                            <td className="p-3 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-[11px] font-bold text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                                onClick={() => navigate(formatTenantPath('/pharmacy/stock'))}
                              >
                                Manage Batches <ExternalLink size={12} className="ml-1" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-slate-400">
                          {pharmacyStockSearch ? 'No medicines match your search query.' : 'No medicines in inventory database.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Pharmacy Staff Roster */}
            <Card>
              <h3 className="text-base font-bold text-neutral-900 mb-4 flex items-center gap-2">
                <ShieldCheck size={18} className="text-indigo-600" />
                Pharmacy Staff Roster ({pharmStaff.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-100 text-neutral-600 uppercase text-[10px] border-b border-neutral-200">
                    <tr>
                      <th className="p-3">Pharmacist Name</th>
                      <th className="p-3">Email</th>
                      <th className="p-3">Prescriptions Dispensed Today</th>
                      <th className="p-3">Shift</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 text-neutral-800">
                    {pharmStaff.map((p) => {
                      const pharmDispenses = prescriptionsList.filter((rx) => String(rx.dispensedBy?._id || rx.dispensedBy) === String(p._id)).length;
                      const displayDispenses = pharmDispenses > 0 ? pharmDispenses : (pharmStaff.length === 1 ? filledPrescriptions : 0);

                      return (
                        <tr key={p._id} className="hover:bg-neutral-50">
                          <td className="p-3 font-bold text-neutral-900">{p.name}</td>
                          <td className="p-3 font-mono text-neutral-500">{p.email}</td>
                          <td className="p-3 font-bold text-neutral-800">
                            {displayDispenses} {displayDispenses === 1 ? 'Dispense' : 'Dispenses'}
                          </td>
                          <td className="p-3 text-neutral-600">{p.shiftDetails || 'Full-time Shift'}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${p.isActive !== false ? 'bg-emerald-50 text-emerald-700 border border-emerald-300' : 'bg-rose-50 text-rose-700 border border-rose-300'}`}>
                              {p.isActive !== false ? 'ACTIVE' : 'INACTIVE'}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <Button size="sm" variant="outline" className="text-[11px]" onClick={navigateToStaff}>
                              <Edit size={13} /> Edit Access
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        );
      }

      case 'patients': {
        const filteredPatients = patients.filter((pat) => {
          if (!patientSearchTerm.trim()) return true;
          const term = patientSearchTerm.toLowerCase();
          const name = (pat.name || `${pat.firstName || ''} ${pat.lastName || ''}`).toLowerCase();
          const uhid = (pat.uhid || '').toLowerCase();
          const phone = (pat.phone || '').toLowerCase();
          return name.includes(term) || uhid.includes(term) || phone.includes(term);
        });

        return (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-neutral-900 tracking-tight flex items-center gap-2">
                  <Users className="text-indigo-600" size={26} />
                  Hospital Patients Administrative Overview
                </h2>
                <p className="text-xs text-neutral-500 mt-1">
                  Executive Patient Directory, OPD/IPD Census, Category Allocations & Billing Status (Read-Only Management View)
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard title="Total Registered Patients" value={`${patients.length} UHIDs`} subtitle="Master Patient Index" icon={Users} color="sky" />
              <StatCard title="Active OPD Patients" value={`${patients.filter(p => p.admissionStatus !== 'ACTIVE_ADMISSION').length} Patients`} subtitle="Queued / In Consultation" icon={TrendingUp} color="emerald" />
              <StatCard title="Admitted IPD Patients" value={`${patients.filter(p => p.admissionStatus === 'ACTIVE_ADMISSION').length} Patients`} subtitle="Ward Bed Matrix" icon={BedDouble} color="purple" />
              <StatCard title="Emergency Admissions" value={`${patients.filter(p => p.category === 'EMERGENCY' || p.admissionStatus === 'EMERGENCY').length} Patients`} subtitle="Trauma / ICU Care" icon={ShieldAlert} color="rose" />
            </div>

            <Card>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-base font-bold text-neutral-900 flex items-center gap-2">
                    <ShieldCheck size={18} className="text-indigo-600" />
                    Patient Administrative Register ({filteredPatients.length}
                    {patientSearchTerm.trim() && ` of ${patients.length}`})
                  </h3>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Live patient administrative directory with real-time record management and deletion controls
                  </p>
                </div>
                <div className="relative w-full sm:w-72">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search patient, UHID, phone..."
                    value={patientSearchTerm}
                    onChange={(e) => setPatientSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-8 py-1.5 text-xs bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 text-neutral-800"
                  />
                  {patientSearchTerm && (
                    <button
                      type="button"
                      onClick={() => setPatientSearchTerm('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 text-xs font-bold"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-100 text-neutral-600 uppercase text-[10px] border-b border-neutral-200">
                    <tr>
                      <th className="p-3">Patient Name & UHID</th>
                      <th className="p-3">Phone & Age/Gender</th>
                      <th className="p-3">Category</th>
                      <th className="p-3">Current Status</th>
                      <th className="p-3">Registration Date</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 text-neutral-800">
                    {filteredPatients.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-neutral-500 text-xs">
                          {patientSearchTerm ? 'No patients matching your search criteria.' : 'No registered patients found.'}
                        </td>
                      </tr>
                    ) : (
                      filteredPatients.map((pat) => {
                        const patientFullName = pat.name || `${pat.firstName || ''} ${pat.lastName || ''}`.trim() || 'Patient';
                        const statusLabel = pat.admissionStatus === 'ACTIVE_ADMISSION' ? 'ADMITTED (IPD)' : (pat.admissionStatus === 'DISCHARGED' ? 'DISCHARGED' : 'REGISTERED (OPD)');
                        const statusClass = pat.admissionStatus === 'ACTIVE_ADMISSION' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200';
                        return (
                          <tr key={pat._id || pat.uhid} className="hover:bg-neutral-50 transition-colors">
                            <td className="p-3 font-bold text-neutral-900">
                              {patientFullName}
                              <p className="text-[10px] font-mono text-indigo-600">{pat.uhid}</p>
                            </td>
                            <td className="p-3">
                              <p className="font-medium text-neutral-800">{pat.phone || 'N/A'}</p>
                              <p className="text-[10px] text-neutral-500">{pat.age ? `${pat.age} yrs` : 'Adult'} • {pat.gender || 'General'}</p>
                            </td>
                            <td className="p-3 font-semibold text-neutral-700">{pat.category || 'GENERAL'}</td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${statusClass}`}>
                                {statusLabel}
                              </span>
                            </td>
                            <td className="p-3 text-neutral-500">
                              {new Date(pat.createdAt || Date.now()).toLocaleDateString()}
                            </td>
                            <td className="p-3 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteError('');
                                  setPatientToDelete(pat);
                                }}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-rose-600 hover:text-white bg-rose-50 hover:bg-rose-600 border border-rose-200 hover:border-rose-600 rounded-lg transition-all shadow-2xs hover:shadow-xs active:scale-95 cursor-pointer"
                                title={`Delete ${patientFullName}`}
                              >
                                <Trash2 size={13} />
                                <span>Delete</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        );
      }

      default: {
        return (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-neutral-900 tracking-tight capitalize flex items-center gap-2">
              <ShieldCheck className="text-indigo-600" size= {26} />
              {viewType} Department Executive Management View
            </h2>
            <p className="text-xs text-neutral-500">
              Executive Data Summary, Operational Statistics & Staff Roster Controls
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard title="Department Roster" value={`${staffList.length} Accounts`} subtitle="Configured Staff" icon={Users} color="sky" />
              <StatCard title="Operational Status" value="ACTIVE" subtitle="Real-time Sync" icon={CheckCircle} color="emerald" />
              <StatCard title="Daily Activity" value="Normal" subtitle="Zero Escalations" icon={TrendingUp} color="purple" />
            </div>
          </div>
        );
      }
    }
  };

  return (
    <div className="animate-fade-in">
      {renderViewContent()}

      {/* Patient Delete Confirmation Modal */}
      {patientToDelete && (
        <Modal
          isOpen={Boolean(patientToDelete)}
          onClose={() => {
            if (!isDeletingPatient) {
              setPatientToDelete(null);
              setDeleteError('');
            }
          }}
          title="Delete Patient Record"
          subtitle="Permanent administrative deletion"
          icon={AlertCircle}
          maxWidth="max-w-md"
          footer={
            <div className="flex items-center justify-end gap-3 w-full">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPatientToDelete(null);
                  setDeleteError('');
                }}
                disabled={isDeletingPatient}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleDeletePatient}
                isLoading={isDeletingPatient}
                className="bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1.5"
              >
                <Trash2 size={14} />
                <span>{isDeletingPatient ? 'Deleting...' : 'Confirm Delete'}</span>
              </Button>
            </div>
          }
        >
          <div className="space-y-4 text-sm text-neutral-700">
            {deleteError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-start gap-2">
                <AlertCircle size={16} className="text-rose-600 shrink-0 mt-0.5" />
                <span>{deleteError}</span>
              </div>
            )}
            <p className="text-neutral-600 text-xs">
              Are you sure you want to permanently delete this patient record? This action cannot be undone.
            </p>
            <div className="p-3.5 bg-neutral-50 border border-neutral-200 rounded-xl space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="text-neutral-500 font-medium">Patient Name:</span>
                <span className="font-bold text-neutral-900">
                  {patientToDelete.name || `${patientToDelete.firstName || ''} ${patientToDelete.lastName || ''}`.trim() || 'Patient'}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-neutral-500 font-medium">UHID:</span>
                <span className="font-mono font-bold text-indigo-600">{patientToDelete.uhid}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-neutral-500 font-medium">Phone:</span>
                <span className="font-medium text-neutral-800">{patientToDelete.phone || 'N/A'}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-neutral-500 font-medium">Status:</span>
                <span className="font-semibold text-neutral-700">
                  {patientToDelete.admissionStatus === 'ACTIVE_ADMISSION' ? 'ADMITTED (IPD)' : (patientToDelete.admissionStatus === 'DISCHARGED' ? 'DISCHARGED' : 'REGISTERED (OPD)')}
                </span>
              </div>
            </div>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-xs flex items-start gap-2">
              <ShieldAlert size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>Warning:</strong> Deleting this patient will release any active bed assignment and clean up linked clinical appointments and prescription records from the register.
              </span>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

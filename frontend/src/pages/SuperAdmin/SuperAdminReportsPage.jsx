import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, useParams } from 'react-router-dom';
import {
  BarChart3, Scan, TestTube, Pill, Stethoscope, CreditCard, Users,
  Activity, Search, Download, Filter, FileText, CheckCircle2, Clock,
  Calendar, ShieldAlert, IndianRupee, Key, Edit, Lock, X,
  ConciergeBell, Building2, ShieldCheck, UserCheck, Check, ChevronRight
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { StatCard } from '../../components/ui/StatCard';
import { Button } from '../../components/ui/Button';
import { PasswordInput } from '../../components/ui/PasswordInput';
import { axiosClient } from '../../api/axiosClient';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/formatters';

export const SuperAdminReportsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { hospitalId } = useParams();
  const navigate = useNavigate();
  const rawMetric = searchParams.get('metric') || 'overview';
  const metric = rawMetric.toLowerCase();

  const [isLoading, setIsLoading] = useState(true);
  const [hospitals, setHospitals] = useState([]);
  const [selectedHospitalId, setSelectedHospitalId] = useState(hospitalId || 'ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Password Update Modal State
  const [selectedStaffForPassword, setSelectedStaffForPassword] = useState(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [passwordUpdateSuccess, setPasswordUpdateSuccess] = useState('');
  const [passwordUpdateError, setPasswordUpdateError] = useState('');

  // Domain Datasets
  const [allStaff, setAllStaff] = useState([]);
  const [hospitalAdminsData, setHospitalAdminsData] = useState([]);
  const [doctorsData, setDoctorsData] = useState([]);
  const [receptionData, setReceptionData] = useState([]);
  const [nursingData, setNursingData] = useState([]);
  const [labStaffData, setLabStaffData] = useState([]);
  const [radiologyStaffData, setRadiologyStaffData] = useState([]);
  const [pharmacyStaffData, setPharmacyStaffData] = useState([]);
  const [billingStaffData, setBillingStaffData] = useState([]);

  const [radiologyOrders, setRadiologyOrders] = useState([]);
  const [labOrders, setLabOrders] = useState([]);
  const [pharmacyData, setPharmacyData] = useState({ medicines: [], alerts: { lowStock: [], expired: [] } });
  const [invoices, setInvoices] = useState([]);
  const [patients, setPatients] = useState([]);
  const [nurseTasks, setNurseTasks] = useState([]);

  useEffect(() => {
    if (hospitalId) {
      setSelectedHospitalId(hospitalId);
    }
  }, [hospitalId]);

  const fetchReportsData = async () => {
    setIsLoading(true);
    try {
      const targetHospId = hospitalId || (selectedHospitalId !== 'ALL' ? selectedHospitalId : null);
      const queryParams = targetHospId ? `?hospitalId=${targetHospId}` : '?all=true&hospitalId=ALL';
      const reqHeaders = targetHospId ? { 'X-Hospital-Context': targetHospId } : { 'X-Hospital-Context': '' };

      const [hospRes, diagRes, pharmRes, staffRes, invRes, patRes, nurseRes] = await Promise.all([
        axiosClient.get('/saas/hospitals', { headers: reqHeaders }).catch(() => ({ data: [] })),
        axiosClient.get(`/diagnostics/orders${queryParams}`, { headers: reqHeaders }).catch(() => ({ data: [] })),
        axiosClient.get(`/pharmacy/medicines${queryParams}`, { headers: reqHeaders }).catch(() => ({ data: [] })),
        axiosClient.get(`/auth/staff${queryParams}`, { headers: reqHeaders }).catch(() => ({ data: [] })),
        axiosClient.get(`/billing/receipts${queryParams}`, { headers: reqHeaders }).catch(() => ({ data: [] })),
        axiosClient.get(`/patients${queryParams}`, { headers: reqHeaders }).catch(() => ({ data: [] })),
        axiosClient.get(`/pharmacy/nurse-tasks${queryParams}`, { headers: reqHeaders }).catch(() => ({ data: [] })),
      ]);

      const rawHospList = hospRes.data?.data || hospRes.data || [];
      const hospList = (Array.isArray(rawHospList) ? rawHospList : []).filter(
        (h) => !h.isDeleted && h.status !== 'DELETED'
      );
      setHospitals(hospList);
      const allOrders = diagRes.data || [];

      // Filter helper
      const filterByHosp = (list) => {
        if (!targetHospId) return list || [];
        return (list || []).filter(
          (item) => String(item.hospitalId?._id || item.hospitalId || item.hospital) === String(targetHospId)
        );
      };

      const rawStaff = (staffRes.data || []).filter((s) => s.role !== 'PATIENT' && s.role !== 'GUARDIAN');
      const hospStaff = targetHospId
        ? rawStaff.filter((s) => String(s.hospitalId?._id || s.hospitalId) === String(targetHospId))
        : rawStaff;

      setAllStaff(hospStaff);
      setHospitalAdminsData(hospStaff.filter((s) => ['HOSPITAL_ADMIN', 'ADMIN'].includes(String(s.role || '').toUpperCase()) || (Array.isArray(s.additionalRoles) && s.additionalRoles.includes('HOSPITAL_ADMIN'))));
      setDoctorsData(hospStaff.filter((s) => ['DOCTOR', 'PHYSICIAN'].includes(String(s.role || '').toUpperCase()) || (Array.isArray(s.additionalRoles) && s.additionalRoles.includes('DOCTOR'))));
      setReceptionData(hospStaff.filter((s) => ['RECEPTIONIST', 'RECEPTION', 'FRONT_DESK'].includes(String(s.role || '').toUpperCase()) || (Array.isArray(s.additionalRoles) && s.additionalRoles.includes('RECEPTIONIST'))));
      setNursingData(hospStaff.filter((s) => ['NURSE', 'NURSE_INCHARGE', 'NURSING', 'NURSE_STAFF'].includes(String(s.role || '').toUpperCase()) || (Array.isArray(s.additionalRoles) && (s.additionalRoles.includes('NURSE') || s.additionalRoles.includes('NURSE_INCHARGE')))));
      setLabStaffData(hospStaff.filter((s) => ['LAB_TECH', 'LABORATORY_STAFF', 'PATHOLOGIST'].includes(String(s.role || '').toUpperCase()) || (Array.isArray(s.additionalRoles) && s.additionalRoles.includes('LAB_TECH'))));
      setRadiologyStaffData(hospStaff.filter((s) => ['RADIOLOGIST', 'RADIOLOGY_STAFF'].includes(String(s.role || '').toUpperCase()) || (Array.isArray(s.additionalRoles) && s.additionalRoles.includes('RADIOLOGIST'))));
      setPharmacyStaffData(hospStaff.filter((s) => ['PHARMACIST', 'PHARMACY_STAFF'].includes(String(s.role || '').toUpperCase()) || (Array.isArray(s.additionalRoles) && s.additionalRoles.includes('PHARMACIST'))));
      setBillingStaffData(hospStaff.filter((s) => ['CASHIER', 'BILLING_STAFF', 'ACCOUNTANT'].includes(String(s.role || '').toUpperCase()) || (Array.isArray(s.additionalRoles) && s.additionalRoles.includes('CASHIER'))));

      setRadiologyOrders(filterByHosp(allOrders).filter((o) => ['XRAY', 'MRI', 'CT_SCAN', 'ULTRASOUND', 'RADIOLOGY'].includes(o.testCategory)));
      setLabOrders(filterByHosp(allOrders).filter((o) => ['LABORATORY', 'BLOOD_TEST', 'URINE_ANALYSIS', 'URINE_TEST', 'CULTURE_TEST', 'BIOPSY', 'PATHOLOGY'].includes(o.testCategory)));
      setPharmacyData({ medicines: filterByHosp(pharmRes.data || []), alerts: { lowStock: [], expired: [] } });
      setInvoices(filterByHosp(invRes.data || []));

      const rawPatients = patRes.data?.data || patRes.data || (Array.isArray(patRes) ? patRes : []);
      setPatients(filterByHosp(rawPatients));
      setNurseTasks(filterByHosp(nurseRes.data || []));
    } catch (err) {
      console.error('Failed to load reports data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReportsData();
  }, [hospitalId, selectedHospitalId]);

  const handleMetricChange = (newMetric) => {
    setSearchParams({ metric: newMetric });
  };

  const handleOpenPasswordModal = (staff) => {
    setSelectedStaffForPassword(staff);
    setNewPasswordInput('');
    setConfirmPasswordInput('');
    setPasswordUpdateSuccess('');
    setPasswordUpdateError('');
  };

  const handleSavePassword = async () => {
    if (!newPasswordInput || newPasswordInput.trim().length < 8) {
      setPasswordUpdateError('Password must be at least 8 characters long');
      return;
    }
    if (newPasswordInput !== confirmPasswordInput) {
      setPasswordUpdateError('New password and Confirm password do not match');
      return;
    }

    setIsUpdatingPassword(true);
    setPasswordUpdateError('');
    setPasswordUpdateSuccess('');

    try {
      await axiosClient.patch(`/auth/staff/${selectedStaffForPassword._id}/password`, {
        newPassword: newPasswordInput.trim()
      });

      const updateList = (prev) =>
        prev.map((d) =>
          d._id === selectedStaffForPassword._id
            ? d
            : d
        );

      setAllStaff(updateList);
      setDoctorsData(updateList);
      setReceptionData(updateList);
      setNursingData(updateList);
      setLabStaffData(updateList);
      setRadiologyStaffData(updateList);
      setPharmacyStaffData(updateList);
      setBillingStaffData(updateList);

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

  const hospMap = Object.fromEntries(hospitals.map((h) => [String(h._id), h.name]));

  const METRIC_TABS = [
    { id: 'overview', label: 'Executive Overview', icon: BarChart3 },
    { id: 'staff', label: 'All Staff Roster', icon: Users, count: allStaff.length },
    { id: 'hospital-admins', label: 'Hospital Admins', icon: ShieldCheck, count: hospitalAdminsData.length },
    { id: 'doctors', label: 'Doctors & Consults', icon: Stethoscope, count: doctorsData.length },
    { id: 'reception', label: 'Reception & Front Desk', icon: ConciergeBell, count: receptionData.length },
    { id: 'nursing', label: 'Nursing & Ward Tasks', icon: Activity, count: nursingData.length },
    { id: 'laboratory', label: 'Pathology & Lab', icon: TestTube, count: labStaffData.length },
    { id: 'radiology', label: 'Radiology & Imaging', icon: Scan, count: radiologyStaffData.length },
    { id: 'pharmacy', label: 'Pharmacy & Stock', icon: Pill, count: pharmacyStaffData.length },
    { id: 'billing', label: 'Billing & Cashiers', icon: CreditCard, count: billingStaffData.length },
    { id: 'patients', label: 'Patients & Admissions', icon: Users, count: patients.length },
  ];

  // Route alias resolution
  const activeTabId =
    ['hospital-admins', 'hospital-admin', 'admins', 'admin', 'hospitaladmins'].includes(metric) ? 'hospital-admins' :
    ['reception', 'receptionists'].includes(metric) ? 'reception' :
    ['staff', 'all-staff'].includes(metric) ? 'staff' :
    ['doctors', 'physicians'].includes(metric) ? 'doctors' :
    ['nursing', 'nurses'].includes(metric) ? 'nursing' :
    ['laboratory', 'lab', 'labstaff'].includes(metric) ? 'laboratory' :
    ['radiology', 'imaging', 'radiologystaff'].includes(metric) ? 'radiology' :
    ['pharmacy', 'inventory', 'pharmacystaff'].includes(metric) ? 'pharmacy' :
    ['billing', 'finance', 'billingstaff'].includes(metric) ? 'billing' :
    ['patients', 'opd', 'ipd'].includes(metric) ? 'patients' :
    'overview';

  // Render Staff Roster Table (Reusable)
  const renderStaffTable = (staffList, title, icon) => {
    const Icon = icon || Users;
    const filtered = staffList.filter((s) => {
      const search = searchTerm.toLowerCase();
      const name = (s.name || '').toLowerCase();
      const email = (s.email || '').toLowerCase();
      const role = (s.role || '').toLowerCase();
      const hosp = (hospMap[String(s.hospitalId?._id || s.hospitalId)] || '').toLowerCase();
      return name.includes(search) || email.includes(search) || role.includes(search) || hosp.includes(search);
    });

    return (
      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Icon size={18} className="text-indigo-600" />
            {title} ({filtered.length} of {staffList.length})
          </h3>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name, email, role..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-1.5 border rounded-lg text-xs w-full sm:w-64"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="p-3">Staff Name & Title</th>
                <th className="p-3">Role</th>
                <th className="p-3">Hospital</th>
                <th className="p-3">Login Email</th>
                <th className="p-3">Password Management</th>
                <th className="p-3">Duty Status</th>
                <th className="p-3 text-right">Super Admin Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((s) => {
                const hospName = s.hospitalId?.name || hospMap[String(s.hospitalId?._id || s.hospitalId)] || 'Platform Hospital';

                return (
                  <tr key={s._id} className="hover:bg-slate-50">
                    <td className="p-3">
                      <p className="font-bold text-slate-900">{s.name}</p>
                      {s.specialization && <p className="text-[10px] text-slate-500">{s.specialization}</p>}
                    </td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                        {s.role}
                      </span>
                    </td>
                    <td className="p-3 font-semibold text-slate-700">{hospName}</td>
                    <td className="p-3 font-mono font-bold text-indigo-900">{s.email}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200 w-max">
                        <Key size={13} className="text-amber-500 shrink-0" />
                        <span className="font-mono font-bold text-slate-900 selection:bg-amber-100">
                          Secure hash only — reset when required
                        </span>
                      </div>
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${s.isAvailable !== false ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                        {s.isAvailable !== false ? 'ON DUTY' : 'OFF DUTY'}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[11px] font-bold bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
                        onClick={() => handleOpenPasswordModal(s)}
                      >
                        <Edit size={12} className="mr-1" /> Change Password
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-slate-500">No staff members found in this category.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 size={24} className="text-indigo-600" />
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Executive Platform Analytics & Staff Roster</h2>
          </div>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            Live Clinical, Financial, Diagnostic & Multi-Hospital Staff Credential Management Console
          </p>
        </div>

        <div className="flex items-center gap-2 no-print">
          {hospitals.length > 0 && !hospitalId && (
            <select
              value={selectedHospitalId}
              onChange={(e) => setSelectedHospitalId(e.target.value)}
              className="px-3 py-1.5 border rounded-lg text-xs font-bold text-slate-700 bg-white"
            >
              <option value="ALL">All Hospitals Combined ({hospitals.length})</option>
              {hospitals.map((h) => (
                <option key={h._id} value={h._id}>{h.name} ({h.code})</option>
              ))}
            </select>
          )}

          <Button variant="outline" size="sm" onClick={() => window.print()} className="font-bold text-xs">
            <Download size={14} className="mr-1" /> Export PDF / Print
          </Button>
        </div>
      </div>

      {/* Metric Selector Tabs */}
      <div className="flex border-b border-slate-200 gap-2 overflow-x-auto text-xs font-bold scrollbar-none no-print">
        {METRIC_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTabId === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleMetricChange(tab.id)}
              className={`px-4 py-2.5 rounded-t-xl flex items-center gap-2 transition-all border-b-2 whitespace-nowrap ${
                isActive
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                  : 'bg-white text-slate-600 border-transparent hover:text-slate-900 hover:bg-slate-50 border-slate-200'
              }`}
            >
              <Icon size={16} />
              {tab.label}
              {tab.count !== undefined && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-black ${
                  isActive ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="p-16 text-center text-slate-500 text-sm font-semibold">Loading analytics & staff roster data...</div>
      ) : (
        <>
          {/* ── METRIC: EXECUTIVE OVERVIEW ── */}
          {activeTabId === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 no-print">
                <StatCard title="Total Platform Staff" value={`${allStaff.length} Users`} subtitle="Across All Roles" icon={Users} color="purple" />
                <StatCard title="Appointed Doctors" value={`${doctorsData.length} Physicians`} subtitle="Active Consultants" icon={Stethoscope} color="emerald" />
                <StatCard title="Receptionists & Front Desk" value={`${receptionData.length} Staff`} subtitle="Counter Desk" icon={ConciergeBell} color="blue" />
                <StatCard title="Total Invoices Revenue" value={formatCurrency(invoices.reduce((acc, i) => acc + (i.paidAmount || i.grandTotal || 0), 0))} subtitle="All-Time Payments" icon={IndianRupee} color="emerald" />
              </div>

              {renderStaffTable(allStaff, 'All Hospital Staff & Credentials Roster', Users)}
            </div>
          )}

          {/* ── METRIC: ALL STAFF ROSTER ── */}
          {activeTabId === 'staff' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 no-print">
                <StatCard title="Total Staff" value={`${allStaff.length} Members`} subtitle="Cross-Department Roster" icon={Users} color="purple" />
                <StatCard title="Hospital Admins" value={`${hospitalAdminsData.length} Admins`} subtitle="Facility Leadership" icon={ShieldCheck} color="indigo" />
                <StatCard title="Doctors & Specialists" value={`${doctorsData.length} Doctors`} subtitle="OPD Clinics" icon={Stethoscope} color="sky" />
                <StatCard title="On Duty Available" value={`${allStaff.filter(s => s.isAvailable !== false).length} Active`} subtitle="Working Shift" icon={CheckCircle2} color="emerald" />
              </div>

              {renderStaffTable(allStaff, 'Complete Platform Staff & Credentials Directory', Users)}
            </div>
          )}

          {/* ── METRIC: HOSPITAL ADMINISTRATORS ── */}
          {activeTabId === 'hospital-admins' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 no-print">
                <StatCard title="Hospital Administrators" value={`${hospitalAdminsData.length} Admins`} subtitle="Facility Leadership" icon={ShieldCheck} color="purple" />
                <StatCard title="Active On Duty" value={`${hospitalAdminsData.filter(a => a.isAvailable !== false).length} Active`} subtitle="Access Enabled" icon={CheckCircle2} color="emerald" />
                <StatCard title="Managed Hospitals" value={`${hospitals.length} Hospitals`} subtitle="Registered Tenants" icon={Building2} color="sky" />
                <StatCard title="Total Platform Staff" value={`${allStaff.length} Users`} subtitle="Under Management" icon={Users} color="indigo" />
              </div>

              {renderStaffTable(hospitalAdminsData, 'Hospital Administrators & Facility Directors Directory', ShieldCheck)}
            </div>
          )}

          {/* ── METRIC: RECEPTION & FRONT DESK ── */}
          {activeTabId === 'reception' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 no-print">
                <StatCard title="Reception Staff" value={`${receptionData.length} Receptionists`} subtitle="Front Counter Desk" icon={ConciergeBell} color="blue" />
                <StatCard title="Active On Duty" value={`${receptionData.filter(r => r.isAvailable !== false).length} On Duty`} subtitle="Active Shift" icon={CheckCircle2} color="emerald" />
                <StatCard title="Registered Patients" value={`${patients.length} Patients`} subtitle="Auto-Sequenced UHID" icon={Users} color="indigo" />
                <StatCard title="OPD Queue Today" value={`${nurseTasks.length + radiologyOrders.length + labOrders.length} Visits`} subtitle="Hospital Footfall" icon={Activity} color="amber" />
              </div>

              {renderStaffTable(receptionData, 'Reception & Front Desk Staff Roster', ConciergeBell)}
            </div>
          )}

          {/* ── METRIC: DOCTORS & CONSULTS ── */}
          {activeTabId === 'doctors' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 no-print">
                <StatCard title="Appointed Doctors" value={`${doctorsData.length} Physicians`} subtitle="Cross-Department OPD" icon={Stethoscope} color="emerald" />
                <StatCard title="On Duty Available" value={`${doctorsData.filter(d => d.isAvailable !== false).length} Active`} subtitle="Available in OPD Cabins" icon={CheckCircle2} color="emerald" />
                <StatCard title="Consultations Completed" value={`${doctorsData.reduce((acc, d) => acc + (d.patientsHandled || 0), 0)} Visits`} subtitle="OPD Checked" icon={Activity} color="purple" />
                <StatCard title="Consultation Revenue" value={formatCurrency(doctorsData.reduce((acc, d) => acc + (d.revenueGenerated || 0), 0))} subtitle="Fees Logged" icon={IndianRupee} color="sky" />
              </div>

              {renderStaffTable(doctorsData, 'Doctor & Physician Roster & Credentials', Stethoscope)}
            </div>
          )}

          {/* ── METRIC: NURSING & WARD TASKS ── */}
          {activeTabId === 'nursing' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 no-print">
                <StatCard title="Nursing Staff" value={`${nursingData.length} Nurses`} subtitle="Ward Duty Roster" icon={Activity} color="teal" />
                <StatCard title="Nurse Administration Tasks" value={`${nurseTasks.length} Tasks`} subtitle="Ward Medication" icon={Activity} color="indigo" />
                <StatCard title="Completed Tasks" value={`${nurseTasks.filter(t => t.status === 'ADMINISTERED' || t.status === 'COMPLETED').length} Done`} subtitle="Given to Patients" icon={CheckCircle2} color="emerald" />
                <StatCard title="Pending Ward Tasks" value={`${nurseTasks.filter(t => t.status === 'PENDING').length} Scheduled`} subtitle="Due Medication" icon={Clock} color="amber" />
              </div>

              {renderStaffTable(nursingData, 'Nursing Staff Directory', Activity)}

              <Card>
                <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center gap-2">
                  <Activity size={18} className="text-teal-600" />
                  Nursing Care & Medication Administration Logs ({nurseTasks.length})
                </h3>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="p-3">Medicine & Dosage</th>
                        <th className="p-3">Patient Name & UHID</th>
                        <th className="p-3">Ward / Bed</th>
                        <th className="p-3">Assigned Nurse</th>
                        <th className="p-3">Status</th>
                        <th className="p-3 text-right">Scheduled Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-800">
                      {nurseTasks.map((task) => (
                        <tr key={task._id} className="hover:bg-slate-50">
                          <td className="p-3 font-bold text-slate-900">{task.medicineName || 'Medication'} <span className="text-[10px] text-slate-400 font-mono">({task.dosage || '500 mg'})</span></td>
                          <td className="p-3 font-bold text-indigo-900">{task.patientName || 'Patient'} <span className="text-[10px] text-indigo-500 font-mono">({task.uhid || '—'})</span></td>
                          <td className="p-3 font-mono text-slate-700">{task.wardName || 'General Ward'} ({task.bedNumber || 'Bed-101'})</td>
                          <td className="p-3 text-slate-600">{task.nurseName || 'Nurse Staff'}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${['ADMINISTERED', 'COMPLETED'].includes(task.status) ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                              {task.status || 'PENDING'}
                            </span>
                          </td>
                          <td className="p-3 text-right text-slate-500 font-mono">{formatDateTime(task.scheduledTime || task.createdAt)}</td>
                        </tr>
                      ))}
                      {nurseTasks.length === 0 && (
                        <tr><td colSpan={6} className="p-8 text-center text-slate-500">No nurse administration tasks logged.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {/* ── METRIC: PATHOLOGY & LAB ── */}
          {activeTabId === 'laboratory' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 no-print">
                <StatCard title="Laboratory Staff" value={`${labStaffData.length} Technologists`} subtitle="Pathology Staff" icon={TestTube} color="teal" />
                <StatCard title="Total Lab Requests" value={`${labOrders.length} Orders`} subtitle="Pathology & Blood Tests" icon={TestTube} color="indigo" />
                <StatCard title="Completed Reports" value={`${labOrders.filter(o => ['REPORT_UPLOADED', 'COMPLETED'].includes(o.status)).length} Done`} subtitle="Uploaded to EMR" icon={CheckCircle2} color="emerald" />
                <StatCard title="Laboratory Revenue" value={formatCurrency(labOrders.reduce((sum, o) => sum + (o.totalDepartmentCharge || o.price || 0), 0))} subtitle="Charges Logged" icon={IndianRupee} color="sky" />
              </div>

              {renderStaffTable(labStaffData, 'Laboratory Technologists & Staff Directory', TestTube)}

              <Card>
                <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <TestTube size={18} className="text-indigo-600" />
                    Pathology Laboratory Diagnostic Orders ({labOrders.length})
                  </span>
                  <span className="text-xs text-slate-500 font-mono">LIS Laboratory Log</span>
                </h3>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="p-3">Patient & UHID</th>
                        <th className="p-3">Test Name & Category</th>
                        <th className="p-3">Ordering Doctor</th>
                        <th className="p-3">Priority</th>
                        <th className="p-3">Workflow Status</th>
                        <th className="p-3 text-right">Fee</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {labOrders.map((ord) => (
                        <tr key={ord._id} className="hover:bg-slate-50">
                          <td className="p-3">
                            <p className="font-bold text-slate-900">{ord.patientName}</p>
                            <p className="font-mono text-[10px] text-indigo-700 font-bold">{ord.uhid}</p>
                          </td>
                          <td className="p-3">
                            <p className="font-bold text-slate-800">{ord.testName}</p>
                            <p className="text-[10px] text-slate-500">{ord.testCategory}</p>
                          </td>
                          <td className="p-3 font-medium text-slate-700">{ord.doctorName || 'Consultant'}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${ord.priority === 'EMERGENCY' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'}`}>
                              {ord.priority}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${['COMPLETED', 'REPORT_UPLOADED'].includes(ord.status) ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                              {ord.status}
                            </span>
                          </td>
                          <td className="p-3 text-right font-mono font-bold text-slate-900">{formatCurrency(ord.price || 0)}</td>
                        </tr>
                      ))}
                      {labOrders.length === 0 && (
                        <tr><td colSpan={6} className="p-8 text-center text-slate-500">No laboratory test orders found.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {/* ── METRIC: RADIOLOGY & IMAGING ── */}
          {activeTabId === 'radiology' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 no-print">
                <StatCard title="Radiology Staff" value={`${radiologyStaffData.length} Radiologists`} subtitle="PACS Staff" icon={Scan} color="purple" />
                <StatCard title="Total Radiology Orders" value={`${radiologyOrders.length} Scans`} subtitle="X-Ray, MRI, CT & USG" icon={Scan} color="purple" />
                <StatCard title="Completed Scans" value={`${radiologyOrders.filter(o => ['REPORT_UPLOADED', 'COMPLETED'].includes(o.status)).length} Done`} subtitle="PACS DICOM Scans" icon={CheckCircle2} color="emerald" />
                <StatCard title="Radiology Revenue" value={formatCurrency(radiologyOrders.reduce((sum, o) => sum + (o.totalDepartmentCharge || o.price || 0), 0))} subtitle="Charges Logged" icon={IndianRupee} color="sky" />
              </div>

              {renderStaffTable(radiologyStaffData, 'Radiologists & PACS Staff Directory', Scan)}

              <Card>
                <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Scan size={18} className="text-purple-600" />
                    Radiology & PACS Imaging Diagnostic Reports ({radiologyOrders.length})
                  </span>
                  <span className="text-xs text-slate-500 font-mono">Live PACS RIS Feed</span>
                </h3>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="p-3">Patient & UHID</th>
                        <th className="p-3">Scan Type & Category</th>
                        <th className="p-3">Ordering Doctor</th>
                        <th className="p-3">Priority</th>
                        <th className="p-3">Workflow Status</th>
                        <th className="p-3 text-right">Scan Fee</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {radiologyOrders.map((ord) => (
                        <tr key={ord._id} className="hover:bg-slate-50">
                          <td className="p-3">
                            <p className="font-bold text-slate-900">{ord.patientName}</p>
                            <p className="font-mono text-[10px] text-indigo-700 font-bold">{ord.uhid}</p>
                          </td>
                          <td className="p-3">
                            <p className="font-bold text-slate-800">{ord.testName}</p>
                            <p className="text-[10px] text-slate-500">{ord.testCategory}</p>
                          </td>
                          <td className="p-3 font-medium text-slate-700">{ord.doctorName || 'Consultant'}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${ord.priority === 'EMERGENCY' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'}`}>
                              {ord.priority}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${['COMPLETED', 'REPORT_UPLOADED'].includes(ord.status) ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                              {ord.status}
                            </span>
                          </td>
                          <td className="p-3 text-right font-mono font-bold text-slate-900">{formatCurrency(ord.price || 0)}</td>
                        </tr>
                      ))}
                      {radiologyOrders.length === 0 && (
                        <tr><td colSpan={6} className="p-8 text-center text-slate-500">No radiology diagnostic orders found.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {/* ── METRIC: PHARMACY & STOCK ── */}
          {activeTabId === 'pharmacy' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 no-print">
                <StatCard title="Pharmacy Staff" value={`${pharmacyStaffData.length} Pharmacists`} subtitle="FEFO Dispensing" icon={Pill} color="rose" />
                <StatCard title="Total Medicine SKUs" value={`${pharmacyData.medicines.length} Medicines`} subtitle="Formulary Catalog" icon={Pill} color="rose" />
                <StatCard title="In Stock Medicines" value={`${pharmacyData.medicines.filter(m => m.stockStatus === 'IN_STOCK').length} SKUs`} subtitle="Sufficient Quantity" icon={CheckCircle2} color="emerald" />
                <StatCard title="Low / Out of Stock" value={`${pharmacyData.medicines.filter(m => m.stockStatus !== 'IN_STOCK').length} SKUs`} subtitle="Reorder Required" icon={ShieldAlert} color="amber" />
              </div>

              {renderStaffTable(pharmacyStaffData, 'Pharmacy Staff & Dispensing Roster', Pill)}

              <Card>
                <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Pill size={18} className="text-rose-600" />
                    Pharmacy Formulary Stock Catalog ({pharmacyData.medicines.length})
                  </span>
                  <span className="text-xs text-slate-500 font-mono">FEFO Batch Inventory</span>
                </h3>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="p-3">Medicine Name</th>
                        <th className="p-3">Generic Name</th>
                        <th className="p-3">Category</th>
                        <th className="p-3 text-right">Available Stock</th>
                        <th className="p-3 font-mono text-right">Selling Price</th>
                        <th className="p-3 text-right">Stock Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pharmacyData.medicines.map((m) => (
                        <tr key={m._id} className="hover:bg-slate-50">
                          <td className="p-3 font-bold text-slate-900">{m.name}</td>
                          <td className="p-3 font-semibold text-slate-600">{m.genericName}</td>
                          <td className="p-3 font-medium text-slate-500">{m.category}</td>
                          <td className="p-3 text-right font-mono font-bold text-slate-900">{m.totalQuantity || 0}</td>
                          <td className="p-3 text-right font-mono font-bold text-emerald-700">{formatCurrency(m.sellingPrice || 0)}</td>
                          <td className="p-3 text-right">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              m.stockStatus === 'IN_STOCK' ? 'bg-emerald-100 text-emerald-800' :
                              m.stockStatus === 'LOW_STOCK' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {m.stockStatus || 'IN_STOCK'}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {pharmacyData.medicines.length === 0 && (
                        <tr><td colSpan={6} className="p-8 text-center text-slate-500">No medicines cataloged in pharmacy inventory.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {/* ── METRIC: BILLING & REVENUE ── */}
          {activeTabId === 'billing' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 no-print">
                <StatCard title="Billing & Cashier Staff" value={`${billingStaffData.length} Cashiers`} subtitle="Revenue Desk" icon={CreditCard} color="amber" />
                <StatCard title="Total Revenue Collected" value={formatCurrency(invoices.reduce((acc, i) => acc + (i.paidAmount || i.grandTotal || 0), 0))} subtitle="All Invoices" icon={IndianRupee} color="emerald" />
                <StatCard title="Total Invoices Issued" value={`${invoices.length} Bills`} subtitle="OPD & IPD Bills" icon={CreditCard} color="purple" />
                <StatCard title="Paid Invoices" value={`${invoices.filter(i => i.status === 'PAID').length} Paid`} subtitle="Fully Settled" icon={CheckCircle2} color="emerald" />
              </div>

              {renderStaffTable(billingStaffData, 'Billing Desk & Cashier Staff Directory', CreditCard)}

              <Card>
                <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center gap-2">
                  <CreditCard size={18} className="text-emerald-600" />
                  Financial Billing & Invoice Receipts Audit ({invoices.length})
                </h3>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="p-3">Invoice #</th>
                        <th className="p-3">Patient & UHID</th>
                        <th className="p-3">Billing Type</th>
                        <th className="p-3">Payment Status</th>
                        <th className="p-3 text-right">Grand Total</th>
                        <th className="p-3 text-right">Invoice Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {invoices.map((inv) => (
                        <tr key={inv._id} className="hover:bg-slate-50">
                          <td className="p-3 font-mono font-bold text-indigo-900">{inv.invoiceNo || inv.receiptNo || 'INV-000'}</td>
                          <td className="p-3 font-bold text-slate-900">{inv.patientName || inv.patientId?.firstName || 'Walk-in'} <span className="font-mono text-[10px] text-slate-400">({inv.uhid || '—'})</span></td>
                          <td className="p-3 font-medium text-slate-600">{inv.billType || inv.encounterType || 'OPD Billing'}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${inv.status === 'PAID' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                              {inv.status || 'PAID'}
                            </span>
                          </td>
                          <td className="p-3 text-right font-mono font-bold text-emerald-700">{formatCurrency(inv.grandTotal || inv.totalAmount || 0)}</td>
                          <td className="p-3 text-right font-mono text-slate-500">{formatDate(inv.createdAt || inv.invoiceDate)}</td>
                        </tr>
                      ))}
                      {invoices.length === 0 && (
                        <tr><td colSpan={6} className="p-8 text-center text-slate-500">No financial invoices or billing receipts found.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}

          {/* ── METRIC: PATIENTS & ADMISSIONS ── */}
          {activeTabId === 'patients' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 no-print">
                <StatCard title="Total Registered Patients" value={`${patients.length} Patients`} subtitle="Permanent UHID" icon={Users} color="indigo" />
                <StatCard title="OPD Active Patients" value={`${patients.filter(p => !p.admissionStatus || p.admissionStatus === 'OPD').length} OPD`} subtitle="Outpatient Desk" icon={Stethoscope} color="sky" />
                <StatCard title="IPD Admitted Ward" value={`${patients.filter(p => p.admissionStatus === 'ADMITTED').length} Inpatients`} subtitle="Bed Occupancy" icon={Activity} color="purple" />
                <StatCard title="Discharged Patients" value={`${patients.filter(p => p.admissionStatus === 'DISCHARGED').length} History`} subtitle="Checked Out" icon={CheckCircle2} color="emerald" />
              </div>

              <Card>
                <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Users size={18} className="text-indigo-600" />
                    Patient Registration & EMR Directory ({patients.length})
                  </span>
                  <span className="text-xs text-slate-500 font-mono">Hospital Master EMR</span>
                </h3>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="p-3">UHID</th>
                        <th className="p-3">Patient Name</th>
                        <th className="p-3">Gender / Age</th>
                        <th className="p-3">Mobile Contact</th>
                        <th className="p-3">Admission Status</th>
                        <th className="p-3 text-right">Registration Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {patients.map((pat) => (
                        <tr key={pat._id} className="hover:bg-slate-50">
                          <td className="p-3 font-mono font-bold text-indigo-900">{pat.uhid}</td>
                          <td className="p-3 font-bold text-slate-900">{pat.firstName} {pat.lastName}</td>
                          <td className="p-3 text-slate-600">
                            <div>{pat.gender || 'MALE'} / {pat.age ? `${pat.age} Y` : '—'}</div>
                            {pat.dob && (
                              <div className="text-[10px] text-indigo-700 font-semibold">
                                DOB: {new Date(pat.dob).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </div>
                            )}
                          </td>
                          <td className="p-3 font-mono text-slate-700">{pat.phone}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              pat.admissionStatus === 'ADMITTED' ? 'bg-purple-100 text-purple-800' :
                              pat.admissionStatus === 'DISCHARGED' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
                            }`}>
                              {pat.admissionStatus || 'OPD'}
                            </span>
                          </td>
                          <td className="p-3 text-right font-mono text-slate-500">{formatDate(pat.createdAt)}</td>
                        </tr>
                      ))}
                      {patients.length === 0 && (
                        <tr><td colSpan={6} className="p-8 text-center text-slate-500">No patient records registered.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}
        </>
      )}

      {/* Change Password Modal for Super Admin */}
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

            <PasswordInput
              label="1. New Password"
              labelClassName="text-slate-700 font-bold"
              placeholder="Enter new password (min. 8 characters)"
              value={newPasswordInput}
              onChange={(e) => setNewPasswordInput(e.target.value)}
              inputClassName="font-mono font-bold"
            />

            <div>
              <PasswordInput
                label="2. Confirm New Password"
                labelClassName="text-slate-700 font-bold"
                placeholder="Re-enter the new password to confirm"
                value={confirmPasswordInput}
                onChange={(e) => setConfirmPasswordInput(e.target.value)}
                inputClassName={`font-mono font-bold ${
                  confirmPasswordInput && newPasswordInput !== confirmPasswordInput ? 'border-rose-400 bg-rose-50/50' : ''
                }`}
              />
              {confirmPasswordInput && newPasswordInput !== confirmPasswordInput && (
                <p className="text-[11px] text-rose-600 font-medium mt-1">Passwords do not match</p>
              )}
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
    </div>
  );
};

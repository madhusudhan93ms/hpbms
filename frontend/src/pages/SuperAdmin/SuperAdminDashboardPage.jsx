import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, ShieldCheck, Users, Stethoscope, ConciergeBell, Activity,
  TestTube, Scan, Pill, CreditCard, UserCircle, BedDouble, ClipboardList,
  Calendar, IndianRupee, AlertTriangle, ShieldAlert, Clock, FileText, ScrollText,
  Bell, ArrowRight
} from 'lucide-react';
import { StatCard } from '../../components/ui/StatCard';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { axiosClient } from '../../api/axiosClient';
import { useSocket } from '../../providers/SocketProvider';
import { STAT_CARD_ROUTES } from '../../utils/superAdminNavigation';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { useSuperAdminContextStore } from '../../store/superAdminContextStore';

const DASHBOARD_CARDS = [
  { key: 'totalHospitals', title: 'Total Hospitals', icon: Building2, color: 'sky', format: (m) => m.totalHospitals },
  { key: 'activeHospitals', title: 'Active Hospitals', icon: ShieldCheck, color: 'emerald', format: (m) => m.activeHospitals },
  { key: 'inactiveHospitals', title: 'Inactive Hospitals', icon: Building2, color: 'amber', format: (m) => m.inactiveHospitals },
  { key: 'hospitalAdmins', title: 'Total Hospital Administrators', icon: ShieldCheck, color: 'purple', format: (m) => m.hospitalAdmins },
  { key: 'doctors', title: 'Total Doctors', icon: Stethoscope, color: 'emerald', format: (m) => m.doctors },
  { key: 'receptionists', title: 'Total Receptionists', icon: ConciergeBell, color: 'blue', format: (m) => m.receptionists },
  { key: 'nurses', title: 'Total Nurses', icon: Activity, color: 'teal', format: (m) => m.nurses },
  { key: 'labStaff', title: 'Total Laboratory Staff', icon: TestTube, color: 'indigo', format: (m) => m.labStaff },
  { key: 'radiologyStaff', title: 'Total Radiology Staff', icon: Scan, color: 'purple', format: (m) => m.radiologyStaff },
  { key: 'pharmacyStaff', title: 'Total Pharmacy Staff', icon: Pill, color: 'rose', format: (m) => m.pharmacyStaff },
  { key: 'billingStaff', title: 'Total Billing Staff', icon: CreditCard, color: 'amber', format: (m) => m.billingStaff },
  { key: 'totalPatients', title: 'Total Patients', icon: UserCircle, color: 'sky', format: (m) => m.totalPatients },
  { key: 'opdPatients', title: 'Total OPD Patients', icon: ClipboardList, color: 'blue', format: (m) => m.opdPatients },
  { key: 'ipdPatients', title: 'Total IPD Patients', icon: BedDouble, color: 'indigo', format: (m) => m.ipdPatients },
  { key: 'totalStaff', title: 'Total Staff', icon: Users, color: 'purple', format: (m) => m.totalStaff },
  { key: 'todayRegistrations', title: "Today's Registrations", icon: UserCircle, color: 'emerald', format: (m) => m.todayRegistrations },
  { key: 'todayAppointments', title: "Today's Appointments", icon: Calendar, color: 'sky', format: (m) => m.todayAppointments },
  { key: 'todayConsultations', title: "Today's Consultations", icon: Stethoscope, color: 'teal', format: (m) => m.todayConsultations },
  { key: 'todayAdmissions', title: "Today's Admissions", icon: BedDouble, color: 'indigo', format: (m) => m.todayAdmissions },
  { key: 'todayDischarges', title: "Today's Discharges", icon: BedDouble, color: 'blue', format: (m) => m.todayDischarges },
  { key: 'todayRevenue', title: "Today's Revenue", icon: IndianRupee, color: 'emerald', format: (m) => formatCurrency(m.todayRevenue) },
  { key: 'pendingLabReports', title: 'Pending Laboratory Reports', icon: TestTube, color: 'amber', format: (m) => m.pendingLabReports },
  { key: 'pendingRadiologyReports', title: 'Pending Radiology Reports', icon: Scan, color: 'amber', format: (m) => m.pendingRadiologyReports },
  { key: 'pendingBilling', title: 'Pending Billing', icon: CreditCard, color: 'red', format: (m) => m.pendingBilling },
  { key: 'emergencyCases', title: 'Emergency Cases', icon: ShieldAlert, color: 'red', format: (m) => m.emergencyCases },
];

export const SuperAdminDashboardPage = () => {
  const navigate = useNavigate();
  const { socket } = useSocket();
  const cachedMetrics = useSuperAdminContextStore((s) => s.platformMetrics);
  const cachedPendingCount = useSuperAdminContextStore((s) => s.pendingCount);
  const [metrics, setMetrics] = useState(() => cachedMetrics || null);
  const [isLoading, setIsLoading] = useState(() => !cachedMetrics);
  const [pendingCount, setPendingCount] = useState(() => cachedPendingCount || 0);
  const [subAlerts, setSubAlerts] = useState({ expiringSoon: [], trialsExpiringSoon: [] });

  const loadDashboardData = async () => {
    try {
      const [metricsRes, pendingRes, alertsRes] = await Promise.allSettled([
        axiosClient.get('/saas/platform/metrics'),
        axiosClient.get('/saas/hospitals/pending'),
        axiosClient.get('/saas/subscriptions/alerts'),
      ]);
      if (metricsRes.status === 'fulfilled') {
        const payload = metricsRes.value.data?.data || metricsRes.value.data;
        setMetrics(payload);
        useSuperAdminContextStore.getState().setPlatformMetrics(payload);
      }
      if (pendingRes.status === 'fulfilled') {
        const pendingData = pendingRes.value.data?.data || pendingRes.value.data || [];
        const count = Array.isArray(pendingData) ? pendingData.length : 0;
        setPendingCount(count);
        useSuperAdminContextStore.getState().setPendingCount(count);
      }
      if (alertsRes.status === 'fulfilled') {
        const alertsData = alertsRes.value.data?.data || alertsRes.value.data || {};
        setSubAlerts(alertsData);
      }
    } catch (err) {
      console.error('Failed to load platform metrics:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();

    if (!socket) return;
    const handleUpdate = () => loadDashboardData();
    socket.on('saas:pending_changed', handleUpdate);
    socket.on('workflow:notification', handleUpdate);
    socket.on('workflow:pending_changed', handleUpdate);
    socket.on('emergency:alert', handleUpdate);
    socket.on('emergency:code_blue_triggered', handleUpdate);
    socket.on('emergency:resolved', handleUpdate);
    socket.on('patient_request:updated', handleUpdate);

    return () => {
      socket.off('saas:pending_changed', handleUpdate);
      socket.off('workflow:notification', handleUpdate);
      socket.off('workflow:pending_changed', handleUpdate);
      socket.off('emergency:alert', handleUpdate);
      socket.off('emergency:code_blue_triggered', handleUpdate);
      socket.off('emergency:resolved', handleUpdate);
      socket.off('patient_request:updated', handleUpdate);
    };
  }, [socket]);

  const navigateTo = (key) => {
    const path = STAT_CARD_ROUTES[key];
    if (path) navigate(path);
  };

  const totalAlerts = (subAlerts.expiringSoon?.length || 0) + (subAlerts.trialsExpiringSoon?.length || 0);
  const totalPending = pendingCount;
  const hasAlerts = totalPending > 0 || totalAlerts > 0 || (metrics?.emergencyCases || 0) > 0;

  if (isLoading && !metrics) {
    return <div className="flex items-center justify-center h-64 text-slate-500">Loading platform dashboard...</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-neutral-900 tracking-tight">Super Admin Dashboard</h2>
        <p className="text-xs text-neutral-500 mt-1">Complete overview of the entire Hospital Billing & Management platform</p>
      </div>

      {/* Platform Alerts */}
      {hasAlerts && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Bell size={18} className="text-amber-600" />
            <h3 className="font-bold text-amber-800">Platform Alerts — Action Required</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {pendingCount > 0 && (
              <button
                onClick={() => navigate('/admin/pending-approvals')}
                className="flex items-center justify-between p-3 rounded-xl bg-white border border-amber-200 hover:bg-amber-50 transition-colors text-left shadow-sm"
              >
                <div>
                  <p className="text-xs font-bold text-amber-700">Hospital Approvals</p>
                  <p className="text-2xl font-black text-slate-900">{pendingCount}</p>
                  <p className="text-[10px] text-slate-500">new hospitals awaiting review</p>
                </div>
                <ArrowRight size={16} className="text-amber-500" />
              </button>
            )}
            {totalAlerts > 0 && (
              <button
                onClick={() => navigate('/admin/subscriptions')}
                className="flex items-center justify-between p-3 rounded-xl bg-white border border-orange-200 hover:bg-orange-50 transition-colors text-left shadow-sm"
              >
                <div>
                  <p className="text-xs font-bold text-orange-700">Plans Expiring Soon</p>
                  <p className="text-2xl font-black text-slate-900">{totalAlerts}</p>
                  <p className="text-[10px] text-slate-500">within the next 7 days</p>
                </div>
                <ArrowRight size={16} className="text-orange-500" />
              </button>
            )}
            {(metrics?.emergencyCases || 0) > 0 && (
              <button
                onClick={() => navigate('/admin/emergency')}
                className="flex items-center justify-between p-3 rounded-xl bg-white border border-red-200 hover:bg-red-50 transition-colors text-left shadow-sm"
              >
                <div>
                  <p className="text-xs font-bold text-red-700">Emergency Cases</p>
                  <p className="text-2xl font-black text-slate-900">{metrics.emergencyCases}</p>
                  <p className="text-[10px] text-slate-500">active across all hospitals</p>
                </div>
                <ArrowRight size={16} className="text-red-500" />
              </button>
            )}
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {DASHBOARD_CARDS.map(({ key, title, icon, color, format }) => (
          <StatCard
            key={key}
            title={title}
            value={metrics ? format(metrics) : '—'}
            subtitle="Click to view details"
            icon={icon}
            color={color}
            onClick={() => navigateTo(key)}
          />
        ))}
        <StatCard
          title="Recent Hospital Registrations"
          value={metrics?.recentHospitalRegistrations?.length || 0}
          subtitle="Click to manage hospitals"
          icon={Building2}
          color="sky"
          onClick={() => navigate('/admin/hospitals')}
        />
        <StatCard
          title="Recent Activities"
          value={metrics?.recentActivities?.length || 0}
          subtitle="Click to view audit trail"
          icon={Clock}
          color="purple"
          onClick={() => navigate('/admin/audit-logs')}
        />
        <StatCard
          title="System Logs"
          value="View All"
          subtitle="Platform audit & security logs"
          icon={ScrollText}
          color="indigo"
          onClick={() => navigate('/admin/audit-logs')}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h3 className="text-base font-bold text-neutral-900 mb-4 flex items-center gap-2">
            <Building2 size={18} className="text-neutral-600" />
            Recent Hospital Registrations
          </h3>
          <div className="space-y-2">
            {(metrics?.recentHospitalRegistrations || []).length > 0 ? (
              metrics.recentHospitalRegistrations.map((h) => (
                <button
                  key={h._id}
                  type="button"
                  onClick={() => navigate(`/admin/hospital/${h._id}/dashboard`)}
                  className="w-full flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 border border-slate-100 text-left transition-colors"
                >
                  <div>
                    <p className="font-bold text-sm text-slate-800">{h.name}</p>
                    <p className="text-xs text-slate-500">{h.contactEmail} · {h.plan}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                    h.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}>
                    {h.status}
                  </span>
                </button>
              ))
            ) : (
              <p className="text-sm text-slate-500 text-center py-4">No recent registrations</p>
            )}
          </div>
        </Card>

        <Card>
          <h3 className="text-base font-bold text-neutral-900 mb-4 flex items-center gap-2">
            <FileText size={18} className="text-neutral-600" />
            Recent Activities
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {(metrics?.recentActivities || []).length > 0 ? (
              metrics.recentActivities.map((a) => (
                <div key={a.id} className="p-3 rounded-lg border border-slate-100 text-xs">
                  <div className="flex justify-between gap-2">
                    <p className="font-bold text-slate-800">{a.action}</p>
                    <span className="text-slate-400 shrink-0">{formatDateTime(a.timestamp)}</span>
                  </div>
                  <p className="text-slate-500 mt-0.5">{a.hospitalName} · {a.userName} ({a.module})</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500 text-center py-4">No recent activity logged</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};

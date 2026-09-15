import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, ChevronDown, ChevronRight, Stethoscope, ConciergeBell, Activity,
  TestTube, Scan, Pill, CreditCard, UserCircle, BedDouble, Users,
} from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { StatCard } from '../../components/ui/StatCard';
import { axiosClient } from '../../api/axiosClient';
import { useSuperAdminContextStore } from '../../store/superAdminContextStore';

const HOSPITAL_STAT_ITEMS = [
  { key: 'doctors', label: 'Total Doctors', icon: Stethoscope, route: 'doctors', color: 'emerald' },
  { key: 'receptionists', label: 'Total Receptionists', icon: ConciergeBell, route: 'reception', color: 'blue' },
  { key: 'nurses', label: 'Total Nurses', icon: Activity, route: 'nursing', color: 'teal' },
  { key: 'labStaff', label: 'Total Laboratory Staff', icon: TestTube, route: 'laboratory', color: 'indigo' },
  { key: 'radiologyStaff', label: 'Total Radiology Staff', icon: Scan, route: 'radiology', color: 'purple' },
  { key: 'pharmacyStaff', label: 'Total Pharmacy Staff', icon: Pill, route: 'pharmacy', color: 'rose' },
  { key: 'billingStaff', label: 'Total Billing Staff', icon: CreditCard, route: 'billing', color: 'amber' },
  { key: 'totalPatients', label: 'Total Patients', icon: UserCircle, route: 'patients', color: 'sky' },
  { key: 'opdPatients', label: 'Total OPD Patients', icon: Users, route: 'opd', color: 'blue' },
  { key: 'ipdPatients', label: 'Total IPD Patients', icon: BedDouble, route: 'ipd', color: 'indigo' },
];

export const SuperAdminHospitalAdminsPage = () => {
  const navigate = useNavigate();
  const { setSelectedHospital, hospitalAdminsOverview, setHospitalAdminsOverview } = useSuperAdminContextStore();
  const [overview, setOverview] = useState(() => hospitalAdminsOverview || []);
  const [expanded, setExpanded] = useState(() => {
    const initial = {};
    (hospitalAdminsOverview || []).forEach((h) => { initial[h.hospitalId] = true; });
    return initial;
  });
  const [isLoading, setIsLoading] = useState(() => (hospitalAdminsOverview || []).length === 0);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await axiosClient.get('/saas/hospitals/overview');
        const data = res.data?.data || res.data || [];
        setOverview(data);
        setHospitalAdminsOverview(data);
        setExpanded((prev) => {
          const next = { ...prev };
          data.forEach((h) => {
            if (next[h.hospitalId] === undefined) next[h.hospitalId] = true;
          });
          return next;
        });
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [setHospitalAdminsOverview]);

  const toggle = (id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const openModule = (hospitalId, hospitalName, route) => {
    setSelectedHospital(hospitalId, hospitalName);
    navigate(`/admin/hospital/${hospitalId}/${route}`);
  };

  if (isLoading && overview.length === 0) return <div className="text-center py-16 text-slate-500">Loading hospital administrator overview...</div>;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-neutral-900 tracking-tight">Hospital Administrator Overview</h2>
        <p className="text-xs text-neutral-500 mt-1">Every registered hospital as an expandable node with staff and patient statistics</p>
      </div>

      <div className="space-y-4">
        {overview.map((hospital) => (
          <Card key={hospital.hospitalId}>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => toggle(hospital.hospitalId)}
                className="flex items-center gap-3 text-left flex-1 min-w-0"
              >
                {expanded[hospital.hospitalId] ? <ChevronDown size={20} className="text-slate-400 shrink-0" /> : <ChevronRight size={20} className="text-slate-400 shrink-0" />}
                <div className="p-2 rounded-lg bg-indigo-50 border border-indigo-100 shrink-0">
                  <Building2 size={20} className="text-indigo-600" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-900">{hospital.hospitalName}</h3>
                  <p className="text-xs text-slate-500">{hospital.hospitalCode} · {hospital.plan} · {hospital.status}</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => openModule(hospital.hospitalId, hospital.hospitalName, 'dashboard')}
                className="text-xs font-bold text-indigo-600 hover:underline px-3 py-1 shrink-0"
              >
                Open Dashboard
              </button>
            </div>

            {expanded[hospital.hospitalId] && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 pt-4 border-t border-slate-100">
                {HOSPITAL_STAT_ITEMS.map(({ key, label, icon, route, color }) => (
                  <StatCard
                    key={key}
                    title={label}
                    value={hospital[key] ?? 0}
                    subtitle="Click to open module"
                    icon={icon}
                    color={color}
                    onClick={() => openModule(hospital.hospitalId, hospital.hospitalName, route)}
                  />
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>

      {overview.length === 0 && (
        <Card><p className="text-center text-slate-500 py-8">No approved hospitals found.</p></Card>
      )}
    </div>
  );
};

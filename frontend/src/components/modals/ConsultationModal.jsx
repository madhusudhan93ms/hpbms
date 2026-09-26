import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { axiosClient } from '../../api/axiosClient';
import { useScrollLock } from '../../hooks/useScrollLock';
import { useSocket } from '../../providers/SocketProvider';
import { useNotificationStore } from '../../store/notificationStore';
import { useDepartmentNotificationStore } from '../../store/departmentNotificationStore';
import { useAuthStore } from '../../store/authStore';
import { formatCurrency } from '../../utils/formatters';
import {
  Stethoscope, X, AlertCircle, Plus, Trash2, CheckCircle2,
  TestTube, AlertTriangle, Receipt, RotateCcw, Check, Ban, Pill, Syringe, Activity,
  BedDouble, UserCheck, Phone
} from 'lucide-react';

export const ConsultationModal = ({ isOpen, onClose, token, patient, onSuccess, returnedPrescription }) => {
  useScrollLock(isOpen);
  const { socket } = useSocket();
  const { user } = useAuthStore();
  const initializedSessionRef = useRef(null);

  const activePatient = (typeof patient === 'object' && patient !== null)
    ? patient
    : (typeof token?.patientId === 'object' && token?.patientId !== null)
      ? token.patientId
      : {
          _id: patient || token?.patientId || `pat_${Date.now()}`,
          firstName: token?.patientName?.split(' ')[0] || 'Patient',
          lastName: token?.patientName?.split(' ').slice(1).join(' ') || '',
          uhid: token?.uhid || 'UHID',
          gender: 'GENERAL',
        };

  const [chiefComplaints, setChiefComplaints] = useState('');
  const [historyOfPresentIllness, setHistoryOfPresentIllness] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [adviceToPatient, setAdviceToPatient] = useState('');

  // IPD Recommendation & Optional Guardian State
  const [recommendIpd, setRecommendIpd] = useState(false);
  const [ipdData, setIpdData] = useState({
    recommendedWard: 'GENERAL_WARD',
    priority: 'ROUTINE',
    admissionReason: '',
    estimatedStayDays: 3,
    guardianName: activePatient?.emergencyContact?.name && activePatient?.emergencyContact?.name !== 'Self / N/A' ? activePatient.emergencyContact.name : '',
    guardianPhone: activePatient?.emergencyContact?.phone && activePatient?.emergencyContact?.phone !== '+1 (555) 000-0000' ? activePatient.emergencyContact.phone : '',
    guardianRelationship: activePatient?.emergencyContact?.relation || 'FAMILY',
    guardianAddress: '',
  });

  const [consultationFee, setConsultationFee] = useState('');
  const [doctorProcedureCharges, setDoctorProcedureCharges] = useState([]);
  const [pharmacyMode, setPharmacyMode] = useState('IN_HOUSE_PHARMACY'); // 'IN_HOUSE_PHARMACY' | 'EXTERNAL_NO_INHOUSE_PHARMACY'

  const [prescriptions, setPrescriptions] = useState([
    {
      medicineName: '',
      genericName: '',
      dosageForm: 'TABLET',
      dosage: '',
      frequency: 'TWICE_DAILY',
      durationDays: '',
      timing: 'AFTER_FOOD',
      treatmentType: 'ORAL_TAKE_HOME',
      instructions: '',
      externalPurchaseRequired: false,
      unitPrice: '',
      quantity: '',
      totalPrice: 0,
    },
  ]);

  const [inventoryMedicines, setInventoryMedicines] = useState([]);
  const [departmentOrders, setDepartmentOrders] = useState([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [actionOrder, setActionOrder] = useState(null);
  const [actionType, setActionType] = useState(null);
  const [actionNote, setActionNote] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const [pharmacyBilledPrescriptions, setPharmacyBilledPrescriptions] = useState([]);

  const activeReturnedPrescription = returnedPrescription || token?.returnedPrescription || null;
  const returnedQuery = activeReturnedPrescription?.billingQuery || token?.billingQuery || null;

  const fetchInventory = async () => {
    try {
      const res = await axiosClient.get('/pharmacy/medicines');
      setInventoryMedicines(res.data || []);
    } catch (err) {
      console.error('Failed to load inventory for prescription search:', err);
    }
  };

  const fetchDepartmentOrders = useCallback(async () => {
    const patId = activePatient?._id || activePatient?.id;
    if (!patId) return;
    setIsLoadingOrders(true);
    try {
      const res = await axiosClient.get(`/diagnostics/patient/${patId}`);
      setDepartmentOrders(res.data || []);
    } catch (err) {
      console.error('Failed to load department orders:', err);
    } finally {
      setIsLoadingOrders(false);
    }
  }, [activePatient]);

  const fetchPharmacyBilled = useCallback(async () => {
    const patId = activePatient?._id || activePatient?.id;
    if (!patId) return;
    try {
      const res = await axiosClient.get(`/pharmacy/prescriptions?patientId=${patId}`);
      const list = Array.isArray(res.data?.data) ? res.data.data : Array.isArray(res.data) ? res.data : [];
      const billed = list.filter(
        (rx) => (rx.dispenseStatus === 'BILLED_SENT_TO_DOCTOR' || (rx.totalMedicineCharge > 0 && rx.dispenseStatus !== 'DISPENSED')) && rx.chargeStatus !== 'INCLUDED_IN_FINAL_BILL'
      );
      setPharmacyBilledPrescriptions(billed);
    } catch (err) {
      console.error('Failed to load pharmacy billed prescriptions:', err);
    }
  }, [activePatient]);

  useEffect(() => {
    if (!isOpen || !token) {
      initializedSessionRef.current = null;
      return;
    }

    const sessionKey = `${token._id || token.id || 'tok'}_${activeReturnedPrescription?._id || activeReturnedPrescription?.invoiceId || token?.invoiceId || ''}`;
    if (initializedSessionRef.current === sessionKey) {
      return;
    }
    initializedSessionRef.current = sessionKey;

    setChiefComplaints(token.chiefComplaints || '');
      setHistoryOfPresentIllness('');
      setFollowUpDate('');
      setAdviceToPatient('');

      // Pre-fill previous consultation fee & procedure charges from activeReturnedPrescription or token
      const prevInvoiceItems = activeReturnedPrescription?.invoiceItems 
        || activeReturnedPrescription?.items
        || activeReturnedPrescription?.invoice?.items
        || token?.returnedPrescription?.invoiceItems 
        || token?.returnedPrescription?.items
        || token?.invoiceItems
        || [];
      const prevConsultationItem = prevInvoiceItems.find((i) => 
        i.category === 'CONSULTATION' || (i.description && i.description.toLowerCase().includes('consultation'))
      );
      const resolvedFee = activeReturnedPrescription?.consultationFee 
        ?? activeReturnedPrescription?.consultationId?.consultationFee
        ?? activeReturnedPrescription?.invoice?.consultationId?.consultationFee
        ?? token?.returnedPrescription?.consultationFee 
        ?? token?.returnedPrescription?.consultationId?.consultationFee
        ?? token?.consultationFee 
        ?? token?.consultationId?.consultationFee
        ?? token?.fee
        ?? (prevConsultationItem ? (prevConsultationItem.unitPrice ?? prevConsultationItem.totalPrice) : undefined)
        ?? token?.doctorId?.consultationFee
        ?? user?.consultationFee
        ?? (activeReturnedPrescription || token?.returnedPrescription ? 100 : undefined);
      const prevConsultationFee = resolvedFee !== undefined && resolvedFee !== null && resolvedFee !== '' ? String(resolvedFee) : '';
      setConsultationFee(prevConsultationFee);

      const prevProcedureItems = prevInvoiceItems.filter((i) => 
        i.category === 'OTHER' || (i.description && i.description.toLowerCase().includes('procedure'))
      );
      const prevDoctorProcedureCharges = activeReturnedPrescription?.doctorProcedureCharges 
        || token?.returnedPrescription?.doctorProcedureCharges 
        || (prevProcedureItems.length > 0 
            ? prevProcedureItems.map((p) => ({
                description: p.description ? p.description.replace(/^Doctor Procedure:\s*/i, '') : 'Procedure',
                amount: p.unitPrice || p.totalPrice || 0,
              }))
            : []);
      setDoctorProcedureCharges(prevDoctorProcedureCharges);

      // Pre-fill existing medicines if returned from Billing or Pharmacy or token
      const prevMeds = activeReturnedPrescription?.medicines || token?.returnedPrescription?.medicines || token?.prescriptions;
      if (Array.isArray(prevMeds) && prevMeds.length > 0) {
        setPrescriptions(
          prevMeds.map((m) => ({
            medicineName: m.medicineName || m.description || '',
            genericName: m.genericName || '',
            dosageForm: m.dosageForm || 'TABLET',
            dosage: m.dosage || '',
            frequency: m.frequency || 'TWICE_DAILY',
            durationDays: m.durationDays !== undefined && m.durationDays !== null ? m.durationDays : '',
            timing: m.timing || 'AFTER_FOOD',
            treatmentType: m.treatmentType || 'ORAL_TAKE_HOME',
            instructions: m.instructions || '',
            externalPurchaseRequired: Boolean(m.externalPurchaseRequired),
            unitPrice: m.unitPrice !== undefined && m.unitPrice !== null ? m.unitPrice : '',
            quantity: m.quantity !== undefined && m.quantity !== null ? m.quantity : '',
            totalPrice: Number(m.totalPrice || 0),
          }))
        );
      } else {
        setPrescriptions([
          {
            medicineName: '',
            genericName: '',
            dosageForm: 'TABLET',
            dosage: '',
            frequency: 'TWICE_DAILY',
            durationDays: '',
            timing: 'AFTER_FOOD',
            treatmentType: 'ORAL_TAKE_HOME',
            instructions: '',
            externalPurchaseRequired: false,
            unitPrice: '',
            quantity: '',
            totalPrice: 0,
          },
        ]);
      }
      setErrorMsg(null);
      setShowConfirmModal(false);
      fetchInventory();
      fetchDepartmentOrders();
      fetchPharmacyBilled();
  }, [isOpen, token, activeReturnedPrescription, fetchDepartmentOrders, fetchPharmacyBilled]);

  useEffect(() => {
    if (!socket || !isOpen) return;
    let timer = null;
    const handleUpdate = (data) => {
      const patId = activePatient?._id || activePatient?.id;
      if (data?.patientId === patId || data?.patientId?._id === patId) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          fetchDepartmentOrders();
          fetchPharmacyBilled();
        }, 250);
      }
    };
    socket.on('investigation:status_updated', handleUpdate);
    socket.on('diagnostics:report_ready', handleUpdate);
    socket.on('pharmacy:billing_sent_to_doctor', handleUpdate);
    return () => {
      if (timer) clearTimeout(timer);
      socket.off('investigation:status_updated', handleUpdate);
      socket.off('diagnostics:report_ready', handleUpdate);
      socket.off('pharmacy:billing_sent_to_doctor', handleUpdate);
    };
  }, [socket, isOpen, activePatient, fetchDepartmentOrders, fetchPharmacyBilled]);


  if (!isOpen || !token) return null;

  const { pendingOrders, hasPendingOrders, completedDeptOrders, totalDepartmentCharges } = useMemo(() => {
    const pending = [];
    const completed = [];
    let deptCharges = 0;
    departmentOrders.forEach((ord) => {
      if (ord.chargeStatus === 'CANCELLED') return;
      if (['REQUESTED', 'DEPARTMENT_RECEIVED', 'ACCEPTED', 'IN_PROGRESS'].includes(ord.status)) {
        pending.push(ord);
      } else if (['REPORT_UPLOADED', 'COMPLETED', 'DOCTOR_REVIEW'].includes(ord.status)) {
        completed.push(ord);
        deptCharges += (ord.totalDepartmentCharge || ord.price || 0);
      }
    });
    return {
      pendingOrders: pending,
      hasPendingOrders: pending.length > 0,
      completedDeptOrders: completed,
      totalDepartmentCharges: deptCharges,
    };
  }, [departmentOrders]);

  const totalDoctorProcedureCharges = useMemo(() => {
    return doctorProcedureCharges.reduce((sum, proc) => sum + (Number(proc.amount) || 0), 0);
  }, [doctorProcedureCharges]);

  const totalPharmacyCharges = useMemo(() => {
    return pharmacyBilledPrescriptions.reduce((acc, rx) => {
      if (rx.totalMedicineCharge) return acc + Number(rx.totalMedicineCharge);
      const itemTotal = (rx.medicines || []).reduce(
        (sum, m) => sum + (Number(m.price || m.unitPrice || 20) * Number(m.dispensedQty || m.durationDays || 1)),
        0
      );
      return acc + itemTotal;
    }, 0);
  }, [pharmacyBilledPrescriptions]);

  const grandTotal = useMemo(() => {
    return Number(consultationFee || 0) + totalDoctorProcedureCharges + totalDepartmentCharges + totalPharmacyCharges;
  }, [consultationFee, totalDoctorProcedureCharges, totalDepartmentCharges, totalPharmacyCharges]);

  const inventoryMedByName = useMemo(() => {
    const map = new Map();
    inventoryMedicines.forEach((m) => {
      if (m.name) map.set(m.name, m);
    });
    return map;
  }, [inventoryMedicines]);

  const handleAddMedicineRow = () =>
    setPrescriptions((prev) => [
      ...prev,
      {
        medicineName: '',
        genericName: '',
        dosageForm: 'TABLET',
        dosage: '',
        frequency: 'TWICE_DAILY',
        durationDays: '',
        timing: 'AFTER_FOOD',
        treatmentType: 'ORAL_TAKE_HOME',
        instructions: '',
        externalPurchaseRequired: false,
        unitPrice: '',
        quantity: '',
        totalPrice: 0,
      },
    ]);

  const handleRemoveMedicineRow = (index) => setPrescriptions((prev) => prev.filter((_, idx) => idx !== index));
  const handleMedicineChange = (index, field, value) =>
    setPrescriptions((prev) => {
      const u = [...prev];
      u[index][field] = value;

      if (field === 'durationDays' && !u[index].quantityManuallyEdited) {
        if (value === '' || value === null) {
          u[index].quantity = '';
        } else {
          const d = Number(value) || 0;
          const freqMultiplier = u[index].frequency === 'THRICE_DAILY' ? 3 : u[index].frequency === 'ONCE_DAILY' ? 1 : u[index].frequency === 'FOUR_TIMES_DAILY' ? 4 : 2;
          u[index].quantity = d > 0 ? d * freqMultiplier : '';
        }
      }

      if (field === 'frequency' && !u[index].quantityManuallyEdited && u[index].durationDays) {
        const d = Number(u[index].durationDays) || 0;
        const freqMultiplier = value === 'THRICE_DAILY' ? 3 : value === 'ONCE_DAILY' ? 1 : value === 'FOUR_TIMES_DAILY' ? 4 : 2;
        u[index].quantity = d > 0 ? d * freqMultiplier : '';
      }

      if (field === 'quantity') {
        u[index].quantityManuallyEdited = true;
      }

      const isOutside = u[index].externalPurchaseRequired || pharmacyMode === 'EXTERNAL_NO_INHOUSE_PHARMACY';
      const q = Number(u[index].quantity || 0);
      const p = Number(u[index].unitPrice || 0);

      if (isOutside) {
        u[index].totalPrice = 0;
      } else {
        u[index].totalPrice = q * p;
      }
      u[index].price = p;

      return u;
    });

  const handleSelectInventoryMed = useCallback((index, selectedMedName) => {
    const med = inventoryMedByName.get(selectedMedName);
    if (med) {
      setPrescriptions((prev) => {
        const u = [...prev];
        u[index].medicineName = med.name;
        u[index].genericName = med.genericName;
        u[index].dosageForm = med.dosageForm || 'TABLET';
        u[index].strength = med.strength;
        const p = Number(med.sellingPrice) || 0;
        u[index].unitPrice = p > 0 ? p : '';
        u[index].price = p;
        const q = Number(u[index].quantity || 0);
        u[index].totalPrice = pharmacyMode === 'EXTERNAL_NO_INHOUSE_PHARMACY' ? 0 : q * p;
        u[index].externalPurchaseRequired = (med.totalQuantity ?? 0) === 0;
        return u;
      });
    }
  }, [inventoryMedByName, pharmacyMode]);

  const handleAddProcedureRow = () => setDoctorProcedureCharges((prev) => [...prev, { description: '', amount: '' }]);
  const handleRemoveProcedureRow = (index) => setDoctorProcedureCharges((prev) => prev.filter((_, idx) => idx !== index));
  const handleProcedureChange = (index, field, value) => setDoctorProcedureCharges((prev) => { const u = [...prev]; u[index][field] = value; return u; });

  const handleFinalizeConfirmed = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    const validPrescriptions = prescriptions
      .filter((p) => p.medicineName && p.medicineName.trim() !== '')
      .map((p) => ({
        ...p,
        medicineName: p.medicineName.trim(),
        dosage: p.dosage || (p.dosageForm === 'INJECTION' ? '1 Ampoule IV Stat' : '1 Tablet'),
        frequency: p.frequency || (p.dosageForm === 'INJECTION' ? 'STAT_IMMEDIATE' : 'TWICE_DAILY'),
        durationDays: Number(p.durationDays) || 1,
        timing: p.timing || 'AFTER_FOOD',
        treatmentType: p.treatmentType || (['INJECTION', 'IV_FLUID'].includes(p.dosageForm) ? 'NURSE_ADMINISTERED' : 'ORAL_TAKE_HOME'),
        unitPrice: Number(p.unitPrice) || 0,
        price: Number(p.unitPrice) || 0,
        quantity: Number(p.quantity) || 1,
        totalPrice: Number(p.totalPrice) || 0,
      }));

    const validProcedureCharges = doctorProcedureCharges
      .filter((p) => p.description && p.description.trim() !== '')
      .map((p) => ({
        description: p.description.trim(),
        amount: Number(p.amount) || 0,
      }));

    try {
      await axiosClient.post('/emr/consultations', {
        appointmentId: token._id,
        patientId: activePatient._id || activePatient.id,
        invoiceId: activeReturnedPrescription?.invoiceId || activeReturnedPrescription?.billingQuery?.invoiceId || token?.returnedPrescription?.invoiceId || token?.invoiceId || undefined,
        chiefComplaints: chiefComplaints.trim() || 'General Consultation',
        historyOfPresentIllness,
        prescriptions: validPrescriptions,
        pharmacyMode,
        consultationFee: Number(consultationFee) || 0,
        emergencyFee: 0,
        doctorProcedureCharges: validProcedureCharges,
        followUpDate: followUpDate || undefined,
        adviceToPatient,
        ipdRecommendation: recommendIpd
          ? {
              isRecommended: true,
              recommendedWard: ipdData.recommendedWard,
              priority: ipdData.priority,
              admissionReason: ipdData.admissionReason || chiefComplaints || 'Doctor Inpatient Admission Recommendation',
              estimatedStayDays: Number(ipdData.estimatedStayDays) || 3,
              guardianInfo: {
                name: ipdData.guardianName,
                phone: ipdData.guardianPhone,
                relationship: ipdData.guardianRelationship,
                address: ipdData.guardianAddress,
              },
            }
          : { isRecommended: false },
      });
      setShowConfirmModal(false);
      try {
        if (token?._id) {
          useNotificationStore.getState().resolveEntityNotification(String(token._id));
          useDepartmentNotificationStore.getState().resolvePending(String(token._id));
        }
        if (activePatient?._id) {
          useNotificationStore.getState().resolveEntityNotification(String(activePatient._id));
          useDepartmentNotificationStore.getState().resolvePending(String(activePatient._id));
        }
        useDepartmentNotificationStore.getState().fetchPendingWork?.();
        useNotificationStore.getState().fetchNotifications?.('active');
      } catch {}
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setShowConfirmModal(false);
      setErrorMsg(err.response?.data?.error?.message || err.error?.message || err.message || 'Failed to finalize consultation record');
    } finally {
      setIsLoading(false);
    }
  };

  const labelClass = 'block text-[11px] font-bold text-slate-600 mb-1.5 uppercase tracking-wider';
  const sectionBg = 'p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3';

  return (
    <>
      <div className="modal-overlay animate-fade-in">
        <div className="modal-container max-w-4xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="modal-header">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100 flex-shrink-0">
                <Stethoscope size={19} />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-slate-900 leading-tight truncate">Clinical Consultation & Charges Review</h3>
                <p className="text-xs text-slate-500 mt-0.5 truncate">
                  <span className="text-indigo-700 font-bold">{activePatient.firstName} {activePatient.lastName}</span> &bull; Token #{token.tokenNumber}
                </p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="modal-close-btn">
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div className="modal-body space-y-4 text-xs">
            {errorMsg && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 flex items-center gap-2">
                <AlertCircle size={15} /> {errorMsg}
              </div>
            )}

            {/* Billing Return Query Banner */}
            {returnedQuery && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-amber-800">
                  <AlertTriangle size={15} /> Returned from Central Billing — Clarification Required
                </div>
                <p className="text-xs text-amber-800 pl-5">{returnedQuery.query || 'Cashier requested review of this consultation.'}</p>
                <p className="text-[11px] text-amber-700 pl-5">
                  Please review or update the prescription / consultation fee below. Clicking &ldquo;Finalize Consultation &amp; Send to Billing&rdquo; will automatically resolve this query and update the bill.
                </p>
              </div>
            )}

            {/* Completed Department Orders Banner (if any) */}
            {completedDeptOrders.length > 0 && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 space-y-1">
                <div className="flex items-center justify-between font-bold text-emerald-800">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 size={15} /> {completedDeptOrders.length} Completed Department Order(s) Included in Bill
                  </span>
                  <span className="text-slate-500">
                    Total: <strong className="text-emerald-700 font-mono">{formatCurrency(totalDepartmentCharges)}</strong>
                  </span>
                </div>
              </div>
            )}

            {/* Doctor Fees & Procedure Charges */}
            <div className={sectionBg}>
              <div className="flex items-center justify-between pb-1">
                <span className="font-bold text-slate-800 flex items-center gap-1.5 text-sm">
                  <Receipt size={16} className="text-indigo-600" /> Doctor Consultation &amp; Procedure Fees
                </span>
                <button
                  type="button"
                  onClick={handleAddProcedureRow}
                  className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold flex items-center gap-1 text-xs border border-indigo-200 transition-colors"
                >
                  <Plus size={13} /> Add Procedure Charge
                </button>
              </div>

              <div>
                <label className={labelClass}>Consultation Fee (₹)</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm pointer-events-none select-none">₹</span>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    onWheel={(e) => e.target.blur()}
                    value={consultationFee}
                    onChange={(e) => setConsultationFee(e.target.value)}
                    className="w-full pl-8 pr-8 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition-colors"
                  />
                  {consultationFee !== '' && (
                    <button
                      type="button"
                      onClick={() => setConsultationFee('')}
                      title="Clear fee"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 text-xs font-bold rounded-full hover:bg-slate-100 transition-colors cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {doctorProcedureCharges.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-200">
                  <label className={labelClass}>Doctor Procedure Charges (Dressing, Suturing, Minor Surgery, etc.)</label>
                  {doctorProcedureCharges.map((proc, pIdx) => (
                    <div key={pIdx} className="flex items-center gap-2 bg-white p-2 rounded-lg border border-slate-200">
                      <input
                        type="text"
                        placeholder="Procedure Description (e.g. Wound Dressing, Suture Removal)"
                        value={proc.description}
                        onChange={(e) => handleProcedureChange(pIdx, 'description', e.target.value)}
                        className="flex-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900"
                      />
                      <div className="relative w-28">
                        <span className="absolute left-2.5 top-1.5 text-slate-400 font-bold text-xs">₹</span>
                        <input
                          type="number"
                          min="0"
                          placeholder="0"
                          onWheel={(e) => e.target.blur()}
                          value={proc.amount !== undefined && proc.amount !== null ? proc.amount : ''}
                          onChange={(e) => handleProcedureChange(pIdx, 'amount', e.target.value)}
                          className="w-full pl-6 pr-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-900"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveProcedureRow(pIdx)}
                        className="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                        title="Remove procedure"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Structured Prescriptions */}
            <div className="space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1">
                <div>
                  <label className={labelClass}>Structured Prescription & Treatment Entry</label>
                  <p className="text-[11px] text-slate-500">Supports duty nurse treatment routing, in-house pharmacy, and external prescriptions.</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Hospital Pharmacy vs Outside Rx Mode Switch */}
                  <div className="flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200 text-xs">
                    <button
                      type="button"
                      onClick={() => setPharmacyMode('IN_HOUSE_PHARMACY')}
                      className={`px-2.5 py-1 rounded-md font-bold text-xs transition-all ${pharmacyMode === 'IN_HOUSE_PHARMACY' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                      title="Prescriptions are queued to in-house hospital pharmacy for stock dispensing & hospital billing"
                    >
                      In-House Pharmacy
                    </button>
                    <button
                      type="button"
                      onClick={() => setPharmacyMode('EXTERNAL_NO_INHOUSE_PHARMACY')}
                      className={`px-2.5 py-1 rounded-md font-bold text-xs transition-all ${pharmacyMode === 'EXTERNAL_NO_INHOUSE_PHARMACY' ? 'bg-emerald-700 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                      title="Clinic has no in-house pharmacy. Generates outside take-home prescription with ₹0 added to hospital bill"
                    >
                      Outside Rx (₹0 Added)
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleAddMedicineRow}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold flex items-center gap-1.5 text-xs shadow-xs"
                  >
                    <Plus size={14} /> Add Medicine
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {prescriptions.map((med, idx) => {
                  const matchMed = inventoryMedicines.find((m) => m.name.toLowerCase() === med.medicineName.toLowerCase());
                  const isOutOfStock = matchMed && (matchMed.totalQuantity ?? 0) <= 0;

                  return (
                    <div
                      key={idx}
                      className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2.5 transition-all hover:border-slate-300 shadow-2xs"
                    >
                      {/* Top Row: Name, Form, Frequency, Duration */}
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                        <div className="sm:col-span-5">
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">Medicine / Drug Name *</label>
                          <input
                            type="text"
                            list="consultation-inventory-med-list"
                            placeholder="e.g. Tab. Paracetamol 650mg or Amoxicillin"
                            value={med.medicineName}
                            onChange={(e) => {
                              handleMedicineChange(idx, 'medicineName', e.target.value);
                              handleSelectInventoryMed(idx, e.target.value);
                            }}
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">Dosage Form</label>
                          <select
                            value={med.dosageForm || 'TABLET'}
                            onChange={(e) => handleMedicineChange(idx, 'dosageForm', e.target.value)}
                            className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-900 focus:border-indigo-500"
                          >
                            {['TABLET', 'CAPSULE', 'SYRUP', 'DROPS', 'CREAM', 'INHALER', 'OINTMENT', 'SUSPENSION'].map((f) => (
                              <option key={f} value={f}>{f}</option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-3">
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">Frequency</label>
                          <select
                            value={med.frequency}
                            onChange={(e) => handleMedicineChange(idx, 'frequency', e.target.value)}
                            className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-900 focus:border-indigo-500"
                          >
                            <option value="ONCE_DAILY">Once Daily (1-0-0)</option>
                            <option value="TWICE_DAILY">Twice Daily (1-0-1)</option>
                            <option value="THRICE_DAILY">Thrice Daily (1-1-1)</option>
                            <option value="FOUR_TIMES_DAILY">4 Times Daily (1-1-1-1)</option>
                            <option value="STAT_IMMEDIATE">STAT (Immediate / Single)</option>
                            <option value="AS_NEEDED">As Needed (SOS)</option>
                          </select>
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-bold text-slate-600 mb-1">Duration (Days)</label>
                          <input
                            type="number"
                            min="1"
                            placeholder="e.g. 5"
                            value={med.durationDays !== undefined && med.durationDays !== null ? med.durationDays : ''}
                            onChange={(e) => handleMedicineChange(idx, 'durationDays', e.target.value)}
                            className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-900 focus:border-indigo-500"
                          />
                        </div>
                      </div>

                      {/* Stock Info Banner */}
                      {matchMed && (
                        <div className={`p-2 rounded-lg flex items-center justify-between text-[11px] ${isOutOfStock ? 'bg-amber-50 text-amber-900 border border-amber-200' : 'bg-emerald-50 text-emerald-900 border border-emerald-200'}`}>
                          <span>
                            Pharmacy Stock: <strong>{matchMed.totalQuantity ?? 0} units</strong> ({matchMed.genericName})
                            {isOutOfStock && ' — OUT OF STOCK in In-House Pharmacy'}
                          </span>
                          {isOutOfStock && (
                            <label className="flex items-center gap-1.5 font-bold cursor-pointer text-amber-800 text-[11px]">
                              <input
                                type="checkbox"
                                checked={med.externalPurchaseRequired}
                                onChange={(e) => handleMedicineChange(idx, 'externalPurchaseRequired', e.target.checked)}
                              />
                              Outside Prescription (₹0)
                            </label>
                          )}
                        </div>
                      )}

                      {/* Bottom Row: Quantity, Unit Price, Line Total, Instructions, Delete */}
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center pt-1 border-t border-slate-200/80">
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] font-bold text-slate-500 mb-0.5 uppercase">Quantity (Units)</label>
                          <input
                            type="number"
                            min="0"
                            placeholder="0"
                            onWheel={(e) => e.target.blur()}
                            value={med.quantity !== undefined && med.quantity !== null ? med.quantity : ''}
                            onChange={(e) => handleMedicineChange(idx, 'quantity', e.target.value)}
                            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-900"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[10px] font-bold text-slate-500 mb-0.5 uppercase">Unit Price (₹)</label>
                          <div className="relative">
                            <span className="absolute left-2.5 top-1.5 text-slate-400 font-bold text-xs">₹</span>
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              onWheel={(e) => e.target.blur()}
                              value={med.unitPrice !== undefined && med.unitPrice !== null ? med.unitPrice : ''}
                              onChange={(e) => handleMedicineChange(idx, 'unitPrice', e.target.value)}
                              placeholder="0"
                              className="w-full pl-6 pr-2 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-900"
                            />
                          </div>
                        </div>

                        <div className="sm:col-span-2 text-left sm:text-center">
                          <span className="block text-[10px] font-bold text-slate-500 mb-0.5 uppercase">Line Total</span>
                          <span className="font-mono font-black text-sm text-indigo-700">
                            ₹{((Number(med.quantity || 0)) * Number(med.unitPrice || 0)).toFixed(2)}
                          </span>
                        </div>

                        <div className="sm:col-span-5">
                          <label className="block text-[10px] font-bold text-slate-500 mb-0.5 uppercase">Patient Instructions</label>
                          <input
                            type="text"
                            placeholder="e.g. 1 tab twice daily after meals for 5 days"
                            value={med.instructions}
                            onChange={(e) => handleMedicineChange(idx, 'instructions', e.target.value)}
                            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900"
                          />
                        </div>

                        <div className="sm:col-span-1 flex justify-end pt-3 sm:pt-0">
                          <button
                            type="button"
                            onClick={() => handleRemoveMedicineRow(idx)}
                            className="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                            title="Remove item"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <datalist id="consultation-inventory-med-list">
                {inventoryMedicines.map((m) => (
                  <option key={m._id} value={m.name}>
                    {m.name} ({m.genericName}) — Stock: {m.totalQuantity ?? 0} units
                  </option>
                ))}
              </datalist>
            </div>

            {/* PHARMACY BILLED MEDICINES SUMMARY */}
            {pharmacyBilledPrescriptions.length > 0 && (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-2 text-xs">
                <div className="flex items-center justify-between border-b border-amber-200 pb-2">
                  <span className="font-extrabold text-amber-900 flex items-center gap-1.5 text-sm">
                    <Pill size={16} className="text-amber-600" /> Pharmacy Billed Medicines Summary ({pharmacyBilledPrescriptions.length})
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-600 text-white">
                    BILLED BY PHARMACY & SENT FOR REVIEW
                  </span>
                </div>
                <div className="space-y-1.5">
                  {pharmacyBilledPrescriptions.map((rx) => {
                    const rxCharge = rx.totalMedicineCharge
                      ? Number(rx.totalMedicineCharge)
                      : (rx.medicines || []).reduce(
                          (s, m) => s + ((Number(m.price || m.unitPrice || m.sellingPrice) || 25) * (Number(m.dispensedQty || m.durationDays) || 1)),
                          0
                        );
                    return (
                      <div key={rx._id} className="flex items-center justify-between text-slate-800 bg-white p-2 rounded border border-amber-100">
                        <div>
                          <p className="font-bold">{rx.medicines?.map((m) => m.medicineName).join(', ') || 'Prescription Medicines'}</p>
                          <p className="text-[10px] text-slate-500">Status: {rx.dispenseStatus} &bull; Notes: {rx.pharmacyNotes || 'None'}</p>
                        </div>
                        <span className="font-mono font-black text-amber-900">
                          {formatCurrency(rxCharge)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Clinical Advice & Follow-Up */}
            <div className={sectionBg}>
              <span className="font-bold text-slate-800 flex items-center gap-1.5 text-sm">
                <Activity size={16} className="text-emerald-600" /> Doctor Advice & Follow-Up Plan
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className={labelClass}>Doctor Advice to Patient</label>
                  <input
                    type="text"
                    placeholder="e.g. Rest for 3 days, drink plenty of fluids, avoid heavy lifting..."
                    value={adviceToPatient}
                    onChange={(e) => setAdviceToPatient(e.target.value)}
                    className="w-full p-2 border border-slate-200 rounded-lg text-xs bg-white text-slate-900"
                  />
                </div>
                <div>
                  <label className={labelClass}>Next Follow-Up Date</label>
                  <input
                    type="date"
                    value={followUpDate}
                    onChange={(e) => setFollowUpDate(e.target.value)}
                    className="w-full p-2 border border-slate-200 rounded-lg text-xs bg-white text-slate-900"
                  />
                </div>
              </div>
            </div>

            {/* IPD ADMISSION RECOMMENDATION SECTION */}
            <div className="p-4 rounded-xl bg-purple-50/70 border-2 border-purple-200 space-y-3">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={recommendIpd}
                    onChange={(e) => setRecommendIpd(e.target.checked)}
                    className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 border-slate-300"
                  />
                  <span className="font-extrabold text-purple-950 text-sm flex items-center gap-1.5">
                    <BedDouble size={17} className="text-purple-600" />
                    Recommend Inpatient (IPD) Admission / Ward Transfer
                  </span>
                </label>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${recommendIpd ? 'bg-purple-600 text-white shadow-xs' : 'bg-slate-200 text-slate-600'}`}>
                  {recommendIpd ? 'IPD ADMISSION REQUESTED' : 'OPD ONLY'}
                </span>
              </div>

              {recommendIpd && (
                <div className="space-y-3 pt-2 border-t border-purple-200 animate-fade-in text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-purple-900 mb-1 uppercase tracking-wider">
                        Recommended Ward *
                      </label>
                      <select
                        value={ipdData.recommendedWard}
                        onChange={(e) => setIpdData({ ...ipdData, recommendedWard: e.target.value })}
                        className="w-full p-2 bg-white border border-purple-300 rounded-lg font-bold text-slate-800 focus:ring-2 focus:ring-purple-500/20"
                      >
                        <option value="GENERAL_WARD">General Inpatient Ward (Ward 3B)</option>
                        <option value="ICU">Intensive Care Unit (ICU)</option>
                        <option value="CCU">Coronary Care Unit (CCU)</option>
                        <option value="POST_OP">Post-Operative Recovery Ward</option>
                        <option value="PEDIATRIC_WARD">Pediatric Inpatient Ward</option>
                        <option value="MATERNITY_WARD">Maternity / Labor Ward</option>
                        <option value="EMERGENCY_OBSERVATION">Emergency Observation Ward</option>
                        <option value="PRIVATE_ROOM">Private Deluxe Room</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-purple-900 mb-1 uppercase tracking-wider">
                        Admission Priority *
                      </label>
                      <select
                        value={ipdData.priority}
                        onChange={(e) => setIpdData({ ...ipdData, priority: e.target.value })}
                        className="w-full p-2 bg-white border border-purple-300 rounded-lg font-bold text-slate-800 focus:ring-2 focus:ring-purple-500/20"
                      >
                        <option value="ROUTINE">Routine / Elective Admission</option>
                        <option value="URGENT">Urgent (Within 2 Hours)</option>
                        <option value="EMERGENCY">Emergency (Immediate Bed Transfer)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-purple-900 mb-1 uppercase tracking-wider">
                        Estimated Stay (Days)
                      </label>
                      <input
                        type="number"
                        min="1"
                        onWheel={(e) => e.target.blur()}
                        value={ipdData.estimatedStayDays}
                        onChange={(e) => setIpdData({ ...ipdData, estimatedStayDays: e.target.value })}
                        className="w-full p-2 bg-white border border-purple-300 rounded-lg font-bold text-slate-800"
                        placeholder="e.g. 3"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-purple-900 mb-1 uppercase tracking-wider">
                      Clinical Reason & Admission Indication
                    </label>
                    <textarea
                      rows="2"
                      value={ipdData.admissionReason}
                      onChange={(e) => setIpdData({ ...ipdData, admissionReason: e.target.value })}
                      placeholder="e.g. Severe acute condition requiring continuous IV therapy, vitals monitoring, and inpatient care..."
                      className="w-full p-2 bg-white border border-purple-300 rounded-lg text-slate-800 text-xs"
                    />
                  </div>

                  {/* OPTIONAL GUARDIAN DETAILS FOR IPD */}
                  <div className="p-3 bg-white rounded-lg border border-purple-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-purple-950 flex items-center gap-1.5 text-xs">
                        <UserCheck size={14} className="text-purple-600" />
                        Guardian / Attendant Information (Optional for Inpatient Admission)
                      </span>
                      <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                        OPTIONAL — NOT COMPULSORY
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        placeholder="Guardian Name (Optional)"
                        value={ipdData.guardianName}
                        onChange={(e) => setIpdData({ ...ipdData, guardianName: e.target.value })}
                        className="p-1.5 border border-slate-200 rounded text-xs"
                      />
                      <input
                        type="text"
                        placeholder="Guardian Mobile (Optional)"
                        value={ipdData.guardianPhone}
                        onChange={(e) => setIpdData({ ...ipdData, guardianPhone: e.target.value })}
                        className="p-1.5 border border-slate-200 rounded text-xs"
                      />
                      <select
                        value={ipdData.guardianRelationship}
                        onChange={(e) => setIpdData({ ...ipdData, guardianRelationship: e.target.value })}
                        className="p-1.5 border border-slate-200 rounded text-xs bg-white"
                      >
                        <option value="FATHER">Father</option>
                        <option value="MOTHER">Mother</option>
                        <option value="SPOUSE">Spouse</option>
                        <option value="SIBLING">Sibling</option>
                        <option value="CHILD">Child</option>
                        <option value="LEGAL_GUARDIAN">Legal Guardian</option>
                        <option value="CARETAKER">Caretaker / Attendant</option>
                        <option value="OTHER">Other Relative / Friend</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Comprehensive Itemized Bill Breakdown */}
            <div className="p-4 rounded-xl bg-indigo-50/90 border-2 border-indigo-200 space-y-2.5">
              <div className="flex items-center justify-between border-b border-indigo-200/80 pb-2">
                <span className="font-extrabold text-indigo-950 flex items-center gap-1.5 text-sm">
                  <Receipt size={16} className="text-indigo-600" /> Itemized Consultation Bill Breakdown
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded">
                  {returnedQuery || activeReturnedPrescription ? 'Returned from Billing' : 'Dispatched to Cashier'}
                </span>
              </div>

              <div className="space-y-1 text-xs text-slate-700">
                <div className="flex justify-between">
                  <span>• Doctor Consultation Fee:</span>
                  <span className="font-mono font-bold text-slate-900">{formatCurrency(consultationFee || 0)}</span>
                </div>
                {totalDoctorProcedureCharges > 0 && (
                  <div className="flex justify-between">
                    <span>• Doctor Procedures:</span>
                    <span className="font-mono font-bold text-slate-900">{formatCurrency(totalDoctorProcedureCharges)}</span>
                  </div>
                )}
                {totalDepartmentCharges > 0 && (
                  <div className="flex justify-between">
                    <span>• Department Investigations ({completedDeptOrders.length} tests):</span>
                    <span className="font-mono font-bold text-slate-900">{formatCurrency(totalDepartmentCharges)}</span>
                  </div>
                )}
                {totalPharmacyCharges > 0 && (
                  <div className="flex justify-between">
                    <span>• Pharmacy Prescribed Medicines:</span>
                    <span className="font-mono font-bold text-slate-900">{formatCurrency(totalPharmacyCharges)}</span>
                  </div>
                )}
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-indigo-200 text-sm font-black text-indigo-950">
                <span>Grand Total Consultation Bill:</span>
                <span className="text-xl font-mono text-indigo-700 font-black">{formatCurrency(grandTotal)}</span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="modal-footer flex flex-wrap sm:flex-nowrap gap-2">
            <Button type="button" variant="outline" className="w-full sm:w-1/4 font-bold" onClick={onClose}>
              Cancel / Keep Draft
            </Button>
            <Button
              type="button"
              className="w-full sm:w-1/3 font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-xs gap-1.5"
              onClick={() => {
                setPharmacyMode('IN_HOUSE_PHARMACY');
                setShowConfirmModal(true);
              }}
            >
              <Pill size={16} /> Send to Pharmacy
            </Button>
            <Button
              type="button"
              variant="success"
              className="w-full sm:w-5/12 font-bold gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
              onClick={() => {
                setPharmacyMode('EXTERNAL_NO_INHOUSE_PHARMACY');
                setShowConfirmModal(true);
              }}
            >
              <CheckCircle2 size={17} />
              Finalize and Bill
            </Button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="max-w-md w-full bg-white rounded-2xl p-6 border text-center space-y-4 shadow-xl">
            <h3 className="text-xl font-black text-slate-900">
              {pharmacyMode === 'IN_HOUSE_PHARMACY'
                ? 'Send Prescriptions to Pharmacy?'
                : 'Finalize Consultation & Send to Bill?'}
            </h3>
            <p className="text-xs text-slate-600">
              {pharmacyMode === 'IN_HOUSE_PHARMACY'
                ? 'Prescriptions will be dispatched to the In-House Pharmacy Desk for medicine fulfillment and billing.'
                : 'Doctor consultation, procedure, and investigation charges will be sent directly to Cashier Desk for final billing settlement.'}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="w-1/2 font-bold" onClick={() => setShowConfirmModal(false)}>Cancel</Button>
              <Button
                type="button"
                className={`w-1/2 font-bold text-white ${pharmacyMode === 'IN_HOUSE_PHARMACY' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                isLoading={isLoading}
                onClick={handleFinalizeConfirmed}
              >
                {pharmacyMode === 'IN_HOUSE_PHARMACY' ? 'Confirm & Send to Pharmacy' : 'Confirm & Send to Bill'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

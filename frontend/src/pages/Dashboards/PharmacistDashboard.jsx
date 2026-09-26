import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { StatCard } from '../../components/ui/StatCard';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { AvailabilityBanner } from '../../components/ui/AvailabilityBanner';
import { useAvailability } from '../../hooks/useAvailability';
import { useScrollLock } from '../../hooks/useScrollLock';
import {
  Pill, Boxes, AlertTriangle, CheckCircle2, Plus, ArrowRightLeft,
  Search, ShieldAlert, Layers, RefreshCw, Calendar, FileText, X, IndianRupee, Info, Receipt, Syringe,
  Eye, Edit, TrendingDown, TrendingUp, Sparkles, Clock, AlertCircle, Check
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { axiosClient } from '../../api/axiosClient';
import { useSocket } from '../../providers/SocketProvider';
import { useDepartmentNotificationStore } from '../../store/departmentNotificationStore';
import { PharmacyBillingModal } from '../../components/modals/PharmacyBillingModal';

const RECOMMENDED_MEDICINES = [
  { name: 'Paracetamol 500mg', genericName: 'Paracetamol', category: 'Analgesic / Antipyretic', dosageForm: 'TABLET', strength: '500 mg', purchasePrice: 2, sellingPrice: 5 },
  { name: 'Amoxicillin 250mg', genericName: 'Amoxicillin', category: 'Antibiotic', dosageForm: 'CAPSULE', strength: '250 mg', purchasePrice: 8, sellingPrice: 15 },
  { name: 'Ibuprofen 400mg', genericName: 'Ibuprofen', category: 'NSAID / Anti-inflammatory', dosageForm: 'TABLET', strength: '400 mg', purchasePrice: 4, sellingPrice: 10 },
  { name: 'Omeprazole 20mg', genericName: 'Omeprazole', category: 'Antacid / PPI', dosageForm: 'CAPSULE', strength: '20 mg', purchasePrice: 6, sellingPrice: 12 },
  { name: 'Cetirizine 10mg', genericName: 'Cetirizine', category: 'Antihistamine', dosageForm: 'TABLET', strength: '10 mg', purchasePrice: 3, sellingPrice: 8 },
  { name: 'Azithromycin 500mg', genericName: 'Azithromycin', category: 'Antibiotic', dosageForm: 'TABLET', strength: '500 mg', purchasePrice: 25, sellingPrice: 45 },
  { name: 'Metformin 500mg', genericName: 'Metformin', category: 'Antidiabetic', dosageForm: 'TABLET', strength: '500 mg', purchasePrice: 5, sellingPrice: 12 },
  { name: 'Amlodipine 5mg', genericName: 'Amlodipine', category: 'Antihypertensive', dosageForm: 'TABLET', strength: '5 mg', purchasePrice: 4, sellingPrice: 10 },
];

// Map URL path substring to active tab key
const getActiveTabFromPath = (pathname) => {
  if (pathname.includes('/pharmacy/audit')) return 'audit';
  if (pathname.includes('/pharmacy/stock')) return 'inventory';
  if (pathname.includes('/pharmacy/expiry-alerts')) return 'alerts';
  if (pathname.includes('/pharmacy/dispense-queue')) return 'queue';
  return 'queue';
};

const DEFAULT_ALERTS = { lowStock: [], outOfStock: [], nearExpiry: [], expired: [] };

export const PharmacistDashboard = () => {
  const { user } = useAuthStore();
  const { socket } = useSocket();
  const location = useLocation();
  const navigate = useNavigate();
  const { isAvailable, isToggling, handleToggle, statusMessage } = useAvailability();
  const refreshPendingWork = useDepartmentNotificationStore((state) => state.fetchPendingWork);

  const requestedPrescriptionId = location.state?.prescriptionId || new URLSearchParams(location.search).get('prescriptionId');

  // Drive active view from current URL path (sidebar navigation)
  const activeTab = getActiveTabFromPath(location.pathname);
  const [prescriptions, setPrescriptions] = useState([]);
  const [medicines, setMedicines] = useState([]);
  const [batches, setBatches] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [alerts, setAlerts] = useState(DEFAULT_ALERTS);
  const [stockAdjustments, setStockAdjustments] = useState([]);
  const [substitutions, setSubstitutions] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Modals
  const [showAddMedModal, setShowAddMedModal] = useState(false);
  const [showAddBatchModal, setShowAddBatchModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [showSubReqModal, setShowSubReqModal] = useState(false);
  const [showViewMedModal, setShowViewMedModal] = useState(false);
  const [viewingMedicine, setViewingMedicine] = useState(null);
  const [showEditMedModal, setShowEditMedModal] = useState(false);
  const [editMedForm, setEditMedForm] = useState(null);
  const [inventorySubTab, setInventorySubTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    return ['all', 'prediction', 'in_stock', 'out_of_stock'].includes(tab) ? tab : 'all';
  }); // 'all' | 'prediction' | 'in_stock' | 'out_of_stock'

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    if (tab && ['all', 'prediction', 'in_stock', 'out_of_stock'].includes(tab)) {
      setInventorySubTab(tab);
    }
  }, [location.search]);
  const [selectedRx, setSelectedRx] = useState(null);
  const [billingPrescription, setBillingPrescription] = useState(null);
  const [isBillingModalOpen, setIsBillingModalOpen] = useState(false);
  const [isBillingSubmitting, setIsBillingSubmitting] = useState(false);

  useScrollLock(showAddMedModal || showAddBatchModal || showSubReqModal || showAdjustModal || showTransferModal || isBillingModalOpen || showViewMedModal || showEditMedModal);

  const [medForm, setMedForm] = useState({
    name: '', genericName: '', brandName: '', category: 'Antibiotic', dosageForm: 'TABLET',
    strength: '500 mg', manufacturer: '', supplier: '', purchasePrice: '', sellingPrice: '',
    taxPercentage: '', minimumStockLevel: '20', reorderQuantity: '100', prescriptionRequired: true,
    initialQuantity: '', initialBatchNumber: '', initialExpiryDate: '', rackLocation: 'Rack 1'
  });

  const [batchForm, setBatchForm] = useState({
    medicineId: '', batchNumber: '', location: 'MAIN_PHARMACY', mfgDate: '', expiryDate: '',
    purchasePrice: '', sellingPrice: '', quantity: '', storageLocation: 'Rack 1', reason: 'Initial Stock'
  });

  const [transferForm, setTransferForm] = useState({
    batchId: '', destinationLocation: 'EMERGENCY_PHARMACY', transferQuantity: 10, reason: 'Emergency Ward Stocking'
  });

  const [adjustForm, setAdjustForm] = useState({
    batchId: '', type: 'DAMAGE', quantityChanged: -5, reason: 'Damaged packaging during transport'
  });

  const [subForm, setSubForm] = useState({
    prescriptionId: '', originalMedicineName: '', suggestedMedicineId: '',
    reason: 'Original medicine brand is out of stock in pharmacy. Can we provide equivalent generic from a different company?'
  });

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const [medsRes, rxsRes, batchesRes, adjRes, subsRes, alertRes] = await Promise.all([
        axiosClient.get('/pharmacy/medicines'),
        axiosClient.get('/pharmacy/prescriptions'),
        axiosClient.get('/pharmacy/batches'),
        axiosClient.get('/pharmacy/stock/adjustments'),
        axiosClient.get('/pharmacy/substitutions'),
        axiosClient.get('/pharmacy/alerts'),
      ]);
      setMedicines(medsRes.data || []);
      setPrescriptions(rxsRes.data || []);
      setBatches(batchesRes.data || []);
      setAdjustments(adjRes.data || []);
      const rawAlerts = alertRes?.data;
      const safeAlerts = (rawAlerts && typeof rawAlerts === 'object' && !Array.isArray(rawAlerts))
        ? {
            lowStock: Array.isArray(rawAlerts.lowStock) ? rawAlerts.lowStock : [],
            outOfStock: Array.isArray(rawAlerts.outOfStock) ? rawAlerts.outOfStock : [],
            nearExpiry: Array.isArray(rawAlerts.nearExpiry) ? rawAlerts.nearExpiry : [],
            expired: Array.isArray(rawAlerts.expired) ? rawAlerts.expired : [],
          }
        : DEFAULT_ALERTS;
      setAlerts(safeAlerts);
    } catch (err) {
      console.error('Failed to load pharmacy data:', err);
      setLoadError(err.error?.message || err.message || 'Pharmacy data could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Socket: refresh pending prescriptions in real-time when new ones arrive or doctor responds
  useEffect(() => {
    if (!socket) return;
    let debounceTimer = null;
    const debouncedRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        fetchData();
        refreshPendingWork();
      }, 250);
    };
    socket.on('pharmacy:new_prescription', debouncedRefresh);
    socket.on('prescription:created', debouncedRefresh);
    socket.on('pharmacy:prescription_returned', debouncedRefresh);
    socket.on('pharmacy:substitution_responded', debouncedRefresh);
    socket.on('workflow:notification', debouncedRefresh);
    socket.on('workflow:pending_changed', debouncedRefresh);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      socket.off('pharmacy:new_prescription', debouncedRefresh);
      socket.off('prescription:created', debouncedRefresh);
      socket.off('pharmacy:prescription_returned', debouncedRefresh);
      socket.off('pharmacy:substitution_responded', debouncedRefresh);
      socket.off('workflow:notification', debouncedRefresh);
      socket.off('workflow:pending_changed', debouncedRefresh);
    };
  }, [socket, refreshPendingWork]);

  useEffect(() => {
    if (requestedPrescriptionId && prescriptions.length > 0) {
      const match = prescriptions.find((p) => String(p._id) === String(requestedPrescriptionId));
      if (match && !billingPrescription) {
        setBillingPrescription(match);
        setIsBillingModalOpen(true);
      }
    }
  }, [requestedPrescriptionId, prescriptions, billingPrescription]);

  const pending = useMemo(
    () => prescriptions.filter((item) => item.dispenseStatus === 'PENDING_DISPENSE' || item.dispenseStatus === 'PARTIALLY_DISPENSED' || item.dispenseStatus === 'PENDING'),
    [prescriptions]
  );
  const dispensed = useMemo(
    () => prescriptions.filter((item) => item.dispenseStatus === 'DISPENSED'),
    [prescriptions]
  );

  const handleAcknowledgeSub = async (id) => {
    try {
      await axiosClient.patch(`/pharmacy/substitutions/${id}/acknowledge`);
      await Promise.all([fetchData(), refreshPendingWork()]);
    } catch (err) {
      console.error('Failed to acknowledge substitution:', err);
    }
  };

  const handleOpenBillingModal = (rx) => {
    setBillingPrescription(rx);
    setIsBillingModalOpen(true);
  };

  const handleModalDispense = async ({ items, totalMedicineCharge, pharmacyNotes }) => {
    if (!billingPrescription) return;
    setIsBillingSubmitting(true);
    try {
      await axiosClient.patch(`/pharmacy/prescriptions/${billingPrescription._id}/dispense`, {
        items,
        totalMedicineCharge,
        pharmacyNotes,
      });
      setIsBillingModalOpen(false);
      setBillingPrescription(null);
      await Promise.all([fetchData(), refreshPendingWork()]);
    } catch (err) {
      console.error('Failed to dispense:', err);
      alert(err.response?.data?.message || 'Failed to dispense');
    } finally {
      setIsBillingSubmitting(false);
    }
  };

  const handleModalExternalPurchase = async ({ isExternal, pharmacyNotes }) => {
    if (!billingPrescription) return;
    setIsBillingSubmitting(true);
    try {
      await axiosClient.patch(`/pharmacy/prescriptions/${billingPrescription._id}/dispense`, {
        isExternal: true,
        pharmacyNotes,
      });
      setIsBillingModalOpen(false);
      setBillingPrescription(null);
      await Promise.all([fetchData(), refreshPendingWork()]);
    } catch (err) {
      console.error('Failed to mark external purchase:', err);
      alert(err.response?.data?.message || 'Failed to mark external purchase');
    } finally {
      setIsBillingSubmitting(false);
    }
  };

  const handleDispense = async (id, external = false) => {
    try {
      await axiosClient.patch(`/pharmacy/prescriptions/${id}/dispense`, {
        isExternal: external,
        pharmacyNotes: external ? 'Marked external purchase (No Hospital Charge)' : 'Dispensed via FEFO',
      });
      await Promise.all([fetchData(), refreshPendingWork()]);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to dispense');
    }
  };

  const handleCreateMedicine = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...medForm,
        purchasePrice: medForm.purchasePrice === '' ? 0 : Number(medForm.purchasePrice),
        sellingPrice: medForm.sellingPrice === '' ? 0 : Number(medForm.sellingPrice),
        taxPercentage: medForm.taxPercentage === '' ? 0 : Number(medForm.taxPercentage),
        minimumStockLevel: medForm.minimumStockLevel === '' ? 20 : Number(medForm.minimumStockLevel),
        reorderQuantity: medForm.reorderQuantity === '' ? 100 : Number(medForm.reorderQuantity),
        initialQuantity: medForm.initialQuantity === '' ? 0 : Number(medForm.initialQuantity),
        initialBatchNumber: medForm.initialBatchNumber?.trim() || undefined,
        initialExpiryDate: medForm.initialExpiryDate || undefined,
        rackLocation: medForm.rackLocation?.trim() || 'Rack 1',
      };
      await axiosClient.post('/pharmacy/medicines', payload);
      setShowAddMedModal(false);
      setMedForm({
        name: '', genericName: '', brandName: '', category: 'Antibiotic', dosageForm: 'TABLET',
        strength: '500 mg', manufacturer: '', supplier: '', purchasePrice: '', sellingPrice: '',
        taxPercentage: '', minimumStockLevel: '20', reorderQuantity: '100', prescriptionRequired: true,
        initialQuantity: '', initialBatchNumber: '', initialExpiryDate: '', rackLocation: 'Rack 1'
      });
      fetchData();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to add medicine');
    }
  };

  const handleUpdateMedicine = async (e) => {
    e.preventDefault();
    if (!editMedForm?._id) return;
    try {
      const payload = {
        ...editMedForm,
        purchasePrice: editMedForm.purchasePrice === '' ? 0 : Number(editMedForm.purchasePrice),
        sellingPrice: editMedForm.sellingPrice === '' ? 0 : Number(editMedForm.sellingPrice),
        taxPercentage: editMedForm.taxPercentage === '' ? 0 : Number(editMedForm.taxPercentage),
        minimumStockLevel: editMedForm.minimumStockLevel === '' ? 20 : Number(editMedForm.minimumStockLevel),
        reorderQuantity: editMedForm.reorderQuantity === '' ? 100 : Number(editMedForm.reorderQuantity),
      };
      await axiosClient.put(`/pharmacy/medicines/${editMedForm._id}`, payload);
      setShowEditMedModal(false);
      setEditMedForm(null);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update medicine');
    }
  };

  const handleAddBatch = async (e) => {
    e.preventDefault();
    try {
      const targetMed = medicines.find((m) => m._id === batchForm.medicineId);
      const payload = {
        ...batchForm,
        quantity: batchForm.quantity === '' ? 1 : Number(batchForm.quantity),
        purchasePrice: batchForm.purchasePrice === '' ? (targetMed?.purchasePrice || 0) : Number(batchForm.purchasePrice),
        sellingPrice: batchForm.sellingPrice === '' ? (targetMed?.sellingPrice || 0) : Number(batchForm.sellingPrice),
        batchNumber: batchForm.batchNumber?.trim() || `BATCH-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      };
      await axiosClient.post('/pharmacy/batches', payload);
      setShowAddBatchModal(false);
      setBatchForm({
        medicineId: '', batchNumber: '', location: 'MAIN_PHARMACY', mfgDate: '', expiryDate: '',
        purchasePrice: '', sellingPrice: '', quantity: '', storageLocation: 'Rack 1', reason: 'Stock replenishment'
      });
      fetchData();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to add batch');
    }
  };

  const handleOpenView = (med) => {
    setViewingMedicine(med);
    setShowViewMedModal(true);
  };

  const handleOpenEdit = (med) => {
    setEditMedForm({
      _id: med._id,
      name: med.name || '',
      genericName: med.genericName || '',
      brandName: med.brandName || '',
      category: med.category || 'Antibiotic',
      dosageForm: med.dosageForm || 'TABLET',
      strength: med.strength || '',
      manufacturer: med.manufacturer || '',
      supplier: med.supplier || '',
      purchasePrice: med.purchasePrice !== undefined && med.purchasePrice !== null ? String(med.purchasePrice) : '',
      sellingPrice: med.sellingPrice !== undefined && med.sellingPrice !== null ? String(med.sellingPrice) : '',
      taxPercentage: med.taxPercentage !== undefined && med.taxPercentage !== null ? String(med.taxPercentage) : '',
      minimumStockLevel: med.minimumStockLevel !== undefined && med.minimumStockLevel !== null ? String(med.minimumStockLevel) : '20',
      reorderQuantity: med.reorderQuantity !== undefined && med.reorderQuantity !== null ? String(med.reorderQuantity) : '100',
      prescriptionRequired: med.prescriptionRequired ?? true,
    });
    setShowEditMedModal(true);
  };

  const handleOpenAddBatch = (med, suggestedQty) => {
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
    const defaultExpDate = oneYearFromNow.toISOString().split('T')[0];
    setBatchForm({
      medicineId: med?._id || '',
      batchNumber: `BATCH-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      location: 'MAIN_PHARMACY',
      mfgDate: new Date().toISOString().split('T')[0],
      expiryDate: defaultExpDate,
      purchasePrice: med?.purchasePrice !== undefined ? String(med.purchasePrice) : '',
      sellingPrice: med?.sellingPrice !== undefined ? String(med.sellingPrice) : '',
      quantity: suggestedQty ? String(suggestedQty) : '',
      storageLocation: 'Rack 1',
      reason: suggestedQty ? 'Low stock forecast replenishment' : 'Stock replenishment',
    });
    setShowAddBatchModal(true);
  };

  const handleTransfer = async (e) => {
    e.preventDefault();
    try {
      await axiosClient.post('/pharmacy/stock/transfer', transferForm);
      setShowTransferModal(false);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to transfer stock');
    }
  };

  const handleAdjust = async (e) => {
    e.preventDefault();
    try {
      await axiosClient.post('/pharmacy/stock/adjust', adjustForm);
      setShowAdjustModal(false);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to adjust stock');
    }
  };

  const handleRequestSubstitution = async (e) => {
    e.preventDefault();
    if (!subForm.prescriptionId) {
      alert('Please open substitution request from a specific pending prescription.');
      return;
    }
    const payload = {
      ...subForm,
      suggestedMedicineId: (subForm.suggestedMedicineId && !subForm.suggestedMedicineId.startsWith('rec_')) ? subForm.suggestedMedicineId : null,
    };
    try {
      await axiosClient.post('/pharmacy/substitutions/request', payload);
      setShowSubReqModal(false);
      setSubForm({ prescriptionId: '', originalMedicineName: '', suggestedMedicineId: '', reason: 'Brand out of stock, offering bioequivalent generic' });
      alert('Substitution request submitted for physician review.');
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to send substitution request');
    }
  };

  const predictionStats = React.useMemo(() => {
    let outOfStock = 0;
    let lowStock = 0;
    let atRisk = 0;
    let healthy = 0;
    let totalSuggestedUnits = 0;

    medicines.forEach((m) => {
      const qty = m.totalQuantity || 0;
      const min = m.minimumStockLevel || 20;
      const reorder = m.reorderQuantity || 100;
      if (qty === 0) {
        outOfStock++;
        totalSuggestedUnits += Math.max(reorder, min * 2);
      } else if (qty <= min) {
        lowStock++;
        totalSuggestedUnits += Math.max(reorder, (min * 2) - qty);
      } else if (qty <= min * 1.5) {
        atRisk++;
        totalSuggestedUnits += Math.max(reorder, (min * 2) - qty);
      } else {
        healthy++;
      }
    });

    return {
      outOfStock,
      lowStock,
      atRisk,
      healthy,
      totalAtRiskOrLow: outOfStock + lowStock + atRisk,
      totalSuggestedUnits,
      healthScore: medicines.length > 0 ? Math.round((healthy / medicines.length) * 100) : 100,
    };
  }, [medicines]);

  const filteredMedicines = useMemo(() => {
    const s = searchTerm.trim().toLowerCase();
    if (!s) return medicines;
    return medicines.filter((m) => {
      const name = (m.name || '').toLowerCase();
      const generic = (m.genericName || '').toLowerCase();
      const cat = (m.category || '').toLowerCase();
      return name.includes(s) || generic.includes(s) || cat.includes(s);
    });
  }, [medicines, searchTerm]);

  const inventoryFilteredMedicines = useMemo(() => {
    const s = searchTerm.trim().toLowerCase();
    return medicines.filter((m) => {
      if (s) {
        const name = (m.name || '').toLowerCase();
        const generic = (m.genericName || '').toLowerCase();
        const cat = (m.category || '').toLowerCase();
        if (!name.includes(s) && !generic.includes(s) && !cat.includes(s)) return false;
      }

      const qty = m.totalQuantity || 0;
      const min = m.minimumStockLevel || 20;

      if (inventorySubTab === 'prediction') {
        return qty <= min * 1.5;
      }
      if (inventorySubTab === 'in_stock') {
        return qty > 0;
      }
      if (inventorySubTab === 'out_of_stock') {
        return qty === 0;
      }
      return true;
    });
  }, [medicines, searchTerm, inventorySubTab]);

  return (
    <div className="space-y-5 animate-fade-in">

      {loadError && (
        <div role="alert" className="p-3 rounded-xl border border-rose-300 bg-rose-50 text-rose-800 text-sm font-semibold flex items-center justify-between gap-3">
          <span>{loadError}</span>
          <Button size="sm" variant="outline" onClick={fetchData}>Retry</Button>
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Pharmacy & Medicine Inventory</h2>
          <p className="text-xs text-slate-500 mt-1">{user?.name || 'Pharmacist'} — Multi-Location FEFO Inventory & Dispensing System</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={() => setShowAddMedModal(true)}>
            <Plus size={16} className="mr-1" /> Add Medicine SKU
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowAddBatchModal(true)}>
            <Boxes size={16} className="mr-1" /> Add Stock Batch
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowTransferModal(true)}>
            <ArrowRightLeft size={16} className="mr-1" /> Stock Transfer
          </Button>
        </div>
      </div>

      {/* Availability / Online Toggle Banner */}
      <AvailabilityBanner
        role="Pharmacist"
        isAvailable={isAvailable}
        isToggling={isToggling}
        onToggle={handleToggle}
        pendingCount={pending.length}
      />

      {statusMessage && (
        <div className={`p-3 rounded-xl border text-xs font-bold ${statusMessage.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
          {statusMessage.text}
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Prescriptions Pending" value={`${pending.length} Orders`} subtitle="FEFO Auto E-Prescription Queue" icon={Pill} color="sky" />
        <StatCard title="Today Dispensed" value={`${dispensed.length} Orders`} subtitle="Auto Invoice Billing Sync" icon={CheckCircle2} color="emerald" />
        <StatCard title="Near-Expiry / Expired" value={`${(alerts?.nearExpiry?.length || 0) + (alerts?.expired?.length || 0)} Batches`} subtitle="Requires Immediate Action" icon={AlertTriangle} color="amber" />
        <StatCard title="Total Medicine SKUs" value={`${medicines.length} SKUs`} subtitle={`${alerts?.outOfStock?.length || 0} Out of Stock`} icon={Boxes} color="purple" />
      </div>



      {/* TAB 1: E-Prescription Queue */}
      {activeTab === 'queue' && (
        <div className="space-y-4">
          {/* Doctor Substitution Responses Alert Banner */}
          {substitutions.filter((s) => s.status !== 'PENDING' && !s.acknowledgedByPharmacist).length > 0 && (
            <Card className="bg-emerald-50/70 border border-emerald-200">
              <h3 className="text-sm font-extrabold text-emerald-900 flex items-center gap-2 mb-2">
                <CheckCircle2 size={16} className="text-emerald-600" />
                Doctor Responses to Substitution Requests ({substitutions.filter((s) => s.status !== 'PENDING' && !s.acknowledgedByPharmacist).length})
              </h3>
              <div className="divide-y divide-emerald-100 text-xs">
                {substitutions.filter((s) => s.status !== 'PENDING' && !s.acknowledgedByPharmacist).map((sub) => (
                  <div key={sub._id} className="py-2.5 flex flex-col md:flex-row md:items-center justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-900">
                        Patient: {sub.patientId?.firstName} {sub.patientId?.lastName} ({sub.patientId?.uhid})
                      </p>
                      <p className="text-slate-600">
                        Original: <span className="font-semibold text-slate-800">{sub.originalMedicineName}</span> &rarr; Suggested: <span className="font-semibold text-slate-800">{sub.suggestedMedicineName}</span>
                      </p>
                      <p className="text-slate-500 mt-0.5">
                        Dr. {sub.doctorId?.name || 'Doctor'} response: <span className={`font-bold ${sub.status === 'APPROVED' ? 'text-emerald-700' : 'text-rose-700'}`}>{sub.status}</span> &mdash; "{sub.doctorResponseNotes || 'No notes'}"
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => handleAcknowledgeSub(sub._id)}>
                      Dismiss Alert
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Pill size={18} className="text-indigo-500" />
                Pending Prescriptions
              </h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-mono">FEFO Auto-Allocation</span>
              <button onClick={fetchData} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors" title="Refresh">
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="p-12 text-center">
              <div className="inline-block w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-xs text-slate-500">Loading prescriptions...</p>
            </div>
          ) : pending.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {pending.map((rx) => (
                <div key={rx._id} className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-slate-900 text-sm">{rx.patientId?.firstName} {rx.patientId?.lastName}</p>
                      <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-mono font-bold">{rx.prescriptionNo}</span>
                      <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold">{rx.dispenseStatus}</span>
                    </div>
                    <p className="text-slate-500">Dr. {rx.doctorId?.name} · {rx.medicines?.length || 0} Prescribed Items</p>

                    {/* Billing Query Banner if returned from Billing Desk */}
                    {rx.billingQuery && !rx.billingQuery.resolved && (
                      <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-300 flex items-start gap-2 text-amber-900 mt-1.5">
                        <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold text-[11px] text-amber-950">
                            Returned by Central Billing ({rx.billingQuery.requestedByName || 'Cashier'}):
                          </p>
                          <p className="text-[11px] text-amber-900 font-semibold mt-0.5">
                            "{rx.billingQuery.query}"
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Medicines List */}
                    <div className="mt-2 space-y-1 bg-slate-50 p-2.5 rounded border border-slate-100">
                      {rx.medicines?.map((med, idx) => (
                        <div key={idx} className="flex items-center justify-between text-slate-700">
                          <div>
                            <span className="font-bold">{med.medicineName}</span> ({med.dosageForm} - {med.dosage}) — {med.frequency} for {med.durationDays} days
                            <span className={`inline-flex items-center gap-1 ml-2 px-1.5 py-0.5 rounded text-[9px] font-extrabold ${med.treatmentType === 'NURSE_ADMINISTERED' || med.dosageForm === 'INJECTION' ? 'bg-rose-100 text-rose-800 border border-rose-200' : 'bg-sky-100 text-sky-800 border border-sky-200'}`}>
                              {med.treatmentType === 'NURSE_ADMINISTERED' || med.dosageForm === 'INJECTION' ? (
                                <>
                                  <Syringe size={10} /> Nurse Station Administration
                                </>
                              ) : (
                                <>
                                  <Pill size={10} /> Take-Home Medication
                                </>
                              )}
                            </span>
                          </div>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${med.itemStatus === 'DISPENSED' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'}`}>
                            {med.itemStatus}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 shrink-0">
                    <Button variant="primary" size="sm" onClick={() => handleOpenBillingModal(rx)}>
                      <Receipt size={14} className="mr-1" /> Calculate Bill & Dispense
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleDispense(rx._id, true)}>
                      External Purchase
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSubForm({
                          prescriptionId: rx._id,
                          originalMedicineName: rx.medicines?.[0]?.medicineName || '',
                          suggestedMedicineId: medicines[0]?._id || '',
                          reason: 'Brand unavailable, offering bioequivalent alternative',
                        });
                        setShowSubReqModal(true);
                      }}
                    >
                      Request Substitution
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-10 text-center space-y-3">
              <CheckCircle2 size={36} className="mx-auto text-emerald-400" />
              <p className="text-slate-600 font-semibold text-sm">No pending prescriptions in queue</p>
              <p className="text-xs text-slate-400">All e-prescriptions are dispensed or this queue is empty. Doctor-issued prescriptions will appear here automatically.</p>
              <button onClick={fetchData} className="mt-2 text-xs text-indigo-600 hover:underline flex items-center gap-1 mx-auto">
                <RefreshCw size={12} /> Refresh Queue
              </button>
            </div>
          )}
        </Card>
      </div>
      )}

      {/* TAB 2: Medicine SKUs Inventory */}
      {activeTab === 'inventory' && (
        <div className="space-y-4">
          {/* Sub-navigation Tabs */}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3">
            <button
              type="button"
              onClick={() => setInventorySubTab('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                inventorySubTab === 'all'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <Boxes size={14} />
              All Inventory
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${inventorySubTab === 'all' ? 'bg-indigo-700 text-white' : 'bg-slate-200 text-slate-700'}`}>
                {medicines.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setInventorySubTab('prediction')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                inventorySubTab === 'prediction'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <TrendingDown size={14} className={predictionStats.totalAtRiskOrLow > 0 ? 'text-amber-500 animate-pulse' : ''} />
              Low Stock & Smart Forecast
              {predictionStats.totalAtRiskOrLow > 0 && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${inventorySubTab === 'prediction' ? 'bg-amber-700 text-white' : 'bg-rose-500 text-white'}`}>
                  {predictionStats.totalAtRiskOrLow}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setInventorySubTab('in_stock')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                inventorySubTab === 'in_stock'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <CheckCircle2 size={14} />
              In Stock
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${inventorySubTab === 'in_stock' ? 'bg-emerald-700 text-white' : 'bg-slate-200 text-slate-700'}`}>
                {medicines.filter((m) => (m.totalQuantity || 0) > 0).length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setInventorySubTab('out_of_stock')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                inventorySubTab === 'out_of_stock'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <AlertCircle size={14} />
              Out of Stock
              <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${inventorySubTab === 'out_of_stock' ? 'bg-rose-700 text-white' : 'bg-slate-200 text-slate-700'}`}>
                {predictionStats.outOfStock}
              </span>
            </button>
          </div>

          {/* VIEW: LOW STOCK PREDICTION & RESTOCK FORECAST */}
          {inventorySubTab === 'prediction' && (
            <div className="space-y-4">
              {/* Forecast Metrics Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-gradient-to-br from-rose-50 to-rose-100/50 border border-rose-200">
                  <p className="text-xs font-bold text-rose-800 flex items-center gap-1.5">
                    <AlertTriangle size={14} className="text-rose-600" /> Out of Stock SKUs
                  </p>
                  <p className="text-2xl font-extrabold text-rose-950 mt-1">{predictionStats.outOfStock}</p>
                  <p className="text-[11px] text-rose-600 mt-0.5">Critical: Immediate Reorder</p>
                </div>

                <div className="p-3.5 rounded-xl bg-gradient-to-br from-amber-50 to-amber-100/50 border border-amber-200">
                  <p className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                    <TrendingDown size={14} className="text-amber-600" /> Below Safety Level
                  </p>
                  <p className="text-2xl font-extrabold text-amber-950 mt-1">{predictionStats.lowStock}</p>
                  <p className="text-[11px] text-amber-600 mt-0.5">Stock &le; Minimum Threshold</p>
                </div>

                <div className="p-3.5 rounded-xl bg-gradient-to-br from-indigo-50 to-indigo-100/50 border border-indigo-200">
                  <p className="text-xs font-bold text-indigo-800 flex items-center gap-1.5">
                    <Clock size={14} className="text-indigo-600" /> Forecasted Depletion Risk
                  </p>
                  <p className="text-2xl font-extrabold text-indigo-950 mt-1">{predictionStats.atRisk}</p>
                  <p className="text-[11px] text-indigo-600 mt-0.5">Will deplete within days</p>
                </div>

                <div className="p-3.5 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100/50 border border-emerald-200">
                  <p className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                    <Sparkles size={14} className="text-emerald-600" /> Suggested Reorders
                  </p>
                  <p className="text-2xl font-extrabold text-emerald-950 mt-1">{predictionStats.totalSuggestedUnits} <span className="text-xs font-normal">units</span></p>
                  <p className="text-[11px] text-emerald-600 mt-0.5">{predictionStats.healthScore}% Inventory Adequacy</p>
                </div>
              </div>

              {/* Prediction Advisory Card */}
              <Card>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                      <TrendingDown size={18} className="text-amber-600" />
                      Low Stock Prediction & Restock Forecast
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Predictive burn-rate analysis. Items highlighted below are depleted or at risk of stockouts.
                    </p>
                  </div>
                  <div className="relative w-full md:w-72">
                    <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Filter prediction list..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                {inventoryFilteredMedicines.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider text-[10px]">
                        <tr>
                          <th className="p-3">Medicine SKU</th>
                          <th className="p-3">Current vs Safety Buffer</th>
                          <th className="p-3">Depletion Risk</th>
                          <th className="p-3">Estimated Runout</th>
                          <th className="p-3">Suggested Reorder</th>
                          <th className="p-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {inventoryFilteredMedicines.map((med) => {
                          const currQty = med.totalQuantity || 0;
                          const minStock = med.minimumStockLevel || 20;
                          const reorderQty = med.reorderQuantity || 100;
                          const suggestedOrder = Math.max(reorderQty, (minStock * 2) - currQty);
                          const isOutOfStock = currQty === 0;
                          const isLowStock = !isOutOfStock && currQty <= minStock;
                          const isAtRisk = !isOutOfStock && !isLowStock && currQty <= minStock * 1.5;
                          const bufferPct = Math.min(100, Math.round((currQty / (minStock * 2)) * 100));

                          return (
                            <tr key={med._id} className="hover:bg-slate-50">
                              <td className="p-3">
                                <p className="font-bold text-slate-900">{med.name}</p>
                                <p className="text-[11px] text-slate-500">{med.genericName} · {med.dosageForm} ({med.strength})</p>
                              </td>
                              <td className="p-3">
                                <div className="flex items-center gap-2">
                                  <span className={`font-extrabold ${isOutOfStock ? 'text-rose-600' : isLowStock ? 'text-amber-700' : 'text-slate-800'}`}>
                                    {currQty}
                                  </span>
                                  <span className="text-slate-400">/ min {minStock} units</span>
                                </div>
                                <div className="w-32 bg-slate-200 rounded-full h-1.5 mt-1.5 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${
                                      isOutOfStock ? 'w-0' : isLowStock ? 'bg-amber-500' : isAtRisk ? 'bg-indigo-500' : 'bg-emerald-500'
                                    }`}
                                    style={{ width: `${bufferPct}%` }}
                                  />
                                </div>
                              </td>
                              <td className="p-3">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                                  isOutOfStock ? 'bg-rose-100 text-rose-800 border border-rose-200' :
                                  isLowStock ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                                  'bg-indigo-100 text-indigo-800 border border-indigo-200'
                                }`}>
                                  {isOutOfStock ? 'CRITICAL OUT OF STOCK' : isLowStock ? 'HIGH DEPLETION RISK' : 'MODERATE RISK'}
                                </span>
                              </td>
                              <td className="p-3">
                                <span className={`font-bold text-xs ${isOutOfStock ? 'text-rose-600' : isLowStock ? 'text-amber-700' : 'text-slate-700'}`}>
                                  {isOutOfStock ? '0 Days (Stockout)' : currQty <= minStock * 0.5 ? '< 3 Days remaining' : currQty <= minStock ? '3 to 7 Days remaining' : '1 to 2 Weeks remaining'}
                                </span>
                              </td>
                              <td className="p-3">
                                <div className="font-extrabold text-indigo-700 text-xs">
                                  +{suggestedOrder} units
                                </div>
                                <p className="text-[10px] text-slate-400">Est. cost: ₹{((med.purchasePrice || 0) * suggestedOrder).toFixed(0)}</p>
                              </td>
                              <td className="p-3 text-right space-x-1">
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => handleOpenAddBatch(med, suggestedOrder)}
                                  title="Add stock batch pre-filled with suggested quantity"
                                >
                                  <Plus size={13} className="mr-1" /> Restock Batch
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleOpenView(med)}
                                  title="View SKU details and batches"
                                >
                                  <Eye size={14} />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-10 text-center space-y-3">
                    <CheckCircle2 size={36} className="mx-auto text-emerald-500" />
                    <p className="text-slate-700 font-bold text-sm">All Inventory Healthy!</p>
                    <p className="text-xs text-slate-400 max-w-md mx-auto">
                      All medicine SKUs have adequate stock above their minimum safety thresholds. No replenishment is urgently required.
                    </p>
                    <Button variant="outline" size="sm" onClick={() => setInventorySubTab('all')}>
                      View All Medicines
                    </Button>
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* VIEW: INVENTORY TABLE (ALL, IN_STOCK, OUT_OF_STOCK) */}
          {inventorySubTab !== 'prediction' && (
            <Card>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search medicines by name, generic composition, category..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-xs text-slate-500 font-bold">{inventoryFilteredMedicines.length} Medicines Found</div>
                  <Button variant="primary" size="sm" onClick={() => setShowAddMedModal(true)}>
                    <Plus size={14} className="mr-1" /> Add SKU
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider">
                    <tr>
                      <th className="p-3">Medicine Name</th>
                      <th className="p-3">Generic Name</th>
                      <th className="p-3">Category</th>
                      <th className="p-3">Form & Strength</th>
                      <th className="p-3">Sell Price</th>
                      <th className="p-3">Available Stock</th>
                      <th className="p-3">Status</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {inventoryFilteredMedicines.map((med) => {
                      const totalStock = med.totalQuantity ?? 0;
                      const batchCount = med.batches?.length || 0;

                      return (
                        <tr key={med._id} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3 font-bold text-slate-900">
                            <div>{med.name}</div>
                            {med.brandName && <div className="text-[10px] text-slate-400 font-normal">Brand: {med.brandName}</div>}
                          </td>
                          <td className="p-3 text-slate-600">{med.genericName}</td>
                          <td className="p-3 text-slate-600">{med.category}</td>
                          <td className="p-3 text-slate-600">{med.dosageForm} ({med.strength})</td>
                          <td className="p-3 font-bold text-slate-900">₹{med.sellingPrice}</td>
                          <td className="p-3">
                            <div className="font-bold text-indigo-700 text-xs">{totalStock} units</div>
                            <div className="text-[10px] text-slate-400">{batchCount} {batchCount === 1 ? 'batch' : 'batches'}</div>
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded font-bold text-[11px] ${
                              med.stockStatus === 'IN_STOCK' ? 'bg-emerald-100 text-emerald-800' :
                              med.stockStatus === 'LOW_STOCK' ? 'bg-amber-100 text-amber-800' :
                              'bg-rose-100 text-rose-800'
                            }`}>
                              {med.stockStatus}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <div className="inline-flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenView(med)}
                                className="text-slate-600 hover:text-indigo-600 hover:bg-indigo-50"
                                title="View SKU Specifications & Batches"
                              >
                                <Eye size={14} className="mr-1" /> View
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenEdit(med)}
                                className="text-slate-600 hover:text-emerald-600 hover:bg-emerald-50"
                                title="Edit Medicine Details"
                              >
                                <Edit size={14} className="mr-1" /> Edit
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleOpenAddBatch(med)}
                                className="text-indigo-700 hover:bg-indigo-50 border-indigo-200"
                                title="Add Stock Batch"
                              >
                                <Plus size={13} className="mr-1" /> Batch
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* TAB 3: Alerts */}
      {activeTab === 'alerts' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <h3 className="text-base font-bold text-amber-900 mb-3 flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-600" /> Low Stock Medicines ({alerts?.lowStock?.length || 0})
            </h3>
            <div className="divide-y divide-slate-100 text-xs">
              {(alerts?.lowStock || []).map((med) => (
                <div key={med._id} className="py-2.5 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-900">{med.name}</p>
                    <p className="text-slate-500">{med.genericName} · Min level: {med.minimumStockLevel}</p>
                  </div>
                  <span className="font-bold text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-200">
                    {med.totalQuantity} units left
                  </span>
                </div>
              ))}
              {(alerts?.lowStock?.length || 0) === 0 && <p className="text-slate-500 py-4 text-center">No low stock items.</p>}
            </div>
          </Card>

          <Card>
            <h3 className="text-base font-bold text-rose-900 mb-3 flex items-center gap-2">
              <ShieldAlert size={18} className="text-rose-600" /> Expired or Near-Expiry Stock ({(alerts?.nearExpiry?.length || 0) + (alerts?.expired?.length || 0)})
            </h3>
            <div className="divide-y divide-slate-100 text-xs">
              {(alerts?.expired || []).map((b, i) => (
                <div key={i} className="py-2.5 flex items-center justify-between bg-rose-50/50 px-2 rounded">
                  <div>
                    <p className="font-bold text-rose-900">{b.name} (Batch: {b.batchNumber})</p>
                    <p className="text-rose-700">Location: {b.location} · Expired on {new Date(b.expiryDate).toLocaleDateString()}</p>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      setAdjustForm({ batchId: b._id, type: 'EXPIRED_DISPOSAL', quantityChanged: -b.quantity, reason: 'Expired stock disposal' });
                      setShowAdjustModal(true);
                    }}
                  >
                    Dispose
                  </Button>
                </div>
              ))}
              {(alerts?.nearExpiry || []).map((b, i) => (
                <div key={i} className="py-2.5 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-900">{b.name} (Batch: {b.batchNumber})</p>
                    <p className="text-amber-700">Expires soon: {new Date(b.expiryDate).toLocaleDateString()}</p>
                  </div>
                  <span className="font-bold text-amber-800">{b.quantity} units</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* TAB 4: Stock Movement Audit */}
      {activeTab === 'audit' && (
        <Card>
          <h3 className="text-base font-bold text-slate-900 mb-3 flex items-center gap-2">
            <FileText size={18} className="text-indigo-600" /> Complete Inventory Stock Audit Trail
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider">
                <tr>
                  <th className="p-3">Timestamp</th>
                  <th className="p-3">Medicine</th>
                  <th className="p-3">Batch No</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Location</th>
                  <th className="p-3">Qty Change</th>
                  <th className="p-3">Reason</th>
                  <th className="p-3">Performed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stockAdjustments.map((log) => (
                  <tr key={log._id} className="hover:bg-slate-50">
                    <td className="p-3 font-mono text-slate-500">{new Date(log.createdAt).toLocaleString()}</td>
                    <td className="p-3 font-bold text-slate-900">{log.medicineId?.name || 'Medicine'}</td>
                    <td className="p-3 font-mono">{log.batchNumber || 'N/A'}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded font-bold ${log.type === 'ADD_STOCK' ? 'bg-emerald-100 text-emerald-800' : log.type === 'DISPENSE' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-200 text-slate-800'}`}>
                        {log.type}
                      </span>
                    </td>
                    <td className="p-3 text-slate-600">{log.sourceLocation} {log.destinationLocation ? `→ ${log.destinationLocation}` : ''}</td>
                    <td className={`p-3 font-bold ${log.quantityChanged > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {log.quantityChanged > 0 ? `+${log.quantityChanged}` : log.quantityChanged}
                    </td>
                    <td className="p-3 text-slate-600">{log.reason}</td>
                    <td className="p-3 font-bold text-slate-900">{log.performedByName || log.performedBy?.name || 'Staff'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* MODAL: ADD MEDICINE */}
      {showAddMedModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto border border-slate-200">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">Add New Medicine SKU</h3>
                <p className="text-[11px] text-slate-500">Create SKU and optionally add initial batch stock in one step</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddMedModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleCreateMedicine} className="space-y-3 text-xs">
              <div className="p-3 rounded-lg bg-indigo-50/60 border border-indigo-100 space-y-1">
                <label className="font-bold text-indigo-900 text-xs">Quick Auto-Fill Standard Recommendation *</label>
                <select
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const rec = RECOMMENDED_MEDICINES.find(r => r.name === e.target.value);
                    if (rec) {
                      setMedForm({
                        ...medForm,
                        ...rec,
                        purchasePrice: rec.purchasePrice !== undefined && rec.purchasePrice !== null ? String(rec.purchasePrice) : '',
                        sellingPrice: rec.sellingPrice !== undefined && rec.sellingPrice !== null ? String(rec.sellingPrice) : '',
                      });
                    }
                  }}
                  className="w-full p-2 border border-indigo-200 bg-white rounded font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">-- Click to choose standard medicine recommendation --</option>
                  {RECOMMENDED_MEDICINES.map((r) => (
                    <option key={r.name} value={r.name}>{r.name} ({r.genericName}) — {r.dosageForm} {r.strength}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700">Medicine Name *</label>
                  <input type="text" required value={medForm.name} onChange={(e) => setMedForm({ ...medForm, name: e.target.value })} className="w-full p-2 border rounded mt-1 font-semibold" />
                </div>
                <div>
                  <label className="font-bold text-slate-700">Generic Name *</label>
                  <input type="text" required value={medForm.genericName} onChange={(e) => setMedForm({ ...medForm, genericName: e.target.value })} className="w-full p-2 border rounded mt-1" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="font-bold text-slate-700">Category *</label>
                  <input type="text" required value={medForm.category} onChange={(e) => setMedForm({ ...medForm, category: e.target.value })} className="w-full p-2 border rounded mt-1" />
                </div>
                <div>
                  <label className="font-bold text-slate-700">Form *</label>
                  <select value={medForm.dosageForm} onChange={(e) => setMedForm({ ...medForm, dosageForm: e.target.value })} className="w-full p-2 border rounded mt-1">
                    {['TABLET', 'CAPSULE', 'SYRUP', 'INJECTION', 'CREAM', 'DROPS', 'INHALER', 'IV_FLUID', 'OINTMENT', 'OTHER'].map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-bold text-slate-700">Strength *</label>
                  <input type="text" required value={medForm.strength} onChange={(e) => setMedForm({ ...medForm, strength: e.target.value })} className="w-full p-2 border rounded mt-1" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="font-bold text-slate-700">Purchase Price (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={medForm.purchasePrice ?? ''}
                    onChange={(e) => setMedForm({ ...medForm, purchasePrice: e.target.value })}
                    className="w-full p-2 border rounded mt-1"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700">Selling Price (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={medForm.sellingPrice ?? ''}
                    onChange={(e) => setMedForm({ ...medForm, sellingPrice: e.target.value })}
                    className="w-full p-2 border rounded mt-1 font-semibold"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700">GST Tax %</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={medForm.taxPercentage ?? ''}
                    onChange={(e) => setMedForm({ ...medForm, taxPercentage: e.target.value })}
                    className="w-full p-2 border rounded mt-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700">Minimum Stock Level</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="20"
                    value={medForm.minimumStockLevel ?? ''}
                    onChange={(e) => setMedForm({ ...medForm, minimumStockLevel: e.target.value })}
                    className="w-full p-2 border rounded mt-1"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700">Reorder Quantity</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="100"
                    value={medForm.reorderQuantity ?? ''}
                    onChange={(e) => setMedForm({ ...medForm, reorderQuantity: e.target.value })}
                    className="w-full p-2 border rounded mt-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700">Manufacturer</label>
                  <input
                    type="text"
                    placeholder="e.g. Cipla / Sun Pharma"
                    value={medForm.manufacturer || ''}
                    onChange={(e) => setMedForm({ ...medForm, manufacturer: e.target.value })}
                    className="w-full p-2 border rounded mt-1"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700">Supplier</label>
                  <input
                    type="text"
                    placeholder="e.g. Medico Dist."
                    value={medForm.supplier || ''}
                    onChange={(e) => setMedForm({ ...medForm, supplier: e.target.value })}
                    className="w-full p-2 border rounded mt-1"
                  />
                </div>
              </div>

              {/* Initial Stock & Batch Setup Card */}
              <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-lg space-y-2">
                <div className="flex items-center gap-1.5">
                  <Boxes size={14} className="text-emerald-700" />
                  <p className="font-bold text-emerald-900 text-xs">Initial Stock Setup (Optional)</p>
                </div>
                <p className="text-[11px] text-emerald-700">
                  Enter starting units so this medicine immediately displays as In-Stock.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="font-bold text-slate-700 text-[11px]">Initial Stock (Units)</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="e.g. 100"
                      value={medForm.initialQuantity ?? ''}
                      onChange={(e) => setMedForm({ ...medForm, initialQuantity: e.target.value })}
                      className="w-full p-2 border border-emerald-300 rounded mt-1 font-bold text-emerald-950 bg-white"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 text-[11px]">Batch # (Optional)</label>
                    <input
                      type="text"
                      placeholder="Auto if blank"
                      value={medForm.initialBatchNumber || ''}
                      onChange={(e) => setMedForm({ ...medForm, initialBatchNumber: e.target.value })}
                      className="w-full p-2 border border-emerald-300 rounded mt-1 bg-white"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 text-[11px]">Expiry Date</label>
                    <input
                      type="date"
                      value={medForm.initialExpiryDate || ''}
                      onChange={(e) => setMedForm({ ...medForm, initialExpiryDate: e.target.value })}
                      className="w-full p-2 border border-emerald-300 rounded mt-1 bg-white"
                    />
                  </div>
                  <div>
                    <label className="font-bold text-slate-700 text-[11px]">Storage Rack</label>
                    <input
                      type="text"
                      placeholder="Rack 1"
                      value={medForm.rackLocation || ''}
                      onChange={(e) => setMedForm({ ...medForm, rackLocation: e.target.value })}
                      className="w-full p-2 border border-emerald-300 rounded mt-1 bg-white"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="addPrescriptionRequired"
                  checked={medForm.prescriptionRequired ?? true}
                  onChange={(e) => setMedForm({ ...medForm, prescriptionRequired: e.target.checked })}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="addPrescriptionRequired" className="font-medium text-slate-700">
                  Prescription Required (Doctor prescription mandatory to dispense)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button type="button" variant="ghost" onClick={() => setShowAddMedModal(false)}>Cancel</Button>
                <Button type="submit" variant="primary">Save Medicine SKU</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: VIEW MEDICINE SKU & BATCH BREAKDOWN */}
      {showViewMedModal && viewingMedicine && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto border border-slate-200">
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-extrabold text-slate-900">{viewingMedicine.name}</h3>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-extrabold ${
                    viewingMedicine.stockStatus === 'IN_STOCK' ? 'bg-emerald-100 text-emerald-800' :
                    viewingMedicine.stockStatus === 'LOW_STOCK' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                  }`}>
                    {viewingMedicine.stockStatus}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{viewingMedicine.genericName} {viewingMedicine.brandName ? `· Brand: ${viewingMedicine.brandName}` : ''}</p>
              </div>
              <button
                type="button"
                onClick={() => { setShowViewMedModal(false); setViewingMedicine(null); }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Specifications Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-slate-500 text-[11px] font-medium">Category</p>
                <p className="font-bold text-slate-900 text-sm mt-0.5">{viewingMedicine.category}</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-slate-500 text-[11px] font-medium">Form & Strength</p>
                <p className="font-bold text-slate-900 text-sm mt-0.5">{viewingMedicine.dosageForm} ({viewingMedicine.strength})</p>
              </div>
              <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200">
                <p className="text-indigo-700 text-[11px] font-medium">Available Stock</p>
                <p className="font-extrabold text-indigo-900 text-base mt-0.5">{viewingMedicine.totalQuantity ?? 0} units</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-slate-500 text-[11px] font-medium">Safety Buffer (Min/Reorder)</p>
                <p className="font-bold text-slate-800 text-sm mt-0.5">{viewingMedicine.minimumStockLevel ?? 20} / {viewingMedicine.reorderQuantity ?? 100}</p>
              </div>
            </div>

            {/* Financials & Sourcing */}
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <p className="text-slate-500 text-[11px]">Purchase Price</p>
                <p className="font-bold text-slate-900 text-sm mt-0.5">₹{viewingMedicine.purchasePrice || 0}</p>
              </div>
              <div>
                <p className="text-slate-500 text-[11px]">Selling Price</p>
                <p className="font-bold text-slate-900 text-sm mt-0.5">₹{viewingMedicine.sellingPrice || 0}</p>
              </div>
              <div>
                <p className="text-slate-500 text-[11px]">Profit Margin</p>
                <p className="font-bold text-emerald-700 text-sm mt-0.5">
                  ₹{((viewingMedicine.sellingPrice || 0) - (viewingMedicine.purchasePrice || 0)).toFixed(2)}
                  {viewingMedicine.sellingPrice > 0 && (
                    <span className="text-[11px] text-emerald-600 font-normal ml-1">
                      ({(((viewingMedicine.sellingPrice - viewingMedicine.purchasePrice) / viewingMedicine.sellingPrice) * 100).toFixed(1)}%)
                    </span>
                  )}
                </p>
              </div>
              <div>
                <p className="text-slate-500 text-[11px]">GST Tax Rate</p>
                <p className="font-bold text-slate-900 text-sm mt-0.5">{viewingMedicine.taxPercentage || 0}%</p>
              </div>
              <div>
                <p className="text-slate-500 text-[11px]">Manufacturer</p>
                <p className="font-semibold text-slate-800 mt-0.5">{viewingMedicine.manufacturer || 'Not Specified'}</p>
              </div>
              <div>
                <p className="text-slate-500 text-[11px]">Supplier</p>
                <p className="font-semibold text-slate-800 mt-0.5">{viewingMedicine.supplier || 'Not Specified'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-slate-500 text-[11px]">Prescription Required</p>
                <p className="font-semibold text-slate-800 mt-0.5">
                  {viewingMedicine.prescriptionRequired ? 'Yes (Doctor Prescription Required)' : 'No (Over The Counter / OTC)'}
                </p>
              </div>
            </div>

            {/* Batches Table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                  <Boxes size={14} className="text-indigo-600" />
                  Stock Batches & Locations ({viewingMedicine.batches?.length || 0})
                </h4>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const m = viewingMedicine;
                    setShowViewMedModal(false);
                    handleOpenAddBatch(m);
                  }}
                >
                  <Plus size={13} className="mr-1" /> Add Stock Batch
                </Button>
              </div>

              {viewingMedicine.batches && viewingMedicine.batches.length > 0 ? (
                <div className="overflow-x-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[10px]">
                      <tr>
                        <th className="p-2.5">Batch #</th>
                        <th className="p-2.5">Location</th>
                        <th className="p-2.5">Expiry Date</th>
                        <th className="p-2.5">Quantity</th>
                        <th className="p-2.5">Batch Price</th>
                        <th className="p-2.5 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {viewingMedicine.batches.map((b) => {
                        const exp = new Date(b.expiryDate);
                        const now = new Date();
                        const isExpired = exp < now;
                        const daysLeft = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
                        const isNearExpiry = !isExpired && daysLeft <= 30;

                        return (
                          <tr key={b._id} className="hover:bg-slate-50">
                            <td className="p-2.5 font-mono font-bold text-slate-900">{b.batchNumber}</td>
                            <td className="p-2.5 text-slate-700">{b.location} {b.storageLocation ? `(${b.storageLocation})` : ''}</td>
                            <td className="p-2.5">
                              <div className="font-semibold text-slate-800">{new Date(b.expiryDate).toLocaleDateString()}</div>
                              <span className={`text-[10px] font-bold ${isExpired ? 'text-rose-600' : isNearExpiry ? 'text-amber-600' : 'text-emerald-600'}`}>
                                {isExpired ? 'Expired' : isNearExpiry ? `Expires in ${daysLeft} days` : `Valid (${daysLeft} days)`}
                              </span>
                            </td>
                            <td className="p-2.5 font-bold text-indigo-700">{b.quantity} units</td>
                            <td className="p-2.5 text-slate-600">₹{b.sellingPrice}</td>
                            <td className="p-2.5 text-right">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                b.quantity === 0 ? 'bg-slate-100 text-slate-600' :
                                isExpired ? 'bg-rose-100 text-rose-700' :
                                isNearExpiry ? 'bg-amber-100 text-amber-800' :
                                'bg-emerald-100 text-emerald-800'
                              }`}>
                                {b.quantity === 0 ? 'DEPLETED' : isExpired ? 'EXPIRED' : isNearExpiry ? 'NEAR EXPIRY' : 'ACTIVE'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-6 text-center bg-slate-50 rounded-lg border border-dashed border-slate-300 space-y-2">
                  <Boxes size={28} className="mx-auto text-slate-400" />
                  <p className="text-xs font-semibold text-slate-700">No stock batches added yet for this SKU</p>
                  <p className="text-[11px] text-slate-400">Available stock is currently 0 units. Click below to add your first stock batch.</p>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      const m = viewingMedicine;
                      setShowViewMedModal(false);
                      handleOpenAddBatch(m);
                    }}
                  >
                    <Plus size={14} className="mr-1" /> Add First Stock Batch
                  </Button>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="flex items-center justify-between pt-3 border-t">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  const m = viewingMedicine;
                  setShowViewMedModal(false);
                  handleOpenEdit(m);
                }}
              >
                <Edit size={14} className="mr-1.5" /> Edit SKU Details
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => { setShowViewMedModal(false); setViewingMedicine(null); }}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDIT MEDICINE SKU */}
      {showEditMedModal && editMedForm && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto border border-slate-200">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">Edit Medicine SKU</h3>
                <p className="text-[11px] text-slate-500">{editMedForm.name} ({editMedForm.genericName})</p>
              </div>
              <button
                type="button"
                onClick={() => { setShowEditMedModal(false); setEditMedForm(null); }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleUpdateMedicine} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700">Medicine Name *</label>
                  <input
                    type="text"
                    required
                    value={editMedForm.name}
                    onChange={(e) => setEditMedForm({ ...editMedForm, name: e.target.value })}
                    className="w-full p-2 border rounded mt-1 font-semibold"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700">Generic Name *</label>
                  <input
                    type="text"
                    required
                    value={editMedForm.genericName}
                    onChange={(e) => setEditMedForm({ ...editMedForm, genericName: e.target.value })}
                    className="w-full p-2 border rounded mt-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="font-bold text-slate-700">Category *</label>
                  <input
                    type="text"
                    required
                    value={editMedForm.category}
                    onChange={(e) => setEditMedForm({ ...editMedForm, category: e.target.value })}
                    className="w-full p-2 border rounded mt-1"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700">Form *</label>
                  <select
                    value={editMedForm.dosageForm}
                    onChange={(e) => setEditMedForm({ ...editMedForm, dosageForm: e.target.value })}
                    className="w-full p-2 border rounded mt-1"
                  >
                    {['TABLET', 'CAPSULE', 'SYRUP', 'INJECTION', 'CREAM', 'DROPS', 'INHALER', 'IV_FLUID', 'OINTMENT', 'OTHER'].map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-bold text-slate-700">Strength *</label>
                  <input
                    type="text"
                    required
                    value={editMedForm.strength}
                    onChange={(e) => setEditMedForm({ ...editMedForm, strength: e.target.value })}
                    className="w-full p-2 border rounded mt-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="font-bold text-slate-700">Purchase Price (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={editMedForm.purchasePrice ?? ''}
                    onChange={(e) => setEditMedForm({ ...editMedForm, purchasePrice: e.target.value })}
                    className="w-full p-2 border rounded mt-1"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700">Selling Price (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={editMedForm.sellingPrice ?? ''}
                    onChange={(e) => setEditMedForm({ ...editMedForm, sellingPrice: e.target.value })}
                    className="w-full p-2 border rounded mt-1 font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700">GST Tax %</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={editMedForm.taxPercentage ?? ''}
                    onChange={(e) => setEditMedForm({ ...editMedForm, taxPercentage: e.target.value })}
                    className="w-full p-2 border rounded mt-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700">Minimum Stock Level</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="20"
                    value={editMedForm.minimumStockLevel ?? ''}
                    onChange={(e) => setEditMedForm({ ...editMedForm, minimumStockLevel: e.target.value })}
                    className="w-full p-2 border rounded mt-1"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700">Reorder Quantity</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="100"
                    value={editMedForm.reorderQuantity ?? ''}
                    onChange={(e) => setEditMedForm({ ...editMedForm, reorderQuantity: e.target.value })}
                    className="w-full p-2 border rounded mt-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700">Brand Name</label>
                  <input
                    type="text"
                    value={editMedForm.brandName || ''}
                    onChange={(e) => setEditMedForm({ ...editMedForm, brandName: e.target.value })}
                    className="w-full p-2 border rounded mt-1"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700">Manufacturer</label>
                  <input
                    type="text"
                    value={editMedForm.manufacturer || ''}
                    onChange={(e) => setEditMedForm({ ...editMedForm, manufacturer: e.target.value })}
                    className="w-full p-2 border rounded mt-1"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="editPrescriptionRequired"
                  checked={editMedForm.prescriptionRequired ?? true}
                  onChange={(e) => setEditMedForm({ ...editMedForm, prescriptionRequired: e.target.checked })}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="editPrescriptionRequired" className="font-medium text-slate-700">
                  Prescription Required (Doctor prescription mandatory to dispense)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button type="button" variant="ghost" onClick={() => { setShowEditMedModal(false); setEditMedForm(null); }}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  Save Changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD STOCK BATCH */}
      {showAddBatchModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto border border-slate-200">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">Add New Batch Stock</h3>
                <p className="text-[11px] text-slate-500">Replenish stock inventory with batch tracking and expiry dates</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddBatchModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddBatch} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700">Select Medicine SKU *</label>
                <select
                  required
                  value={batchForm.medicineId}
                  onChange={(e) => {
                    const selectedId = e.target.value;
                    const m = medicines.find((med) => med._id === selectedId);
                    setBatchForm({
                      ...batchForm,
                      medicineId: selectedId,
                      purchasePrice: m?.purchasePrice !== undefined ? String(m.purchasePrice) : batchForm.purchasePrice,
                      sellingPrice: m?.sellingPrice !== undefined ? String(m.sellingPrice) : batchForm.sellingPrice,
                    });
                  }}
                  className="w-full p-2.5 border rounded mt-1 font-bold text-slate-900 bg-slate-50"
                >
                  <option value="">-- Choose Medicine --</option>
                  {medicines.map((m) => (
                    <option key={m._id} value={m._id}>{m.name} ({m.genericName}) — Stock: {m.totalQuantity ?? 0} units</option>
                  ))}
                  {medicines.length === 0 && RECOMMENDED_MEDICINES.map((r, i) => (
                    <option key={i} value={`rec_${i}`}>{r.name} ({r.genericName}) — Recommended Standard</option>
                  ))}
                </select>
              </div>

              {/* Selected SKU Banner */}
              {batchForm.medicineId && (() => {
                const m = medicines.find(med => med._id === batchForm.medicineId);
                if (!m) return null;
                return (
                  <div className="p-2.5 bg-indigo-50 border border-indigo-100 rounded-lg text-indigo-950 text-xs flex justify-between items-center">
                    <div>
                      <p className="font-bold">{m.name} ({m.genericName})</p>
                      <p className="text-[11px] text-indigo-700">Current Stock: <span className="font-bold">{m.totalQuantity || 0} units</span> · Min: {m.minimumStockLevel} units</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-slate-700">Sell Price: ₹{m.sellingPrice}</p>
                      <p className="text-[11px] text-slate-500">Buy: ₹{m.purchasePrice}</p>
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700">Batch Number *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. BATCH-2026-99"
                    value={batchForm.batchNumber}
                    onChange={(e) => setBatchForm({ ...batchForm, batchNumber: e.target.value })}
                    className="w-full p-2 border rounded mt-1 font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700">Storage Location</label>
                  <select value={batchForm.location} onChange={(e) => setBatchForm({ ...batchForm, location: e.target.value })} className="w-full p-2 border rounded mt-1">
                    {['MAIN_PHARMACY', 'EMERGENCY_PHARMACY', 'ICU_STOCK', 'WARD_STOCK', 'OT_STOCK'].map((loc) => (
                      <option key={loc} value={loc}>{loc}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700">Expiry Date *</label>
                  <input
                    type="date"
                    required
                    value={batchForm.expiryDate}
                    onChange={(e) => setBatchForm({ ...batchForm, expiryDate: e.target.value })}
                    className="w-full p-2 border rounded mt-1"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700">Quantity (Units) *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    placeholder="100"
                    value={batchForm.quantity ?? ''}
                    onChange={(e) => setBatchForm({ ...batchForm, quantity: e.target.value })}
                    className="w-full p-2 border rounded mt-1 font-bold text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-slate-700">Batch Purchase Price (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="From SKU if empty"
                    value={batchForm.purchasePrice ?? ''}
                    onChange={(e) => setBatchForm({ ...batchForm, purchasePrice: e.target.value })}
                    className="w-full p-2 border rounded mt-1"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700">Batch Selling Price (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="From SKU if empty"
                    value={batchForm.sellingPrice ?? ''}
                    onChange={(e) => setBatchForm({ ...batchForm, sellingPrice: e.target.value })}
                    className="w-full p-2 border rounded mt-1 font-semibold text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700">Audit Log Reason</label>
                <input
                  type="text"
                  value={batchForm.reason}
                  onChange={(e) => setBatchForm({ ...batchForm, reason: e.target.value })}
                  className="w-full p-2 border rounded mt-1"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button type="button" variant="ghost" onClick={() => setShowAddBatchModal(false)}>Cancel</Button>
                <Button type="submit" variant="primary">Add Batch Stock</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: SUBSTITUTION REQUEST */}
      {showSubReqModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 border border-slate-200">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-base font-extrabold text-slate-900">Request Medicine Substitution</h3>
              <button
                type="button"
                onClick={() => setShowSubReqModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Info box: Where does this go? */}
            <div className="flex items-start gap-2.5 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <Info size={15} className="text-blue-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-blue-800">
                <strong>Where does this go?</strong> — The assigned Doctor will receive an instant notification in their{' '}
                <strong>"Department Responses"</strong> tab. They will review and approve or reject the substitution.
                You'll be notified once they respond via the notification bell.
              </p>
            </div>

            <form onSubmit={handleRequestSubstitution} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700">Original Prescribed Medicine</label>
                <input type="text" disabled value={subForm.originalMedicineName} className="w-full p-2 border bg-slate-100 rounded mt-1" />
              </div>
              <div>
                <label className="font-bold text-slate-700">Suggested Available Alternative (Optional)</label>
                <select value={subForm.suggestedMedicineId} onChange={(e) => setSubForm({ ...subForm, suggestedMedicineId: e.target.value })} className="w-full p-2 border rounded mt-1">
                  <option value="">-- Optional: Select from your inventory (or leave blank) --</option>
                  {medicines.map((m) => (
                    <option key={m._id} value={m._id}>{m.name} ({m.genericName}) — ₹{m.sellingPrice}</option>
                  ))}
                </select>
                {medicines.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">No medicines in inventory yet. Add medicines first before requesting substitution.</p>
                )}
              </div>
              <div>
                <label className="font-bold text-slate-700">Reason for Substitution *</label>
                <textarea required rows="2" value={subForm.reason} onChange={(e) => setSubForm({ ...subForm, reason: e.target.value })} className="w-full p-2 border rounded mt-1" />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button type="button" variant="ghost" onClick={() => setShowSubReqModal(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={!subForm.reason.trim()}>Send to Doctor</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pharmacy Billing & Dispensing Pricing Calculator Modal */}
      <PharmacyBillingModal
        isOpen={isBillingModalOpen}
        onClose={() => {
          setIsBillingModalOpen(false);
          setBillingPrescription(null);
        }}
        prescription={billingPrescription}
        onDispense={handleModalDispense}
        onExternalPurchase={handleModalExternalPurchase}
        onRequestSubstitution={(rx, medName) => {
          setSubForm({
            prescriptionId: rx._id,
            originalMedicineName: medName || rx.medicines?.[0]?.medicineName || '',
            suggestedMedicineId: medicines[0]?._id || '',
            reason: `Prescribed medicine "${medName || rx.medicines?.[0]?.medicineName || 'Medicine'}" is out of stock in hospital pharmacy. Requesting approval to substitute with equivalent medicine from a different manufacturer/company.`
          });
          setShowSubReqModal(true);
        }}
        isSubmitting={isBillingSubmitting}
      />
    </div>
  );
};

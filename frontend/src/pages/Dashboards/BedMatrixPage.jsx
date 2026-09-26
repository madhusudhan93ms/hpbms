import React, { useState, useEffect, useMemo } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { axiosClient } from '../../api/axiosClient';
import { useSocket } from '../../providers/SocketProvider';
import { formatCurrency } from '../../utils/formatters';

// Modals
import { CreateBlockModal } from '../../components/modals/CreateBlockModal';
import { CreateFloorModal } from '../../components/modals/CreateFloorModal';
import { CreateWardModal } from '../../components/modals/CreateWardModal';
import { CreateRoomModal } from '../../components/modals/CreateRoomModal';
import { CreateBedModal } from '../../components/modals/CreateBedModal';
import { BulkBedGeneratorModal } from '../../components/modals/BulkBedGeneratorModal';
import { TransferPatientModal } from '../../components/modals/TransferPatientModal';
import { ReserveBedModal } from '../../components/modals/ReserveBedModal';
import { ReportMaintenanceModal } from '../../components/modals/ReportMaintenanceModal';
import { MarkCleaningCompleteModal } from '../../components/modals/MarkCleaningCompleteModal';
import { EmergencyBedFinderModal } from '../../components/modals/EmergencyBedFinderModal';
import { BedHistoryModal } from '../../components/modals/BedHistoryModal';

import {
  BedDouble,
  Building2,
  Layers,
  GitFork,
  DoorOpen,
  Sparkles,
  RefreshCw,
  Search,
  Filter,
  Plus,
  LayoutGrid,
  CreditCard,
  History,
  Wrench,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRightLeft,
  PieChart,
  ChevronRight,
  ShieldCheck,
  Zap,
  MoreVertical,
  Edit,
  Trash2,
  BookmarkCheck,
  Activity,
  User,
  Users,
  Eye,
} from 'lucide-react';

import { useAuthStore } from '../../store/authStore';
import { getEffectiveUserRoles } from '../../components/auth/TenantRouteGuard';

export const BedMatrixPage = () => {
  const { user } = useAuthStore();
  const effectiveRoles = getEffectiveUserRoles(user);
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'HOSPITAL_ADMIN';
  const isNurse = user?.role === 'NURSE' || user?.role === 'NURSE_INCHARGE' || effectiveRoles.includes('NURSE') || effectiveRoles.includes('NURSE_INCHARGE') || effectiveRoles.includes('IPD_STAFF');
  const isDoctor = user?.role === 'DOCTOR' || effectiveRoles.includes('DOCTOR');
  const { socket } = useSocket();

  // Active Main Tab
  const [activeTab, setActiveTab] = useState('MATRIX'); // 'MATRIX' | 'SETUP' | 'CLEANING' | 'MAINTENANCE' | 'TRANSFERS' | 'ANALYTICS'
  
  // Hierarchy Sub-Tab in SETUP
  const [setupSubTab, setSetupSubTab] = useState('BLOCKS'); // 'BLOCKS' | 'FLOORS' | 'WARDS' | 'ROOMS' | 'BEDS'
  
  // View Mode in Matrix Tab
  const [viewMode, setViewMode] = useState('GRID'); // 'GRID' | 'CARDS' | 'LIST'

  // Data States
  const [beds, setBeds] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [summary, setSummary] = useState({
    total: 0,
    available: 0,
    occupied: 0,
    reserved: 0,
    cleaning: 0,
    maintenance: 0,
    blocked: 0,
    isolation: 0,
    icu: 0,
    occupancyRate: 0,
  });
  const [hierarchy, setHierarchy] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [occupancyReports, setOccupancyReports] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [floors, setFloors] = useState([]);
  const [wards, setWards] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Filter States
  const [filterBlock, setFilterBlock] = useState('ALL');
  const [filterFloor, setFilterFloor] = useState('ALL');
  const [filterWard, setFilterWard] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterWardType, setFilterWardType] = useState('ALL');
  const [filterBedType, setFilterBedType] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Modal States
  const [isBlockModalOpen, setIsBlockModalOpen] = useState(false);
  const [selectedBlockToEdit, setSelectedBlockToEdit] = useState(null);

  const [isFloorModalOpen, setIsFloorModalOpen] = useState(false);
  const [selectedFloorToEdit, setSelectedFloorToEdit] = useState(null);

  const [isWardModalOpen, setIsWardModalOpen] = useState(false);
  const [selectedWardToEdit, setSelectedWardToEdit] = useState(null);

  const [isRoomModalOpen, setIsRoomModalOpen] = useState(false);
  const [selectedRoomToEdit, setSelectedRoomToEdit] = useState(null);

  const [isBedModalOpen, setIsBedModalOpen] = useState(false);
  const [selectedBedToEdit, setSelectedBedToEdit] = useState(null);

  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [isEmergencyFinderOpen, setIsEmergencyFinderOpen] = useState(false);

  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [selectedAdmissionForTransfer, setSelectedAdmissionForTransfer] = useState(null);

  const [isReserveModalOpen, setIsReserveModalOpen] = useState(false);
  const [selectedBedForReserve, setSelectedBedForReserve] = useState(null);

  const [isMaintenanceModalOpen, setIsMaintenanceModalOpen] = useState(false);
  const [selectedBedForMaintenance, setSelectedBedForMaintenance] = useState(null);

  const [isCleaningModalOpen, setIsCleaningModalOpen] = useState(false);
  const [selectedBedForCleaning, setSelectedBedForCleaning] = useState(null);

  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [selectedBedForHistory, setSelectedBedForHistory] = useState(null);

  useEffect(() => {
    fetchAllData();
  }, []);

  // Real-time socket updates
  useEffect(() => {
    if (!socket) return;
    let debounceTimer = null;
    const handleUpdate = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        fetchAllData();
      }, 250);
    };

    socket.on('bed:status_changed', handleUpdate);
    socket.on('bed:transfer_completed', handleUpdate);
    socket.on('admission:confirmed', handleUpdate);
    socket.on('workflow:pending_changed', handleUpdate);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      socket.off('bed:status_changed', handleUpdate);
      socket.off('bed:transfer_completed', handleUpdate);
      socket.off('admission:confirmed', handleUpdate);
      socket.off('workflow:pending_changed', handleUpdate);
    };
  }, [socket]);

  const fetchAllData = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const [bedRes, sumRes, hierRes, blockRes, floorRes, wardRes, roomRes, transRes, repRes] = await Promise.all([
        axiosClient.get('/beds'),
        axiosClient.get('/beds/dashboard-summary'),
        axiosClient.get('/beds/hierarchy'),
        axiosClient.get('/beds/blocks'),
        axiosClient.get('/beds/floors'),
        axiosClient.get('/beds/wards'),
        axiosClient.get('/beds/rooms'),
        axiosClient.get('/beds/transfers/history'),
        axiosClient.get('/beds/occupancy-reports'),
      ]);

      const bedList = Array.isArray(bedRes) ? bedRes : (bedRes.data || []);
      setBeds(bedList);
      setSummary(sumRes.data || sumRes || {});
      setHierarchy(hierRes.data || hierRes || null);
      setBlocks(Array.isArray(blockRes) ? blockRes : (blockRes.data || []));
      setFloors(Array.isArray(floorRes) ? floorRes : (floorRes.data || []));
      setWards(Array.isArray(wardRes) ? wardRes : (wardRes.data || []));
      setRooms(Array.isArray(roomRes) ? roomRes : (roomRes.data || []));
      setTransfers(Array.isArray(transRes) ? transRes : (transRes.data || []));
      setOccupancyReports(repRes.data || repRes || null);
    } catch (err) {
      console.error('Failed to load Bed Matrix data:', err);
      setLoadError(err.error?.message || err.message || 'Bed Matrix data could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  };

  // Status Action Handlers
  const handleReleaseReservation = async (bed) => {
    if (!window.confirm(`Release temporary reservation on Bed ${bed.bedNumber}?`)) return;
    try {
      await axiosClient.post(`/beds/${bed._id}/release-reservation`);
      fetchAllData();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to release reservation');
    }
  };

  const handleRepairCompleted = async (bed) => {
    if (!window.confirm(`Certify that maintenance & repair for Bed ${bed.bedNumber} is completed? Bed will be released to AVAILABLE status.`)) return;
    try {
      await axiosClient.post(`/beds/${bed._id}/repair-completed`);
      fetchAllData();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to complete repair');
    }
  };

  const handleDeleteHierarchyItem = async (type, id, name) => {
    if (!window.confirm(`Are you sure you want to delete ${type} "${name}"?`)) return;
    try {
      if (type === 'Block') await axiosClient.delete(`/beds/blocks/${id}`);
      else if (type === 'Floor') await axiosClient.delete(`/beds/floors/${id}`);
      else if (type === 'Ward') await axiosClient.delete(`/beds/wards/${id}`);
      else if (type === 'Room') await axiosClient.delete(`/beds/rooms/${id}`);
      else if (type === 'Bed') await axiosClient.delete(`/beds/${id}`);
      fetchAllData();
    } catch (err) {
      alert(err.response?.data?.message || err.error?.message || `Failed to delete ${type}`);
    }
  };

  // Filtering Logic
  const filteredBeds = useMemo(() => {
    const s = searchTerm.trim().toLowerCase();
    return beds.filter((b) => {
      if (filterBlock !== 'ALL' && String(b.blockId?._id || b.blockId) !== String(filterBlock)) return false;
      if (filterFloor !== 'ALL' && String(b.floorId?._id || b.floorId) !== String(filterFloor)) return false;
      if (filterWard !== 'ALL' && String(b.wardId?._id || b.wardId) !== String(filterWard)) return false;
      if (filterStatus !== 'ALL' && b.status !== filterStatus) return false;
      if (filterWardType !== 'ALL' && b.wardType !== filterWardType) return false;
      if (filterBedType !== 'ALL' && b.bedType !== filterBedType) return false;

      if (s) {
        const bedNo = (b.bedNumber || '').toLowerCase();
        const roomNo = (b.roomNumber || '').toLowerCase();
        const wardN = (b.wardName || '').toLowerCase();
        const pat = b.currentPatientId;
        const patName = pat ? `${pat.firstName || ''} ${pat.lastName || ''}`.toLowerCase() : '';
        const patUhid = pat ? (pat.uhid || '').toLowerCase() : '';
        return bedNo.includes(s) || roomNo.includes(s) || wardN.includes(s) || patName.includes(s) || patUhid.includes(s);
      }
      return true;
    });
  }, [beds, filterBlock, filterFloor, filterWard, filterStatus, filterWardType, filterBedType, searchTerm]);

  // Group filtered beds by Ward / Section for Grid View
  const groupedWards = useMemo(() => {
    const map = {};
    filteredBeds.forEach((b) => {
      const wardKey = b.wardName || b.wardId?.name || 'General Ward';
      if (!map[wardKey]) {
        map[wardKey] = {
          wardName: wardKey,
          wardType: b.wardType || 'GENERAL',
          blockName: b.blockName || b.blockId?.name || '',
          floorName: b.floorName || b.floorId?.name || '',
          beds: [],
        };
      }
      map[wardKey].beds.push(b);
    });
    return map;
  }, [filteredBeds]);

  const getStatusBadge = (status) => {
    switch (status) {
      case 'AVAILABLE':
        return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Available</span>;
      case 'OCCUPIED':
        return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-50 text-rose-700 border border-rose-200"><span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> Occupied</span>;
      case 'CLEANING':
      case 'CLEANING_SANITIZING':
        return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-50 text-amber-800 border border-amber-200 animate-pulse"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Cleaning</span>;
      case 'RESERVED':
        return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-50 text-blue-700 border border-blue-200"><span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Reserved</span>;
      case 'MAINTENANCE':
        return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-100 text-slate-700 border border-slate-300"><span className="w-1.5 h-1.5 rounded-full bg-slate-500" /> Maintenance</span>;
      case 'ISOLATION':
        return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-purple-50 text-purple-700 border border-purple-200"><span className="w-1.5 h-1.5 rounded-full bg-purple-500" /> Isolation</span>;
      case 'BLOCKED':
        return <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-100 text-slate-500 border border-slate-200"><span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> Blocked</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">{status}</span>;
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {loadError && (
        <div role="alert" className="p-3 rounded-xl border border-rose-300 bg-rose-50 text-rose-800 text-sm font-semibold flex items-center justify-between gap-3">
          <span>{loadError}</span>
          <Button size="sm" variant="outline" onClick={fetchAllData}>Retry</Button>
        </div>
      )}
      {/* 1. Header & Quick Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-3.5">
          <div className="p-3 rounded-2xl bg-indigo-600 text-white shadow-md shadow-indigo-600/20 shrink-0">
            <BedDouble size={26} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
                Ward, Room &amp; Bed Matrix Management
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live Telemetry
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Multi-tier physical infrastructure, real-time occupancy, automated sanitation, and patient transfer orchestration
            </p>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEmergencyFinderOpen(true)}
            className="font-bold text-xs bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"
          >
            <Zap size={14} className="text-rose-600" /> Rapid Emergency Finder
          </Button>

          {isAdmin && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsBulkModalOpen(true)}
                className="font-bold text-xs bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100"
              >
                <Sparkles size={14} className="text-violet-600" /> Bulk Generator Wizard
              </Button>

              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setSelectedBedToEdit(null);
                  setIsBedModalOpen(true);
                }}
                className="font-bold text-xs bg-indigo-600 hover:bg-indigo-700"
              >
                <Plus size={14} /> Add Bed
              </Button>
            </>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={fetchAllData}
            isLoading={isLoading}
            className="text-xs"
            title="Refresh Live State"
          >
            <RefreshCw size={14} />
          </Button>
        </div>
      </div>

      {/* 2. Top Summary KPI Dashboard */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-bold uppercase tracking-wider">Total Beds</span>
            <BedDouble size={16} className="text-slate-400" />
          </div>
          <div className="text-2xl font-black text-slate-900 tracking-tight">{summary.total || 0}</div>
          <div className="text-[10px] text-slate-400 font-semibold">Active configured capacity</div>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-emerald-200 shadow-2xs space-y-1 bg-gradient-to-br from-white to-emerald-50/30">
          <div className="flex items-center justify-between text-emerald-700">
            <span className="text-[11px] font-bold uppercase tracking-wider">Available</span>
            <CheckCircle2 size={16} className="text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-700 tracking-tight">{summary.available || 0}</div>
          <div className="text-[10px] text-emerald-600 font-bold">Ready for instant IPD admission</div>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-rose-200 shadow-2xs space-y-1 bg-gradient-to-br from-white to-rose-50/30">
          <div className="flex items-center justify-between text-rose-700">
            <span className="text-[11px] font-bold uppercase tracking-wider">Occupied</span>
            <User size={16} className="text-rose-500" />
          </div>
          <div className="text-2xl font-black text-rose-700 tracking-tight">{summary.occupied || 0}</div>
          <div className="text-[10px] text-rose-600 font-bold">Currently admitted inpatients</div>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-amber-200 shadow-2xs space-y-1 bg-gradient-to-br from-white to-amber-50/30">
          <div className="flex items-center justify-between text-amber-800">
            <span className="text-[11px] font-bold uppercase tracking-wider">Cleaning</span>
            <Sparkles size={16} className="text-amber-600" />
          </div>
          <div className="text-2xl font-black text-amber-800 tracking-tight">{summary.cleaning || 0}</div>
          <div className="text-[10px] text-amber-700 font-semibold">Housekeeping in-progress</div>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-slate-600">
            <span className="text-[11px] font-bold uppercase tracking-wider">ICU / Critical</span>
            <Activity size={16} className="text-red-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 tracking-tight">{summary.icu || 0}</div>
          <div className="text-[10px] text-slate-400 font-semibold">Critical care beds</div>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-indigo-200 shadow-2xs space-y-1 bg-gradient-to-br from-white to-indigo-50/30">
          <div className="flex items-center justify-between text-indigo-700">
            <span className="text-[11px] font-bold uppercase tracking-wider">Occupancy Rate</span>
            <PieChart size={16} className="text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-indigo-900 tracking-tight">{summary.occupancyRate || '0.0'}%</div>
          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mt-1">
            <div
              className="bg-indigo-600 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, summary.occupancyRate || 0)}%` }}
            />
          </div>
        </div>
      </div>

      {/* 3. Main Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto pb-px">
        {[
          { id: 'MATRIX', label: 'Live Bed Matrix & Visual Grid', icon: LayoutGrid, visible: true },
          { id: 'SETUP', label: 'Physical Hierarchy Setup', icon: Building2, visible: isAdmin },
          { id: 'CLEANING', label: `Housekeeping & Cleaning (${summary.cleaning || 0})`, icon: Sparkles, visible: isAdmin || isNurse },
          { id: 'MAINTENANCE', label: `Maintenance Desk (${summary.maintenance || 0})`, icon: Wrench, visible: isAdmin || isNurse },
          { id: 'TRANSFERS', label: 'Transfers & Audit Log', icon: ArrowRightLeft, visible: true },
          { id: 'ANALYTICS', label: 'Occupancy & Turnover Reports', icon: PieChart, visible: true },
        ].filter((tab) => tab.visible).map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-extrabold border-b-2 transition-all whitespace-nowrap ${
                isActive
                  ? 'border-indigo-600 text-indigo-600 bg-indigo-50/40'
                  : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <Icon size={15} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: LIVE BED MATRIX & VISUAL GRID */}
      {/* ========================================================================= */}
      {activeTab === 'MATRIX' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              {/* Search Bar */}
              <div className="relative flex-1 max-w-md">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Search by Bed #, Room #, Patient Name, UHID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 text-xs font-semibold"
                />
              </div>

              {/* View Switcher */}
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 self-start">
                <button
                  onClick={() => setViewMode('GRID')}
                  className={`px-3 py-1 rounded-lg text-xs font-extrabold transition-all ${
                    viewMode === 'GRID' ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Matrix Grid
                </button>
                <button
                  onClick={() => setViewMode('CARDS')}
                  className={`px-3 py-1 rounded-lg text-xs font-extrabold transition-all ${
                    viewMode === 'CARDS' ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Cards
                </button>
                <button
                  onClick={() => setViewMode('LIST')}
                  className={`px-3 py-1 rounded-lg text-xs font-extrabold transition-all ${
                    viewMode === 'LIST' ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  List
                </button>
              </div>
            </div>

            {/* Dropdown Filters */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-2 border-t border-slate-100 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Building / Block</label>
                <select
                  value={filterBlock}
                  onChange={(e) => setFilterBlock(e.target.value)}
                  className="w-full glass-input rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-800 border border-slate-200 bg-white"
                >
                  <option value="ALL">All Buildings</option>
                  {blocks.map((b) => (
                    <option key={b._id} value={b._id}>{b.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Floor</label>
                <select
                  value={filterFloor}
                  onChange={(e) => setFilterFloor(e.target.value)}
                  className="w-full glass-input rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-800 border border-slate-200 bg-white"
                >
                  <option value="ALL">All Floors</option>
                  {floors.map((f) => (
                    <option key={f._id} value={f._id}>{f.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Ward / Section</label>
                <select
                  value={filterWard}
                  onChange={(e) => setFilterWard(e.target.value)}
                  className="w-full glass-input rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-800 border border-slate-200 bg-white"
                >
                  <option value="ALL">All Wards</option>
                  {wards.map((w) => (
                    <option key={w._id} value={w._id}>{w.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Bed Status</label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="w-full glass-input rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-800 border border-slate-200 bg-white"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="AVAILABLE">Available</option>
                  <option value="OCCUPIED">Occupied</option>
                  <option value="RESERVED">Reserved</option>
                  <option value="CLEANING">Cleaning</option>
                  <option value="MAINTENANCE">Maintenance</option>
                  <option value="ISOLATION">Isolation</option>
                  <option value="BLOCKED">Blocked</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Ward Type</label>
                <select
                  value={filterWardType}
                  onChange={(e) => setFilterWardType(e.target.value)}
                  className="w-full glass-input rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-800 border border-slate-200 bg-white"
                >
                  <option value="ALL">All Types</option>
                  <option value="GENERAL">General Ward</option>
                  <option value="ICU">ICU</option>
                  <option value="NICU">NICU</option>
                  <option value="EMERGENCY">Emergency</option>
                  <option value="MATERNITY">Maternity</option>
                  <option value="PRIVATE">Private</option>
                  <option value="SEMI_PRIVATE">Semi-Private</option>
                </select>
              </div>

              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFilterBlock('ALL');
                    setFilterFloor('ALL');
                    setFilterWard('ALL');
                    setFilterStatus('ALL');
                    setFilterWardType('ALL');
                    setFilterBedType('ALL');
                    setSearchTerm('');
                  }}
                  className="w-full text-xs font-bold text-slate-600"
                >
                  Reset Filters
                </Button>
              </div>
            </div>
          </div>

          {/* Render Active View Mode */}
          {filteredBeds.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 space-y-3 shadow-2xs">
              <BedDouble size={36} className="mx-auto text-slate-300" />
              <div className="text-base font-extrabold text-slate-800">No Beds Match Selected Filters</div>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Try resetting your filters, or use the Bulk Generator wizard to add new beds.
              </p>
            </div>
          ) : viewMode === 'GRID' ? (
            /* --- MATRIX / GRID VIEW (Grouped by Ward) --- */
            <div className="space-y-6">
              {Object.values(groupedWards).map((wardGroup) => (
                <div key={wardGroup.wardName} className="p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-4">
                  {/* Ward Section Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-extrabold text-slate-900">{wardGroup.wardName}</h3>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {wardGroup.wardType}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {wardGroup.blockName ? `${wardGroup.blockName} • ` : ''}
                        {wardGroup.floorName ? `${wardGroup.floorName} • ` : ''}
                        {wardGroup.beds.length} Configured Beds
                      </p>
                    </div>

                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                      <span className="inline-flex items-center text-emerald-700"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1" /> {wardGroup.beds.filter((b) => b.status === 'AVAILABLE').length} Avail</span>
                      <span className="inline-flex items-center text-rose-700"><span className="w-1.5 h-1.5 rounded-full bg-rose-500 mr-1" /> {wardGroup.beds.filter((b) => b.status === 'OCCUPIED').length} Occ</span>
                      {wardGroup.beds.filter((b) => b.status === 'CLEANING').length > 0 && (
                        <span className="inline-flex items-center text-amber-700"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1" /> {wardGroup.beds.filter((b) => b.status === 'CLEANING').length} Clean</span>
                      )}
                    </div>
                  </div>

                  {/* Bed Grid Cells */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {wardGroup.beds.map((bed) => {
                      const isOccupied = bed.status === 'OCCUPIED';
                      const isAvailable = bed.status === 'AVAILABLE';
                      const isCleaning = bed.status === 'CLEANING' || bed.status === 'CLEANING_SANITIZING';
                      const isReserved = bed.status === 'RESERVED';
                      const isMaintenance = bed.status === 'MAINTENANCE';

                      return (
                        <div
                          key={bed._id}
                          className={`p-3 rounded-2xl border transition-all relative flex flex-col justify-between group ${
                            isOccupied
                              ? 'bg-rose-50/40 border-rose-200 hover:border-rose-300'
                              : isAvailable
                              ? 'bg-emerald-50/30 border-emerald-200 hover:border-emerald-300'
                              : isCleaning
                              ? 'bg-amber-50/40 border-amber-200 hover:border-amber-300'
                              : isReserved
                              ? 'bg-blue-50/40 border-blue-200 hover:border-blue-300'
                              : 'bg-slate-50 border-slate-200'
                          }`}
                        >
                          <div>
                            {/* Top Bed Card Header */}
                            <div className="flex items-center justify-between">
                              <span className="font-extrabold text-xs text-slate-900 font-mono tracking-tight">
                                {bed.bedNumber}
                              </span>
                              {getStatusBadge(bed.status)}
                            </div>

                            <div className="text-[10px] text-slate-500 mt-1 truncate">
                              Room: <strong className="text-slate-700">{bed.roomNumber || 'Open'}</strong> • ₹{bed.dailyTariff}/d
                            </div>

                            {/* Patient Info If Occupied */}
                            {isOccupied && bed.currentPatientId && (
                              <div className="mt-2 p-2 rounded-xl bg-white border border-rose-100 space-y-0.5">
                                <div className="font-extrabold text-xs text-rose-950 truncate">
                                  {bed.currentPatientId.firstName} {bed.currentPatientId.lastName}
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono">
                                  UHID: {bed.currentPatientId.uhid}
                                </div>
                              </div>
                            )}

                            {/* Reservation Info */}
                            {isReserved && bed.reservationDetails?.patientName && (
                              <div className="mt-2 p-2 rounded-xl bg-white border border-blue-100 text-[10px]">
                                <div className="font-bold text-blue-900 truncate">Held: {bed.reservationDetails.patientName}</div>
                                <div className="text-slate-400">Exp: {bed.reservationDetails.expiresAt ? new Date(bed.reservationDetails.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '30m'}</div>
                              </div>
                            )}

                            {/* Cleaning Warning */}
                            {isCleaning && (
                              <div className="mt-2 p-2 rounded-xl bg-white border border-amber-200 text-[10px] text-amber-900 font-bold flex items-center gap-1">
                                <Clock size={11} className="text-amber-700 shrink-0" /> Requires Housekeeping Sign-off
                              </div>
                            )}

                            {/* Maintenance Warning */}
                            {isMaintenance && (
                              <div className="mt-2 p-2 rounded-xl bg-white border border-slate-300 text-[10px] text-slate-700 font-semibold truncate flex items-center gap-1">
                                <Wrench size={11} className="text-slate-500 shrink-0" /> {bed.maintenanceDetails?.issue || 'Fault reported'}
                              </div>
                            )}
                          </div>

                          {/* Quick Interactive Actions */}
                          <div className="pt-2 mt-2 border-t border-slate-200/60 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedBedForHistory(bed);
                                setIsHistoryModalOpen(true);
                              }}
                              className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800"
                              title="Audit History"
                            >
                              History
                            </button>

                            <div className="flex items-center gap-1">
                              {isCleaning && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedBedForCleaning(bed);
                                    setIsCleaningModalOpen(true);
                                  }}
                                  className="px-2 py-0.5 rounded bg-emerald-600 text-white font-bold text-[10px] hover:bg-emerald-700"
                                >
                                  Clean ✓
                                </button>
                              )}

                              {isAvailable && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedBedForReserve(bed);
                                    setIsReserveModalOpen(true);
                                  }}
                                  className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-bold text-[10px] hover:bg-blue-100"
                                >
                                  Hold
                                </button>
                              )}

                              {isReserved && (
                                <button
                                  type="button"
                                  onClick={() => handleReleaseReservation(bed)}
                                  className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-bold"
                                >
                                  Release
                                </button>
                              )}

                              {isMaintenance && (
                                <button
                                  type="button"
                                  onClick={() => handleRepairCompleted(bed)}
                                  className="px-2 py-0.5 rounded bg-slate-800 text-white text-[10px] font-bold"
                                >
                                  Fixed ✓
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : viewMode === 'CARDS' ? (
            /* --- CARDS VIEW (Detailed Inpatient Cards) --- */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredBeds.map((bed) => {
                const isOccupied = bed.status === 'OCCUPIED';
                const pat = bed.currentPatientId;

                return (
                  <div key={bed._id} className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-3 flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-black text-sm text-slate-900 font-mono">{bed.bedNumber}</span>
                          <span className="text-xs text-slate-500 font-semibold">• {bed.wardName || 'Ward'}</span>
                        </div>
                        {getStatusBadge(bed.status)}
                      </div>

                      <div className="text-xs text-slate-600 flex items-center justify-between">
                        <span>Room: <strong>{bed.roomNumber || 'N/A'}</strong> ({bed.bedType})</span>
                        <span className="font-bold text-indigo-700">₹{bed.dailyTariff}/day</span>
                      </div>

                      {isOccupied && pat && (
                        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
                          <div className="flex items-center justify-between font-extrabold text-slate-900">
                            <span>{pat.firstName} {pat.lastName}</span>
                            <span className="text-[11px] font-mono text-indigo-700">{pat.uhid}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 flex items-center justify-between">
                            <span>Age/Sex: {pat.age || '--'} / {pat.gender || '--'}</span>
                            <span>Phone: {pat.phone || '--'}</span>
                          </div>
                          {bed.assignedNurseId && (
                            <div className="text-[11px] text-slate-600 pt-1 border-t border-slate-200">
                              Nurse: <strong>{bed.assignedNurseId.name}</strong>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedBedForHistory(bed);
                          setIsHistoryModalOpen(true);
                        }}
                        className="text-xs"
                      >
                        History Log
                      </Button>

                      <div className="flex items-center gap-1.5">
                        {isOccupied && bed.currentAdmissionId && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedAdmissionForTransfer({
                                _id: bed.currentAdmissionId,
                                patientName: `${pat?.firstName || ''} ${pat?.lastName || ''}`.trim(),
                                uhid: pat?.uhid || '',
                                bedNumber: bed.bedNumber,
                                targetWardName: bed.wardName,
                                roomNumber: bed.roomNumber,
                                dailyTariff: bed.dailyTariff,
                              });
                              setIsTransferModalOpen(true);
                            }}
                            className="text-xs font-bold text-blue-700 bg-blue-50 border-blue-200"
                          >
                            Transfer ➔
                          </Button>
                        )}

                        {bed.status === 'CLEANING' && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => {
                              setSelectedBedForCleaning(bed);
                              setIsCleaningModalOpen(true);
                            }}
                            className="text-xs bg-emerald-600 hover:bg-emerald-700 font-bold"
                          >
                            Mark Cleaned
                          </Button>
                        )}

                        {bed.status === 'AVAILABLE' && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedBedForMaintenance(bed);
                              setIsMaintenanceModalOpen(true);
                            }}
                            className="text-xs text-slate-600"
                          >
                            Fault Report
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* --- LIST VIEW --- */
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="py-3 px-4">Bed Identifier</th>
                      <th className="py-3 px-4">Location (Block / Floor / Ward / Room)</th>
                      <th className="py-3 px-4">Bed Type</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Current Inpatient</th>
                      <th className="py-3 px-4">Daily Tariff</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredBeds.map((bed) => (
                      <tr key={bed._id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4 font-mono font-extrabold text-slate-900">
                          {bed.bedNumber}
                        </td>
                        <td className="py-3 px-4 text-slate-700">
                          <div className="font-bold">{bed.wardName || 'Ward'} • Room {bed.roomNumber || 'N/A'}</div>
                          <div className="text-[10px] text-slate-400">
                            {bed.blockName || 'Main Block'} • {bed.floorName || 'Floor'}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-600 font-semibold">
                          {bed.bedType}
                        </td>
                        <td className="py-3 px-4">
                          {getStatusBadge(bed.status)}
                        </td>
                        <td className="py-3 px-4">
                          {bed.currentPatientId ? (
                            <div>
                              <span className="font-bold text-slate-900">
                                {bed.currentPatientId.firstName} {bed.currentPatientId.lastName}
                              </span>
                              <div className="text-[10px] text-slate-400 font-mono">{bed.currentPatientId.uhid}</div>
                            </div>
                          ) : (
                            <span className="text-slate-400 italic">None (Vacant)</span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-extrabold text-indigo-700">
                          ₹{bed.dailyTariff}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => {
                              setSelectedBedForHistory(bed);
                              setIsHistoryModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                            title="View History"
                          >
                            <History size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: PHYSICAL HIERARCHY SETUP (BLOCKS, FLOORS, WARDS, ROOMS, BEDS) */}
      {/* ========================================================================= */}
      {activeTab === 'SETUP' && isAdmin && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs space-y-4">
            {/* Sub-nav inside Setup */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
                {[
                  { id: 'BLOCKS', label: `1. Buildings (${blocks.length})`, icon: Building2, testId: 'tab-blocks' },
                  { id: 'FLOORS', label: `2. Floors (${floors.length})`, icon: Layers, testId: 'tab-floors' },
                  { id: 'WARDS', label: `3. Wards (${wards.length})`, icon: GitFork, testId: 'tab-wards' },
                  { id: 'ROOMS', label: `4. Rooms (${rooms.length})`, icon: DoorOpen, testId: 'tab-rooms' },
                  { id: 'BEDS', label: `5. Beds (${beds.length})`, icon: BedDouble, testId: 'tab-beds' },
                ].map((sTab) => (
                  <button
                    key={sTab.id}
                    data-testid={sTab.testId}
                    onClick={() => setSetupSubTab(sTab.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all ${
                      setupSubTab === sTab.id
                        ? 'bg-white text-indigo-700 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {sTab.label}
                  </button>
                ))}
              </div>

              {/* Add Button depending on active setup tab */}
              <div>
                {setupSubTab === 'BLOCKS' && (
                  <Button
                    variant="primary"
                    size="sm"
                    data-testid="block-create-button"
                    onClick={() => {
                      setSelectedBlockToEdit(null);
                      setIsBlockModalOpen(true);
                    }}
                    className="font-bold text-xs"
                  >
                    <Plus size={14} /> Add Building / Block
                  </Button>
                )}
                {setupSubTab === 'FLOORS' && (
                  <Button
                    variant="primary"
                    size="sm"
                    data-testid="floor-create-button"
                    onClick={() => {
                      setSelectedFloorToEdit(null);
                      setIsFloorModalOpen(true);
                    }}
                    className="font-bold text-xs"
                  >
                    <Plus size={14} /> Add Floor
                  </Button>
                )}
                {setupSubTab === 'WARDS' && (
                  <Button
                    variant="primary"
                    size="sm"
                    data-testid="ward-create-button"
                    onClick={() => {
                      setSelectedWardToEdit(null);
                      setIsWardModalOpen(true);
                    }}
                    className="font-bold text-xs"
                  >
                    <Plus size={14} /> Add Ward / Section
                  </Button>
                )}
                {setupSubTab === 'ROOMS' && (
                  <Button
                    variant="primary"
                    size="sm"
                    data-testid="room-create-button"
                    onClick={() => {
                      setSelectedRoomToEdit(null);
                      setIsRoomModalOpen(true);
                    }}
                    className="font-bold text-xs"
                  >
                    <Plus size={14} /> Add Room
                  </Button>
                )}
                {setupSubTab === 'BEDS' && (
                  <Button
                    variant="primary"
                    size="sm"
                    data-testid="bed-create-button"
                    onClick={() => {
                      setSelectedBedToEdit(null);
                      setIsBedModalOpen(true);
                    }}
                    className="font-bold text-xs"
                  >
                    <Plus size={14} /> Add Individual Bed
                  </Button>
                )}
              </div>
            </div>

            {/* Sub-tab 1: BLOCKS Table */}
            {setupSubTab === 'BLOCKS' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
                    <tr>
                      <th className="py-3 px-4">Block Name</th>
                      <th className="py-3 px-4">Code</th>
                      <th className="py-3 px-4">Floors</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Description</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {blocks.map((b) => (
                      <tr key={b._id} data-testid="block-row" className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-bold text-slate-900">{b.name}</td>
                        <td className="py-3 px-4 font-mono font-bold text-slate-600">{b.code || '--'}</td>
                        <td className="py-3 px-4 text-slate-700 font-semibold">{b.numberOfFloors || 1}</td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${b.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                            {b.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-500">{b.description || '--'}</td>
                        <td className="py-3 px-4 text-right space-x-1">
                          <button
                            onClick={() => {
                              setSelectedBlockToEdit(b);
                              setIsBlockModalOpen(true);
                            }}
                            data-testid="block-edit-button"
                            className="p-1 rounded text-slate-400 hover:text-indigo-600"
                            title="Edit"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteHierarchyItem('Block', b._id, b.name)}
                            data-testid="block-delete-button"
                            className="p-1 rounded text-slate-400 hover:text-rose-600"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Sub-tab 2: FLOORS Table */}
            {setupSubTab === 'FLOORS' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
                    <tr>
                      <th className="py-3 px-4">Floor Name</th>
                      <th className="py-3 px-4">Floor Index</th>
                      <th className="py-3 px-4">Belongs to Block</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {floors.map((f) => (
                      <tr key={f._id} data-testid="floor-row" className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-bold text-slate-900">{f.name}</td>
                        <td className="py-3 px-4 font-mono text-slate-600">{f.floorNumber}</td>
                        <td className="py-3 px-4 text-slate-700 font-semibold">{f.blockId?.name || 'Unassigned'}</td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${f.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                            {f.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right space-x-1">
                          <button
                            onClick={() => {
                              setSelectedFloorToEdit(f);
                              setIsFloorModalOpen(true);
                            }}
                            data-testid="floor-edit-button"
                            className="p-1 rounded text-slate-400 hover:text-indigo-600"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteHierarchyItem('Floor', f._id, f.name)}
                            data-testid="floor-delete-button"
                            className="p-1 rounded text-slate-400 hover:text-rose-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Sub-tab 3: WARDS Table */}
            {setupSubTab === 'WARDS' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
                    <tr>
                      <th className="py-3 px-4">Ward / Section Name</th>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4">Gender Scope</th>
                      <th className="py-3 px-4">Capacity</th>
                      <th className="py-3 px-4">Default Tariff</th>
                      <th className="py-3 px-4">Location</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {wards.map((w) => (
                      <tr key={w._id} data-testid="ward-row" className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-bold text-slate-900">{w.name}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                            {w.wardType}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-600 font-semibold">{w.genderRestriction}</td>
                        <td className="py-3 px-4 text-slate-700 font-semibold">{w.bedCapacity} Beds</td>
                        <td className="py-3 px-4 font-bold text-emerald-700">₹{w.defaultDailyCharge}/day</td>
                        <td className="py-3 px-4 text-slate-500 text-[11px]">
                          {w.blockId?.name ? `${w.blockId.name} • ` : ''}{w.floorId?.name || 'Unassigned Floor'}
                        </td>
                        <td className="py-3 px-4 text-right space-x-1">
                          <button
                            onClick={() => {
                              setSelectedWardToEdit(w);
                              setIsWardModalOpen(true);
                            }}
                            data-testid="ward-edit-button"
                            className="p-1 rounded text-slate-400 hover:text-indigo-600"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteHierarchyItem('Ward', w._id, w.name)}
                            data-testid="ward-delete-button"
                            className="p-1 rounded text-slate-400 hover:text-rose-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Sub-tab 4: ROOMS Table */}
            {setupSubTab === 'ROOMS' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
                    <tr>
                      <th className="py-3 px-4">Room #</th>
                      <th className="py-3 px-4">Display Name</th>
                      <th className="py-3 px-4">Room Type</th>
                      <th className="py-3 px-4">Bed Capacity</th>
                      <th className="py-3 px-4">Daily Room Charge</th>
                      <th className="py-3 px-4">Ward / Section</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rooms.map((r) => (
                      <tr key={r._id} data-testid="room-row" className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-mono font-extrabold text-slate-900">{r.roomNumber}</td>
                        <td className="py-3 px-4 text-slate-700 font-semibold">{r.roomName || `Room ${r.roomNumber}`}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                            {r.roomType}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-700 font-semibold">{r.maxBedCapacity} Beds</td>
                        <td className="py-3 px-4 font-bold text-emerald-700">₹{r.dailyRoomCharge}/day</td>
                        <td className="py-3 px-4 text-slate-600">{r.wardId?.name || 'Unassigned'}</td>
                        <td className="py-3 px-4 text-right space-x-1">
                          <button
                            onClick={() => {
                              setSelectedRoomToEdit(r);
                              setIsRoomModalOpen(true);
                            }}
                            data-testid="room-edit-button"
                            className="p-1 rounded text-slate-400 hover:text-indigo-600"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteHierarchyItem('Room', r._id, r.roomNumber)}
                            data-testid="room-delete-button"
                            className="p-1 rounded text-slate-400 hover:text-rose-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Sub-tab 5: BEDS Table */}
            {setupSubTab === 'BEDS' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
                    <tr>
                      <th className="py-3 px-4">Bed Number</th>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4">Ward / Room</th>
                      <th className="py-3 px-4">Daily Tariff</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {beds.map((b) => (
                      <tr key={b._id} data-testid="bed-row" className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-mono font-extrabold text-slate-900">{b.bedNumber}</td>
                        <td className="py-3 px-4 text-slate-600 font-semibold">{b.bedType}</td>
                        <td className="py-3 px-4 text-slate-700">
                          {b.wardName} • Room {b.roomNumber || 'N/A'}
                        </td>
                        <td className="py-3 px-4 font-bold text-emerald-700">₹{b.dailyTariff}/day</td>
                        <td className="py-3 px-4">{getStatusBadge(b.status)}</td>
                        <td className="py-3 px-4 text-right space-x-1">
                          <button
                            onClick={() => {
                              setSelectedBedToEdit(b);
                              setIsBedModalOpen(true);
                            }}
                            data-testid="bed-edit-button"
                            className="p-1 rounded text-slate-400 hover:text-indigo-600"
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteHierarchyItem('Bed', b._id, b.bedNumber)}
                            data-testid="bed-delete-button"
                            className="p-1 rounded text-slate-400 hover:text-rose-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: HOUSEKEEPING & CLEANING QUEUE */}
      {/* ========================================================================= */}
      {activeTab === 'CLEANING' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 text-amber-900 flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-xs">
              <Sparkles size={18} className="text-amber-700" />
              <span>
                Housekeeping Sanitization Desk: Beds in this queue cannot be allocated to new patients until cleaning is completed.
              </span>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-amber-200/80 font-black text-xs text-amber-950">
              {beds.filter((b) => b.status === 'CLEANING' || b.status === 'CLEANING_SANITIZING').length} Pending
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {beds.filter((b) => b.status === 'CLEANING' || b.status === 'CLEANING_SANITIZING').length === 0 ? (
              <div className="col-span-full p-12 text-center bg-white rounded-2xl border border-slate-200 text-slate-500 font-semibold space-y-2">
                <CheckCircle2 size={36} className="mx-auto text-emerald-500" />
                <div className="text-base text-slate-900 font-extrabold">All Beds Clean &amp; Sanitized!</div>
                <p className="text-xs text-slate-400">No beds currently pending housekeeping disinfection.</p>
              </div>
            ) : (
              beds
                .filter((b) => b.status === 'CLEANING' || b.status === 'CLEANING_SANITIZING')
                .map((bed) => (
                  <div key={bed._id} className="p-4 rounded-2xl bg-white border border-amber-200 shadow-2xs space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold text-sm text-slate-900 font-mono">{bed.bedNumber}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                        Needs Sanitization
                      </span>
                    </div>

                    <div className="text-xs text-slate-600 space-y-1">
                      <div>Location: <strong>{bed.wardName || 'Ward'}</strong> • Room {bed.roomNumber || 'N/A'}</div>
                      {bed.cleaningDetails?.notes && (
                        <p className="text-[11px] text-amber-800 italic bg-amber-50 p-2 rounded-lg border border-amber-100">
                          "{bed.cleaningDetails.notes}"
                        </p>
                      )}
                      {bed.cleaningDetails?.requestedAt && (
                        <div className="text-[10px] text-slate-400 flex items-center gap-1">
                          <Clock size={10} /> Queued: {new Date(bed.cleaningDetails.requestedAt).toLocaleString()}
                        </div>
                      )}
                    </div>

                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setSelectedBedForCleaning(bed);
                        setIsCleaningModalOpen(true);
                      }}
                      className="w-full font-bold text-xs bg-emerald-600 hover:bg-emerald-700"
                    >
                      Certify Cleaned &amp; Release
                    </Button>
                  </div>
                ))
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: MAINTENANCE DESK */}
      {/* ========================================================================= */}
      {activeTab === 'MAINTENANCE' && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-slate-100 border border-slate-300 text-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-xs">
              <Wrench size={18} className="text-slate-700" />
              <span>
                Biomedical &amp; Bed Maintenance Desk: Track reported electrical/mechanical faults.
              </span>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-slate-200 font-black text-xs text-slate-900">
              {beds.filter((b) => b.status === 'MAINTENANCE').length} Under Repair
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {beds.filter((b) => b.status === 'MAINTENANCE').length === 0 ? (
              <div className="col-span-full p-12 text-center bg-white rounded-2xl border border-slate-200 text-slate-500 font-semibold space-y-2">
                <CheckCircle2 size={36} className="mx-auto text-emerald-500" />
                <div className="text-base text-slate-900 font-extrabold">All Beds 100% Operational!</div>
                <p className="text-xs text-slate-400">No active maintenance issues or defective beds reported.</p>
              </div>
            ) : (
              beds
                .filter((b) => b.status === 'MAINTENANCE')
                .map((bed) => (
                  <div key={bed._id} className="p-4 rounded-2xl bg-white border border-slate-300 shadow-2xs space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold text-sm text-slate-900 font-mono">{bed.bedNumber}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
                        {bed.maintenanceDetails?.priority || 'MEDIUM'} Priority
                      </span>
                    </div>

                    <div className="text-xs text-slate-600 space-y-1">
                      <div>Location: <strong>{bed.wardName || 'Ward'}</strong> • Room {bed.roomNumber || 'N/A'}</div>
                      <div className="p-2 rounded-xl bg-rose-50/50 border border-rose-100 text-rose-900 text-xs font-semibold">
                        Issue: {bed.maintenanceDetails?.issue || 'Fault reported'}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Reported By: {bed.maintenanceDetails?.reportedByName || 'Staff'}
                      </div>
                    </div>

                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleRepairCompleted(bed)}
                      className="w-full font-bold text-xs bg-slate-800 hover:bg-slate-900"
                    >
                      Mark Repair Done &amp; Return to Available
                    </Button>
                  </div>
                ))
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: PATIENT TRANSFERS & AUDIT LOG */}
      {/* ========================================================================= */}
      {activeTab === 'TRANSFERS' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-extrabold text-sm text-slate-900">Hospital Patient Bed Transfer Log</h3>
            <span className="text-xs text-slate-500 font-semibold">{transfers.length} Recorded Transfers</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
                <tr>
                  <th className="py-3 px-4">Transfer Date/Time</th>
                  <th className="py-3 px-4">Patient</th>
                  <th className="py-3 px-4">Origin Location</th>
                  <th className="py-3 px-4">Destination Location</th>
                  <th className="py-3 px-4">Tariff Transition</th>
                  <th className="py-3 px-4">Reason</th>
                  <th className="py-3 px-4">Transferred By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transfers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      No patient transfers recorded in this hospital yet.
                    </td>
                  </tr>
                ) : (
                  transfers.map((t) => (
                    <tr key={t._id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                        {new Date(t.transferDate || t.createdAt).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900">
                        {t.patientName} <span className="text-[10px] text-slate-400 font-mono">({t.uhid})</span>
                      </td>
                      <td className="py-3 px-4 text-rose-700 font-semibold">
                        Bed {t.fromBedNumber} ({t.fromWardName})
                      </td>
                      <td className="py-3 px-4 text-emerald-700 font-bold">
                        Bed {t.toBedNumber} ({t.toWardName})
                      </td>
                      <td className="py-3 px-4 text-slate-700 font-mono">
                        ₹{t.fromDailyTariff} ➔ ₹{t.toDailyTariff}/d
                      </td>
                      <td className="py-3 px-4 text-slate-600 italic max-w-xs truncate">
                        "{t.reason}"
                      </td>
                      <td className="py-3 px-4 text-slate-700 font-semibold">
                        {t.transferredByName || 'Staff'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 6: OCCUPANCY & TURNOVER REPORTS */}
      {/* ========================================================================= */}
      {activeTab === 'ANALYTICS' && (
        <div className="space-y-6">
          {/* Ward Breakdown Table */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
            <h3 className="font-extrabold text-sm text-slate-900">Ward &amp; Section Occupancy Breakdown</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Ward Name</th>
                    <th className="py-3 px-4">Classification</th>
                    <th className="py-3 px-4">Total Beds</th>
                    <th className="py-3 px-4">Occupied</th>
                    <th className="py-3 px-4">Available</th>
                    <th className="py-3 px-4">Cleaning</th>
                    <th className="py-3 px-4">Occupancy Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(occupancyReports?.wardReports || []).map((w) => (
                    <tr key={w.name} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-bold text-slate-900">{w.name}</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700">
                          {w.wardType}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-700">{w.total}</td>
                      <td className="py-3 px-4 font-bold text-rose-700">{w.occupied}</td>
                      <td className="py-3 px-4 font-bold text-emerald-700">{w.available}</td>
                      <td className="py-3 px-4 text-amber-700 font-semibold">{w.cleaning}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-24 bg-slate-100 h-2 rounded-full overflow-hidden">
                            <div
                              className="bg-indigo-600 h-full rounded-full"
                              style={{ width: `${Math.min(100, w.occupancyRate || 0)}%` }}
                            />
                          </div>
                          <span className="font-extrabold text-slate-900">{w.occupancyRate}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL DIALOGS */}
      {/* ========================================================================= */}
      <CreateBlockModal
        isOpen={isBlockModalOpen}
        onClose={() => setIsBlockModalOpen(false)}
        blockToEdit={selectedBlockToEdit}
        onSuccess={fetchAllData}
      />

      <CreateFloorModal
        isOpen={isFloorModalOpen}
        onClose={() => setIsFloorModalOpen(false)}
        floorToEdit={selectedFloorToEdit}
        blocks={blocks}
        onSuccess={fetchAllData}
      />

      <CreateWardModal
        isOpen={isWardModalOpen}
        onClose={() => setIsWardModalOpen(false)}
        wardToEdit={selectedWardToEdit}
        blocks={blocks}
        floors={floors}
        onSuccess={fetchAllData}
      />

      <CreateRoomModal
        isOpen={isRoomModalOpen}
        onClose={() => setIsRoomModalOpen(false)}
        roomToEdit={selectedRoomToEdit}
        blocks={blocks}
        floors={floors}
        wards={wards}
        onSuccess={fetchAllData}
      />

      <CreateBedModal
        isOpen={isBedModalOpen}
        onClose={() => setIsBedModalOpen(false)}
        bedToEdit={selectedBedToEdit}
        blocks={blocks}
        floors={floors}
        wards={wards}
        rooms={rooms}
        onSuccess={fetchAllData}
      />

      <BulkBedGeneratorModal
        isOpen={isBulkModalOpen}
        onClose={() => setIsBulkModalOpen(false)}
        blocks={blocks}
        floors={floors}
        wards={wards}
        onSuccess={fetchAllData}
      />

      <TransferPatientModal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        admission={selectedAdmissionForTransfer}
        onSuccess={fetchAllData}
      />

      <ReserveBedModal
        isOpen={isReserveModalOpen}
        onClose={() => setIsReserveModalOpen(false)}
        bed={selectedBedForReserve}
        onSuccess={fetchAllData}
      />

      <ReportMaintenanceModal
        isOpen={isMaintenanceModalOpen}
        onClose={() => setIsMaintenanceModalOpen(false)}
        bed={selectedBedForMaintenance}
        onSuccess={fetchAllData}
      />

      <MarkCleaningCompleteModal
        isOpen={isCleaningModalOpen}
        onClose={() => setIsCleaningModalOpen(false)}
        bed={selectedBedForCleaning}
        onSuccess={fetchAllData}
      />

      <EmergencyBedFinderModal
        isOpen={isEmergencyFinderOpen}
        onClose={() => setIsEmergencyFinderOpen(false)}
        onSelectBed={(b) => {
          // Open direct allocation / bed viewer
          setSelectedBedForReserve(b);
          setIsReserveModalOpen(true);
        }}
      />

      <BedHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        bed={selectedBedForHistory}
      />
    </div>
  );
};

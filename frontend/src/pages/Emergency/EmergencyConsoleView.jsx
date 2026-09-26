import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useEmergencyStore } from '../../store/emergencyStore';
import { useSocket } from '../../providers/SocketProvider';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { ShieldAlert, CheckCircle2, MapPin, User, Clock, AlertTriangle, Activity, History } from 'lucide-react';
import { axiosClient } from '../../api/axiosClient';

export const EmergencyConsoleView = () => {
  const [searchParams] = useSearchParams();
  const targetEmergencyId = searchParams.get('emergencyId');
  const { socket } = useSocket();
  const { emergencies, resolveEmergency, fetchActiveEmergencies, addEmergency, markResolved, isResolving } = useEmergencyStore();
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('ACTIVE'); // 'ACTIVE' | 'HISTORY'

  useEffect(() => {
    fetchActiveEmergencies();
    fetchHistory();
  }, []);

  useEffect(() => {
    if (!socket) return;
    let alertTimer = null;
    let resolveTimer = null;

    const handleEmergencyAlert = (data) => {
      if (data) {
        addEmergency(data);
      }
      if (alertTimer) clearTimeout(alertTimer);
      alertTimer = setTimeout(() => {
        fetchActiveEmergencies();
      }, 250);
    };

    const handleEmergencyResolved = (data) => {
      if (data?.emergencyId || data?._id) {
        markResolved(data.emergencyId || data._id);
      }
      if (resolveTimer) clearTimeout(resolveTimer);
      resolveTimer = setTimeout(() => {
        fetchActiveEmergencies();
        fetchHistory();
      }, 250);
    };

    socket.on('emergency:alert', handleEmergencyAlert);
    socket.on('emergency:raised', handleEmergencyAlert);
    socket.on('emergency:code_blue_triggered', handleEmergencyAlert);
    socket.on('workflow:emergency_raised', handleEmergencyAlert);
    socket.on('emergency:resolved', handleEmergencyResolved);
    socket.on('workflow:emergency_resolved', handleEmergencyResolved);

    return () => {
      if (alertTimer) clearTimeout(alertTimer);
      if (resolveTimer) clearTimeout(resolveTimer);
      socket.off('emergency:alert', handleEmergencyAlert);
      socket.off('emergency:raised', handleEmergencyAlert);
      socket.off('emergency:code_blue_triggered', handleEmergencyAlert);
      socket.off('workflow:emergency_raised', handleEmergencyAlert);
      socket.off('emergency:resolved', handleEmergencyResolved);
      socket.off('workflow:emergency_resolved', handleEmergencyResolved);
    };
  }, [socket, addEmergency, markResolved, fetchActiveEmergencies]);

  const fetchHistory = async () => {
    try {
      const res = await axiosClient.get('/emergency/history');
      setHistory(res.data || []);
    } catch (err) {
      console.error('Failed to fetch emergency history:', err);
    }
  };

  const activeList = useMemo(() => {
    return emergencies.filter((e) => e.status === 'ACTIVE' || e.status === 'RESPONDED');
  }, [emergencies]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900 text-white p-6 rounded-2xl shadow-xl">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-red-600 text-white animate-pulse">
            <ShieldAlert size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">Hospital Emergency Console</h1>
            <p className="text-xs text-slate-300">Real-time emergency protocols, active code alerts & response audit trail</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('ACTIVE')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
              activeTab === 'ACTIVE'
                ? 'bg-red-600 text-white shadow-md'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Active Emergencies ({activeList.length})
          </button>
          <button
            onClick={() => { setActiveTab('HISTORY'); fetchHistory(); }}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
              activeTab === 'HISTORY'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Resolution Audit History
          </button>
        </div>
      </div>

      {activeTab === 'ACTIVE' ? (
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Activity size={18} className="text-red-600 animate-bounce" />
              Active Code Alerts ({activeList.length})
            </h3>
            <span className="text-xs text-slate-500 font-medium">Broadcasted across all workstation screens</span>
          </div>

          {activeList.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeList.map((emg) => (
                <div key={emg._id || emg.emergencyId} className="p-5 rounded-2xl bg-red-50 border-2 border-red-200 space-y-3 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="px-3 py-1 rounded-lg bg-red-600 text-white font-black text-xs uppercase tracking-wider">
                      {emg.emergencyType}
                    </span>
                    <span className="text-xs text-slate-500 font-mono font-bold flex items-center gap-1">
                      <Clock size={12} /> {new Date(emg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <h4 className="font-extrabold text-slate-900 text-sm flex items-center gap-1.5">
                      <MapPin size={16} className="text-red-600 shrink-0" /> {emg.location}
                    </h4>
                    <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                      <User size={14} className="text-slate-400 shrink-0" /> Patient: {emg.patientName} ({emg.uhid})
                    </p>
                    {emg.description && (
                      <p className="text-xs text-slate-600 bg-white p-2.5 rounded-lg border border-red-100 italic">
                        "{emg.description}"
                      </p>
                    )}
                    <p className="text-[11px] text-slate-500 pt-1">
                      Initiated by: <span className="font-bold text-slate-800">{emg.raisedByUserName}</span> ({emg.raisedByDept})
                    </p>
                  </div>

                  <div className="pt-2 border-t border-red-200 flex justify-end">
                    <Button
                      variant="primary"
                      className={`text-xs font-bold w-full sm:w-auto transition-all ${
                        isResolving(emg._id || emg.emergencyId)
                          ? 'bg-slate-400 text-white cursor-not-allowed'
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      }`}
                      disabled={isResolving(emg._id || emg.emergencyId)}
                      onClick={() => resolveEmergency(emg._id || emg.emergencyId, 'Emergency resolved by medical response unit.')}
                    >
                      <CheckCircle2 size={14} />
                      {isResolving(emg._id || emg.emergencyId) ? 'Resolving...' : 'Mark as Stabilized & Resolved'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-12 text-center text-slate-500 space-y-2">
              <CheckCircle2 size={36} className="mx-auto text-emerald-500" />
              <h3 className="font-bold text-slate-800 text-base">All Wards Normal & Clear</h3>
              <p className="text-xs">There are currently no active emergency code alerts across the hospital facility.</p>
            </div>
          )}
        </Card>
      ) : (
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <History size={18} className="text-indigo-600" />
              Emergency Response Audit Log
            </h3>
            <span className="text-xs text-slate-500 font-medium">Historical audit trail</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px]">
                <tr>
                  <th className="p-3">Protocol</th>
                  <th className="p-3">Location</th>
                  <th className="p-3">Patient</th>
                  <th className="p-3">Initiated By</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Resolved By</th>
                  <th className="p-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {history.length > 0 ? (
                  history.map((h) => (
                    <tr key={h._id} className="hover:bg-slate-50">
                      <td className="p-3 font-bold text-slate-900">{h.emergencyType}</td>
                      <td className="p-3 font-semibold text-slate-700">{h.location}</td>
                      <td className="p-3 text-slate-800">{h.patientName} ({h.uhid})</td>
                      <td className="p-3 text-slate-600">{h.raisedByUserName} ({h.raisedByDept})</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                          h.status === 'ACTIVE' ? 'bg-red-600 text-white' : 'bg-emerald-100 text-emerald-800'
                        }`}>
                          {h.status}
                        </span>
                      </td>
                      <td className="p-3 text-slate-600">{h.resolvedByUserName || '—'}</td>
                      <td className="p-3 text-slate-500 font-mono">{new Date(h.createdAt).toLocaleDateString()} {new Date(h.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-500">No past emergency records found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};

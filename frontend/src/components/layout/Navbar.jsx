import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useNotificationStore } from '../../store/notificationStore';
import { useSocket } from '../../providers/SocketProvider';
import { useAvailability } from '../../hooks/useAvailability';
import { CLINIC_OWNER_WORK_ROLES, getDefaultWorkRoute, useWorkspaceModeStore } from '../../store/workspaceModeStore';
import { ROLE_NAMES } from '../../utils/constants';
import { LogOut, Bell, Building2, User, Menu, Wifi, WifiOff, Stethoscope, StickyNote, ChevronDown, MessageSquare, ShieldAlert } from 'lucide-react';
import { Button } from '../ui/Button';
import { NotificationDropdown } from './NotificationDropdown';
import { UserProfilePopover } from './UserProfilePopover';
import { AdminAvailabilityPopover } from './AdminAvailabilityPopover';
import { useTeamChatStore } from '../../store/teamChatStore';
import { axiosClient } from '../../api/axiosClient';

export const Navbar = ({ onToggleSidebar }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, fetchProfile } = useAuthStore();
  const { currentMode, setMode, isDualModeEligible } = useWorkspaceModeStore();
  const isGuardianView = location.pathname.includes('/guardian') || user?.role === 'GUARDIAN';
  const { socket } = useSocket();
  const { unreadCount, notifications, fetchNotifications } = useNotificationStore();
  // Bell badge = number of UNREAD actionable notifications
  const notificationCount = unreadCount || 0;
  const { isAvailable, isToggling, handleToggle } = useAvailability();
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const isAdminOrDualMode = user?.role === 'HOSPITAL_ADMIN' || isDualModeEligible(user);
  const canSetAvailability = user && !['PATIENT', 'GUARDIAN', 'SUPER_ADMIN', 'HOSPITAL_ADMIN'].includes(user.role);

  const handleSwitchMode = async (targetMode) => {
    setMode(targetMode);
    const domainFromPath = location.pathname.split('/')[1];
    const isKnownNonTenant = ['admin', 'hospital-admin', 'doctor', 'reception', 'billing', 'pharmacy', 'laboratory', 'radiology', 'nursing', '403', 'login', 'reset-password'].includes(domainFromPath);
    const domain = user?.hospitalDomain || (!isKnownNonTenant && domainFromPath ? domainFromPath : null);

    if (targetMode === 'WORK') {
      let workUser = user;
      if (user?.role === 'HOSPITAL_ADMIN' && getDefaultWorkRoute(user) === null) {
        const accepted = window.confirm('Enable Clinic Owner Work Mode for this account? This allows the same login to operate registration, clinical, ward, pharmacy, diagnostics, billing, emergency, inventory, and HR desks.');
        if (!accepted) {
          setMode('ADMIN');
          return;
        }
        try {
          try {
            await axiosClient.post('/auth/me/enable-clinic-work-mode');
          } catch (provisionError) {
            const existingRoles = Array.isArray(user.additionalRoles) ? user.additionalRoles : [];
            await axiosClient.patch(`/auth/staff/${user.id || user._id}`, {
              additionalRoles: Array.from(new Set([...existingRoles, ...CLINIC_OWNER_WORK_ROLES])),
            });
          }
          workUser = await fetchProfile();
        } catch (error) {
          setMode('ADMIN');
          window.alert(error?.error?.message || error?.message || 'Unable to enable Clinic Owner Work Mode.');
          return;
        }
      }
      const workRoute = getDefaultWorkRoute(workUser);
      if (!workRoute) return;
      const target = domain ? `/${domain}${workRoute}` : workRoute;
      navigate(target);
    } else if (targetMode === 'ADMIN') {
      if (user?.role === 'SUPER_ADMIN') {
        navigate('/admin/dashboard');
      } else {
        const target = domain ? `/${domain}/admin/dashboard` : '/hospital-admin/dashboard';
        navigate(target);
      }
    }
  };

  useEffect(() => {
    if (!user?.id && !user?._id) return;
    fetchNotifications();
    if (!socket) return;
    let refreshDebounceTimer = null;
    const refresh = () => {
      if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
      refreshDebounceTimer = setTimeout(() => {
        fetchNotifications();
      }, 250);
    };
    socket.on('workflow:notification', refresh);
    socket.on('workflow:new_nurse_tasks', refresh);
    socket.on('nurse_task:created', refresh);
    socket.on('nurse_task:updated', refresh);
    socket.on('investigation:new_request', refresh);
    socket.on('opd_queue:status_changed', refresh);
    socket.on('notification:created', refresh);
    socket.on('notification:completed', refresh);
    socket.on('notification:cleared', refresh);
    socket.on('notification:read', refresh);
    socket.on('notification:all_read', refresh);
    socket.on('notification:all_cleared', refresh);
    socket.on('queue:patient_added', refresh);
    socket.on('token:generated', refresh);
    socket.on('appointment:created', refresh);
    socket.on('patient_request:created', refresh);
    socket.on('patient_request:updated', refresh);
    socket.on('workflow:pending_changed', refresh);
    return () => {
      if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
      socket.off('workflow:notification', refresh);
      socket.off('workflow:new_nurse_tasks', refresh);
      socket.off('nurse_task:created', refresh);
      socket.off('nurse_task:updated', refresh);
      socket.off('investigation:new_request', refresh);
      socket.off('opd_queue:status_changed', refresh);
      socket.off('notification:created', refresh);
      socket.off('notification:completed', refresh);
      socket.off('notification:cleared', refresh);
      socket.off('notification:read', refresh);
      socket.off('notification:all_read', refresh);
      socket.off('notification:all_cleared', refresh);
      socket.off('queue:patient_added', refresh);
      socket.off('token:generated', refresh);
      socket.off('appointment:created', refresh);
      socket.off('patient_request:created', refresh);
      socket.off('patient_request:updated', refresh);
      socket.off('workflow:pending_changed', refresh);
    };
  }, [user?.id, user?._id, socket]);

  const hasNotificationsPermission = (() => {
    if (!user) return false;
    if (user.role === 'SUPER_ADMIN' || user.role === 'HOSPITAL_ADMIN') return true;
    const permissions = user.permissions || {};
    if (permissions['*']?.includes('*') || permissions['*']?.includes('view')) return true;
    const notif = permissions.notifications;
    if (Array.isArray(notif) && notif.length > 0) return true;
    if (typeof notif === 'object' && notif !== null && (notif.view || notif['*'])) return true;
    // By default, all authenticated hospital staff have notification access
    return !['PATIENT', 'GUARDIAN'].includes(user.role);
  })();

  return (
    <header className="h-16 border-b border-slate-200 bg-white sticky top-0 z-30 px-2 sm:px-3 lg:px-4 xl:px-5 flex items-center justify-between shadow-sm gap-1.5 sm:gap-2 w-full max-w-full">
      {/* Left: Hamburger + Hospital & Branch Switcher Button */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink min-w-0">
        <button
          onClick={onToggleSidebar}
          className="lg:hidden text-slate-500 hover:text-slate-900 p-1.5 rounded-lg hover:bg-slate-100 transition-colors shrink-0"
          aria-label="Toggle sidebar"
        >
          <Menu size={18} />
        </button>

        {user?.role === 'SUPER_ADMIN' ? (
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100 shrink-0">
              <Building2 size={16} />
            </div>
            <div className="hidden sm:block min-w-0">
              <h1 className="text-xs sm:text-sm font-bold text-slate-800 leading-none truncate max-w-[100px] md:max-w-[140px] lg:max-w-[180px] xl:max-w-[220px]">
                Super Admin Console
              </h1>
              <span className="text-[10px] text-slate-400 font-medium truncate block mt-0.5">
                Platform Control
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 sm:gap-2 p-1 -ml-1 rounded-xl text-left min-w-0">
            <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100 shrink-0">
              <Building2 size={16} />
            </div>
            <div className="hidden sm:block min-w-0">
              <h1
                className="text-xs sm:text-sm font-bold text-slate-800 leading-none truncate max-w-[90px] md:max-w-[130px] lg:max-w-[170px] xl:max-w-[210px]"
                title={user?.hospitalName || 'Healthcare System'}
              >
                {user?.hospitalName || 'Healthcare System'}
              </h1>
              <span className="text-[10px] text-slate-400 font-medium truncate block mt-0.5">
                Hospital Portal
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Center: Dual-Mode Switcher for Multi-Role / Hospital Admin */}
      {isDualModeEligible(user) && (
        <div className="flex items-center p-0.5 sm:p-1 bg-slate-100/90 border border-slate-200/80 rounded-xl shadow-2xs shrink-0">
          <button
            type="button"
            onClick={() => handleSwitchMode('WORK')}
            className={`flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-1 rounded-lg text-xs font-bold transition-all duration-150 ${
              currentMode === 'WORK'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
            title="Switch to Clinical, Front Desk & Billing Workstations"
          >
            <Stethoscope size={13} className={currentMode === 'WORK' ? 'text-white' : 'text-indigo-600'} />
            <span className="hidden md:inline">Work Mode</span>
            <span className="md:hidden hidden sm:inline">Work</span>
          </button>

          <button
            type="button"
            onClick={() => handleSwitchMode('ADMIN')}
            className={`flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-1 rounded-lg text-xs font-bold transition-all duration-150 ${
              currentMode === 'ADMIN'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
            title="Switch to Hospital Admin, Staff Roles & Tariffs"
          >
            <Building2 size={13} className={currentMode === 'ADMIN' ? 'text-white' : 'text-slate-600'} />
            <span className="hidden md:inline">Admin Mode</span>
            <span className="md:hidden hidden sm:inline">Admin</span>
          </button>
        </div>
      )}

      {/* Right: Availability + Emergency + Chat + Notifications + User Info + Logout */}
      <div className="flex items-center gap-1 sm:gap-1.5 md:gap-2 shrink-0">
        {isAdminOrDualMode ? (
          <AdminAvailabilityPopover />
        ) : canSetAvailability ? (
          <button
            type="button"
            onClick={handleToggle}
            disabled={isToggling}
            className={`flex items-center gap-1 sm:gap-1.5 h-8 px-2 py-1 rounded-lg border text-xs font-bold transition-colors disabled:opacity-60 cursor-pointer shrink-0 ${
              isAvailable
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200'
                : 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200'
            }`}
            title={isAvailable ? 'Available — click to go offline' : 'Unavailable — click to go online'}
          >
            {isAvailable ? <Wifi size={13} /> : <WifiOff size={13} />}
            <span className="hidden md:inline">{isToggling ? 'Updating…' : (isAvailable ? 'Available' : 'Unavailable')}</span>
          </button>
        ) : null}

        {/* Rapid Emergency Trigger Button */}
        {user && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event('open-emergency-modal'))}
            className="flex items-center gap-1 sm:gap-1.5 h-8 px-2 sm:px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs font-extrabold shadow-2xs transition-all cursor-pointer border border-rose-500 shrink-0"
            title="Raise Emergency / Code Blue Broadcast"
          >
            <ShieldAlert size={14} className="animate-pulse" />
            <span className="hidden sm:inline">Emergency</span>
          </button>
        )}

        {/* Hospital Staff Team Chat Button */}
        {user && !['PATIENT', 'GUARDIAN'].includes(user.role) && (
          <button
            type="button"
            onClick={() => useTeamChatStore.getState().toggleOpen()}
            className="relative h-8 w-8 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200 transition-all duration-150 flex items-center justify-center cursor-pointer shrink-0"
            aria-label="Hospital Team Chat"
            title="Hospital Staff Team Chat & Communication"
          >
            <MessageSquare size={15} />
            {useTeamChatStore.getState().unreadTotal > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-0.5 rounded-full text-[9px] font-black bg-indigo-600 text-white flex items-center justify-center shadow-xs">
                {useTeamChatStore.getState().unreadTotal}
              </span>
            )}
          </button>
        )}

        {/* Notification Bell */}
        {hasNotificationsPermission && (
          <div className="relative shrink-0">
            <button
              onClick={() => setIsNotifOpen(!isNotifOpen)}
              className="relative h-8 w-8 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 hover:border-indigo-200 transition-all duration-150 flex items-center justify-center cursor-pointer shrink-0"
              aria-label="Notifications"
              title="Notifications"
            >
              <Bell size={15} />
              {notificationCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-0.5 rounded-full text-[9px] font-black bg-amber-500 text-white flex items-center justify-center shadow-xs animate-pulse">
                  {notificationCount}
                </span>
              )}
            </button>

            <NotificationDropdown isOpen={isNotifOpen} onClose={() => setIsNotifOpen(false)} />
          </div>
        )}

        {/* User Identity & Profile Popover Trigger */}
        <div className="relative flex items-center pl-1 sm:pl-1.5 border-l border-slate-200 shrink-0 gap-1 sm:gap-1.5">
          <button
            type="button"
            onClick={() => setIsProfileOpen(!isProfileOpen)}
            className="flex items-center gap-1 sm:gap-1.5 p-0.5 sm:px-1 sm:py-0.5 rounded-xl hover:bg-slate-100 transition-colors group cursor-pointer text-left select-none shrink-0"
            title="Click to view user profile, assigned roles & status"
          >
            <div className="text-right hidden min-[1400px]:block min-w-0">
              <p className="text-xs font-bold text-slate-800 leading-none group-hover:text-indigo-600 transition-colors truncate max-w-[100px]">
                {user?.name}
              </p>
              <p className="text-[10px] font-semibold text-indigo-500 mt-0.5 truncate max-w-[100px]">
                {isGuardianView ? 'Guardian Portal' : (ROLE_NAMES[user?.role] || user?.role)}
              </p>
            </div>

            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-indigo-600 group-hover:bg-indigo-700 flex items-center justify-center text-white font-bold text-xs sm:text-sm shrink-0 shadow-xs transition-transform group-hover:scale-105">
              {user?.name ? user.name.charAt(0).toUpperCase() : <User size={15} />}
            </div>

            <ChevronDown size={12} className="text-slate-400 group-hover:text-slate-700 transition-transform hidden sm:block shrink-0" />
          </button>

          {/* Profile Popover */}
          <UserProfilePopover isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />

          {/* Quick Logout Button - Always visible on all screens */}
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-1 sm:gap-1.5 h-8 px-2 sm:px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-rose-50 hover:border-rose-200 text-slate-700 hover:text-rose-700 transition-all font-bold text-xs shrink-0 cursor-pointer shadow-2xs"
            title="Logout of Hospital Session"
          >
            <LogOut size={14} className="shrink-0" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
};

import React, { useRef, useLayoutEffect, useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { SUPER_ADMIN_NAVIGATION, HOSPITAL_DRILLDOWN_NAVIGATION } from '../../utils/superAdminNavigation';
import { useSuperAdminContextStore } from '../../store/superAdminContextStore';
import { useSocket } from '../../providers/SocketProvider';
import { axiosClient } from '../../api/axiosClient';

let savedSuperAdminSidebarScrollTop = 0;

export const SuperAdminSidebar = ({ isOpen, onClose, drilldownHospitalId = null }) => {
  const location = useLocation();
  const { selectedHospitalName, pendingCount: storePendingCount, setPendingCount: setStorePendingCount } = useSuperAdminContextStore();
  const { socket } = useSocket();
  const navRef = useRef(null);


  useLayoutEffect(() => {
    const restore = () => {
      if (navRef.current && savedSuperAdminSidebarScrollTop > 0) {
        navRef.current.scrollTop = savedSuperAdminSidebarScrollTop;
      }
    };

    restore();

    const handle1 = requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });

    const timer1 = setTimeout(restore, 20);
    const timer2 = setTimeout(restore, 100);

    return () => {
      cancelAnimationFrame(handle1);
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [location.pathname, location.search]);

  const handleNavScroll = (e) => {
    if (e.currentTarget.scrollTop > 0) {
      savedSuperAdminSidebarScrollTop = e.currentTarget.scrollTop;
    }
  };

  const handleLinkClick = () => {
    if (navRef.current && navRef.current.scrollTop > 0) {
      savedSuperAdminSidebarScrollTop = navRef.current.scrollTop;
    }
    if (onClose) onClose();
  };

  const [pendingCount, setPendingCount] = useState(() => storePendingCount || 0);

  useEffect(() => {
    if (typeof storePendingCount === 'number') {
      setPendingCount(storePendingCount);
    }
  }, [storePendingCount]);

  useEffect(() => {
    const fetchPending = async () => {
      try {
        const res = await axiosClient.get('/saas/hospitals/pending');
        const list = res.data?.data || res.data || [];
        const count = Array.isArray(list) ? list.length : 0;
        setPendingCount(count);
        setStorePendingCount(count);
      } catch (err) {
        // fallback
        try {
          const res2 = await axiosClient.get('/saas/hospitals');
          const list2 = res2.data?.data || res2.data || [];
          const pending = list2.filter((h) => !h.isDeleted && (h.status === 'PENDING_APPROVAL' || h.status === 'PENDING')).length;
          setPendingCount(pending);
          setStorePendingCount(pending);
        } catch {}
      }
    };
    fetchPending();

    if (!socket) return;
    socket.on('saas:pending_changed', fetchPending);
    socket.on('workflow:notification', fetchPending);
    return () => {
      socket.off('saas:pending_changed', fetchPending);
      socket.off('workflow:notification', fetchPending);
    };
  }, [location.pathname, Boolean(socket)]);

  const menuItems = drilldownHospitalId
    ? HOSPITAL_DRILLDOWN_NAVIGATION(drilldownHospitalId)
    : SUPER_ADMIN_NAVIGATION;

  const isItemActive = (itemPath) => {
    const [itemPathname, itemSearch] = itemPath.split('?');
    const currentSearch = location.search.replace('?', '');
    if (itemSearch) {
      return location.pathname === itemPathname && currentSearch === itemSearch;
    }
    return location.pathname === itemPathname || location.pathname.startsWith(`${itemPathname}/`);
  };

  React.useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden" aria-hidden="true" />
      )}

      <aside
        className={`fixed lg:static top-0 bottom-0 left-0 z-50 w-64 h-full max-h-screen bg-white border-r border-slate-200 flex flex-col transition-transform duration-300 shadow-lg lg:shadow-none shrink-0 overflow-hidden ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="h-16 px-5 flex items-center justify-between gap-3 border-b border-slate-200 flex-shrink-0 bg-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 shadow-sm border border-slate-200 bg-white">
              <img src="/rwmlogo.jpeg" alt="Logo" className="w-full h-full object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
            </div>
            <div className="min-w-0">
              <span className="font-extrabold text-slate-800 text-sm tracking-tight leading-none block">Super Admin</span>
              <span className="text-[10px] text-slate-400 font-semibold tracking-wider uppercase">Platform Control</span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
            aria-label="Close sidebar"
          >
            <Icons.X size={20} />
          </button>
        </div>

        {drilldownHospitalId && (
          <div className="px-3 pt-3 pb-1 shrink-0">
            <div className="px-3 py-2.5 rounded-lg bg-violet-50 border border-violet-100 text-xs">
              <p className="text-violet-400 uppercase tracking-wider text-[10px] font-bold">Hospital Context</p>
              <p className="font-bold text-violet-700 mt-0.5 truncate text-sm">{selectedHospitalName || 'Hospital'}</p>
            </div>
          </div>
        )}

        <p className="px-4 pt-3 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest shrink-0">Navigation</p>

        <nav ref={navRef} onScroll={handleNavScroll} className="flex-1 min-h-0 px-3 pb-3 space-y-0.5 overflow-y-auto" aria-label="Super Admin navigation">
          {menuItems.filter(item => !item.hidden).map((item) => {
            const IconComponent = Icons[item.icon] || Icons.Circle;
            const active = isItemActive(item.path);
            const isAmber = item.highlight === 'amber';
            return (
              <Link
                key={item.path + (item.title || '')}
                to={item.path}
                onClick={handleLinkClick}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-150 border-l-2 ${
                  active
                    ? isAmber
                      ? 'bg-amber-50 text-amber-700 font-semibold border-l-amber-500'
                      : 'bg-violet-50 text-violet-700 font-semibold border-l-violet-500'
                    : isAmber
                      ? 'text-amber-700 hover:bg-amber-50 hover:text-amber-800 border-l-amber-300 bg-amber-50/40'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 border-l-transparent'
                }`}
              >
                <IconComponent size={16} className={`shrink-0 ${
                  active
                    ? isAmber ? 'text-amber-500' : 'text-violet-500'
                    : isAmber ? 'text-amber-500' : 'text-slate-400'
                }`} />
                <span className="truncate flex-1">{item.title}</span>
                {item.badgeKey === 'PENDING_HOSPITALS' && pendingCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-white shadow-xs shrink-0 animate-pulse">
                    {pendingCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 flex-shrink-0 bg-slate-50">
          <p className="text-[11px] text-slate-400 font-medium text-center">HPMBS Super Admin · Full Access</p>
        </div>
      </aside>
    </>
  );
};

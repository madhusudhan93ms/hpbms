import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useSuperAdminContextStore = create(
  persist(
    (set, get) => ({
      selectedHospitalId: null,
      selectedHospitalName: null,
      hospitals: [],
      hospitalDetails: {},
      platformMetrics: null,
      pendingApprovals: [],
      hospitalAdminsOverview: [],
      pendingCount: 0,
      hasLoadedHospitals: false,

      setSelectedHospital: (hospitalId, hospitalName = null) => {
        set({ selectedHospitalId: hospitalId, selectedHospitalName: hospitalName });
      },

      clearSelectedHospital: () => {
        set({ selectedHospitalId: null, selectedHospitalName: null });
      },

      setHospitals: (hospitals) => set({
        hospitals: Array.isArray(hospitals) ? hospitals : [],
        hasLoadedHospitals: true,
      }),

      addHospital: (newHospital) => {
        if (!newHospital || !newHospital._id) return;
        set((state) => {
          const exists = state.hospitals.some((h) => h._id === newHospital._id);
          const updated = exists
            ? state.hospitals.map((h) => (h._id === newHospital._id ? { ...h, ...newHospital } : h))
            : [newHospital, ...state.hospitals];
          return { hospitals: updated };
        });
      },

      updateHospital: (hospitalId, updates) => {
        set((state) => ({
          hospitals: state.hospitals.map((h) =>
            h._id === hospitalId ? { ...h, ...updates } : h
          ),
        }));
      },

      removeHospital: (hospitalId) => {
        set((state) => ({
          hospitals: state.hospitals.filter((h) => h._id !== hospitalId),
        }));
      },

      setHospitalDetail: (hospitalId, detail) => {
        if (!hospitalId || !detail) return;
        set((state) => ({
          hospitalDetails: {
            ...state.hospitalDetails,
            [hospitalId]: { data: detail, timestamp: Date.now() },
          },
        }));
      },

      updateHospitalDetail: (hospitalId, updater) => {
        if (!hospitalId) return;
        set((state) => {
          const current = state.hospitalDetails[hospitalId]?.data;
          if (!current) return state;
          const updatedData = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
          return {
            hospitalDetails: {
              ...state.hospitalDetails,
              [hospitalId]: { data: updatedData, timestamp: Date.now() },
            },
          };
        });
      },

      getHospitalDetail: (hospitalId) => {
        return get().hospitalDetails[hospitalId]?.data || null;
      },

      setPlatformMetrics: (platformMetrics) => set({ platformMetrics }),

      setPendingApprovals: (pendingApprovals) => {
        const list = Array.isArray(pendingApprovals) ? pendingApprovals : [];
        set({ pendingApprovals: list, pendingCount: list.length });
      },

      removePendingApproval: (hospitalId) => {
        set((state) => {
          const list = state.pendingApprovals.filter((h) => h._id !== hospitalId);
          return { pendingApprovals: list, pendingCount: list.length };
        });
      },

      setHospitalAdminsOverview: (hospitalAdminsOverview) => {
        set({ hospitalAdminsOverview: Array.isArray(hospitalAdminsOverview) ? hospitalAdminsOverview : [] });
      },

      setPendingCount: (pendingCount) => set({ pendingCount }),

      getContextHeader: () => {
        const { selectedHospitalId } = get();
        return selectedHospitalId || null;
      },
    }),
    {
      name: 'hpmbs_super_admin_context',
      partialize: (state) => ({
        selectedHospitalId: state.selectedHospitalId,
        selectedHospitalName: state.selectedHospitalName,
        hospitals: state.hospitals,
        hospitalDetails: state.hospitalDetails,
        platformMetrics: state.platformMetrics,
        pendingApprovals: state.pendingApprovals,
        hospitalAdminsOverview: state.hospitalAdminsOverview,
        pendingCount: state.pendingCount,
      }),
    }
  )
);

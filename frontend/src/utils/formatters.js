export const formatCurrency = (amount, symbol = '₹') => {
  if (amount === undefined || amount === null) return `${symbol}0.00`;
  return `${symbol}${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

/**
 * Same as formatDate but uses DD-Mon-YYYY (en-GB) style used in patient-facing views.
 * Consolidated from local declarations in PatientDashboard & PatientDetailsModal.
 */
export const formatDateGB = (dateVal) => {
  if (!dateVal) return '—';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};


export const formatDateTime = (dateString) => {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const getStatusBadgeStyle = (status) => {
  switch (status) {
    case 'ACTIVE':
    case 'COMPLETED':
    case 'PAID':
    case 'AVAILABLE':
    case 'RESOLVED':
    case 'DISPENSED':
      return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
    case 'PENDING':
    case 'WAITING':
    case 'UNPAID':
    case 'SCHEDULED':
    case 'PENDING_DISPENSE':
      return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
    case 'IN_CONSULTATION':
    case 'OCCUPIED':
    case 'EN_ROUTE':
    case 'RESPONDING':
      return 'bg-sky-500/10 text-sky-400 border-sky-500/30';
    case 'ESCALATED_L1':
    case 'ESCALATED_L2':
    case 'ESCALATED_L3':
    case 'CODE_BLUE':
    case 'EMERGENCY':
    case 'EXPIRED':
      return 'bg-red-500/20 text-red-400 border-red-500/50 animate-pulse';
    default:
      return 'bg-slate-800 text-slate-400 border-slate-700';
  }
};

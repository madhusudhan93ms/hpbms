import React from 'react';
import { Card } from './Card';

// Color map for icon containers — professional accent palette
const colorMap = {
  sky:     { bg: 'bg-sky-50',     text: 'text-sky-600',     border: 'border-sky-200'     },
  blue:    { bg: 'bg-blue-50',    text: 'text-blue-600',    border: 'border-blue-200'    },
  indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-600',  border: 'border-indigo-200'  },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200' },
  amber:   { bg: 'bg-amber-50',   text: 'text-amber-600',   border: 'border-amber-200'   },
  red:     { bg: 'bg-red-50',     text: 'text-red-600',     border: 'border-red-200'     },
  purple:  { bg: 'bg-purple-50',  text: 'text-purple-600',  border: 'border-purple-200'  },
  rose:    { bg: 'bg-rose-50',    text: 'text-rose-600',    border: 'border-rose-200'    },
  teal:    { bg: 'bg-teal-50',    text: 'text-teal-600',    border: 'border-teal-200'    },
  default: { bg: 'bg-slate-100',  text: 'text-slate-600',   border: 'border-slate-200'   },
};

export const StatCard = React.memo(({ title, value, subtitle, icon: Icon, color = 'default', trend, onClick, className = '' }) => {
  const scheme = colorMap[color] || colorMap.default;

  return (
    <Card
      interactive
      onClick={onClick}
      className={`${onClick ? 'cursor-pointer' : ''} ${className}`}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } } : undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">
            {title}
          </p>
          <h3 className="text-xl sm:text-2xl font-black text-slate-900 mt-1 tracking-tight leading-tight tabular-nums [overflow-wrap:anywhere]">
            {value}
          </h3>
          {subtitle && (
            <p className="text-xs text-slate-500 mt-1 truncate">{subtitle}</p>
          )}
        </div>
        {Icon && (
          <div className={`p-3 rounded-xl border flex-shrink-0 ${scheme.bg} ${scheme.text} ${scheme.border}`}>
            <Icon size={22} />
          </div>
        )}
      </div>

      {trend && (
        <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center gap-1.5 text-xs">
          <span className={`font-bold ${trend.isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
            {trend.isPositive ? '↑' : '↓'} {trend.value}
          </span>
          <span className="text-slate-400">{trend.label}</span>
        </div>
      )}
    </Card>
  );
});

StatCard.displayName = 'StatCard';

import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { useScrollLock } from '../../hooks/useScrollLock';
import { formatDateGB } from '../../utils/formatters';
import {
  X,
  User,
  Phone,
  Calendar,
  ShieldCheck,
  Copy,
  Check,
  Printer,
  Ticket,
  MapPin,
  HeartPulse,
  Activity,
  CreditCard,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';

export const PatientDetailsModal = ({
  isOpen,
  onClose,
  patient,
  onIssueToken = null,
  isQueued = false,
}) => {
  useScrollLock(isOpen);
  const [copied, setCopied] = useState(false);

  if (!isOpen || !patient) return null;

  // Thin wrapper: shared formatDateGB returns '—' for missing dates; map to 'Not Recorded' for UI consistency
  const formatDate = (dateVal) => {
    const result = formatDateGB(dateVal);
    if (result === '—') return dateVal ? 'Invalid Date' : 'Not Recorded';
    return result;
  };

  const formatIsoDob = (dateVal) => {
    if (!dateVal) return 'N/A';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return 'N/A';
    return d.toISOString().split('T')[0];
  };

  const handleCopyCredentials = () => {
    const text = `Hospital Patient Portal Login Details:\n• UHID: ${patient.uhid}\n• Name: ${patient.firstName} ${patient.lastName}\n• Registered Mobile: ${patient.phone}\n• DOB (Password): ${formatIsoDob(patient.dob)} (${formatDate(patient.dob)})\n• Portal Login Tab: Patient Login`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handlePrintSlip = () => {
    const printWindow = window.open('', '_blank', 'width=600,height=700');
    if (!printWindow) return;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Patient Registration Slip - ${patient.uhid}</title>
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 24px; color: #1e293b; }
            .header { text-align: center; border-bottom: 2px dashed #94a3b8; padding-bottom: 16px; margin-bottom: 20px; }
            .hospital-name { font-size: 20px; font-weight: bold; color: #4338ca; }
            .slip-title { font-size: 14px; color: #64748b; margin-top: 4px; }
            .uhid-box { background: #eef2ff; border: 1px solid #c7d2fe; padding: 12px; border-radius: 8px; text-align: center; margin-bottom: 20px; }
            .uhid-val { font-size: 22px; font-weight: 800; color: #3730a3; font-family: monospace; }
            .creds-card { background: #f8fafc; border: 1px solid #e2e8f0; padding: 16px; border-radius: 8px; margin-bottom: 20px; }
            .creds-title { font-size: 13px; font-weight: bold; color: #0f172a; margin-bottom: 8px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
            .row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; }
            .label { color: #64748b; font-weight: 500; }
            .val { font-weight: 600; color: #0f172a; }
            .dob-highlight { color: #4338ca; font-weight: 700; font-size: 14px; }
            .footer { text-align: center; font-size: 11px; color: #94a3b8; margin-top: 30px; border-top: 1px dashed #cbd5e1; padding-top: 12px; }
            @media print {
              body { padding: 0; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="hospital-name">HOSPITAL MANAGEMENT PORTAL</div>
            <div class="slip-title">Patient Identity &amp; Portal Access Card</div>
          </div>

          <div class="uhid-box">
            <div style="font-size: 11px; text-transform: uppercase; color: #6366f1; font-weight: bold;">Permanent Patient Identifier</div>
            <div class="uhid-val">${patient.uhid}</div>
          </div>

          <div class="creds-card">
            <div class="creds-title">PATIENT PORTAL LOGIN CREDENTIALS</div>
            <div class="row">
              <span class="label">Patient Name:</span>
              <span class="val">${patient.firstName} ${patient.lastName}</span>
            </div>
            <div class="row">
              <span class="label">Login Mobile Number:</span>
              <span class="val font-mono">${patient.phone}</span>
            </div>
            <div class="row">
              <span class="label">Date of Birth (Login Credential):</span>
              <span class="val dob-highlight">${formatDate(patient.dob)} (${formatIsoDob(patient.dob)})</span>
            </div>
            <div class="row">
              <span class="label">Age / Gender:</span>
              <span class="val">${patient.age ? `${patient.age} Yrs` : '—'} / ${patient.gender || '—'}</span>
            </div>
            <div class="row">
              <span class="label">Blood Group:</span>
              <span class="val">${patient.bloodGroup || '—'}</span>
            </div>
          </div>

          <div class="creds-card">
            <div class="creds-title">REGISTRATION &amp; CONTACT INFORMATION</div>
            <div class="row">
              <span class="label">Emergency / Guardian:</span>
              <span class="val">${patient.emergencyContact?.name || 'Self'} (${patient.emergencyContact?.phone || '—'})</span>
            </div>
            <div class="row">
              <span class="label">Registered Address:</span>
              <span class="val">${patient.address || '—'}, ${patient.city || ''}</span>
            </div>
            <div class="row">
              <span class="label">Registration Date:</span>
              <span class="val">${formatDate(patient.createdAt)}</span>
            </div>
          </div>

          <div class="footer">
            <p>Please keep this slip safe. Visit our patient portal to access your prescriptions, lab reports, and doctor tokens.</p>
          </div>

          <script>
            window.onload = function() {
              window.print();
            }
          </script>
        </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-indigo-600/30 border border-indigo-400/30 flex items-center justify-center text-indigo-300 shadow-inner">
              <User size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold text-white">
                  {patient.firstName} {patient.lastName}
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                  ACTIVE PATIENT
                </span>
              </div>
              <p className="text-xs text-slate-300 flex items-center gap-2 mt-0.5">
                <span className="font-mono text-indigo-300 font-bold">{patient.uhid}</span>
                <span>&bull;</span>
                <span>{patient.age ? `${patient.age} Yrs` : '—'}</span>
                <span>&bull;</span>
                <span>{patient.gender || '—'}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto space-y-5 text-slate-700 text-xs">
          {/* Key Patient Login Credentials Box */}
          <div className="bg-gradient-to-br from-indigo-50 via-white to-sky-50 rounded-xl p-4 border-2 border-indigo-200 shadow-xs relative">
            <div className="flex items-center justify-between mb-3 border-b border-indigo-100 pb-2">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded bg-indigo-600 text-white">
                  <ShieldCheck size={14} />
                </div>
                <h3 className="text-xs font-black tracking-wide uppercase text-indigo-900">
                  Patient Portal Login Credentials
                </h3>
              </div>
              <button
                onClick={handleCopyCredentials}
                className="flex items-center gap-1 text-[11px] font-bold text-indigo-700 bg-white px-2.5 py-1 rounded-md border border-indigo-200 hover:bg-indigo-50 shadow-2xs transition-all active:scale-95"
              >
                {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                {copied ? 'Copied to Clipboard!' : 'Copy Login Details'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {/* Mobile Number Box */}
              <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1">
                  <Phone size={12} className="text-indigo-600" /> Registered Mobile (Login ID)
                </p>
                <p className="text-sm font-mono font-black text-slate-900 mt-1">
                  {patient.phone || 'Not Available'}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">Use as Mobile on Patient Login</p>
              </div>

              {/* Date of Birth (DOB) Box */}
              <div className="bg-indigo-900 text-white p-3 rounded-lg border border-indigo-700 shadow-sm relative overflow-hidden">
                <div className="absolute right-2 -bottom-2 text-indigo-700 opacity-20 pointer-events-none">
                  <Calendar size={60} />
                </div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-200 flex items-center gap-1">
                  <Calendar size={12} className="text-indigo-300" /> Date of Birth (Password / DOB)
                </p>
                <p className="text-sm font-extrabold text-white mt-1">
                  {formatDate(patient.dob)}
                </p>
                <div className="flex items-center gap-1 text-[10px] text-indigo-200 font-mono mt-0.5">
                  <span>ISO Format:</span>
                  <span className="bg-indigo-800 px-1.5 py-0.2 rounded font-bold text-amber-300">
                    {formatIsoDob(patient.dob)}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-3 bg-indigo-100/60 p-2.5 rounded-lg text-[11px] text-indigo-900 flex items-start gap-2">
              <AlertCircle size={14} className="text-indigo-600 shrink-0 mt-0.5" />
              <div>
                <strong>How Patient Logs In:</strong> Go to the Login Page &rarr; Select the <strong>"Patient"</strong> tab &rarr; Enter Phone Number: <span className="font-mono font-bold">{patient.phone}</span> and select DOB: <span className="font-bold">{formatDate(patient.dob)}</span>.
              </div>
            </div>
          </div>

          {/* Medical & Demographic Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <h4 className="font-bold text-slate-900 flex items-center gap-1.5 pb-1 border-b border-slate-200 text-xs">
                <Activity size={14} className="text-teal-600" /> Medical &amp; Clinical Summary
              </h4>
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Chief Complaints:</span>
                  <span className="font-semibold text-amber-800 text-right">{patient.chiefComplaints || 'General OPD'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Blood Group:</span>
                  <span className="font-bold text-red-600">{patient.bloodGroup || 'Not Specified'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Patient Category:</span>
                  <span className="font-semibold text-slate-800">{patient.category || 'GENERAL'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Admission Status:</span>
                  <span className="font-semibold text-indigo-700">{patient.admissionStatus || 'NEVER_ADMITTED'}</span>
                </div>
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <h4 className="font-bold text-slate-900 flex items-center gap-1.5 pb-1 border-b border-slate-200 text-xs">
                <MapPin size={14} className="text-sky-600" /> Contact &amp; Emergency
              </h4>
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Emergency Contact:</span>
                  <span className="font-semibold text-slate-800">{patient.emergencyContact?.name || 'Self / N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Guardian Phone:</span>
                  <span className="font-mono font-semibold text-slate-800">{patient.emergencyContact?.phone || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Relation:</span>
                  <span className="font-semibold text-slate-800">{patient.emergencyContact?.relation || 'Family'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">City / Location:</span>
                  <span className="font-semibold text-slate-800">{patient.city || 'Main City'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handlePrintSlip}
            className="font-bold text-xs gap-1.5 text-slate-700 hover:bg-slate-100"
          >
            <Printer size={14} /> Print Patient Slip / ID Card
          </Button>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onClose}
              className="font-bold text-xs text-slate-600"
            >
              Close
            </Button>

            {onIssueToken && (
              <Button
                size="sm"
                variant="primary"
                disabled={isQueued}
                onClick={() => {
                  onClose();
                  onIssueToken(patient);
                }}
                className="font-bold text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
              >
                <Ticket size={14} />
                {isQueued ? 'In Queue Today' : 'Issue OPD Token'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PatientDetailsModal;

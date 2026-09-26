import React, { useState, useRef } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { axiosClient } from '../../api/axiosClient';
import { useScrollLock } from '../../hooks/useScrollLock';
import { X, UserPlus, CheckCircle, AlertCircle, Phone, MapPin, Users, UserCheck, Ticket, Calendar, ChevronDown, ChevronUp } from 'lucide-react';

export const RegisterPatientModal = ({ isOpen, onClose, onSuccess, onIssueToken }) => {
  useScrollLock(isOpen);
  const isSubmittingRef = useRef(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    age: '',
    gender: 'MALE',
    dob: '',
    phone: '',
    address: '',
    guardianName: '',
    guardianPhone: '',
    guardianRelationship: 'PARENT',
    chiefComplaints: '',
    bloodGroup: '',
    category: 'GENERAL',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [createdPatient, setCreatedPatient] = useState(null);
  const [error, setError] = useState(null);
  const [shouldIssueTokenImmediately, setShouldIssueTokenImmediately] = useState(false);

  const [duplicates, setDuplicates] = useState([]);
  const [showGuardianSection, setShowGuardianSection] = useState(false);
  const [isExactDuplicate, setIsExactDuplicate] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e, issueToken = false, force = false) => {
    if (e) e.preventDefault();
    if (isSubmittingRef.current || isLoading) return;
    if (!formData.firstName.trim()) {
      setError('Patient first name is required.');
      return;
    }
    isSubmittingRef.current = true;
    setIsLoading(true);
    setError(null);
    setDuplicates([]);
    setIsExactDuplicate(false);
    try {
      const response = await axiosClient.post('/patients', { ...formData, allowForce: force });
      const newPat = response.data;
      setCreatedPatient(newPat);
      if (onSuccess) onSuccess(newPat);

      if (issueToken) {
        onClose();
        if (onIssueToken) onIssueToken(newPat);
      }
    } catch (err) {
      const status = err.response?.status || err.status || err.statusCode;
      const respData = err.response?.data?.existingRecords || err.response?.data?.data || err.response?.data?.details || err.data;
      const isExact = Boolean(err.response?.data?.exactDuplicate || err.response?.data?.code === 'EXACT_DUPLICATE_FORBIDDEN');
      setIsExactDuplicate(isExact);

      if ((status === 409 || err.response?.data?.code === 'POSSIBLE_DUPLICATE' || err.response?.data?.possibleDuplicate || isExact) && Array.isArray(respData) && respData.length > 0) {
        setDuplicates(respData);
        if (isExact) {
          setError(`Exact Match Found: A patient with this Mobile Number and Date of Birth (${respData[0]?.firstName} ${respData[0]?.lastName}, UHID: ${respData[0]?.uhid}) is already registered.`);
        } else {
          setError('A patient with matching details already exists in this hospital database.');
        }
      } else {
        setError(err.response?.data?.message || err.response?.data?.error?.message || err.error?.message || 'Failed to register patient');
      }
    } finally {
      setIsLoading(false);
      isSubmittingRef.current = false;
    }
  };

  const handleReset = () => {
    setCreatedPatient(null);
    setFormData({
      firstName: '',
      lastName: '',
      age: '',
      gender: 'MALE',
      dob: '',
      phone: '',
      address: '',
      guardianName: '',
      guardianPhone: '',
      guardianRelationship: 'PARENT',
      chiefComplaints: '',
      bloodGroup: '',
      category: 'GENERAL',
    });
    setDuplicates([]);
    setIsExactDuplicate(false);
    setError(null);
    onClose();
  };

  return (
    <div className="modal-overlay animate-fade-in">
      <div className="modal-container max-w-2xl" onClick={(e) => e.stopPropagation()}>

        {/* Sticky Header */}
        <div className="modal-header">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex-shrink-0">
              <UserPlus size={20} />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 truncate">New Patient Intake &amp; Registration Form</h3>
              <p className="text-xs text-slate-500 mt-0.5">Fill in patient details to generate permanent hospital record and UHID.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-block text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
              UHID AUTO-GEN
            </span>
            <button onClick={handleReset} className="modal-close-btn" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="modal-body">
          {createdPatient ? (
            <div className="text-center space-y-4 py-4">
              <div className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-200">
                <CheckCircle size={30} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">Patient Registered Successfully!</h3>
                <p className="text-xs text-slate-500 mt-0.5">Permanent record and UHID have been created in the hospital database.</p>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-left text-xs space-y-2.5">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <span className="text-slate-500 font-medium">Assigned UHID:</span>
                  <span className="font-mono font-black text-indigo-700 text-base tracking-wider">{createdPatient.uhid}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500">Patient Name:</span>
                    <p className="font-bold text-slate-900">{createdPatient.firstName} {createdPatient.lastName}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Mobile Phone:</span>
                    <p className="font-bold text-slate-900 font-mono">{createdPatient.phone}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Age &amp; Gender:</span>
                    <p className="font-medium text-slate-800">{createdPatient.age ? `${createdPatient.age} Yrs` : 'N/A'} &bull; {createdPatient.gender}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Date of Birth:</span>
                    <p className="font-medium text-slate-800">{createdPatient.dob ? new Date(createdPatient.dob).toLocaleDateString() : 'N/A'}</p>
                  </div>
                </div>

                <div className="pt-2 mt-2 border-t border-slate-200 space-y-1 bg-indigo-50/70 p-2.5 rounded-lg border border-indigo-100 font-mono text-[11px]">
                  <p className="font-bold text-indigo-900 font-sans">Patient Portal Credentials:</p>
                  <p className="text-indigo-800">Login ID: <strong>{createdPatient.phone}</strong> &bull; Password: <strong>{createdPatient.dob ? new Date(createdPatient.dob).toLocaleDateString() : 'DOB'}</strong></p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
                <Button variant="outline" className="w-full font-bold text-xs" onClick={handleReset}>
                  Close &amp; View in Roster
                </Button>
                {onIssueToken && (
                  <Button
                    variant="primary"
                    className="w-full font-bold text-xs bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5 shadow-sm"
                    onClick={() => {
                      const pat = createdPatient;
                      handleReset();
                      onIssueToken(pat);
                    }}
                  >
                    <Ticket size={14} /> Issue OPD Queue Token Now
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => handleSubmit(e, shouldIssueTokenImmediately)} autoComplete="off" className="space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                  <AlertCircle size={15} className="shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {duplicates.length > 0 && (
                <div className={`p-3.5 rounded-xl border space-y-2.5 text-xs ${
                  isExactDuplicate ? 'bg-rose-50 border-rose-300' : 'bg-amber-50 border-amber-300'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className={`font-bold flex items-center gap-1.5 ${
                      isExactDuplicate ? 'text-rose-900' : 'text-amber-900'
                    }`}>
                      <AlertCircle size={14} className={isExactDuplicate ? 'text-rose-600' : 'text-amber-600'} />
                      {isExactDuplicate ? 'Exact Existing Record Found (Same Phone & DOB)' : `Existing Record Found (${duplicates.length})`}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      isExactDuplicate ? 'bg-rose-200 text-rose-900' : 'bg-amber-200 text-amber-900'
                    }`}>
                      {isExactDuplicate ? 'DUPLICATE FORBIDDEN' : 'MATCH'}
                    </span>
                  </div>
                  {duplicates.map((dup) => (
                    <div key={dup._id} className="p-2.5 bg-white rounded-lg border border-slate-200 flex items-center justify-between gap-3 shadow-2xs">
                      <div>
                        <p className="font-bold text-slate-900">{dup.firstName} {dup.lastName} <span className="font-mono text-indigo-700 font-black">({dup.uhid})</span></p>
                        <p className="text-[10px] text-slate-500">Phone: {dup.phone} &bull; DOB: {dup.dob ? new Date(dup.dob).toLocaleDateString() : 'N/A'}</p>
                      </div>
                      {onIssueToken && (
                        <Button
                          size="sm"
                          type="button"
                          variant="primary"
                          className="text-xs py-1 px-3 font-bold bg-indigo-600 hover:bg-indigo-700 text-white gap-1"
                          onClick={() => {
                            onClose();
                            onIssueToken(dup);
                          }}
                        >
                          <Ticket size={12} /> Use Patient &amp; Token
                        </Button>
                      )}
                    </div>
                  ))}
                  {!isExactDuplicate && (
                    <div className="pt-2 border-t border-amber-200 flex items-center justify-between">
                      <p className="text-[11px] text-amber-800">Different family member with same mobile?</p>
                      <Button
                        size="sm"
                        type="button"
                        variant="primary"
                        className="text-xs bg-amber-700 hover:bg-amber-800 text-white font-bold py-1 px-3"
                        onClick={(e) => handleSubmit(e, shouldIssueTokenImmediately, true)}
                      >
                        Confirm &amp; Register Anyway
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* 1. Name Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="First Name *"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  required
                  placeholder="Enter first name"
                />
                <Input
                  label="Last Name (Optional)"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                  placeholder="Enter last name (optional)"
                />
              </div>

              {/* 2. Demographics Row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1.5 uppercase tracking-wider">Gender *</label>
                  <select
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 font-medium focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
                  >
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>

                <Input
                  label="Age (Years) (Optional)"
                  type="number"
                  value={formData.age}
                  onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                  placeholder="Age (Years)"
                />

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1.5 uppercase tracking-wider">Blood Group (Optional)</label>
                  <select
                    value={formData.bloodGroup}
                    onChange={(e) => setFormData({ ...formData, bloodGroup: e.target.value })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 font-medium focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
                  >
                    <option value="">Select Blood Group (Optional)</option>
                    {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => (
                      <option key={bg} value={bg}>{bg}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 3. Phone & DOB Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Mobile / Phone Number (Optional)"
                  icon={Phone}
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="+91 XXXXX XXXXX (optional)"
                />
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1.5 uppercase tracking-wider">
                    Date of Birth (Optional)
                  </label>
                  <input
                    type="date"
                    value={formData.dob || ''}
                    onChange={(e) => {
                      const dobVal = e.target.value;
                      let calculatedAge = formData.age;
                      if (dobVal) {
                        const birthDate = new Date(dobVal);
                        const today = new Date();
                        let age = today.getFullYear() - birthDate.getFullYear();
                        const m = today.getMonth() - birthDate.getMonth();
                        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
                          age--;
                        }
                        if (age >= 0) calculatedAge = String(age);
                      }
                      setFormData({ ...formData, dob: dobVal, age: calculatedAge });
                    }}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 font-medium focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Used for Patient Portal login (Mobile + DOB) &amp; family member matching.
                  </p>
                </div>
              </div>

              {/* Family Accounts Info Notice */}
              <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-100 text-xs text-indigo-900 flex items-start gap-2.5">
                <Users size={16} className="text-indigo-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Family &amp; Children Accounts Supported</p>
                  <p className="text-[11px] text-indigo-700">Multiple family members can share a mobile number. Each gets a distinct record and UHID based on their Date of Birth.</p>
                </div>
              </div>

              {/* 4. Address */}
              <Input
                label="Residential Address"
                icon={MapPin}
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Street address, city, area"
              />

              {/* 5. Chief Complaints */}
              <Input
                label="Chief Complaints / Reason for Visit"
                value={formData.chiefComplaints}
                onChange={(e) => setFormData({ ...formData, chiefComplaints: e.target.value })}
                placeholder="e.g. Fever, Headache, Routine OPD Consultation"
              />

              {/* 6. Optional Guardian Information */}
              <div className="pt-0.5">
                <button
                  type="button"
                  onClick={() => setShowGuardianSection(!showGuardianSection)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/80 px-3 py-1.5 rounded-lg transition-all"
                >
                  {showGuardianSection ? (
                    <>
                      <ChevronUp size={14} /> Show Less (Hide Guardian Details)
                    </>
                  ) : (
                    <>
                      <ChevronDown size={14} /> Show More &bull; Guardian Details (Optional)
                    </>
                  )}
                </button>

                {showGuardianSection && (
                  <div className="mt-2.5 p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wider">
                        <UserCheck size={15} className="text-indigo-600" />
                        Guardian / Attendant Information
                      </h4>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                        OPTIONAL
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <Input
                        label="Guardian / Relative Name (Optional)"
                        value={formData.guardianName}
                        onChange={(e) => setFormData({ ...formData, guardianName: e.target.value })}
                        placeholder="Guardian Name (Optional)"
                      />
                      <Input
                        label="Guardian Mobile Number (Optional)"
                        icon={Phone}
                        value={formData.guardianPhone}
                        onChange={(e) => setFormData({ ...formData, guardianPhone: e.target.value })}
                        placeholder="+91 XXXXX XXXXX"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Submit Buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-slate-200">
                <Button
                  type="submit"
                  variant="outline"
                  className="w-full font-bold text-xs border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                  isLoading={isLoading && !shouldIssueTokenImmediately}
                  onClick={() => setShouldIssueTokenImmediately(false)}
                >
                  Register &amp; Save Patient Record
                </Button>

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full font-bold text-xs bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5 shadow-sm"
                  isLoading={isLoading && shouldIssueTokenImmediately}
                  onClick={() => setShouldIssueTokenImmediately(true)}
                >
                  <Ticket size={14} /> Register &amp; Issue OPD Token
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Lock, CheckCircle2, ShieldAlert, ArrowRight } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PasswordInput } from '../../components/ui/PasswordInput';
import { axiosClient } from '../../api/axiosClient';

export const ResetPasswordPage = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token) {
      setErrorMessage('Missing password reset token. Please request a new link.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const res = await axiosClient.post('/auth/reset-password', {
        token,
        newPassword: newPassword.trim(),
      });
      // axiosClient interceptor already unwraps response.data, so the shape is
      // { success, message, data } — NOT { data: { message } }
      setSuccessMessage(res.message || res.data?.message || 'Password reset successfully. You can now log in.');
      // Auto-redirect to login after 3 seconds
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setErrorMessage(err.error?.message || err.response?.data?.message || 'Invalid or expired password reset token. Please request a new reset link.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 space-y-6 shadow-2xl rounded-3xl border border-slate-800">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Lock size={32} />
          </div>
        </div>

        <div className="text-center">
          <h2 className="text-2xl font-extrabold text-white tracking-tight">Create New Password</h2>
          <p className="text-xs text-slate-400 mt-1">Set a secure new password for your account</p>
        </div>

        {successMessage ? (
          <div className="space-y-4 animate-fade-in text-center">
            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold flex items-center gap-3">
              <CheckCircle2 size={24} className="shrink-0 text-emerald-400" />
              <div className="text-left">
                <p className="text-sm font-bold">Password Reset Complete!</p>
                <p className="text-[11px] font-normal mt-0.5 text-emerald-300">{successMessage}</p>
              </div>
            </div>
            <Button
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2"
              onClick={() => navigate('/login')}
            >
              Proceed to Login <ArrowRight size={16} />
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {errorMessage && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold flex items-center gap-2">
                <ShieldAlert size={16} className="shrink-0" />
                {errorMessage}
              </div>
            )}

            <PasswordInput
              label="New Password"
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              inputClassName="bg-slate-800 border-slate-700 rounded-xl text-xs text-white focus:ring-indigo-500 font-medium py-2.5 placeholder:text-slate-500"
              labelClassName="text-slate-300"
              buttonClassName="text-slate-400 hover:text-indigo-400 focus:text-indigo-400"
              required
            />

            <PasswordInput
              label="Confirm New Password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              inputClassName="bg-slate-800 border-slate-700 rounded-xl text-xs text-white focus:ring-indigo-500 font-medium py-2.5 placeholder:text-slate-500"
              labelClassName="text-slate-300"
              buttonClassName="text-slate-400 hover:text-indigo-400 focus:text-indigo-400"
              required
            />

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl shadow-lg"
            >
              {isLoading ? 'Updating Password...' : 'Save New Password'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
};

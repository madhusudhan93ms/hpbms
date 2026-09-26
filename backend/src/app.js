import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { apiRateLimiter } from './middleware/rateLimiter.js';
import { errorHandler } from './middleware/errorHandler.js';
import { tenantModelContextMiddleware } from './config/tenantModelContext.js';

import authRoutes from './domains/auth/auth.routes.js';
import setupRoutes from './domains/setup/setup.routes.js';
import saasRoutes from './domains/saas/saas.routes.js';
import patientRoutes from './domains/patients/patients.routes.js';
import appointmentRoutes from './domains/appointments/appointments.routes.js';
import emrRoutes from './domains/emr/emr.routes.js';
import bedRoutes from './domains/beds/beds.routes.js';
import requestRoutes from './domains/requests/requests.routes.js';
import billingRoutes from './domains/billing/billing.routes.js';
import diagnosticRoutes from './domains/diagnostics/diagnostics.routes.js';
import admissionRoutes from './domains/admissions/admissions.routes.js';
import emergencyRoutes from './domains/emergency/emergency.routes.js';
import patientPortalRoutes from './domains/patient-portal/patient-portal.routes.js';
import guardianPortalRoutes from './domains/guardian-portal/guardian-portal.routes.js';
import doctorUpdatesRoutes from './domains/doctor-updates/doctor-updates.routes.js';
import workflowRoutes from './domains/workflow/workflow.routes.js';
import pharmacyRoutes from './domains/pharmacy/pharmacy.routes.js';
import notificationRoutes from './domains/notifications/notification.routes.js';
import hospitalAdminRoutes from './domains/auth/hospital-admin.routes.js';
import chatRoutes from './domains/chat/chat.routes.js';

import { SaasService } from './domains/saas/saas.service.js';

const app = express();

app.set('trust proxy', 1);
app.use(tenantModelContextMiddleware);
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  })
);
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Global Rate Limiter
app.use('/api/', apiRateLimiter);

// Root Endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'UP',
    name: 'Hospital Billing and Management System (HPMBS) Backend API',
    version: '1.0.0',
    documentation: 'All API routes are mounted under /api/v1/',
    healthCheck: '/api/v1/health',
    timestamp: new Date().toISOString(),
  });
});

// Health Check Endpoint
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    system: 'HPMBS Multi-Tenant SaaS Gateway',
    timestamp: new Date().toISOString(),
  });
});

// Domain Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/setup', setupRoutes);
app.use('/api/v1/saas', saasRoutes);
app.use('/api/v1/patients', patientRoutes);
app.use('/api/v1/appointments', appointmentRoutes);
app.use('/api/v1/emr', emrRoutes);
app.use('/api/v1/beds', bedRoutes);
app.use('/api/v1/requests', requestRoutes);
app.use('/api/v1/billing', billingRoutes);
app.use('/api/v1/diagnostics', diagnosticRoutes);
app.use('/api/v1/admissions', admissionRoutes);
app.use('/api/v1/emergency', emergencyRoutes);
app.use('/api/v1/patient-portal', patientPortalRoutes);
app.use('/api/v1/guardian-portal', guardianPortalRoutes);
app.use('/api/v1/doctor-updates', doctorUpdatesRoutes);
app.use('/api/v1/workflow', workflowRoutes);
app.use('/api/v1/pharmacy', pharmacyRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/hospital-admin', hospitalAdminRoutes);
app.use('/api/v1/chat', chatRoutes);

// Automated Trial & Subscription Expiry Background Evaluator (Runs every 10 minutes)
const subscriptionEvaluatorInterval = setInterval(() => {
  SaasService.evaluateHospitalTrials().catch((err) =>
    console.error('Error running trial evaluator task:', err)
  );
  SaasService.evaluateSubscriptionExpiry().catch((err) =>
    console.error('Error running subscription expiry task:', err)
  );
}, 10 * 60 * 1000);
subscriptionEvaluatorInterval.unref?.();

// Run initial check on server boot after 10s delay
const initialSubscriptionEvaluation = setTimeout(() => {
  SaasService.evaluateHospitalTrials().catch(() => {});
  SaasService.evaluateSubscriptionExpiry().catch(() => {});
}, 10000);
initialSubscriptionEvaluation.unref?.();

// Global Error Handler
app.use(errorHandler);

export default app;
// Server reloaded: 2026-08-06


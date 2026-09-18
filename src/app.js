import express from 'express';
import cors from 'cors';

import requireAuth from './middleware/requireAuth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

import authRoutes from './routes/auth.js';
import unitRoutes from './routes/units.js';
import employeeRoutes from './routes/employees.js';
import leaveRoutes from './routes/leaves.js';
import ruleRoutes from './routes/rules.js';
import scheduleRoutes from './routes/schedules.js';
import { adminShareRouter, publicRouter } from './routes/share.js';

export function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? '*' }));
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRoutes);

  // Auth gerektirmeyen salt-okunur paylaşım görünümü.
  app.use('/api/public', publicRouter);

  // Bu noktadan sonrası yalnızca geçerli JWT ile.
  app.use('/api/admin', requireAuth);
  app.use('/api/admin/units', unitRoutes);
  app.use('/api/admin/employees', employeeRoutes);
  app.use('/api/admin/leaves', leaveRoutes);
  app.use('/api/admin/rules', ruleRoutes);
  app.use('/api/admin/share-links', adminShareRouter);
  app.use('/api/admin', scheduleRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;

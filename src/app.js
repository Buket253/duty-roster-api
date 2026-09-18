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

  // Kök adres: tarayıcıdan bakıldığında uç noktaları görünür kılar.
  app.get('/', (req, res) =>
    res.json({
      name: 'Nöbet Sistemi API',
      notlar: [
        '/api/admin/* uç noktaları Authorization: Bearer <token> ister.',
        'Token için: POST /api/auth/login',
      ],
      endpoints: {
        auth: ['POST /api/auth/login'],
        units: [
          'GET /api/admin/units',
          'POST /api/admin/units',
          'PUT /api/admin/units/:id',
          'DELETE /api/admin/units/:id',
        ],
        employees: [
          'GET /api/admin/employees?unit=:unitId',
          'POST /api/admin/employees',
          'PUT /api/admin/employees/:id',
          'DELETE /api/admin/employees/:id',
        ],
        leaves: [
          'GET /api/admin/leaves?employee=:id',
          'POST /api/admin/leaves',
          'DELETE /api/admin/leaves/:id',
        ],
        rules: ['GET /api/admin/rules/:unitId', 'PUT /api/admin/rules/:unitId'],
        schedules: [
          'GET /api/admin/schedules/:unitId/:year/:month',
          'POST /api/admin/schedules/:unitId/:year/:month/generate',
          'POST /api/admin/schedules/:scheduleId/publish',
          'GET /api/admin/assignments/:assignmentId/candidates',
          'PUT /api/admin/assignments/:assignmentId',
        ],
        share: ['GET /api/admin/share-links/:unitId', 'GET /api/public/:token/:year/:month'],
        health: ['GET /api/health'],
      },
    })
  );

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

import { Router } from 'express';
import { getShareLink, publicSchedule } from '../controllers/shareController.js';

export const adminShareRouter = Router();
adminShareRouter.get('/:unitId', getShareLink);

export const publicRouter = Router();
publicRouter.get('/:token/:year/:month', publicSchedule);

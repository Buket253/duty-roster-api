import { Router } from 'express';
import {
  getSchedule,
  generate,
  publish,
  updateAssignment,
  assignmentCandidates,
} from '../controllers/scheduleController.js';

const router = Router();

router.get('/schedules/:unitId/:year/:month', getSchedule);
router.post('/schedules/:unitId/:year/:month/generate', generate);
router.post('/schedules/:scheduleId/publish', publish);
router.get('/assignments/:assignmentId/candidates', assignmentCandidates);
router.put('/assignments/:assignmentId', updateAssignment);

export default router;

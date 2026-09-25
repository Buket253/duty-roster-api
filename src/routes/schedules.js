import { Router } from 'express';
import {
  getSchedule,
  generate,
  createBlank,
  publish,
  updateAssignment,
  addAssignment,
  removeAssignment,
  assignmentCandidates,
  slotCandidates,
  scheduleArchives,
  restoreSchedule,
} from '../controllers/scheduleController.js';

const router = Router();

router.get('/schedules/:unitId/:year/:month', getSchedule);
router.post('/schedules/:unitId/:year/:month/generate', generate);
router.post('/schedules/:unitId/:year/:month/blank', createBlank);
router.get('/schedules/:unitId/:year/:month/archives', scheduleArchives);
router.post('/schedules/:unitId/:year/:month/restore/:archiveId', restoreSchedule);
router.post('/schedules/:scheduleId/publish', publish);
router.get('/schedules/:unitId/:year/:month/candidates', slotCandidates);
router.get('/assignments/:assignmentId/candidates', assignmentCandidates);
router.put('/assignments/:assignmentId', updateAssignment);
router.post('/schedules/:unitId/:year/:month/assignments', addAssignment);
router.delete('/assignments/:assignmentId', removeAssignment);

export default router;

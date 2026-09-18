import { Router } from 'express';
import { listLeaves, createLeave, deleteLeave } from '../controllers/leaveController.js';

const router = Router();
router.get('/', listLeaves);
router.post('/', createLeave);
router.delete('/:id', deleteLeave);

export default router;

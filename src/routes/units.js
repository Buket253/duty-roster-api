import { Router } from 'express';
import { listUnits, createUnit, updateUnit, deleteUnit } from '../controllers/unitController.js';

const router = Router();
router.get('/', listUnits);
router.post('/', createUnit);
router.put('/:id', updateUnit);
router.delete('/:id', deleteUnit);

export default router;

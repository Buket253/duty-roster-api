import { Router } from 'express';
import { getRule, updateRule } from '../controllers/ruleController.js';

const router = Router();
router.get('/:unitId', getRule);
router.put('/:unitId', updateRule);

export default router;

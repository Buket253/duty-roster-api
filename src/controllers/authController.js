import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import Admin from '../models/Admin.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest } from '../utils/HttpError.js';

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) throw badRequest('E-posta ve şifre zorunlu');

  const admin = await Admin.findOne({ email: String(email).toLowerCase().trim() });
  const ok = admin && (await bcrypt.compare(password, admin.passwordHash));
  if (!ok) return res.status(401).json({ error: 'E-posta veya şifre hatalı' });

  const token = jwt.sign({ sub: String(admin._id), email: admin.email }, process.env.JWT_SECRET, {
    expiresIn: '12h',
  });

  res.json({ token });
});

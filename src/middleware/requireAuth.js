import jwt from 'jsonwebtoken';

/** Authorization: Bearer <token> header'ını doğrular; /api/admin/* için zorunlu. */
export function requireAuth(req, res, next) {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Yetkilendirme gerekli' });
  }

  try {
    req.admin = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Geçersiz veya süresi dolmuş oturum' });
  }
}

export default requireAuth;

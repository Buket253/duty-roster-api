export function notFoundHandler(req, res) {
  res.status(404).json({
    error: `Uç nokta bulunamadı: ${req.method} ${req.originalUrl}`,
    ipucu: 'Uç nokta listesi için GET /',
  });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.status ?? (err.name === 'ValidationError' || err.name === 'CastError' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Sunucu hatası' });
}

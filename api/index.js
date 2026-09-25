import 'dotenv/config';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';

/**
 * Vercel giriş noktası. src/server.js dinleyen bir süreç başlatır; sunucusuz
 * ortamda böyle bir süreç yok, platform her istek için bu handler'ı çağırır.
 * Yerel geliştirme yine `npm run dev` ile server.js üzerinden yürür.
 */

const { MONGODB_URI, JWT_SECRET } = process.env;

if (!MONGODB_URI || !JWT_SECRET) {
  throw new Error(
    'MONGODB_URI ve JWT_SECRET ortam değişkenleri tanımlı olmalı ' +
      '(Vercel > Project > Settings > Environment Variables)'
  );
}

/**
 * Aynı kap (container) birçok isteğe hizmet ettiği için bağlantı bir kez kurulup
 * sonraki çağrılarda yeniden kullanılır — her istekte yeniden bağlanmak Atlas
 * bağlantı havuzunu kısa sürede tüketir. Söz (promise) globalThis'te durur,
 * çünkü modül önbelleği sıcak başlatmalar arasında sıfırlanabiliyor.
 */
async function baglantiyiHazirla() {
  if (mongoose.connection.readyState === 1) return;

  globalThis.__mongoBaglantisi ??= mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
  });

  try {
    await globalThis.__mongoBaglantisi;
  } catch (err) {
    // Başarısız söz önbellekte kalırsa kap ömrü boyunca her istek aynı hatayı
    // alır; temizleyip bir sonraki isteğin yeniden denemesine izin veriyoruz.
    globalThis.__mongoBaglantisi = undefined;
    throw err;
  }
}

const app = createApp();

export default async function handler(req, res) {
  try {
    await baglantiyiHazirla();
  } catch (err) {
    console.error('MongoDB bağlantısı kurulamadı:', err);
    res.status(503).json({ error: 'Veritabanına bağlanılamadı' });
    return;
  }

  return app(req, res);
}

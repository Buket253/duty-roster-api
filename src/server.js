import 'dotenv/config';
import mongoose from 'mongoose';
import { createApp } from './app.js';

const { MONGODB_URI, JWT_SECRET, PORT = 4000 } = process.env;

if (!MONGODB_URI || !JWT_SECRET) {
  console.error('MONGODB_URI ve JWT_SECRET tanımlı olmalı (.env dosyasına bakın)');
  process.exit(1);
}

await mongoose.connect(MONGODB_URI);
console.log('MongoDB bağlantısı kuruldu');

createApp().listen(PORT, () => console.log(`API http://localhost:${PORT} adresinde`));

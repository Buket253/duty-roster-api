import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import Admin from '../src/models/Admin.js';
import Unit from '../src/models/Unit.js';
import Employee from '../src/models/Employee.js';
import LeaveRequest from '../src/models/LeaveRequest.js';
import ShiftRule from '../src/models/ShiftRule.js';

const run = promisify(execFile);
let mongod;

before(async () => {
  mongod = await MongoMemoryServer.create();
});

after(async () => {
  await mongoose.disconnect();
  await mongod?.stop();
});

test('seed script örnek veriyi oluşturuyor', async () => {
  const env = {
    ...process.env,
    MONGODB_URI: mongod.getUri(),
    SEED_ADMIN_EMAIL: 'admin@hastane.local',
    SEED_ADMIN_PASSWORD: 'Nobet2025!',
    SEED_YEAR: '2026',
  };
  const { stdout } = await run('node', ['src/scripts/seed.js'], { env });
  assert.match(stdout, /Seed tamamlandı/);

  await mongoose.connect(mongod.getUri());
  assert.equal(await Admin.countDocuments(), 1);

  const unit = await Unit.findOne();
  assert.equal(unit.name, 'Nöroloji Yoğun Bakım');
  assert.deepEqual(unit.shiftTypes, ['nobet-24', 'mesai-8']);

  assert.equal(await Employee.countDocuments({ unit: unit._id }), 9);
  assert.equal(await LeaveRequest.countDocuments(), 2);

  // Üç personel tipi de örnek veride bulunmalı.
  assert.equal(await Employee.countDocuments({ unit: unit._id, staffType: 'sorumlu' }), 1);
  assert.equal(await Employee.countDocuments({ unit: unit._id, staffType: 'sadece-gunduz' }), 1);
  assert.equal(await Employee.countDocuments({ unit: unit._id, canTakeDuty: false }), 1);

  const rule = await ShiftRule.findOne({ unit: unit._id });
  assert.equal(rule.maxDutiesPerMonth, 7);
  assert.equal(rule.weekdayDayStaff, 5);
  assert.equal(rule.weekendDayStaff, 0);
});

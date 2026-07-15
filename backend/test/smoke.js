require('reflect-metadata');

const assert = require('node:assert/strict');
const { validateSync } = require('class-validator');
const {
  ParsePostgresUuidPipe,
} = require('../dist/common/pipes/parse-postgres-uuid.pipe');
const { QueryDeviceDto } = require('../dist/modules/device/dto/device.dto');
const { QueryRecordDto } = require('../dist/modules/record/dto/record.dto');
const { QueryAlertDto } = require('../dist/modules/alert/dto/alert.dto');
const { DateRangeQueryDto } = require('../dist/modules/stats/dto/stats.dto');
const { QueryTaskDto } = require('../dist/modules/task/dto/task.dto');
const { UploadPhotoMetaDto } = require('../dist/modules/upload/dto/upload.dto');
const { AnalyzeDto } = require('../dist/modules/ai/dto/ai.dto');
const { RecordService } = require('../dist/modules/record/record.service');
const { TemplateService } = require('../dist/modules/template/template.service');
const { configureApp } = require('../dist/bootstrap');

const seededUuid = '11111111-1111-1111-1111-111111111111';
const otherSeededUuid = '33333333-3333-3333-3333-333333333333';

function validateSeededIds() {
  const pipe = new ParsePostgresUuidPipe();
  assert.equal(pipe.transform(seededUuid), seededUuid);
  assert.throws(() => pipe.transform('not-a-uuid'));

  const cases = [
    [QueryDeviceDto, { siteId: seededUuid }],
    [QueryRecordDto, { siteId: seededUuid, deviceId: otherSeededUuid }],
    [QueryAlertDto, { siteId: seededUuid }],
    [DateRangeQueryDto, { siteId: seededUuid, inspectorId: otherSeededUuid }],
    [QueryTaskDto, { siteId: seededUuid, inspectorId: otherSeededUuid }],
    [UploadPhotoMetaDto, { taskId: seededUuid }],
    [AnalyzeDto, { recordId: seededUuid, templateEntryId: 'entry-1', photoUrl: 'x' }],
  ];

  for (const [Dto, values] of cases) {
    const dto = Object.assign(new Dto(), values);
    assert.deepEqual(validateSync(dto), [], `${Dto.name} should accept PostgreSQL UUIDs`);
  }
}

async function validateCorsPolicy() {
  let corsOptions;
  const app = {
    setGlobalPrefix() {},
    enableCors(options) {
      corsOptions = options;
    },
    useGlobalPipes() {},
  };
  configureApp(app);

  const check = (origin) =>
    new Promise((resolve, reject) => {
      corsOptions.origin(origin, (error, allowed) => {
        if (error) reject(error);
        else resolve(allowed);
      });
    });
  assert.equal(await check('https://cursor-fdz-pc.vercel.app'), true);
  assert.equal(await check('https://example.invalid'), false);
}

async function validateManualAuditFlow() {
  const task = {
    id: seededUuid,
    siteId: otherSeededUuid,
    deviceId: '55555555-5555-5555-5555-555555555551',
    inspectorId: '22222222-2222-2222-2222-222222222222',
    taskName: 'manual audit smoke',
    status: 'in_progress',
    aiEnabled: false,
    templateSnapshot: [
      { id: 'entry-1', name: 'photo', isRequired: true, samplePhotos: [], checkType: 'photo' },
    ],
  };
  const record = {
    id: otherSeededUuid,
    taskId: task.id,
    deviceType: 'string_inverter',
    entries: [
      {
        templateEntryId: 'entry-1',
        photos: ['https://example.com/test.jpg'],
        aiResult: { status: 'pending', confidence: 0, reason: '' },
        manualResult: 'pending',
        finalResult: null,
        remark: '',
      },
    ],
    status: 'draft',
    auditTrail: [],
    submittedAt: null,
    rejectReason: null,
    createdAt: new Date(),
  };
  const recordRepo = {
    findOne: async () => record,
    save: async (value) => value,
  };
  const taskRepo = {
    findOne: async () => task,
    save: async (value) => value,
  };
  const service = new RecordService(recordRepo, taskRepo, {});
  const user = {
    id: seededUuid,
    username: 'admin',
    realName: 'Admin',
    role: 'super_admin',
    roles: ['super_admin'],
    managedSiteIds: [],
    memberSiteIds: [],
  };

  const result = await service.submit(record.id, {}, user);
  assert.equal(result.status, 'submitted');
  assert.equal(result.task.status, 'submitted');
  assert.equal(result.needsAudit, true);
  assert.match(result.auditTrail[0].summary, /人工审核/);
}

async function validateTemplateScopeUpdate() {
  const template = {
    id: seededUuid,
    name: 'global',
    deviceType: 'string_inverter',
    entries: [],
    isGlobal: true,
    siteId: null,
    version: 1,
    createdAt: new Date(),
  };
  const templateRepo = {
    findOne: async () => template,
    save: async (value) => value,
  };
  const siteRepo = {
    findOne: async () => ({ id: otherSeededUuid, status: 'active', deletedAt: null }),
  };
  const service = new TemplateService(templateRepo, siteRepo);
  const admin = { role: 'super_admin', managedSiteIds: [], memberSiteIds: [] };
  const result = await service.update(
    template.id,
    { isGlobal: false, siteId: otherSeededUuid },
    admin,
  );
  assert.equal(result.isGlobal, false);
  assert.equal(result.siteId, otherSeededUuid);
  assert.equal(result.version, 2);
}

async function validateAiErrorFallsBackToAudit() {
  const task = {
    id: seededUuid,
    siteId: otherSeededUuid,
    status: 'submitted',
    aiEnabled: true,
  };
  const record = {
    id: otherSeededUuid,
    taskId: task.id,
    entries: [
      {
        templateEntryId: 'entry-1',
        photos: ['https://example.com/test.jpg'],
        aiResult: { status: 'pending', confidence: 0, reason: '' },
        manualResult: 'pending',
        finalResult: null,
      },
    ],
    status: 'submitted',
    auditTrail: [],
  };
  const recordRepo = {
    findOne: async () => record,
    save: async (value) => value,
  };
  const taskRepo = {
    findOne: async () => task,
    save: async (value) => value,
  };
  const service = new RecordService(recordRepo, taskRepo, {});

  await service.applyAiResult(record.id, 'entry-1', {
    status: 'error',
    confidence: 0,
    reason: 'AI unavailable',
  });
  assert.equal(record.status, 'submitted');
  assert.equal(task.status, 'submitted');
  assert.match(record.auditTrail[0].summary, /人工审核/);

  const detail = await service.findOne(record.id, {
    id: seededUuid,
    role: 'super_admin',
    managedSiteIds: [],
    memberSiteIds: [],
  });
  assert.equal(detail.aiSummary.error, 1);
  assert.equal(detail.needsAudit, true);
}

async function main() {
  validateSeededIds();
  await validateCorsPolicy();
  await validateManualAuditFlow();
  await validateTemplateScopeUpdate();
  await validateAiErrorFallsBackToAudit();
  console.log('smoke tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

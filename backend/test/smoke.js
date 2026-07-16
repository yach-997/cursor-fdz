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
const {
  UploadPhotoMetaDto,
  LocationCheckDto,
} = require('../dist/modules/upload/dto/upload.dto');
const { AnalyzeDto } = require('../dist/modules/ai/dto/ai.dto');
const { RecordService } = require('../dist/modules/record/record.service');
const { TemplateService } = require('../dist/modules/template/template.service');
const { SiteService } = require('../dist/modules/site/site.service');
const { GeocodeService } = require('../dist/modules/geocode/geocode.service');
const {
  LocationGuardService,
} = require('../dist/modules/upload/location-guard.service');
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
    [
      LocationCheckDto,
      {
        taskId: seededUuid,
        gps: '30.0001,120.0001',
        accuracy: '20',
        capturedAt: new Date().toISOString(),
      },
    ],
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
    update: async (_criteria, patch) => {
      Object.assign(record, patch);
      return { affected: 1 };
    },
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
      {
        templateEntryId: 'entry-2',
        photos: ['https://example.com/test-2.jpg'],
        aiResult: { status: 'fail', confidence: 0.98, reason: 'AI found defect' },
        manualResult: 'pass',
        finalResult: 'pass',
      },
    ],
    status: 'submitted',
    auditTrail: [],
  };
  const recordRepo = {
    findOne: async () => record,
    save: async (value) => value,
    update: async (_criteria, patch) => {
      Object.assign(record, patch);
      return { affected: 1 };
    },
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
  assert.equal(
    detail.aiSummary.fail,
    1,
    'AI 不合格统计不能被巡检员人工确认结果覆盖',
  );
  assert.equal(detail.needsAudit, true);
}

async function validateLateDraftCannotOverwriteSubmission() {
  const task = {
    id: seededUuid,
    siteId: otherSeededUuid,
    status: 'submitted',
    aiEnabled: true,
  };
  const entry = {
    templateEntryId: 'entry-1',
    photos: ['https://example.com/test.jpg'],
    aiResult: { status: 'fail', confidence: 0.95, reason: 'defect' },
    manualResult: 'fail',
    finalResult: 'fail',
    remark: '',
  };
  const staleDraft = {
    id: otherSeededUuid,
    taskId: task.id,
    deviceType: 'string_inverter',
    entries: [entry],
    status: 'draft',
    submittedAt: null,
    auditTrail: [],
    createdAt: new Date(),
  };
  const submitted = {
    ...staleDraft,
    status: 'submitted',
    submittedAt: new Date(),
    auditTrail: [{ action: 'submitted', at: new Date().toISOString() }],
  };
  let reads = 0;
  const recordRepo = {
    findOne: async () => (reads++ === 0 ? staleDraft : submitted),
    update: async () => ({ affected: 0 }),
    save: async () => {
      throw new Error('晚到的草稿不应再整实体保存');
    },
  };
  const taskRepo = { findOne: async () => task };
  const service = new RecordService(recordRepo, taskRepo, {});
  const result = await service.saveDraft(
    staleDraft.id,
    { entries: [entry] },
    {
      id: seededUuid,
      realName: 'Admin',
      role: 'super_admin',
      managedSiteIds: [],
      memberSiteIds: [],
    },
  );
  assert.equal(result.status, 'submitted');
  assert.ok(result.submittedAt);
  assert.equal(result.auditTrail.length, 1);
}

async function validatePrimaryManagerCanAlsoInspect() {
  const managerId = '22222222-2222-2222-2222-222222222222';
  const site = {
    id: seededUuid,
    managerId,
    status: 'active',
    deletedAt: null,
  };
  const manager = {
    id: managerId,
    username: 'manager-inspector',
    realName: 'Manager Inspector',
    role: 'site_manager',
    roles: ['site_manager', 'inspector'],
    status: 'active',
  };
  const siteRepo = { findOne: async () => site };
  const userRepo = { findOne: async () => manager };
  const memberRepo = {
    findOne: async () => null,
    create: (value) => ({ id: otherSeededUuid, ...value }),
    save: async (value) => value,
  };
  const service = new SiteService(siteRepo, {}, userRepo, memberRepo);
  const result = await service.addMember(
    site.id,
    { userId: managerId },
    { role: 'super_admin', managedSiteIds: [], memberSiteIds: [] },
  );
  assert.equal(result.userId, managerId);
  assert.equal(result.memberRole, 'inspector');
  assert.equal(result.user.username, manager.username);
}

function validateGeocodeRegionGuard() {
  const service = new GeocodeService({ get: () => '' });
  const expected = { province: '四川省', city: '宜宾市' };
  const correct = {
    latitude: 28.75,
    longitude: 104.64,
    displayName: '四川省宜宾市叙州区四川轻化工大学宜宾校区',
    provider: 'nominatim',
  };
  const wrong = {
    latitude: 31.82,
    longitude: 117.23,
    displayName: '安徽省合肥市蜀山区丹霞路',
    provider: 'nominatim',
  };
  assert.equal(service.acceptHit(correct, expected), true);
  assert.equal(service.acceptHit(wrong, expected), false);
}

async function validateLandmarkGeocodeFallback() {
  const service = new GeocodeService({ get: () => '' });
  service.searchNominatim = async (query) =>
    query.includes('四川轻化工大学宜宾校区')
      ? {
          latitude: 28.8087877,
          longitude: 104.6683398,
          displayName: '四川轻化工大学宜宾校区, 翠屏区, 宜宾市, 四川省, 中国',
          provider: 'nominatim',
        }
      : null;
  service.searchOpenMeteo = async () => null;

  const result = await service.geocode({
    address: '四川省宜宾市翠屏区四川轻化工大学宜宾校区',
    province: '四川省',
    city: '宜宾市',
    district: '翠屏区',
    detail: '四川轻化工大学宜宾校区',
  });
  assert.equal(result.provider, 'nominatim');
  assert.match(result.displayName, /宜宾市/);
}

async function validateChineseTownGeocodeAndPoiPriority() {
  const poiQueries = [];
  const amapService = new GeocodeService({
    get: (key) => (key === 'AMAP_WEB_SERVICE_KEY' ? 'test-key' : ''),
  });
  amapService.searchAmapPoi = async (query) => {
    poiQueries.push(query);
    return query === '卧龙湖二期伏电站'
      ? {
          latitude: 29.307395,
          longitude: 104.751708,
          displayName: '四川省自贡市自流井区卧龙湖二期',
          provider: 'amap_poi',
        }
      : null;
  };
  amapService.searchAmapGeo = async () => null;

  const amapResult = await amapService.geocode({
    address: '四川省自贡市自流井区高峰',
    province: '四川省',
    city: '自贡市',
    district: '自流井区',
    detail: '高峰',
    name: '卧龙湖二期伏电站',
  });
  assert.equal(poiQueries[0], '卧龙湖二期伏电站');
  assert.equal(amapResult.provider, 'amap_poi');

  const osmQueries = [];
  const osmService = new GeocodeService({ get: () => '' });
  osmService.searchNominatim = async (query) => {
    osmQueries.push(query);
    return query === '高峰,自流井区,自贡市,四川省,中国'
      ? {
          latitude: 29.3081183,
          longitude: 104.7581671,
          displayName: '高峰街道, 自流井区, 自贡市, 四川省, 中国',
          provider: 'nominatim',
        }
      : null;
  };
  osmService.searchOpenMeteo = async () => null;

  const osmResult = await osmService.geocode({
    address: '四川省自贡市自流井区高峰',
    province: '四川省',
    city: '自贡市',
    district: '自流井区',
    detail: '高峰',
  });
  assert.equal(osmQueries[0], '高峰,自流井区,自贡市,四川省,中国');
  assert.equal(osmResult.provider, 'nominatim');
}

async function validateInspectionLocationGuard() {
  const task = {
    id: seededUuid,
    siteId: otherSeededUuid,
    inspectorId: seededUuid,
  };
  const site = {
    id: otherSeededUuid,
    name: '现场测试站',
    latitude: 30,
    longitude: 120,
    inspectionRadiusMeters: 300,
  };
  const service = new LocationGuardService(
    { get: (_key, fallback) => fallback },
    { findOne: async () => task },
    { findOne: async () => site },
  );
  const inspector = {
    id: seededUuid,
    role: 'inspector',
    realName: '现场巡检员',
  };
  const now = new Date().toISOString();
  const onsite = await service.assertOnSite(
    task.id,
    {
      gps: '30.0001,120.0001',
      accuracy: '20',
      capturedAt: now,
      photoTakenAt: now,
    },
    inspector,
    true,
  );
  assert.equal(onsite.verified, true);
  assert.ok(onsite.distanceMeters < 500);

  await assert.rejects(
    () =>
      service.assertOnSite(
        task.id,
        { gps: '30.02,120.02', accuracy: '20', capturedAt: now },
        inspector,
      ),
    /超出 300 米巡检范围/,
  );
  await assert.rejects(
    () =>
      service.assertOnSite(
        task.id,
        {
          gps: '30.0001,120.0001',
          accuracy: '20',
          capturedAt: now,
          photoTakenAt: new Date(Date.now() - 11 * 60_000).toISOString(),
        },
        inspector,
        true,
      ),
    /不是刚刚现场拍摄/,
  );
}

async function main() {
  validateSeededIds();
  await validateCorsPolicy();
  await validateManualAuditFlow();
  await validateTemplateScopeUpdate();
  await validateAiErrorFallsBackToAudit();
  await validateLateDraftCannotOverwriteSubmission();
  await validatePrimaryManagerCanAlsoInspect();
  validateGeocodeRegionGuard();
  await validateLandmarkGeocodeFallback();
  await validateChineseTownGeocodeAndPoiPriority();
  await validateInspectionLocationGuard();
  console.log('smoke tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

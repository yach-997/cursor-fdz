import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loading, Toast } from 'react-vant';
import {
  claimFinanceUnit,
  completeFinanceUnit,
  fetchMyFinanceCase,
  finishFinanceCase,
  startFinanceCase,
  type MobileFinanceCase,
} from '../../api/finance';
import { useAuthStore } from '../../stores/auth';
import { resolveWorkTypeLabel, workActionLabel } from '../../utils/workTypeLabels';
import './finance.css';

const TASK_STATUS_LABEL: Record<string, string> = {
  pending: '未开始',
  in_progress: '进行中',
  submitted: '已提交',
  approved: '已通过',
  rejected: '已驳回·需返工',
};

const CASE_STATUS_LABEL: Record<string, string> = {
  assigned: '待接单',
  working: '作业中',
  finished: '已完工',
  settle_review: '结算审核中',
  settled: '已结算',
  month_locked: '已月结',
};

const UNIT_STATUS_LABEL: Record<string, string> = {
  open: '可认领',
  claimed: '作业中',
  submitted: '已提交',
  completed: '已完成',
  cancelled: '已取消',
};

type UnitFilter = 'open' | 'mine' | 'all';
type UnitItem = NonNullable<MobileFinanceCase['units']>[number];

const GRID_PAGE = 40;

export default function FinanceCaseDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.id);
  const [item, setItem] = useState<MobileFinanceCase>();
  const [busy, setBusy] = useState(false);
  const [unitFilter, setUnitFilter] = useState<UnitFilter>('open');
  const [gridLimit, setGridLimit] = useState(GRID_PAGE);
  const [showCompletedAll, setShowCompletedAll] = useState(false);
  /** 本地聚焦台：可在已认领多台之间切换，不必等当前台完成 */
  const [focusUnitId, setFocusUnitId] = useState<string | null>(null);

  useEffect(() => {
    void fetchMyFinanceCase(id).then((data) => {
      setItem(data);
      setFocusUnitId(data.activeUnit?.id || null);
    });
  }, [id]);

  useEffect(() => {
    setGridLimit(GRID_PAGE);
    setShowCompletedAll(false);
  }, [unitFilter, id]);

  const isMulti = item?.assignMode === 'multi';
  const unitLabel = item?.unitLabel || '台';
  const plannedCap = Math.max(1, Number(item?.plannedUnits) || 1);
  const units = useMemo(() => {
    const raw = item?.units || [];
    // 计划缩减后，超出计划且仍 open 的不展示；有进展的历史行仍可见
    return raw.filter((u) => u.seq <= plannedCap || u.status !== 'open');
  }, [item?.units, plannedCap]);
  const openUnits = useMemo(
    () =>
      units
        .filter((u) => u.status === 'open' && u.seq <= plannedCap)
        .sort((a, b) => a.seq - b.seq),
    [units, plannedCap],
  );
  const myInProgress = useMemo(() => {
    return units
      .filter(
        (u) =>
          !!userId &&
          u.inspectorId === userId &&
          (u.status === 'claimed' || u.status === 'submitted'),
      )
      .sort((a, b) => a.seq - b.seq);
  }, [units, userId]);
  const myUnitList = useMemo(() => {
    return units
      .filter(
        (u) =>
          !!userId &&
          u.inspectorId === userId &&
          u.status !== 'open' &&
          u.status !== 'cancelled',
      )
      .sort((a, b) => a.seq - b.seq);
  }, [units, userId]);

  const claimedUnits = useMemo(
    () => units.filter((u) => u.status === 'claimed' || u.status === 'submitted'),
    [units],
  );
  const completedUnits = useMemo(
    () => units.filter((u) => u.status === 'completed').sort((a, b) => a.seq - b.seq),
    [units],
  );

  const myActive = useMemo(() => {
    if (!item) return null;
    if (focusUnitId) {
      const focused = myInProgress.find((u) => u.id === focusUnitId);
      if (focused) return focused;
    }
    return (
      item.activeUnit ||
      myInProgress[0] ||
      null
    );
  }, [item, focusUnitId, myInProgress]);

  if (!item) {
    return (
      <div className="mobile-finance-page">
        <Loading vertical>加载案例...</Loading>
      </div>
    );
  }

  const tripClaim = (unitId?: string | null) =>
    unitId ? (item.expenses || []).find((e) => e.workUnitId === unitId) : undefined;

  const isTripSkipped = (unitId?: string | null) => !!tripClaim(unitId)?.tripSkipped;

  /** 实际填了开始里程（非无行程） */
  const hasTripStartFilled = (unitId?: string | null) => {
    const claim = tripClaim(unitId);
    return !!(
      claim?.startOdometerUrl &&
      claim?.startNavUrl &&
      claim?.startMileage != null &&
      claim.startMileage !== ''
    );
  };

  const hasTripEnd = (unitId?: string | null) => {
    const claim = tripClaim(unitId);
    return !!(
      claim?.endOdometerUrl &&
      claim?.endNavUrl &&
      claim?.endMileage != null &&
      claim.endMileage !== ''
    );
  };

  const goInspectUnit = async (unit: UnitItem | null | undefined, autoStart: boolean) => {
    setBusy(true);
    try {
      let current = item;
      if (autoStart && current.status === 'assigned') {
        current = await startFinanceCase(id);
        setItem(current);
      }
      const taskId =
        unit?.inspectionTaskId ||
        current.inspectionTaskId ||
        current.activeUnit?.inspectionTaskId;
      if (!taskId) {
        Toast.fail(
          isMulti
            ? '请先认领一个作业单元'
            : `未找到${workActionLabel(resolveWorkTypeLabel(current), 'task_noun')}，请联系网格长确认服务类型`,
        );
        return;
      }
      if (unit?.id) setFocusUnitId(unit.id);
      navigate(`/m/inspection/${taskId}`);
    } catch {
      /* 拦截器 */
    } finally {
      setBusy(false);
    }
  };

  const enterInspection = async (autoStart: boolean) => {
    if (isMulti) {
      await goInspectUnit(myActive, autoStart);
      return;
    }
    setBusy(true);
    try {
      let current = item;
      if (autoStart && current.status === 'assigned') {
        current = await startFinanceCase(id);
        setItem(current);
      } else if (!current.inspectionTaskId) {
        current = await startFinanceCase(id);
        setItem(current);
      }
      const taskId = current.inspectionTaskId || current.activeUnit?.inspectionTaskId;
      if (!taskId) {
        Toast.fail(
          `未找到${workActionLabel(resolveWorkTypeLabel(current), 'task_noun')}，请联系网格长确认服务类型`,
        );
        return;
      }
      navigate(`/m/inspection/${taskId}`);
    } catch {
      /* 拦截器 */
    } finally {
      setBusy(false);
    }
  };

  /** 认领：可并行多台；已有作业时默认留在本页，方便继续认领 */
  const claimUnit = async (unitId: string, goAfter: boolean) => {
    setBusy(true);
    try {
      if (item.status === 'assigned') {
        await startFinanceCase(id);
      }
      const res = await claimFinanceUnit(id, unitId);
      setItem(res.case);
      setFocusUnitId(res.case.activeUnit?.id || unitId);
      const seq = res.case.activeUnit?.seq || res.case.units?.find((u) => u.id === unitId)?.seq;
      Toast.success(seq ? `已认领 ${unitLabel} #${seq}` : '认领成功');
      if (goAfter && res.inspectionTaskId) {
        navigate(`/m/inspection/${res.inspectionTaskId}`);
        return;
      }
    } catch {
      /* */
    } finally {
      setBusy(false);
    }
  };

  const claimNext = async () => {
    const next = openUnits[0];
    if (!next) {
      Toast.fail(`暂无可认领${unitLabel}`);
      return;
    }
    // 已有未完成台时只认领不跳转，便于连续认领
    await claimUnit(next.id, myInProgress.length === 0);
  };

  const canInspect =
    ['assigned', 'working'].includes(item.status) &&
    !item.inspectionDone &&
    (!isMulti || !!myActive);
  // 正常路径：提交报告后自动完工；仅异常卡住时才显示补救按钮
  const reportReady =
    item.inspectionDone ||
    item.inspectionTaskStatus === 'submitted' ||
    item.inspectionTaskStatus === 'approved' ||
    myActive?.status === 'submitted';
  const tripEndUnitId = myActive?.id || item.units?.[0]?.id;
  const needsTripEndAfterSubmit =
    item.status === 'working' &&
    reportReady &&
    hasTripStartFilled(tripEndUnitId) &&
    !isTripSkipped(tripEndUnitId) &&
    !hasTripEnd(tripEndUnitId);
  const tripEndReadyForFinish =
    isTripSkipped(tripEndUnitId) ||
    !hasTripStartFilled(tripEndUnitId) ||
    hasTripEnd(tripEndUnitId);
  const needsManualFinish =
    item.status === 'working' && reportReady && tripEndReadyForFinish;
  const finished = !['assigned', 'working'].includes(item.status);
  const workType = resolveWorkTypeLabel(item);
  const multiWorking = isMulti && ['assigned', 'working'].includes(item.status);

  const primaryLabel =
    item.status === 'assigned'
      ? workActionLabel(workType, 'accept_start')
      : item.inspectionTaskStatus === 'rejected'
        ? workActionLabel(workType, 'rework')
        : item.inspectionTaskStatus === 'in_progress'
          ? workActionLabel(workType, 'continue')
          : workActionLabel(workType, 'start');

  const progressPct = Math.min(
    100,
    Math.round(
      ((item.completedUnits || 0) / Math.max(1, item.plannedUnits || 1)) * 100,
    ),
  );

  const renderUnitChip = (u: UnitItem, clickable: boolean) => (
    <button
      key={u.id}
      type="button"
      className={`unit-chip ${u.status === 'open' ? 'is-open' : ''} ${
        u.id === myActive?.id ? 'is-mine' : ''
      }`}
      disabled={busy || !clickable}
      onClick={() => clickable && void claimUnit(u.id, myInProgress.length === 0)}
    >
      #{u.seq}
    </button>
  );

  return (
    <div className="mobile-finance-page">
      <header className="mobile-finance-head">
        <button type="button" onClick={() => navigate('/m/tasks')}>
          ← 返回
        </button>
        <h1>作业详情</h1>
      </header>

      <section className="mobile-finance-card">
        <div className="mobile-finance-row">
          <h2>{item.projectName || item.gspCaseNo}</h2>
          <span className="mobile-finance-status">
            {CASE_STATUS_LABEL[item.status] || item.status}
          </span>
        </div>
        <dl className="mobile-finance-meta">
          <div>
            <dt>案例号</dt>
            <dd>{item.gspCaseNo}</dd>
          </div>
          <div>
            <dt>地区</dt>
            <dd>
              {item.province || '-'}
              {item.city ? ` · ${item.city}` : ''}
            </dd>
          </div>
          <div>
            <dt>服务类型</dt>
            <dd>{item.taskTypeName || item.taskType || '未设置'}</dd>
          </div>
          {!isMulti && item.inspectionTaskStatus && (
            <div>
              <dt>{workActionLabel(workType, 'progress')}</dt>
              <dd>
                {item.inspectionTaskStatus === 'in_progress'
                  ? workActionLabel(workType, 'doing')
                  : TASK_STATUS_LABEL[item.inspectionTaskStatus] ||
                    item.inspectionTaskStatus}
              </dd>
            </div>
          )}
        </dl>

        {!isMulti && canInspect && (
          <>
            <button
              type="button"
              className="mobile-finance-primary"
              style={{ width: '100%', marginTop: 8 }}
              disabled={busy}
              onClick={() => void enterInspection(item.status === 'assigned')}
            >
              {primaryLabel}
            </button>
          </>
        )}

        {(item.inspectionDone || finished) && item.inspectionTaskId && (
          <button
            type="button"
            className="mobile-finance-secondary"
            style={{ width: '100%', marginTop: 12 }}
            onClick={() => navigate(`/m/tasks/${item.inspectionTaskId}`)}
          >
            {workActionLabel(workType, 'report')}
          </button>
        )}
      </section>

      {multiWorking && (
        <section className="mobile-finance-card unit-pool-card">
          <div className="unit-progress-head">
            <div>
              <strong>
                {item.completedUnits || 0}/{item.plannedUnits || 1}
              </strong>
              <span>
                {' '}
                {unitLabel}已完成 · 可认领 {openUnits.length}
                {myInProgress.length > 0 ? ` · 我进行中 ${myInProgress.length}` : ''}
              </span>
            </div>
          </div>
          <div className="unit-progress-bar" aria-hidden>
            <i style={{ width: `${progressPct}%` }} />
          </div>

          {myActive && (
            <div className="unit-now">
              <div className="unit-now-info">
                <span className="unit-now-label">当前作业</span>
                <strong>
                  {unitLabel} #{myActive.seq}
                </strong>
                <small>{UNIT_STATUS_LABEL[myActive.status] || myActive.status}</small>
                {myInProgress.length > 1 && (
                  <small className="unit-now-extra">共 {myInProgress.length} 台进行中</small>
                )}
              </div>
              {canInspect && (
                <button
                  type="button"
                  className="mobile-finance-primary"
                  disabled={busy}
                  onClick={() => void goInspectUnit(myActive, false)}
                >
                  {primaryLabel}
                </button>
              )}
            </div>
          )}

          {openUnits.length > 0 ? (
            <button
              type="button"
              className={`mobile-finance-primary unit-claim-next ${
                myActive ? 'is-secondary-style' : ''
              }`}
              disabled={busy}
              onClick={() => void claimNext()}
            >
              {myUnitList.length > 0 || myInProgress.length > 0
                ? `认领下一${unitLabel}（#${openUnits[0].seq}）`
                : `认领第 ${openUnits[0].seq} ${unitLabel}`}
            </button>
          ) : !myActive ? (
            <p className="mobile-finance-muted unit-empty-tip">
              暂无可认领{unitLabel}，请等待他人完成或结案。
            </p>
          ) : null}

          {myActive && openUnits.length > 0 && (
            <p className="mobile-finance-muted unit-hint">
              当前{unitLabel}可先放着，继续认领其他{unitLabel}；在「我的」里可切换进入任一台作业。
            </p>
          )}

          <div className="unit-filter-row">
            {(
              [
                ['open', `可认领 ${openUnits.length}`],
                ['mine', `我的 ${myUnitList.length}`],
                ['all', `全部 ${units.length}`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`unit-filter-chip ${unitFilter === key ? 'is-active' : ''}`}
                onClick={() => setUnitFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {unitFilter === 'open' && (
            <>
              {openUnits.length === 0 ? (
                <p className="mobile-finance-muted">没有可认领的{unitLabel}</p>
              ) : (
                <div className="unit-grid">
                  {openUnits.slice(0, gridLimit).map((u) => renderUnitChip(u, true))}
                </div>
              )}
              {openUnits.length > gridLimit && (
                <button
                  type="button"
                  className="unit-more-btn"
                  onClick={() => setGridLimit((n) => n + GRID_PAGE)}
                >
                  加载更多（还有 {openUnits.length - gridLimit}）
                </button>
              )}
            </>
          )}

          {unitFilter === 'mine' && (
            <ul className="unit-mine-list">
              {myUnitList.length === 0 ? (
                <li className="mobile-finance-muted">暂无我的{unitLabel}</li>
              ) : (
                myUnitList.map((u) => {
                  const canEnter = u.status === 'claimed' || u.status === 'submitted';
                  const isFocus = u.id === myActive?.id;
                  return (
                    <li key={u.id} className={isFocus ? 'is-focus' : ''}>
                      <span>
                        {unitLabel} #{u.seq}
                        {isFocus ? ' · 当前' : ''}
                      </span>
                      <span className="unit-mine-actions">
                        <em>{UNIT_STATUS_LABEL[u.status] || u.status}</em>
                        {canEnter && (
                          <button
                            type="button"
                            className="unit-enter-btn"
                            disabled={busy}
                            onClick={() => void goInspectUnit(u, false)}
                          >
                            进入
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })
              )}
            </ul>
          )}

          {unitFilter === 'all' && (
            <div className="unit-all-groups">
              {openUnits.length > 0 && (
                <div className="unit-group">
                  <div className="unit-group-title">可认领 · {openUnits.length}</div>
                  <div className="unit-grid">
                    {openUnits.slice(0, gridLimit).map((u) => renderUnitChip(u, true))}
                  </div>
                  {openUnits.length > gridLimit && (
                    <button
                      type="button"
                      className="unit-more-btn"
                      onClick={() => setGridLimit((n) => n + GRID_PAGE)}
                    >
                      加载更多
                    </button>
                  )}
                </div>
              )}
              {claimedUnits.length > 0 && (
                <div className="unit-group">
                  <div className="unit-group-title">作业中 · {claimedUnits.length}</div>
                  <ul className="unit-mine-list">
                    {claimedUnits.map((u) => {
                      const mine = !!userId && u.inspectorId === userId;
                      const canEnter =
                        mine && (u.status === 'claimed' || u.status === 'submitted');
                      return (
                        <li key={u.id}>
                          <span>
                            {unitLabel} #{u.seq}
                            {mine ? ' · 我的' : ''}
                          </span>
                          <span className="unit-mine-actions">
                            <em>{UNIT_STATUS_LABEL[u.status] || u.status}</em>
                            {canEnter && (
                              <button
                                type="button"
                                className="unit-enter-btn"
                                disabled={busy}
                                onClick={() => void goInspectUnit(u, false)}
                              >
                                进入
                              </button>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {completedUnits.length > 0 && (
                <div className="unit-group">
                  <button
                    type="button"
                    className="unit-group-title is-btn"
                    onClick={() => setShowCompletedAll((v) => !v)}
                  >
                    已完成 · {completedUnits.length}
                    <span>{showCompletedAll ? '收起' : '展开'}</span>
                  </button>
                  {showCompletedAll && (
                    <div className="unit-grid is-done">
                      {completedUnits.map((u) => (
                        <span key={u.id} className="unit-chip is-done">
                          #{u.seq}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {canInspect && (
        <section className="mobile-finance-card mobile-finance-tip">
          <h3>现场说明</h3>
          <p className="mobile-finance-muted">
            {isMulti
              ? workActionLabel(workType, 'tip_unit')
              : workActionLabel(workType, 'tip_photo')}
          </p>
        </section>
      )}

      {needsTripEndAfterSubmit && (
        <section className="mobile-finance-card">
          <h3>报告已提交</h3>
          <p className="mobile-finance-muted">
            还差结束里程表和导航截图。补填保存后会自动完工，不用再点确认。
          </p>
          <button
            type="button"
            className="mobile-finance-primary"
            style={{ width: '100%', marginTop: 12 }}
            onClick={() =>
              navigate(
                `/m/finance-cases/${id}/expense?step=end&autoFinish=1${
                  tripEndUnitId ? `&unitId=${tripEndUnitId}` : ''
                }`,
              )
            }
          >
            去填结束里程（自动完工）
          </button>
        </section>
      )}

      {needsManualFinish && (
        <section className="mobile-finance-card">
          <h3>
            {isMulti
              ? `本单元${workActionLabel(workType, 'submitted')}`
              : workActionLabel(workType, 'submitted')}
          </h3>
          <p className="mobile-finance-muted">
            {isMulti
              ? `本${unitLabel}报告与结束行程已齐，点下方完结（正常应已自动完成）。`
              : '报告与结束行程已齐，点下方完结（正常应已自动完工）。'}
          </p>
          <button
            type="button"
            className="mobile-finance-secondary"
            style={{ width: '100%', marginTop: 12 }}
            disabled={busy}
            onClick={() => {
              const unitId = myActive?.id || item.units?.[0]?.id;
              void (async () => {
                setBusy(true);
                try {
                  const next =
                    isMulti && unitId
                      ? await completeFinanceUnit(id, unitId)
                      : await finishFinanceCase(id);
                  setItem(next);
                  if (isMulti && ['assigned', 'working'].includes(next.status)) {
                    Toast.success(`本${unitLabel}已完成`);
                    setFocusUnitId(next.myActiveUnits?.[0]?.id || next.activeUnit?.id || null);
                  } else {
                    Toast.success('案例已完工');
                    navigate('/m/tasks', { replace: true });
                  }
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            {isMulti
              ? `完成本${unitLabel}${myActive ? ` #${myActive.seq}` : ''}`
              : '确认完工'}
          </button>
        </section>
      )}

      {finished && (
        <section className="mobile-finance-card mobile-finance-tip">
          <h3>本单已结束</h3>
          <p className="mobile-finance-muted">可在「我的收入」查看结算进度。</p>
        </section>
      )}
    </div>
  );
}

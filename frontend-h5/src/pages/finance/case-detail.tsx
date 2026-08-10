import { useEffect, useMemo, useRef, useState } from 'react';
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
  /** 进入页时自动补完「已提交未完结」的台，避免误显示「完成本台」 */
  const autoCompleteTried = useRef<Set<string>>(new Set());

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

  useEffect(() => {
    if (!item || !id || !userId) return;
    if (!['assigned', 'working'].includes(item.status)) return;
    const planned = Math.max(1, Number(item.plannedUnits) || 1);
    const unitFlow = item.assignMode === 'multi' || planned > 1;
    let cancelled = false;
    void (async () => {
      if (unitFlow) {
        const stuck = (item.units || []).filter(
          (u) =>
            u.inspectorId === userId &&
            u.status === 'submitted' &&
            !!u.inspectionTaskId &&
            !autoCompleteTried.current.has(u.id),
        );
        for (const u of stuck) {
          autoCompleteTried.current.add(u.id);
          try {
            const next = await completeFinanceUnit(id, u.id, { skipErrorToast: true });
            if (cancelled) return;
            setItem(next);
            setFocusUnitId(next.myActiveUnits?.[0]?.id || next.activeUnit?.id || null);
          } catch {
            autoCompleteTried.current.delete(u.id);
          }
        }
        return;
      }
      // 单人：报告已交且未结案时静默确认完工（与提交成功页一致）
      const key = `case:${id}`;
      if (autoCompleteTried.current.has(key)) return;
      const ready =
        item.inspectionDone ||
        item.inspectionTaskStatus === 'submitted' ||
        item.inspectionTaskStatus === 'approved';
      if (!ready) return;
      autoCompleteTried.current.add(key);
      try {
        const next = await finishFinanceCase(id, { skipErrorToast: true });
        if (cancelled) return;
        setItem(next);
      } catch {
        autoCompleteTried.current.delete(key);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, userId, item]);

  const isMulti = item?.assignMode === 'multi';
  const unitLabel = item?.unitLabel || '台';
  const plannedCap = Math.max(1, Number(item?.plannedUnits) || 1);
  // 单人多台与多人一样走分台认领；多人特有的加人/分账仍用 isMulti
  const useUnitFlow = isMulti || plannedCap > 1;
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
  /** 本人已提交/已完成且有任务的台：可查看报告 */
  const myReportUnits = useMemo(() => {
    return myUnitList.filter(
      (u) =>
        !!u.inspectionTaskId &&
        (u.status === 'submitted' || u.status === 'completed'),
    );
  }, [myUnitList]);

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
          useUnitFlow
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

  const viewUnitReport = (unit: UnitItem) => {
    if (!unit.inspectionTaskId) {
      Toast.fail('该台暂无报告可查看');
      return;
    }
    navigate(`/m/tasks/${unit.inspectionTaskId}`);
  };

  const enterInspection = async (autoStart: boolean) => {
    if (useUnitFlow) {
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
    (useUnitFlow
      ? !!myActive && myActive.status === 'claimed'
      : !item.inspectionDone);
  // 分台：只针对「本人仍卡在已提交」的台（用于引导补结束里程 / 后台自动完结）
  const finishTargetUnit = useUnitFlow
    ? myInProgress.find((u) => u.status === 'submitted') ||
      (myActive?.status === 'submitted' ? myActive : null) ||
      null
    : null;
  const reportReady = useUnitFlow
    ? !!finishTargetUnit
    : item.inspectionDone ||
      item.inspectionTaskStatus === 'submitted' ||
      item.inspectionTaskStatus === 'approved' ||
      myActive?.status === 'submitted';
  const tripEndUnitId = useUnitFlow
    ? finishTargetUnit?.id || null
    : myActive?.id || item.units?.[0]?.id || null;
  // 有开始行程却缺结束里程时才提示；完结动作由提交成功页 / 进页自动补完，不再提供「完成本台」
  const needsTripEndAfterSubmit =
    item.status === 'working' &&
    !!tripEndUnitId &&
    reportReady &&
    hasTripStartFilled(tripEndUnitId) &&
    !isTripSkipped(tripEndUnitId) &&
    !hasTripEnd(tripEndUnitId);
  const finished = !['assigned', 'working'].includes(item.status);
  const workType = resolveWorkTypeLabel(item);
  const multiWorking = useUnitFlow && ['assigned', 'working'].includes(item.status);

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
          {!useUnitFlow && item.inspectionTaskStatus && (
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

        {!useUnitFlow && canInspect && (
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

        {!useUnitFlow && (item.inspectionDone || finished) && item.inspectionTaskId && (
          <button
            type="button"
            className="mobile-finance-secondary"
            style={{ width: '100%', marginTop: 12 }}
            onClick={() => navigate(`/m/tasks/${item.inspectionTaskId}`)}
          >
            {workActionLabel(workType, 'report')}
          </button>
        )}
        {useUnitFlow && myReportUnits.length > 0 && (
          <button
            type="button"
            className="mobile-finance-secondary"
            style={{ width: '100%', marginTop: 12 }}
            onClick={() => {
              if (myReportUnits.length === 1) {
                viewUnitReport(myReportUnits[0]);
                return;
              }
              const el = document.getElementById('my-unit-reports');
              el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              Toast.info(`共 ${myReportUnits.length} 份，在下方列表点「查看报告」`);
            }}
          >
            {workActionLabel(workType, 'report')}（{myReportUnits.length}）
          </button>
        )}
      </section>

      {useUnitFlow && myReportUnits.length > 0 && (
        <section id="my-unit-reports" className="mobile-finance-card">
          <h3>
            我的{workType}报告 · {myReportUnits.length}
          </h3>
          <p className="mobile-finance-muted" style={{ marginTop: 4 }}>
            每台提交后可在此回看；点「查看报告」打开对应台详情。
          </p>
          <ul className="unit-mine-list">
            {myReportUnits.map((u) => (
              <li key={u.id}>
                <span>
                  {unitLabel} #{u.seq}
                  <em style={{ marginLeft: 8 }}>
                    {UNIT_STATUS_LABEL[u.status] || u.status}
                  </em>
                </span>
                <span className="unit-mine-actions">
                  <button
                    type="button"
                    className="unit-enter-btn"
                    onClick={() => viewUnitReport(u)}
                  >
                    查看报告
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
                  const canEnter = u.status === 'claimed';
                  const canViewReport =
                    !!u.inspectionTaskId &&
                    (u.status === 'submitted' || u.status === 'completed');
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
                        {canViewReport && (
                          <button
                            type="button"
                            className="unit-enter-btn"
                            onClick={() => viewUnitReport(u)}
                          >
                            查看报告
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
                    <ul className="unit-mine-list">
                      {completedUnits.map((u) => {
                        const mine = !!userId && u.inspectorId === userId;
                        const canView = !!u.inspectionTaskId && mine;
                        return (
                          <li key={u.id}>
                            <span>
                              {unitLabel} #{u.seq}
                              {mine ? ' · 我的' : ''}
                            </span>
                            <span className="unit-mine-actions">
                              <em>已完成</em>
                              {canView ? (
                                <button
                                  type="button"
                                  className="unit-enter-btn"
                                  onClick={() => viewUnitReport(u)}
                                >
                                  查看报告
                                </button>
                              ) : null}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
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
            {useUnitFlow
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

      {finished && (
        <section className="mobile-finance-card mobile-finance-tip">
          <h3>本单已结束</h3>
          <p className="mobile-finance-muted">可在「我的收入」查看结算进度。</p>
        </section>
      )}
    </div>
  );
}

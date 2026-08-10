import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, Loading, Popup } from 'react-vant';
import {
  fetchMyIncome,
  type IncomeEventPenalty,
  type IncomeLedger,
  type MyIncome,
} from '../../api/finance';
import './finance.css';

const reviewLabel = { pending: '待审', approved: '已审', rejected: '已驳' };

const money = (value: number | string | undefined | null) => {
  const n = Number(value || 0);
  const abs = Math.abs(n).toFixed(2);
  if (n < 0) return `-¥${abs}`;
  return `¥${abs}`;
};

const fmtDay = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

const fmtDayKey = (iso?: string | null) => {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fmtDateTime = (iso?: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const fmtMonthLabel = (ym: string) => {
  const [y, m] = ym.split('-');
  return `${y}年${Number(m)}月`;
};

const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const currentDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fmtDayFromKey = (key: string) => {
  if (!key || key === 'all' || key === 'unknown') return '';
  const [, m, day] = key.split('-');
  return `${Number(m)}月${Number(day)}日`;
};

const weekdayShort = ['日', '一', '二', '三', '四', '五', '六'];

function buildMonthCells(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const startPad = first.getDay();
  const cells: Array<{ key: string; day: number; inMonth: boolean } | null> = [];
  for (let i = 0; i < startPad; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push({
      key: `${ym}-${String(d).padStart(2, '0')}`,
      day: d,
      inMonth: true,
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function PenaltyList({ items }: { items: IncomeEventPenalty[] }) {
  if (!items.length) return null;
  return (
    <ul className="inc-bill-penalties">
      {items.map((event) => (
        <li key={event.id}>
          <b>-¥{Number(event.amount).toFixed(2)}</b>
          <span>
            {event.content}
            {event.remark ? `（${event.remark}）` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CaseSheet({
  item,
  onClose,
}: {
  item: IncomeLedger;
  onClose: () => void;
}) {
  const [showItems, setShowItems] = useState(false);
  const penalties = item.eventPenalties || [];
  const penaltyTotal = Number(item.eventPenaltyTotal || 0);
  const earned = Number(item.perfFinal || 0);
  const caseTotal = Number(item.casePerfFinal || item.perfFinal || 0);
  const shared = !!item.isShared || (caseTotal > 0 && Math.abs(caseTotal - earned) > 0.009);
  const net = earned - penaltyTotal;

  return (
    <div className="inc-bill-sheet">
      <div className="inc-bill-sheet-grab" />
      <header className="inc-bill-sheet-head">
        <div>
          <h3>{item.serviceCase?.projectName || item.gspCaseNo}</h3>
          <p>
            {item.gspCaseNo} · {reviewLabel[item.reviewStatus]}
            {shared && item.myCompletedUnits != null && item.plannedUnits
              ? ` · 分账 ${item.myCompletedUnits}/${item.plannedUnits}`
              : ''}
          </p>
          <p className="inc-bill-sheet-day">
            完工日 {fmtDateTime(item.serviceCase?.finishTime)}
          </p>
        </div>
        <button type="button" className="inc-bill-sheet-close" onClick={onClose}>
          关闭
        </button>
      </header>

      <div className="inc-bill-sheet-net">
        <span>本单净额</span>
        <strong className={net < 0 ? 'is-neg' : ''}>{money(net)}</strong>
      </div>

      <div className="inc-bill-sheet-formula">
        <span>计件 {money(earned)}</span>
        <i>−</i>
        <span>扣罚 {penaltyTotal > 0 ? `¥${penaltyTotal.toFixed(2)}` : '¥0'}</span>
        <i>=</i>
        <span>{money(net)}</span>
      </div>

      {shared && (
        <p className="inc-bill-sheet-hint">
          全案计件 {money(caseTotal)}
          {item.myShareRatio
            ? ` · 本人约 ${(Number(item.myShareRatio) * 100).toFixed(0)}%`
            : ''}
        </p>
      )}

      {penalties.length > 0 && (
        <div className="inc-bill-sheet-block">
          <h4>扣罚原因</h4>
          <PenaltyList items={penalties} />
        </div>
      )}

      {Number(item.deduction) > 0 && (
        <p className="inc-bill-sheet-warn">
          审核扣减 ¥{Number(item.deduction).toFixed(2)}
          {item.deductionReason ? `：${item.deductionReason}` : ''}
        </p>
      )}

      {item.items.length > 0 && (
        <div className="inc-bill-sheet-block">
          <button
            type="button"
            className="inc-bill-link"
            onClick={() => setShowItems((v) => !v)}
          >
            {showItems ? '收起条目' : `条目明细 · ${item.items.length}`}
          </button>
          {showItems && (
            <ul className="inc-bill-items">
              {item.items.map((line, i) => (
                <li key={`${line.itemName}-${i}`}>
                  <span>
                    {line.itemName} × {line.qty}
                  </span>
                  <b>¥{Number(line.itemPerf).toFixed(2)}</b>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function MyIncomePage() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<MyIncome>();
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'cases' | 'extra'>('cases');
  const [active, setActive] = useState<IncomeLedger>();
  const [pickOpen, setPickOpen] = useState(false);
  const [dayFilter, setDayFilter] = useState<string>('all');

  const load = useCallback(async (ym: string) => {
    setLoading(true);
    try {
      setData(await fetchMyIncome(ym));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(month);
  }, [month, load]);

  const settlement = data?.monthlySettlement;
  const assessment = data?.assessment;
  const otherPenalties = data?.otherEventPenalties || [];
  const expenses = data?.expenses || [];
  const extraCount = expenses.length + otherPenalties.length;

  const dayGroups = useMemo(() => {
    const list = data?.list || [];
    const map = new Map<string, IncomeLedger[]>();
    for (const item of list) {
      const key = fmtDayKey(item.serviceCase?.finishTime);
      const arr = map.get(key) || [];
      arr.push(item);
      map.set(key, arr);
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, items]) => ({
        key,
        label: key === 'unknown' ? '日期未知' : fmtDay(items[0]?.serviceCase?.finishTime),
        dayNum: key === 'unknown' ? '?' : String(Number(key.split('-')[2])),
        weekday:
          key === 'unknown'
            ? ''
            : weekdayShort[new Date(`${key}T12:00:00`).getDay()],
        items,
        sum: items.reduce((n, it) => n + Number(it.perfFinal || 0), 0),
      }));
  }, [data?.list]);

  const dayDotMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of dayGroups) map.set(g.key, g.items.length);
    return map;
  }, [dayGroups]);

  const visibleGroups = useMemo(() => {
    if (dayFilter === 'all') return dayGroups;
    return dayGroups.filter((g) => g.key === dayFilter);
  }, [dayGroups, dayFilter]);

  const visibleCaseCount = useMemo(
    () => visibleGroups.reduce((n, g) => n + g.items.length, 0),
    [visibleGroups],
  );

  const breakdown = useMemo(() => {
    if (!data) return null;
    const perf = Number(settlement?.perfTotal ?? data.approvedAmount);
    const expense = Number(settlement?.expenseTotal ?? 0);
    const reward = Number(settlement?.rewardTotal ?? assessment?.rewardAmount ?? 0);
    const eventPenalty = Number(settlement?.eventPenalty ?? assessment?.eventPenalty ?? 0);
    const subsidy = Number(
      settlement?.subsidyTotal ??
        Number(assessment?.toolSubsidy || 0) + Number(assessment?.otherSubsidy || 0),
    );
    const correction = Number(settlement?.correctionTotal ?? assessment?.correctionAmount ?? 0);
    const final = Number(
      settlement?.finalAmount ?? perf + expense + reward + subsidy + correction - eventPenalty,
    );
    return { perf, expense, reward, eventPenalty, subsidy, correction, final };
  }, [data, settlement, assessment]);

  const calCells = useMemo(() => buildMonthCells(month), [month]);

  const goMonth = (delta: number) => {
    const next = shiftMonth(month, delta);
    if (next > currentMonth()) return;
    setDayFilter('all');
    setMonth(next);
  };

  const selectDay = (ymd: string) => {
    setDayFilter(ymd);
    setPickOpen(false);
    setTab('cases');
  };

  const clearDay = () => setDayFilter('all');

  const dayLabel =
    dayFilter !== 'all' && dayFilter !== 'unknown' ? fmtDayFromKey(dayFilter) : '';

  const caseTitleById = useMemo(() => {
    const map = new Map<string, { projectName: string; gspCaseNo: string }>();
    for (const item of data?.list || []) {
      const id = item.serviceCase?.id;
      if (!id) continue;
      map.set(id, {
        projectName: item.serviceCase?.projectName || item.gspCaseNo,
        gspCaseNo: item.gspCaseNo,
      });
    }
    return map;
  }, [data?.list]);

  const resolveExpenseCase = (e: {
    serviceCaseId: string;
    projectName?: string | null;
    gspCaseNo?: string | null;
  }) => {
    const fromApi = e.projectName || e.gspCaseNo;
    if (fromApi) {
      return {
        title: e.projectName || e.gspCaseNo || '关联案例',
        sub: e.gspCaseNo && e.projectName ? e.gspCaseNo : '',
      };
    }
    const linked = caseTitleById.get(e.serviceCaseId);
    if (linked) {
      return {
        title: linked.projectName,
        sub: linked.gspCaseNo,
      };
    }
    return { title: '未找到关联案例', sub: '' };
  };

  return (
    <div className="inc-bill-page">
      <div className="inc-bill-top">
        <header className="inc-bill-nav">
          <button type="button" className="inc-bill-icon-btn" onClick={() => navigate('/m/my')}>
            ←
          </button>
          <button type="button" className="inc-bill-month-inline" onClick={() => setPickOpen(true)}>
            <strong>{dayLabel || fmtMonthLabel(month)}</strong>
            <span>{dayLabel ? fmtMonthLabel(month) : '切换月份/日期'}</span>
          </button>
          <button
            type="button"
            className="inc-bill-icon-btn"
            aria-label="日历"
            onClick={() => setPickOpen(true)}
          >
            历
          </button>
        </header>

        {loading || !data || !breakdown ? (
          <div className="inc-bill-loading">
            <Loading color="#fff">核算中...</Loading>
          </div>
        ) : (
          <div className="inc-bill-sum">
            <p>到手合计</p>
            <strong className={breakdown.final < 0 ? 'is-neg' : ''}>
              {money(breakdown.final)}
            </strong>
            <div className="inc-bill-stats">
              <div>
                <span>计件</span>
                <b>{money(breakdown.perf)}</b>
              </div>
              <div>
                <span>报销</span>
                <b>{money(breakdown.expense)}</b>
              </div>
              <div>
                <span>扣罚</span>
                <b className="is-neg">
                  {breakdown.eventPenalty > 0
                    ? `-¥${breakdown.eventPenalty.toFixed(2)}`
                    : '¥0.00'}
                </b>
              </div>
            </div>
            {(breakdown.reward !== 0 ||
              breakdown.subsidy !== 0 ||
              breakdown.correction !== 0 ||
              Number(data.pendingAmount) > 0) && (
              <p className="inc-bill-extra">
                {[
                  Number(data.pendingAmount) > 0
                    ? `待审 ${money(data.pendingAmount)}`
                    : '',
                  breakdown.reward !== 0
                    ? `排名 ${money(breakdown.reward)}${assessment?.rankResult ? `·${assessment.rankResult}` : ''}`
                    : '',
                  breakdown.subsidy !== 0 ? `补助 ${money(breakdown.subsidy)}` : '',
                  breakdown.correction !== 0 ? `校正 ${money(breakdown.correction)}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="inc-bill-body">
        {!loading && data && (
          <>
            <div className="inc-bill-seg" role="tablist">
              <button
                type="button"
                role="tab"
                className={tab === 'cases' ? 'is-on' : ''}
                onClick={() => setTab('cases')}
              >
                案例
                <em>{dayFilter === 'all' ? data.list.length : visibleCaseCount}</em>
              </button>
              <button
                type="button"
                role="tab"
                className={tab === 'extra' ? 'is-on' : ''}
                onClick={() => setTab('extra')}
              >
                报销与其他
                <em>{extraCount}</em>
              </button>
            </div>

            {tab === 'cases' && dayGroups.length > 0 && (
              <div className="inc-bill-days" role="listbox" aria-label="按日筛选">
                <button
                  type="button"
                  className={dayFilter === 'all' ? 'is-on' : ''}
                  onClick={clearDay}
                >
                  <b>全</b>
                  <span>月</span>
                </button>
                {dayGroups.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    className={dayFilter === g.key ? 'is-on' : ''}
                    onClick={() => setDayFilter(g.key)}
                  >
                    <b>{g.dayNum}</b>
                    <span>{g.weekday ? `周${g.weekday}` : '—'}</span>
                  </button>
                ))}
              </div>
            )}

            {tab === 'cases' && (
              <section className="inc-bill-panel">
                {!data.list.length ? (
                  <Empty description="该月暂无案例收入" />
                ) : dayFilter !== 'all' && !visibleGroups.length ? (
                  <div className="inc-bill-empty">
                    <Empty description={`${dayLabel || '该日'}暂无案例`} />
                    <button type="button" className="inc-bill-text-btn" onClick={clearDay}>
                      看整月
                    </button>
                  </div>
                ) : (
                  visibleGroups.map((group) => (
                    <div key={group.key} className="inc-bill-group">
                      {dayFilter === 'all' && (
                        <div className="inc-bill-group-head">
                          <div className="inc-bill-group-date">
                            <strong>{group.dayNum}</strong>
                            <span>{group.weekday ? `周${group.weekday}` : ''}</span>
                          </div>
                          <em>
                            {group.items.length} 单 · {money(group.sum)}
                          </em>
                        </div>
                      )}
                      <ul className="inc-bill-list">
                        {group.items.map((item) => {
                          const earned = Number(item.perfFinal || 0);
                          const penaltyTotal = Number(item.eventPenaltyTotal || 0);
                          const net = earned - penaltyTotal;
                          const caseTotal = Number(
                            item.casePerfFinal || item.perfFinal || 0,
                          );
                          const shared =
                            !!item.isShared ||
                            (caseTotal > 0 && Math.abs(caseTotal - earned) > 0.009);
                          return (
                            <li key={item.id}>
                              <button
                                type="button"
                                className="inc-bill-row"
                                onClick={() => setActive(item)}
                              >
                                <div className="inc-bill-row-main">
                                  <h3>
                                    {item.serviceCase?.projectName || item.gspCaseNo}
                                  </h3>
                                  <p>
                                    <span
                                      className={`inc-bill-tag ${
                                        item.reviewStatus === 'approved'
                                          ? 'ok'
                                          : item.reviewStatus === 'rejected'
                                            ? 'bad'
                                            : 'wait'
                                      }`}
                                    >
                                      {reviewLabel[item.reviewStatus]}
                                    </span>
                                    {shared ? <span>分账</span> : null}
                                    {penaltyTotal > 0 ? (
                                      <span>扣后 {money(net)}</span>
                                    ) : null}
                                  </p>
                                </div>
                                <strong>{money(earned)}</strong>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))
                )}
              </section>
            )}

            {tab === 'extra' && (
              <section className="inc-bill-panel">
                {!extraCount ? (
                  <Empty description="该月暂无报销或其他扣罚" />
                ) : (
                  <>
                    {expenses.length > 0 && (
                      <div className="inc-bill-block">
                        <h4>已通过报销</h4>
                        {expenses.map((e) => {
                          const linked = resolveExpenseCase(e);
                          return (
                            <div key={e.id} className="inc-bill-expense">
                              <div className="inc-bill-expense-main">
                                <h3>{linked.title}</h3>
                                <p>
                                  {[linked.sub, e.note || '报销'].filter(Boolean).join(' · ')}
                                </p>
                              </div>
                              <b className="is-pos">¥{Number(e.amount).toFixed(2)}</b>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {otherPenalties.length > 0 && (
                      <div className="inc-bill-block">
                        <h4>其他扣罚</h4>
                        <PenaltyList items={otherPenalties} />
                      </div>
                    )}
                  </>
                )}
              </section>
            )}
          </>
        )}
      </div>

      <Popup visible={pickOpen} position="bottom" round onClose={() => setPickOpen(false)}>
        <div className="inc-bill-picker">
          <div className="inc-bill-sheet-grab" />
          <div className="inc-bill-picker-bar">
            <button type="button" onClick={() => goMonth(-1)} aria-label="上月">
              ‹
            </button>
            <strong>{fmtMonthLabel(month)}</strong>
            <button
              type="button"
              onClick={() => goMonth(1)}
              disabled={month >= currentMonth()}
              aria-label="下月"
            >
              ›
            </button>
          </div>

          <div className="inc-bill-cal-head">
            {weekdayShort.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="inc-bill-cal">
            {calCells.map((cell, idx) =>
              cell ? (
                <button
                  key={cell.key}
                  type="button"
                  disabled={cell.key > currentDay()}
                  className={[
                    dayFilter === cell.key ? 'is-on' : '',
                    dayDotMap.has(cell.key) ? 'has-dot' : '',
                    cell.key === currentDay() ? 'is-today' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => selectDay(cell.key)}
                >
                  {cell.day}
                  {dayDotMap.has(cell.key) ? <i /> : null}
                </button>
              ) : (
                <span key={`pad-${idx}`} />
              ),
            )}
          </div>

          <div className="inc-bill-picker-actions">
            <button
              type="button"
              className="inc-bill-picker-ghost"
              onClick={() => {
                clearDay();
                setPickOpen(false);
              }}
            >
              看整月
            </button>
            <button
              type="button"
              className="inc-bill-picker-primary"
              onClick={() => {
                const now = currentMonth();
                setDayFilter('all');
                setMonth(now);
                setPickOpen(false);
              }}
            >
              回到本月
            </button>
          </div>
        </div>
      </Popup>

      <Popup
        visible={!!active}
        position="bottom"
        round
        closeable={false}
        onClose={() => setActive(undefined)}
      >
        {active && <CaseSheet item={active} onClose={() => setActive(undefined)} />}
      </Popup>
    </div>
  );
}

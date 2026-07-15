import { useCallback } from 'react';

import { useNavigate } from 'react-router-dom';

import { NavBar, Cell, Button, Dialog, Grid, Empty } from 'react-vant';

import { useAuthStore } from '../../stores/auth';

import { fetchInspectorSummary, type InspectorSummary } from '../../api/stats';
import { mobileCacheKeys } from '../../utils/mobileCacheKeys';
import { useCachedResource } from '../../utils/useCachedResource';



/** 我的：头像、站点、统计、设置 */

export default function MyPage() {

  const navigate = useNavigate();

  const { user, currentSite, logout } = useAuthStore();

  const loader = useCallback(
    () => fetchInspectorSummary(currentSite?.id),
    [currentSite?.id],
  );
  const { data: summary, loading, error, reload } = useCachedResource<InspectorSummary>(
    mobileCacheKeys.inspectorSummary(user?.id, currentSite?.id),
    loader,
  );



  const onLogout = async () => {

    try {

      await Dialog.confirm({

        title: '提示',

        message: '确定退出登录？',

      });

    } catch {

      return;

    }

    await logout();

    navigate('/m/login', { replace: true });

  };



  const month = summary?.month;



  return (

    <div>

      <NavBar title="我的" />

      <Cell.Group inset style={{ marginTop: 12 }}>

        <Cell

          title={user?.realName || '-'}

          label={user?.phone || user?.username}

          icon={

            <div

              style={{

                width: 48,

                height: 48,

                borderRadius: '50%',

                background: '#1a5f4a',

                color: '#fff',

                display: 'flex',

                alignItems: 'center',

                justifyContent: 'center',

                fontSize: 18,

              }}

            >

              {(user?.realName || 'U').slice(0, 1)}

            </div>

          }

        />

      </Cell.Group>



      <Cell.Group inset style={{ marginTop: 12 }}>

        <Cell

          title="当前站点"

          value={currentSite?.name || '未选择'}

          isLink

          onClick={() => navigate('/m/sites')}

        />

      </Cell.Group>



      <div style={{ margin: '12px 16px' }}>

        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>本月统计</div>

        {loading ? (
          <div className="mobile-summary-skeleton" aria-label="正在加载本月统计">
            <i /><i /><i />
          </div>
        ) : error && !summary ? (
          <button type="button" className="mobile-load-error" onClick={() => void reload()}>
            统计暂时没有加载成功，点击重试
          </button>
        ) : month ? (

          <Grid columnNum={3} border={false}>

            <Grid.Item text="任务数" icon={<strong>{month.total}</strong>} />

            <Grid.Item text="已完成" icon={<strong style={{ color: '#1a5f4a' }}>{month.completed}</strong>} />

            <Grid.Item text="完成率" icon={<strong>{month.completionRate}%</strong>} />

          </Grid>

        ) : (

          <Empty description="暂无数据" imageSize={64} />

        )}

      </div>



      <Cell.Group inset style={{ marginTop: 12 }}>

        <Cell title="历史记录" isLink onClick={() => navigate('/m/history')} />

        <Cell title="个人资料" isLink onClick={() => navigate('/m/settings')} />

      </Cell.Group>



      <div style={{ padding: 16 }}>

        <Button block round type="danger" plain style={{ height: 48 }} onClick={onLogout}>

          退出登录

        </Button>

      </div>

    </div>

  );

}

export const mobileCacheKeys = {
  homeTasks: (userId?: string, siteId?: string) =>
    `home-tasks:${userId || 'anonymous'}:${siteId || 'all'}`,
  taskList: (userId?: string, siteId?: string, filters = 'default') =>
    `task-list:${userId || 'anonymous'}:${siteId || 'all'}:${filters}`,
  inspectorSummary: (userId?: string, siteId?: string) =>
    `inspector-summary:${userId || 'anonymous'}:${siteId || 'all'}`,
};

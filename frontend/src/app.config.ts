export default defineAppConfig({
  pages: [
    'pages/dashboard/index',
    'pages/records/index',
    'pages/record-detail/index',
    'pages/record-edit/index',
    'pages/equipments/index',
    'pages/users/index',
    'pages/categories/index',
    'pages/logs/index',
    'pages/profile/index',
    'pages/login/index',
    'pages/ai-chat/index'
  ],
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#D9534F',
    navigationBarTitleText: '器材装备管理',
    navigationBarTextStyle: 'white'
  },
  tabBar: {
    color: '#999999',
    selectedColor: '#D9534F',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      { pagePath: 'pages/dashboard/index', text: '仪表盘' },
      { pagePath: 'pages/records/index', text: '记录' },
      { pagePath: 'pages/profile/index', text: '我的' }
    ]
  }
})

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
    'pages/ai-chat/index',
    'pages/equipment-detail/index',
    'pages/recycle/index',
    'pages/permissions/index',
    'pages/profile-setup/index'
  ],
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTitleText: '器材装备出入库管理',
    navigationStyle: 'default',
    navigationBarTextStyle: 'black'
  },
  tabBar: {
    color: '#9196A0',
    selectedColor: '#1B284B',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      {
        pagePath: 'pages/dashboard/index',
        text: '仪表盘',
        iconPath: 'assets/icons/dashboard.png',
        selectedIconPath: 'assets/icons/dashboard-active.png'
      },
      {
        pagePath: 'pages/records/index',
        text: '记录',
        iconPath: 'assets/icons/records.png',
        selectedIconPath: 'assets/icons/records-active.png'
      },
      {
        pagePath: 'pages/profile/index',
        text: '我的',
        iconPath: 'assets/icons/profile.png',
        selectedIconPath: 'assets/icons/profile-active.png'
      }
    ]
  }
})

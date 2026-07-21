/**
 * 通信器材出入库记录导入脚本
 * 1. 清空现有 categories / equipments / records / record_photos
 * 2. 创建 "通信器材" 分类体系
 * 3. 将 zip 中的图片复制到 uploads（UUID 重命名）
 * 4. 根据 Excel 数据创建器材和出入库记录
 *
 * 用法: npx ts-node scripts/import-records.ts
 */
import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'

const db = new Database('./dev.db')
db.pragma('foreign_keys = ON')

const UPLOAD_DIR = './uploads'
const TMP_UNZIP = './tmp_unzip/数据表'

// ============================================================
// 1. Excel 数据（文本, 单选, 日期, 附件文件名）
// ============================================================
interface ExcelRow {
  name: string
  type: 'in' | 'out'
  date: string
  photos: string[] // 原始图片文件名（IMG_xxx.jpg），用于计数参考
}

// 从 zip 文件名匹配图片（zip 按"文本"列命名，多张用 (1)(2) 或 2、3 后缀）
function findPhotosForItem(itemName: string): string[] {
  if (!fs.existsSync(TMP_UNZIP)) return []
  const allFiles = fs.readdirSync(TMP_UNZIP).filter((f) => /\.(jpg|jpeg|png)$/i.test(f))

  // 精确匹配 itemName + 可能的后缀
  const matched = allFiles.filter((f) => {
    const base = f.replace(/\.(jpg|jpeg|png)$/i, '')
    // 精确匹配 或 带 (1)(2) 或 数字后缀
    return (
      base === itemName ||
      base === itemName + '(1)' ||
      base === itemName + '(2)' ||
      base === itemName + '(3)' ||
      base === itemName + '2' ||
      base === itemName + '3' ||
      base === itemName + ' 2' ||
      base === itemName + ' 3'
    )
  })

  return matched.sort()
}

// Excel 记录数据（从用户提供的 xlsx 解析）
const excelData: ExcelRow[] = [
  { name: '7月16日11点12分整理记录', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_111230.jpg'] },
  { name: '桌子两张', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_110534.jpg', 'IMG_20260716_110527.jpg'] },
  { name: '老poc', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_110420.jpg'] },
  { name: '气瓶', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_110404.jpg'] },
  { name: '抢险头盔1个', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_110326.jpg'] },
  { name: '充电宝1个', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_110252.jpg'] },
  { name: '秒表2个', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_110131.jpg'] },
  { name: 'HDMI线3米', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_110041.jpg'] },
  { name: '应急局手台2套', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_105930.jpg'] },
  { name: '联想笔记本电脑', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_105710.jpg'] },
  { name: '摄像机2台', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_105633.jpg', 'IMG_20260716_105625.jpg'] },
  { name: 'ssk读卡器2个', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_105541.jpg'] },
  { name: '摄像机电池索尼', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_105512.jpg'] },
  { name: '采集卡1个', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_105449.jpg'] },
  { name: '摄像机电池索尼', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_105425.jpg'] },
  { name: '内存卡收纳盒3个', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_105354.jpg'] },
  { name: '川宇读卡器', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_105322.jpg'] },
  { name: '品胜充电电池套装2个', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_105247.jpg'] },
  { name: '电池收纳仓3个', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_105220.jpg'] },
  { name: '水晶头3盒', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_105200.jpg', 'IMG_20260716_105155.jpg'] },
  { name: '灰色墨盒4个', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_105054.jpg'] },
  { name: '黑色墨盒7个', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_105029.jpg'] },
  { name: '黄色墨盒3个', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_105004.jpg'] },
  { name: '红色墨盒3个', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_104940.jpg'] },
  { name: '蓝色墨盒3个', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_104833.jpg'] },
  { name: '比武废弃音频头，视频头', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_104544.jpg'] },
  { name: '椅子2把', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_104156.jpg'] },
  { name: '安奇正系留无人机', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_104056.jpg'] },
  { name: '老海信电视', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_104030.jpg'] },
  { name: '野战光纤', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_104009.jpg'] },
  { name: '老骐达民用手台24个，其他型号6个', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_104311.jpg', 'IMG_20260716_103928.jpg', 'IMG_20260716_103920.jpg'] },
  { name: '中国消防救援窗帘', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_103635.jpg'] },
  { name: '安奇正系留发电机2台', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_103519.jpg'] },
  { name: 't40农药箱', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_103503.jpg'] },
  { name: '麦克风落地三脚架', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_103439.jpg'] },
  { name: '小米电视', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_103418.jpg'] },
  { name: '安奇正系留飞机', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_102912.jpg'] },
  { name: '野战光纤', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_102840.jpg', 'IMG_20260716_102835.jpg'] },
  { name: '老电视机顶盒', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_102756.jpg'] },
  { name: '三根天线', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_102735.jpg', 'IMG_20260716_102727.jpg'] },
  { name: '标签打印机替换纸', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_102700.jpg'] },
  { name: '南孚电池', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_102450.jpg'] },
  { name: '复合翼电池充电器', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_102359.jpg'] },
  { name: '宽带基站三脚架3个', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_102636.jpg'] },
  { name: '4个poc充电器，1个万格充电器（单独），1个万格手台充电站', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_102139.jpg', 'IMG_20260716_102132.jpg', 'IMG_20260716_101947.jpg'] },
  { name: '17个老韦德手台，4个老摩托罗拉手台', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_101753.jpg', 'IMG_20260716_101707.jpg'] },
  { name: '大三脚架', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_101535.jpg', 'IMG_20260716_101531.jpg'] },
  { name: '战保老华平终端', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_101102.jpg'] },
  { name: '扶余老华平终端', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_101027.jpg'] },
  { name: '布控球三脚架', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_100950.jpg'] },
  { name: '江北老华平终端设备', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_100812.jpg'] },
  { name: '布控球三脚架', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_100656.jpg'] },
  { name: '摄像机三脚架', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_100626.jpg'] },
  { name: '摄像机三脚架5个', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_100521.jpg'] },
  { name: '喷壶', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_094336.jpg'] },
  { name: '三脚架', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_094319.jpg'] },
  { name: '喷灯', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_094025.jpg'] },
  { name: '网线工具箱', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_092602.jpg', 'IMG_20260716_092454.jpg'] },
  { name: '万格手台16套', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_092320.jpg'] },
  { name: '高达手台14套加1个空盒', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_091917.jpg'] },
  { name: '投影支架', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_090458.jpg'] },
  { name: '工具箱', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_090419.jpg'] },
  { name: '便携扩音器', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_090058.jpg'] },
  { name: '音频线，桌面麦克支架', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_090034.jpg', 'IMG_20260716_090009.jpg'] },
  { name: '蓝色整理箱', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_085903.jpg', 'IMG_20260716_085857.jpg'] },
  { name: '经开老华平终端', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_085800.jpg', 'IMG_20260716_085751.jpg'] },
  { name: 'sdi线', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_085703.jpg'] },
  { name: '森虎手台10个', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_085602.jpg'] },
  { name: '携行背包', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_085452.jpg', 'IMG_20260716_085445.jpg'] },
  { name: '废弃机箱', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_085322.jpg'] },
  { name: '便携音响', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_085229.jpg'] },
  { name: '随车工具包', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_085157.jpg'] },
  { name: 'usb转dc线', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_085117.jpg'] },
  { name: '窄带自组网1号', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_084952.jpg'] },
  { name: '北斗卫星电话3个', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_084919.jpg'] },
  { name: '天通卫星电话', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_084534.jpg', 'IMG_20260716_084527.jpg'] },
  { name: '御3保护罩', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_084437.jpg'] },
  { name: '森虎写频线', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_084327.jpg'] },
  { name: '如风电池充电器', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_084239.jpg'] },
  { name: 'T40充电器', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_084152.jpg'] },
  { name: '如风4无人机', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_084111.jpg', 'IMG_20260716_084104.jpg'] },
  { name: 't40老抛投架', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_084020.jpg'] },
  { name: 't40电池散热箱', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_083927.jpg'] },
  { name: '如风4电池', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_083854.jpg'] },
  { name: '森虎手台充电器', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_083609.jpg', 'IMG_20260716_083557.jpg'] },
  { name: '老m30t', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_083425.jpg'] },
  { name: '窄带自组网3号', type: 'in', date: '2026-07-16', photos: ['IMG_20260716_083353.jpg'] },
  { name: '网线两箱', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_160933.jpg'] },
  { name: '应急局无人机', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_160858.jpg'] },
  { name: '老海事卫星箱', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_160821.jpg', 'IMG_20260715_160812.jpg'] },
  { name: '未知设备  有视频矩阵', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_160720.jpg', 'IMG_20260715_160710.jpg'] },
  { name: '老系留无人机配件2', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_160555.jpg', 'IMG_20260715_160550.jpg'] },
  { name: '老系留无人机配件', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_160519.jpg', 'IMG_20260715_160514.jpg'] },
  { name: '一机三屏', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_160427.jpg', 'IMG_20260715_160413.jpg'] },
  { name: '喊话器', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_160319.jpg', 'IMG_20260715_160314.jpg'] },
  { name: '老双卡单兵', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_160255.jpg'] },
  { name: '应急局无人机抛投器', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_160222.jpg'] },
  { name: '应急局无人机充电器', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_160153.jpg'] },
  { name: '应急局海康威视云台', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_160114.jpg'] },
  { name: '老韦德充电箱', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_160039.jpg', 'IMG_20260715_160033.jpg'] },
  { name: '海能达手台空盒1个', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_155923.jpg'] },
  { name: '海能达手台 全套12套', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_155903.jpg'] },
  { name: '万格手台盒子6个', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_155625.jpg'] },
  { name: '高达手台盒子11个', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_155509.jpg'] },
  { name: '双光融合视传终端。 单兵图侦', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_155415.jpg', 'IMG_20260715_155356.jpg'] },
  { name: '老式骨传导3个', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_155342.jpg'] },
  { name: 'poc对讲   盒子  21个', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_155234.jpg'] },
  { name: '新韦德手台3个', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_155118.jpg'] },
  { name: '中国移动poc   10个', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_155013.jpg'] },
  { name: '新骨传导耳机6套', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_154923.jpg'] },
  { name: '抛投箱', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_154608.jpg'] },
  { name: '老华平会议终端', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_154548.jpg', 'IMG_20260715_154538.jpg'] },
  { name: '小指挥华平', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_154504.jpg'] },
  { name: '报废机箱2个', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_154424.jpg'] },
  { name: '坏音响', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_154006.jpg'] },
  { name: '电池箱 坏', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_153942.jpg', 'IMG_20260715_153938.jpg'] },
  { name: '人员跟踪定位管理套装', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_153914.jpg'] },
  { name: '人员跟踪定位管理套装', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_153854.jpg'] },
  { name: '人员跟踪管理套装', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_153836.jpg'] },
  { name: '布控球4号', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_153820.jpg'] },
  { name: '布控球2号', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_153803.jpg'] },
  { name: '禅思z30', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_153745.jpg'] },
  { name: '精灵4rtk', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_153722.jpg'] },
  { name: '老指挥箱', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_153659.jpg'] },
  { name: '布控球1号', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_153628.jpg'] },
  { name: '布控球3号', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_153612.jpg'] },
  { name: '老4G单兵', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_153535.jpg'] },
  { name: '5G单兵 金刚炮带的2', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_153456.jpg'] },
  { name: '5G单兵 金刚炮带的', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_153421.jpg'] },
  { name: '单兵4号', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_153353.jpg'] },
  { name: '5G单兵6号', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_153329.jpg'] },
  { name: '5G单兵3号', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_153301.jpg'] },
  { name: '人员跟踪管理套装1', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_152828.jpg'] },
  { name: '老指挥箱', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_152745.jpg'] },
  { name: 'M30T-3号', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_152714.jpg'] },
  { name: '窄带自组网2号', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_152644.jpg'] },
  { name: 'mesh基站3', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_152625.jpg'] },
  { name: 'mesh基站2', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_152557.jpg'] },
  { name: 'mesh基站1', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_152536.jpg'] },
  { name: 'mesh单兵1', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_152503.jpg'] },
  { name: 'mash单兵新', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_152438.jpg'] },
  { name: 'mash单兵3', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_152414.jpg'] },
  { name: 'mash单兵2', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_152337.jpg'] },
  { name: '漂浮绳线盘', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_152250.jpg'] },
  { name: '御2', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_151802.jpg'] },
  { name: '防寒保暖', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_151900.jpg', 'IMG_20260715_151840.jpg'] },
  { name: '指挥部搭建', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_151934.jpg'] },
  { name: '音响一套', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_152043.jpg'] },
  { name: '空箱', type: 'in', date: '2026-07-15', photos: ['IMG_20260715_152152.jpg'] },
]

// ============================================================
// 2. 分类定义
// ============================================================
interface CatDef {
  code: string
  name: string
  keywords: string[]
}

const CATEGORIES: CatDef[] = [
  { code: 'COMM_RADIO', name: '通信手台', keywords: ['手台', '对讲', 'poc', '写频线', '充电站', '充电箱', '充电器'] },
  { code: 'COMM_DRONE', name: '无人机及配件', keywords: ['无人机', 'm30t', '御', '如风', 't40', '抛投', '散热箱', '保护罩', '禅思', '精灵', '系留'] },
  { code: 'COMM_INDIVIDUAL', name: '单兵装备', keywords: ['单兵', 'mash', 'mesh', '自组网', '骨传导', '耳机'] },
  { code: 'COMM_SURVEILLANCE', name: '布控与终端', keywords: ['布控球', '华平', '终端', '视传', '图侦', '云台', '指挥箱'] },
  { code: 'COMM_TRIPOD', name: '三脚架与支架', keywords: ['三脚架', '支架'] },
  { code: 'COMM_BATTERY', name: '电池与电源', keywords: ['电池', '充电宝', '南孚', '充电电池', '散热箱'] },
  { code: 'COMM_CABLE', name: '线缆与接口', keywords: ['线', 'hdmi', 'sdi', 'usb', '光纤', '水晶头', '网线', 'dc'] },
  { code: 'COMM_STORAGE', name: '收纳与箱包', keywords: ['箱', '包', '收纳', '整理箱', '工具箱', '空盒', '盒子'] },
  { code: 'COMM_OFFICE', name: '办公与影音', keywords: ['电视', '电脑', '笔记本', '投影', '音响', '扩音器', '打印机', '墨盒', '摄像机', '读卡器', '采集卡', '内存卡', '秒表', '麦克风', '音频', '视频头'] },
  { code: 'COMM_OTHER', name: '其他器材', keywords: [] }, // 兜底
]

function matchCategory(name: string): string {
  const lower = name.toLowerCase()
  for (const cat of CATEGORIES) {
    for (const kw of cat.keywords) {
      if (lower.includes(kw.toLowerCase())) return cat.code
    }
  }
  return 'COMM_OTHER'
}

// ============================================================
// 3. 执行导入
// ============================================================
function main() {
  console.log('=== 通信器材出入库记录导入 ===\n')

  // 3.1 清空旧数据
  console.log('[1/5] 清空旧数据...')
  db.exec('DELETE FROM record_photos')
  db.exec('DELETE FROM records')
  db.exec('DELETE FROM equipments')
  db.exec('DELETE FROM categories')
  console.log('  已清空 record_photos, records, equipments, categories\n')

  // 3.2 创建分类
  console.log('[2/5] 创建分类...')
  const insertCat = db.prepare(
    'INSERT INTO categories (parent_id, code, name, level, sort_order) VALUES (?, ?, ?, ?, ?)'
  )
  // 一级分类
  insertCat.run(null, 'COMM_EQUIP', '通信器材', 1, 1)
  const parentId = (db.prepare('SELECT id FROM categories WHERE code = ?').get('COMM_EQUIP') as any).id
  // 二级分类
  CATEGORIES.forEach((cat, i) => {
    insertCat.run(parentId, cat.code, cat.name, 2, i + 1)
  })
  console.log(`  已创建 1 个一级分类 + ${CATEGORIES.length} 个二级分类\n`)

  // 3.3 复制图片到 uploads 并创建器材
  console.log('[3/5] 创建器材记录...')
  const insertEquip = db.prepare(
    'INSERT INTO equipments (name, category_id, spec, scrap_years, threshold) VALUES (?, ?, NULL, NULL, 1)'
  )
  const getCatId = db.prepare('SELECT id FROM categories WHERE code = ?')

  // 为每个不同的器材名称创建 equipment
  const equipMap = new Map<string, number>() // name → equipment_id
  const uniqueNames = [...new Set(excelData.map((r) => r.name))]
  for (const name of uniqueNames) {
    const catCode = matchCategory(name)
    const catId = (getCatId.get(catCode) as any).id
    const info = insertEquip.run(name, catId)
    equipMap.set(name, info.lastInsertRowid as number)
  }
  console.log(`  已创建 ${uniqueNames.length} 个器材\n`)

  // 3.4 创建记录和照片
  console.log('[4/5] 创建出入库记录和照片...')
  const insertRecord = db.prepare(
    `INSERT INTO records (equipment_id, type, quantity, operator_id, produced_at, remark)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  const insertPhoto = db.prepare(
    'INSERT INTO record_photos (record_id, url, kind, sort_order) VALUES (?, ?, ?, ?)'
  )

  let photoCount = 0
  let recordCount = 0
  const usedPhotos = new Set<string>() // 避免重复使用同一张图片

  for (const row of excelData) {
    const equipId = equipMap.get(row.name)
    if (!equipId) continue

    const remark = row.photos.length > 0 ? `原始附件: ${row.photos.join(', ')}` : null
    const recordInfo = insertRecord.run(
      equipId,
      row.type,
      1, // quantity 默认1
      1, // operator_id = 1 (开发者)
      row.date,
      remark
    )
    const recordId = recordInfo.lastInsertRowid as number
    recordCount++

    // 查找并复制图片
    const zipPhotos = findPhotosForItem(row.name)
    // 过滤已使用的图片
    const availablePhotos = zipPhotos.filter((p) => !usedPhotos.has(p))

    for (let i = 0; i < availablePhotos.length; i++) {
      const srcPath = path.join(TMP_UNZIP, availablePhotos[i])
      if (!fs.existsSync(srcPath)) continue

      const ext = path.extname(availablePhotos[i]).toLowerCase() || '.jpg'
      const newFilename = `${randomUUID()}${ext}`
      const destPath = path.join(UPLOAD_DIR, newFilename)
      fs.copyFileSync(srcPath, destPath)
      usedPhotos.add(availablePhotos[i])

      const url = `/uploads/${newFilename}`
      insertPhoto.run(recordId, url, 'product', i)
      photoCount++
    }
  }
  console.log(`  已创建 ${recordCount} 条记录, ${photoCount} 张照片\n`)

  // 3.5 统计
  console.log('[5/5] 导入结果统计:')
  const catCount = (db.prepare('SELECT COUNT(*) as c FROM categories').get() as any).c
  const equipCount = (db.prepare('SELECT COUNT(*) as c FROM equipments').get() as any).c
  const recCount = (db.prepare('SELECT COUNT(*) as c FROM records').get() as any).c
  const photoCnt = (db.prepare('SELECT COUNT(*) as c FROM record_photos').get() as any).c
  console.log(`  分类: ${catCount}`)
  console.log(`  器材: ${equipCount}`)
  console.log(`  记录: ${recCount}`)
  console.log(`  照片: ${photoCnt}`)

  // 未匹配的图片
  if (fs.existsSync(TMP_UNZIP)) {
    const allZip = fs.readdirSync(TMP_UNZIP).filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
    const unmatched = allZip.filter((f) => !usedPhotos.has(f))
    if (unmatched.length > 0) {
      console.log(`\n  ⚠ 未匹配的图片 (${unmatched.length} 张):`)
      unmatched.forEach((f) => console.log(`    - ${f}`))
    }
  }

  console.log('\n=== 导入完成 ===')
  db.close()
}

main()
